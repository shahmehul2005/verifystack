"""
Comprehensive Test Suite for Pydantic AI Calendar Extraction Service.
Tests:
  - Model validation & boundary constraints
  - Deterministic unit normalizations (Indian cement operations)
  - Option 1A: Official BEE PAT-2 Proforma (.xls) parsing on real file
  - Option 1B: Standard 12-Month Template parser
  - Option 1C: Template Generator
  - Option 2:  Arbitrary Plant Excel Auto-Mapper
  - Pydantic AI Agent self-correcting validation loops
"""

import io
import os
import pytest
from pydantic import ValidationError

from services.extractor.models import (
    BEEPATSectorStream,
    CalendarReadingItem,
    ExtractionProvenance,
    NormalizedBBox,
    SourceType,
)
from services.extractor.unit_normalizer import normalize_reading_value
from services.extractor.excel_processor import (
    auto_map_arbitrary_excel,
    generate_blank_template,
    parse_bee_pat2_proforma,
    parse_fiscal_month,
    parse_verifystack_template,
)
from services.extractor.calendar_agent import create_calendar_agent


# ============================================================================
# 1. Model Validation & Edge Cases Tests
# ============================================================================

def test_calendar_reading_valid_monthly():
    item = CalendarReadingItem(
        stream_key=BEEPATSectorStream.COAL_QUANTITY,
        duration_kind="monthly",
        month_key="2023-04",
        source_type=SourceType.SOURCING,
        raw_value=21500.5,
        unit_as_printed="MT",
        normalized_value=21500.5,
        normalized_unit="t",
        confidence=0.98,
        provenance=ExtractionProvenance(
            page=1,
            bbox=NormalizedBBox(x=0.1, y=0.2, width=0.3, height=0.05),
            source_text="Total Coal: 21,500.5 MT",
        ),
    )
    assert item.month_key == "2023-04"
    assert item.source_type == SourceType.SOURCING
    assert item.provenance.page == 1


def test_calendar_reading_invalid_month_rejected():
    with pytest.raises(ValidationError):
        CalendarReadingItem(
            stream_key=BEEPATSectorStream.GRID_ELECTRICITY,
            month_key="2023-13",  # Month 13 is invalid!
            source_type=SourceType.SOURCING,
            raw_value=100000.0,
            unit_as_printed="kWh",
            provenance=ExtractionProvenance(
                page=1,
                source_text="100000 kWh",
            ),
        )


def test_provenance_requires_physical_locator():
    with pytest.raises(ValidationError):
        # Missing both page and cell_coordinate
        ExtractionProvenance(source_text="12345")


# ============================================================================
# 2. Unit Normalization Tests
# ============================================================================

def test_electricity_unit_normalizations():
    # Lakh kWh -> kWh (x 100,000)
    val, unit = normalize_reading_value(BEEPATSectorStream.GRID_ELECTRICITY, 15.5, "Lakh kWh")
    assert val == 1_550_000.0
    assert unit == "kWh"

    # MU -> kWh (x 1,000,000)
    val, unit = normalize_reading_value(BEEPATSectorStream.GRID_ELECTRICITY, 2.5, "MU")
    assert val == 2_500_000.0
    assert unit == "kWh"


def test_mass_unit_normalizations():
    # kg -> t (/ 1000)
    val, unit = normalize_reading_value(BEEPATSectorStream.COAL_QUANTITY, 500_000.0, "kg")
    assert val == 500.0
    assert unit == "t"

    # Quintals -> t (x 0.1)
    val, unit = normalize_reading_value(BEEPATSectorStream.COAL_QUANTITY, 120.0, "quintal")
    assert val == 12.0
    assert unit == "t"


def test_calorific_value_normalizations():
    # MJ/kg -> kcal/kg (1 MJ = ~239.006 kcal)
    val, unit = normalize_reading_value(BEEPATSectorStream.COAL_GCV, 17.58, "MJ/kg")
    assert pytest.approx(val, 0.1) == 4201.7
    assert unit == "kcal/kg"

    # kcal/kg -> kcal/kg (identity)
    val, unit = normalize_reading_value(BEEPATSectorStream.COAL_GCV, 4200.0, "kcal/kg")
    assert val == 4200.0
    assert unit == "kcal/kg"


# ============================================================================
# 3. Fiscal Month Parsing Edge Cases
# ============================================================================

def test_parse_fiscal_month_variants():
    # Apr-Dec belong to first year (2023)
    assert parse_fiscal_month("Apr-23", "2023-24") == "2023-04"
    assert parse_fiscal_month("April 2023", "2023-24") == "2023-04"
    assert parse_fiscal_month("2023-04", "2023-24") == "2023-04"

    # Jan-Mar belong to second year (2024 for FY2023-24)
    assert parse_fiscal_month("Jan-24", "2023-24") == "2024-01"
    assert parse_fiscal_month("February", "2023-24") == "2024-02"
    assert parse_fiscal_month("March 2024", "2023-24") == "2024-03"

    # Total / Annual
    assert parse_fiscal_month("Annual", "2023-24") == "annual"
    assert parse_fiscal_month("Total", "2023-24") == "annual"


