"""Builders and Hypothesis strategies for the Extractor_Service tests.

Spreadsheet fixtures are written with openpyxl and PDF fixtures with reportlab, so the
tests carry no binary files (Requirement 18.2). Every builder returns bytes.
"""

from __future__ import annotations

import io
from collections.abc import Callable, Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import openpyxl
from hypothesis import strategies as st

from services.extractor.models import BEEPATSectorStream
from services.extractor.streams import STREAMS

__all__ = [
    "date_renderings",
    "decimals",
    "fy_labels",
    "image_only_pdf",
    "long_table",
    "multi_page_pdf",
    "number_renderings",
    "periods_in_columns",
    "periods_in_rows",
    "proforma_workbook",
    "render_date",
    "render_number",
    "stream_keys",
    "stream_labels",
    "text_pdf",
    "with_merged_header",
]


# ---------------------------------------------------------------------------
# Spreadsheet builders
# ---------------------------------------------------------------------------


def _save(wb: openpyxl.Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _sheet(title: str) -> tuple[openpyxl.Workbook, Any]:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = title
    return wb, ws


def proforma_workbook(
    rows: Sequence[tuple[Any, ...]],
    *,
    sheet: str = "Form-Sb",
    title: str | None = None,
    row_offset: int = 0,
    col_offset: int = 0,
    baseline_current: bool = False,
    current_first: bool = False,
    gap_rows: int = 0,
) -> bytes:
    """A pro forma: labels in one column, values to the right.

    ``rows`` holds ``(label, value)`` pairs. With ``baseline_current`` each row is
    ``(label, baseline, current)`` and a header row names the two year columns, with
    ``current_first`` putting the Current column left of Baseline. ``row_offset`` and
    ``col_offset`` shift the whole block, so a test can move the table and expect the same
    readings (Requirement 6.1). A value that is a string starting with ``=`` is written as a
    formula and has no cached value. ``gap_rows`` leaves blank rows between data rows.
    """
    wb, ws = _sheet(sheet)
    r = 1 + row_offset
    c0 = 1 + col_offset
    if title:
        ws.cell(row=r, column=c0, value=title)
        r += 2
    if baseline_current:
        heads = ["Baseline Year", "Current Year"]
        if current_first:
            heads.reverse()
        ws.cell(row=r, column=c0, value="Particulars")
        for i, h in enumerate(heads, start=1):
            ws.cell(row=r, column=c0 + i, value=h)
        r += 1
    for row in rows:
        label, *values = row
        if baseline_current and current_first and len(values) == 2:
            values = [values[1], values[0]]
        ws.cell(row=r, column=c0, value=label)
        for i, v in enumerate(values, start=1):
            ws.cell(row=r, column=c0 + i, value=v)
        r += 1 + gap_rows
    return _save(wb)


def long_table(
    records: Sequence[tuple[Any, ...]],
    *,
    sheet: str = "Calendar",
    headers: Sequence[str] = ("Month", "Stream", "Value", "Unit"),
    title: str | None = None,
    leading_rows: Sequence[Sequence[Any]] = (),
) -> bytes:
    """The ``long`` layout: one row per (period, stream, value, unit).

    ``leading_rows`` are written above the header (decoy rows for header scoring) and
    ``title`` is written above them.
    """
    wb, ws = _sheet(sheet)
    if title:
        ws.append([title])
    for decoy in leading_rows:
        ws.append(list(decoy))
    ws.append(list(headers))
    for rec in records:
        ws.append(list(rec))
    return _save(wb)


def periods_in_columns(
    periods: Sequence[Any],
    series: Sequence[tuple[str, Sequence[Any]]],
    *,
    sheet: str = "Data",
    first_header: str = "Stream",
    title: str | None = None,
    unit_column: bool = False,
    units: Sequence[str | None] | None = None,
    total_column: bool = False,
    total_row: bool = False,
) -> bytes:
    """Periods (dates or months) across the top, one stream per row.

    ``series`` is ``(label, values)``. With ``unit_column`` a Unit column follows the label
    and takes its text from ``units``. ``total_column`` and ``total_row`` add a Total column
    and a Total row, which the Tabular_Parser must skip.
    """
    wb, ws = _sheet(sheet)
    if title:
        ws.append([title])
    header: list[Any] = [first_header]
    if unit_column:
        header.append("Unit")
    header.extend(periods)
    if total_column:
        header.append("Total")
    ws.append(header)
    for i, (label, values) in enumerate(series):
        row: list[Any] = [label]
        if unit_column:
            row.append(units[i] if units else None)
        row.extend(values)
        if total_column:
            row.append(sum(v for v in values if isinstance(v, (int, float, Decimal))))
        ws.append(row)
    if total_row:
        width = len(periods)
        sums = [
            sum(
                v
                for _, values in series
                for v in [values[j]]
                if isinstance(v, (int, float, Decimal))
            )
            for j in range(width)
        ]
        ws.append(["Total", *([None] if unit_column else []), *sums])
    return _save(wb)


def periods_in_rows(
    periods: Sequence[Any],
    columns: Sequence[tuple[str, Sequence[Any]]],
    *,
    sheet: str = "Log",
    period_header: str = "Date",
    title: str | None = None,
    total_row: bool = False,
) -> bytes:
    """Periods down the rows, one stream per column (a plant log).

    ``columns`` is ``(header, values)``, where a header may carry a unit such as
    ``"Coal Consumed (t)"``. ``total_row`` adds a Total row, which the parser must skip.
    The Tabular_Parser scores a header row on recognized labels and needs at least two
    stream columns to detect this layout.
    """
    wb, ws = _sheet(sheet)
    if title:
        ws.append([title])
    ws.append([period_header, *(h for h, _ in columns)])
    for i, p in enumerate(periods):
        ws.append([p, *(values[i] for _, values in columns)])
    if total_row:
        totals = [
            sum(v for v in values if isinstance(v, (int, float, Decimal)))
            for _, values in columns
        ]
        ws.append(["Total", *totals])
    return _save(wb)


def with_merged_header(
    groups: Sequence[tuple[str, Sequence[str]]],
    periods: Sequence[Any],
    values: Sequence[Sequence[Any]],
    *,
    sheet: str = "Data",
    period_header: str = "Month",
) -> bytes:
    """A two-row header whose top row is merged across each group.

    ``groups`` is ``(group title, sub headers)``, for example
    ``("Coal", ["Quantity (t)", "GCV (kcal/kg)"])``. ``values`` has one row per period and
    one value per sub header, in order. The period header is merged down both header rows.
    """
    wb, ws = _sheet(sheet)
    ws.cell(row=1, column=1, value=period_header)
    ws.merge_cells(start_row=1, start_column=1, end_row=2, end_column=1)
    col = 2
    for title, subs in groups:
        ws.cell(row=1, column=col, value=title)
        if len(subs) > 1:
            ws.merge_cells(start_row=1, start_column=col, end_row=1, end_column=col + len(subs) - 1)
        for j, sub in enumerate(subs):
            ws.cell(row=2, column=col + j, value=sub)
        col += len(subs)
    for i, p in enumerate(periods):
        ws.cell(row=3 + i, column=1, value=p)
        for j, v in enumerate(values[i]):
            ws.cell(row=3 + i, column=2 + j, value=v)
    return _save(wb)


# ---------------------------------------------------------------------------
# PDF builders
# ---------------------------------------------------------------------------

_PAGE_W, _PAGE_H = 595.0, 842.0  # A4 in points
_MARGIN = 50.0
_LINE = 14.0


def _draw_page(c: Any, lines: Sequence[str]) -> None:
    c.setFont("Helvetica", 10)
    y = _PAGE_H - _MARGIN
    for line in lines:
        if y < _MARGIN:
            break
        c.drawString(_MARGIN, y, line)
        y -= _LINE


def text_pdf(pages: Sequence[Sequence[str]] | Sequence[str]) -> bytes:
    """A PDF with a text layer.

    ``pages`` is a list of pages, each a list of lines. A flat list of strings is one page.
    Lines are drawn top down from the top-left corner, so the text layer holds one word run
    per line.
    """
    from reportlab.pdfgen import canvas

    page_list: list[Sequence[str]]
    if pages and all(isinstance(p, str) for p in pages):
        page_list = [list(pages)]  # type: ignore[arg-type]
    else:
        page_list = [list(p) for p in pages]  # type: ignore[union-attr]
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(_PAGE_W, _PAGE_H), invariant=1)
    for lines in page_list or [[]]:
        _draw_page(c, lines)
        c.showPage()
    c.save()
    return buf.getvalue()


