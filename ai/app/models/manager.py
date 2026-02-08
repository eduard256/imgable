"""
Model manager for loading and caching ONNX models.
Downloads models from HuggingFace Hub if not present locally.
"""

import os
import time
import threading
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass
import logging

import onnxruntime as ort
from huggingface_hub import hf_hub_download

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    """Information about a loaded model."""
    session: ort.InferenceSession
    loaded_at: float
    last_used: float
    size_mb: float


# Model definitions with HuggingFace paths
MODELS = {
    "face_detection": {
        "repo": "public-data/insightface",
        "filename": "models/buffalo_l/det_10g.onnx",
        "local_name": "det_10g.onnx",
        "description": "SCRFD 10G face detection model"
    },
    "face_recognition": {
        "repo": "public-data/insightface",
        "filename": "models/buffalo_l/w600k_r50.onnx",
        "local_name": "w600k_r50.onnx",
        "description": "ArcFace W600K ResNet50 face recognition model"
    },
    "clip_visual": {
        "repo": "Qdrant/clip-ViT-B-32-vision",
        "filename": "model.onnx",
        "local_name": "clip_visual.onnx",
        "description": "CLIP ViT-B/32 visual encoder"
    },
    "clip_textual": {
        "repo": "Qdrant/clip-ViT-B-32-text",
        "filename": "model.onnx",
        "local_name": "clip_textual.onnx",
        "description": "CLIP ViT-B/32 text encoder"
    },
}


class ModelManager:
    """
    Manages ONNX model loading, caching, and lifecycle.
    Models are automatically unloaded after TTL expires.
    """

    def __init__(self):
        self._settings = get_settings()
        self._models: Dict[str, ModelInfo] = {}
        self._lock = threading.Lock()
        self._models_path = Path(self._settings.models_path)
        self._models_path.mkdir(parents=True, exist_ok=True)

        # Configure ONNX Runtime
        self._session_options = ort.SessionOptions()
        self._session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        # Set number of threads
        if self._settings.ai_threads > 0:
            self._session_options.intra_op_num_threads = self._settings.ai_threads
            self._session_options.inter_op_num_threads = 1

        # Execution providers (CPU only for now)
        self._providers = ["CPUExecutionProvider"]

    def _download_model(self, model_name: str) -> Path:
        """Download model from HuggingFace Hub if not present."""
        model_def = MODELS.get(model_name)
        if not model_def:
            raise ValueError(f"Unknown model: {model_name}")

        local_path = self._models_path / model_def["local_name"]

        if local_path.exists():
            logger.debug(f"Model {model_name} already exists at {local_path}")
            return local_path

        logger.info(f"Downloading model {model_name} from {model_def['repo']}...")

        try:
            downloaded_path = hf_hub_download(
                repo_id=model_def["repo"],
                filename=model_def["filename"],
                local_dir=self._models_path,
                local_dir_use_symlinks=False
            )
            # Rename to our local name
            downloaded = Path(downloaded_path)
            if downloaded != local_path:
                downloaded.rename(local_path)

            logger.info(f"Downloaded model {model_name} to {local_path}")
            return local_path

        except Exception as e:
            logger.error(f"Failed to download model {model_name}: {e}")
            raise

    def load(self, model_name: str) -> ort.InferenceSession:
        """Load a model and return its ONNX session."""
        with self._lock:
            # Check if already loaded
            if model_name in self._models:
                self._models[model_name].last_used = time.time()
                return self._models[model_name].session

            # Download if needed
            model_path = self._download_model(model_name)

            # Load ONNX session
            logger.info(f"Loading model {model_name}...")
            session = ort.InferenceSession(
                str(model_path),
                sess_options=self._session_options,
                providers=self._providers
            )

            # Get model size
            size_mb = model_path.stat().st_size / (1024 * 1024)

            now = time.time()
            self._models[model_name] = ModelInfo(
                session=session,
                loaded_at=now,
                last_used=now,
                size_mb=size_mb
            )

            logger.info(f"Loaded model {model_name} ({size_mb:.1f} MB)")
            return session

    def unload(self, model_name: str) -> bool:
        """Unload a model from memory."""
        with self._lock:
            if model_name in self._models:
                del self._models[model_name]
                logger.info(f"Unloaded model {model_name}")
                return True
            return False

    def unload_expired(self) -> int:
        """Unload models that haven't been used within TTL."""
        if self._settings.ai_model_ttl <= 0:
            return 0  # TTL disabled

        now = time.time()
        ttl = self._settings.ai_model_ttl
        unloaded = 0

        with self._lock:
            to_unload = [
                name for name, info in self._models.items()
                if now - info.last_used > ttl
            ]

            for name in to_unload:
                del self._models[name]
                logger.info(f"Unloaded expired model {name}")
                unloaded += 1

        return unloaded

    def get_info(self) -> Dict[str, Any]:
        """Get information about loaded models."""
        with self._lock:
            loaded = []
            total_size = 0

            for name, info in self._models.items():
                loaded.append({
                    "name": name,
                    "description": MODELS.get(name, {}).get("description", ""),
                    "size_mb": round(info.size_mb, 1),
                    "loaded_at": info.loaded_at,
                    "last_used": info.last_used
                })
                total_size += info.size_mb

            return {
                "loaded": loaded,
                "memory_used_mb": round(total_size, 1),
                "ttl_seconds": self._settings.ai_model_ttl
            }

    def preload_all(self) -> None:
        """Preload all models into memory."""
        logger.info("Preloading all models...")
        for model_name in MODELS:
            try:
                self.load(model_name)
            except Exception as e:
                logger.error(f"Failed to preload {model_name}: {e}")

    def is_loaded(self, model_name: str) -> bool:
        """Check if a model is loaded."""
        return model_name in self._models


# Global model manager instance
model_manager = ModelManager()
