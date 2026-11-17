"""Unit tests for ``dates.py``: day-first dates, Excel serials, two-digit years, FY labels.

Covers Requirements 7.7 (date parsing) and 7.9 and 12.2 (Fiscal_Year_Window).
"""

from __future__ import annotations

import datetime as dt

import pytest

from services.extractor.dates import (
    FiscalWindow,
    from_excel_serial,
    parse_date_text,
    parse_fy_label,
    parse_period_text,
)
from services.extractor.tests.factories import DATE_STYLES, render_date

d = dt.date


# ---------------------------------------------------------------------------
# parse_fy_label and FiscalWindow
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label",
    [
        "FY2025-26",
        "2025-26",
        "FY 2025-2026",
        "FY25-26",
        "fy2025-26",
        "FY2025\u201326",  # en dash
        "2025/26",
        "FY 2025 - 26",
        "Compliance year 2025-26",
    ],
)
def test_parse_fy_label_accepts_all_forms(label: str) -> None:
    window = parse_fy_label(label)
    assert window is not None
    assert window.start_year == 2025


@pytest.mark.parametrize(
    "label",
    [None, "", "   ", "hello", "FY2025", "2025", "2025-27", "FY25-27", "FY2025-24", "25-26"],
)
def test_parse_fy_label_rejects(label: str | None) -> None:
    assert parse_fy_label(label) is None


def test_parse_fy_label_century_rollover() -> None:
    window = parse_fy_label("FY2099-00")
    assert window is not None
    assert window.start_year == 2099


def test_fiscal_window_bounds_cover_april_to_march() -> None:
    window = FiscalWindow(2023)
    assert window.start == d(2023, 4, 1)
    assert window.end == d(2024, 3, 31)


def test_fiscal_window_end_in_a_leap_year_is_still_31_march() -> None:
    assert FiscalWindow(2023).end == d(2024, 3, 31)
    assert FiscalWindow(2024).end == d(2025, 3, 31)


@pytest.mark.parametrize(
    ("day", "inside"),
    [
        (d(2023, 4, 1), True),
        (d(2023, 12, 31), True),
        (d(2024, 2, 29), True),
        (d(2024, 3, 31), True),
        (d(2023, 3, 31), False),
        (d(2024, 4, 1), False),
    ],
)
def test_fiscal_window_contains_boundaries(day: dt.date, inside: bool) -> None:
    assert FiscalWindow(2023).contains(day) is inside


def test_fiscal_window_contains_accepts_datetime() -> None:
    window = FiscalWindow(2023)
    assert window.contains(dt.datetime(2024, 3, 31, 23, 59))
    assert not window.contains(dt.datetime(2024, 4, 1, 0, 0))


# ---------------------------------------------------------------------------
# parse_date_text
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("05/11/2023", d(2023, 11, 5)),  # day first, never 11 May
        ("5/11/2023", d(2023, 11, 5)),
        ("13/05/2023", d(2023, 5, 13)),
        ("05-11-2023", d(2023, 11, 5)),
        ("05.11.2023", d(2023, 11, 5)),
        ("05-11-23", d(2023, 11, 5)),
        ("1-Apr-23", d(2023, 4, 1)),
        ("1-apr-2023", d(2023, 4, 1)),
        ("01 Apr 2023", d(2023, 4, 1)),
        ("1 April 2023", d(2023, 4, 1)),
        ("1st April 2023", d(2023, 4, 1)),
        ("1-Sept-23", d(2023, 9, 1)),
        ("April 1, 2023", d(2023, 4, 1)),
        ("Apr 1 2023", d(2023, 4, 1)),
        ("2023-04-01", d(2023, 4, 1)),
        ("2023/04/01", d(2023, 4, 1)),
        ("2023-4-1", d(2023, 4, 1)),
        ("29/02/2024", d(2024, 2, 29)),
        ("  01/04/2023  ", d(2023, 4, 1)),
    ],
)
def test_parse_date_text_accepts(text: str, expected: dt.date) -> None:
    assert parse_date_text(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("01/04/2023 10:30", d(2023, 4, 1)),
        ("01/04/2023 10:30:15", d(2023, 4, 1)),
        ("2023-04-01T10:30:00", d(2023, 4, 1)),
        ("2023-04-01 10:30:00", d(2023, 4, 1)),
        ("01/04/2023 10:30 PM", d(2023, 4, 1)),
    ],
)
def test_parse_date_text_ignores_time_of_day(text: str, expected: dt.date) -> None:
    assert parse_date_text(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "05/13/2023",  # month first is never guessed
        "12/25/2023",
        "31/04/2023",  # April has 30 days
        "29/02/2023",  # not a leap year
        "00/01/2023",
        "32/01/2023",
        "garbage",
        "",
        "   ",
        "2023",
        "April 2023",
        "1-Foo-23",
    ],
)
def test_parse_date_text_rejects(text: str) -> None:
    assert parse_date_text(text) is None


