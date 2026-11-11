"""
Comprehensive Excel Processor for BEE PAT-2 & Cement Operations.
Supports:
  - Option 1A: Official BEE PAT-2 Proforma (.xls) deterministic cell reader.
  - Option 1B: Standard VerifyStack 12-Month Calendar Excel / CSV template reader.
  - Option 1C: Template Generator (exports clean 12-month spreadsheet template).
  - Option 2:  Arbitrary/Messy Plant Excel Auto-Mapper (AI & heuristic header alignment).
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
import pandas as pd
import xlrd

from .models import (
    BEEPATSectorStream,
    CalendarReadingItem,
    ExtractionProvenance,
    SourceType,
)
from .unit_normalizer import normalize_reading_value


MONTH_NAMES = {
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
}


def parse_fiscal_month(raw_val: Any, compliance_year: str = "2023-24") -> Optional[str]:
    """
    Parses various date/month representations into canonical 'YYYY-MM' format.
    Correctly places Jan-Mar into the second calendar year for Indian FY.
    Examples:
      - 'Apr-23', 'April 2023', '2023-04', '04/2023', '2023-04-01' -> '2023-04'
      - 'Jan-24', 'January 2024', '01/2024' -> '2024-01'
      - Excel serial numbers like 45017 -> '2023-04'
      - 'annual', 'Total', 'FY23-24' -> 'annual'
    """
    if raw_val is None:
        return None

    # Handle pandas Timestamp or python datetime/date
    if isinstance(raw_val, (datetime, date)):
        return f"{raw_val.year:04d}-{raw_val.month:02d}"

    # Handle numeric excel serial date
    if isinstance(raw_val, (int, float)):
        # Excel serial date baseline is 1899-12-30
        try:
            if 30000 <= raw_val <= 60000:
                dt = xlrd.xldate_as_datetime(raw_val, 0)
                return f"{dt.year:04d}-{dt.month:02d}"
        except Exception:
            pass

    s = str(raw_val).strip()
    if not s:
        return None

    s_lower = s.lower()
    if s_lower in ("annual", "total", "year", "full year", "fy", "ytd"):
        return "annual"

    # Match YYYY-MM
    m_iso = re.search(r"(\d{4})[/-](0[1-9]|1[0-2])", s)
    if m_iso:
        return f"{m_iso.group(1)}-{m_iso.group(2)}"

    # Match MM/YYYY
    m_rev = re.search(r"(0[1-9]|1[0-2])[/-](\d{4})", s)
    if m_rev:
        return f"{m_rev.group(2)}-{m_rev.group(1)}"

    # Extract base years from compliance year e.g. "2023-24" -> 2023, 2024
    y_match = re.search(r"(\d{4})[-/](\d{2,4})", compliance_year)
    start_year = int(y_match.group(1)) if y_match else 2023
    end_year = start_year + 1

    # Match English month names (e.g. 'Apr-23', 'April 2023', 'May')
    for m_text, m_num in MONTH_NAMES.items():
        if re.search(rf"\b{m_text}\b", s_lower):
            # Check if an explicit 2-digit or 4-digit year is in the string
            yr_match = re.search(r"\b(20\d{2}|\d{2})\b", s)
            if yr_match:
                yr_val = int(yr_match.group(1))
                yr = yr_val if yr_val >= 2000 else (2000 + yr_val)
                return f"{yr:04d}-{m_num:02d}"
            # Default to fiscal year rule: Apr-Dec = start_year, Jan-Mar = end_year
            yr = end_year if m_num <= 3 else start_year
            return f"{yr:04d}-{m_num:02d}"

    return None


# ============================================================================
# OPTION 1A: Official BEE PAT-2 Proforma (.xls) Parser
# ============================================================================

def parse_bee_pat2_proforma(
    file_bytes_or_path: Any,
    compliance_year: str = "2023-24",
    document_sha256: Optional[str] = None
) -> List[CalendarReadingItem]:
    """
    Deterministically parses official BEE PAT-2 Cement Sector Proforma.
    Extracts declared values from 'Form 1' and 'Form-Sb' with zero hallucination.
    """
    if isinstance(file_bytes_or_path, (bytes, bytearray)):
        wb = xlrd.open_workbook(file_contents=file_bytes_or_path)
    else:
        wb = xlrd.open_workbook(file_bytes_or_path)

    readings: List[CalendarReadingItem] = []

    def get_cell(sheet, row: int, col: int) -> Tuple[Any, str]:
        if row < sheet.nrows and col < sheet.ncols:
            val = sheet.cell_value(row, col)
            coord = f"{sheet.name}!{xlrd.cellname(row, col)}"
            return val, coord
        return None, ""

    def safe_float(v: Any) -> Optional[float]:
        try:
            if v is None or v == "" or str(v).strip().lower() in ("na", "n/a", "-", "nil"):
                return None
            return float(v)
        except (ValueError, TypeError):
            return None

    # --- 1. Form-Sb Parsing ---
    if "Form-Sb" in wb.sheet_names():
        sb = wb.sheet_by_name("Form-Sb")

        # Map of (row_index, stream_key, unit_col, val_col, fallback_unit)
        # Form-Sb column 5 is Current/Baseline Year data
        form_sb_targets = [
            # Production
            (8, BEEPATSectorStream.CLINKER_PRODUCTION, 3, 5, "t"),
            (16, BEEPATSectorStream.OPC_PRODUCTION, 3, 5, "t"),
            (17, BEEPATSectorStream.PPC_PRODUCTION, 3, 5, "t"),
            (18, BEEPATSectorStream.PSC_PRODUCTION, 3, 5, "t"),
            # Electricity
            (106, BEEPATSectorStream.GRID_ELECTRICITY, 3, 5, "Lakh kWh"),
            # Solid Fuels
            (264, BEEPATSectorStream.COAL_GCV, 3, 5, "kcal/kg"),
            (269, BEEPATSectorStream.COAL_QUANTITY, 3, 5, "t"),
            (276, BEEPATSectorStream.PETCOKE_GCV, 3, 5, "kcal/kg"),
            (281, BEEPATSectorStream.PETCOKE_QUANTITY, 3, 5, "t"),
            (288, BEEPATSectorStream.IMPORTED_COAL_GCV, 3, 5, "kcal/kg"),
            (293, BEEPATSectorStream.IMPORTED_COAL_QUANTITY, 3, 5, "t"),
        ]

        for r_idx, stream, u_col, v_col, default_u in form_sb_targets:
            raw_v, coord = get_cell(sb, r_idx, v_col)
            flt_val = safe_float(raw_v)
            if flt_val is not None:
                unit_raw, _ = get_cell(sb, r_idx, u_col)
                unit_str = str(unit_raw).strip() or default_u
                norm_val, norm_unit = normalize_reading_value(stream, flt_val, unit_str)

                readings.append(
                    CalendarReadingItem(
                        stream_key=stream,
                        duration_kind="annual",
                        month_key="annual",
                        source_type=SourceType.PROFORMA,
                        raw_value=flt_val,
                        unit_as_printed=unit_str,
                        normalized_value=norm_val,
                        normalized_unit=norm_unit,
                        confidence=1.0,
                        provenance=ExtractionProvenance(
                            sheet_name="Form-Sb",
                            cell_coordinate=coord,
                            source_text=f"{flt_val} {unit_str}",
                            document_sha256=document_sha256,
                        ),
                    )
                )

    # --- 2. Form 1 Parsing ---
    if "Form 1" in wb.sheet_names():
        f1 = wb.sheet_by_name("Form 1")
        form1_targets = [
            (15, BEEPATSectorStream.OPC_PRODUCTION, 2, 4, "t"),
            (16, BEEPATSectorStream.PPC_PRODUCTION, 2, 4, "t"),
            (17, BEEPATSectorStream.PSC_PRODUCTION, 2, 4, "t"),
            (19, BEEPATSectorStream.EQUIVALENT_PRODUCT, 2, 4, "t"),
            (24, BEEPATSectorStream.GRID_ELECTRICITY, 2, 4, "Million kwh"),
            (25, BEEPATSectorStream.CPP_GENERATION, 2, 4, "Million kwh"),
            (26, BEEPATSectorStream.POWER_EXPORT, 2, 4, "Million kwh"),
        ]

        for r_idx, stream, u_col, v_col, default_u in form1_targets:
            raw_v, coord = get_cell(f1, r_idx, v_col)
            flt_val = safe_float(raw_v)
            if flt_val is not None:
                # If already captured from Form-Sb with higher precision, don't duplicate unless missing
                existing = [r for r in readings if r.stream_key == stream and r.month_key == "annual"]
                if existing:
                    continue

                unit_raw, _ = get_cell(f1, r_idx, u_col)
                unit_str = str(unit_raw).strip() or default_u
                norm_val, norm_unit = normalize_reading_value(stream, flt_val, unit_str)

                readings.append(
                    CalendarReadingItem(
                        stream_key=stream,
                        duration_kind="annual",
                        month_key="annual",
                        source_type=SourceType.PROFORMA,
                        raw_value=flt_val,
                        unit_as_printed=unit_str,
                        normalized_value=norm_val,
                        normalized_unit=norm_unit,
                        confidence=1.0,
                        provenance=ExtractionProvenance(
                            sheet_name="Form 1",
                            cell_coordinate=coord,
                            source_text=f"{flt_val} {unit_str}",
                            document_sha256=document_sha256,
                        ),
                    )
                )

    # Derive Clinker Calcination CO2 (Annexure II-G1: 0.525 tCO2/t clinker) if clinker is present
    clinker_items = [r for r in readings if r.stream_key == BEEPATSectorStream.CLINKER_PRODUCTION]
    if clinker_items and not any(r.stream_key == BEEPATSectorStream.CALCINATION_CO2 for r in readings):
        clinker_r = clinker_items[0]
        calc_co2 = round((clinker_r.normalized_value or clinker_r.raw_value) * 0.525, 2)
        readings.append(
            CalendarReadingItem(
                stream_key=BEEPATSectorStream.CALCINATION_CO2,
                duration_kind="annual",
                month_key="annual",
                source_type=SourceType.PROFORMA,
                raw_value=calc_co2,
                unit_as_printed="tCO2e",
                normalized_value=calc_co2,
                normalized_unit="tCO2e",
                confidence=1.0,
                provenance=ExtractionProvenance(
                    sheet_name=clinker_r.provenance.sheet_name,
                    cell_coordinate=f"{clinker_r.provenance.cell_coordinate} * 0.525",
                    source_text=f"{clinker_r.raw_value} t clinker * 0.525 tCO2/t",
                    document_sha256=document_sha256,
                ),
            )
        )

    return readings


# ============================================================================
# OPTION 1B: Standard VerifyStack 12-Month Calendar Excel / CSV Template Reader
# ============================================================================

def parse_verifystack_template(
    file_bytes_or_path: Any,
    default_source_type: SourceType = SourceType.CORROBORATION,
    document_sha256: Optional[str] = None
) -> List[CalendarReadingItem]:
    """
    Parses the standard VerifyStack 12-Month Excel or CSV template.
    Expects columns: Month, Stream, Value, Unit, [SourceType], [Remarks].
    """
    if isinstance(file_bytes_or_path, (bytes, bytearray)):
        try:
            df = pd.read_excel(io.BytesIO(file_bytes_or_path))
        except Exception:
            df = pd.read_csv(io.BytesIO(file_bytes_or_path))
    elif str(file_bytes_or_path).endswith(".csv"):
        df = pd.read_csv(file_bytes_or_path)
    else:
        df = pd.read_excel(file_bytes_or_path)

    # Normalize column headers
    cols = {str(c).strip().lower(): c for c in df.columns}
    m_col = cols.get("month") or cols.get("duration") or cols.get("period")
    s_col = cols.get("stream") or cols.get("stream_key") or cols.get("data_type")
    v_col = cols.get("value") or cols.get("quantity") or cols.get("reading")
    u_col = cols.get("unit") or cols.get("uom")
    src_col = cols.get("source") or cols.get("source_type") or cols.get("layer")

    if not m_col or not s_col or not v_col:
        raise ValueError(
            f"Missing required columns in template. Found: {list(df.columns)}. "
            "Required: 'Month', 'Stream', 'Value', 'Unit'."
        )

    readings: List[CalendarReadingItem] = []

    for idx, row in df.iterrows():
        raw_m = row[m_col]
        raw_s = str(row[s_col]).strip()
        raw_v = row[v_col]

        if pd.isna(raw_m) or pd.isna(raw_v):
            continue

        month_key = parse_fiscal_month(raw_m)
        if not month_key:
            continue

        try:
            flt_val = float(raw_v)
        except (ValueError, TypeError):
            continue

        # Match stream enum
        stream_enum: Optional[BEEPATSectorStream] = None
        for member in BEEPATSectorStream:
            if member.value == raw_s or member.name.lower() == raw_s.lower():
                stream_enum = member
                break
        if not stream_enum:
            # Fallback fuzzy match
            clean_s = re.sub(r"[_\s]+", "", raw_s.lower())
            for member in BEEPATSectorStream:
                if re.sub(r"[_\s]+", "", member.value) == clean_s:
                    stream_enum = member
                    break
        if not stream_enum:
            continue

        unit_str = str(row[u_col]).strip() if u_col and not pd.isna(row[u_col]) else "t"
        source_type = default_source_type
        if src_col and not pd.isna(row[src_col]):
            st_str = str(row[src_col]).strip().lower()
            if "sourc" in st_str or "bill" in st_str or "invoice" in st_str or st_str == "s":
                source_type = SourceType.SOURCING
            elif "corrob" in st_str or "erp" in st_str or "log" in st_str or st_str == "c":
                source_type = SourceType.CORROBORATION
            elif "proforma" in st_str or "form" in st_str or st_str == "p":
                source_type = SourceType.PROFORMA

        norm_val, norm_unit = normalize_reading_value(stream_enum, flt_val, unit_str)

        readings.append(
            CalendarReadingItem(
                stream_key=stream_enum,
                duration_kind="annual" if month_key == "annual" else "monthly",
                month_key=month_key,
                source_type=source_type,
                raw_value=flt_val,
                unit_as_printed=unit_str,
                normalized_value=norm_val,
                normalized_unit=norm_unit,
                confidence=1.0,
                provenance=ExtractionProvenance(
                    sheet_name="Template",
                    cell_coordinate=f"Row_{idx + 2}",
                    source_text=f"{flt_val} {unit_str} ({raw_m})",
                    document_sha256=document_sha256,
                ),
            )
        )

    return readings


# ============================================================================
# OPTION 1C: Template Generator
# ============================================================================

def generate_blank_template(compliance_year: str = "2023-24") -> bytes:
    """
    Generates a pre-formatted Excel template with all 12 fiscal months
    and major BEE PAT-2 Cement streams, styled for auditors and plant engineers.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "VerifyStack Calendar Ingest"

    # Styling
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    border_thin = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    headers = [
        "Month (YYYY-MM)", "Stream Key", "Stream Description",
        "Value", "Unit", "Source Layer (sourcing/corroboration/proforma)", "Remarks"
    ]
    ws.append(headers)

    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # Generate 12 months
    y_match = re.search(r"(\d{4})[-/](\d{2,4})", compliance_year)
    start_y = int(y_match.group(1)) if y_match else 2023
    months = [f"{start_y}-{m:02d}" for m in range(4, 13)] + [f"{start_y + 1}-{m:02d}" for m in range(1, 4)]

    # Key streams to seed
    core_streams = [
        (BEEPATSectorStream.CLINKER_PRODUCTION, "Clinker Production", "t"),
        (BEEPATSectorStream.OPC_PRODUCTION, "OPC Production", "t"),
        (BEEPATSectorStream.PPC_PRODUCTION, "PPC Production", "t"),
        (BEEPATSectorStream.COAL_QUANTITY, "Kiln Coal Consumption", "t"),
        (BEEPATSectorStream.COAL_GCV, "Coal Gross Calorific Value", "kcal/kg"),
        (BEEPATSectorStream.GRID_ELECTRICITY, "Grid Electricity Purchased", "kWh"),
    ]

    for m in months:
        for stream_key, desc, unit in core_streams:
            ws.append([m, stream_key.value, desc, "", unit, "corroboration", ""])

    # Auto-fit column widths
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ============================================================================
# OPTION 2: Arbitrary / Messy Plant Excel Auto-Mapper Agent
# ============================================================================

