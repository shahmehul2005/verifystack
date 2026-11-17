"""Unit tests for ``locate.py``, the Text_Layer_Verifier.

Requirements 5.2 (a number is verified only by an exact match in the text layer),
5.6 (several number formats) and 5.7 (a value is found wherever it sits on the page).
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from hypothesis import given

from services.extractor.locate import find_number, find_text
from services.extractor.pdf_text import PageText, Word, open_pdf

from .factories import number_renderings, render_number, text_pdf


def make_page(lines: list[str], width: float = 600.0, height: float = 800.0) -> PageText:
    """A page with one line per 20 pt, words 50 pt wide placed left to right."""
    words: list[Word] = []
    for li, line in enumerate(lines):
        for wi, text in enumerate(line.split()):
            words.append(
                Word(
                    text=text,
                    x0=10.0 + wi * 60.0,
                    top=20.0 * li,
                    x1=10.0 + wi * 60.0 + 50.0,
                    bottom=20.0 * li + 10.0,
                    line=li,
                )
            )
    return PageText(number=1, width=width, height=height, words=words, lines=list(lines))


# ---------------------------------------------------------------------------
# find_number: formats (Requirement 5.6)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value_text, page_word",
    [
        ("1234567", "1234567"),
        ("1234567", "1,234,567"),  # Western grouping on the page
        ("1234567", "12,34,567"),  # Indian grouping on the page
        ("12,34,567", "1234567"),  # Indian grouping in the value
        ("1,234,567", "12,34,567"),
        ("1234.50", "1,234.5"),  # trailing zero does not matter
        ("1234.5", "1,234.50"),
        ("-450", "(450)"),  # parenthesized negative
        ("(450)", "-450"),
        ("-450", "\u2212450"),  # Unicode minus
        ("34970", "34,970."),  # trailing full stop of a sentence
        ("1234", "Rs.1,234"),  # currency prefix
        ("1234", "\u20b91,234"),
        ("1234", "1,234/-"),  # Indian "rupees only" suffix
        ("12.5", "12.5%"),
        ("150000", "150000,"),  # trailing comma
        ("150000", "(150000"),  # one unmatched bracket
        ("150000", "150000)"),
    ],
)
def test_number_is_found_across_formats(value_text: str, page_word: str) -> None:
    page = make_page([f"Clinker produced {page_word} t"])
    located = find_number(page, value_text)
    assert located.found, (value_text, page_word)
    assert located.matched_text == page_word
    assert located.bbox is not None


def test_a_number_split_by_commas_from_the_value_side_is_found() -> None:
    page = make_page(["Grid import 3000000 kWh"])
    assert find_number(page, "30,00,000").found
    assert find_number(page, "3,000,000").found


# ---------------------------------------------------------------------------
# find_number: exactness (Requirement 5.2)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value_text",
    [
        "150001",  # one off
        "15000",  # a prefix of the page number
        "1500000",  # the page number with a digit added
        "150000.01",
        "-150000",  # wrong sign
    ],
)
def test_a_nearby_number_is_not_a_match(value_text: str) -> None:
    page = make_page(["Clinker produced 150000 t"])
    assert not find_number(page, value_text).found


def test_a_value_inside_a_larger_token_is_not_a_match() -> None:
    page = make_page(["Order INV150000 dated 150000X"])
    assert not find_number(page, "150000").found


def test_a_number_inside_a_year_range_is_not_a_match() -> None:
    page = make_page(["Financial year 2024-25"])
    assert not find_number(page, "2024").found
    assert not find_number(page, "25").found


@pytest.mark.parametrize("value_text", ["", "   ", "abc", "1,23", "1.234,5", "12 34", "n/a"])
def test_a_value_that_is_not_a_number_is_never_found(value_text: str) -> None:
    page = make_page(["Clinker 1,23 1.234,5 12 34 abc n/a"])
    assert not find_number(page, value_text).found


def test_invalid_grouping_on_the_page_is_not_read_as_a_number() -> None:
    page = make_page(["Clinker 1,23 t"])
    assert not find_number(page, "123").found


def test_non_string_value_is_not_found() -> None:
    page = make_page(["Clinker 150000 t"])
    assert not find_number(page, None).found  # type: ignore[arg-type]
    assert not find_number(page, 150000).found  # type: ignore[arg-type]


def test_empty_page_finds_nothing() -> None:
    assert not find_number(make_page([]), "150000").found


# ---------------------------------------------------------------------------
# find_number: choosing among matches
# ---------------------------------------------------------------------------


def test_first_match_in_reading_order_wins_without_a_hint() -> None:
    page = make_page(["Clinker 5000 t", "Cement 5000 t"])
    located = find_number(page, "5000")
    assert located.bbox is not None
    assert located.bbox.y == pytest.approx(0.0)


def test_the_line_closest_to_the_near_text_wins() -> None:
    page = make_page(
        ["Clinker produced 5000 t", "Cement produced 8000 t", "Grid electricity import 5000 kWh"]
    )
    located = find_number(page, "5000", near="Grid electricity import")
    assert located.found
    assert located.bbox is not None
    assert located.bbox.y == pytest.approx(40.0 / 800.0)


def test_near_text_with_no_overlap_falls_back_to_the_first_match() -> None:
    page = make_page(["Clinker 5000 t", "Cement 5000 t"])
    located = find_number(page, "5000", near="zzz qqq")
    assert located.bbox is not None
    assert located.bbox.y == pytest.approx(0.0)


def test_near_text_does_not_make_a_missing_number_found() -> None:
    page = make_page(["Clinker 5000 t"])
    assert not find_number(page, "6000", near="Clinker").found


# ---------------------------------------------------------------------------
# Bounding boxes
# ---------------------------------------------------------------------------


def test_bbox_is_normalized_by_page_size() -> None:
    page = make_page(["Clinker 5000 t"], width=600.0, height=800.0)
    located = find_number(page, "5000")
    assert located.bbox is not None
    # "5000" is the second word: x0=70, x1=120, top=0, bottom=10.
    assert located.bbox.x == pytest.approx(70 / 600)
    assert located.bbox.y == pytest.approx(0.0)
    assert located.bbox.width == pytest.approx(50 / 600)
    assert located.bbox.height == pytest.approx(10 / 800)


def test_bbox_is_clipped_to_the_unit_square() -> None:
    word = Word(text="5000", x0=-20.0, top=-5.0, x1=700.0, bottom=900.0, line=0)
    page = PageText(number=1, width=600.0, height=800.0, words=[word], lines=["5000"])
    box = find_number(page, "5000").bbox
    assert box is not None
    assert box.x == 0.0 and box.y == 0.0
    assert box.x + box.width <= 1.0
    assert box.y + box.height <= 1.0


def test_number_on_a_real_pdf_gets_a_box_inside_the_page() -> None:
    data = text_pdf(["Clinker produced 1,50,000 t", "Grid import 3000000 kWh"])
    with open_pdf(data, max_pages=10) as doc:
        page = doc.page(1)
    first = find_number(page, "150000")
    second = find_number(page, "3,000,000")
    assert first.found and second.found
    assert first.matched_text == "1,50,000"
    assert first.bbox is not None and second.bbox is not None
    for box in (first.bbox, second.bbox):
        assert 0.0 <= box.x <= 1.0 and 0.0 <= box.y <= 1.0
        assert box.x + box.width <= 1.0 + 1e-9
        assert box.y + box.height <= 1.0 + 1e-9
        assert box.width > 0 and box.height > 0
    assert first.bbox.y < second.bbox.y  # the first line is higher on the page


@given(number_renderings())
def test_any_rendering_of_a_number_is_found_in_any_other(
    case: tuple[Decimal, str, str],
) -> None:
    value, text, _style = case
    for style in ("plain", "western", "indian"):
        page = make_page([f"Reading {render_number(value, style)} unit"])
        assert find_number(page, text).found, (text, style)
    # A different value is never found.
    page = make_page([f"Reading {render_number(value + 1, 'plain')} unit"])
    assert not find_number(page, text).found


# ---------------------------------------------------------------------------
# find_text
# ---------------------------------------------------------------------------


def test_text_is_found_after_case_folding() -> None:
    page = make_page(["Grand Total of all streams"])
    located = find_text(page, "grand total")
    assert located.found
    assert located.matched_text == "Grand Total"


def test_punctuation_is_ignored_in_text_matching() -> None:
    page = make_page(["Sub-total: 5000"])
    assert find_text(page, "sub total").found
    assert find_text(page, "SUBTOTAL").found


def test_a_text_run_may_continue_onto_the_next_line() -> None:
    page = make_page(["Process coal", "consumption in kiln"])
    located = find_text(page, "coal consumption")
    assert located.found
    assert located.matched_text == "coal consumption"


def test_text_matches_whole_words_only() -> None:
    page = make_page(["Charcoal stock"])
    assert not find_text(page, "coal").found
    assert find_text(page, "charcoal stock").found


def test_text_that_is_absent_is_not_found() -> None:
    page = make_page(["Clinker produced 5000 t"])
    assert not find_text(page, "cement").found


def test_text_run_that_diverges_is_not_found() -> None:
    page = make_page(["Process coal total"])
    assert not find_text(page, "process coal consumption").found


@pytest.mark.parametrize("needle", ["", "   ", "---", "..."])
def test_text_without_letters_or_digits_is_not_found(needle: str) -> None:
    assert not find_text(make_page(["Clinker 5000"]), needle).found


def test_find_text_returns_the_first_match_in_reading_order() -> None:
    page = make_page(["Power coal 10", "Power coal 20"])
    located = find_text(page, "power coal")
    assert located.bbox is not None
    assert located.bbox.y == pytest.approx(0.0)


def test_find_text_box_is_the_union_of_the_matched_words() -> None:
    page = make_page(["Power coal 10"], width=600.0, height=800.0)
    located = find_text(page, "power coal")
    assert located.bbox is not None
    # Words at x 10..60 and 70..120, both top 0, bottom 10.
    assert located.bbox.x == pytest.approx(10 / 600)
    assert located.bbox.width == pytest.approx(110 / 600)
    assert located.bbox.height == pytest.approx(10 / 800)


def test_find_text_with_non_string_needle_is_not_found() -> None:
    assert not find_text(make_page(["Clinker"]), None).found  # type: ignore[arg-type]
