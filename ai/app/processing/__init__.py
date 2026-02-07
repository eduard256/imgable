"""Processing module."""

from app.processing.worker import worker, AIWorker, WorkerStatus
from app.processing.face_detector import face_detector, FaceDetector, DetectedFace
from app.processing.face_recognizer import face_recognizer, FaceRecognizer
from app.processing.clip_tagger import clip_tagger, CLIPTagger, Tag
from app.processing.ocr import ocr_processor, OCRProcessor, OCRResult

__all__ = [
    "worker",
    "AIWorker",
    "WorkerStatus",
    "face_detector",
    "FaceDetector",
    "DetectedFace",
    "face_recognizer",
    "FaceRecognizer",
    "clip_tagger",
    "CLIPTagger",
    "Tag",
    "ocr_processor",
    "OCRProcessor",
    "OCRResult",
]
