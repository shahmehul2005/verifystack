"""Unit tests for ``tabular.py`` (the Tabular_Parser).

Covers Requirements 7.1 to 7.5, 7.8 and 7.9, and the parts of 7.6, 7.7 and 7.10 that the
three layouts share: header units, day-first dates and Excel serials, and real sheet and
cell provenance. Spreadsheet fixtures come from ``factories.py`` or openpyxl, so no binary
file is checked in.
"""

from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any

import openpyxl

from services.extractor.dates import parse_fy_label
from services.extractor.models import BEEPATSectorStream as S
from services.extractor.tabular import (
    MappedLabel,
    TabularContext,
    TabularResult,
    detect_tables,
    parse_tables,
)
from services.extractor.tests.factories import (
    long_table,
    periods_in_columns,
    periods_in_rows,
    with_merged_header,
)
from services.extractor.workbook import Workbook, load_workbook_bytes

FY = "FY2023-24"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse(data: bytes, fy: str | None = FY) -> tuple[Workbook, list[Any], TabularResult]:
    wb = load_workbook_bytes(data, "xlsx")
    shapes = [shape for sheet in wb.sheets for shape in detect_tables(sheet)]
    ctx = TabularContext(parse_fy_label(fy) if fy else None)
    return wb, shapes, parse_tables(wb, shapes, ctx)


def _mapped(result: TabularResult, stream: S) -> MappedLabel:
    found = [m for m in result.mapped if m.stream == stream]
    assert len(found) == 1, f"expected one {stream.value}, got {[m.label for m in result.mapped]}"
    return found[0]


def _by_cell(label: MappedLabel) -> dict[str, Any]:
    return {c.cell: c for c in label.cells}


def _xlsx(build: Any) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    build(ws)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Layouts (7.1, 7.2, 7.3)
# ---------------------------------------------------------------------------


class TestLongLayout:
    def test_reads_month_stream_value_unit_columns(self) -> None:
        data = long_table(
            [
                ("Apr-23", "clinker_production", 1000, "t"),
                ("May-23", "clinker_production", 1100, "t"),
                ("Apr-23", "coal_quantity", 50, "kg"),
            ]
        )
        _, shapes, result = _parse(data)

        assert [s.layout for s in shapes] == ["long"]
        assert shapes[0].header_rows == (1,)
        clinker = _mapped(result, S.CLINKER_PRODUCTION)
        cells = _by_cell(clinker)
        assert set(cells) == {"C2", "C3"}
        assert [c.period.month_key for c in clinker.cells] == ["2023-04", "2023-05"]
        assert all(c.period.kind == "monthly" for c in clinker.cells)
        assert [c.raw for c in clinker.cells] == [1000, 1100]
        assert {c.unit for c in clinker.cells} == {"t"}
        coal = _mapped(result, S.COAL_QUANTITY)
        assert coal.cells[0].unit == "kg"

    def test_unit_comes_from_value_header_parenthetical_without_a_unit_column(self) -> None:
        data = long_table(
            [("Apr-23", "clinker_production", 1000)], headers=("Month", "Stream", "Value (kg)")
        )
        _, _, result = _parse(data)

        assert _mapped(result, S.CLINKER_PRODUCTION).cells[0].unit == "kg"

    def test_unit_column_wins_over_header_parenthetical(self) -> None:
        data = long_table(
            [("Apr-23", "clinker_production", 1000, "t")],
            headers=("Month", "Stream", "Value (kg)", "Unit"),
        )
        _, _, result = _parse(data)

        assert _mapped(result, S.CLINKER_PRODUCTION).cells[0].unit == "t"

    def test_unmapped_label_goes_to_the_mapper_with_its_label_cell(self) -> None:
        data = long_table(
            [
                ("Apr-23", "clinker_production", 1000, "t"),
                ("Apr-23", "Mystery Thing", 5, "kg"),
            ]
        )
        _, _, result = _parse(data)

        assert [m.label for m in result.mapped] == ["clinker_production"]
        assert len(result.unmapped) == 1
        item = result.unmapped[0]
        assert item.label == "Mystery Thing"
        assert item.raw_id == "Calendar!B3"
        assert item.sheet == "Calendar"
        assert [(c.cell, c.raw) for c in item.cells] == [("C3", 5)]


