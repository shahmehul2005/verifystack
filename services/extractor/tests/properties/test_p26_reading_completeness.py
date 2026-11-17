"""Property 26: Reading completeness.

For any Reading produced by any parser or pipeline path, the model validates and carries
the stream key, period, value, unit, source type, ``verified``, ``needs_review``,
``derived``, confidence and provenance, and a non-empty ``review_reasons`` implies
``needs_review=true``.

**Validates: Requirements 10.1**

Feature: industrial-extractor, Property 26: Reading completeness

Readings are collected from the pro forma parser, the three tabular layouts (rule mapped),
a model mapped spreadsheet, and a PDF read by a scripted Reader and Mapper. Each is checked
after a JSON round trip through ``Reading``, which is what a client receives. A last test
builds Readings directly to check the ``needs_review`` rule of the model itself.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo

from services.extractor.config import get_settings
from services.extractor.models import (
    BEEPATSectorStream,
    CalendarParams,
    Period,
    Provenance,
    Reading,
    SourceType,
)
from services.extractor.pipeline import PipelineDeps, Upload, extract_calendar
from services.extractor.proforma import parse_proforma
from services.extractor.tests.conftest import FixedModelProvider, ModelScript, make_function_model
from services.extractor.tests.factories import (
    long_table,
    periods_in_columns,
    periods_in_rows,
    proforma_workbook,
    text_pdf,
)
from services.extractor.workbook import load_workbook_bytes

SETTINGS = settings(
    max_examples=30,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

FY = "FY2023-24"
MONTHS = ("Apr-2023", "May-2023", "Jun-2023", "Jul-2023")
LABELS = ("Clinker Production (t)", "Coal Quantity (t)", "Petcoke Quantity (t)")
REQUIRED_KEYS = {
    "stream_key",
    "period",
    "value",
    "normalized_unit",
    "source_type",
    "source",
    "verified",
    "needs_review",
    "derived",
    "confidence",
    "provenance",
    "review_reasons",
}

quarters = st.integers(min_value=1, max_value=4_000_000).map(lambda q: q / 4)


def assert_complete(reading: Reading) -> None:
    wire = json.loads(reading.model_dump_json())
    assert REQUIRED_KEYS <= set(wire)
    # The wire form validates again, so a client can rebuild the Reading.
    again = Reading.model_validate(wire)
    assert again == reading

    assert isinstance(reading.stream_key, BEEPATSectorStream)
    assert isinstance(reading.period, Period)
    assert isinstance(reading.value, float)
    assert reading.normalized_unit
    assert reading.source_type is not None
    assert isinstance(reading.verified, bool)
    assert isinstance(reading.needs_review, bool)
    assert isinstance(reading.derived, bool)
    assert 0.0 <= reading.confidence <= 1.0
    assert isinstance(reading.provenance, Provenance)
    assert reading.provenance.source_text
    assert reading.provenance.page is not None or (
        reading.provenance.sheet and reading.provenance.cell
    )
    if reading.review_reasons:
        assert reading.needs_review is True
    if reading.unit_assumed:
        assert reading.needs_review is True


def run_calendar(data: bytes, name: str, provider: Any) -> list[Reading]:
    deps = PipelineDeps(get_settings(), provider)
    req = CalendarParams(compliance_year=FY)
    result = asyncio.run(extract_calendar(Upload(name, data), req, deps))
    return list(result.readings)


class NoModelProvider:
    def get(self) -> Any:
        raise AssertionError("a model was requested, but every label maps by rule")


@st.composite
def grids(draw: st.DrawFn) -> dict[tuple[str, str], float]:
    keys = st.tuples(st.sampled_from(LABELS), st.sampled_from(MONTHS))
    return draw(st.dictionaries(keys, quarters, min_size=2, max_size=len(LABELS) * len(MONTHS)))


@SETTINGS
@given(
    layout=st.sampled_from(["long", "columns", "rows"]),
    grid=grids(),
    unit=st.sampled_from(["t", "Lakh t", "kg", ""]),
)
def test_tabular_readings_are_complete(
    layout: str, grid: dict[tuple[str, str], float], unit: str
) -> None:
    if layout == "long":
        data = long_table([(m, label, v, unit) for (label, m), v in grid.items()])
    else:
        labels = sorted({label for label, _ in grid})
        months = [m for m in MONTHS if any(mm == m for _, mm in grid)]
        series = [(label, [grid.get((label, m)) for m in months]) for label in labels]
        # The layouts need two periods (and, down the rows, two streams) to be detected.
        assume(len(months) >= 2)
        if layout == "columns":
            data = periods_in_columns(months, series)
        else:
            assume(len(labels) >= 2)
            data = periods_in_rows(months, series, period_header="Month")
    readings = run_calendar(data, "upload.xlsx", FixedModelProvider(make_function_model(ModelScript())))
    for reading in readings:
        assert_complete(reading)


@SETTINGS
@given(
    clinker=quarters,
    process=st.integers(1, 100_000),
    power=st.integers(1, 100_000),
    gcv=st.integers(1, 9000),
    clinker_unit=st.sampled_from(["(t)", "(Lakh t)", ""]),
    formula=st.booleans(),
)
def test_proforma_readings_are_complete(
    clinker: float, process: int, power: int, gcv: int, clinker_unit: str, formula: bool
) -> None:
    rows: list[tuple[Any, ...]] = [
        (f"Clinker Production {clinker_unit}".strip(), clinker),
        ("Coal consumed in process (t)", "=1+1" if formula else process),
        ("Coal consumed in power (t)", power),
        ("Imported Coal GCV (kcal/kg)", gcv),
    ]
    wb = load_workbook_bytes(proforma_workbook(rows), "xlsx")
    readings = parse_proforma(wb, wb.sheets).readings
    assert readings
    for reading in readings:
        assert_complete(reading)


@SETTINGS
@given(
    confidence=st.floats(0.0, 1.0),
    values=st.lists(quarters, min_size=1, max_size=4),
)
def test_model_mapped_readings_are_complete(confidence: float, values: list[float]) -> None:
    """Labels the rules cannot map go to the Mapper, whose confidence a Reading carries."""
    records = [(MONTHS[i], "Zzq burnt fuel mass", v, "t") for i, v in enumerate(values)]

    def handler(messages: list[ModelMessage], info: AgentInfo) -> dict[str, Any]:
        raw_ids = _raw_ids(messages)
        return {
            "mappings": [
                {"raw_id": r, "stream_key": "coal_quantity", "confidence": confidence}
                for r in raw_ids
            ]
        }

    script = ModelScript(handler=handler)
    provider = FixedModelProvider(make_function_model(script))
    readings = run_calendar(long_table(records), "upload.xlsx", provider)
    assert readings
    for reading in readings:
        assert_complete(reading)


def _raw_ids(messages: list[ModelMessage]) -> list[str]:
    import re

    found: list[str] = []
    for message in messages:
        for part in getattr(message, "parts", []):
            content = getattr(part, "content", None)
            texts = [content] if isinstance(content, str) else list(content or [])
            for text in texts:
                if isinstance(text, str):
                    found.extend(re.findall(r'"raw_id":\s*"([^"]+)"', text))
    return list(dict.fromkeys(found))


@SETTINGS
@given(
    value=st.integers(1, 9_999_999),
    reader_confidence=st.floats(0.0, 1.0),
    mapper_confidence=st.floats(0.0, 1.0),
    in_text=st.booleans(),
)
def test_pdf_readings_are_complete(
    value: int, reader_confidence: float, mapper_confidence: float, in_text: bool
) -> None:
    """A PDF Reading is complete whether or not the printed number is in the text layer."""
    printed = str(value) if in_text else str(value + 1)
    pdf = text_pdf([["Coal Quantity for April 2023", f"Coal consumed {printed} t"]])

    def handler(messages: list[ModelMessage], info: AgentInfo) -> dict[str, Any]:
        names = {t.name for t in info.output_tools}
        props = info.output_tools[0].parameters_json_schema.get("properties", {})
        if "mappings" in props:
            return {
                "mappings": [
                    {"raw_id": r, "stream_key": "coal_quantity", "confidence": mapper_confidence}
                    for r in _raw_ids(messages)
                ]
            }
        assert names
        return {
            "page_period_text": "April 2023",
            "fields": [
                {
                    "label": "Coal consumed",
                    "value_text": str(value),
                    "unit_as_printed": "t",
                    "period_text": "April 2023",
                    "field_path": "",
                    "source_text": f"Coal consumed {printed} t",
                    "confidence": reader_confidence,
                }
            ],
        }

    provider = FixedModelProvider(make_function_model(ModelScript(handler=handler)))
    readings = run_calendar(pdf, "doc.pdf", provider)
    assert readings
    for reading in readings:
        assert_complete(reading)


@given(
    reasons=st.lists(st.text(min_size=1, max_size=20), max_size=3),
    needs_review=st.booleans(),
    unit_assumed=st.booleans(),
    source=st.sampled_from(["excel", "pdf"]),
    confidence=st.floats(0.0, 1.0),
)
def test_review_reasons_force_needs_review(
    reasons: list[str], needs_review: bool, unit_assumed: bool, source: str, confidence: float
) -> None:
    if source == "pdf":
        prov = Provenance(page=1, source_text="x")
    else:
        prov = Provenance(sheet="S", cell="A1", source_text="x")
    reading = Reading(
        raw_id="r",
        stream_key=BEEPATSectorStream.COAL_QUANTITY,
        period=Period(kind="annual", month_key="annual"),
        source_type=_any_source_type(),
        source=source,  # type: ignore[arg-type]
        value_as_stated="1",
        value=1.0,
        normalized_value=1.0,
        normalized_unit="t",
        verified=True,
        needs_review=needs_review,
        unit_assumed=unit_assumed,
        mapping_source=_any_mapping_source(),
        confidence=confidence,
        review_reasons=reasons,
        provenance=prov,
    )
    if reasons or unit_assumed:
        assert reading.needs_review is True
    else:
        assert reading.needs_review is needs_review
    assert_complete(reading)


def _any_source_type() -> SourceType:
    return list(SourceType)[0]


def _any_mapping_source() -> str:
    return "key"
