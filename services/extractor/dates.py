"""Date, month and fiscal-year parsing for the Extractor_Service.

Dates are read day first (Indian convention). An all-numeric date such as
``05/13/2023`` is never read month first: it returns ``None``. A two-digit year
means 2000 to 2099. Nothing here guesses; text that does not parse returns ``None``.

``parse_fy_label`` accepts the same forms as ``fiscalStartYear`` in
``backend/domain/calendar/months.ts``: ``FY2025-26``, ``2025-26``, ``FY 2025-2026``
and ``FY25-26``.
"""

from __future__ import annotations

import calendar
import datetime as dt
import math
import re
from dataclasses import dataclass
from typing import Literal

from .models import Period

# ---------------------------------------------------------------------------
# Fiscal year
# ---------------------------------------------------------------------------

_MIN_YEAR = 1900
_MAX_YEAR = 2999


@dataclass(frozen=True)
class FiscalWindow:
    """The compliance year: 1 April of ``start_year`` to 31 March of the next year."""

    start_year: int

    @property
    def start(self) -> dt.date:
        return dt.date(self.start_year, 4, 1)

    @property
    def end(self) -> dt.date:
        return dt.date(self.start_year + 1, 3, 31)

    def contains(self, d: dt.date) -> bool:
        if isinstance(d, dt.datetime):
            d = d.date()
        return self.start <= d <= self.end


# Same pattern as ``fyStartOf`` in backend/domain/packs/emissionBasis.ts.
_FY_LONG_RE = re.compile(r"(?:^|[^\d])(\d{4})\s*[-\u2013/]\s*(\d{4}|\d{2})(?!\d)")
# The short form ``FY25-26`` that ``fiscalStartYear`` tries second.
_FY_SHORT_RE = re.compile(
    r"(?:^|[^\d])FY\s*(\d{2})\s*[-\u2013/]\s*(\d{2})(?!\d)", re.IGNORECASE
)
# A whole string that is only a fiscal-year label (used by parse_period_text).
_FY_WHOLE_RE = re.compile(
    r"(?:F\.?\s*Y\.?\s*)?\d{2,4}\s*[-\u2013/]\s*\d{2,4}", re.IGNORECASE
)


def parse_fy_label(label: str | None) -> FiscalWindow | None:
    """Return the fiscal window for a compliance-year label, or ``None``.

    The end year must be the start year plus one, so ``2025-27`` is rejected.
    """
    if not isinstance(label, str) or not label:
        return None
    start: int | None = None
    m = _FY_LONG_RE.search(label)
    if m:
        first = int(m.group(1))
        end = int(m.group(2)) % 100
        if (first + 1) % 100 == end:
            start = first
    if start is None:
        m = _FY_SHORT_RE.search(label)
        if m:
            first = 2000 + int(m.group(1))
            if (first + 1) % 100 == int(m.group(2)):
                start = first
    if start is None or not (_MIN_YEAR <= start <= _MAX_YEAR):
        return None
    return FiscalWindow(start_year=start)


# ---------------------------------------------------------------------------
# Month names
# ---------------------------------------------------------------------------

_MONTH_NAMES = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)
_MONTHS: dict[str, int] = {}
for _i, _name in enumerate(_MONTH_NAMES, start=1):
    _MONTHS[_name] = _i
    _MONTHS[_name[:3]] = _i
_MONTHS["sept"] = 9


def _month_of(word: str) -> int | None:
    return _MONTHS.get(word.lower().rstrip("."))


def _year_of(text: str) -> int | None:
    """A 4-digit year, or a 2-digit year read as 2000 to 2099."""
    if len(text) == 4:
        year = int(text)
        return year if _MIN_YEAR <= year <= _MAX_YEAR else None
    if len(text) == 2:
        return 2000 + int(text)
    return None


def _make_date(year: int | None, month: int | None, day: int) -> dt.date | None:
    if year is None or month is None:
        return None
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_TIME_TAIL_RE = re.compile(
    r"(?:[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[AaPp][Mm])?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)$"
)
_ISO_RE = re.compile(r"(\d{4})([-/.])(\d{1,2})\2(\d{1,2})")
_NUM_RE = re.compile(r"(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})")
_DMY_TEXT_RE = re.compile(
    r"(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([A-Za-z]{3,9})\.?[\s\-/.,']+(\d{4}|\d{2})"
)
_MDY_TEXT_RE = re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})")


def parse_date_text(text: str) -> dt.date | None:
    """Parse a date written day first, or return ``None``.

    Reads ``DD/MM/YYYY``, ``DD-MM-YY``, ``DD.MM.YYYY``, ``D-Mon-YY``,
    ``D Month YYYY``, ``Month D, YYYY`` and ``YYYY-MM-DD``. A trailing time of day
    is ignored.
    """
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s:
        return None
    s = _TIME_TAIL_RE.sub("", s).strip()

    m = _ISO_RE.fullmatch(s)
    if m:
        return _make_date(_year_of(m.group(1)), int(m.group(3)), int(m.group(4)))

    m = _NUM_RE.fullmatch(s)
    if m:
        return _make_date(_year_of(m.group(4)), int(m.group(3)), int(m.group(1)))

    m = _DMY_TEXT_RE.fullmatch(s)
    if m:
        return _make_date(_year_of(m.group(3)), _month_of(m.group(2)), int(m.group(1)))

    m = _MDY_TEXT_RE.fullmatch(s)
    if m:
        return _make_date(_year_of(m.group(3)), _month_of(m.group(1)), int(m.group(2)))

    return None