class TestPeriodsInColumns:
    def test_date_headers_give_daily_periods(self) -> None:
        days = [datetime(2023, 4, 2), datetime(2023, 4, 3), datetime(2023, 4, 4)]
        data = periods_in_columns(
            days,
            [("Clinker Production (t)", [10, 11, 12]), ("Coal Quantity (t)", [1, 2, 3])],
        )
        _, shapes, result = _parse(data)

        assert [s.layout for s in shapes] == ["periods_in_columns"]
        clinker = _mapped(result, S.CLINKER_PRODUCTION)
        assert [c.cell for c in clinker.cells] == ["B2", "C2", "D2"]
        assert [c.period.kind for c in clinker.cells] == ["daily"] * 3
        assert [c.period.date for c in clinker.cells] == [d.date() for d in days]
        assert [c.period.month_key for c in clinker.cells] == ["2023-04"] * 3
        assert [c.raw for c in _mapped(result, S.COAL_QUANTITY).cells] == [1, 2, 3]

    def test_month_text_headers_give_monthly_periods(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23", "Jan-24"],
            [("Clinker Production", [1, 2, 3])],
        )
        _, _, result = _parse(data)

        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.period.kind for c in cells] == ["monthly"] * 3
        assert [c.period.month_key for c in cells] == ["2023-04", "2023-05", "2024-01"]
        assert all(c.period.date is None for c in cells)

    def test_first_of_month_date_headers_are_read_as_months(self) -> None:
        data = periods_in_columns(
            [date(2023, 4, 1), date(2023, 5, 1), date(2023, 6, 1)],
            [("Clinker Production (t)", [1, 2, 3])],
        )
        _, _, result = _parse(data)

        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.period.kind for c in cells] == ["monthly"] * 3
        assert [c.period.month_key for c in cells] == ["2023-04", "2023-05", "2023-06"]

    def test_bare_month_names_use_the_fiscal_year(self) -> None:
        data = periods_in_columns(["Apr", "Jan"], [("Clinker Production", [1, 2])])
        _, _, result = _parse(data)

        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.period.month_key for c in cells] == ["2023-04", "2024-01"]

    def test_bare_month_names_without_a_fiscal_year_are_skipped_with_a_reason(self) -> None:
        data = periods_in_columns(["Apr", "May"], [("Clinker Production", [1, 2])])
        _, _, result = _parse(data, fy=None)

        assert result.mapped == []
        assert [s.reason for s in result.skipped] == ["year_unresolved"] * 2
        assert [s.raw_id for s in result.skipped] == ["Data!B1", "Data!C1"]

    def test_unit_column_sets_the_unit_per_row(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23"],
            [("Clinker Production", [1, 2]), ("Coal Quantity", [3, "1,234.5"])],
            unit_column=True,
            units=["t", "kg"],
        )
        _, _, result = _parse(data)

        clinker = _mapped(result, S.CLINKER_PRODUCTION)
        coal = _mapped(result, S.COAL_QUANTITY)
        assert {c.unit for c in clinker.cells} == {"t"}
        assert {c.unit for c in coal.cells} == {"kg"}
        assert [c.cell for c in coal.cells] == ["C3", "D3"]
        # Numeric text is a data cell. The pipeline parses its value.
        assert coal.cells[1].raw == "1,234.5"

    def test_blank_and_text_cells_are_not_data(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23", "Jun-23"],
            [("Clinker Production (t)", [1, None, "n/a"])],
        )
        _, _, result = _parse(data)

        assert [c.cell for c in _mapped(result, S.CLINKER_PRODUCTION).cells] == ["B2"]