# ============================================================================
# 4. OPTION 1A: Real BEE PAT-2 Cement Sector Proforma (.xls)
# ============================================================================

def test_parse_real_bee_pat2_proforma():
    proforma_path = r"c:\Users\user\Downloads\Cement Sector Performa (Old DC in PAT-2).xls"
    if not os.path.exists(proforma_path):
        pytest.skip(f"Proforma file not found at {proforma_path}")

    readings = parse_bee_pat2_proforma(proforma_path, compliance_year="2023-24")

    # Verify extracted streams
    assert len(readings) > 0

    streams_found = {r.stream_key for r in readings}
    # Form-Sb contains Clinker, Cement, Coal, Petcoke, Grid Electricity
    assert BEEPATSectorStream.CLINKER_PRODUCTION in streams_found
    assert BEEPATSectorStream.GRID_ELECTRICITY in streams_found
    assert BEEPATSectorStream.COAL_QUANTITY in streams_found
    assert BEEPATSectorStream.COAL_GCV in streams_found
    assert BEEPATSectorStream.CALCINATION_CO2 in streams_found  # Derived via 0.525 x Clinker

    # Check cell coordinates and provenance
    for r in readings:
        assert r.source_type == SourceType.PROFORMA
        assert r.month_key == "annual"
        assert r.provenance.cell_coordinate is not None
        assert "Form" in r.provenance.sheet_name


# ============================================================================
# 5. OPTION 1B & 1C: Template Generator & Ingest
# ============================================================================

def test_generate_and_parse_blank_template():
    # 1. Generate empty template bytes
    template_bytes = generate_blank_template(compliance_year="2023-24")
    assert len(template_bytes) > 1000

    # 2. Simulate filling 3 rows
    import pandas as pd
    test_df = pd.DataFrame([
        {"Month": "2023-04", "Stream": "clinker_production", "Value": 65000, "Unit": "MT", "Source": "corroboration"},
        {"Month": "2023-05", "Stream": "clinker_production", "Value": 67000, "Unit": "MT", "Source": "corroboration"},
        {"Month": "2023-04", "Stream": "grid_electricity", "Value": 15.2, "Unit": "Lakh kWh", "Source": "sourcing"},
    ])
    buf = io.BytesIO()
    test_df.to_excel(buf, index=False)
    filled_bytes = buf.getvalue()

    # 3. Parse back via parse_verifystack_template
    readings = parse_verifystack_template(filled_bytes)
    assert len(readings) == 3

    r_elec = [r for r in readings if r.stream_key == BEEPATSectorStream.GRID_ELECTRICITY][0]
    assert r_elec.raw_value == 15.2
    assert r_elec.normalized_value == 1_520_000.0  # Lakh kWh -> kWh
    assert r_elec.source_type == SourceType.SOURCING


# ============================================================================
# 6. OPTION 2: Arbitrary / Messy Plant Spreadsheet Auto-Mapper
# ============================================================================

def test_auto_map_arbitrary_plant_excel():
    # Simulate an internal messy plant MIS with custom headers
    import pandas as pd
    messy_df = pd.DataFrame({
        "Plant Month": ["Apr-23", "May-23", "Jun-23", "Jul-23", "Total"],
        "Total Clinker Prod (MT)": [60000, 62000, 61000, 63000, 246000],
        "Raw Coal Cons (t)": [20000, 21000, 20500, 21500, 83000],
        "Coal GCV (kcal/kg)": [4200, 4210, 4190, 4220, 4205],
        "Grid Power Purchase (Lakh kWh)": [15.0, 16.0, 15.5, 16.5, 63.0],
        "Random Unrelated Note": ["OK", "OK", "Rain", "OK", ""],
    })

    buf = io.BytesIO()
    messy_df.to_excel(buf, sheet_name="Monthly_MIS", index=False)
    file_bytes = buf.getvalue()

    readings, mappings, unmapped = auto_map_arbitrary_excel(file_bytes, compliance_year="2023-24")

    # Verify column mappings
    assert "Total Clinker Prod (MT)" in mappings
    assert mappings["Total Clinker Prod (MT)"] == "clinker_production"
    assert "Raw Coal Cons (t)" in mappings
    assert mappings["Raw Coal Cons (t)"] == "coal_quantity"
    assert "Grid Power Purchase (Lakh kWh)" in mappings
    assert mappings["Grid Power Purchase (Lakh kWh)"] == "grid_electricity"
    assert "Random Unrelated Note" in unmapped

    # Verify extracted rows: 4 valid months (16 monthly items) + 1 Total row (4 annual items) = 20 total
    assert len(readings) == 20
    monthly_readings = [r for r in readings if r.duration_kind == "monthly"]
    annual_readings = [r for r in readings if r.duration_kind == "annual"]
    assert len(monthly_readings) == 16
    assert len(annual_readings) == 4

    # Check power unit normalization on monthly readings
    power_readings = [r for r in readings if r.stream_key == BEEPATSectorStream.GRID_ELECTRICITY and r.duration_kind == "monthly"]
    assert len(power_readings) == 4
    assert power_readings[0].normalized_value == 1_500_000.0  # 15.0 Lakh kWh -> 1,500,000 kWh


