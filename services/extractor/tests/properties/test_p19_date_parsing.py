"""Property 19: Date parsing.

For any valid date, its ``DD/MM/YYYY`` text, ``D-Mon-YY`` text and Excel serial number all
parse back to that date, and an all-numeric text whose second field is above 12 and first
is 12 or less returns no date.

Run against the real parsers in ``services.extractor.dates``: ``parse_date_text`` for the
text forms and ``from_excel_serial`` for serial numbers.

**Validates: Requirements 7.7**
"""

from __future__ import annotations

import datetime as dt

from hypothesis import given
from hypothesis import strategies as st

from services.extractor.dates import from_excel_serial, parse_date_text

_MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# The parser reads four-digit years from 1900 to 2999 and two-digit years as 2000 to 2099.
_dates_4digit = st.dates(min_value=dt.date(1900, 1, 1), max_value=dt.date(2999, 12, 31))
_dates_2digit = st.dates(min_value=dt.date(2000, 1, 1), max_value=dt.date(2099, 12, 31))
# Excel serials are only meaningful from 1900-01-01 (serial 1). 9999-12-31 is the maximum.
_dates_excel = st.dates(min_value=dt.date(1900, 1, 1), max_value=dt.date(9999, 12, 31))

_separators = st.sampled_from(["/", "-", "."])


def _serial_1900(d: dt.date) -> int:
    """The Excel 1900-epoch serial of a date, counting Excel's non-existent 29 Feb 1900."""
    if d < dt.date(1900, 3, 1):
        return (d - dt.date(1899, 12, 31)).days
    return (d - dt.date(1899, 12, 30)).days


def _serial_1904(d: dt.date) -> int:
    return (d - dt.date(1904, 1, 1)).days


@given(d=_dates_4digit, sep=_separators, padded=st.booleans())
def test_dd_mm_yyyy_text_parses_back(d: dt.date, sep: str, padded: bool) -> None:
    day, month = (f"{d.day:02d}", f"{d.month:02d}") if padded else (str(d.day), str(d.month))
    assert parse_date_text(f"{day}{sep}{month}{sep}{d.year:04d}") == d


@given(d=_dates_4digit)
def test_canonical_dd_mm_yyyy_text_parses_back(d: dt.date) -> None:
    assert parse_date_text(d.strftime("%d/%m/%Y")) == d


@given(
    d=_dates_2digit,
    sep=st.sampled_from(["-", "/", " ", "."]),
    padded=st.booleans(),
    case=st.sampled_from([str, str.upper, str.lower]),
)
def test_d_mon_yy_text_parses_back(d: dt.date, sep: str, padded: bool, case) -> None:
    day = f"{d.day:02d}" if padded else str(d.day)
    mon = case(_MON[d.month - 1])
    assert parse_date_text(f"{day}{sep}{mon}{sep}{d.year % 100:02d}") == d


@given(d=_dates_excel)
def test_excel_serial_1900_parses_back(d: dt.date) -> None:
    serial = _serial_1900(d)
    # Serial 60 is Excel's missing 29 Feb 1900, which no real date maps to.
    assert serial != 60
    assert from_excel_serial(serial) == d
    # The time of day is dropped, so a fractional serial lands on the same date.
    assert from_excel_serial(serial + 0.75) == d
    assert from_excel_serial(float(serial)) == d


@given(d=st.dates(min_value=dt.date(1904, 1, 2), max_value=dt.date(9999, 12, 31)))
def test_excel_serial_1904_parses_back(d: dt.date) -> None:
    serial = _serial_1904(d)
    result = from_excel_serial(serial, epoch=1904)
    # 1904-epoch serials past the shared maximum are rejected rather than guessed.
    if serial <= 2958465:
        assert result == d
    else:
        assert result is None


@given(
    d=_dates_2digit,
    sep=st.sampled_from(["/", "-"]),
)
def test_text_and_serial_agree(d: dt.date, sep: str) -> None:
    """The same calendar date read from text and from a serial is the same date."""
    text = f"{d.day:02d}{sep}{d.month:02d}{sep}{d.year:04d}"
    assert parse_date_text(text) == from_excel_serial(_serial_1900(d))


@given(
    first=st.integers(min_value=1, max_value=12),
    second=st.integers(min_value=13, max_value=99),
    year=st.integers(min_value=1900, max_value=2999),
    sep=_separators,
    padded=st.booleans(),
    two_digit_year=st.booleans(),
)
def test_month_first_numeric_text_returns_no_date(
    first: int, second: int, year: int, sep: str, padded: bool, two_digit_year: bool
) -> None:
    """``05/13/2023`` is never read month first, so a second field above 12 gives None."""
    a = f"{first:02d}" if padded else str(first)
    b = f"{second:02d}"
    y = f"{year % 100:02d}" if two_digit_year else f"{year:04d}"
    assert parse_date_text(f"{a}{sep}{b}{sep}{y}") is None
