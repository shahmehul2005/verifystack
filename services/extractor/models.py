"""Data models for the Extractor_Service.

Three groups live here:

* Wire types: ``Reading``, ``ExtractedField``, the request parameters and the
  response envelopes. These are the JSON contract with the TypeScript client.
* Internal parser types: ``LabelItem`` and ``DataCell``. Parsers hand these to the
  pipeline. They never cross the HTTP boundary.
* Agent output types: ``RawField``, ``PageRead``, ``Mapping`` and ``MapperOutput``.
  The agent types use ``extra="forbid"``. ``Mapping`` has no numeric field, so a
  model cannot return a number through the mapper (Requirement 4.1).

``BEEPATSectorStream`` values equal the keys of ``CEMENT_STREAMS`` in
``backend/domain/calendar/streams.ts``.
"""

from __future__ import annotations

import datetime as dt
import re
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class SourceType(str, Enum):
    """The three statutory evidence layers."""

    SOURCING = "sourcing"  # primary external: vendor bills, weighbridge slips, DISCOM invoices
    CORROBORATION = "corroboration"  # internal: plant ERP logs, SCADA exports, lab reports
    PROFORMA = "proforma"  # official declared: BEE Form 1 / Form-Sb return


class BEEPATSectorStream(str, Enum):
    """The 25 calendar streams. Values match the TypeScript ``CEMENT_STREAMS`` keys."""

    # Production
    EQUIVALENT_PRODUCT = "equivalent_product"
    CLINKER_PRODUCTION = "clinker_production"
    OPC_PRODUCTION = "opc_production"
    PPC_PRODUCTION = "ppc_production"
    PSC_PRODUCTION = "psc_production"

    # Solid fuels
    COAL_QUANTITY = "coal_quantity"
    COAL_GCV = "coal_gcv"
    PETCOKE_QUANTITY = "petcoke_quantity"
    PETCOKE_GCV = "petcoke_gcv"
    IMPORTED_COAL_QUANTITY = "imported_coal_quantity"
    IMPORTED_COAL_GCV = "imported_coal_gcv"
    BIOMASS_AFR_QUANTITY = "biomass_afr_quantity"
    BIOMASS_AFR_GCV = "biomass_afr_gcv"

    # Liquid fuels
    FO_QUANTITY = "fo_quantity"
    FO_GCV = "fo_gcv"
    HSD_QUANTITY = "hsd_quantity"
    HSD_GCV = "hsd_gcv"

    # Gaseous fuels
    NATURAL_GAS_QUANTITY = "natural_gas_quantity"
    NATURAL_GAS_GCV = "natural_gas_gcv"

    # Electricity
    GRID_ELECTRICITY = "grid_electricity"
    CPP_GENERATION = "cpp_generation"
    WHRS_GENERATION = "whrs_generation"
    POWER_EXPORT = "power_export"

    # Process emissions
    CALCINATION_CO2 = "calcination_co2"
    RAW_MEAL_CALCINATION = "raw_meal_calcination"


ReadingSource = Literal["excel", "csv", "pdf"]
MappingSource = Literal["key", "phrase", "title", "llm", "proforma_label"]
SheetLayout = Literal["auto", "proforma", "tabular"]
FieldKind = Literal["number", "measure", "date", "enum", "string"]

_MONTH_KEY_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

# ---------------------------------------------------------------------------
# Provenance and period
# ---------------------------------------------------------------------------


class NormalizedBBox(BaseModel):
    """A box on a page in [0, 1] coordinates, origin at the top left."""

    x: Annotated[float, Field(ge=0.0, le=1.0)]
    y: Annotated[float, Field(ge=0.0, le=1.0)]
    width: Annotated[float, Field(ge=0.0, le=1.0)]
    height: Annotated[float, Field(ge=0.0, le=1.0)]


