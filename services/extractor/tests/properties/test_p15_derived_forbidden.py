"""Property 15: Derived and forbidden readings.

For any process coal and power coal values, the parser emits one ``coal_quantity`` Reading
equal to their sum with ``derived=true``, and emits none when either is missing. For any
pro forma with a clinker production value, no ``calcination_co2`` Reading is emitted.

**Validates: Requirements 6.10, 6.11**

Feature: industrial-extractor, Property 15: Derived and forbidden readings

The coal halves are drawn as exact decimals and written with a unit of ``t``, ``Lakh t`` or
no unit, so the sum is checked after conversion to tonnes. The clinker half writes
calcination-looking rows (an emission row, a factor row, the 0.525 constant, and the
product of clinker and 0.525) next to the clinker value, and checks that no reading carries
a calcination stream or the product.
"""

from __future__ import annotations

from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.models import BEEPATSectorStream
from services.extractor.proforma import ProformaResult, parse_proforma
from services.extractor.tests.factories import proforma_workbook
from services.extractor.workbook import load_workbook_bytes

CALCINATION_STREAMS = {"calcination_co2", "raw_meal_calcination"}

# (label suffix, unit factor to tonnes). A label without a unit assumes tonnes.
UNITS: tuple[tuple[str, Decimal], ...] = (
    (" (t)", Decimal(1)),
    (" (Lakh t)", Decimal(100000)),
    ("", Decimal(1)),
)


def parse(data: bytes) -> ProformaResult:
    wb = load_workbook_bytes(data, "xlsx")
    return parse_proforma(wb, wb.sheets)


def coal(result: ProformaResult) -> list:
    return [r for r in result.readings if r.stream_key == BEEPATSectorStream.COAL_QUANTITY]


@st.composite
def coal_half(draw: st.DrawFn) -> tuple[Decimal, str, Decimal]:
    """``(value written, label suffix, factor to tonnes)`` with an exact tonne total.

    Values are whole numbers of hundredths, so ``Lakh t`` converts to whole tonnes and the
    sum is exact in ``Decimal``.
    """
    suffix, factor = draw(st.sampled_from(UNITS))
    if factor == Decimal(100000):
        value = Decimal(draw(st.integers(1, 5_000))) / 100
    else:
        value = Decimal(draw(st.integers(1, 5_000_000)))
    return value, suffix, factor


def tonnes(value: Decimal, factor: Decimal) -> Decimal:
    return value * factor


def sheet_value(value: Decimal) -> int | float:
    """The number openpyxl stores. Hundredths are exact enough to read back unchanged."""
    return int(value) if value == value.to_integral_value() else float(value)


@settings(max_examples=100, deadline=None)
@given(
    process=coal_half(),
    power=coal_half(),
    row_offset=st.integers(0, 10),
    col_offset=st.integers(0, 5),
    swap_order=st.booleans(),
)
def test_both_halves_give_one_derived_reading_equal_to_the_sum(
    process: tuple[Decimal, str, Decimal],
    power: tuple[Decimal, str, Decimal],
    row_offset: int,
    col_offset: int,
    swap_order: bool,
) -> None:
    rows = [
        (f"Coal consumed in process{process[1]}", sheet_value(process[0])),
        (f"Coal consumed in power{power[1]}", sheet_value(power[0])),
    ]
    if swap_order:
        rows.reverse()
    result = parse(proforma_workbook(rows, row_offset=row_offset, col_offset=col_offset))

    got = coal(result)
    assert len(got) == 1
    reading = got[0]
    expected = tonnes(process[0], process[2]) + tonnes(power[0], power[2])
    assert reading.derived is True
    assert reading.value == float(expected)
    assert reading.normalized_value == float(expected)
    assert reading.normalized_unit == "t"
    assert reading.verified is True
    # Only the derived total is emitted. The two halves are internal cells.
    assert [r.stream_key for r in result.readings] == [BEEPATSectorStream.COAL_QUANTITY]


@settings(max_examples=100, deadline=None)
@given(
    half=coal_half(),
    which=st.sampled_from(["process", "power"]),
    declared_total=st.one_of(st.none(), st.integers(1, 5_000_000)),
)
def test_one_missing_half_emits_no_derived_coal_reading(
    half: tuple[Decimal, str, Decimal], which: str, declared_total: int | None
) -> None:
    rows: list[tuple] = [(f"Coal consumed in {which}{half[1]}", sheet_value(half[0]))]
    if declared_total is not None:
        rows.append(("Total coal consumed (t)", declared_total))
    result = parse(proforma_workbook(rows))

    assert coal(result) == []
    assert result.readings == []
    assert "coal_total_not_derived" in [w.code for w in result.warnings]


def test_neither_half_emits_no_derived_coal_reading() -> None:
    assert coal(parse(proforma_workbook([("Clinker Production (t)", 1000)]))) == []
    # A declared total with no halves is the only coal figure. It is never derived.
    declared = coal(parse(proforma_workbook([("Total coal consumed (t)", 1000)])))
    assert [r.derived for r in declared] == [False]


@settings(max_examples=100, deadline=None)
@given(
    clinker=st.integers(1, 5_000_000),
    clinker_unit=st.sampled_from(["(t)", "(Lakh t)", ""]),
    extras=st.lists(
        st.sampled_from(
            [
                "Calcination emissions (tCO2)",
                "Calcination CO2 (tCO2)",
                "Clinker calcination CO2 (tCO2)",
                "Process emission factor (tCO2/t clinker)",
                "Calcination factor",
                "Raw meal calcination (tCO2)",
            ]
        ),
        max_size=6,
    ),
    use_constant=st.booleans(),
    extra_values=st.lists(st.integers(1, 10_000_000), min_size=6, max_size=6),
    row_offset=st.integers(0, 10),
)
def test_a_clinker_value_never_yields_a_calcination_reading(
    clinker: int,
    clinker_unit: str,
    extras: list[str],
    use_constant: bool,
    extra_values: list[int],
    row_offset: int,
) -> None:
    rows: list[tuple] = [(f"Clinker Production {clinker_unit}".strip(), clinker)]
    for label, value in zip(extras, extra_values):
        rows.append((label, value))
    if use_constant:
        rows.append(("Calcination factor (tCO2/t clinker)", 0.525))
    result = parse(proforma_workbook(rows, row_offset=row_offset))

    streams = {r.stream_key.value for r in result.readings}
    assert streams.isdisjoint(CALCINATION_STREAMS)
    assert not any("calcination" in s for s in streams)
    assert "clinker_production" in streams
    product = clinker * 0.525
    for reading in result.readings:
        assert reading.value != product
        assert reading.normalized_value != product
        assert reading.value != 0.525
