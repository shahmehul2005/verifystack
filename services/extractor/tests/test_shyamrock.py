"""Fixture tests against the Shyamrock Cement Works pack (Requirements 18.3, 18.4).

The pack is a zip of synthetic plant documents in ``do-res/``. The zip is read in memory
and nothing is written to disk. When the zip is absent the whole module is skipped with a
stated reason.

* The pro forma (``15``) gives annual readings: clinker 150000 t from ``1.5 Lakh t``, the
  derived coal total 34970 t, and grid import 3,000,000 kWh from ``30 Lakh kWh``.
* The plant logs (``01``, ``06``, ``08``) give daily readings. Each reading points at a real
  cell, and the value in that cell is the value of the reading.
* The PDFs (``03``, ``12``) are read through a scripted ``FunctionModel`` that plays the
  Reader_Agent. Code checks every number it returns against the text layer.
"""

from __future__ import annotations

import asyncio
import io
import zipfile
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import openpyxl
import pytest
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo

from services.extractor.config import get_settings
from services.extractor.models import BEEPATSectorStream, CalendarParams, CalendarResponse, Reading
from services.extractor.pipeline import PipelineDeps, Upload, extract_calendar
from services.extractor.tests.conftest import (
    FixedModelProvider,
    ModelScript,
    make_function_model,
)
from services.extractor.workbook import a1, parse_a1

ZIP_PATH = Path("do-res/shyamrock_cement_works.zip")

pytestmark = pytest.mark.skipif(
    not ZIP_PATH.exists(), reason="do-res/shyamrock_cement_works.zip is not present"
)

FY = "FY2023-24"

PROFORMA = "15_sector_specific_proforma.xlsx"
SCADA_LOG = "01_scada_production_trend.xlsx"
CPP_LOG = "06_cpp_daily_generation_report.xlsx"
COAL_LAB_LOG = "08_coal_internal_lab_report.xlsx"
MONTHLY_PRODUCTION_PDF = "03_monthly_production_report.pdf"
GRID_BILL_PDF = "12_grid_electricity_bill.pdf"

