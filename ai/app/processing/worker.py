"""
Main AI processing worker.
Orchestrates face detection, recognition, tagging, and OCR.
"""

import asyncio
import time
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging
import threading

import cv2
import numpy as np

from app.config import get_settings
from app.db import (
    db, get_next_pending_photo, mark_queue_done, mark_queue_error,
    get_queue_stats, get_pending_count, reset_stuck_processing,
    get_or_create_person_tag,
    get_or_create_object_tag, get_or_create_scene_tag,
    add_photo_ai_tag, update_photo_ai_results
)
from app.models import model_manager
from app.processing.face_detector import face_detector, DetectedFace
from app.processing.face_recognizer import face_recognizer
from app.processing.clip_tagger import clip_tagger
from app.processing.ocr import ocr_processor

logger = logging.getLogger(__name__)


class WorkerStatus(str, Enum):
    """Worker status."""
    IDLE = "idle"
    PROCESSING = "processing"
    STOPPING = "stopping"
    ERROR = "error"


@dataclass
class RunStats:
    """Statistics for a processing run."""
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    photos_processed: int = 0
    faces_detected: int = 0
    persons_created: int = 0
    tags_assigned: int = 0
    ocr_dates_found: int = 0
    errors: int = 0


@dataclass
class CurrentPhoto:
    """Currently processing photo."""
    id: str
    started_at: datetime