def test_parse_date_text_non_string_is_none() -> None:
    assert parse_date_text(None) is None  # type: ignore[arg-type]
    assert parse_date_text(45000) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Two-digit years
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "year"),
    [("01-04-00", 2000), ("01-04-23", 2023), ("01-04-99", 2099), ("1-Apr-05", 2005)],
)
def test_two_digit_year_means_2000_to_2099(text: str, year: int) -> None:
    parsed = parse_date_text(text)
    assert parsed is not None
    assert parsed.year == year


def test_four_digit_year_is_taken_as_written() -> None:
    assert parse_date_text("01/04/1999") == d(1999, 4, 1)


@pytest.mark.parametrize("style", DATE_STYLES)
@pytest.mark.parametrize("day", [d(2000, 1, 1), d(2023, 4, 30), d(2024, 2, 29), d(2099, 12, 31)])
def test_every_rendering_style_round_trips(day: dt.date, style: str) -> None:
    assert parse_date_text(render_date(day, style)) == day


# ---------------------------------------------------------------------------
# from_excel_serial
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("serial", "expected"),
    [
        (1, d(1900, 1, 1)),
        (59, d(1900, 2, 28)),
        (61, d(1900, 3, 1)),  # the missing 29 February 1900 is skipped
        (36526, d(2000, 1, 1)),
        (44927, d(2023, 1, 1)),
        (45000, d(2023, 3, 15)),
        (45017, d(2023, 4, 1)),
        (45382, d(2024, 3, 31)),
        (2958465, d(9999, 12, 31)),
    ],
)
def test_from_excel_serial_1900(serial: int, expected: dt.date) -> None:
    assert from_excel_serial(serial) == expected


def test_from_excel_serial_drops_fraction() -> None:
    assert from_excel_serial(44927.75) == d(2023, 1, 1)
    assert from_excel_serial(44927.999) == d(2023, 1, 1)


def test_from_excel_serial_float_equals_int() -> None:
    assert from_excel_serial(45017.0) == from_excel_serial(45017)


def test_from_excel_serial_60_is_the_nonexistent_leap_day() -> None:
    assert from_excel_serial(60) is None


@pytest.mark.parametrize(
    "serial",
    [0, -1, -45000, 0.5, 2958466, 1e12, float("nan"), float("inf"), float("-inf")],
)
def test_from_excel_serial_out_of_range_is_none(serial: float) -> None:
    assert from_excel_serial(serial) is None


@pytest.mark.parametrize("value", [None, "45000", True, False, [45000]])
def test_from_excel_serial_non_numbers_are_none(value: object) -> None:
    assert from_excel_serial(value) is None  # type: ignore[arg-type]


def test_from_excel_serial_1904_epoch() -> None:
    assert from_excel_serial(1, 1904) == d(1904, 1, 2)
    # The same date is 1462 days lower in the 1904 system.
    assert from_excel_serial(44927 - 1462, 1904) == from_excel_serial(44927, 1900)
    assert from_excel_serial(43465, 1904) == d(2023, 1, 1)