STREAM_HEURISTIC_KEYWORDS: dict[BEEPATSectorStream, list[str]] = {
    BEEPATSectorStream.CLINKER_PRODUCTION: ["clinker prod", "total clinker", "clinker mtd", "clinker(t)", "clinker mt"],
    BEEPATSectorStream.OPC_PRODUCTION: ["opc prod", "opc cement", "opc 43", "opc 53", "opc(t)"],
    BEEPATSectorStream.PPC_PRODUCTION: ["ppc prod", "ppc cement", "ppc(t)", "ppc mt"],
    BEEPATSectorStream.PSC_PRODUCTION: ["psc prod", "slag cement", "psc(t)"],
    BEEPATSectorStream.EQUIVALENT_PRODUCT: ["equivalent product", "total product", "cement eq", "eq prod"],

    BEEPATSectorStream.COAL_QUANTITY: ["coal cons", "coal quantity", "raw coal", "indigenous coal", "kiln coal", "coal (t)", "coal mt"],
    BEEPATSectorStream.COAL_GCV: ["coal gcv", "coal cv", "calorific value coal", "coal gross calorific"],
    BEEPATSectorStream.PETCOKE_QUANTITY: ["petcoke cons", "petcoke quantity", "petcoke (t)", "pet coke"],
    BEEPATSectorStream.PETCOKE_GCV: ["petcoke gcv", "pet coke gcv"],
    BEEPATSectorStream.IMPORTED_COAL_QUANTITY: ["imported coal", "imp coal cons"],
    BEEPATSectorStream.IMPORTED_COAL_GCV: ["imported coal gcv", "imp coal gcv"],
    BEEPATSectorStream.BIOMASS_AFR_QUANTITY: ["biomass", "afr quantity", "alt fuel", "waste fuel"],

    BEEPATSectorStream.FO_QUANTITY: ["furnace oil", "fo cons", "fo (kl)", "fo quantity"],
    BEEPATSectorStream.HSD_QUANTITY: ["diesel cons", "hsd cons", "hsd quantity", "diesel (kl)"],

    BEEPATSectorStream.GRID_ELECTRICITY: ["grid power", "grid units", "seb power", "grid purchase", "purchased elec", "grid kwh"],
    BEEPATSectorStream.CPP_GENERATION: ["cpp gen", "cpp gross", "captive power", "cpp kwh"],
    BEEPATSectorStream.WHRS_GENERATION: ["whrs gen", "waste heat recovery", "whrs gross", "whr power"],
    BEEPATSectorStream.POWER_EXPORT: ["power export", "export units", "exported electricity"],
}


