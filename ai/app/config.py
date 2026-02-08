"""
Configuration module for AI service.
Loads settings from environment variables with sensible defaults.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str = Field(
        default="postgres://imgable:imgable@db:5432/imgable",
        alias="DATABASE_URL"
    )

    # Paths
    media_path: str = Field(default="/media", alias="MEDIA_PATH")
    models_path: str = Field(default="/models", alias="MODELS_PATH")

    # API
    api_port: int = Field(default=8004, alias="API_PORT")
    api_host: str = Field(default="0.0.0.0", alias="API_HOST")

    # Performance
    ai_threads: int = Field(default=0, alias="AI_THREADS")  # 0 = auto
    ai_delay_ms: int = Field(default=100, alias="AI_DELAY_MS")
    ai_batch_size: int = Field(default=1, alias="AI_BATCH_SIZE")
    ai_max_cpu_percent: int = Field(default=0, alias="AI_MAX_CPU_PERCENT")  # 0 = no limit
    ai_idle_only: bool = Field(default=False, alias="AI_IDLE_ONLY")

    # Auto-start
    ai_auto_start: bool = Field(default=True, alias="AI_AUTO_START")
    ai_scan_interval: int = Field(default=3600, alias="AI_SCAN_INTERVAL")  # seconds

    # Face Detection
    ai_faces_enabled: bool = Field(default=True, alias="AI_FACES_ENABLED")
    ai_faces_min_confidence: float = Field(default=0.5, alias="AI_FACES_MIN_CONFIDENCE")
    ai_faces_min_size: int = Field(default=30, alias="AI_FACES_MIN_SIZE")
    ai_faces_max_per_photo: int = Field(default=50, alias="AI_FACES_MAX_PER_PHOTO")

    # Face Clustering
    ai_cluster_threshold: float = Field(default=0.6, alias="AI_CLUSTER_THRESHOLD")
    ai_cluster_min_faces: int = Field(default=3, alias="AI_CLUSTER_MIN_FACES")
    ai_cluster_auto_merge: bool = Field(default=True, alias="AI_CLUSTER_AUTO_MERGE")

    # Tags (Objects/Scenes)
    ai_tags_enabled: bool = Field(default=True, alias="AI_TAGS_ENABLED")
    ai_tags_min_confidence: float = Field(default=0.15, alias="AI_TAGS_MIN_CONFIDENCE")
    ai_tags_max_per_photo: int = Field(default=10, alias="AI_TAGS_MAX_PER_PHOTO")

    # OCR
    ai_ocr_enabled: bool = Field(default=True, alias="AI_OCR_ENABLED")
    ai_ocr_mode: str = Field(default="auto", alias="AI_OCR_MODE")  # auto | full | off
    ai_ocr_min_confidence: float = Field(default=0.7, alias="AI_OCR_MIN_CONFIDENCE")
    ai_ocr_update_taken_at: bool = Field(default=True, alias="AI_OCR_UPDATE_TAKEN_AT")

    # Models
    ai_model_ttl: int = Field(default=1800, alias="AI_MODEL_TTL")  # seconds
    ai_model_preload: bool = Field(default=True, alias="AI_MODEL_PRELOAD")
    ai_model_repo: Optional[str] = Field(default=None, alias="AI_MODEL_REPO")

    # Logging
    ai_log_level: str = Field(default="info", alias="AI_LOG_LEVEL")
    ai_log_each_photo: bool = Field(default=False, alias="AI_LOG_EACH_PHOTO")

    # Retry settings
    ai_max_retries: int = Field(default=3, alias="AI_MAX_RETRIES")

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