def test_from_excel_serial_1904_overflow_is_none() -> None:
    assert from_excel_serial(2958465, 1904) is None


# ---------------------------------------------------------------------------
# parse_period_text
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "month_key"),
    [
        ("Nov 2023", "2023-11"),
        ("November 2023", "2023-11"),
        ("Apr-23", "2023-04"),
        ("Apr 23", "2023-04"),
        ("Sept 2023", "2023-09"),
        ("2023-11", "2023-11"),
        ("11/2023", "2023-11"),
        ("Mar-24", "2024-03"),
    ],
)
def test_parse_period_text_month_with_year(text: str, month_key: str) -> None:
    period = parse_period_text(text, None)
    assert period is not None
    assert period.kind == "monthly"
    assert period.month_key == month_key
    assert period.date is None


@pytest.mark.parametrize(
    ("text", "month_key"),
    [
        ("April", "2023-04"),
        ("Apr", "2023-04"),
        ("May", "2023-05"),
        ("December", "2023-12"),
        ("Jan", "2024-01"),
        ("Mar", "2024-03"),
        ("march", "2024-03"),
    ],
)
def test_parse_period_text_month_alone_uses_the_fiscal_year(text: str, month_key: str) -> None:
    period = parse_period_text(text, FiscalWindow(2023))
    assert period is not None
    assert period.kind == "monthly"
    assert period.month_key == month_key


def test_parse_period_text_month_alone_without_fiscal_year_is_none() -> None:
    assert parse_period_text("April", None) is None


def test_parse_period_text_single_date_is_daily() -> None:
    period = parse_period_text("05/04/2023", None)
    assert period is not None
    assert period.kind == "daily"
    assert period.month_key == "2023-04"
    assert period.date == d(2023, 4, 5)


def test_parse_period_text_date_range_of_one_month_is_monthly() -> None:
    for text in (
        "01/04/2023 to 30/04/2023",
        "01/04/2023 - 30/04/2023",
        "01/04/2023 \u2013 30/04/2023",
    ):
        period = parse_period_text(text, None)
        assert period is not None, text
        assert period.kind == "monthly"
        assert period.month_key == "2023-04"


def test_parse_period_text_leap_february_range() -> None:
    period = parse_period_text("01/02/2024 to 29/02/2024", None)
    assert period is not None
    assert period.kind == "monthly"
    assert period.month_key == "2024-02"


def test_parse_period_text_range_of_one_day_is_daily() -> None:
    period = parse_period_text("05/04/2023 to 05/04/2023", None)
    assert period is not None
    assert period.kind == "daily"
    assert period.date == d(2023, 4, 5)


@pytest.mark.parametrize(
    "text",
    [
        "01/04/2023 to 15/04/2023",  # part of a month
        "01/04/2023 to 31/05/2023",  # more than one month
        "30/04/2023 to 01/04/2023",  # reversed
        "02/04/2023 to 30/04/2023",  # does not start on the 1st
    ],
)
def test_parse_period_text_range_that_is_not_one_month_is_none(text: str) -> None:
    assert parse_period_text(text, None) is None


@pytest.mark.parametrize("text", ["annual", "Annual", "yearly", "FY2023-24", "2023-24", "FY23-24"])
def test_parse_period_text_annual(text: str) -> None:
    period = parse_period_text(text, None)
    assert period is not None
    assert period.kind == "annual"
    assert period.month_key == "annual"
    assert period.date is None


@pytest.mark.parametrize("text", ["", "   ", "garbage", "Smarch 2023", "13/2023", "2023-13"])
def test_parse_period_text_unplaceable_is_none(text: str) -> None:
    assert parse_period_text(text, FiscalWindow(2023)) is None


def test_parse_period_text_non_string_is_none() -> None:
    assert parse_period_text(None, None) is None  # type: ignore[arg-type]