class TestPeriodsInRows:
    def test_reads_a_plant_log_with_header_units(self) -> None:
        days = [datetime(2023, 4, 1), datetime(2023, 4, 2), datetime(2023, 4, 3)]
        data = periods_in_rows(
            days,
            [
                ("Clinker Production (t)", [100, 110, 120]),
                ("Coal Consumed (kg)", [5, 6, 7]),
            ],
        )
        _, shapes, result = _parse(data)

        assert [s.layout for s in shapes] == ["periods_in_rows"]
        clinker = _mapped(result, S.CLINKER_PRODUCTION)
        assert [c.cell for c in clinker.cells] == ["B2", "B3", "B4"]
        assert {c.unit for c in clinker.cells} == {"t"}
        assert [c.period.date for c in clinker.cells] == [d.date() for d in days]
        coal = _mapped(result, S.COAL_QUANTITY)
        assert [c.cell for c in coal.cells] == ["C2", "C3", "C4"]
        assert {c.unit for c in coal.cells} == {"kg"}

    def test_month_rows_give_monthly_periods(self) -> None:
        data = periods_in_rows(
            ["Apr-23", "May-23"],
            [("Clinker Production (t)", [1, 2]), ("Coal Quantity (t)", [3, 4])],
            period_header="Month",
        )
        _, _, result = _parse(data)

        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.period.kind for c in cells] == ["monthly", "monthly"]
        assert [c.period.month_key for c in cells] == ["2023-04", "2023-05"]

    def test_unparseable_period_row_is_skipped_with_a_reason(self) -> None:
        data = periods_in_rows(
            [datetime(2023, 4, 1), "not a date"],
            [("Clinker Production (t)", [1, 2]), ("Coal Quantity (t)", [3, 4])],
        )
        _, _, result = _parse(data)

        assert [c.cell for c in _mapped(result, S.CLINKER_PRODUCTION).cells] == ["B2"]
        assert [s.reason for s in result.skipped] == ["period_unresolved"]
        assert result.skipped[0].detail == "not a date"

    def test_a_sheet_with_one_stream_column_is_not_a_table(self) -> None:
        data = periods_in_rows([datetime(2023, 4, 1)], [("Clinker Production (t)", [1])])
        wb = load_workbook_bytes(data, "xlsx")

        assert detect_tables(wb.sheets[0]) == []


# ---------------------------------------------------------------------------
# Header detection (7.4, 7.5)
# ---------------------------------------------------------------------------


class TestHeaderScoring:
    def test_highest_scoring_row_wins_over_decoy_rows_above_it(self) -> None:
        data = long_table(
            [("Apr-23", "clinker_production", 1000, "t")],
            title="Plant Monthly Report",
            leading_rows=[["Prepared by", "Plant head"], ["Stream", "Month", "Remarks"], []],
        )
        _, shapes, result = _parse(data)

        # Row 1 title, row 2 plain text, row 3 decoy (score 2), row 4 blank, row 5 real
        # header (score 4).
        assert len(shapes) == 1
        assert shapes[0].layout == "long"
        assert shapes[0].header_rows == (5,)
        assert shapes[0].score == 4
        assert [c.cell for c in _mapped(result, S.CLINKER_PRODUCTION).cells] == ["C6"]

    def test_earliest_row_wins_a_tie_between_valid_headers(self) -> None:
        def build(ws: Any) -> None:
            ws.append(["Date", "Clinker Production (t)", "Coal Quantity (t)"])  # row 1, score 3
            ws.append([datetime(2023, 4, 1), 1, 2])
            ws.append(["Date", "Clinker Production (t)", "Coal Quantity (t)"])  # row 3, score 3
            ws.append([datetime(2023, 4, 2), 3, 4])

        _, shapes, _ = _parse(_xlsx(build))

        assert shapes[0].header_rows == (1,)

    def test_a_sheet_with_fewer_than_two_recognized_labels_is_not_a_table(self) -> None:
        def build(ws: Any) -> None:
            ws.append(["Name", "Place", "Remarks"])
            ws.append(["A", "B", "C"])

        wb = load_workbook_bytes(_xlsx(build), "xlsx")

        assert detect_tables(wb.sheets[0]) == []

    def test_header_row_is_found_below_blank_rows(self) -> None:
        def build(ws: Any) -> None:
            ws.cell(row=5, column=2, value="Month")
            ws.cell(row=5, column=3, value="Stream")
            ws.cell(row=5, column=4, value="Value")
            ws.cell(row=6, column=2, value="Apr-23")
            ws.cell(row=6, column=3, value="clinker_production")
            ws.cell(row=6, column=4, value=900)

        _, shapes, result = _parse(_xlsx(build))

        assert shapes[0].header_rows == (5,)
        assert [c.cell for c in _mapped(result, S.CLINKER_PRODUCTION).cells] == ["D6"]


