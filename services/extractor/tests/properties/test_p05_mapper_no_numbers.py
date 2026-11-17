"""Property 5: Mapper output carries no numbers.

For any dictionary that adds a numeric or unknown key to a mapping, ``MapperOutput``
validation rejects it, so a mapping contains only a raw id, a stream key, a reason and a
confidence.

**Validates: Requirements 4.1**
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from services.extractor.models import BEEPATSectorStream, Mapping, MapperOutput

MAPPING_FIELDS = {"raw_id", "stream_key", "reason", "confidence"}
STREAM_KEYS = [s.value for s in BEEPATSectorStream]

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

raw_ids = st.from_regex(r"[A-Za-z][A-Za-z0-9 _]{0,12}![A-Z]{1,3}[1-9][0-9]{0,4}", fullmatch=True)
stream_keys = st.one_of(st.none(), st.sampled_from(STREAM_KEYS), st.text(max_size=20))
reasons = st.text(max_size=60)
confidences = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)


@st.composite
def valid_mappings(draw: st.DrawFn) -> dict[str, Any]:
    return {
        "raw_id": draw(raw_ids),
        "stream_key": draw(stream_keys),
        "reason": draw(reasons),
        "confidence": draw(confidences),
    }


# Any key a model might add that is not one of the four declared fields. Includes the
# names a model would use to smuggle a number in ("value", "total", "quantity", ...).
extra_names = st.one_of(
    st.sampled_from(
        ["value", "values", "number", "amount", "total", "quantity", "sum", "result", "factor"]
    ),
    st.text(min_size=1, max_size=15).filter(lambda s: s not in MAPPING_FIELDS),
)

numeric_values = st.one_of(
    st.integers(min_value=-(10**12), max_value=10**12),
    st.floats(allow_nan=False, allow_infinity=False),
    st.decimals(allow_nan=False, allow_infinity=False, places=4).map(float),
)
any_json_values = st.one_of(
    numeric_values,
    st.text(max_size=20),
    st.booleans(),
    st.none(),
    st.lists(numeric_values, max_size=3),
    st.dictionaries(st.text(min_size=1, max_size=5), numeric_values, max_size=3),
)


def _rejected_for_extra(exc: ValidationError) -> bool:
    return any(err["type"] == "extra_forbidden" for err in exc.errors())


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


@settings(max_examples=100, deadline=None)
@given(mapping=valid_mappings(), name=extra_names, value=any_json_values)
def test_extra_key_on_a_mapping_is_rejected(mapping: dict[str, Any], name: str, value: Any) -> None:
    """A numeric or unknown key added to a mapping makes ``MapperOutput`` invalid."""
    bad = {**mapping, name: value}

    with pytest.raises(ValidationError) as caught:
        MapperOutput.model_validate({"mappings": [bad]})
    assert _rejected_for_extra(caught.value)

    with pytest.raises(ValidationError):
        Mapping.model_validate(bad)


@settings(max_examples=100, deadline=None)
@given(
    mappings=st.lists(valid_mappings(), max_size=5),
    name=extra_names,
    value=any_json_values,
    position=st.integers(min_value=0, max_value=4),
)
def test_one_bad_mapping_among_valid_ones_rejects_the_whole_output(
    mappings: list[dict[str, Any]], name: str, value: Any, position: int
) -> None:
    """The extra key is caught wherever it sits in the list."""
    bad = {**(mappings[0] if mappings else {"raw_id": "S!A1", "stream_key": None, "confidence": 0.5}), name: value}
    items = list(mappings)
    items.insert(min(position, len(items)), bad)

    with pytest.raises(ValidationError):
        MapperOutput.model_validate({"mappings": items})


@settings(max_examples=100, deadline=None)
@given(extra=st.dictionaries(extra_names, any_json_values, min_size=1, max_size=3), mappings=st.lists(valid_mappings(), max_size=3))
def test_extra_key_on_the_output_envelope_is_rejected(
    extra: dict[str, Any], mappings: list[dict[str, Any]]
) -> None:
    with pytest.raises(ValidationError) as caught:
        MapperOutput.model_validate({"mappings": mappings, **extra})
    assert _rejected_for_extra(caught.value)


@settings(max_examples=100, deadline=None)
@given(
    mappings=st.lists(valid_mappings(), max_size=6),
)
def test_a_valid_output_holds_only_the_four_declared_fields(mappings: list[dict[str, Any]]) -> None:
    """Accepted output round-trips and carries a number only in ``confidence``."""
    out = MapperOutput.model_validate({"mappings": mappings})

    dumped = out.model_dump()
    assert len(dumped["mappings"]) == len(mappings)
    for original, item in zip(mappings, dumped["mappings"], strict=True):
        assert set(item) == MAPPING_FIELDS
        assert item["raw_id"] == original["raw_id"]
        assert item["stream_key"] == original["stream_key"]
        assert item["reason"] == original["reason"]
        assert 0.0 <= item["confidence"] <= 1.0
        for name in ("raw_id", "stream_key", "reason"):
            assert item[name] is None or isinstance(item[name], str)
            assert not isinstance(item[name], (int, float, Decimal, bool))


@settings(max_examples=100, deadline=None)
@given(
    mapping=valid_mappings(),
    field=st.sampled_from(["raw_id", "stream_key", "reason"]),
    number=numeric_values,
)
def test_a_number_in_a_text_field_is_rejected(
    mapping: dict[str, Any], field: str, number: int | float
) -> None:
    """A model cannot pass a number by putting it in a text field instead of a new key."""
    bad = {**mapping, field: number}

    with pytest.raises(ValidationError):
        MapperOutput.model_validate({"mappings": [bad]})


@settings(max_examples=100, deadline=None)
@given(mapping=valid_mappings(), confidence=st.one_of(
    st.floats(min_value=1.0000001, max_value=1e9, allow_nan=False),
    st.floats(min_value=-1e9, max_value=-0.0000001, allow_nan=False),
))
def test_confidence_outside_zero_to_one_is_rejected(mapping: dict[str, Any], confidence: float) -> None:
    """The one numeric field cannot carry an arbitrary value either."""
    with pytest.raises(ValidationError):
        MapperOutput.model_validate({"mappings": [{**mapping, "confidence": confidence}]})
