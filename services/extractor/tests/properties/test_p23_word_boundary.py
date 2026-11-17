"""Property 23: Word-boundary mapping.

**Validates: Requirements 9.1**

A synonym glued to a letter or digit prefix or suffix never maps the label by that
synonym. The same synonym as a whole word, with any surrounding punctuation or
spacing, maps it.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.streams import STREAMS, match_label

_PHRASES = sorted({p for s in STREAMS for p in s.phrases})
_SINGLE_WORD = [p for p in _PHRASES if " " not in p]
_KEYS_BY_PHRASE: dict[str, set] = {}
for _s in STREAMS:
    for _p in _s.phrases:
        _KEYS_BY_PHRASE.setdefault(_p, set()).add(_s.key)

_ALNUM = st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=4)
_PUNCT = st.text(alphabet=" ,;:-/|*#!", max_size=4)
_CASE = st.booleans()


@settings(max_examples=200, deadline=None)
@given(
    st.sampled_from(_SINGLE_WORD),
    _ALNUM,
    _ALNUM,
    st.sampled_from(["prefix", "suffix", "both"]),
)
def test_glued_synonym_is_not_mapped(phrase: str, pre: str, suf: str, where: str) -> None:
    label = (pre if where in ("prefix", "both") else "") + phrase
    label += suf if where in ("suffix", "both") else ""
    result = match_label(label)
    assert result.status == "none", (label, result)


@settings(max_examples=200, deadline=None)
@given(st.sampled_from(_PHRASES), _PUNCT, _PUNCT, _CASE)
def test_whole_word_synonym_is_mapped(phrase: str, pre: str, suf: str, upper: bool) -> None:
    core = phrase.upper() if upper else phrase
    result = match_label(f"{pre}{core}{suf}")
    assert result.status == "mapped", (pre, core, suf, result)
    assert result.stream in _KEYS_BY_PHRASE[phrase]