def multi_page_pdf(
    page_count: int, line_for: Callable[[int, int], str] | None = None, lines_per_page: int = 3
) -> bytes:
    """A text PDF of ``page_count`` pages.

    ``line_for(page, line)`` gives the text of each line (1-based). The default writes
    ``"Page 3 line 2"``, which is unique per page, so a test can tell pages apart.
    """
    make = line_for or (lambda p, i: f"Page {p} line {i}")
    return text_pdf(
        [[make(p, i) for i in range(1, lines_per_page + 1)] for p in range(1, page_count + 1)]
    )


def image_only_pdf(page_count: int = 1) -> bytes:
    """A PDF whose pages hold only a raster image, so there is no text layer."""
    from PIL import Image
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    img = Image.new("RGB", (200, 100), (230, 230, 230))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(_PAGE_W, _PAGE_H), invariant=1)
    for _ in range(max(1, page_count)):
        c.drawImage(ImageReader(img), _MARGIN, _PAGE_H - 200, width=400, height=200)
        c.showPage()
    c.save()
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Hypothesis strategies
# ---------------------------------------------------------------------------

_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_MONTH_FULL = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


@st.composite
def decimals(
    draw: st.DrawFn, *, max_int_digits: int = 9, max_places: int = 3, positive: bool = True
) -> Decimal:
    """An exact ``Decimal`` with a bounded integer part and up to ``max_places`` decimals.

    Positive and non-zero by default, so a reading is never confused with an absent value.
    """
    int_part = draw(st.integers(min_value=0, max_value=10**max_int_digits - 1))
    places = draw(st.integers(min_value=0, max_value=max_places))
    frac = draw(st.integers(min_value=0, max_value=10**places - 1)) if places else 0
    text = f"{int_part}.{frac:0{places}d}" if places else str(int_part)
    value = Decimal(text)
    if positive and value == 0:
        value = Decimal(1)
    return value if positive else draw(st.sampled_from([value, -value]))


