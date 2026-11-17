"""Property 24: Title context and unresolved ambiguity.

**Validates: Requirements 9.2, 9.5**

A generic label matches streams in several families. A title that names exactly one
of those families maps the label to that family's stream. A title that names none of
them, or more than one of them, leaves the label unmapped.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.streams import _GENERIC, STREAM_BY_KEY, STREAMS, match_label

_FAMILY_PHRASES: dict[str, tuple[str, ...]] = {}
for _s in STREAMS:
    _FAMILY_PHRASES.setdefault(_s.family, _s.phrases)

# (label words, {family: stream key}) for each generic group.
_GROUPS = [
    (words, {STREAM_BY_KEY[k].family: k for k in keys}) for words, keys in _GENERIC
]
_FILLER = st.sampled_from(["", "monthly", "sheet 1", "data", "report", "summary"])


@st.composite
def _scenario(draw: st.DrawFn):
    words, by_family = draw(st.sampled_from(_GROUPS))
    # "calcination co2" equals a stream key and maps by the key rule, not by title.
    label = draw(st.sampled_from([w for w in words if w != "calcination co2"]))
    if draw(st.booleans()):
        label = label.upper()
    return label, by_family


def _title(phrases: list[str], pre: str, post: str) -> str:
    # "and" keeps adjacent phrases from forming a longer phrase ("coal imported").
    return " and ".join(p for p in [pre, *phrases, post] if p)


@settings(max_examples=200, deadline=None)
@given(_scenario(), st.data(), _FILLER, _FILLER)
def test_title_naming_one_family_resolves_label(scenario, data, pre, post) -> None:
    label, by_family = scenario
    family = data.draw(st.sampled_from(sorted(by_family)))
    phrase = data.draw(st.sampled_from(_FAMILY_PHRASES[family]))
    result = match_label(label, _title([phrase], pre, post))
    assert result.status == "mapped", (label, phrase, result)
    assert result.stream == by_family[family]
    assert result.rule == "title"


@settings(max_examples=200, deadline=None)
@given(_scenario(), st.data(), _FILLER, _FILLER)
def test_title_naming_no_candidate_family_leaves_label_unmapped(
    scenario, data, pre, post
) -> None:
    label, by_family = scenario
    others = sorted(set(_FAMILY_PHRASES) - set(by_family))
    chosen = data.draw(st.lists(st.sampled_from(others), max_size=2, unique=True))
    phrases = [_FAMILY_PHRASES[f][0] for f in chosen]
    result = match_label(label, _title(phrases, pre, post))
    assert result.status == "ambiguous", (label, phrases, result)
    assert result.stream is None


@settings(max_examples=200, deadline=None)
@given(_scenario(), st.data())
def test_title_naming_two_candidate_families_leaves_label_unmapped(
    scenario, data
) -> None:
    label, by_family = scenario
    families = data.draw(
        st.lists(st.sampled_from(sorted(by_family)), min_size=2, max_size=2, unique=True)
    )
    phrases = [_FAMILY_PHRASES[f][0] for f in families]
    result = match_label(label, _title(phrases, "", ""))
    assert result.status == "ambiguous", (label, phrases, result)
    assert result.stream is None