class Provenance(BaseModel):
    """Where a value came from: a page (PDF), or a sheet and cell (spreadsheet)."""

    page: int | None = Field(default=None, ge=1)
    bbox: NormalizedBBox | None = None
    sheet: str | None = None
    cell: str | None = None
    source_text: str = Field(min_length=1)
    formula: str | None = None

    @model_validator(mode="after")
    def has_locator(self) -> Provenance:
        has_sheet = bool(self.sheet)
        has_cell = bool(self.cell)
        if has_sheet != has_cell:
            raise ValueError("sheet and cell must be set together")
        if self.page is None and not has_cell:
            raise ValueError("provenance needs a page, or a sheet and a cell")
        if self.bbox is not None and self.page is None:
            raise ValueError("a bbox needs a page")
        return self


class Period(BaseModel):
    """The time a reading covers: one day, one calendar month, or the fiscal year."""

    kind: Literal["daily", "monthly", "annual"]
    month_key: str  # "YYYY-MM" or "annual"
    date: dt.date | None = None  # set for daily readings only

    @model_validator(mode="after")
    def consistent(self) -> Period:
        if self.kind == "annual":
            if self.month_key != "annual":
                raise ValueError('an annual period needs month_key "annual"')
            if self.date is not None:
                raise ValueError("an annual period has no date")
            return self
        if not _MONTH_KEY_RE.match(self.month_key):
            raise ValueError(f"invalid month_key {self.month_key[:40]!r}")
        if self.kind == "daily":
            if self.date is None:
                raise ValueError("a daily period needs a date")
            if self.date.strftime("%Y-%m") != self.month_key:
                raise ValueError("the date is outside month_key")
        elif self.date is not None:
            raise ValueError("only a daily period carries a date")
        return self


# ---------------------------------------------------------------------------
# Wire types
# ---------------------------------------------------------------------------


class Reading(BaseModel):
    """One extracted candidate value for the calendar ledger."""

    raw_id: str
    label: str | None = None
    stream_key: BEEPATSectorStream
    period: Period
    source_type: SourceType
    source: ReadingSource
    value_as_stated: str
    unit_as_stated: str | None = None
    value: float = Field(allow_inf_nan=False)
    normalized_value: float | None = Field(default=None, allow_inf_nan=False)
    normalized_unit: str
    verified: bool
    needs_review: bool
    derived: bool = False
    unit_assumed: bool = False
    regulatory: bool = False
    mapping_source: MappingSource
    confidence: float = Field(ge=0.0, le=1.0)
    review_reasons: list[str] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="after")
    def flags_and_locator(self) -> Reading:
        # A reason or an assumed unit always means a person must look at it.
        if self.review_reasons or self.unit_assumed:
            self.needs_review = True
        p = self.provenance
        if self.source == "pdf":
            if p.page is None:
                raise ValueError("a PDF reading needs a page")
            if p.sheet is not None or p.cell is not None:
                raise ValueError("a PDF reading has no sheet or cell")
        else:
            if p.page is not None:
                raise ValueError("a spreadsheet reading has no page")
            if not p.sheet or not p.cell:
                raise ValueError("a spreadsheet reading needs a sheet and a cell")
        return self


class ExtractedField(BaseModel):
    """One field returned by ``/v1/extract-fields``."""

    path: str
    kind: FieldKind
    value: float | str | None = None
    unit_as_printed: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    verified: bool
    needs_review: bool
    regulatory: bool = False
    review_reasons: list[str] = Field(default_factory=list)
    provenance: Provenance

    @model_validator(mode="after")
    def flags(self) -> ExtractedField:
        if self.review_reasons:
            self.needs_review = True
        return self


class ExtractorWarning(BaseModel):
    """A non-fatal finding. ``code`` is a stable machine name, for example ``extension_mismatch``."""

    code: str
    message: str
    raw_id: str | None = None


class SkippedItem(BaseModel):
    """A source datum that produced no reading, with the reason."""

    raw_id: str | None = None
    label: str | None = None
    reason: str  # for example not_convertible, period_unresolved, year_unresolved
    detail: str | None = None


class Run(BaseModel):
    """Audit block returned with every model-backed or file-backed response."""

    model: str
    model_calls: int = Field(ge=0)
    prompt_version: str
    input_hash: str
    duration_ms: int = Field(ge=0)


class FileInfo(BaseModel):
    name: str
    format: Literal["xlsx", "xls", "csv", "pdf"]
    size_bytes: int = Field(ge=0)
    sha256: str


