"""Tests for OCR date parsing."""

import pytest
from datetime import date

# Import the parse function directly for testing
import sys
sys.path.insert(0, '/home/user/imgable/ai')

from app.processing.ocr import OCRProcessor


class TestDateParsing:
    """Test date parsing from OCR text."""

    def setup_method(self):
        self.processor = OCRProcessor()

    def test_european_format_full_year(self):
        """Test DD.MM.YYYY format."""
        assert self.processor._parse_date("15.08.1995") == date(1995, 8, 15)
        assert self.processor._parse_date("01/12/2020") == date(2020, 12, 1)
        assert self.processor._parse_date("31-01-1999") == date(1999, 1, 31)

    def test_european_format_short_year(self):
        """Test DD.MM.YY format."""
        assert self.processor._parse_date("15.08.95") == date(1995, 8, 15)
        assert self.processor._parse_date("01/12/20") == date(2020, 12, 1)
        assert self.processor._parse_date("31-01-05") == date(2005, 1, 31)

    def test_iso_format(self):
        """Test YYYY.MM.DD format."""
        assert self.processor._parse_date("1995.08.15") == date(1995, 8, 15)
        assert self.processor._parse_date("2020/12/01") == date(2020, 12, 1)
        assert self.processor._parse_date("1999-01-31") == date(1999, 1, 31)

    def test_month_name_format(self):
        """Test formats with month names."""
        assert self.processor._parse_date("Aug 15 '95") == date(1995, 8, 15)
        assert self.processor._parse_date("DEC 25, 2020") == date(2020, 12, 25)
        assert self.processor._parse_date("15 Jan 1999") == date(1999, 1, 15)

    def test_with_surrounding_text(self):
        """Test date extraction from text with other content."""
        assert self.processor._parse_date("Photo taken 15.08.1995 at beach") == date(1995, 8, 15)
        assert self.processor._parse_date("timestamp: 2020/12/01") == date(2020, 12, 1)

    def test_invalid_dates(self):
        """Test that invalid dates return None."""
        assert self.processor._parse_date("32.13.2020") is None
        assert self.processor._parse_date("no date here") is None
        assert self.processor._parse_date("") is None

    def test_edge_cases(self):
        """Test edge cases."""
        # Single digit day/month
        assert self.processor._parse_date("1.8.1995") == date(1995, 8, 1)
        # Year boundary
        assert self.processor._parse_date("01.01.2000") == date(2000, 1, 1)
        assert self.processor._parse_date("31.12.1999") == date(1999, 12, 31)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
