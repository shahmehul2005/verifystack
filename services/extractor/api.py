"""
FastAPI Service for Pydantic AI Calendar Extraction.
Exposes REST endpoints for:
  - Option 1A: Official BEE PAT-2 Cement Sector Proforma parser (.xls)
  - Option 1B: Standard VerifyStack 12-Month Calendar Excel / CSV template parser
  - Option 1C: Downloadable 12-Month Excel Template generator
  - Option 2:  Arbitrary Plant Excel Auto-Mapper Agent
  - PDF Document Extraction Agent with Bounding Box provenance
  - Direct Supabase Calendar Store Sync
"""

from __future__ import annotations

import hashlib
import os
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .calendar_agent import (
    CalendarBatchExtractionOutput,
    create_calendar_agent,
    create_excel_mapper_agent,
)
from .excel_processor import (
    auto_map_arbitrary_excel,
    generate_blank_template,
    parse_bee_pat2_proforma,
    parse_verifystack_template,
)
from .models import (
    BatchExtractionResult,
    CalendarReadingItem,
    SourceType,
)
from .pdf_extractor import extract_pdf_pages_with_layout


app = FastAPI(
    title="VerifyStack Pydantic AI Extraction Service",
    description="Multi-agent compliance document extraction and 12-month calendar ledger ingestion.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "verifystack-pydantic-extractor",
        "version": "2.0.0",
        "pydantic_ai_available": True,
    }


# ============================================================================
# OPTION 1A: BEE PAT-2 Official Proforma Parser (.xls)
# ============================================================================

@app.post("/extract/excel/proforma", response_model=BatchExtractionResult)
async def extract_bee_proforma(
    file: UploadFile = File(...),
    compliance_year: str = Form("2023-24"),
):
    """
    Deterministically parses official BEE PAT-2 Cement Sector Proforma (Form 1 & Form-Sb).
    Returns verified declared proforma readings with 100% precision.
    """
    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    try:
        readings = parse_bee_pat2_proforma(
            file_bytes_or_path=content,
            compliance_year=compliance_year,
            document_sha256=sha256,
        )
        return BatchExtractionResult(
            ok=True,
            file_name=file.filename or "bee_pat2_proforma.xls",
            file_type="excel",
            compliance_year=compliance_year,
            readings=readings,
            warnings=[] if readings else ["No matching PAT-2 cells found in proforma."],
        )
    except Exception as e:
        return BatchExtractionResult(
            ok=False,
            file_name=file.filename or "bee_pat2_proforma.xls",
            file_type="excel",
            compliance_year=compliance_year,
            readings=[],
            errors=[f"Failed to parse BEE PAT-2 Proforma: {str(e)}"],
        )


# ============================================================================
# OPTION 1B: Standard 12-Month Calendar Excel / CSV Template Parser
# ============================================================================

@app.post("/extract/excel/template", response_model=BatchExtractionResult)
async def extract_template_excel(
    file: UploadFile = File(...),
    compliance_year: str = Form("2023-24"),
    default_source_type: str = Form("corroboration"),
):
    """
    Parses a pre-formatted VerifyStack 12-Month Calendar Excel or CSV file.
    Expects columns: Month, Stream, Value, Unit, [SourceType].
    """
    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    st_enum = SourceType.CORROBORATION
    if default_source_type.lower() == "sourcing":
        st_enum = SourceType.SOURCING
    elif default_source_type.lower() == "proforma":
        st_enum = SourceType.PROFORMA

    try:
        readings = parse_verifystack_template(
            file_bytes_or_path=content,
            default_source_type=st_enum,
            document_sha256=sha256,
        )
        return BatchExtractionResult(
            ok=True,
            file_name=file.filename or "template_data.xlsx",
            file_type="excel" if not file.filename.endswith(".csv") else "csv",
            compliance_year=compliance_year,
            readings=readings,
        )
    except Exception as e:
        return BatchExtractionResult(
            ok=False,
            file_name=file.filename or "template_data.xlsx",
            file_type="excel",
            compliance_year=compliance_year,
            readings=[],
            errors=[f"Failed to parse template: {str(e)}"],
        )


