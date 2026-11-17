"""PDF opening, page cap, text layer words, scanned detection, page rendering.

Everything here is deterministic and model-free. The Text_Layer_Verifier in
``locate.py`` and the PDF calendar flow in ``pipeline.py`` build on it.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect

from .workbook import CorruptFile, PasswordProtected

SCANNED_THRESHOLD = 20
"""A page whose text layer holds fewer non-whitespace characters than this is scanned."""

MAX_RENDER_SIDE_PX = 3000
DEFAULT_DPI = 150

_LINE_Y_TOLERANCE = 3.0


class PageCapExceeded(Exception):
    """The PDF has more pages than the configured cap (HTTP 413)."""

    def __init__(self, page_count: int, max_pages: int) -> None:
        super().__init__(f"PDF has {page_count} pages, the cap is {max_pages}")
        self.page_count = page_count
        self.max_pages = max_pages


@dataclass(frozen=True)
class Word:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float
    line: int  # index into PageText.lines


@dataclass
class PageText:
    number: int  # 1-based
    width: float
    height: float
    words: list[Word] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)

    @property
    def char_count(self) -> int:
        return sum(len(w.text) for w in self.words)

    @property
    def is_scanned(self) -> bool:
        """True when the text layer holds fewer than 20 characters."""
        return self.char_count < SCANNED_THRESHOLD


def _group_lines(raw_words: list[dict[str, Any]]) -> tuple[list[Word], list[str]]:
    """Group pdfplumber words into reading-order lines and number them."""
    ordered = sorted(raw_words, key=lambda w: (float(w["top"]), float(w["x0"])))
    groups: list[list[dict[str, Any]]] = []
    bounds: list[tuple[float, float]] = []  # (min top, max bottom) per group
    for w in ordered:
        top, bottom = float(w["top"]), float(w["bottom"])
        centre = (top + bottom) / 2
        if groups:
            g_top, g_bottom = bounds[-1]
            if g_top - _LINE_Y_TOLERANCE <= centre <= g_bottom + _LINE_Y_TOLERANCE:
                groups[-1].append(w)
                bounds[-1] = (min(g_top, top), max(g_bottom, bottom))
                continue
        groups.append([w])
        bounds.append((top, bottom))

    words: list[Word] = []
    lines: list[str] = []
    for index, group in enumerate(groups):
        group.sort(key=lambda w: float(w["x0"]))
        lines.append(" ".join(str(w["text"]) for w in group))
        for w in group:
            words.append(
                Word(
                    text=str(w["text"]),
                    x0=float(w["x0"]),
                    top=float(w["top"]),
                    x1=float(w["x1"]),
                    bottom=float(w["bottom"]),
                    line=index,
                )
            )
    return words, lines


class PdfDoc:
    """An opened PDF. Pages are read lazily and cached. Page numbers are 1-based."""

    def __init__(self, pdf: pdfplumber.PDF) -> None:
        self._pdf = pdf
        self.page_count: int = len(pdf.pages)
        self._cache: dict[int, PageText] = {}

    def _plumber_page(self, n: int) -> Any:
        if not 1 <= n <= self.page_count:
            raise IndexError(f"page {n} is outside 1..{self.page_count}")
        return self._pdf.pages[n - 1]

    def page(self, n: int) -> PageText:
        cached = self._cache.get(n)
        if cached is not None:
            return cached
        plumber_page = self._plumber_page(n)
        try:
            raw = plumber_page.extract_words(
                x_tolerance=3, y_tolerance=3, keep_blank_chars=False, use_text_flow=False
            )
        except Exception as exc:  # pdfminer raises many types on damaged content streams
            raise CorruptFile(f"Could not read the text of page {n}") from exc
        words, lines = _group_lines(raw)
        result = PageText(
            number=n,
            width=float(plumber_page.width),
            height=float(plumber_page.height),
            words=words,
            lines=lines,
        )
        plumber_page.flush_cache()
        self._cache[n] = result
        return result

    def render_png(self, n: int, dpi: int = DEFAULT_DPI) -> bytes:
        """Render a page to PNG at ``dpi``, scaled down so the longest side is at most 3000 px."""
        plumber_page = self._plumber_page(n)
        longest_pt = max(float(plumber_page.width), float(plumber_page.height))
        if longest_pt <= 0:
            raise CorruptFile(f"Page {n} has no size")
        effective = min(float(dpi), MAX_RENDER_SIDE_PX * 72.0 / longest_pt)
        image = plumber_page.to_image(resolution=effective).original
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def close(self) -> None:
        self._pdf.close()

    def __enter__(self) -> PdfDoc:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


def open_pdf(data: bytes, max_pages: int) -> PdfDoc:
    """Open a PDF from bytes.

    The page count is checked against ``max_pages`` before any page is read.

    Raises:
        PageCapExceeded: more pages than ``max_pages``.
        PasswordProtected: the file needs a password.
        CorruptFile: the file cannot be parsed.
    """
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception as exc:  # pdfminer and pypdfium2 raise many types on bad input
        raise _map_open_error(exc) from exc

    try:
        page_count = len(pdf.pages)
        if page_count > max_pages:
            raise PageCapExceeded(page_count, max_pages)
        return PdfDoc(pdf)
    except PageCapExceeded:
        pdf.close()
        raise
    except Exception as exc:
        pdf.close()
        raise _map_open_error(exc) from exc


def _map_open_error(exc: BaseException) -> Exception:
    """Map a pdfplumber or pdfminer failure to ``PasswordProtected`` or ``CorruptFile``."""
    # pdfplumber wraps pdfminer errors in PdfminerException and keeps the original in args.
    inner = exc.args[0] if exc.args and isinstance(exc.args[0], BaseException) else exc
    if isinstance(inner, PDFPasswordIncorrect):
        return PasswordProtected("The PDF is password-protected")
    return CorruptFile("The PDF is corrupt or cannot be parsed")


def chunk_lines(
    lines: Sequence[str], max_chars: int, overlap: int = 2
) -> list[tuple[int, int]]:
    """Split ``lines`` into half-open ``(start, end)`` ranges.

    Every line is in at least one range and no line is cut. A range holds at most
    ``max_chars`` characters (lines joined with one newline), unless a single line is
    longer, in which case that line is its own range. A range starts ``overlap`` lines
    before the end of the previous one, so a value near a boundary appears whole in
    one range. The overlap is dropped when the next line would not fit with it.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if overlap < 0:
        raise ValueError("overlap must not be negative")

    total = len(lines)
    ranges: list[tuple[int, int]] = []
    prev_start = 0
    prev_end = 0
    while prev_end < total:
        start = prev_end if not ranges else max(prev_end - overlap, prev_start + 1)
        end = _fill(lines, start, max_chars)
        if end <= prev_end:
            # The overlap lines left no room for a new line. Start at the new line.
            start = prev_end
            end = _fill(lines, start, max_chars)
        ranges.append((start, end))
        prev_start, prev_end = start, end
    return ranges


def _fill(lines: Sequence[str], start: int, max_chars: int) -> int:
    """Return the end of the longest range from ``start`` that fits, at least one line."""
    end = start
    size = 0
    while end < len(lines):
        added = len(lines[end]) + (1 if end > start else 0)
        if size + added > max_chars:
            break
        size += added
        end += 1
    return max(end, start + 1)
