"""Unit tests for the Pro_Forma_Parser.

Covers header context (Baseline versus Current), a missing Current value, formula cells,
the derived coal total, and the absence of any calcination output.

**Validates: Requirements 6.1, 6.2, 6.3, 6.6, 6.10, 6.11**
"""

from __future__ import annotations

import io
from typing import Any

import openpyxl

from services.extractor.models import BEEPATSectorStream, Reading
from services.extractor.proforma import (
    ProformaResult,
    match_targets,
    parse_proforma,
    score_sheet,
)
from services.extractor.workbook import Workbook, load_workbook_bytes

from .factories import proforma_workbook

S = BEEPATSectorStream


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse(data: bytes) -> ProformaResult:
    wb = load_workbook_bytes(data, "xlsx")
    return parse_proforma(wb, wb.sheets)


def load(data: bytes) -> Workbook:
    return load_workbook_bytes(data, "xlsx")


def by_stream(result: ProformaResult) -> dict[str, Reading]:
    return {r.stream_key.value: r for r in result.readings}


def codes(result: ProformaResult) -> list[str]:
    return [w.code for w in result.warnings]


def build(fill: Any, sheet: str = "Form-Sb") -> bytes:
    """Build a workbook by calling ``fill(ws)`` on a fresh sheet."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    fill(ws)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Label-anchored reading (6.1, 6.2)
# ---------------------------------------------------------------------------


def test_reads_the_nearest_numeric_cell_right_of_the_label() -> None:
    def fill(ws: Any) -> None:
        ws["B3"] = "Clinker Production (t)"
        ws["C3"] = "note"  # text is skipped
        ws["D3"] = 150000

    reading = by_stream(parse(build(fill)))["clinker_production"]
    assert reading.value == 150000
    assert reading.normalized_value == 150000
    assert reading.normalized_unit == "t"
    assert reading.provenance.sheet == "Form-Sb"
    assert reading.provenance.cell == "D3"
    assert reading.provenance.page is None
    assert reading.raw_id == "Form-Sb!D3"


def test_reading_shape_for_a_proforma_value() -> None:
    reading = by_stream(parse(proforma_workbook([("Clinker Production (t)", 150000)])))[
        "clinker_production"
    ]
    assert reading.source_type.value == "proforma"
    assert reading.source == "excel"
    assert reading.period.kind == "annual"
    assert reading.period.month_key == "annual"
    assert reading.mapping_source == "proforma_label"
    assert reading.verified is True
    assert reading.derived is False
    assert reading.needs_review is False
    assert reading.confidence == 1.0


def test_label_unit_is_converted_to_the_standard_unit() -> None:
    result = parse(proforma_workbook([("Clinker Production (Lakh t)", 1.5)]))
    reading = by_stream(result)["clinker_production"]
    assert reading.value == 1.5
    assert reading.unit_as_stated == "Lakh t"
    assert reading.normalized_value == 150000
    assert reading.normalized_unit == "t"
    assert reading.unit_assumed is False


def test_label_without_unit_uses_the_standard_unit_and_is_flagged() -> None:
    result = parse(proforma_workbook([("Imported from grid", 3_000_000)]))
    reading = by_stream(result)["grid_electricity"]
    assert reading.normalized_value == 3_000_000
    assert reading.normalized_unit == "kWh"
    assert reading.unit_assumed is True
    assert reading.needs_review is True
    assert "unit_assumed" in reading.review_reasons


def test_moving_the_table_gives_the_same_readings() -> None:
    rows = [("Clinker Production (t)", 150000), ("Imported Coal GCV (kcal/kg)", 6100)]
    base = {k: r.normalized_value for k, r in by_stream(parse(proforma_workbook(rows))).items()}
    assert base == {"clinker_production": 150000, "imported_coal_gcv": 6100}
    moved = proforma_workbook(rows, row_offset=12, col_offset=30, gap_rows=1)
    got = by_stream(parse(moved))
    assert {k: r.normalized_value for k, r in got.items()} == base
    # The real cell is reported, past column Z.
    assert got["clinker_production"].provenance.cell == "AF13"


def test_factor_and_energy_rows_are_not_read_as_quantities() -> None:
    result = parse(
        proforma_workbook(
            [
                ("Coal Energy (TJ)", 999),
                ("EF Coal", 2.5),
                ("Clinker Factor", 0.8),
                ("Clinker Production (t)", 150000),
            ]
        )
    )
    assert list(by_stream(result)) == ["clinker_production"]


def test_non_numeric_neighbours_give_no_reading_and_a_warning() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Clinker Production (t)"
        ws["B1"] = "n/a"

    result = parse(build(fill))
    assert result.readings == []
    assert "value_not_found" in codes(result)


def test_score_sheet_counts_distinct_targets() -> None:
    wb = load(
        proforma_workbook(
            [
                ("Clinker Production (t)", 1),
                ("Clinker Production (t)", 2),  # same target again
                ("Imported Coal GCV (kcal/kg)", 3),
            ]
        )
    )
    assert score_sheet(wb.sheets[0]) == 2
    other = load(proforma_workbook([("Month", "Jan"), ("Remarks", "none")]))
    assert score_sheet(other.sheets[0]) == 0


def test_match_targets_ignores_a_trailing_unit_and_non_text() -> None:
    assert [t.key for t in match_targets("Clinker Production (Lakh t)")] == ["clinker_production"]
    assert match_targets(None) == []  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Header context (6.3)
# ---------------------------------------------------------------------------


def test_current_column_is_read_not_baseline() -> None:
    rows = [("Clinker Production (t)", 100000, 150000), ("Imported Coal GCV (kcal/kg)", 5800, 6100)]
    for current_first in (False, True):
        data = proforma_workbook(rows, baseline_current=True, current_first=current_first)
        got = by_stream(parse(data))
        assert got["clinker_production"].value == 150000
        assert got["imported_coal_gcv"].value == 6100


def test_assessment_year_header_counts_as_current() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Particulars"
        ws["B1"] = "Baseline Year"
        ws["C1"] = "Assessment Year"
        ws["A2"] = "Clinker Production (t)"
        ws["B2"] = 100
        ws["C2"] = 200

    assert by_stream(parse(build(fill)))["clinker_production"].value == 200


def test_header_row_far_above_the_label_still_applies() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Particulars"
        ws["B1"] = "Baseline"
        ws["C1"] = "Current"
        ws["A2"] = "Section A"
        ws["A3"] = "Section B"
        ws["A4"] = "Section C"
        ws["A5"] = "Clinker Production (t)"
        ws["B5"] = 100
        ws["C5"] = 200

    assert by_stream(parse(build(fill)))["clinker_production"].value == 200


def test_merged_current_header_spans_its_columns() -> None:
    def fill(ws: Any) -> None:
        ws["B1"] = "Baseline"
        ws["C1"] = "Current Year"
        ws.merge_cells("C1:D1")
        ws["A2"] = "Clinker Production (t)"
        ws["B2"] = 100
        ws["D2"] = 250  # under the second half of the merged header

    assert by_stream(parse(build(fill)))["clinker_production"].value == 250


def test_the_nearest_header_above_each_label_applies() -> None:
    """Two blocks with different column orders each read their own Current column."""

    def fill(ws: Any) -> None:
        ws["B1"] = "Baseline"
        ws["C1"] = "Current"
        ws["A2"] = "Clinker Production (t)"
        ws["B2"] = 1
        ws["C2"] = 2
        ws["B4"] = "Current"
        ws["C4"] = "Baseline"
        ws["A5"] = "Imported Coal GCV (kcal/kg)"
        ws["B5"] = 6100
        ws["C5"] = 5800

    got = by_stream(parse(build(fill)))
    assert got["clinker_production"].value == 2
    assert got["imported_coal_gcv"].value == 6100


def test_missing_current_value_gives_no_reading_and_never_falls_back_to_baseline() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Particulars"
        ws["B1"] = "Baseline"
        ws["C1"] = "Current"
        ws["A2"] = "Clinker Production (t)"
        ws["B2"] = 100000  # baseline only, Current is blank
        ws["A3"] = "Imported Coal GCV (kcal/kg)"
        ws["B3"] = 5800
        ws["C3"] = "n/a"  # text in the Current column

    result = parse(build(fill))
    assert result.readings == []
    assert codes(result).count("current_value_missing") == 2
    assert all(
        w.raw_id in ("Form-Sb!A2", "Form-Sb!A3")
        for w in result.warnings
        if w.code == "current_value_missing"
    )


def test_without_a_baseline_header_the_right_hand_value_is_read() -> None:
    """A Current header alone is not a year-column header, so the nearest number wins."""

    def fill(ws: Any) -> None:
        ws["B1"] = "Current"
        ws["A2"] = "Clinker Production (t)"
        ws["B2"] = 7

    assert by_stream(parse(build(fill)))["clinker_production"].value == 7


# ---------------------------------------------------------------------------
# Formula cells (6.6)
# ---------------------------------------------------------------------------


def test_formula_without_a_cached_value_is_evaluated() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Clinker Production (t)"
        ws["B1"] = "=C1*2"
        ws["C1"] = 75000

    wb = load(build(fill))
    assert wb.sheets[0].cells[(1, 2)].value is None  # openpyxl wrote no cache
    reading = by_stream(parse_proforma(wb, wb.sheets))["clinker_production"]
    assert reading.value == 150000
    assert reading.provenance.cell == "B1"
    assert reading.provenance.formula == "=C1*2"


def test_formula_can_reference_another_sheet() -> None:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Form-Sb"
    data_ws = wb.create_sheet("Data")
    data_ws["A1"] = 30
    data_ws["A2"] = 45
    ws["A1"] = "Imported from grid (kWh)"
    ws["B1"] = "=SUM(Data!A1:A2)*1000"
    buf = io.BytesIO()
    wb.save(buf)

    loaded = load(buf.getvalue())
    result = parse_proforma(loaded, [loaded.sheet("Form-Sb")])  # type: ignore[list-item]
    assert by_stream(result)["grid_electricity"].value == 75000


def test_formula_can_be_the_current_column_value() -> None:
    def fill(ws: Any) -> None:
        ws["B1"] = "Baseline"
        ws["C1"] = "Current"
        ws["A2"] = "Clinker Production (t)"
        ws["B2"] = 1
        ws["C2"] = "=ROUND(10.5,0)+B2"

    assert by_stream(parse(build(fill)))["clinker_production"].value == 12


def test_unsupported_formula_gives_no_reading_and_a_warning_naming_the_cell() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Clinker Production (t)"
        ws["B1"] = '=VLOOKUP(1,C1:D2,2,FALSE)'
        ws["C1"] = 5  # a later number must not be picked up instead

    result = parse(build(fill))
    assert result.readings == []
    warning = next(w for w in result.warnings if w.code == "formula_not_evaluated")
    assert warning.raw_id == "Form-Sb!B1"
    assert "B1" in warning.message


def test_formula_with_a_text_operand_gives_no_reading() -> None:
    def fill(ws: Any) -> None:
        ws["A1"] = "Clinker Production (t)"
        ws["B1"] = "=C1+1"
        ws["C1"] = "abc"

    result = parse(build(fill))
    assert result.readings == []
    assert "formula_not_evaluated" in codes(result)


def test_formula_with_a_cached_value_uses_the_cache() -> None:
    wb = load(proforma_workbook([("Clinker Production (t)", 150000)]))
    cell = wb.sheets[0].cells[(1, 2)]
    cell.formula = "=1+1"  # the cache (150000) must win
    reading = by_stream(parse_proforma(wb, wb.sheets))["clinker_production"]
    assert reading.value == 150000
    assert reading.provenance.formula is None


# ---------------------------------------------------------------------------
# Coal total (6.10)
# ---------------------------------------------------------------------------

PROCESS = "Coal consumed in process (t)"
POWER = "Coal consumed in power (t)"
TOTAL = "Total coal consumed (t)"


def test_coal_total_is_the_derived_sum_of_process_and_power() -> None:
    result = parse(proforma_workbook([(PROCESS, 30000), (POWER, 4970)]))
    got = by_stream(result)
    assert list(got) == ["coal_quantity"]
    coal = got["coal_quantity"]
    assert coal.derived is True
    assert coal.value == 34970
    assert coal.normalized_value == 34970
    assert coal.normalized_unit == "t"
    assert coal.needs_review is False
    assert coal.provenance.page is None
    assert coal.provenance.sheet == "Form-Sb"
    # The source text names both cells and their values.
    text = coal.provenance.source_text or ""
    assert "Form-Sb!B1" in text and "Form-Sb!B2" in text
    assert "30000" in text and "4970" in text


def test_coal_halves_are_converted_before_they_are_added() -> None:
    result = parse(
        proforma_workbook([("Coal consumed in process (Lakh t)", 0.3), (POWER, 4000)])
    )
    assert by_stream(result)["coal_quantity"].normalized_value == 34000


def test_matching_declared_total_adds_no_flag() -> None:
    result = parse(proforma_workbook([(PROCESS, 30000), (POWER, 4970), (TOTAL, 34970)]))
    coal = by_stream(result)["coal_quantity"]
    assert coal.derived is True
    assert coal.value == 34970
    assert "coal_total_mismatch" not in coal.review_reasons
    assert "coal_total_mismatch" not in codes(result)


def test_declared_total_within_tolerance_adds_no_flag() -> None:
    # 0.05% off, below the 0.1% tolerance.
    result = parse(proforma_workbook([(PROCESS, 30000), (POWER, 4970), (TOTAL, 34987)]))
    assert "coal_total_mismatch" not in by_stream(result)["coal_quantity"].review_reasons


def test_declared_total_that_differs_is_flagged_and_the_derived_value_is_kept() -> None:
    result = parse(proforma_workbook([(PROCESS, 30000), (POWER, 4970), (TOTAL, 40000)]))
    coal = by_stream(result)["coal_quantity"]
    assert coal.value == 34970  # the declared total never replaces the sum
    assert coal.derived is True
    assert "coal_total_mismatch" in coal.review_reasons
    assert coal.needs_review is True
    mismatch = next(w for w in result.warnings if w.code == "coal_total_mismatch")
    assert "34970" in mismatch.message and "40000" in mismatch.message


def test_only_one_coal_half_emits_nothing() -> None:
    for rows in ([(PROCESS, 30000)], [(POWER, 4970)], [(PROCESS, 30000), (TOTAL, 30000)]):
        result = parse(proforma_workbook(rows))
        assert "coal_quantity" not in by_stream(result)
        assert result.readings == []
        assert "coal_total_not_derived" in codes(result)


def test_declared_total_alone_is_the_only_coal_figure() -> None:
    result = parse(proforma_workbook([(TOTAL, 34970)]))
    coal = by_stream(result)["coal_quantity"]
    assert coal.value == 34970
    assert coal.derived is False


def test_coal_halves_without_units_are_flagged_unit_assumed() -> None:
    result = parse(
        proforma_workbook([("Coal consumed in process", 30000), ("Coal consumed in power", 4970)])
    )
    coal = by_stream(result)["coal_quantity"]
    assert coal.unit_assumed is True
    assert "unit_assumed" in coal.review_reasons


def test_internal_coal_cells_are_never_emitted_on_their_own() -> None:
    result = parse(proforma_workbook([(PROCESS, 30000), (POWER, 4970), (TOTAL, 34970)]))
    assert len(result.readings) == 1


def test_coal_and_other_fuels_do_not_cross_match() -> None:
    result = parse(
        proforma_workbook(
            [
                (PROCESS, 30000),
                (POWER, 4970),
                ("Imported coal consumed (t)", 2500),
                ("Pet coke consumed (t)", 800),
                ("Coal GCV (kcal/kg)", 5200),
            ]
        )
    )
    got = by_stream(result)
    assert got["coal_quantity"].value == 34970
    assert got["imported_coal_quantity"].value == 2500
    assert got["petcoke_quantity"].value == 800
    assert got["coal_gcv"].value == 5200


# ---------------------------------------------------------------------------
# No calcination output (6.11)
# ---------------------------------------------------------------------------


def test_no_calcination_reading_or_constant_is_produced() -> None:
    result = parse(
        proforma_workbook(
            [
                ("Clinker Production (t)", 150000),
                ("Calcination emissions (tCO2)", 78750),
                ("Process emission factor (tCO2/t clinker)", 0.525),
                ("Calcination factor", 0.525),
            ]
        )
    )
    assert list(by_stream(result)) == ["clinker_production"]
    for reading in result.readings:
        assert "calcination" not in reading.stream_key.value
        assert reading.value != 150000 * 0.525
        assert reading.normalized_value != 150000 * 0.525


def test_no_target_in_the_table_is_a_calcination_target() -> None:
    from services.extractor.proforma import TARGETS

    for target in TARGETS:
        assert "calcin" not in target.key
        assert "emission" not in target.key
        assert target.stream is None or "calcin" not in target.stream.value
