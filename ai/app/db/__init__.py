"""Database module."""

from app.db.database import db, Database
from app.db.queries import (
    get_next_pending_photo,
    mark_queue_done,
    mark_queue_error,
    get_queue_stats,
    get_pending_count,
    reset_stuck_processing,
    get_or_create_person_tag,
    get_or_create_people_tag,
    get_or_create_object_tag,
    get_or_create_scene_tag,
    add_photo_ai_tag,
    update_photo_ai_results,
)

__all__ = [
    "db",
    "Database",
    "get_next_pending_photo",
    "mark_queue_done",
    "mark_queue_error",
    "get_queue_stats",
    "get_pending_count",
    "reset_stuck_processing",
    "get_or_create_person_tag",
    "get_or_create_people_tag",
    "get_or_create_object_tag",
    "get_or_create_scene_tag",
    "add_photo_ai_tag",
    "update_photo_ai_results",
]