class TestMultiRowHeaders:
    def test_merged_group_headers_are_joined_into_the_column_name(self) -> None:
        data = with_merged_header(
            [
                ("Kiln 1", ["Clinker Production (t)", "Coal Consumed (t)"]),
                ("Kiln 2", ["Clinker Production (t)", "Coal Consumed (t)"]),
            ],
            ["Apr-23", "May-23"],
            [[10, 5, 11, 6], [12, 7, 13, 8]],
        )
        _, shapes, result = _parse(data)

        assert shapes[0].header_rows == (1, 2)
        labels = {m.label: m for m in result.mapped}
        assert set(labels) == {
            "Kiln 1 Clinker Production (t)",
            "Kiln 1 Coal Consumed (t)",
            "Kiln 2 Clinker Production (t)",
            "Kiln 2 Coal Consumed (t)",
        }
        kiln2_clinker = labels["Kiln 2 Clinker Production (t)"]
        assert kiln2_clinker.stream == S.CLINKER_PRODUCTION
        assert [c.cell for c in kiln2_clinker.cells] == ["D3", "D4"]
        assert [c.raw for c in kiln2_clinker.cells] == [11, 13]
        assert {c.unit for c in kiln2_clinker.cells} == {"t"}
        # The group header spans two columns, so both columns carry it.
        assert labels["Kiln 1 Coal Consumed (t)"].stream == S.COAL_QUANTITY

    def test_merged_period_header_spanning_both_header_rows_is_the_period_column(self) -> None:
        data = with_merged_header(
            [("Kiln 1", ["Clinker Production (t)", "Coal Consumed (t)"])],
            ["Apr-23", "May-23"],
            [[1, 2], [3, 4]],
        )
        _, shapes, result = _parse(data)

        assert shapes[0].layout == "periods_in_rows"
        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.period.month_key for c in cells] == ["2023-04", "2023-05"]

    def test_title_above_the_header_is_not_joined_but_steers_the_mapping(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23"],
            [("Quantity", [1, 2]), ("GCV", [3, 4])],
            title="Coal Consumption",
        )
        _, shapes, result = _parse(data)

        assert shapes[0].header_rows == (2,)
        assert "Coal Consumption" in shapes[0].title
        # The labels are not joined with the title, yet the title resolves them.
        assert {m.label for m in result.mapped} == {"Quantity", "GCV"}
        assert _mapped(result, S.COAL_QUANTITY).label == "Quantity"
        assert _mapped(result, S.COAL_GCV).label == "GCV"

    def test_wide_merged_title_is_not_joined_into_column_names(self) -> None:
        def build(ws: Any) -> None:
            ws.cell(row=1, column=1, value="Monthly Fuel Report")
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=3)
            ws.append(["Month", "Clinker Production (t)", "Coal Consumed (t)"])
            ws.append(["Apr-23", 1, 2])

        _, shapes, result = _parse(_xlsx(build))

        assert shapes[0].header_rows == (2,)
        assert "Monthly Fuel Report" in shapes[0].title
        assert {m.label for m in result.mapped} == {"Clinker Production (t)", "Coal Consumed (t)"}


# ---------------------------------------------------------------------------
# Dates (7.7)
# ---------------------------------------------------------------------------