def _group_western(digits: str) -> str:
    out: list[str] = []
    while len(digits) > 3:
        out.insert(0, digits[-3:])
        digits = digits[:-3]
    out.insert(0, digits)
    return ",".join(out)


def _group_indian(digits: str) -> str:
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    parts: list[str] = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join([*parts, tail])


def render_number(value: Decimal, style: str) -> str:
    """Write ``value`` the way a source document might.

    ``style`` is ``plain`` (1234567.5), ``western`` (1,234,567.5) or ``indian``
    (12,34,567.5). Decimal places of the value are kept exactly.
    """
    sign = "-" if value < 0 else ""
    text = format(abs(value), "f")
    whole, _, frac = text.partition(".")
    if style == "western":
        whole = _group_western(whole)
    elif style == "indian":
        whole = _group_indian(whole)
    elif style != "plain":
        raise ValueError(f"unknown number style: {style}")
    return f"{sign}{whole}.{frac}" if frac else f"{sign}{whole}"


@st.composite
def number_renderings(draw: st.DrawFn, **kwargs: Any) -> tuple[Decimal, str, str]:
    """``(value, text, style)``: a number and one way of writing it."""
    value = draw(decimals(**kwargs))
    style = draw(st.sampled_from(["plain", "western", "indian"]))
    return value, render_number(value, style), style


def render_date(d: date, style: str) -> str:
    """Write ``d`` day first, in a form ``parse_date_text`` reads."""
    if style == "dmy_slash":
        return f"{d.day:02d}/{d.month:02d}/{d.year}"
    if style == "dmy_dash_2":
        return f"{d.day:02d}-{d.month:02d}-{d.year % 100:02d}"
    if style == "d_mon_yy":
        return f"{d.day}-{_MONTH_ABBR[d.month - 1]}-{d.year % 100:02d}"
    if style == "d_month_yyyy":
        return f"{d.day} {_MONTH_FULL[d.month - 1]} {d.year}"
    if style == "iso":
        return d.isoformat()
    raise ValueError(f"unknown date style: {style}")


DATE_STYLES = ("dmy_slash", "dmy_dash_2", "d_mon_yy", "d_month_yyyy", "iso")


def dates(min_year: int = 2000, max_year: int = 2099) -> st.SearchStrategy[date]:
    """Valid calendar dates. The default range keeps two-digit years unambiguous."""
    return st.dates(min_value=date(min_year, 1, 1), max_value=date(max_year, 12, 31))


@st.composite
def date_renderings(draw: st.DrawFn) -> tuple[date, str, str]:
    """``(date, text, style)``: a date and one day-first way of writing it."""
    d = draw(dates())
    style = draw(st.sampled_from(DATE_STYLES))
    return d, render_date(d, style), style


@st.composite
def fy_labels(draw: st.DrawFn) -> tuple[int, str]:
    """``(start_year, label)`` for the forms the Fiscal_Year_Window accepts."""
    start = draw(st.integers(min_value=2000, max_value=2098))
    end = start + 1
    style = draw(st.sampled_from(["fy_short_end", "bare", "fy_long", "fy_short"]))
    label = {
        "fy_short_end": f"FY{start}-{end % 100:02d}",
        "bare": f"{start}-{end % 100:02d}",
        "fy_long": f"FY {start}-{end}",
        "fy_short": f"FY{start % 100:02d}-{end % 100:02d}",
    }[style]
    return start, label


def stream_keys() -> st.SearchStrategy[BEEPATSectorStream]:
    """Any stream of the Stream_Enum."""
    return st.sampled_from(list(BEEPATSectorStream))


@st.composite
def stream_labels(draw: st.DrawFn) -> tuple[BEEPATSectorStream, str]:
    """``(stream, label)``: a label the Rules_Mapper maps through the key rule.

    The label is the stream key written with spaces or underscores and any letter case, so
    it is never ambiguous. For phrase-level labels, draw from ``STREAMS`` directly.
    """
    spec = draw(st.sampled_from(STREAMS))
    text = spec.key.value
    sep = draw(st.sampled_from([" ", "_"]))
    text = text.replace("_", sep)
    case = draw(st.sampled_from(["lower", "upper", "title"]))
    label = {"lower": text.lower(), "upper": text.upper(), "title": text.title()}[case]
    return spec.key, label


def excel_datetime(d: date) -> datetime:
    """The ``datetime`` openpyxl stores for a date cell."""
    return datetime(d.year, d.month, d.day)
