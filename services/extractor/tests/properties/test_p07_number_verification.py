"""Property 7: Number verification across formats.

For any decimal value and any rendering of it as plain, Western-grouped or Indian-grouped
text placed anywhere on a page, ``find_number`` reports found and returns a box inside
``[0, 1]`` that overlaps the placed text. For any decimal that appears in no word of the
page, it reports not found.

**Validates: Requirements 5.2, 5.6, 10.2**

Feature: industrial-extractor, Property 7: Number verification across formats

Two page sources are used. Hand-built ``PageText`` objects put the value at any line and
any position in a line and check the box against the placed word. Real PDFs written with
reportlab and read back with ``open_pdf`` check the same property through the text layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from services.extractor.locate import find_number
from services.extractor.pdf_text import PageText, Word, open_pdf

from ..factories import decimals, render_number, text_pdf

STYLES = ("plain", "western", "indian")
LABELS = ("Coal", "Total", "Kiln", "Quantity", "Remarks", "Net", "Month", "Clinker", "t", "kWh")

_PAGE_W = 2000.0  # wide enough that no hand-built line runs off the page
_PAGE_H = 900.0
_CHAR_W = 6.0
_LINE_H = 14.0

_label = st.sampled_from(LABELS)
_style = st.sampled_from(STYLES)


# ---------------------------------------------------------------------------
# Page construction
# ---------------------------------------------------------------------------


def build_page(lines: list[list[str]]) -> PageText:
    """A ``PageText`` that lays each line's words left to right, one line per row."""
    words: list[Word] = []
    texts: list[str] = []
    for row, line in enumerate(lines):
        top = 20.0 + row * _LINE_H
        x = 10.0
        for text in line:
            width = _CHAR_W * len(text)
            words.append(Word(text, x, top, x + width, top + 10.0, row))
            x += width + _CHAR_W
        texts.append(" ".join(line))
    return PageText(number=1, width=_PAGE_W, height=_PAGE_H, words=words, lines=texts)


def overlaps(page: PageText, bbox: object, word: Word) -> bool:
    """True when the normalized ``bbox`` shares area with ``word`` on ``page``."""
    x0, y0 = bbox.x * page.width, bbox.y * page.height  # type: ignore[attr-defined]
    x1 = x0 + bbox.width * page.width  # type: ignore[attr-defined]
    y1 = y0 + bbox.height * page.height  # type: ignore[attr-defined]
    return x0 < word.x1 and word.x0 < x1 and y0 < word.bottom and word.top < y1


def in_unit_square(bbox: object) -> bool:
    b = bbox  # type: ignore[assignment]
    return (
        0.0 <= b.x <= 1.0  # type: ignore[attr-defined]
        and 0.0 <= b.y <= 1.0  # type: ignore[attr-defined]
        and b.width >= 0.0  # type: ignore[attr-defined]
        and b.height >= 0.0  # type: ignore[attr-defined]
        and b.x + b.width <= 1.0 + 1e-9  # type: ignore[attr-defined]
        and b.y + b.height <= 1.0 + 1e-9  # type: ignore[attr-defined]
    )


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Placement:
    """A target value, how it is written on the page, and where it sits."""

    value: Decimal
    placed_text: str  # how the page writes it
    query_text: str  # how the caller asks for it (may use another style)
    lines: list[list[str]]  # all lines, with the placed word included
    row: int
    col: int


@st.composite
def filler_words(draw: st.DrawFn, target: Decimal) -> list[str]:
    """Words that must not be read as ``target``: labels, other numbers, ID-like tokens."""
    out: list[str] = []
    for _ in range(draw(st.integers(min_value=0, max_value=5))):
        kind = draw(st.sampled_from(["label", "number", "id"]))
        if kind == "label":
            out.append(draw(_label))
            continue
        other = draw(decimals())
        assume(other != target)
        text = render_number(other, draw(_style))
        # An ID that merely contains the digits is not the number itself.
        out.append(text if kind == "number" else f"INV{text}")
    return out


@st.composite
def placements(draw: st.DrawFn) -> Placement:
    value = draw(decimals())
    placed_style, query_style = draw(_style), draw(_style)
    placed = render_number(value, placed_style)
    query = render_number(value, query_style)

    n_lines = draw(st.integers(min_value=1, max_value=25))
    lines = [draw(filler_words(value)) for _ in range(n_lines)]
    row = draw(st.integers(min_value=0, max_value=n_lines - 1))
    col = draw(st.integers(min_value=0, max_value=len(lines[row])))
    lines[row].insert(col, placed)
    return Placement(value, placed, query, lines, row, col)


