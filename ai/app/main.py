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
from app.models import model_manager
from app.processing import worker


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

    # Preload models if enabled
    if settings.ai_model_preload:
        logger.info("Preloading models...")
        model_manager.preload_all()
        logger.info("Models preloaded")

    # Auto-start worker if enabled
    if settings.ai_auto_start:
        logger.info("Auto-starting AI worker...")
        asyncio.create_task(worker.run())

    # Start periodic tasks
    if settings.ai_scan_interval > 0:
        asyncio.create_task(periodic_scan(settings.ai_scan_interval))

    if settings.ai_model_ttl > 0:
        asyncio.create_task(periodic_model_cleanup(settings.ai_model_ttl))

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


async def periodic_model_cleanup(ttl: int):
    """Periodically unload expired models."""
    logger = structlog.get_logger()
    while True:
        await asyncio.sleep(ttl // 2)  # Check at half TTL interval
        unloaded = model_manager.unload_expired()
        if unloaded > 0:
            logger.info(f"Unloaded {unloaded} expired models")


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
