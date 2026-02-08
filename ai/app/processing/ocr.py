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
# Ordered by specificity: more specific patterns first to avoid false matches
DATE_PATTERNS = [
    # === 4-digit year formats (most reliable) ===

    # ISO format: YYYY.MM.DD, YYYY/MM/DD, YYYY-MM-DD (with optional time)
    (r'(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?', 'ymd4'),

    # European/Russian: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, DD'MM'YYYY (with optional time)
    (r'(\d{1,2})[./\-\'\s](\d{1,2})[./\-\'\s](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?', 'dmy4'),

    # American: MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY
    (r'(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})', 'mdy4'),

    # === 2-digit year formats ===

    # YY.MM.DD, YY/MM/DD, YY-MM-DD (camera timestamp style)
    (r"['\"]?(\d{2})[./\-\s](\d{1,2})[./\-\s](\d{1,2})(?:\s+\d{1,2}:\d{2})?", 'ymd2'),

    # DD.MM.YY, DD/MM/YY, DD-MM-YY, DD'MM'YY, DD MM YY (with optional time)
    (r'(\d{1,2})[./\-\'\s](\d{1,2})[./\-\'\s](\d{2})(?:\s+\d{1,2}:\d{2})?', 'dmy2'),

    # === Compact formats (no separators) ===

    # YYYYMMDD (8 digits, ISO compact)
    (r'\b(\d{4})(\d{2})(\d{2})\b', 'ymd4_compact'),

    # DDMMYYYY (8 digits, European compact)
    (r'\b(\d{2})(\d{2})(\d{4})\b', 'dmy4_compact'),

    # DDMMYY (6 digits)
    (r'\b(\d{2})(\d{2})(\d{2})\b', 'dmy2_compact'),

    # === Text formats with month names ===

    # Full month name: 31 December 1999, December 31, 1999
    (r'(\d{1,2})\s+([A-Za-z]+)[,\s]+[\'"]?(\d{2,4})', 'dmy_name_full'),
    (r'([A-Za-z]+)\s+(\d{1,2})[,\s]+[\'"]?(\d{2,4})', 'mdy_name_full'),

    # Short month: 31 Dec 99, Dec 31 '99
    (r'(\d{1,2})\s+([A-Za-z]{3})[,\s]+[\'"]?(\d{2,4})', 'dmy_name'),
    (r'([A-Za-z]{3})\s+(\d{1,2})[,\s]+[\'"]?(\d{2,4})', 'mdy_name'),
]

# Month name mappings (short and full)
MONTH_NAMES = {
    # Short names
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'may': 5, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    # Full names
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    # Russian month names (transliterated, in case OCR reads them)
    'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4,
    'мая': 5, 'май': 5, 'июн': 6, 'июл': 7, 'авг': 8,
    'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12,
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

    def _fix_ocr_errors(self, text: str) -> str:
        """Fix common OCR misreadings in date strings."""
        # Common OCR errors: O→0, l/I→1, S→5, B→8
        replacements = [
            ('O', '0'), ('o', '0'),
            ('l', '1'), ('I', '1'), ('|', '1'),
            ('S', '5'), ('s', '5'),
            ('B', '8'),
            ('Z', '2'), ('z', '2'),
        ]
        result = text
        for old, new in replacements:
            result = result.replace(old, new)
        return result

    def _convert_year(self, y: int) -> int:
        """Convert 2-digit year to 4-digit year."""
        if y < 100:
            # 00-29 → 2000-2029, 30-99 → 1930-1999
            return 2000 + y if y < 30 else 1900 + y
        return y

    def _parse_date(self, text: str) -> Optional[date]:
        """Try to parse a date from text using multiple patterns."""
        # Try original text first, then OCR-corrected version
        texts_to_try = [text, self._fix_ocr_errors(text)]

        for txt in texts_to_try:
            result = self._try_parse_date(txt)
            if result:
                return result
        return None

    def _try_parse_date(self, text: str) -> Optional[date]:
        """Try to parse a date from text."""
        text = text.strip()

        for pattern, format_type in DATE_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if not match:
                continue

            try:
                groups = match.groups()
                d, m, y = None, None, None

                # === 4-digit year formats ===
                if format_type == 'ymd4':
                    y, m, d = int(groups[0]), int(groups[1]), int(groups[2])

                elif format_type == 'dmy4':
                    d, m, y = int(groups[0]), int(groups[1]), int(groups[2])

                elif format_type == 'mdy4':
                    m, d, y = int(groups[0]), int(groups[1]), int(groups[2])

                # === 2-digit year formats ===
                elif format_type == 'ymd2':
                    y, m, d = int(groups[0]), int(groups[1]), int(groups[2])
                    y = self._convert_year(y)

                elif format_type == 'dmy2':
                    d, m, y = int(groups[0]), int(groups[1]), int(groups[2])
                    y = self._convert_year(y)

                # === Compact formats (no separators) ===
                elif format_type == 'ymd4_compact':
                    y, m, d = int(groups[0]), int(groups[1]), int(groups[2])

                elif format_type == 'dmy4_compact':
                    d, m, y = int(groups[0]), int(groups[1]), int(groups[2])

                elif format_type == 'dmy2_compact':
                    d, m, y = int(groups[0]), int(groups[1]), int(groups[2])
                    y = self._convert_year(y)

                # === Text formats with month names ===
                elif format_type in ('dmy_name', 'dmy_name_full'):
                    d = int(groups[0])
                    month_str = groups[1].lower()
                    m = MONTH_NAMES.get(month_str) or MONTH_NAMES.get(month_str[:3])
                    if not m:
                        continue
                    y = int(groups[2])
                    y = self._convert_year(y)

                elif format_type in ('mdy_name', 'mdy_name_full'):
                    month_str = groups[0].lower()
                    m = MONTH_NAMES.get(month_str) or MONTH_NAMES.get(month_str[:3])
                    if not m:
                        continue
                    d = int(groups[1])
                    y = int(groups[2])
                    y = self._convert_year(y)

                else:
                    continue

                # Validate and create date
                if d and m and y:
                    if 1 <= d <= 31 and 1 <= m <= 12 and 1900 <= y <= 2100:
                        # Use date constructor to validate (handles Feb 30 etc)
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
