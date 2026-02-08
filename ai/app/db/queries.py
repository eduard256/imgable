"""
Database queries for AI service.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid

from app.db.database import db


# =============================================================================
# AI Queue Operations
# =============================================================================

async def get_next_pending_photo() -> Optional[Dict[str, Any]]:
    """Get the next photo from the AI queue for processing."""
    query = """
        UPDATE ai_queue
        SET status = 'processing', started_at = NOW(), attempts = attempts + 1
        WHERE photo_id = (
            SELECT photo_id FROM ai_queue
            WHERE status = 'pending'
            ORDER BY priority DESC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING photo_id
    """
    row = await db.fetchrow(query)
    if not row:
        return None

    # Get photo details
    photo_query = """
        SELECT id, type, small_width, small_height, taken_at
        FROM photos
        WHERE id = $1 AND status = 'ready'
    """
    photo = await db.fetchrow(photo_query, row["photo_id"])
    if not photo:
        # Photo no longer exists or not ready, mark as done
        await mark_queue_done(row["photo_id"])
        return None

    return dict(photo)


async def mark_queue_done(photo_id: str) -> None:
    """Mark a photo as done in the AI queue."""
    query = """
        UPDATE ai_queue
        SET status = 'done', completed_at = NOW()
        WHERE photo_id = $1
    """
    await db.execute(query, photo_id)


async def mark_queue_error(photo_id: str, error: str, max_retries: int = 3) -> None:
    """Mark a photo as error in the AI queue."""
    query = """
        UPDATE ai_queue
        SET
            status = CASE WHEN attempts >= $3 THEN 'error' ELSE 'pending' END,
            last_error = $2,
            started_at = NULL
        WHERE photo_id = $1
    """
    await db.execute(query, photo_id, error, max_retries)


async def get_queue_stats() -> Dict[str, int]:
    """Get AI queue statistics."""
    query = """
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status = 'processing') as processing,
            COUNT(*) FILTER (WHERE status = 'done') as done,
            COUNT(*) FILTER (WHERE status = 'error') as error
        FROM ai_queue
    """
    row = await db.fetchrow(query)
    return dict(row) if row else {"pending": 0, "processing": 0, "done": 0, "error": 0}


async def get_pending_count() -> int:
    """Get count of pending photos in queue."""
    query = "SELECT COUNT(*) FROM ai_queue WHERE status = 'pending'"
    return await db.fetchval(query) or 0


async def reset_stuck_processing(timeout_minutes: int = 30) -> int:
    """Reset photos stuck in processing state."""
    query = """
        UPDATE ai_queue
        SET status = 'pending', started_at = NULL
        WHERE status = 'processing'
          AND started_at < NOW() - INTERVAL '%s minutes'
    """ % timeout_minutes
    result = await db.execute(query)
    # Extract count from result like "UPDATE 5"
    count = int(result.split()[-1]) if result else 0
    return count


# =============================================================================
# Person and Face Operations
# =============================================================================

async def get_or_create_person(
    embedding: List[float],
    threshold: float = 0.6
) -> tuple[str, str, bool]:
    """
    Find existing face by embedding similarity or create new person and face.

    Returns (person_id, face_id, is_new_person).

    Logic:
    1. Get all face embeddings from faces table
    2. Find closest match by cosine distance
    3. If match found (distance < threshold):
       - Return existing person_id, face_id, is_new=False
    4. If no match:
       - Create new person in persons table
       - Create new face in faces table with embedding
       - Return new person_id, face_id, is_new=True
    """
    # Find closest existing face
    query = """
        SELECT f.id as face_id, f.person_id, f.embedding
        FROM faces f
        WHERE f.embedding IS NOT NULL
    """
    rows = await db.fetch(query)

    best_face_id = None
    best_person_id = None
    best_distance = float("inf")

    for row in rows:
        if row["embedding"]:
            distance = cosine_distance(embedding, list(row["embedding"]))
            if distance < best_distance:
                best_distance = distance
                best_face_id = row["face_id"]
                best_person_id = row["person_id"]

    # If found similar face, return existing person
    if best_face_id and best_distance < threshold:
        return best_person_id, best_face_id, False

    # Create new person
    person_id = f"person_{uuid.uuid4().hex[:12]}"
    person_count = await db.fetchval("SELECT COUNT(*) FROM persons")
    name = f"Unknown {person_count + 1}"

    insert_person_query = """
        INSERT INTO persons (id, name, name_source, photo_count, created_at, updated_at)
        VALUES ($1, $2, 'auto', 0, NOW(), NOW())
    """
    await db.execute(insert_person_query, person_id, name)

    # Create new face with embedding
    face_id = f"face_{uuid.uuid4().hex[:12]}"
    insert_face_query = """
        INSERT INTO faces (id, person_id, embedding, photo_count, created_at, updated_at)
        VALUES ($1, $2, $3, 0, NOW(), NOW())
    """
    await db.execute(insert_face_query, face_id, person_id, embedding)

    return person_id, face_id, True


# =============================================================================
# AI Tags Operations (Objects and Scenes only)
# =============================================================================

async def get_or_create_object_tag(name: str) -> str:
    """Get or create an object tag."""
    tag_id = f"object_{name.lower().replace(' ', '_')}"

    query = """
        INSERT INTO ai_tags (id, type, name, photo_count, created_at, updated_at)
        VALUES ($1, 'object', $2, 0, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
    """
    await db.execute(query, tag_id, name)

    return tag_id


async def get_or_create_scene_tag(name: str) -> str:
    """Get or create a scene tag."""
    tag_id = f"scene_{name.lower().replace(' ', '_')}"

    query = """
        INSERT INTO ai_tags (id, type, name, photo_count, created_at, updated_at)
        VALUES ($1, 'scene', $2, 0, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
    """
    await db.execute(query, tag_id, name)

    return tag_id


# =============================================================================
# Photo Face Operations
# =============================================================================

async def add_photo_face(
    photo_id: str,
    face_id: str,
    box: tuple,
    embedding: List[float],
    confidence: Optional[float] = None
) -> str:
    """
    Add a face detection to a photo.

    Args:
        photo_id: Photo ID
        face_id: Face ID (references faces table)
        box: Bounding box (x, y, w, h) as relative coordinates 0-1
        embedding: 512-dimensional face embedding
        confidence: Detection confidence 0-1

    Returns:
        photo_face entry ID
    """
    entry_id = f"pface_{uuid.uuid4().hex[:12]}"
    box_x, box_y, box_w, box_h = box

    query = """
        INSERT INTO photo_faces (id, photo_id, face_id, box_x, box_y, box_w, box_h, embedding, confidence, hidden, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, NOW())
        ON CONFLICT DO NOTHING
    """
    await db.execute(
        query, entry_id, photo_id, face_id,
        box_x, box_y, box_w, box_h, embedding, confidence
    )

    return entry_id


# =============================================================================
# Photo Tag Operations
# =============================================================================

async def add_photo_tag(
    photo_id: str,
    tag_id: str,
    confidence: Optional[float] = None
) -> str:
    """
    Add an object/scene tag to a photo.

    Args:
        photo_id: Photo ID
        tag_id: Tag ID (references ai_tags table)
        confidence: Detection confidence 0-1

    Returns:
        photo_tag entry ID
    """
    entry_id = f"ptag_{uuid.uuid4().hex[:12]}"

    query = """
        INSERT INTO photo_tags (id, photo_id, tag_id, confidence, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT DO NOTHING
    """
    await db.execute(query, entry_id, photo_id, tag_id, confidence)

    return entry_id


# =============================================================================
# Photo Updates
# =============================================================================

async def update_photo_ai_results(
    photo_id: str,
    person_ids: List[str],
    ocr_text: Optional[str] = None,
    ocr_date: Optional[datetime] = None,
    colors: Optional[List[str]] = None,
    quality_score: Optional[float] = None,
    update_taken_at: bool = False
) -> None:
    """Update photo with AI processing results."""
    # Build dynamic update
    updates = ["ai_processed_at = NOW()"]
    params = []
    param_idx = 1

    updates.append(f"ai_person_ids = ${param_idx}")
    params.append(person_ids if person_ids else None)
    param_idx += 1

    if ocr_text is not None:
        updates.append(f"ai_ocr_text = ${param_idx}")
        params.append(ocr_text)
        param_idx += 1

    if ocr_date is not None:
        updates.append(f"ai_ocr_date = ${param_idx}")
        params.append(ocr_date)
        param_idx += 1

        # Update taken_at if requested and currently NULL
        if update_taken_at:
            updates.append(f"taken_at = COALESCE(taken_at, ${param_idx})")
            params.append(ocr_date)
            param_idx += 1

    if colors is not None:
        updates.append(f"ai_colors = ${param_idx}")
        params.append(colors)
        param_idx += 1

    if quality_score is not None:
        updates.append(f"ai_quality_score = ${param_idx}")
        params.append(quality_score)
        param_idx += 1

    params.append(photo_id)

    query = f"""
        UPDATE photos
        SET {', '.join(updates)}
        WHERE id = ${param_idx}
    """
    await db.execute(query, *params)


# =============================================================================
# Utility Functions
# =============================================================================

def cosine_distance(a: List[float], b: List[float]) -> float:
    """Calculate cosine distance between two vectors."""
    import numpy as np
    a = np.array(a)
    b = np.array(b)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 1.0
    similarity = dot / (norm_a * norm_b)
    return 1.0 - similarity