# ============================================================================
# OPTION 1C: Downloadable 12-Month Excel Template Generator
# ============================================================================

@app.get("/template/download")
def download_blank_template(compliance_year: str = "2023-24"):
    """
    Generates and downloads a clean, styled 12-Month Excel spreadsheet template
    prefilled with all fiscal months and core cement stream keys.
    """
    excel_bytes = generate_blank_template(compliance_year=compliance_year)
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="verifystack_calendar_template_{compliance_year}.xlsx"'
        },
    )


# ============================================================================
# OPTION 2: Arbitrary Plant Excel Auto-Mapper Agent
# ============================================================================

@app.post("/extract/excel/auto-map", response_model=BatchExtractionResult)
async def auto_map_excel(
    file: UploadFile = File(...),
    compliance_year: str = Form("2023-24"),
    source_type: str = Form("corroboration"),
):
    """
    Analyzes messy/arbitrary plant spreadsheets (MIS, SCADA, ERP),
    detects date columns, maps custom headers to BEE PAT-2 streams, and
    extracts the 12-month time series.
    """
    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    st_enum = SourceType.CORROBORATION
    if source_type.lower() == "sourcing":
        st_enum = SourceType.SOURCING
    elif source_type.lower() == "proforma":
        st_enum = SourceType.PROFORMA

    try:
        readings, mappings, unmapped = auto_map_arbitrary_excel(
            file_bytes_or_path=content,
            compliance_year=compliance_year,
            source_type=st_enum,
            document_sha256=sha256,
        )
        return BatchExtractionResult(
            ok=True,
            file_name=file.filename or "plant_data.xlsx",
            file_type="excel",
            compliance_year=compliance_year,
            readings=readings,
            unmapped_columns=unmapped,
            warnings=[f"Mapped {len(mappings)} columns: {list(mappings.keys())}"],
        )
    except Exception as e:
        return BatchExtractionResult(
            ok=False,
            file_name=file.filename or "plant_data.xlsx",
            file_type="excel",
            compliance_year=compliance_year,
            readings=[],
            errors=[f"Auto-mapping failed: {str(e)}"],
        )


# ============================================================================
# PDF Extraction Agent with Bounding Box Provenance
# ============================================================================

@app.post("/extract/pdf", response_model=BatchExtractionResult)
async def extract_pdf_document(
    file: UploadFile = File(...),
    compliance_year: str = Form("2023-24"),
):
    """
    Extracts readings from PDF invoices/lab certificates using Pydantic AI agent
    with bounding box provenance and self-correcting validation.
    """
    content = await file.read()
    sha256 = hashlib.sha256(content).hexdigest()

    try:
        pages = extract_pdf_pages_with_layout(content)
        agent = create_calendar_agent()

        all_readings: List[CalendarReadingItem] = []
        warnings: List[str] = []

        # Run extraction on first 3 relevant pages
        for p in pages[:3]:
            if not p["text"].strip():
                continue

            prompt = (
                f"Document: {file.filename}\nPage: {p['page_number']}\nCompliance Year: {compliance_year}\n"
                f"Page Text:\n{p['text'][:4000]}\n"
            )

            # In test/mock mode or live LLM mode
            try:
                res = agent.run_sync(prompt)
                batch_out: CalendarBatchExtractionOutput = res.output
                for r in batch_out.readings:
                    # Stamp page number and doc hash
                    r.provenance.page = p["page_number"]
                    r.provenance.document_sha256 = sha256
                    all_readings.append(r)
                warnings.extend(batch_out.warnings)
            except Exception as extract_err:
                warnings.append(f"Page {p['page_number']} agent notice: {str(extract_err)}")

        return BatchExtractionResult(
            ok=True,
            file_name=file.filename or "document.pdf",
            file_type="pdf",
            compliance_year=compliance_year,
            readings=all_readings,
            warnings=warnings,
        )
    except Exception as e:
        return BatchExtractionResult(
            ok=False,
            file_name=file.filename or "document.pdf",
            file_type="pdf",
            compliance_year=compliance_year,
            readings=[],
            errors=[f"PDF Extraction failed: {str(e)}"],
        )