Handler = Callable[[list[ModelMessage], AgentInfo], dict[str, Any]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def pack() -> dict[str, bytes]:
    """Every file of the zip, read in memory."""
    with zipfile.ZipFile(ZIP_PATH) as z:
        return {name: z.read(name) for name in z.namelist()}


def extract(
    pack: dict[str, bytes], name: str, handler: Handler | None = None
) -> tuple[CalendarResponse, ModelScript]:
    """Run one pack file through ``extract_calendar`` with a scripted model.

    The default script answers with an empty but valid output, so a spreadsheet label the
    rules cannot place stays unmapped.
    """
    script = ModelScript(handler)
    deps = PipelineDeps(get_settings(), FixedModelProvider(make_function_model(script)))
    response = asyncio.run(
        extract_calendar(Upload(name, pack[name]), CalendarParams(compliance_year=FY), deps)
    )
    return response, script


def by_stream(readings: list[Reading]) -> dict[BEEPATSectorStream, list[Reading]]:
    out: dict[BEEPATSectorStream, list[Reading]] = {}
    for r in readings:
        out.setdefault(r.stream_key, []).append(r)
    return out


def one(readings: list[Reading], stream: str) -> Reading:
    found = by_stream(readings).get(BEEPATSectorStream(stream), [])
    assert len(found) == 1, f"expected one {stream} reading, found {len(found)}"
    return found[0]


def prompt_text(script: ModelScript) -> str:
    """All text the model received across its calls."""
    return "\n".join(str(messages) for messages, _ in script.calls)


# ---------------------------------------------------------------------------
# Pro forma (15_sector_specific_proforma.xlsx)
# ---------------------------------------------------------------------------


class TestProforma:
    def test_clinker_production_converts_lakh_tonnes(self, pack: dict[str, bytes]) -> None:
        response, _ = extract(pack, PROFORMA)
        clinker = one(response.readings, "clinker_production")
        assert clinker.value_as_stated == "1.5"
        assert clinker.unit_as_stated == "Lakh t"
        assert clinker.normalized_value == pytest.approx(150000)
        assert clinker.normalized_unit == "t"
        assert clinker.period.kind == "annual"
        assert clinker.period.month_key == "annual"
        assert clinker.verified is True
        assert clinker.unit_assumed is False
        assert clinker.provenance.sheet == "1_Production"
        assert clinker.provenance.cell == "B6"
        assert clinker.provenance.page is None

    def test_coal_total_is_derived_from_process_and_power_coal(
        self, pack: dict[str, bytes]
    ) -> None:
        response, _ = extract(pack, PROFORMA)
        coal = one(response.readings, "coal_quantity")  # one reading, not three (D5)
        assert coal.derived is True
        assert coal.normalized_value == pytest.approx(34970)
        assert coal.normalized_unit == "t"
        assert "coal_total_mismatch" not in coal.review_reasons

    def test_grid_import_converts_lakh_kwh(self, pack: dict[str, bytes]) -> None:
        response, _ = extract(pack, PROFORMA)
        grid = one(response.readings, "grid_electricity")
        assert grid.value_as_stated == "30"
        assert grid.unit_as_stated == "Lakh kWh"
        assert grid.normalized_value == pytest.approx(3_000_000)
        assert grid.normalized_unit == "kWh"
        assert grid.provenance.sheet == "2_Energy_GtG_SEC"
        assert grid.provenance.cell == "B11"

    def test_provenance_is_the_real_sheet_and_cell(self, pack: dict[str, bytes]) -> None:
        response, _ = extract(pack, PROFORMA)
        assert response.readings
        for r in response.readings:
            assert r.source == "excel"
            assert r.provenance.page is None
            assert r.raw_id == f"{r.provenance.sheet}!{r.provenance.cell}"

    def test_no_calcination_reading_is_invented(self, pack: dict[str, bytes]) -> None:
        response, _ = extract(pack, PROFORMA)
        assert not [r for r in response.readings if "calcin" in r.stream_key.value]
        # 150000 t of clinker times 0.525 would be the old derived calcination figure.
        assert not [r for r in response.readings if r.normalized_value == pytest.approx(78750)]

    def test_fully_rule_mapped_workbook_needs_no_model(self, pack: dict[str, bytes]) -> None:
        response, script = extract(pack, PROFORMA)
        assert response.run.model_calls == 0
        assert script.calls == []
        assert response.unmapped == []


# ---------------------------------------------------------------------------
# Plant logs: dates down the rows, streams across the columns (01, 06, 08)
# ---------------------------------------------------------------------------


def _daily_values_match_cells(pack: dict[str, bytes], name: str, readings: list[Reading]) -> None:
    """Each reading carries the value and the date of its own source cell."""
    ws = openpyxl.load_workbook(io.BytesIO(pack[name]), data_only=True).worksheets[0]
    for r in readings:
        assert r.provenance.sheet == ws.title
        assert r.provenance.page is None
        assert r.raw_id == f"{ws.title}!{r.provenance.cell}"
        row, col = parse_a1(r.provenance.cell)
        assert a1(row, col) == r.provenance.cell
        assert r.value == pytest.approx(float(ws.cell(row=row, column=col).value))
        stamp = ws.cell(row=row, column=1).value  # the Date column
        assert r.period.kind == "daily"
        assert r.period.date == date.fromisoformat(str(stamp)[:10])
        assert r.period.month_key == "2023-11"


class TestDailyLogs:
    def test_scada_trend_gives_four_production_streams_per_day(
        self, pack: dict[str, bytes]
    ) -> None:
        response, script = extract(pack, SCADA_LOG)
        grouped = by_stream(response.readings)
        assert set(grouped) == {
            BEEPATSectorStream.CLINKER_PRODUCTION,
            BEEPATSectorStream.OPC_PRODUCTION,
            BEEPATSectorStream.PPC_PRODUCTION,
            BEEPATSectorStream.PSC_PRODUCTION,
        }
        for stream, readings in grouped.items():
            assert len(readings) == 30, stream
            assert {r.normalized_unit for r in readings} == {"t"}
        first = grouped[BEEPATSectorStream.CLINKER_PRODUCTION][0]
        assert first.provenance.cell == "B6"
        assert first.period.date == date(2023, 11, 1)
        assert first.value == pytest.approx(406.4)
        assert script.calls == []  # the status column holds no number, so no label is left over
        _daily_values_match_cells(pack, SCADA_LOG, response.readings)

    def test_cpp_report_gives_generation_in_kwh(self, pack: dict[str, bytes]) -> None:
        response, script = extract(pack, CPP_LOG)
        generation = by_stream(response.readings)[BEEPATSectorStream.CPP_GENERATION]
        assert len(generation) == 30
        assert {r.normalized_unit for r in generation} == {"kWh"}
        assert {r.unit_assumed for r in generation} == {False}
        assert generation[0].provenance.cell == "B6"
        assert generation[0].value == pytest.approx(28383.2)
        _daily_values_match_cells(pack, CPP_LOG, response.readings)

    def test_cpp_report_sends_only_leftover_labels_to_the_model(
        self, pack: dict[str, bytes]
    ) -> None:
        response, script = extract(pack, CPP_LOG)
        assert response.run.model_calls == 1
        assert response.unmapped == ["Running Hours", "Heat Rate (kcal/kWh)"]
        sent = prompt_text(script)
        assert "Running Hours" in sent
        assert "Gross Generation" not in sent

    def test_coal_lab_report_gives_daily_gcv(self, pack: dict[str, bytes]) -> None:
        response, _ = extract(pack, COAL_LAB_LOG)
        gcv = by_stream(response.readings)[BEEPATSectorStream.COAL_GCV]
        assert len(gcv) == 30
        assert {r.normalized_unit for r in gcv} == {"kcal/kg"}
        assert gcv[0].provenance.cell == "C6"
        assert gcv[0].value == pytest.approx(4219)
        assert set(by_stream(response.readings)) == {BEEPATSectorStream.COAL_GCV}
        assert response.unmapped == ["Ash (%)", "Moisture (%)", "Hydrogen (%)"]
        _daily_values_match_cells(pack, COAL_LAB_LOG, response.readings)


# ---------------------------------------------------------------------------
# PDFs, read by a scripted Reader_Agent and verified against the text layer
# ---------------------------------------------------------------------------


def _field(label: str, value: str, unit: str, source: str) -> dict[str, Any]:
    return {
        "label": label,
        "value_text": value,
        "unit_as_printed": unit,
        "period_text": "",
        "source_text": source,
        "confidence": 0.95,
    }


def _reader_and_mapper(
    fields: list[dict[str, Any]], mappings: list[dict[str, Any]] | None = None
) -> Handler:
    """A handler that answers the Reader_Agent with ``fields`` and the Mapper_Agent with ``mappings``."""

    def handler(messages: list[ModelMessage], info: AgentInfo) -> dict[str, Any]:
        properties = info.output_tools[0].parameters_json_schema.get("properties", {})
        if "fields" in properties:
            return {"page_period_text": "November 2023", "fields": fields}
        return {"mappings": mappings or []}

    return handler


class TestPdfs:
    def test_monthly_production_numbers_are_verified_in_the_text_layer(
        self, pack: dict[str, bytes]
    ) -> None:
        handler = _reader_and_mapper(
            [
                _field("Clinker Production", "12,500.0", "t", "Clinker Production 12,500.0"),
                _field("PPC Produced", "9,516.7", "t", "PPC Produced 9,516.7"),
            ]
        )
        response, _ = extract(pack, MONTHLY_PRODUCTION_PDF, handler)
        clinker = one(response.readings, "clinker_production")
        assert clinker.source == "pdf"
        assert clinker.value == pytest.approx(12500.0)
        assert clinker.normalized_unit == "t"
        assert clinker.period.kind == "monthly"
        assert clinker.period.month_key == "2023-11"
        assert clinker.verified is True
        assert clinker.needs_review is False
        assert clinker.provenance.page == 1
        assert clinker.provenance.sheet is None
        assert clinker.provenance.cell is None
        box = clinker.provenance.bbox
        assert box is not None and 0 <= box.x <= 1 and 0 <= box.y <= 1
        assert one(response.readings, "ppc_production").verified is True

    def test_label_the_rules_cannot_place_goes_to_the_mapper_and_is_flagged(
        self, pack: dict[str, bytes]
    ) -> None:
        handler = _reader_and_mapper(
            [_field("Units Consumed", "250,000", "kWh", "Units Consumed (kWh) 250,000")],
            [{"raw_id": "1:0", "stream_key": "grid_electricity", "reason": "grid bill", "confidence": 0.9}],
        )
        response, _ = extract(pack, GRID_BILL_PDF, handler)
        grid = one(response.readings, "grid_electricity")
        assert grid.value == pytest.approx(250000)
        assert grid.verified is True  # the number is in the text layer
        assert grid.mapping_source == "llm"
        assert grid.needs_review is True  # a model-made mapping always needs a person
        assert grid.confidence <= 0.7

    def test_number_absent_from_the_text_layer_is_flagged_not_trusted(
        self, pack: dict[str, bytes]
    ) -> None:
        handler = _reader_and_mapper(
            [_field("Clinker Production", "13,000.0", "t", "Clinker Production 13,000.0")]
        )
        response, _ = extract(pack, MONTHLY_PRODUCTION_PDF, handler)
        clinker = one(response.readings, "clinker_production")
        assert clinker.verified is False
        assert clinker.needs_review is True
        assert clinker.provenance.bbox is None