_MAX_SERIAL_1900 = 2958465  # 9999-12-31


def from_excel_serial(n: float, epoch: Literal[1900, 1904] = 1900) -> dt.date | None:
    """Convert an Excel serial day number to a date, or return ``None``.

    The 1900 epoch counts the non-existent 29 February 1900, so serials from 61 use
    1899-12-30 as day zero. Serial 60 is that missing day and returns ``None``.
    Serials below 1 and above 2958465 are rejected. The fractional part is dropped.
    """
    if isinstance(n, bool) or not isinstance(n, (int, float)):
        return None
    if isinstance(n, float) and not math.isfinite(n):
        return None
    days = math.floor(n)
    if days < 1 or days > _MAX_SERIAL_1900:
        return None
    try:
        if epoch == 1904:
            return dt.date(1904, 1, 1) + dt.timedelta(days=days)
        if days == 60:
            return None
        if days < 60:
            return dt.date(1899, 12, 31) + dt.timedelta(days=days)
        return dt.date(1899, 12, 30) + dt.timedelta(days=days)
    except OverflowError:
        return None


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

_RANGE_SPLIT_RE = re.compile(r"\s+to\s+|\s*[\u2013\u2014]\s*|\s+-\s+", re.IGNORECASE)
_MONTH_YEAR_RE = re.compile(r"([A-Za-z]{3,9})\.?[\s,'\-/]*(\d{4}|\d{2})")
_MONTH_ONLY_RE = re.compile(r"([A-Za-z]{3,9})\.?")
_ISO_MONTH_RE = re.compile(r"(\d{4})-(\d{2})")
_NUM_MONTH_RE = re.compile(r"(\d{1,2})[/.-](\d{4})")
_ANNUAL_WORDS = frozenset({"annual", "annually", "yearly", "year", "fy", "full year"})


def _monthly(year: int, month: int) -> Period | None:
    if not (_MIN_YEAR <= year <= _MAX_YEAR) or not 1 <= month <= 12:
        return None
    return Period(kind="monthly", month_key=f"{year:04d}-{month:02d}")


def _daily(d: dt.date) -> Period:
    return Period(kind="daily", month_key=d.strftime("%Y-%m"), date=d)


def _range_period(text: str) -> Period | None:
    parts = _RANGE_SPLIT_RE.split(text)
    if len(parts) != 2:
        return None
    first, second = parse_date_text(parts[0]), parse_date_text(parts[1])
    if first is None or second is None or first > second:
        return None
    if first == second:
        return _daily(first)
    last_day = calendar.monthrange(first.year, first.month)[1]
    if (
        first.day == 1
        and second.year == first.year
        and second.month == first.month
        and second.day == last_day
    ):
        return _monthly(first.year, first.month)
    return None


def parse_period_text(text: str, fy: FiscalWindow | None) -> Period | None:
    """Place text on the calendar, or return ``None`` when it cannot be placed.

    Accepted: a month with a year (``Nov 2023``, ``Apr-23``, ``2023-11``), a month
    name alone when ``fy`` is known (April to December take the start year, January
    to March the next), a single date, a date range that covers exactly one calendar
    month, and ``annual`` or a fiscal-year label.
    """
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s:
        return None
    lowered = s.lower()

    if lowered in _ANNUAL_WORDS:
        return Period(kind="annual", month_key="annual")
    iso_month = _ISO_MONTH_RE.fullmatch(s)
    if iso_month and 1 <= int(iso_month.group(2)) <= 12:
        # ``2003-04`` reads as both April 2003 and the bare label of FY2003-04. The
        # calendar template writes months as ``YYYY-MM``, so the month wins. A fiscal
        # year with a prefix (``FY2003-04``) or a four-digit end (``2003-2004``) is
        # still annual. From FY2012-13 on the two forms cannot collide.
        month_period = _monthly(int(iso_month.group(1)), int(iso_month.group(2)))
        if month_period is not None:
            return month_period
    if _FY_WHOLE_RE.fullmatch(s) and parse_fy_label(s) is not None:
        return Period(kind="annual", month_key="annual")

    single = parse_date_text(s)
    if single is not None:
        return _daily(single)

    ranged = _range_period(s)
    if ranged is not None:
        return ranged

    m = _ISO_MONTH_RE.fullmatch(s)
    if m:
        return _monthly(int(m.group(1)), int(m.group(2)))
    m = _NUM_MONTH_RE.fullmatch(s)
    if m:
        return _monthly(int(m.group(2)), int(m.group(1)))

    m = _MONTH_YEAR_RE.fullmatch(s)
    if m:
        month = _month_of(m.group(1))
        year = _year_of(m.group(2))
        if month is not None and year is not None:
            return _monthly(year, month)
        return None

    m = _MONTH_ONLY_RE.fullmatch(s)
    if m and fy is not None:
        month = _month_of(m.group(1))
        if month is not None:
            return _monthly(fy.start_year if month >= 4 else fy.start_year + 1, month)

    return None
