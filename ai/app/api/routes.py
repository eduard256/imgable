"""
API routes for AI service.
"""

import asyncio
from typing import Dict, Any, Optional
from pydantic import BaseModel

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.processing import worker
from app.models import model_manager
from app.db import get_queue_stats, get_pending_count

router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================

class ConfigUpdate(BaseModel):
    """Partial configuration update."""
    ai_delay_ms: Optional[int] = None
    ai_faces_enabled: Optional[bool] = None
    ai_tags_enabled: Optional[bool] = None
    ai_ocr_enabled: Optional[bool] = None
    ai_ocr_mode: Optional[str] = None
    ai_cluster_threshold: Optional[float] = None
    ai_faces_min_confidence: Optional[float] = None
    ai_tags_min_confidence: Optional[float] = None


class StatusResponse(BaseModel):
    """Worker status response."""
    status: str
    current_photo: Optional[Dict[str, Any]]
    queue: Dict[str, int]
    estimated_time_seconds: Optional[int]
    last_run: Optional[Dict[str, Any]]


class QueueResponse(BaseModel):
    """Queue details response."""
    total_pending: int
    by_status: Dict[str, int]
    estimated_time: Optional[Dict[str, Any]]


# =============================================================================
# Health Check
# =============================================================================

@router.get("/health")
async def health_check():
    """Health check endpoint."""
    settings = get_settings()
    return {
        "status": "ok",
        "device": "cpu",
        "version": "1.0.0"
    }


# =============================================================================
# Status and Control
# =============================================================================

@router.get("/api/v1/status", response_model=StatusResponse)
async def get_status():
    """Get current worker status and queue info."""
    status = await worker.get_status()
    return status


@router.post("/api/v1/run")
async def start_run(background_tasks: BackgroundTasks):
    """Start AI processing run."""
    if worker.status.value == "processing":
        return JSONResponse(
            status_code=409,
            content={"status": "already_running", "message": "Worker is already running"}
        )

    # Run in background
    background_tasks.add_task(worker.run)

    return {"status": "started", "message": "AI processing started"}


@router.post("/api/v1/stop")
async def stop_run():
    """Stop AI processing run."""
    if worker.status.value != "processing":
        return JSONResponse(
            status_code=409,
            content={"status": "not_running", "message": "Worker is not running"}
        )

    await worker.stop()

    return {"status": "stopping", "message": "AI processing stopping"}


# =============================================================================
# Queue
# =============================================================================

@router.get("/api/v1/queue", response_model=QueueResponse)
async def get_queue():
    """Get detailed queue information."""
    stats = await get_queue_stats()
    pending = stats.get("pending", 0)

    # Estimate time
    estimated_time = None
    if worker.last_run and pending > 0:
        last = worker.last_run
        if last.get("photos_processed", 0) > 0:
            # Calculate average time per photo from last run
            from datetime import datetime
            started = datetime.fromisoformat(last["started_at"])
            completed = datetime.fromisoformat(last["completed_at"]) if last.get("completed_at") else datetime.now()
            duration = (completed - started).total_seconds()
            avg_time = duration / last["photos_processed"]
            total_seconds = int(pending * avg_time)

            estimated_time = {
                "seconds": total_seconds,
                "human": format_duration(total_seconds)
            }

    return {
        "total_pending": pending,
        "by_status": stats,
        "estimated_time": estimated_time
    }


# =============================================================================
# Configuration
# =============================================================================

@router.get("/api/v1/config")
async def get_config():
    """Get current configuration."""
    settings = get_settings()

    return {
        "processing": {
            "ai_threads": settings.ai_threads,
            "ai_delay_ms": settings.ai_delay_ms,
            "ai_batch_size": settings.ai_batch_size,
            "ai_max_cpu_percent": settings.ai_max_cpu_percent,
            "ai_auto_start": settings.ai_auto_start,
            "ai_scan_interval": settings.ai_scan_interval
        },
        "faces": {
            "enabled": settings.ai_faces_enabled,
            "min_confidence": settings.ai_faces_min_confidence,
            "min_size": settings.ai_faces_min_size,
            "max_per_photo": settings.ai_faces_max_per_photo,
            "cluster_threshold": settings.ai_cluster_threshold
        },
        "tags": {
            "enabled": settings.ai_tags_enabled,
            "min_confidence": settings.ai_tags_min_confidence,
            "max_per_photo": settings.ai_tags_max_per_photo
        },
        "ocr": {
            "enabled": settings.ai_ocr_enabled,
            "mode": settings.ai_ocr_mode,
            "min_confidence": settings.ai_ocr_min_confidence,
            "update_taken_at": settings.ai_ocr_update_taken_at
        },
        "models": {
            "idle_unload_minutes": settings.ai_idle_unload_minutes
        }
    }


@router.put("/api/v1/config")
async def update_config(config: ConfigUpdate):
    """
    Update configuration at runtime.
    Note: Most settings require restart to take effect.
    """
    # For now, just acknowledge - runtime config changes would require
    # a more complex implementation with mutable settings
    return {
        "status": "acknowledged",
        "message": "Configuration update received. Some changes may require restart."
    }


# =============================================================================
# Models
# =============================================================================

@router.get("/api/v1/models")
async def get_models():
    """Get information about loaded models."""
    return model_manager.get_info()


@router.post("/api/v1/models/reload")
async def reload_models():
    """Unload all models. They will be loaded lazily on next use."""
    model_manager.unload_all()
    return {"status": "unloaded", "models": model_manager.get_info()}


# =============================================================================
# Utilities
# =============================================================================

def format_duration(seconds: int) -> str:
    """Format seconds to human-readable duration."""
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"~{minutes} min"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        if minutes > 0:
            return f"~{hours}h {minutes}m"
        return f"~{hours}h"
