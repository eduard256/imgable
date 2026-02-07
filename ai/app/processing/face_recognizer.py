"""
Face recognition using ArcFace model.
Extracts face embeddings for matching and clustering.
"""

import numpy as np
import cv2
from typing import List, Optional
import logging

from app.models import model_manager
from app.processing.face_detector import DetectedFace
from app.config import get_settings

logger = logging.getLogger(__name__)


# Standard face alignment template for 112x112 output
ARCFACE_DST = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041]
], dtype=np.float32)


class FaceRecognizer:
    """
    Face recognition using ArcFace R100.
    Extracts 512-dimensional embeddings for face matching.
    """

    def __init__(self):
        self._settings = get_settings()
        self._input_size = (112, 112)

    def _align_face(self, image: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """
        Align face using 5-point landmarks.
        Applies affine transformation to normalize face position.
        """
        # Estimate affine transformation
        src = landmarks.astype(np.float32)
        dst = ARCFACE_DST

        # Use similarity transform (preserves aspect ratio)
        tform = cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)[0]

        if tform is None:
            # Fallback: simple crop and resize
            x1 = int(max(0, landmarks[:, 0].min() - 20))
            y1 = int(max(0, landmarks[:, 1].min() - 20))
            x2 = int(min(image.shape[1], landmarks[:, 0].max() + 20))
            y2 = int(min(image.shape[0], landmarks[:, 1].max() + 20))
            face = image[y1:y2, x1:x2]
            return cv2.resize(face, self._input_size)

        # Apply transformation
        aligned = cv2.warpAffine(
            image, tform,
            self._input_size,
            borderValue=(0, 0, 0)
        )

        return aligned

    def _preprocess(self, face: np.ndarray) -> np.ndarray:
        """Preprocess aligned face for inference."""
        # Convert BGR to RGB
        face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)

        # Normalize to [-1, 1]
        face = (face.astype(np.float32) - 127.5) / 127.5

        # CHW format
        face = face.transpose(2, 0, 1)

        # Add batch dimension
        face = np.expand_dims(face, axis=0)

        return face

    def _normalize_embedding(self, embedding: np.ndarray) -> np.ndarray:
        """L2 normalize embedding."""
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding

    def get_embedding(self, image: np.ndarray, face: DetectedFace) -> np.ndarray:
        """
        Extract embedding for a detected face.

        Args:
            image: Original BGR image
            face: DetectedFace with landmarks

        Returns:
            512-dimensional normalized embedding
        """
        # Align face using landmarks
        aligned = self._align_face(image, face.landmarks)

        # Preprocess
        input_tensor = self._preprocess(aligned)

        # Get model session
        session = model_manager.load("face_recognition")

        # Run inference
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: input_tensor})

        # Get embedding (first output, first batch)
        embedding = outputs[0][0]

        # Normalize
        embedding = self._normalize_embedding(embedding)

        return embedding

    def get_embeddings(
        self,
        image: np.ndarray,
        faces: List[DetectedFace]
    ) -> List[DetectedFace]:
        """
        Extract embeddings for multiple faces.

        Args:
            image: Original BGR image
            faces: List of DetectedFace objects

        Returns:
            Same faces with embeddings filled in
        """
        for face in faces:
            try:
                embedding = self.get_embedding(image, face)
                face.embedding = embedding
            except Exception as e:
                logger.warning(f"Failed to get embedding for face: {e}")
                face.embedding = None

        return faces

    def compare(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """
        Compare two face embeddings.

        Returns:
            Cosine similarity (0-1, higher = more similar)
        """
        return float(np.dot(embedding1, embedding2))

    def compare_distance(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """
        Calculate distance between two face embeddings.

        Returns:
            Cosine distance (0-1, lower = more similar)
        """
        return 1.0 - self.compare(embedding1, embedding2)


# Global face recognizer instance
face_recognizer = FaceRecognizer()
