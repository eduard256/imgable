"""
AI Service - Main Application Entry Point

This service provides AI-powered photo analysis including:
- Face detection and recognition
- Object and scene tagging (CLIP)
- OCR for date extraction from old photos
"""

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from app.config import get_settings
from app.db import db
from app.api import router
from app.processing import worker
from app.processing.ocr import ocr_processor
from app.processing.clip_tagger import clip_tagger
from app.models import model_manager


def setup_logging():
    """Configure structured logging."""
    settings = get_settings()

    # Set log level
    log_level = getattr(logging, settings.ai_log_level.upper(), logging.INFO)

    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.dev.ConsoleRenderer() if sys.stderr.isatty() else structlog.processors.JSONRenderer()
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Configure root logger
    logging.basicConfig(
        format="%(message)s",
        level=log_level,
        stream=sys.stdout
    )

    # Reduce noise from libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("onnxruntime").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    settings = get_settings()
    logger = structlog.get_logger()

    # Startup
    logger.info("Starting AI service...")

    # Connect to database
    logger.info("Connecting to database...")
    await db.connect()
    logger.info("Database connected")

    # Auto-start worker if enabled
    if settings.ai_auto_start:
        logger.info("Auto-starting AI worker...")
        asyncio.create_task(worker.run())

    # Start periodic tasks
    if settings.ai_scan_interval > 0:
        asyncio.create_task(periodic_scan(settings.ai_scan_interval))

    if settings.ai_idle_unload_minutes > 0:
        asyncio.create_task(periodic_idle_unload(settings.ai_idle_unload_minutes))

    logger.info("AI service started", port=settings.api_port)

    yield

    # Shutdown
    logger.info("Shutting down AI service...")

    # Stop worker
    await worker.stop()

    # Disconnect database
    await db.disconnect()
    logger.info("AI service stopped")


async def periodic_scan(interval: int):
    """Periodically check for new photos to process."""
    logger = structlog.get_logger()
    while True:
        await asyncio.sleep(interval)

        if worker.status.value == "idle":
            from app.db import get_pending_count
            pending = await get_pending_count()

            if pending > 0:
                logger.info(f"Found {pending} pending photos, starting worker")
                asyncio.create_task(worker.run())


async def periodic_idle_unload(idle_minutes: int):
    """
    Periodically check if worker is idle and unload all models.

    Unloads ONNX models, RapidOCR, and CLIP text embeddings cache
    after N minutes of inactivity to minimize memory usage.
    """
    logger = structlog.get_logger()
    idle_seconds = idle_minutes * 60
    check_interval = 60  # Check every minute

    while True:
        await asyncio.sleep(check_interval)

        # Only unload if worker is idle
        if worker.status.value != "idle":
            continue

        # Check if we have any models loaded
        models_info = model_manager.get_info()
        if not models_info["loaded"] and ocr_processor._ocr is None:
            continue  # Nothing to unload

        # Check idle time
        last_activity = worker.last_activity
        if last_activity is None:
            continue  # No activity yet, nothing to unload

        from datetime import datetime
        idle_time = (datetime.now() - last_activity).total_seconds()

        if idle_time >= idle_seconds:
            logger.info(f"Idle for {idle_time:.0f}s (threshold: {idle_seconds}s), unloading all models...")

            # Unload everything
            models_unloaded = model_manager.unload_all()
            ocr_unloaded = ocr_processor.unload()
            clip_tagger.clear_cache()

            logger.info(
                f"Idle unload complete: {models_unloaded} ONNX models, "
                f"OCR={'yes' if ocr_unloaded else 'no'}, CLIP cache cleared"
            )


# Setup logging
setup_logging()

# Create FastAPI app
app = FastAPI(
    title="Imgable AI Service",
    description="AI-powered photo analysis for face recognition, tagging, and OCR",
    version="1.0.0",
    lifespan=lifespan
)

# Include API routes
app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
        log_level=settings.ai_log_level.lower()
    )
