"""
Agent 1: Raw Structural & Tabular Layout Extractor.
Extracts high-fidelity physical representations of document contents:
- Accurate 2D table structures (headers, rows, cells) with coordinates.
- Labeled key-value blocks with verbatim text and bounding boxes.
- Markdown representations for optimal LLM context ingestion.
Does NOT attempt domain categorization or filtering yet.
"""

from __future__ import annotations

import hashlib
import io
import re
from typing import Any, Dict, List, Optional, Tuple, Union

import pandas as pd
import pdfplumber

from .models import (
    NormalizedBBox,
    RawDocumentStructure,
    RawKeyValue,
    RawTable,
    RawTableCell,
)


def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def convert_table_to_markdown(headers: List[str], rows: List[List[Any]]) -> str:
    """Converts a 2D table grid to GitHub-Flavored Markdown table format."""
    if not headers and not rows:
        return ""

    safe_headers = [str(h or "").replace("|", "-").strip() for h in headers]
    if not safe_headers and rows:
        safe_headers = [f"Col_{i+1}" for i in range(len(rows[0]))]

    lines = []
    lines.append("| " + " | ".join(safe_headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(safe_headers)) + " |")

    for r in rows:
        padded = list(r) + [""] * max(0, len(safe_headers) - len(r))
        row_str = [str(v or "").replace("|", "-").replace("\n", " ").strip() for v in padded[:len(safe_headers)]]
        lines.append("| " + " | ".join(row_str) + " |")

    return "\n".join(lines)


# =============================================================================
# PDF STRUCTURAL EXTRACTOR (AGENT 1)
# =============================================================================