class Classification(BaseModel):
    doc_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(default="", max_length=500)


class DocTypeOption(BaseModel):
    """An allowed document type, mirroring the TypeScript ``TaxonomyOption``."""

    id: str
    label: str
    notes: str | None = None


class CatalogueEntry(BaseModel):
    """One field path the caller wants filled by ``/v1/extract-fields``.

    A ``*`` path segment matches any array index.
    """

    path: str
    kind: FieldKind
    options: list[str] | None = None  # for kind "enum"
    regulatory: bool = False


class CalendarParams(BaseModel):
    compliance_year: str | None = None
    source_type: SourceType = SourceType.CORROBORATION
    layout: SheetLayout = "auto"


class ClassifyParams(BaseModel):
    allowed_doc_types: list[DocTypeOption] = Field(default_factory=list)
    page_number: int = Field(default=1, ge=1)


class ExtractFieldsParams(BaseModel):
    doc_type: str
    page_number: int = Field(default=1, ge=1)
    catalogue: list[CatalogueEntry] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    gemini_configured: bool
    provider: str
    model: str
    model_configured: bool


class ClassifyResponse(BaseModel):
    ok: Literal[True] = True
    classification: Classification
    run: Run


class BatchClassifyItem(BaseModel):
    index: int = Field(ge=0)
    classification: Classification | None = None
    error: str | None = None


class BatchClassifyResponse(BaseModel):
    ok: Literal[True] = True
    items: list[BatchClassifyItem]
    run: Run


class FieldsResponse(BaseModel):
    ok: Literal[True] = True
    fields: list[ExtractedField]
    warnings: list[ExtractorWarning] = Field(default_factory=list)
    run: Run


class CalendarResponse(BaseModel):
    ok: Literal[True] = True
    file: FileInfo
    readings: list[Reading]
    skipped: list[SkippedItem] = Field(default_factory=list)
    unmapped: list[str] = Field(default_factory=list)  # labels no rule or model could place
    warnings: list[ExtractorWarning] = Field(default_factory=list)
    run: Run


class ErrorDetail(BaseModel):
    code: str
    message: str
    category: str | None = None  # model_failure only
    supported: list[str] | None = None  # unsupported_format only


class ErrorResponse(BaseModel):
    ok: Literal[False] = False
    error: ErrorDetail


# ---------------------------------------------------------------------------
# Internal parser types
# ---------------------------------------------------------------------------


class DataCell(BaseModel):
    """One source cell that holds a value for a label.

    ``raw`` is the cell content exactly as the loader returned it (number, text,
    date or ``None``). The pipeline parses it in ``build_reading``.
    """

    sheet: str
    cell: str  # A1 address, for example "AB17"
    raw: Any = None
    formula: str | None = None
    unit: str | None = None  # unit from the cell or its column header
    period: Period | None = None
    source_text: str = ""
    review_reasons: list[str] = Field(default_factory=list)


class LabelItem(BaseModel):
    """A label the Rules_Mapper did not map, with the data cells it governs.

    ``raw_id`` is ``sheet!cell`` of the label or header cell. It is the id the
    Mapper_Agent echoes back.
    """

    raw_id: str
    label: str
    sheet: str
    title: str = ""
    unit_hint: str | None = None
    cells: list[DataCell] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Agent output types
# ---------------------------------------------------------------------------


class RawField(BaseModel):
    """One value the Reader_Agent read from a PDF page, copied as printed."""

    model_config = ConfigDict(extra="forbid")

    label: str
    value_text: str  # exactly as printed
    unit_as_printed: str = ""
    period_text: str = ""
    field_path: str | None = None  # only for extract-fields
    source_text: str
    confidence: float = Field(ge=0.0, le=1.0)


class PageRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_period_text: str = ""
    fields: list[RawField]


class Mapping(BaseModel):
    """A proposal that a raw id belongs to a stream. It carries no number."""

    model_config = ConfigDict(extra="forbid")

    raw_id: str
    stream_key: str | None  # checked against BEEPATSectorStream in code
    reason: str = ""
    confidence: float = Field(ge=0.0, le=1.0)


class MapperOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mappings: list[Mapping]
