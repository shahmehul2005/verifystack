"""Text_Layer_Verifier: find a number or a string in a page's words.

``find_number`` compares exact ``Decimal`` values, never approximate ones, so a value
the Reader_Agent misread is not "verified" by a nearby number. ``find_text`` matches a
run of whole words after case folding. Both return a box normalized to ``[0, 1]`` by
the page width and height, origin at the top left (the same convention as pdfplumber).
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from .models import NormalizedBBox
from .pdf_text import PageText, Word
from .units import parse_number

__all__ = ["Located", "find_number", "find_text"]


@dataclass(frozen=True)
class Located:
    found: bool
    bbox: NormalizedBBox | None = None  # x, y, width, height in [0, 1]
    matched_text: str | None = None


_NOT_FOUND = Located(found=False)

# Punctuation that may hang on either side of a number in running text.
_LEADING_JUNK = ",;:!?'\"*\u2018\u2019\u201c\u201d"
_TRAILING_JUNK = ".,;:!?'\"*\u2018\u2019\u201c\u201d"
_TRAILING_DASH_RE = re.compile(r"/-$")  # "Rs. 1,234/-"
_TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


def _clean_variants(word: str) -> list[str]:
    """Return the readings of ``word`` to try as a number, most literal first."""
    variants = [word]

    def add(candidate: str) -> None:
        if candidate and candidate not in variants:
            variants.append(candidate)

    text = _TRAILING_DASH_RE.sub("", word.strip())
    text = text.lstrip(_LEADING_JUNK).rstrip(_TRAILING_JUNK)
    text = text.replace("[", "").replace("]", "")
    add(text)
    # A bracket kept only when it pairs up, because "(1,234)" is a negative number.
    if text.startswith("(") and ")" not in text:
        add(text[1:])
    if text.endswith(")") and "(" not in text:
        add(text[:-1])
    return variants


def _word_number(word: str) -> Decimal | None:
    for variant in _clean_variants(word):
        number = parse_number(variant)
        if number is not None:
            return number
    return None


def _fold(text: str) -> str:
    """Case-fold and keep only letters and digits."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return "".join(_TOKEN_RE.findall(folded))


def _tokens(text: str) -> set[str]:
    folded = unicodedata.normalize("NFKC", text).casefold()
    return set(_TOKEN_RE.findall(folded))


def _clip(value: float) -> float:
    if math.isnan(value):
        return 0.0
    return min(1.0, max(0.0, value))


def _box(page: PageText, words: Sequence[Word]) -> NormalizedBBox | None:
    """Union of ``words`` normalized by the page size and clipped to ``[0, 1]``."""
    if not words or page.width <= 0 or page.height <= 0:
        return None
    x0 = _clip(min(w.x0 for w in words) / page.width)
    x1 = _clip(max(w.x1 for w in words) / page.width)
    y0 = _clip(min(w.top for w in words) / page.height)
    y1 = _clip(max(w.bottom for w in words) / page.height)
    return NormalizedBBox(x=x0, y=y0, width=max(0.0, x1 - x0), height=max(0.0, y1 - y0))


def _line_tokens(page: PageText, word: Word) -> set[str]:
    if 0 <= word.line < len(page.lines):
        return _tokens(page.lines[word.line])
    return set()


def find_number(page: PageText, value_text: str, near: str = "") -> Located:
    """Find ``value_text`` as a whole word of the page text.

    The value and each word are parsed with ``parse_number`` and compared as exact
    ``Decimal`` values, so ``1,23,456.50``, ``123,456.5`` and ``123456.5`` are equal.
    Surrounding punctuation, currency marks and ``%`` do not matter. Among several
    matches the word on the line that shares the most tokens with ``near`` wins, then
    the first in reading order. A value that is not a number is never found.
    """
    target = _word_number(value_text) if isinstance(value_text, str) else None
    if target is None:
        return _NOT_FOUND

    matches = [w for w in page.words if _word_number(w.text) == target]
    if not matches:
        return _NOT_FOUND

    best = matches[0]
    near_tokens = _tokens(near) if isinstance(near, str) else set()
    if near_tokens and len(matches) > 1:
        best_score = -1
        for word in matches:  # strict ">" keeps the first one on ties
            score = len(near_tokens & _line_tokens(page, word))
            if score > best_score:
                best, best_score = word, score
    return Located(found=True, bbox=_box(page, [best]), matched_text=best.text)


def find_text(page: PageText, needle: str) -> Located:
    """Find ``needle`` as a run of whole words of the page text.

    Case and everything that is not a letter or a digit are ignored, so ``Sub-total``
    matches ``sub total`` and ``Sub-total:``. The run may continue onto the next line.
    The first match in reading order wins.
    """
    target = _fold(needle) if isinstance(needle, str) else ""
    if not target:
        return _NOT_FOUND

    folded = [(w, _fold(w.text)) for w in page.words]
    folded = [(w, f) for w, f in folded if f]
    for start in range(len(folded)):
        if not target.startswith(folded[start][1]):
            continue
        run = _extend_run(folded, start, target)
        if run is not None:
            return Located(
                found=True,
                bbox=_box(page, run),
                matched_text=" ".join(w.text for w in run),
            )
    return _NOT_FOUND


def _extend_run(
    folded: Sequence[tuple[Word, str]], start: int, target: str
) -> list[Word] | None:
    """Return the words from ``start`` whose folded text joins to exactly ``target``."""
    joined = ""
    run: list[Word] = []
    for word, text in folded[start:]:
        joined += text
        if not target.startswith(joined):
            return None
        run.append(word)
        if joined == target:
            return run
    return None
