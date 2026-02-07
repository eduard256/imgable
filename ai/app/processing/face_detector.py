"""
Face detection using SCRFD model.
Detects faces and landmarks in images.
"""

import numpy as np
import cv2
from typing import List, Tuple, Optional
from dataclasses import dataclass
import logging

from app.models import model_manager
from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class DetectedFace:
    """A detected face with bounding box and landmarks."""
    box: Tuple[float, float, float, float]  # x, y, w, h (relative 0-1)
    landmarks: np.ndarray  # 5 facial landmarks
    confidence: float
    embedding: Optional[np.ndarray] = None


class FaceDetector:
    """
    Face detection using SCRFD (Sample and Computation Redistribution for Face Detection).
    Optimized for accuracy with the 10G variant.
    """

    def __init__(self):
        self._settings = get_settings()
        self._input_size = (640, 640)
        self._feat_stride_fpn = [8, 16, 32]
        self._num_anchors = 2
        self._fmc = 3

    def _preprocess(self, image: np.ndarray) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """Preprocess image for inference."""
        h, w = image.shape[:2]

        # Calculate scale to fit input size
        scale = min(self._input_size[0] / h, self._input_size[1] / w)
        new_h, new_w = int(h * scale), int(w * scale)

        # Resize image
        resized = cv2.resize(image, (new_w, new_h))

        # Create padded image
        padded = np.zeros((self._input_size[0], self._input_size[1], 3), dtype=np.float32)
        padded[:new_h, :new_w, :] = resized

        # Normalize (mean subtraction and scaling)
        padded = (padded - 127.5) / 128.0

        # CHW format
        padded = padded.transpose(2, 0, 1)

        # Add batch dimension
        padded = np.expand_dims(padded, axis=0).astype(np.float32)

        return padded, scale, (h, w)

    def _generate_anchors(self, height: int, width: int, stride: int) -> np.ndarray:
        """Generate anchor centers for a feature map."""
        anchor_centers = np.stack(
            np.mgrid[:height, :width][::-1], axis=-1
        ).astype(np.float32)
        anchor_centers = (anchor_centers * stride).reshape(-1, 2)
        anchor_centers = np.stack([anchor_centers] * self._num_anchors, axis=1).reshape(-1, 2)
        return anchor_centers

    def _distance2bbox(self, points: np.ndarray, distance: np.ndarray) -> np.ndarray:
        """Convert distances to bounding boxes."""
        x1 = points[:, 0] - distance[:, 0]
        y1 = points[:, 1] - distance[:, 1]
        x2 = points[:, 0] + distance[:, 2]
        y2 = points[:, 1] + distance[:, 3]
        return np.stack([x1, y1, x2, y2], axis=-1)

    def _distance2kps(self, points: np.ndarray, distance: np.ndarray) -> np.ndarray:
        """Convert distances to keypoints."""
        num_points = distance.shape[1] // 2
        kps = np.zeros((distance.shape[0], num_points, 2), dtype=np.float32)
        for i in range(num_points):
            kps[:, i, 0] = points[:, 0] + distance[:, i * 2]
            kps[:, i, 1] = points[:, 1] + distance[:, i * 2 + 1]
        return kps

    def _nms(self, boxes: np.ndarray, scores: np.ndarray, threshold: float = 0.4) -> List[int]:
        """Non-maximum suppression."""
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]

        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)

            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1)
            h = np.maximum(0.0, yy2 - yy1)
            inter = w * h

            iou = inter / (areas[i] + areas[order[1:]] - inter)

            inds = np.where(iou <= threshold)[0]
            order = order[inds + 1]

        return keep

    def detect(self, image: np.ndarray) -> List[DetectedFace]:
        """
        Detect faces in an image.

        Args:
            image: BGR image as numpy array

        Returns:
            List of DetectedFace objects
        """
        if not self._settings.ai_faces_enabled:
            return []

        h, w = image.shape[:2]
        min_confidence = self._settings.ai_faces_min_confidence
        min_size = self._settings.ai_faces_min_size
        max_faces = self._settings.ai_faces_max_per_photo

        # Preprocess
        input_tensor, scale, original_size = self._preprocess(image)

        # Get model session
        session = model_manager.load("face_detection")

        # Run inference
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: input_tensor})

        # Parse outputs
        all_boxes = []
        all_scores = []
        all_kps = []

        for idx, stride in enumerate(self._feat_stride_fpn):
            feat_h = self._input_size[0] // stride
            feat_w = self._input_size[1] // stride

            # Get outputs for this stride
            scores = outputs[idx]
            bbox_preds = outputs[idx + self._fmc]
            kps_preds = outputs[idx + self._fmc * 2]

            # Generate anchors
            anchor_centers = self._generate_anchors(feat_h, feat_w, stride)

            # Reshape outputs
            scores = scores.reshape(-1)
            bbox_preds = bbox_preds.reshape(-1, 4) * stride
            kps_preds = kps_preds.reshape(-1, 10) * stride

            # Filter by score
            pos_inds = np.where(scores >= min_confidence)[0]

            if len(pos_inds) > 0:
                bboxes = self._distance2bbox(anchor_centers[pos_inds], bbox_preds[pos_inds])
                kps = self._distance2kps(anchor_centers[pos_inds], kps_preds[pos_inds])

                all_boxes.append(bboxes)
                all_scores.append(scores[pos_inds])
                all_kps.append(kps)

        if not all_boxes:
            return []

        # Concatenate results
        all_boxes = np.concatenate(all_boxes, axis=0)
        all_scores = np.concatenate(all_scores, axis=0)
        all_kps = np.concatenate(all_kps, axis=0)

        # NMS
        keep = self._nms(all_boxes, all_scores)
        boxes = all_boxes[keep]
        scores = all_scores[keep]
        kps = all_kps[keep]

        # Scale back to original image size
        boxes = boxes / scale
        kps = kps / scale

        # Convert to DetectedFace objects
        faces = []
        for i in range(len(boxes)):
            x1, y1, x2, y2 = boxes[i]
            face_w = x2 - x1
            face_h = y2 - y1

            # Filter by minimum size
            if face_w < min_size or face_h < min_size:
                continue

            # Convert to relative coordinates (0-1)
            rel_x = x1 / w
            rel_y = y1 / h
            rel_w = face_w / w
            rel_h = face_h / h

            faces.append(DetectedFace(
                box=(rel_x, rel_y, rel_w, rel_h),
                landmarks=kps[i],
                confidence=float(scores[i])
            ))

            if len(faces) >= max_faces:
                break

        logger.debug(f"Detected {len(faces)} faces")
        return faces


# Global face detector instance
face_detector = FaceDetector()
