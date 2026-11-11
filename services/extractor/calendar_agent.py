"""
Pydantic AI Calendar Extraction Agent.
Validates and maps unstructured document extractions and tabular sheets
into the 12-month fiscal calendar schema with self-correcting validation loops.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

from pydantic_ai import Agent, RunContext

from .models import (
    BEEPATSectorStream,
    CalendarReadingItem,
    ExtractionProvenance,
    NormalizedBBox,
    SourceType,
)
from .unit_normalizer import normalize_reading_value

# Disable pydantic-ai banner in CLI outputs
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")


class CalendarBatchExtractionOutput(BaseModel):
    """Structured result from extracting compliance readings."""
    readings: List[CalendarReadingItem] = Field(default_factory=list)
    detected_source_type: SourceType = SourceType.SOURCING
    summary: str = Field(..., description="Brief 1-sentence audit summary of extracted readings")
    warnings: List[str] = Field(default_factory=list)


class ExcelColumnMappingOutput(BaseModel):
    """Structured result from analyzing arbitrary plant spreadsheets."""
    sheet_name: str
    date_column: str = Field(..., description="Header of the date/month column")
    stream_mappings: Dict[str, BEEPATSectorStream] = Field(
        ...,
        description="Mapping from spreadsheet column header name to BEEPATSectorStream enum"
    )
    unit_hints: Dict[str, str] = Field(
        default_factory=dict,
        description="Inferred or stated unit for each mapped column"
    )
    source_type: SourceType = Field(
        default=SourceType.CORROBORATION,
        description="Inferred source layer (sourcing, corroboration, or proforma)"
    )
    reasoning: str = Field(..., description="Why these columns correspond to the chosen BEE streams")


SYSTEM_PROMPT_CALENDAR = """
You are a senior Greenhouse Gas Verification Auditor specialized in Indian Cement Sector compliance (BEE PAT Scheme and CCTS).
Your job is to extract verified operational numbers from compliance documents (fuel bills, electricity invoices, weighbridge slips, lab test certificates, ERP logs).

Strict Invariants:
1. Every reading must be classified into exactly one BEE PAT-2 Cement Stream:
   - Production: clinker_production, opc_production, ppc_production, psc_production, equivalent_product
   - Solid Fuels: coal_quantity (MT), coal_gcv (kcal/kg), petcoke_quantity, petcoke_gcv, imported_coal_quantity, imported_coal_gcv, biomass_afr_quantity, biomass_afr_gcv
   - Liquid Fuels: fo_quantity (kL), fo_gcv (kcal/kg), hsd_quantity (kL), hsd_gcv
   - Electricity: grid_electricity (kWh), cpp_generation (kWh), whrs_generation (kWh), power_export (kWh)
   - Process: calcination_co2 (tCO2e), raw_meal_calcination (tCO2e)
2. Every reading must have a duration:
   - If for a specific month, format strictly as 'YYYY-MM' (e.g. '2023-04', '2023-05', etc.). Remember Indian FY starts April and ends March.
   - If for the full compliance year, format as 'annual'.
3. Every reading must specify its evidence source layer:
   - 'sourcing': Primary vendor bills, weighbridge slips, DISCOM electricity invoices.
   - 'corroboration': Internal plant logs, SCADA exports, shift reports, NABL lab certificates.
   - 'proforma': Official declared Form 1 or Form-Sb proforma return.
4. Report units exactly as printed on the document (e.g. 'MT', 'Lakh kWh', 'kcal/kg').
5. Provenance is mandatory: Include the page number and verbatim text read from the page.
6. Accuracy over completeness: If a value or date is ambiguous, skip it or report confidence < 0.7. Never invent or calculate numbers.
"""

SYSTEM_PROMPT_EXCEL_MAPPER = """
You are an expert industrial data engineer for Cement Manufacturing Plants.
Plants upload internal spreadsheets (monthly MIS, SCADA logs, energy balances) with idiosyncratic column names.
Your task is to analyze spreadsheet headers and sample rows to map columns to the official BEE PAT-2 Cement Sector Streams.

Available Streams:
- clinker_production, opc_production, ppc_production, psc_production, equivalent_product
- coal_quantity, coal_gcv, petcoke_quantity, petcoke_gcv, imported_coal_quantity, imported_coal_gcv, biomass_afr_quantity
- fo_quantity, fo_gcv, hsd_quantity, hsd_gcv
- grid_electricity, cpp_generation, whrs_generation, power_export

Identify:
1. The Date / Month column.
2. Which column maps to which stream.
3. Inferred units from column headers (e.g. 'MT', 'Tonne', 'Lakh kWh', 'MU', 'kcal/kg').
4. The likely evidence layer ('sourcing' if invoices/dispatch, 'corroboration' if internal SCADA/ERP).
"""


def get_default_model() -> str:
    """Select available model based on environment keys."""
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "google-gla:gemini-1.5-flash"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai:gpt-4o-mini"
    # Fallback for testing environments
    return "test"


def create_calendar_agent(model_name: Optional[str] = None) -> Agent:
    """Create a Pydantic AI extraction agent with self-correcting validation."""
    model = model_name or get_default_model()
    agent = Agent(
        model,
        output_type=CalendarBatchExtractionOutput,
        system_prompt=SYSTEM_PROMPT_CALENDAR,
        retries=3,
    )
    return agent


def create_excel_mapper_agent(model_name: Optional[str] = None) -> Agent:
    """Create a Pydantic AI table mapping agent for arbitrary spreadsheets."""
    model = model_name or get_default_model()
    agent = Agent(
        model,
        output_type=ExcelColumnMappingOutput,
        system_prompt=SYSTEM_PROMPT_EXCEL_MAPPER,
        retries=3,
    )
    return agent