# ============================================================================
# 7. Pydantic AI Agent Initialization & Self-Correction
# ============================================================================

def test_pydantic_ai_agent_creation():
    agent = create_calendar_agent(model_name="test")
    assert agent is not None
    # Verify agent runs in test mode
    res = agent.run_sync("Extract fuel data: Coal 20,000 MT in April 2023")
    assert res is not None


# ============================================================================
# 8. TWO-AGENT PIPELINE & DAILY GRANULARITY TESTS
# ============================================================================

def test_daily_scada_excel_two_agent_extraction():
    """Tests that daily plant logs are extracted as individual day readings."""
    import pandas as pd
    from services.extractor.raw_extractor import extract_raw_structure_from_excel
    from services.extractor.calendar_agent import process_raw_structure_with_rules

    daily_df = pd.DataFrame({
        "Date": ["01/04/2023", "02/04/2023", "03/04/2023", "15/04/2023"],
        "Kiln Clinker Prod (t/d)": [2100.5, 2150.0, 2080.0, 2200.0],
        "Coal Feed (MT)": [310.0, 315.0, 305.0, 320.0],
        "Grid Power (kWh)": [65000, 66000, 64000, 67000],
        "Shift Incharge": ["Ramesh", "Suresh", "Ramesh", "Dinesh"],  # Irrelevant administrative
        "Remarks": ["Smooth operation", "Normal", "Kiln speed 3.2", "Normal"],
    })

    buf = io.BytesIO()
    daily_df.to_excel(buf, sheet_name="Daily_SCADA", index=False)
    file_bytes = buf.getvalue()

    # Agent 1: Raw structural extraction
    raw_struct = extract_raw_structure_from_excel(file_bytes, document_name="daily_scada_apr23.xlsx")
    assert len(raw_struct.tables) == 1
    assert raw_struct.tables[0].sheet_or_page == "Daily_SCADA"

    # Agent 2: Semantic mapping & relevance filtering
    out = process_raw_structure_with_rules(raw_struct, compliance_year="2023-24")

    # Verify granularity and filtering
    assert out.granularity == "daily"
    assert out.filtered_irrelevant_count >= 2  # Filtered Shift Incharge and Remarks!

    # 4 rows x 3 streams = 12 daily readings
    assert len(out.readings) == 12

    # Check first reading attributes
    r1 = out.readings[0]
    assert r1.duration_kind == "daily"
    assert r1.date_key == "2023-04-01"
    assert r1.month_key == "2023-04"
    assert r1.stream_key == BEEPATSectorStream.CLINKER_PRODUCTION
    assert r1.normalized_value == 2100.5
    assert r1.source_type == SourceType.CORROBORATION


def test_factor_register_and_energy_calculations():
    """Tests comprehensive fuel-to-energy factor lookups and emission formulas."""
    from services.extractor.factors import (
        get_fuel_factor,
        calculate_fuel_emissions_tco2e,
        CLINKER_CALCINATION_FACTOR,
        CEA_GRID_EMISSION_FACTOR,
    )

    # 1. Lookups
    petcoke_def = get_fuel_factor("petcoke")
    assert petcoke_def is not None
    assert petcoke_def.default_gcv == 8200.0
    assert petcoke_def.emission_factor_tj == 97.5

    imported_coal_def = get_fuel_factor("imported_coal")
    assert imported_coal_def is not None
    assert imported_coal_def.default_gcv == 5800.0

    # 2. Emissions & Energy
    # 10,000 tonnes of petcoke at 8,200 kcal/kg
    energy_tj, emissions = calculate_fuel_emissions_tco2e("petcoke", quantity=10000.0, gcv_kcal=8200.0)
    assert energy_tj > 300.0
    assert emissions > 25000.0

    # 3. Calcination & Grid factors
    assert CLINKER_CALCINATION_FACTOR == 0.525
    assert CEA_GRID_EMISSION_FACTOR == 0.716
