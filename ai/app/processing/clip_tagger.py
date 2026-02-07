"""
CLIP-based image tagging for objects and scenes.
Uses OpenCLIP ViT-B/32 for zero-shot classification.
"""

import numpy as np
import cv2
from typing import List, Tuple, Dict
from dataclasses import dataclass
import logging

from app.models import model_manager
from app.config import get_settings

logger = logging.getLogger(__name__)


# Predefined categories for tagging
OBJECT_CATEGORIES = [
    "car", "dog", "cat", "bird", "horse", "bicycle", "motorcycle",
    "airplane", "boat", "train", "bus", "truck",
    "flower", "tree", "plant",
    "food", "cake", "pizza", "fruit",
    "book", "phone", "computer", "laptop",
    "bottle", "cup", "glass",
    "chair", "table", "bed", "couch",
    "clock", "mirror", "lamp",
    "castle", "church", "bridge", "tower",
    "baby", "child", "group of people"
]

SCENE_CATEGORIES = [
    "beach", "ocean", "sea",
    "mountain", "forest", "park", "garden",
    "city", "street", "building",
    "sunset", "sunrise", "night",
    "snow", "winter", "rain",
    "wedding", "party", "celebration", "birthday",
    "restaurant", "cafe", "kitchen",
    "bedroom", "living room", "office",
    "pool", "lake", "river", "waterfall",
    "desert", "field", "countryside",
    "stadium", "concert", "museum",
    "airport", "train station",
    "christmas", "holiday"
]


@dataclass
class Tag:
    """A detected tag with confidence."""
    name: str
    type: str  # 'object' or 'scene'
    confidence: float


class CLIPTagger:
    """
    Zero-shot image classification using CLIP.
    Tags images with objects and scenes.
    """

    def __init__(self):
        self._settings = get_settings()
        self._input_size = (224, 224)
        self._text_embeddings: Dict[str, np.ndarray] = {}
        self._initialized = False

    def _preprocess_image(self, image: np.ndarray) -> np.ndarray:
        """Preprocess image for CLIP visual encoder."""
        # Resize with center crop
        h, w = image.shape[:2]
        scale = max(self._input_size[0] / h, self._input_size[1] / w)
        new_h, new_w = int(h * scale), int(w * scale)
        resized = cv2.resize(image, (new_w, new_h))

        # Center crop
        start_h = (new_h - self._input_size[0]) // 2
        start_w = (new_w - self._input_size[1]) // 2
        cropped = resized[start_h:start_h + self._input_size[0],
                          start_w:start_w + self._input_size[1]]

        # Convert BGR to RGB
        cropped = cv2.cvtColor(cropped, cv2.COLOR_BGR2RGB)

        # Normalize (ImageNet stats)
        mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
        std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
        cropped = (cropped.astype(np.float32) / 255.0 - mean) / std

        # CHW format
        cropped = cropped.transpose(2, 0, 1)

        # Add batch dimension
        cropped = np.expand_dims(cropped, axis=0).astype(np.float32)

        return cropped

    def _tokenize(self, texts: List[str], context_length: int = 77) -> np.ndarray:
        """Simple tokenizer for CLIP text encoder."""
        # This is a simplified tokenizer. In production, use the proper CLIP tokenizer.
        # For now, we'll use a basic approach that works with most ONNX CLIP models.

        # Start/end tokens
        sot_token = 49406
        eot_token = 49407

        result = np.zeros((len(texts), context_length), dtype=np.int64)

        for i, text in enumerate(texts):
            # Simple character-level encoding (simplified)
            tokens = [sot_token]
            for char in text.lower()[:context_length - 2]:
                # Map ASCII to token IDs (simplified mapping)
                if char.isalpha():
                    tokens.append(ord(char) - ord('a') + 320)
                elif char == ' ':
                    tokens.append(267)
                elif char.isdigit():
                    tokens.append(ord(char) - ord('0') + 273)
            tokens.append(eot_token)

            # Pad to context length
            tokens = tokens[:context_length]
            result[i, :len(tokens)] = tokens

        return result

    def _get_text_embedding(self, text: str) -> np.ndarray:
        """Get CLIP text embedding for a category."""
        if text in self._text_embeddings:
            return self._text_embeddings[text]

        session = model_manager.load("clip_textual")

        # Create prompt
        prompt = f"a photo of {text}"
        tokens = self._tokenize([prompt])

        # Run inference
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: tokens})

        embedding = outputs[0][0]
        # Normalize
        embedding = embedding / np.linalg.norm(embedding)

        self._text_embeddings[text] = embedding
        return embedding

    def _init_text_embeddings(self) -> None:
        """Pre-compute text embeddings for all categories."""
        if self._initialized:
            return

        logger.info("Initializing CLIP text embeddings...")

        for category in OBJECT_CATEGORIES + SCENE_CATEGORIES:
            self._get_text_embedding(category)

        self._initialized = True
        logger.info(f"Initialized {len(self._text_embeddings)} text embeddings")

    def _get_image_embedding(self, image: np.ndarray) -> np.ndarray:
        """Get CLIP visual embedding for an image."""
        input_tensor = self._preprocess_image(image)

        session = model_manager.load("clip_visual")

        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: input_tensor})

        embedding = outputs[0][0]
        # Normalize
        embedding = embedding / np.linalg.norm(embedding)

        return embedding

    def tag(self, image: np.ndarray) -> List[Tag]:
        """
        Tag an image with objects and scenes.

        Args:
            image: BGR image as numpy array

        Returns:
            List of Tag objects above confidence threshold
        """
        if not self._settings.ai_tags_enabled:
            return []

        # Initialize text embeddings if needed
        self._init_text_embeddings()

        min_confidence = self._settings.ai_tags_min_confidence
        max_tags = self._settings.ai_tags_max_per_photo

        # Get image embedding
        image_embedding = self._get_image_embedding(image)

        # Compare with all categories
        tags = []

        # Objects
        for category in OBJECT_CATEGORIES:
            text_embedding = self._text_embeddings[category]
            similarity = float(np.dot(image_embedding, text_embedding))

            if similarity >= min_confidence:
                tags.append(Tag(
                    name=category,
                    type="object",
                    confidence=similarity
                ))

        # Scenes
        for category in SCENE_CATEGORIES:
            text_embedding = self._text_embeddings[category]
            similarity = float(np.dot(image_embedding, text_embedding))

            if similarity >= min_confidence:
                tags.append(Tag(
                    name=category,
                    type="scene",
                    confidence=similarity
                ))

        # Sort by confidence and limit
        tags.sort(key=lambda t: t.confidence, reverse=True)
        tags = tags[:max_tags]

        logger.debug(f"Tagged image with {len(tags)} tags")
        return tags


# Global CLIP tagger instance
clip_tagger = CLIPTagger()
