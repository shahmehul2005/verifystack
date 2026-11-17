"""Property 13: Unit handling.

For any label with a recognized unit in its last parentheses, the Reading's
``unit_as_stated`` is that unit and ``unit_assumed`` is false. For any label without one,
in any parser, the Reading carries the stream standard unit, ``unit_assumed=true`` and
``needs_review=true``, and the unit is never ``t`` unless ``t`` is the standard unit.

Three paths are checked, each on real parser output:

* the Pro_Forma_Parser (``parse_proforma`` on a generated pro forma workbook),
* the Tabular_Parser through ``/v1/extract-calendar`` (the long, periods-in-columns and
  periods-in-rows layouts, with the unit in a label, a header or a Unit column),
* ``unit_from_label``, the splitter every parser uses.

**Validates: Requirements 6.4, 6.5, 7.6, 10.6**
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.models import BEEPATSectorStream as S
from services.extractor.models import Reading
from services.extractor.proforma import parse_proforma
from services.extractor.tests.conftest import ModelScript
from services.extractor.tests.factories import (
    long_table,
    periods_in_columns,
    periods_in_rows,
    proforma_workbook,
)
from services.extractor.units import STANDARD_UNIT, parse_unit, unit_from_label
from services.extractor.workbook import load_workbook_bytes

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FY = "FY2023-24"

# ---------------------------------------------------------------------------
# Streams, with a label each parser recognizes, and units that measure the same quantity
# ---------------------------------------------------------------------------

MASS = ("t", "kg", "Lakh t", "tonnes", "MT", "Tonne", "quintal")
ELECTRIC = ("kWh", "MWh", "GWh", "MU", "Lakh kWh", "Million kWh")
GCV_MASS = ("kcal/kg", "MJ/kg", "kJ/kg", "GJ/t", "cal/g")
LIQUID = ("kL", "L", "litres", "kilolitre")
GAS = ("SCM", "Lakh SCM", "Million SCM", "MMSCM")
GCV_GAS = ("kcal/SCM", "MJ/SCM")

# stream -> (pro forma label, compatible units). The label carries no unit.
PROFORMA_STREAMS: dict[S, tuple[str, tuple[str, ...]]] = {
    S.CLINKER_PRODUCTION: ("Clinker Production", MASS),
    S.IMPORTED_COAL_QUANTITY: ("Imported Coal consumed", MASS),
    S.IMPORTED_COAL_GCV: ("GCV of Imported Coal", GCV_MASS),
    S.PETCOKE_QUANTITY: ("Petcoke consumed", MASS),
    S.PETCOKE_GCV: ("GCV of Petcoke", GCV_MASS),
    S.FO_QUANTITY: ("Furnace Oil consumed", MASS),
    S.HSD_QUANTITY: ("HSD consumed", LIQUID),
    S.NATURAL_GAS_QUANTITY: ("Natural Gas consumed", GAS),
    S.NATURAL_GAS_GCV: ("GCV of Natural Gas", GCV_GAS),
    S.GRID_ELECTRICITY: ("Imported from grid", ELECTRIC),
    S.CPP_GENERATION: ("CPP generation", ELECTRIC),
}

# stream -> compatible units. The tabular label is the stream key (the key rule).
TABULAR_STREAMS: dict[S, tuple[str, ...]] = {
    S.COAL_QUANTITY: MASS,
    S.CLINKER_PRODUCTION: MASS,
    S.COAL_GCV: GCV_MASS,
    S.HSD_QUANTITY: LIQUID,
    S.NATURAL_GAS_QUANTITY: GAS,
    S.NATURAL_GAS_GCV: GCV_GAS,
    S.GRID_ELECTRICITY: ELECTRIC,
    S.WHRS_GENERATION: ELECTRIC,
}

# A parenthetical that is not a unit stays in the label and never becomes the unit.
NON_UNIT_NOTES = ("(Kiln 1)", "(Note 2)", "(see sheet 3)", "(Provisional)")

values = st.integers(min_value=1, max_value=900_000)
pads = st.sampled_from(["", " ", "  "])

FIXTURE_SETTINGS = settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


def assert_stated_unit(reading: Reading | dict[str, Any], unit: str) -> None:
    """The unit written in the source is carried through and is not flagged as assumed."""
    get = reading.get if isinstance(reading, dict) else lambda k: getattr(reading, k)
    assert get("unit_as_stated") == unit
    assert get("unit_assumed") is False
    assert "unit_assumed" not in get("review_reasons")


def assert_assumed_unit(reading: Reading | dict[str, Any], stream: S) -> None:
    """No unit in the source: the stream standard unit, flagged for review."""
    get = reading.get if isinstance(reading, dict) else lambda k: getattr(reading, k)
    standard = STANDARD_UNIT[stream]
    assert get("unit_assumed") is True
    assert get("needs_review") is True
    assert "unit_assumed" in get("review_reasons")
    assert get("normalized_unit") == standard
    assert get("unit_as_stated") is None
    # The old default was "t" for every stream.
    assert get("normalized_unit") != "t" or standard == "t"
    # Nothing is converted when the unit is assumed.
    assert get("normalized_value") == get("value")


# ---------------------------------------------------------------------------
# unit_from_label: the last recognized parenthetical is the unit
# ---------------------------------------------------------------------------


@given(
    base=st.sampled_from(["Coal Consumed", "Clinker Production", "Grid power imported"]),
    unit=st.sampled_from(MASS + ELECTRIC + GCV_MASS + LIQUID + GAS + GCV_GAS),
    note=st.one_of(st.none(), st.sampled_from(NON_UNIT_NOTES)),
    lead=pads,
    trail=pads,
)
def test_unit_from_label_takes_the_last_recognized_parenthetical(
    base: str, unit: str, note: str | None, lead: str, trail: str
) -> None:
    label = f"{base} ({lead}{unit}{trail})" + (f" {note}" if note else "")
    rest, stated = unit_from_label(label)
    assert stated == unit
    assert parse_unit(stated) is not None
    assert "(" + unit + ")" not in rest
    if note:
        assert note in rest  # a non-unit parenthetical stays in the label


@given(
    base=st.sampled_from(["Coal Consumed", "Clinker Production"]),
    first=st.sampled_from(MASS),
    last=st.sampled_from(MASS),
)
def test_unit_from_label_prefers_the_last_unit(base: str, first: str, last: str) -> None:
    _, stated = unit_from_label(f"{base} ({first}) ({last})")
    assert stated == last


@given(
    base=st.sampled_from(["Coal Consumed", "Clinker Production", "Imported from grid"]),
    note=st.one_of(st.none(), st.sampled_from(NON_UNIT_NOTES)),
)
def test_unit_from_label_returns_none_without_a_unit(base: str, note: str | None) -> None:
    label = f"{base} {note}" if note else base
    assert unit_from_label(label) == (label, None)


# ---------------------------------------------------------------------------
# Pro_Forma_Parser (Requirements 6.4, 6.5, 10.6)
# ---------------------------------------------------------------------------


@st.composite
def proforma_rows(draw: st.DrawFn) -> list[tuple[S, str, int, str | None]]:
    """Distinct streams, each with a label, a value and either a stated unit or none."""
    streams = draw(
        st.lists(st.sampled_from(list(PROFORMA_STREAMS)), min_size=1, max_size=6, unique=True)
    )
    rows = []
    for stream in streams:
        label, units = PROFORMA_STREAMS[stream]
        unit = draw(st.one_of(st.none(), st.sampled_from(units)))
        rows.append((stream, label, draw(values), unit))
    return rows


@st.composite
def proforma_label_text(draw: st.DrawFn, label: str, unit: str | None) -> str:
    note = draw(st.one_of(st.none(), st.sampled_from(NON_UNIT_NOTES)))
    if unit is None:
        return f"{label} {note}" if note else label
    pad = draw(pads)
    # The unit is in the last parentheses. A non-unit note may come before it.
    return f"{label} {note} ({pad}{unit}{pad})" if note else f"{label} ({pad}{unit}{pad})"


@settings(deadline=None)
@given(data=st.data(), rows=proforma_rows())
def test_proforma_unit_is_stated_or_assumed(
    data: st.DataObject, rows: list[tuple[S, str, int, str | None]]
) -> None:
    texts = [data.draw(proforma_label_text(label, unit)) for _s, label, _v, unit in rows]
    sheet = proforma_workbook([(t, v) for t, (_s, _l, v, _u) in zip(texts, rows, strict=True)])
    wb = load_workbook_bytes(sheet, "xlsx")
    result = parse_proforma(wb, wb.sheets)

    by_stream = {r.stream_key: r for r in result.readings}
    assert len(by_stream) == len(result.readings) == len(rows), (
        [(r.stream_key.value, r.label) for r in result.readings],
        [w.message for w in result.warnings],
    )
    for stream, _label, _value, unit in rows:
        reading = by_stream[stream]
        if unit is None:
            assert_assumed_unit(reading, stream)
        else:
            assert_stated_unit(reading, unit)
            assert reading.normalized_unit == STANDARD_UNIT[stream]


# ---------------------------------------------------------------------------
# Tabular_Parser (Requirements 7.6, 10.6), through the HTTP API
# ---------------------------------------------------------------------------

LAYOUTS = (
    "long_unit_column",
    "long_value_header",
    "columns_label",
    "columns_unit_column",
    "rows_header",
)


@st.composite
def tabular_cases(draw: st.DrawFn) -> tuple[str, list[tuple[S, str | None]]]:
    """A layout and two or three distinct streams, each with a stated unit or none."""
    layout = draw(st.sampled_from(LAYOUTS))
    streams = draw(
        st.lists(st.sampled_from(list(TABULAR_STREAMS)), min_size=2, max_size=3, unique=True)
    )
    series = [
        (stream, draw(st.one_of(st.none(), st.sampled_from(TABULAR_STREAMS[stream]))))
        for stream in streams
    ]
    return layout, series


def _build_tabular(
    layout: str, series: list[tuple[S, str | None]], vals: list[int]
) -> tuple[bytes, dict[S, str | None]]:
    """The workbook, and the unit that applies to each stream by the source's own rule.

    ``long_value_header`` has one Value column, so a single unit covers every record; the
    returned map says which.
    """
    months = ["Apr-23", "May-23"]
    expected = dict(series)

    if layout == "long_unit_column":
        records = [(m, s.value, vals[i], u) for i, (s, u) in enumerate(series) for m in months]
        return long_table(records), expected

    if layout == "long_value_header":
        # One unit for the Value column, taken from its header, for every stream that
        # accepts it. Draw the unit from the first series and keep the streams compatible.
        stream0, unit0 = series[0]
        compatible = [s for s, _ in series if s != stream0 and _same_dimension(s, stream0)]
        used = [stream0, *compatible]
        header = f"Value ({unit0})" if unit0 else "Value"
        records = [(m, s.value, vals[i], None) for i, s in enumerate(used) for m in months]
        data = long_table(records, headers=("Month", "Stream", header, "Unit"))
        return data, {s: unit0 for s in used}

    if layout == "columns_label":
        rows = [
            (f"{s.value} ({u})" if u else s.value, [vals[i], vals[i] + 1])
            for i, (s, u) in enumerate(series)
        ]
        return periods_in_columns(months, rows), expected

    if layout == "columns_unit_column":
        rows = [(s.value, [vals[i], vals[i] + 1]) for i, (s, _u) in enumerate(series)]
        return (
            periods_in_columns(months, rows, unit_column=True, units=[u for _s, u in series]),
            expected,
        )

    columns = [
        (f"{s.value} ({u})" if u else s.value, [vals[i], vals[i] + 1])
        for i, (s, u) in enumerate(series)
    ]
    return periods_in_rows(months, columns), expected


def _same_dimension(a: S, b: S) -> bool:
    return STANDARD_UNIT[a] == STANDARD_UNIT[b]


@FIXTURE_SETTINGS
@given(case=tabular_cases(), vals=st.lists(values, min_size=3, max_size=3))
def test_tabular_unit_is_stated_or_assumed(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    case: tuple[str, list[tuple[S, str | None]]],
    vals: list[int],
) -> None:
    layout, series = case
    data, expected = _build_tabular(layout, series, vals)

    response = client.post(
        "/v1/extract-calendar",
        headers=auth_headers,
        files={"file": ("table.xlsx", data, XLSX_TYPE)},
        data={"compliance_year": FY},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    readings = body["readings"]
    assert not model_script.calls  # the key rule placed every label, so no model call
    assert body["skipped"] == [], body["skipped"]
    assert len(readings) == 2 * len(expected), (layout, readings)

    seen: set[str] = set()
    for reading in readings:
        stream = S(reading["stream_key"])
        seen.add(stream.value)
        unit = expected[stream]
        if unit is None:
            assert_assumed_unit(reading, stream)
        else:
            assert_stated_unit(reading, unit)
            assert reading["normalized_unit"] == STANDARD_UNIT[stream]
    assert seen == {s.value for s in expected}
