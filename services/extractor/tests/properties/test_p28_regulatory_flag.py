"""Property 28: Regulatory values are flagged.

For any label that matches the regulatory list, in any case and with any surrounding text,
the Reading has ``needs_review=True`` and ``regulatory=True`` (review reason
``regulatory_value``). Labels with no regulatory term are not flagged for that reason.

The terms are written out here from the design list, not read from the pipeline regex.

**Validates: Requirements 10.7**
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.models import (
    BEEPATSectorStream as S,
    DataCell,
    LabelItem,
    Period,
    Reading,
    SourceType,
)
from services.extractor.pipeline import build_reading, is_regulatory

SETTINGS = settings(max_examples=100, deadline=None)

TERMS = [
    "emission factor",
    "emission factors",
    "EF",
    "GWP",
    "global warming potential",
    "NCV to GCV conversion factor",
    "GCV to NCV factor",
    "conversion factor",
    "default value",
    "default values",
    "target",
    "targets",
    "trajectory",
    "trajectories",
    "threshold",
    "thresholds",
]

# Words with no regulatory term. "Targeted" and "defaults" must not match either.
NEUTRAL = ["coal", "quantity", "clinker", "production", "kiln", "power", "Targeted", "defaults"]

PERIOD = Period(kind="monthly", month_key="2023-04")


@st.composite
def cased(draw: st.DrawFn, text: str) -> str:
    """``text`` with each letter upper or lower case."""
    flips = draw(st.lists(st.booleans(), min_size=len(text), max_size=len(text)))
    return "".join(c.upper() if f else c.lower() for c, f in zip(text, flips))


# Surrounding text is neutral words joined by a space or punctuation, so the term keeps its
# word boundaries.
filler = st.lists(st.sampled_from(NEUTRAL), max_size=3).map(" ".join)
separator = st.sampled_from([" ", " - ", " (", ": ", ", "])


@st.composite
def regulatory_labels(draw: st.DrawFn) -> str:
    term = draw(cased(draw(st.sampled_from(TERMS))))
    before, after = draw(filler), draw(filler)
    left = f"{before}{draw(separator)}" if before else ""
    right = f"{draw(separator)}{after}" if after else ""
    return f"{left}{term}{right}"


neutral_labels = st.lists(st.sampled_from(NEUTRAL), min_size=1, max_size=4).map(" ".join)


def reading_for(label: str) -> Reading:
    item = LabelItem(
        raw_id="Sheet1!A2",
        label=label,
        sheet="Sheet1",
        cells=[DataCell(sheet="Sheet1", cell="C2", raw=5, unit="t", period=PERIOD)],
    )
    built = build_reading(
        item,
        item.cells[0],
        S.COAL_QUANTITY,
        mapping_source="key",
        source_type=SourceType.CORROBORATION,
        source="excel",
    )
    assert isinstance(built, Reading)
    return built


@SETTINGS
@given(label=regulatory_labels())
def test_regulatory_labels_are_flagged(label: str) -> None:
    assert is_regulatory(label)
    reading = reading_for(label)
    assert reading.regulatory is True
    assert reading.needs_review is True
    assert "regulatory_value" in reading.review_reasons


@SETTINGS
@given(label=neutral_labels)
def test_labels_without_a_regulatory_term_are_not_flagged(label: str) -> None:
    assert not is_regulatory(label)
    reading = reading_for(label)
    assert reading.regulatory is False
    assert "regulatory_value" not in reading.review_reasons
