"""
OCR processing for date extraction from photos.
Uses RapidOCR for text recognition.
"""

import re
from datetime import datetime, date
from typing import Optional, Tuple, List
from dataclasses import dataclass
import logging

import numpy as np
import cv2

from app.config import get_settings

logger = logging.getLogger(__name__)


# Date patterns commonly found on old photos
DATE_PATTERNS = [
    # European format: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
    (r'(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})', 'dmy4'),
    (r'(\d{1,2})[./\-](\d{1,2})[./\-](\d{2})', 'dmy2'),

    # ISO format: YYYY.MM.DD, YYYY/MM/DD, YYYY-MM-DD
    (r'(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})', 'ymd'),

    # American format: MM/DD/YYYY
    (r'(\d{1,2})/(\d{1,2})/(\d{4})', 'mdy4'),

    # Camera timestamp format: 'YY MM DD or similar
    (r"['\"]?(\d{2})[./\-\s](\d{1,2})[./\-\s](\d{1,2})", 'ymd_short'),

    # Month name formats: Aug 15 '95, 15 Aug 1995
    (r'([A-Za-z]{3})\s+(\d{1,2})[,\s]+[\'"]?(\d{2,4})', 'mdy_name'),
    (r'(\d{1,2})\s+([A-Za-z]{3})[,\s]+[\'"]?(\d{2,4})', 'dmy_name'),
]

MONTH_NAMES = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'may': 5, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
}


@dataclass
class OCRResult:
    """OCR processing result."""
    text: Optional[str]
    detected_date: Optional[date]


class OCRProcessor:
    """
    OCR processor for extracting text and dates from photos.
    Optimized for date stamps on old photos.
    """

    def __init__(self):
        self._settings = get_settings()
        self._ocr = None

    def _get_ocr(self):
        """Lazy initialization of RapidOCR."""
        if self._ocr is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
                self._ocr = RapidOCR()
                logger.info("RapidOCR initialized")
            except ImportError:
                logger.warning("RapidOCR not available, OCR disabled")
                return None
        return self._ocr

    def _extract_corners(self, image: np.ndarray) -> np.ndarray:
        """
        Extract 4 corners of the image and combine into a single image.

        Date stamps on old photos are typically located in corners:
        - Bottom right: ~70-75% of cases
        - Top right: ~15-20%
        - Bottom left: ~5-8%
        - Top left: rare, but included for completeness

        Corners are combined into a 2x2 grid for a single OCR pass.
        This covers ~95% of date stamp locations while scanning only ~15% of pixels.
        """
        h, w = image.shape[:2]

        # Corner dimensions: 25% width, 15% height
        corner_w = int(w * 0.25)
        corner_h = int(h * 0.15)

        # Extract 4 corners (slices are views, no copy)
        top_left = image[:corner_h, :corner_w]
        top_right = image[:corner_h, -corner_w:]
        bottom_left = image[-corner_h:, :corner_w]
        bottom_right = image[-corner_h:, -corner_w:]

        # Combine into 2x2 grid
        top_row = np.hstack([top_left, top_right])
        bottom_row = np.hstack([bottom_left, bottom_right])
        combined = np.vstack([top_row, bottom_row])

        return combined

    def _parse_date(self, text: str) -> Optional[date]:
        """Try to parse a date from text."""
        text = text.upper().strip()

        for pattern, format_type in DATE_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if not match:
                continue

            try:
                groups = match.groups()

                if format_type == 'dmy4':
                    d, m, y = int(groups[0]), int(groups[1]), int(groups[2])
                elif format_type == 'dmy2':
                    d, m, y = int(groups[0]), int(groups[1]), int(groups[2])
                    y = 1900 + y if y > 50 else 2000 + y
                elif format_type == 'ymd':
                    y, m, d = int(groups[0]), int(groups[1]), int(groups[2])
                elif format_type == 'mdy4':
                    m, d, y = int(groups[0]), int(groups[1]), int(groups[2])
                elif format_type == 'ymd_short':
                    y, m, d = int(groups[0]), int(groups[1]), int(groups[2])
                    y = 1900 + y if y > 50 else 2000 + y
                elif format_type == 'mdy_name':
                    month_str = groups[0].lower()[:3]
                    m = MONTH_NAMES.get(month_str)
                    if not m:
                        continue
                    d = int(groups[1])
                    y = int(groups[2])
                    if y < 100:
                        y = 1900 + y if y > 50 else 2000 + y
                elif format_type == 'dmy_name':
                    d = int(groups[0])
                    month_str = groups[1].lower()[:3]
                    m = MONTH_NAMES.get(month_str)
                    if not m:
                        continue
                    y = int(groups[2])
                    if y < 100:
                        y = 1900 + y if y > 50 else 2000 + y
                else:
                    continue

                # Validate date
                if 1 <= d <= 31 and 1 <= m <= 12 and 1900 <= y <= 2100:
                    return date(y, m, d)

            except (ValueError, IndexError):
                continue

        return None

    def process(self, image: np.ndarray) -> OCRResult:
        """
        Process image for text and date extraction.

        Args:
            image: BGR image as numpy array

        Returns:
            OCRResult with extracted text and date
        """
        mode = self._settings.ai_ocr_mode

        if mode == "off" or not self._settings.ai_ocr_enabled:
            return OCRResult(text=None, detected_date=None)

        ocr = self._get_ocr()
        if ocr is None:
            return OCRResult(text=None, detected_date=None)

        try:
            # Determine region to scan
            if mode == "auto":
                # Scan 4 corners combined into single image for date stamps
                region = self._extract_corners(image)
            else:
                # Full image scan
                region = image

            # Run OCR
            result, _ = ocr(region)

            if not result:
                return OCRResult(text=None, detected_date=None)

            # Extract text
            texts = []
            for line in result:
                if len(line) >= 2:
                    text = line[1]
                    confidence = line[2] if len(line) > 2 else 1.0

                    if confidence >= self._settings.ai_ocr_min_confidence:
                        texts.append(text)

            if not texts:
                return OCRResult(text=None, detected_date=None)

            combined_text = " ".join(texts)

            # Try to find date
            detected_date = None
            for text in texts:
                detected_date = self._parse_date(text)
                if detected_date:
                    break

            # If not found in individual lines, try combined
            if not detected_date:
                detected_date = self._parse_date(combined_text)

            # For auto mode, only return date (not full text)
            if mode == "auto":
                return OCRResult(
                    text=None,
                    detected_date=detected_date
                )

            return OCRResult(
                text=combined_text if combined_text else None,
                detected_date=detected_date
            )

        except Exception as e:
            logger.warning(f"OCR processing failed: {e}")
            return OCRResult(text=None, detected_date=None)


# Global OCR processor instance
ocr_processor = OCRProcessor()
