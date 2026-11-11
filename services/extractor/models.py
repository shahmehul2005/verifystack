"""
Pydantic V2 models for VerifyStack Stream-Calendar Extraction.
Enforces strict boundary validation, time-series awareness, and provenance tracking.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class SourceType(str, Enum):
    """The 3 statutory evidence layers."""
    SOURCING = "sourcing"          # Primary external: vendor bills, weighbridge slips, DISCOM invoices
    CORROBORATION = "corroboration"  # Internal: plant ERP logs, SCADA exports, lab test reports
    PROFORMA = "proforma"          # Official declared: BEE Form 1 / Form-Sb return


class StreamCategory(str, Enum):
    PRODUCTION = "production"
    SOLID_FUELS = "solid_fuels"
    LIQUID_FUELS = "liquid_fuels"
    GASEOUS_FUELS = "gaseous_fuels"
    ELECTRICITY = "electricity"
    PROCESS_EMISSIONS = "process_emissions"


class BEEPATSectorStream(str, Enum):
    """
    Standard streams aligned 1:1 with BEE PAT-2 Cement Sector Proforma.
    """
    # Production
    CLINKER_PRODUCTION = "clinker_production"
    OPC_PRODUCTION = "opc_production"
    PPC_PRODUCTION = "ppc_production"
    PSC_PRODUCTION = "psc_production"
    EQUIVALENT_PRODUCT = "equivalent_product"

    # Solid Fuels
    COAL_QUANTITY = "coal_quantity"
    COAL_GCV = "coal_gcv"
    PETCOKE_QUANTITY = "petcoke_quantity"
    PETCOKE_GCV = "petcoke_gcv"
    IMPORTED_COAL_QUANTITY = "imported_coal_quantity"
    IMPORTED_COAL_GCV = "imported_coal_gcv"
    BIOMASS_AFR_QUANTITY = "biomass_afr_quantity"
    BIOMASS_AFR_GCV = "biomass_afr_gcv"

    # Liquid Fuels
    FO_QUANTITY = "fo_quantity"
    FO_GCV = "fo_gcv"
    HSD_QUANTITY = "hsd_quantity"
    HSD_GCV = "hsd_gcv"

    # Gaseous Fuels
    NATURAL_GAS_QUANTITY = "natural_gas_quantity"
    NATURAL_GAS_GCV = "natural_gas_gcv"

    # Electricity
    GRID_ELECTRICITY = "grid_electricity"
    CPP_GENERATION = "cpp_generation"
    WHRS_GENERATION = "whrs_generation"
    POWER_EXPORT = "power_export"

    # Process Emissions
    CALCINATION_CO2 = "calcination_co2"
    RAW_MEAL_CALCINATION = "raw_meal_calcination"


class NormalizedBBox(BaseModel):
    """Bounding box on a visual page in [0, 1] normalized coordinates."""
    x: Annotated[float, Field(ge=0.0, le=1.0)]
    y: Annotated[float, Field(ge=0.0, le=1.0)]
    width: Annotated[float, Field(ge=0.0, le=1.0)]
    height: Annotated[float, Field(ge=0.0, le=1.0)]


class ExtractionProvenance(BaseModel):
    """
    Auditor-grade provenance.
    For PDF documents: page number + bounding box coordinates + verbatim text.
    For Excel spreadsheets: sheet name + cell coordinate (e.g. Form-Sb!D18) + column header.
    """
    page: Optional[int] = Field(default=None, description="1-indexed page number if PDF")
    bbox: Optional[NormalizedBBox] = Field(default=None, description="Normalized bbox in [0, 1]")
    source_text: str = Field(..., description="Verbatim text or number representation as read")
    sheet_name: Optional[str] = Field(default=None, description="Excel sheet name if tabular")
    cell_coordinate: Optional[str] = Field(default=None, description="Excel cell address e.g. 'D18'")
    document_sha256: Optional[str] = Field(default=None, description="SHA-256 hash of original file")

    @model_validator(mode="after")
    def verify_provenance_completeness(self) -> ExtractionProvenance:
        if not self.source_text.strip():
            raise ValueError("Provenance source_text cannot be empty.")
        if self.page is None and self.cell_coordinate is None:
            # At least one physical locator must exist
            raise ValueError("Provenance must contain either page number (PDF) or cell_coordinate (Excel).")
        return self


class CalendarReadingItem(BaseModel):
    """
    A single granular evidence reading validated for ingestion into the 12-month calendar grid.
    """
    stream_key: BEEPATSectorStream
    duration_kind: Literal["monthly", "annual", "single_reading"] = "monthly"
    month_key: str = Field(
        ...,
        description="Fiscal month in YYYY-MM format (e.g. '2023-04' through '2024-03') or 'annual'"
    )
    source_type: SourceType
    raw_value: float = Field(..., description="Numerical value as parsed from the evidence")
    unit_as_printed: str = Field(..., description="Unit string verbatim from the document")
    normalized_value: Optional[float] = Field(
        default=None,
        description="Value normalized to standard statutory unit (e.g. MT, kWh, kcal/kg)"
    )
    normalized_unit: Optional[str] = Field(
        default=None,
        description="Target statutory unit (e.g. 't', 'kWh', 'kcal/kg')"
    )
    confidence: Annotated[float, Field(ge=0.0, le=1.0)] = Field(
        default=1.0,
        description="Confidence score between 0.0 and 1.0"
    )
    provenance: ExtractionProvenance

    @field_validator("month_key")
    @classmethod
    def validate_month_key_format(cls, v: str) -> str:
        v = v.strip().lower()
        if v == "annual":
            return "annual"
        if not re.match(r"^\d{4}-(0[1-9]|1[0-2])$", v):
            raise ValueError(f"Invalid month_key '{v}'. Must be 'YYYY-MM' (e.g. '2023-04') or 'annual'.")
        return v


class ExcelTemplateRow(BaseModel):
    """
    Schema for standard VerifyStack 12-Month Excel/CSV Template (Option 1).
    """
    month: str = Field(..., description="Month e.g. '2023-04' or 'Apr-23' or 'April 2023'")
    stream: BEEPATSectorStream = Field(..., description="Target BEE PAT-2 Stream")
    value: float = Field(..., description="Numerical reading")
    unit: str = Field(..., description="Unit (e.g. 'MT', 'Tonne', 'kWh', 'Lakh kWh', 'kcal/kg')")
    source_type: SourceType = Field(default=SourceType.CORROBORATION)
    remarks: Optional[str] = None


class ExcelColumnMapping(BaseModel):
    """
    AI-generated column mapping schema for arbitrary/messy plant Excel sheets (Option 2).
    """
    sheet_name: str
    header_row_index: int = Field(default=0, description="0-indexed row number containing headers")
    date_column: str = Field(..., description="Column name or index containing the date/month")
    stream_mappings: Dict[str, BEEPATSectorStream] = Field(
        ...,
        description="Dictionary mapping column header name -> BEEPATSectorStream"
    )
    unit_hints: Dict[str, str] = Field(
        default_factory=dict,
        description="Optional unit hint per column header name"
    )
    source_type: SourceType = Field(default=SourceType.CORROBORATION)
    start_data_row_index: int = Field(default=1, description="First row containing actual data")
    end_data_row_index: Optional[int] = None


class BatchExtractionResult(BaseModel):
    """
    Full extraction result payload returned to VerifyStack.
    """
    ok: bool
    document_id: Optional[str] = None
    file_name: str
    file_type: Literal["pdf", "excel", "csv"]
    compliance_year: str = "2023-24"
    readings: List[CalendarReadingItem] = Field(default_factory=list)
    unmapped_columns: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
