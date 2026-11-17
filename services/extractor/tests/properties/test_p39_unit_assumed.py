"""Property 39: Unit assumed never defaults to tonnes.

For any stream whose standard unit is not ``t`` and any source label with no unit, the
Reading unit is that stream's standard unit.

Checked on real parser output: the Pro_Forma_Parser (``parse_proforma``) and the
Tabular_Parser through ``/v1/extract-calendar``. Every stream under test has a standard
unit other than ``t``, so the old "default to t" behaviour would fail.

**Validates: Requirements 6.5, 10.6**
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.models import BEEPATSectorStream as S
from services.extractor.proforma import parse_proforma
from services.extractor.tests.conftest import ModelScript
from services.extractor.tests.factories import long_table, periods_in_columns, proforma_workbook
from services.extractor.units import STANDARD_UNIT
from services.extractor.workbook import load_workbook_bytes

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FY = "FY2023-24"

# Streams with a label each parser recognizes and a standard unit that is not "t".
PROFORMA_LABELS: dict[S, str] = {
    S.HSD_QUANTITY: "HSD consumed",
    S.NATURAL_GAS_QUANTITY: "Natural Gas consumed",
    S.NATURAL_GAS_GCV: "GCV of Natural Gas",
    S.GRID_ELECTRICITY: "Imported from grid",
    S.CPP_GENERATION: "CPP generation",
    S.IMPORTED_COAL_GCV: "GCV of Imported Coal",
    S.PETCOKE_GCV: "GCV of Petcoke",
}
TABULAR_STREAMS = [
    S.HSD_QUANTITY,
    S.NATURAL_GAS_QUANTITY,
    S.NATURAL_GAS_GCV,
    S.GRID_ELECTRICITY,
    S.WHRS_GENERATION,
    S.COAL_GCV,
]

values = st.integers(min_value=1, max_value=900_000)

FIXTURE_SETTINGS = settings(
    max_examples=30,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


def test_generated_streams_are_not_tonnes() -> None:
    for stream in [*PROFORMA_LABELS, *TABULAR_STREAMS]:
        assert STANDARD_UNIT[stream] != "t"


@given(
    streams=st.lists(st.sampled_from(list(PROFORMA_LABELS)), min_size=1, max_size=5, unique=True),
    vals=st.lists(values, min_size=5, max_size=5),
)
def test_proforma_label_without_unit_uses_standard_unit(streams: list[S], vals: list[int]) -> None:
    sheet = proforma_workbook([(PROFORMA_LABELS[s], vals[i]) for i, s in enumerate(streams)])
    wb = load_workbook_bytes(sheet, "xlsx")
    result = parse_proforma(wb, wb.sheets)

    by_stream = {r.stream_key: r for r in result.readings}
    assert set(by_stream) == set(streams), [w.message for w in result.warnings]
    for i, stream in enumerate(streams):
        reading = by_stream[stream]
        assert reading.normalized_unit == STANDARD_UNIT[stream]
        assert reading.normalized_unit != "t"
        assert reading.unit_assumed is True
        assert reading.unit_as_stated is None
        assert reading.needs_review is True
        assert reading.normalized_value == reading.value == vals[i]


@FIXTURE_SETTINGS
@given(
    layout=st.sampled_from(["long", "columns"]),
    streams=st.lists(st.sampled_from(TABULAR_STREAMS), min_size=2, max_size=3, unique=True),
    vals=st.lists(values, min_size=3, max_size=3),
)
def test_tabular_label_without_unit_uses_standard_unit(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    layout: str,
    streams: list[S],
    vals: list[int],
) -> None:
    months = ["Apr-23", "May-23"]
    if layout == "long":
        data = long_table(
            [(m, s.value, vals[i], None) for i, s in enumerate(streams) for m in months]
        )
    else:
        data = periods_in_columns(months, [(s.value, [vals[i], vals[i] + 1]) for i, s in enumerate(streams)])

    response = client.post(
        "/v1/extract-calendar",
        headers=auth_headers,
        files={"file": ("table.xlsx", data, XLSX_TYPE)},
        data={"compliance_year": FY},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert not model_script.calls
    assert body["skipped"] == [], body["skipped"]
    readings = body["readings"]
    assert len(readings) == 2 * len(streams)
    for reading in readings:
        stream = S(reading["stream_key"])
        assert reading["normalized_unit"] == STANDARD_UNIT[stream]
        assert reading["normalized_unit"] != "t"
        assert reading["unit_assumed"] is True
        assert reading["unit_as_stated"] is None
        assert reading["needs_review"] is True