def extract_raw_structure_from_pdf(
    pdf_bytes: bytes,
    document_name: str = "document.pdf",
    max_pages: int = 20,
) -> RawDocumentStructure:
    """
    Agent 1 PDF extractor:
    Uses pdfplumber's geometric table extraction to reliably identify
    all tables, rows, cells, and line-level key-values with bounding boxes.
    """
    doc_sha256 = compute_sha256(pdf_bytes)
    tables: List[RawTable] = []
    key_values: List[RawKeyValue] = []
    text_summaries: List[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        num_pages_to_process = min(len(pdf.pages), max_pages)

        for p_idx in range(num_pages_to_process):
            page = pdf.pages[p_idx]
            page_num = p_idx + 1
            p_width = float(page.width) or 595.0
            p_height = float(page.height) or 842.0

            # 1. Extract geometric tables with line strategies
            extracted_tables = page.extract_tables({
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
                "snap_tolerance": 3,
                "join_tolerance": 3,
            }) or []

            # If no line-based tables found, try text-based alignment
            if not extracted_tables:
                extracted_tables = page.extract_tables({
                    "vertical_strategy": "text",
                    "horizontal_strategy": "text",
                }) or []

            for t_idx, raw_tbl in enumerate(extracted_tables):
                if not raw_tbl or len(raw_tbl) < 2:
                    continue

                # First non-empty row as header
                raw_headers = [str(c or "").strip() for c in raw_tbl[0]]
                raw_data_rows = raw_tbl[1:]

                # Clean headers and filter completely blank columns
                headers = [h if h else f"Col_{c_i+1}" for c_i, h in enumerate(raw_headers)]

                # Build cell records
                cells: List[RawTableCell] = []
                for r_i, row in enumerate(raw_data_rows):
                    for c_i, val in enumerate(row):
                        if val is not None and str(val).strip():
                            cells.append(
                                RawTableCell(
                                    row_idx=r_i,
                                    col_idx=c_i,
                                    col_header=headers[c_i] if c_i < len(headers) else f"Col_{c_i+1}",
                                    value=val,
                                    cell_coordinate=f"Page_{page_num}_R{r_i+1}C{c_i+1}",
                                )
                            )

                md = convert_table_to_markdown(headers, raw_data_rows)
                tables.append(
                    RawTable(
                        table_id=f"page_{page_num}_table_{t_idx+1}",
                        sheet_or_page=f"Page {page_num}",
                        page_number=page_num,
                        headers=headers,
                        rows=raw_data_rows,
                        cells=cells,
                        raw_markdown=md,
                    )
                )

            # 2. Extract key-value patterns and lines with bounding boxes
            raw_text = page.extract_text() or ""
            text_summaries.append(f"--- PAGE {page_num} ---\n{raw_text[:1000]}")

            # Scan words to build word coordinates for bounding boxes
            words = page.extract_words() or []
            line_pattern = re.compile(
                r"^([A-Za-z0-9\s\-_/\.()]{2,40})[:=\t]+([0-9\.,]+)\s*([A-Za-z/%³²]+)?",
                re.MULTILINE,
            )

            for match in line_pattern.finditer(raw_text):
                lbl = match.group(1).strip()
                val = match.group(2).strip()
                unit = match.group(3).strip() if match.group(3) else None

                # Find approximate bbox by matching the label and value in page words
                matched_words = [w for w in words if w.get("text", "") in (lbl + " " + val)]
                bbox: Optional[NormalizedBBox] = None
                if matched_words:
                    min_x = min(float(w.get("x0", 0)) for w in matched_words)
                    max_x = max(float(w.get("x1", 0)) for w in matched_words)
                    min_y = min(float(w.get("top", 0)) for w in matched_words)
                    max_y = max(float(w.get("bottom", 0)) for w in matched_words)

                    bbox = NormalizedBBox(
                        x=round(max(0.0, min(1.0, min_x / p_width)), 4),
                        y=round(max(0.0, min(1.0, min_y / p_height)), 4),
                        width=round(max(0.0, min(1.0, (max_x - min_x) / p_width)), 4),
                        height=round(max(0.0, min(1.0, (max_y - min_y) / p_height)), 4),
                    )

                key_values.append(
                    RawKeyValue(
                        key=lbl,
                        raw_value=val,
                        unit_candidate=unit,
                        page=page_num,
                        bbox=bbox,
                        source_text=match.group(0).strip(),
                    )
                )

    return RawDocumentStructure(
        document_name=document_name,
        document_sha256=doc_sha256,
        file_type="pdf",
        tables=tables,
        key_values=key_values,
        summary_text="\n\n".join(text_summaries),
    )


# =============================================================================
# EXCEL STRUCTURAL EXTRACTOR (AGENT 1)
# =============================================================================

def extract_raw_structure_from_excel(
    file_bytes_or_path: Union[bytes, bytearray, str],
    document_name: str = "spreadsheet.xlsx",
) -> RawDocumentStructure:
    """
    Agent 1 Excel extractor:
    Inspects all sheets in a workbook, preserving column headers, cell coordinates
    (e.g. Sheet1!C14), data types, and converting into clean 2D tables with Markdown.
    """
    if isinstance(file_bytes_or_path, (bytes, bytearray)):
        doc_sha256 = compute_sha256(file_bytes_or_path)
        xl_file = pd.ExcelFile(io.BytesIO(file_bytes_or_path))
    else:
        with open(file_bytes_or_path, "rb") as f:
            content = f.read()
        doc_sha256 = compute_sha256(content)
        xl_file = pd.ExcelFile(io.BytesIO(content))

    tables: List[RawTable] = []
    key_values: List[RawKeyValue] = []
    summaries: List[str] = []

    for s_name in xl_file.sheet_names:
        df_sheet = xl_file.parse(s_name, header=None)
        if df_sheet.empty or df_sheet.shape[0] < 2:
            continue

        # Detect the primary header row (search first 10 rows)
        header_row_idx = 0
        for r_i in range(min(10, len(df_sheet))):
            row_str = " ".join([str(v).lower() for v in df_sheet.iloc[r_i] if not pd.isna(v)])
            if any(k in row_str for k in ["date", "month", "fuel", "coal", "power", "production", "clinker", "kwh", "ton"]):
                header_row_idx = r_i
                break

        raw_headers = [
            str(df_sheet.iloc[header_row_idx, c]).strip() if not pd.isna(df_sheet.iloc[header_row_idx, c]) else f"Col_{c+1}"
            for c in range(df_sheet.shape[1])
        ]

        df_data = df_sheet.iloc[header_row_idx + 1:].copy()
        data_rows = df_data.values.tolist()

        cells: List[RawTableCell] = []
        for r_i, row in enumerate(data_rows):
            for c_i, val in enumerate(row):
                if not pd.isna(val) and str(val).strip():
                    # Standard Excel cell notation
                    col_letter = chr(65 + c_i) if c_i < 26 else f"Col{c_i+1}"
                    row_num = header_row_idx + 2 + r_i
                    cells.append(
                        RawTableCell(
                            row_idx=r_i,
                            col_idx=c_i,
                            col_header=raw_headers[c_i] if c_i < len(raw_headers) else f"Col_{c_i+1}",
                            value=val,
                            cell_coordinate=f"{s_name}!{col_letter}{row_num}",
                        )
                    )

        md = convert_table_to_markdown(raw_headers, data_rows[:35])  # Cap preview to 35 rows for markdown
        tables.append(
            RawTable(
                table_id=f"sheet_{s_name}",
                sheet_or_page=s_name,
                headers=raw_headers,
                rows=data_rows,
                cells=cells,
                raw_markdown=md,
            )
        )
        summaries.append(f"Sheet '{s_name}': {len(raw_headers)} columns, {len(data_rows)} data rows.")

    return RawDocumentStructure(
        document_name=document_name,
        document_sha256=doc_sha256,
        file_type="excel",
        tables=tables,
        key_values=key_values,
        summary_text="\n".join(summaries),
    )
