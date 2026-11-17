"""Unit tests for ``pdf_text.py``: page cap, text layer, scanned detection, chunking.

Requirements 2.4 (page cap), 5.1 and 5.7 (no input dropped), 5.5 (scanned pages).
PDFs are built with reportlab in ``factories.py``, so no binary fixture is stored.
"""

from __future__ import annotations

import io

import pytest
from hypothesis import given
from hypothesis import strategies as st
from PIL import Image

from services.extractor.pdf_text import (
    MAX_RENDER_SIDE_PX,
    SCANNED_THRESHOLD,
    PageCapExceeded,
    PageText,
    PdfDoc,
    Word,
    chunk_lines,
    open_pdf,
)
from services.extractor.workbook import CorruptFile, PasswordProtected

from .factories import image_only_pdf, multi_page_pdf, text_pdf

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _page_with_text(text: str) -> PageText:
    words = [Word(text=t, x0=0, top=0, x1=1, bottom=1, line=0) for t in text.split()]
    return PageText(number=1, width=100, height=100, words=words, lines=[text])


# ---------------------------------------------------------------------------
# Page cap (Requirement 2.4)
# ---------------------------------------------------------------------------


def test_pdf_over_the_cap_is_rejected() -> None:
    data = multi_page_pdf(5)
    with pytest.raises(PageCapExceeded) as info:
        open_pdf(data, max_pages=4)
    assert info.value.page_count == 5
    assert info.value.max_pages == 4


def test_pdf_at_the_cap_is_accepted() -> None:
    with open_pdf(multi_page_pdf(4), max_pages=4) as doc:
        assert doc.page_count == 4


def test_page_cap_is_checked_before_any_page_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(self: PdfDoc, n: int) -> PageText:
        raise AssertionError("a page was read before the cap check")

    monkeypatch.setattr(PdfDoc, "page", fail)
    with pytest.raises(PageCapExceeded):
        open_pdf(multi_page_pdf(3), max_pages=2)


# ---------------------------------------------------------------------------
# Open errors
# ---------------------------------------------------------------------------


def test_garbage_bytes_are_a_corrupt_file() -> None:
    with pytest.raises(CorruptFile):
        open_pdf(b"%PDF-1.4 this is not a real pdf", max_pages=10)


def test_empty_bytes_are_a_corrupt_file() -> None:
    with pytest.raises(CorruptFile):
        open_pdf(b"", max_pages=10)


def test_password_protected_pdf_is_reported() -> None:
    from reportlab.lib import pdfencrypt
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(
        buf, encrypt=pdfencrypt.StandardEncryption("secret", canPrint=1), invariant=1
    )
    c.drawString(72, 700, "Clinker 150000")
    c.showPage()
    c.save()
    with pytest.raises(PasswordProtected):
        open_pdf(buf.getvalue(), max_pages=10)


# ---------------------------------------------------------------------------
# Text layer
# ---------------------------------------------------------------------------


def test_every_page_of_a_long_pdf_is_readable_in_order() -> None:
    with open_pdf(multi_page_pdf(7), max_pages=100) as doc:
        assert doc.page_count == 7
        for n in range(1, 8):
            page = doc.page(n)
            assert page.number == n
            assert page.lines[0] == f"Page {n} line 1"
            assert len(page.lines) == 3


def test_lines_follow_reading_order_and_words_point_at_their_line() -> None:
    data = text_pdf(["Clinker produced 150000 t", "Grid import 3000000 kWh"])
    with open_pdf(data, max_pages=10) as doc:
        page = doc.page(1)
    assert page.lines == ["Clinker produced 150000 t", "Grid import 3000000 kWh"]
    for word in page.words:
        assert word.text in page.lines[word.line].split()
    assert page.width == pytest.approx(595.0)
    assert page.height == pytest.approx(842.0)


def test_page_is_cached() -> None:
    with open_pdf(text_pdf(["Hello world and more text"]), max_pages=10) as doc:
        assert doc.page(1) is doc.page(1)


@pytest.mark.parametrize("n", [0, 3])
def test_page_outside_the_document_is_an_index_error(n: int) -> None:
    with open_pdf(multi_page_pdf(2), max_pages=10) as doc, pytest.raises(IndexError):
        doc.page(n)


# ---------------------------------------------------------------------------
# Scanned detection (Requirement 5.5)
# ---------------------------------------------------------------------------


def test_image_only_page_is_scanned() -> None:
    with open_pdf(image_only_pdf(2), max_pages=10) as doc:
        assert doc.page_count == 2
        for n in (1, 2):
            page = doc.page(n)
            assert page.char_count == 0
            assert page.is_scanned


def test_text_page_is_not_scanned() -> None:
    with open_pdf(text_pdf(["Clinker produced 150000 tonnes"]), max_pages=10) as doc:
        assert not doc.page(1).is_scanned


