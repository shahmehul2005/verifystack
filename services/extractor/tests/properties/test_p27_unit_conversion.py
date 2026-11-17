"""Property 27: Unit conversion.

For any value and any unit in the conversion table that is compatible with a stream,
``normalized_value`` equals the value times the table factor, and converting back with the
inverse factor returns the value within floating-point tolerance. For any incompatible unit
the result is no value.

**Validates: Requirements 10.5**
"""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from services.extractor.models import BEEPATSectorStream as S
from services.extractor.units import _UNITS, STANDARD_UNIT, convert, parse_unit

STREAMS = sorted(STANDARD_UNIT, key=lambda s: s.value)
UNIT_SYMBOLS = [u.symbol for u in _UNITS]

values = st.decimals(
    min_value=Decimal("-1e9"),
    max_value=Decimal("1e9"),
    allow_nan=False,
    allow_infinity=False,
    places=4,
)
streams = st.sampled_from(STREAMS)
symbols = st.sampled_from(UNIT_SYMBOLS)


def _factor(unit_symbol: str, stream: S) -> Decimal | None:
    """Independent factor from the table: source -> standard unit of the stream."""
    src = parse_unit(unit_symbol)
    tgt = parse_unit(STANDARD_UNIT[stream])
    assert src is not None and tgt is not None
    if src.dimension != tgt.dimension:
        return None
    return (src.num * tgt.den) / (src.den * tgt.num)


@given(value=values, unit=symbols, stream=streams)
def test_compatible_equals_value_times_factor_and_round_trips(value, unit, stream):
    factor = _factor(unit, stream)
    result = convert(value, unit, stream)
    if factor is None:
        assert result is None
        return
    assert result is not None
    expected = value * factor
    assert abs(result - expected) <= abs(expected) * Decimal("1e-20")
    # Convert back with the inverse factor.
    back = result / factor
    assert abs(back - value) <= max(abs(value), Decimal(1)) * Decimal("1e-20")
    assert abs(float(back) - float(value)) <= 1e-9 * max(1.0, abs(float(value)))


@given(value=values, stream=streams)
def test_standard_unit_is_identity(value, stream):
    assert convert(value, STANDARD_UNIT[stream], stream) == value


@given(value=values, unit=symbols, stream=streams)
def test_incompatible_unit_gives_no_value(value, unit, stream):
    src = parse_unit(unit)
    tgt = parse_unit(STANDARD_UNIT[stream])
    if src.dimension != tgt.dimension:
        assert convert(value, unit, stream) is None


@given(value=values, stream=streams, junk=st.sampled_from(["", "  ", "furlong", "bags", "%"]))
def test_unknown_unit_gives_no_value(value, stream, junk):
    assert convert(value, junk, stream) is None


def test_known_examples():
    assert convert(Decimal("1.5"), "Lakh t", S.COAL_QUANTITY) == Decimal("150000")
    assert convert(Decimal("2500"), "kg", S.COAL_QUANTITY) == Decimal("2.5")
    assert convert(Decimal("3"), "MU", S.GRID_ELECTRICITY) == Decimal("3000000")
    assert convert(Decimal("10"), "kL", S.FO_QUANTITY) is None  # D12: no density