def auto_map_arbitrary_excel(
    file_bytes_or_path: Any,
    compliance_year: str = "2023-24",
    source_type: SourceType = SourceType.CORROBORATION,
    document_sha256: Optional[str] = None
) -> Tuple[List[CalendarReadingItem], Dict[str, str], List[str]]:
    """
    Heuristic + rule-based analyzer for arbitrary plant spreadsheets (Option 2).
    Inspects sheets, handles merged headers, matches column names to streams,
    extracts monthly time-series readings, and returns:
    (readings, column_mappings, unmapped_columns).
    """
    if isinstance(file_bytes_or_path, (bytes, bytearray)):
        xl_file = pd.ExcelFile(io.BytesIO(file_bytes_or_path))
    else:
        xl_file = pd.ExcelFile(file_bytes_or_path)

    best_sheet = xl_file.sheet_names[0]
    # Pick sheet with the most calendar-like content
    for s_name in xl_file.sheet_names:
        if any(k in s_name.lower() for k in ["monthly", "summary", "data", "scada", "energy", "production"]):
            best_sheet = s_name
            break

    df_raw = xl_file.parse(best_sheet, header=None)

    # Find the header row (search first 10 rows for month/date words)
    header_idx = 0
    for r in range(min(10, len(df_raw))):
        row_vals = [str(v).lower() for v in df_raw.iloc[r] if not pd.isna(v)]
        if any(k in " ".join(row_vals) for k in ["month", "date", "period", "apr", "production", "consumption", "power"]):
            header_idx = r
            break

    # Build clean headers (handle merged multi-row headers if applicable)
    headers: List[str] = []
    for c in range(df_raw.shape[1]):
        val = df_raw.iloc[header_idx, c]
        if header_idx > 0 and pd.isna(val):
            # Try upper row
            val = df_raw.iloc[header_idx - 1, c]
        headers.append(str(val).strip() if not pd.isna(val) else f"Col_{c}")

    df_data = df_raw.iloc[header_idx + 1:].copy()
    df_data.columns = headers

    # Identify the Date/Month column
    date_col: Optional[str] = None
    for h in headers:
        if any(k in h.lower() for k in ["month", "period", "date", "duration"]):
            date_col = h
            break
    if not date_col:
        # Check first column values
        sample_first_col = [parse_fiscal_month(v, compliance_year) for v in df_data.iloc[:12, 0]]
        if sum(1 for m in sample_first_col if m is not None) >= 3:
            date_col = headers[0]

    if not date_col:
        raise ValueError(f"Could not automatically detect Month/Date column in sheet '{best_sheet}'.")

    # Match remaining columns to BEE PAT-2 Streams
    col_mapping: Dict[str, BEEPATSectorStream] = {}
    unmapped: List[str] = []

    for h in headers:
        if h == date_col:
            continue
        h_clean = re.sub(r"[^a-zA-Z0-9\s]", " ", h.lower()).strip()
        matched_stream: Optional[BEEPATSectorStream] = None

        for stream, keywords in STREAM_HEURISTIC_KEYWORDS.items():
            if any(kw in h_clean for kw in keywords):
                matched_stream = stream
                break

        if matched_stream:
            col_mapping[h] = matched_stream
        else:
            unmapped.append(h)

    # Extract readings row by row
    readings: List[CalendarReadingItem] = []

    for r_i, (_, row) in enumerate(df_data.iterrows()):
        raw_m = row[date_col]
        month_key = parse_fiscal_month(raw_m, compliance_year)
        if not month_key:
            continue  # Skips blank lines, subheaders, or non-month notes

        for col_name, stream in col_mapping.items():
            raw_v = row[col_name]
            if pd.isna(raw_v):
                continue

            try:
                flt_val = float(str(raw_v).replace(",", "").strip())
            except (ValueError, TypeError):
                continue

            # Infer unit from column header
            unit_guess = "t"
            h_lower = col_name.lower()
            if "kwh" in h_lower or "unit" in h_lower:
                unit_guess = "Lakh kWh" if "lakh" in h_lower else "kWh"
            elif "kcal" in h_lower:
                unit_guess = "kcal/kg"
            elif "kl" in h_lower or "litre" in h_lower:
                unit_guess = "kL"

            norm_val, norm_unit = normalize_reading_value(stream, flt_val, unit_guess)

            readings.append(
                CalendarReadingItem(
                    stream_key=stream,
                    duration_kind="annual" if month_key == "annual" else "monthly",
                    month_key=month_key,
                    source_type=source_type,
                    raw_value=flt_val,
                    unit_as_printed=unit_guess,
                    normalized_value=norm_val,
                    normalized_unit=norm_unit,
                    confidence=0.95,
                    provenance=ExtractionProvenance(
                        sheet_name=best_sheet,
                        cell_coordinate=f"{best_sheet}!{col_name}_Row{r_i + header_idx + 2}",
                        source_text=f"{flt_val} (Month: {raw_m}, Col: {col_name})",
                        document_sha256=document_sha256,
                    ),
                )
            )

    return readings, {k: v.value for k, v in col_mapping.items()}, unmapped