def test_scanned_threshold_is_twenty_characters() -> None:
    assert SCANNED_THRESHOLD == 20
    assert _page_with_text("x" * 19).is_scanned
    assert not _page_with_text("x" * 20).is_scanned
    assert _page_with_text("").is_scanned


def test_scanned_count_ignores_whitespace() -> None:
    # Ten two-letter words are 20 characters, however far apart they sit.
    assert not _page_with_text(" ".join(["ab"] * 10)).is_scanned
    assert _page_with_text(" ".join(["ab"] * 9)).is_scanned


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def test_render_png_at_150_dpi() -> None:
    with open_pdf(text_pdf(["Hello world"]), max_pages=10) as doc:
        png = doc.render_png(1)
    assert png.startswith(PNG_MAGIC)
    width, height = Image.open(io.BytesIO(png)).size
    # A4 at 150 dpi is about 1240 x 1754 px.
    assert abs(width - 1240) <= 2
    assert abs(height - 1754) <= 2


def test_render_png_is_scaled_down_above_3000_pixels() -> None:
    with open_pdf(text_pdf(["Hello world"]), max_pages=10) as doc:
        png = doc.render_png(1, dpi=600)
    width, height = Image.open(io.BytesIO(png)).size
    assert max(width, height) <= MAX_RENDER_SIDE_PX + 1
    assert max(width, height) >= MAX_RENDER_SIDE_PX - 2


def test_render_png_of_a_missing_page_is_an_index_error() -> None:
    with open_pdf(text_pdf(["Hello world"]), max_pages=10) as doc, pytest.raises(IndexError):
        doc.render_png(2)


# ---------------------------------------------------------------------------
# chunk_lines (Requirements 5.1, 5.7)
# ---------------------------------------------------------------------------


def _size(lines: list[str], start: int, end: int) -> int:
    return len("\n".join(lines[start:end]))


def test_empty_input_has_no_chunks() -> None:
    assert chunk_lines([], 100) == []


def test_everything_that_fits_is_one_chunk() -> None:
    assert chunk_lines(["aa", "bb", "cc"], 100) == [(0, 3)]


def test_chunks_overlap_by_two_lines() -> None:
    lines = [f"line{i:02d}" for i in range(10)]  # 6 chars each
    # Four lines fit in 27 chars (4 * 6 + 3 newlines).
    chunks = chunk_lines(lines, 27)
    assert chunks[0] == (0, 4)
    assert chunks[1][0] == 2  # starts two lines before the previous end
    assert chunks[-1][1] == len(lines)


def test_overlap_zero_gives_disjoint_chunks() -> None:
    lines = [f"line{i:02d}" for i in range(8)]
    chunks = chunk_lines(lines, 27, overlap=0)
    assert chunks == [(0, 4), (4, 8)]


def test_an_overlong_line_is_its_own_chunk_and_is_not_cut() -> None:
    lines = ["short", "x" * 500, "tail"]
    chunks = chunk_lines(lines, 50)
    assert any(lines[s:e] == ["x" * 500] for s, e in chunks) or any(
        "x" * 500 in lines[s:e] for s, e in chunks
    )
    covered = {i for s, e in chunks for i in range(s, e)}
    assert covered == {0, 1, 2}


@pytest.mark.parametrize("bad", [0, -5])
def test_non_positive_max_chars_is_rejected(bad: int) -> None:
    with pytest.raises(ValueError):
        chunk_lines(["a"], bad)


def test_negative_overlap_is_rejected() -> None:
    with pytest.raises(ValueError):
        chunk_lines(["a"], 10, overlap=-1)


def test_a_long_page_reaches_the_chunks_whole() -> None:
    """No truncation: 500 lines of 40 chars are all in some chunk."""
    lines = [f"Row {i:04d} reading {i * 7:08d} kWh ok" for i in range(500)]
    chunks = chunk_lines(lines, 4000)
    assert len(chunks) > 1
    covered: set[int] = set()
    for s, e in chunks:
        covered.update(range(s, e))
    assert covered == set(range(500))


@given(
    lines=st.lists(st.text(alphabet="abc 0123456789.,", min_size=0, max_size=60), max_size=80),
    max_chars=st.integers(min_value=1, max_value=200),
    overlap=st.integers(min_value=0, max_value=4),
)
def test_chunks_cover_every_line_and_respect_the_budget(
    lines: list[str], max_chars: int, overlap: int
) -> None:
    chunks = chunk_lines(lines, max_chars, overlap=overlap)
    covered: set[int] = set()
    previous_end = 0
    for start, end in chunks:
        assert 0 <= start < end <= len(lines)
        assert start <= previous_end  # no gap between chunks
        assert end > previous_end  # every chunk makes progress
        covered.update(range(start, end))
        # Over budget only when a single line is longer than the budget.
        assert _size(lines, start, end) <= max_chars or end - start == 1
        previous_end = end
    assert covered == set(range(len(lines)))