class TestDates:
    def test_day_first_text_dates(self) -> None:
        data = long_table(
            [
                ("05/04/2023", "clinker_production", 1, "t"),
                ("15-May-23", "clinker_production", 2, "t"),
                ("1 June 2023", "clinker_production", 3, "t"),
            ],
            headers=("Date", "Stream", "Value", "Unit"),
        )
        _, _, result = _parse(data)

        periods = [c.period for c in _mapped(result, S.CLINKER_PRODUCTION).cells]
        assert [p.date for p in periods] == [date(2023, 4, 5), date(2023, 5, 15), date(2023, 6, 1)]
        assert [p.kind for p in periods] == ["daily"] * 3

    def test_excel_serial_and_real_date_cells_in_a_date_column(self) -> None:
        data = long_table(
            [
                (45017, "clinker_production", 1, "t"),  # 1 April 2023
                (datetime(2023, 4, 10), "clinker_production", 2, "t"),
            ],
            headers=("Date", "Stream", "Value", "Unit"),
        )
        _, _, result = _parse(data)

        dates = [c.period.date for c in _mapped(result, S.CLINKER_PRODUCTION).cells]
        assert dates == [date(2023, 4, 1), date(2023, 4, 10)]

    def test_unreadable_date_is_skipped_with_its_cell(self) -> None:
        data = long_table(
            [
                ("Apr-23", "clinker_production", 1, "t"),
                ("sometime", "clinker_production", 2, "t"),
            ]
        )
        _, _, result = _parse(data)

        assert [c.cell for c in _mapped(result, S.CLINKER_PRODUCTION).cells] == ["C2"]
        assert len(result.skipped) == 1
        assert result.skipped[0].raw_id == "Calendar!C3"
        assert result.skipped[0].reason == "period_unresolved"


# ---------------------------------------------------------------------------
# Total rows and columns (7.8)
# ---------------------------------------------------------------------------


class TestTotals:
    def test_total_rows_and_columns_are_skipped_in_periods_in_columns(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23"],
            [("Clinker Production (t)", [1, 2]), ("Coal Quantity (t)", [3, 4])],
            total_column=True,
            total_row=True,
        )
        _, _, result = _parse(data)

        assert {m.label for m in result.mapped} == {"Clinker Production (t)", "Coal Quantity (t)"}
        assert result.unmapped == []
        cells = {c.cell for m in result.mapped for c in m.cells}
        # B and C hold the months. D is the Total column. Row 4 is the Total row.
        assert cells == {"B2", "C2", "B3", "C3"}

    def test_total_rows_are_skipped_in_periods_in_rows(self) -> None:
        data = periods_in_rows(
            [datetime(2023, 4, 1), datetime(2023, 4, 2)],
            [("Clinker Production (t)", [1, 2]), ("Coal Quantity (t)", [3, 4])],
            total_row=True,
        )
        _, _, result = _parse(data)

        cells = {c.cell for m in result.mapped for c in m.cells}
        assert cells == {"B2", "B3", "C2", "C3"}
        assert result.skipped == []

    def test_total_variants_are_skipped_in_a_long_table(self) -> None:
        data = long_table(
            [
                ("Apr-23", "clinker_production", 1000, "t"),
                ("Total", "clinker_production", 1000, "t"),
                ("Apr-23", "Grand Total", 9, "t"),
                ("Apr-23", "Sub-total", 9, "t"),
                ("Apr-23", "Subtotal", 9, "t"),
            ]
        )
        _, _, result = _parse(data)

        assert [(m.label, [c.cell for c in m.cells]) for m in result.mapped] == [
            ("clinker_production", ["C2"])
        ]
        assert result.unmapped == []
        assert result.skipped == []

    def test_a_label_that_merely_contains_total_is_kept(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23"],
            [("Total Clinker Production", [1, 2]), ("Coal Quantity", [3, 4])],
        )
        _, _, result = _parse(data)

        assert _mapped(result, S.CLINKER_PRODUCTION).label == "Total Clinker Production"


# ---------------------------------------------------------------------------
# Fiscal year window (7.9)
# ---------------------------------------------------------------------------