class AIWorker:
    """
    Main AI processing worker.
    Processes photos from the queue with face detection, tagging, and OCR.
    """

    def __init__(self):
        self._settings = get_settings()
        self._status = WorkerStatus.IDLE
        self._current_photo: Optional[CurrentPhoto] = None
        self._last_run: Optional[RunStats] = None
        self._stop_event = asyncio.Event()
        self._lock = threading.Lock()

    @property
    def status(self) -> WorkerStatus:
        """Get current worker status."""
        return self._status

    @property
    def current_photo(self) -> Optional[Dict[str, Any]]:
        """Get currently processing photo info."""
        if self._current_photo:
            return {
                "id": self._current_photo.id,
                "started_at": self._current_photo.started_at.isoformat()
            }
        return None

    @property
    def last_run(self) -> Optional[Dict[str, Any]]:
        """Get last run statistics."""
        if not self._last_run:
            return None
        return {
            "started_at": self._last_run.started_at.isoformat(),
            "completed_at": self._last_run.completed_at.isoformat() if self._last_run.completed_at else None,
            "photos_processed": self._last_run.photos_processed,
            "faces_detected": self._last_run.faces_detected,
            "persons_created": self._last_run.persons_created,
            "tags_assigned": self._last_run.tags_assigned,
            "ocr_dates_found": self._last_run.ocr_dates_found,
            "errors": self._last_run.errors
        }

    def _get_image_path(self, photo_id: str) -> Path:
        """Get path to small preview image."""
        # Path format: /media/ab/c1/abc123def456_s.webp
        return Path(self._settings.media_path) / photo_id[:2] / photo_id[2:4] / f"{photo_id}_s.webp"

    def _load_image(self, photo_id: str) -> Optional[np.ndarray]:
        """Load image from disk."""
        path = self._get_image_path(photo_id)

        if not path.exists():
            logger.warning(f"Image not found: {path}")
            return None

        image = cv2.imread(str(path))
        if image is None:
            logger.warning(f"Failed to read image: {path}")
            return None

        return image

    async def _process_photo(self, photo: Dict[str, Any], stats: RunStats) -> None:
        """Process a single photo."""
        photo_id = photo["id"]
        logger.debug(f"Processing photo {photo_id}")

        # Load image
        image = self._load_image(photo_id)
        if image is None:
            raise ValueError(f"Could not load image for {photo_id}")

        person_ids: List[str] = []
        all_tags: List[str] = []

        # 1. Face Detection and Recognition
        if self._settings.ai_faces_enabled:
            faces = face_detector.detect(image)
            stats.faces_detected += len(faces)

            if faces:
                # Get embeddings
                faces = face_recognizer.get_embeddings(image, faces)

                for face in faces:
                    if face.embedding is None:
                        continue

                    # Find or create person
                    person_id, is_new = await get_or_create_person_tag(
                        embedding=face.embedding.tolist(),
                        threshold=self._settings.ai_cluster_threshold
                    )

                    if is_new:
                        stats.persons_created += 1

                    person_ids.append(person_id)

                    # Add photo-tag relationship with bounding box
                    await add_photo_ai_tag(
                        photo_id=photo_id,
                        tag_id=person_id,
                        box=face.box,
                        embedding=face.embedding.tolist(),
                        confidence=face.confidence
                    )

        # 2. CLIP Tagging (Objects and Scenes)
        if self._settings.ai_tags_enabled:
            tags = clip_tagger.tag(image)

            for tag in tags:
                if tag.type == "object":
                    tag_id = await get_or_create_object_tag(tag.name)
                else:
                    tag_id = await get_or_create_scene_tag(tag.name)

                await add_photo_ai_tag(
                    photo_id=photo_id,
                    tag_id=tag_id,
                    confidence=tag.confidence
                )
                all_tags.append(tag_id)

            stats.tags_assigned += len(tags)

        # 3. OCR
        ocr_text = None
        ocr_date = None

        if self._settings.ai_ocr_enabled:
            ocr_result = ocr_processor.process(image)
            ocr_text = ocr_result.text
            ocr_date = ocr_result.detected_date

            if ocr_date:
                stats.ocr_dates_found += 1

        # 4. Update photo record
        await update_photo_ai_results(
            photo_id=photo_id,
            person_ids=list(set(person_ids)),
            ocr_text=ocr_text,
            ocr_date=ocr_date,
            update_taken_at=self._settings.ai_ocr_update_taken_at
        )

        stats.photos_processed += 1

        if self._settings.ai_log_each_photo:
            logger.info(
                f"Processed {photo_id}: "
                f"{len(person_ids)} faces, {len(all_tags)} tags"
                f"{', date: ' + str(ocr_date) if ocr_date else ''}"
            )

    async def run(self) -> None:
        """
        Start processing photos from the queue.
        Runs until stopped or queue is empty.
        """
        with self._lock:
            if self._status == WorkerStatus.PROCESSING:
                logger.info("Worker already running")
                return
            self._status = WorkerStatus.PROCESSING
            self._stop_event.clear()

        stats = RunStats()
        self._last_run = stats

        logger.info("Starting AI processing run")

        # Reset stuck photos
        reset_count = await reset_stuck_processing()
        if reset_count > 0:
            logger.info(f"Reset {reset_count} stuck photos")

        try:
            while not self._stop_event.is_set():
                # Get next photo
                photo = await get_next_pending_photo()

                if photo is None:
                    # Queue empty, wait and check again
                    logger.debug("Queue empty, waiting...")
                    await asyncio.sleep(5)

                    # Check if still empty
                    pending = await get_pending_count()
                    if pending == 0:
                        logger.info("Queue empty, stopping")
                        break
                    continue

                self._current_photo = CurrentPhoto(
                    id=photo["id"],
                    started_at=datetime.now()
                )

                try:
                    await self._process_photo(photo, stats)
                    await mark_queue_done(photo["id"])

                except Exception as e:
                    logger.error(f"Error processing {photo['id']}: {e}")
                    stats.errors += 1
                    await mark_queue_error(
                        photo["id"],
                        str(e),
                        self._settings.ai_max_retries
                    )

                finally:
                    self._current_photo = None

                # Delay between photos
                if self._settings.ai_delay_ms > 0:
                    await asyncio.sleep(self._settings.ai_delay_ms / 1000)

        except Exception as e:
            logger.error(f"Worker error: {e}")
            self._status = WorkerStatus.ERROR

        finally:
            stats.completed_at = datetime.now()
            self._status = WorkerStatus.IDLE
            self._current_photo = None

            duration = (stats.completed_at - stats.started_at).total_seconds()
            logger.info(
                f"AI processing completed: "
                f"{stats.photos_processed} photos, "
                f"{stats.faces_detected} faces, "
                f"{stats.persons_created} new persons, "
                f"{stats.tags_assigned} tags, "
                f"{stats.errors} errors, "
                f"{duration:.1f}s"
            )

    async def stop(self) -> None:
        """Stop the worker gracefully."""
        if self._status != WorkerStatus.PROCESSING:
            return

        logger.info("Stopping AI worker...")
        self._status = WorkerStatus.STOPPING
        self._stop_event.set()

    async def get_status(self) -> Dict[str, Any]:
        """Get full worker status."""
        queue_stats = await get_queue_stats()
        pending = queue_stats.get("pending", 0)

        # Estimate time remaining
        if self._last_run and self._last_run.photos_processed > 0:
            duration = (self._last_run.completed_at or datetime.now()) - self._last_run.started_at
            avg_time = duration.total_seconds() / self._last_run.photos_processed
            estimated_seconds = int(pending * avg_time)
        else:
            estimated_seconds = None

        return {
            "status": self._status.value,
            "current_photo": self.current_photo,
            "queue": {
                "pending": pending,
                "processing": queue_stats.get("processing", 0),
                "done": queue_stats.get("done", 0),
                "error": queue_stats.get("error", 0)
            },
            "estimated_time_seconds": estimated_seconds,
            "last_run": self.last_run
        }


# Global worker instance
worker = AIWorker()