# ---------------------------------------------------------------------------
# Present values (hand-built pages)
# ---------------------------------------------------------------------------


@settings(max_examples=150, deadline=None)
@given(p=placements())
def test_placed_value_is_found_with_a_box_over_the_placed_word(p: Placement) -> None:
    page = build_page(p.lines)
    placed_word = next(w for w in page.words if w.line == p.row and w.text == p.placed_text)

    located = find_number(page, p.query_text)

    assert located.found
    assert located.bbox is not None
    assert in_unit_square(located.bbox)
    assert overlaps(page, located.bbox, placed_word)
    assert located.matched_text == p.placed_text


@settings(max_examples=100, deadline=None)
@given(
    value=decimals(),
    placed_style=_style,
    query_style=_style,
    decoration=st.sampled_from(["{}", "{},", "{}.", "{}%", "\u20b9{}", "Rs.{}", "{}/-", '"{}"']),
)
def test_punctuation_and_currency_marks_do_not_hide_a_value(
    value: Decimal, placed_style: str, query_style: str, decoration: str
) -> None:
    placed = decoration.format(render_number(value, placed_style))
    page = build_page([["Coal", "consumed", placed, "t"]])

    located = find_number(page, render_number(value, query_style))

    assert located.found
    assert located.bbox is not None
    assert in_unit_square(located.bbox)
    assert overlaps(page, located.bbox, page.words[2])


# ---------------------------------------------------------------------------
# Absent values (hand-built pages)
# ---------------------------------------------------------------------------


@st.composite
def absent_scenarios(draw: st.DrawFn) -> tuple[Decimal, str, list[list[str]]]:
    target = draw(decimals())
    n_lines = draw(st.integers(min_value=0, max_value=25))
    lines = [draw(filler_words(target)) for _ in range(n_lines)]
    return target, render_number(target, draw(_style)), lines


@settings(max_examples=150, deadline=None)
@given(scenario=absent_scenarios())
def test_value_in_no_word_is_not_found(scenario: tuple[Decimal, str, list[list[str]]]) -> None:
    _, query, lines = scenario
    located = find_number(build_page(lines), query)

    assert not located.found
    assert located.bbox is None


@settings(max_examples=100, deadline=None)
@given(value=decimals(), style=_style)
def test_a_neighbouring_value_is_never_accepted(value: Decimal, style: str) -> None:
    """Exact comparison: 1,234.5 on the page does not verify 1,234.6 or 1,234.50x."""
    page = build_page([[render_number(value, style)]])
    for other in (value + Decimal("0.1"), value * 10, value - Decimal("0.001")):
        assume(other != value and other > 0)
        assert not find_number(page, render_number(other, style)).found


# ---------------------------------------------------------------------------
# Real PDFs (text layer read by pdfplumber)
# ---------------------------------------------------------------------------


@st.composite
def pdf_scenarios(draw: st.DrawFn) -> tuple[Decimal, str, str, list[str], int]:
    """``(value, placed_text, query_text, lines, row)`` for a one-page text PDF."""
    value = draw(decimals())
    placed = render_number(value, draw(_style))
    query = render_number(value, draw(_style))
    n_lines = draw(st.integers(min_value=1, max_value=20))
    lines = [" ".join(draw(filler_words(value))) or "Remarks" for _ in range(n_lines)]
    row = draw(st.integers(min_value=0, max_value=n_lines - 1))
    lines[row] = f"{draw(_label)} {placed} {draw(_label)}"
    return value, placed, query, lines, row


@settings(max_examples=100, deadline=None)
@given(scenario=pdf_scenarios())
def test_value_in_a_pdf_text_layer_is_found_with_a_box_over_it(
    scenario: tuple[Decimal, str, str, list[str], int],
) -> None:
    _, placed, query, lines, _ = scenario
    with open_pdf(text_pdf(lines), max_pages=5) as doc:
        page = doc.page(1)
        placed_word = next(w for w in page.words if w.text == placed)

        located = find_number(page, query)

        assert located.found
        assert located.bbox is not None
        assert in_unit_square(located.bbox)
        assert overlaps(page, located.bbox, placed_word)


@settings(max_examples=100, deadline=None)
@given(scenario=absent_scenarios())
def test_value_absent_from_a_pdf_text_layer_is_not_found(
    scenario: tuple[Decimal, str, list[list[str]]],
) -> None:
    _, query, lines = scenario
    with open_pdf(text_pdf([" ".join(line) or "Remarks" for line in lines]), max_pages=5) as doc:
        assert not find_number(doc.page(1), query).found