class TestFiscalYearWindow:
    def test_out_of_year_date_is_flagged_and_warned_with_the_date(self) -> None:
        data = periods_in_rows(
            [datetime(2023, 4, 1), datetime(2024, 3, 31), datetime(2024, 4, 5)],
            [("Clinker Production (t)", [1, 2, 3]), ("Coal Quantity (t)", [4, 5, 6])],
        )
        _, _, result = _parse(data)

        clinker = _mapped(result, S.CLINKER_PRODUCTION)
        reasons = {c.cell: c.review_reasons for c in clinker.cells}
        # Both window edges are inside. Only 5 April 2024 is out.
        assert reasons == {"B2": [], "B3": [], "B4": ["outside_fiscal_year"]}
        assert len(result.warnings) == 1
        warning = result.warnings[0]
        assert warning.code == "outside_fiscal_year"
        assert "2024-04-05" in warning.message
        assert warning.raw_id == "Log!B4"

    def test_the_day_before_the_window_is_flagged(self) -> None:
        data = periods_in_columns(
            [datetime(2023, 3, 31), datetime(2023, 4, 1)],
            [("Clinker Production (t)", [1, 2])],
        )
        _, _, result = _parse(data)

        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.review_reasons for c in cells] == [["outside_fiscal_year"], []]
        assert "2023-03-31" in result.warnings[0].message

    def test_out_of_year_month_is_flagged_in_a_long_table(self) -> None:
        data = long_table(
            [
                ("Apr-23", "clinker_production", 1, "t"),
                ("Apr-24", "clinker_production", 2, "t"),
            ]
        )
        _, _, result = _parse(data)

        cells = _mapped(result, S.CLINKER_PRODUCTION).cells
        assert [c.review_reasons for c in cells] == [[], ["outside_fiscal_year"]]
        assert len(result.warnings) == 1
        assert "2024-04" in result.warnings[0].message

    def test_each_out_of_year_date_is_warned_once(self) -> None:
        data = periods_in_rows(
            [datetime(2024, 4, 5)],
            [("Clinker Production (t)", [1]), ("Coal Quantity (t)", [2])],
        )
        _, _, result = _parse(data)

        # Two streams share the date, and the date is warned about once.
        assert len(result.warnings) == 1
        flagged = [c for m in result.mapped for c in m.cells if c.review_reasons]
        assert len(flagged) == 2

    def test_no_flag_without_a_fiscal_year(self) -> None:
        data = periods_in_rows(
            [datetime(2030, 1, 1)],
            [("Clinker Production (t)", [1]), ("Coal Quantity (t)", [2])],
        )
        _, _, result = _parse(data, fy=None)

        assert result.warnings == []
        assert all(c.review_reasons == [] for m in result.mapped for c in m.cells)


# ---------------------------------------------------------------------------
# Provenance (7.10, 6.12)
# ---------------------------------------------------------------------------


class TestProvenance:
    def test_cells_carry_the_real_sheet_name_and_cell_address(self) -> None:
        data = periods_in_rows(
            [datetime(2023, 4, 1), datetime(2023, 4, 2)],
            [("Clinker Production (t)", [7, 8]), ("Coal Quantity (t)", [9, 10])],
            sheet="Kiln Log",
        )
        _, _, result = _parse(data)

        cells = _by_cell(_mapped(result, S.CLINKER_PRODUCTION))
        assert cells["B2"].sheet == "Kiln Log"
        assert cells["B2"].raw == 7
        assert cells["B3"].raw == 8
        assert all(c.sheet == "Kiln Log" for m in result.mapped for c in m.cells)
        assert "Kiln Log!B2" == f"{cells['B2'].sheet}!{cells['B2'].cell}"

    def test_column_beyond_z_uses_a_multi_letter_address(self) -> None:
        def build(ws: Any) -> None:
            ws.cell(row=1, column=1, value="Month")
            ws.cell(row=1, column=28, value="Clinker Production (t)")  # AB
            ws.cell(row=1, column=29, value="Coal Quantity (t)")  # AC
            ws.cell(row=2, column=1, value="Apr-23")
            ws.cell(row=2, column=28, value=11)
            ws.cell(row=2, column=29, value=12)

        _, _, result = _parse(_xlsx(build))

        assert [c.cell for c in _mapped(result, S.CLINKER_PRODUCTION).cells] == ["AB2"]
        assert [c.cell for c in _mapped(result, S.COAL_QUANTITY).cells] == ["AC2"]
        assert _mapped(result, S.CLINKER_PRODUCTION).raw_id == "Sheet!AB1"

    def test_every_cell_address_is_a_real_data_cell(self) -> None:
        data = periods_in_columns(
            ["Apr-23", "May-23"],
            [("Clinker Production (t)", [1, 2]), ("Coal Quantity (t)", [3, 4])],
        )
        _, _, result = _parse(data)

        for label in result.mapped:
            for c in label.cells:
                assert c.sheet == "Data"
                assert c.cell in {"B2", "C2", "B3", "C3"}
