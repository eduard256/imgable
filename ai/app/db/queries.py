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
# AI Tags Operations
# =============================================================================

async def get_or_create_person_tag(
    embedding: List[float],
    threshold: float = 0.6
) -> tuple[str, bool]:
    """
    Find existing person by embedding similarity or create new one.
    Returns (person_id, is_new).
    """
    # Find closest existing person
    query = """
        SELECT id, name, embedding
        FROM ai_tags
        WHERE type = 'person' AND embedding IS NOT NULL
    """
    rows = await db.fetch(query)

    best_match_id = None
    best_distance = float("inf")

    for row in rows:
        if row["embedding"]:
            distance = cosine_distance(embedding, list(row["embedding"]))
            if distance < best_distance:
                best_distance = distance
                best_match_id = row["id"]

    # If found similar person
    if best_match_id and best_distance < threshold:
        return best_match_id, False

    # Create new person
    person_id = f"person_{uuid.uuid4().hex[:12]}"
    person_count = await db.fetchval(
        "SELECT COUNT(*) FROM ai_tags WHERE type = 'person'"
    )
    name = f"Unknown {person_count + 1}"

    insert_query = """
        INSERT INTO ai_tags (id, type, name, name_source, embedding, photo_count, created_at, updated_at)
        VALUES ($1, 'person', $2, 'auto', $3, 0, NOW(), NOW())
    """
    await db.execute(insert_query, person_id, name, embedding)

    # Create album for this person
    album_id = f"album_{person_id}"
    album_query = """
        INSERT INTO albums (id, type, name, ai_tag_id, photo_count, created_at, updated_at)
        VALUES ($1, 'person', $2, $3, 0, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
    """
    await db.execute(album_query, album_id, name, person_id)

    return person_id, True


async def get_or_create_people_tag(person_ids: List[str]) -> str:
    """
    Get or create a 'people' tag for a combination of persons.
    """
    # Sort for consistent ordering
    sorted_ids = sorted(person_ids)

    # Check if exists
    query = """
        SELECT id FROM ai_tags
        WHERE type = 'people' AND person_ids = $1
    """
    row = await db.fetchrow(query, sorted_ids)
    if row:
        return row["id"]

    # Get person names for album name
    names_query = """
        SELECT name FROM ai_tags
        WHERE id = ANY($1)
        ORDER BY name
    """
    name_rows = await db.fetch(names_query, sorted_ids)
    combined_name = " + ".join(row["name"] for row in name_rows)

    # Create new people tag
    people_id = f"people_{uuid.uuid4().hex[:12]}"

    insert_query = """
        INSERT INTO ai_tags (id, type, name, name_source, person_ids, photo_count, created_at, updated_at)
        VALUES ($1, 'people', $2, 'auto', $3, 0, NOW(), NOW())
    """
    await db.execute(insert_query, people_id, combined_name, sorted_ids)

    # Create album for this people combination
    album_id = f"album_{people_id}"
    album_query = """
        INSERT INTO albums (id, type, name, ai_tag_id, photo_count, created_at, updated_at)
        VALUES ($1, 'people', $2, $3, 0, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
    """
    await db.execute(album_query, album_id, combined_name, people_id)

    return people_id


async def get_or_create_object_tag(name: str) -> str:
    """Get or create an object tag."""
    tag_id = f"object_{name.lower().replace(' ', '_')}"

    query = """
        INSERT INTO ai_tags (id, type, name, name_source, photo_count, created_at, updated_at)
        VALUES ($1, 'object', $2, 'auto', 0, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
    """
    await db.execute(query, tag_id, name)

    return tag_id


async def get_or_create_scene_tag(name: str) -> str:
    """Get or create a scene tag."""
    tag_id = f"scene_{name.lower().replace(' ', '_')}"

    query = """
        INSERT INTO ai_tags (id, type, name, name_source, photo_count, created_at, updated_at)
        VALUES ($1, 'scene', $2, 'auto', 0, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
    """
    await db.execute(query, tag_id, name)

    return tag_id


# =============================================================================
# Photo AI Tags Operations
# =============================================================================

async def add_photo_ai_tag(
    photo_id: str,
    tag_id: str,
    box: Optional[tuple] = None,
    embedding: Optional[List[float]] = None,
    confidence: Optional[float] = None
) -> str:
    """Add a tag to a photo with optional bounding box and embedding."""
    tag_entry_id = f"ptag_{uuid.uuid4().hex[:12]}"

    box_x, box_y, box_w, box_h = box if box else (None, None, None, None)

    query = """
        INSERT INTO photo_ai_tags (id, photo_id, tag_id, box_x, box_y, box_w, box_h, embedding, confidence, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT DO NOTHING
    """
    await db.execute(
        query, tag_entry_id, photo_id, tag_id,
        box_x, box_y, box_w, box_h, embedding, confidence
    )

    return tag_entry_id


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
