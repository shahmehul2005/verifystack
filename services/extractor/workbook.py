"""Workbook loading for the Extractor_Service.

This module turns uploaded bytes into one ``Workbook`` model, whatever the
source format (xlsx, xls or csv). It holds:

* format detection from magic bytes (``detect_format``),
* loaders for xlsx (cached values plus formula text), xls and csv,
* merged-range lookup for header cells,
* A1 address helpers that work up to column ``XFD`` and the Raw_Id helpers,
* ``FormulaEvaluator``, a parser-based evaluator for the small formula subset
  that pro forma workbooks use. It never executes dynamic code,
* ``build_calendar_template``, the writer for the downloadable calendar template.

Parsers read the ``Workbook`` it returns; they never open a file themselves.
Apart from the template writer, which needs the stream table, the module does
not depend on other extractor modules.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import (
    ROUND_HALF_UP,
    Context,
    Decimal,
    DivisionByZero,
    InvalidOperation,
    Overflow,
    localcontext,
)
from typing import Any, Literal, NamedTuple

__all__ = [
    "CALENDAR_HEADERS",
    "CALENDAR_SHEET",
    "INSTRUCTIONS_SHEET",
    "MAX_COL",
    "MAX_ROW",
    "STREAMS_SHEET",
    "STREAM_LABELS",
    "SUPPORTED_FORMATS",
    "Cell",
    "CorruptFile",
    "EvalResult",
    "FormulaEvaluator",
    "MergedRange",
    "PasswordProtected",
    "Sheet",
    "UnsupportedFormat",
    "Workbook",
    "a1",
    "build_calendar_template",
    "detect_format",
    "load_workbook_bytes",
    "make_raw_id",
    "parse_a1",
    "split_raw_id",
    "template_months",
]

SUPPORTED_FORMATS: tuple[str, ...] = ("xlsx", "xls", "csv", "pdf")

MAX_COL = 16384  # XFD
MAX_ROW = 1_048_576

_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE2_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
_ENCRYPTED_PACKAGE = "EncryptedPackage".encode("utf-16-le")
_XLS_STREAMS = ("Workbook".encode("utf-16-le"), "Book".encode("utf-16-le"))
_CSV_DELIMITERS = (",", ";", "\t", "|")
_MAX_UNCOMPRESSED_BYTES = 400 * 1024 * 1024  # guard against zip bombs

Format = Literal["xlsx", "xls", "csv", "pdf"]


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class UnsupportedFormat(Exception):
    """The content matches none of the supported formats (HTTP 415)."""

    def __init__(self, message: str = "Unsupported file format") -> None:
        super().__init__(message)
        self.supported: tuple[str, ...] = SUPPORTED_FORMATS


class CorruptFile(Exception):
    """The file is damaged or cannot be parsed (HTTP 422)."""


class PasswordProtected(Exception):
    """The file is encrypted and needs a password (HTTP 422)."""


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------


@dataclass
class Cell:
    """One non-empty cell. ``row`` and ``col`` are 1-based.

    ``value`` is the cached value (number, str, bool, datetime or ``None``).
    ``formula`` is the formula text as stored in the file, including the
    leading ``=``. It is ``None`` for plain cells and for xls and csv files.
    """

    sheet: str
    row: int
    col: int
    value: Any = None
    formula: str | None = None
    is_date: bool = False

    @property
    def ref(self) -> str:
        return a1(self.row, self.col)

    @property
    def raw_id(self) -> str:
        return make_raw_id(self.sheet, self.row, self.col)


@dataclass(frozen=True)
class MergedRange:
    """A merged block of cells, 1-based and inclusive."""

    min_row: int
    min_col: int
    max_row: int
    max_col: int

    def contains(self, row: int, col: int) -> bool:
        return self.min_row <= row <= self.max_row and self.min_col <= col <= self.max_col


@dataclass
class Sheet:
    name: str
    cells: dict[tuple[int, int], Cell] = field(default_factory=dict)
    merged: list[MergedRange] = field(default_factory=list)
    max_row: int = 0
    max_col: int = 0

    def cell(self, row: int, col: int) -> Cell | None:
        """The stored cell at ``(row, col)``. Merges are not expanded."""
        return self.cells.get((row, col))

    def merged_range_at(self, row: int, col: int) -> MergedRange | None:
        for rng in self.merged:
            if rng.contains(row, col):
                return rng
        return None

    def header_cell(self, row: int, col: int) -> Cell | None:
        """The cell at ``(row, col)`` with merged ranges expanded.

        Inside a merged range, every position returns the top-left cell of the
        range. This is for header detection only. Data cells must be read with
        ``cell``, which never fills from a merge.
        """
        rng = self.merged_range_at(row, col)
        if rng is not None:
            return self.cells.get((rng.min_row, rng.min_col))
        return self.cells.get((row, col))

    def header_value(self, row: int, col: int) -> Any:
        cell = self.header_cell(row, col)
        return None if cell is None else cell.value


@dataclass
class Workbook:
    sheets: list[Sheet]
    epoch: Literal[1900, 1904] = 1900
    fmt: Literal["xlsx", "xls", "csv"] = "xlsx"

    def sheet(self, name: str) -> Sheet | None:
        for sh in self.sheets:
            if sh.name == name:
                return sh
        return None


# --------------------------------------------------------------------------
# A1 addresses and Raw_Ids
# --------------------------------------------------------------------------

_A1_PATTERN = r"^\$?([A-Za-z]{1,3})\$?([0-9]+)$"


def a1(row: int, col: int) -> str:
    """Return the A1 address for 1-based ``row`` and ``col`` (``1, 28`` is ``AB1``)."""
    if not 1 <= col <= MAX_COL:
        raise ValueError(f"column out of range: {col}")
    if not 1 <= row <= MAX_ROW:
        raise ValueError(f"row out of range: {row}")
    letters: list[str] = []
    n = col
    while n > 0:
        n, rem = divmod(n - 1, 26)
        letters.append(chr(ord("A") + rem))
    return "".join(reversed(letters)) + str(row)


def parse_a1(ref: str) -> tuple[int, int]:
    """Parse ``AB17`` (or ``$AB$17``) to a 1-based ``(row, col)``."""
    m = re.match(_A1_PATTERN, ref.strip()) if isinstance(ref, str) else None
    if m is None:
        raise ValueError(f"invalid A1 reference: {ref!r}")
    col = 0
    for ch in m.group(1).upper():
        col = col * 26 + (ord(ch) - ord("A") + 1)
    row = int(m.group(2))
    if not 1 <= col <= MAX_COL or not 1 <= row <= MAX_ROW:
        raise ValueError(f"A1 reference out of range: {ref!r}")
    return row, col


def make_raw_id(sheet: str, row: int, col: int) -> str:
    """The Raw_Id of a spreadsheet cell: ``sheet!cell``."""
    return f"{sheet}!{a1(row, col)}"


def split_raw_id(raw_id: str) -> tuple[str, str]:
    """Split a spreadsheet Raw_Id into ``(sheet, cell_ref)``.

    Excel allows ``!`` inside sheet names, so the split is on the last ``!``.
    Raises ``ValueError`` when there is no ``!`` or the cell part is not a
    valid A1 address.
    """
    sheet, sep, ref = raw_id.rpartition("!")
    if not sep or not sheet:
        raise ValueError(f"invalid Raw_Id: {raw_id!r}")
    parse_a1(ref)  # validates
    return sheet, ref.replace("$", "").upper()


# --------------------------------------------------------------------------
# Text and delimiter helpers
# --------------------------------------------------------------------------

_CONTROL_PATTERN = r"[\x00-\x08\x0b\x0c\x0e-\x1f]"


def _decode_text(data: bytes) -> str | None:
    """Decode csv bytes (UTF-8 with or without BOM, UTF-16 with BOM, cp1252).

    Returns ``None`` when the bytes are not text.
    """
    if not data:
        return None
    text: str | None = None
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            text = data.decode("utf-16")
        except UnicodeDecodeError:
            return None
    else:
        if b"\x00" in data:
            return None
        for enc in ("utf-8-sig", "cp1252"):
            try:
                text = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
    if text is None or re.search(_CONTROL_PATTERN, text):
        return None
    return text.lstrip("\ufeff")


def _sniff_delimiter(text: str) -> str | None:
    """Pick the delimiter that splits at least two rows into two or more fields.

    Among candidates, the one with the most rows of the modal width wins, then
    the wider one. Returns ``None`` when no delimiter qualifies.
    """
    best: tuple[int, int] | None = None
    best_delim: str | None = None
    for delim in _CSV_DELIMITERS:
        if delim not in text:
            continue
        widths: dict[int, int] = {}
        multi = 0
        try:
            reader = csv.reader(io.StringIO(text, newline=""), delimiter=delim)
            for i, row in enumerate(reader):
                if i >= 200:
                    break
                if not any(c.strip() for c in row):
                    continue
                if len(row) >= 2:
                    multi += 1
                    widths[len(row)] = widths.get(len(row), 0) + 1
        except csv.Error:
            continue
        if multi < 2:
            continue
        width, count = max(widths.items(), key=lambda kv: (kv[1], kv[0]))
        score = (count, width)
        if best is None or score > best:
            best, best_delim = score, delim
    return best_delim


# --------------------------------------------------------------------------
# Format detection
# --------------------------------------------------------------------------


def detect_format(data: bytes) -> Format:
    """Detect the format from magic bytes.

    Raises:
        UnsupportedFormat: the content matches no supported format.
        PasswordProtected: an encrypted Office container.
        CorruptFile: a ZIP signature on an archive that cannot be read.
    """
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise UnsupportedFormat("Empty file")
    data = bytes(data)

    if _PDF_MAGIC in data[:1024]:
        return "pdf"

    if data.startswith(_ZIP_MAGIC):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
        except (zipfile.BadZipFile, OSError, ValueError, NotImplementedError) as exc:
            raise CorruptFile("The file is a damaged ZIP archive") from exc
        if "[Content_Types].xml" in names and "xl/workbook.xml" in names:
            return "xlsx"
        raise UnsupportedFormat("ZIP archive is not an xlsx workbook")

    if data.startswith(_OLE2_MAGIC):
        if _ENCRYPTED_PACKAGE in data:
            raise PasswordProtected("The workbook is password-protected")
        if any(marker in data for marker in _XLS_STREAMS):
            return "xls"
        raise UnsupportedFormat("OLE2 container is not an xls workbook")

    text = _decode_text(data)
    if text is not None and _sniff_delimiter(text) is not None:
        return "csv"

    raise UnsupportedFormat("Content matches none of the supported formats")


# --------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------


def load_workbook_bytes(data: bytes, fmt: str) -> Workbook:
    """Load ``data`` as ``fmt`` (``xlsx``, ``xls`` or ``csv``).

    Raises:
        UnsupportedFormat: ``fmt`` is not a spreadsheet format.
        PasswordProtected: the workbook is encrypted.
        CorruptFile: the file cannot be parsed.
    """
    data = bytes(data)
    if fmt == "xlsx":
        return _load_xlsx(data)
    if fmt == "xls":
        return _load_xls(data)
    if fmt == "csv":
        return _load_csv(data)
    raise UnsupportedFormat(f"{fmt!r} is not a spreadsheet format")


def _finish(sheet: Sheet) -> Sheet:
    if sheet.cells:
        sheet.max_row = max(r for r, _ in sheet.cells)
        sheet.max_col = max(c for _, c in sheet.cells)
    return sheet


def _raise_if_encrypted(data: bytes) -> None:
    if data.startswith(_OLE2_MAGIC) and _ENCRYPTED_PACKAGE in data:
        raise PasswordProtected("The workbook is password-protected")


def _as_datetime(value: Any) -> Any:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    return value


def _load_xlsx(data: bytes) -> Workbook:
    import openpyxl  # imported here so detection works without the package loaded

    _raise_if_encrypted(data)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if sum(i.file_size for i in zf.infolist()) > _MAX_UNCOMPRESSED_BYTES:
                raise CorruptFile("The workbook expands to an unreasonable size")
    except zipfile.BadZipFile as exc:
        raise CorruptFile("The file is not a valid xlsx workbook") from exc

    try:
        wb_values = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        wb_formulas = openpyxl.load_workbook(io.BytesIO(data), data_only=False)
    except CorruptFile:
        raise
    except Exception as exc:  # openpyxl raises many types for damaged files
        raise CorruptFile("The file is not a valid xlsx workbook") from exc

    try:
        epoch_year = getattr(getattr(wb_values, "epoch", None), "year", 1900)
        epoch: Literal[1900, 1904] = 1904 if epoch_year == 1904 else 1900

        sheets: list[Sheet] = []
        for ws_v in wb_values.worksheets:
            ws_f = wb_formulas[ws_v.title] if ws_v.title in wb_formulas.sheetnames else None
            sheet = Sheet(name=ws_v.title)
            formula_cells = dict(getattr(ws_f, "_cells", {})) if ws_f is not None else {}
            value_cells = dict(ws_v._cells)

            for key in set(value_cells) | set(formula_cells):
                row, col = key
                if not (1 <= row <= MAX_ROW and 1 <= col <= MAX_COL):
                    continue
                vcell = value_cells.get(key)
                fcell = formula_cells.get(key)

                formula: str | None = None
                if fcell is not None and fcell.data_type == "f":
                    raw = fcell.value
                    text = getattr(raw, "text", raw)  # ArrayFormula keeps text
                    if isinstance(text, str) and text:
                        formula = text if text.startswith("=") else "=" + text

                value = vcell.value if vcell is not None else None
                if value is None and formula is None:
                    continue
                if isinstance(value, str) and value == "" and formula is None:
                    continue

                is_date = bool(
                    vcell is not None
                    and isinstance(value, (datetime, date, time))
                    and getattr(vcell, "is_date", True)
                )
                if isinstance(value, (datetime, date)) and not isinstance(value, datetime):
                    value = _as_datetime(value)
                sheet.cells[key] = Cell(
                    sheet=sheet.name,
                    row=row,
                    col=col,
                    value=value,
                    formula=formula,
                    is_date=is_date,
                )

            for rng in ws_v.merged_cells.ranges:
                sheet.merged.append(
                    MergedRange(rng.min_row, rng.min_col, rng.max_row, rng.max_col)
                )
            sheets.append(_finish(sheet))
    except CorruptFile:
        raise
    except Exception as exc:
        raise CorruptFile("The xlsx workbook could not be read") from exc
    finally:
        wb_values.close()
        wb_formulas.close()

    return Workbook(sheets=sheets, epoch=epoch, fmt="xlsx")


def _load_xls(data: bytes) -> Workbook:
    import xlrd

    _raise_if_encrypted(data)

    def _is_encrypted(exc: BaseException) -> bool:
        return "encrypt" in str(exc).lower() or "password" in str(exc).lower()

    book = None
    try:
        book = xlrd.open_workbook(file_contents=data, formatting_info=True)
    except Exception as exc:
        if _is_encrypted(exc):
            raise PasswordProtected("The workbook is password-protected") from exc
        try:  # formatting_info fails on some files that otherwise load
            book = xlrd.open_workbook(file_contents=data, formatting_info=False)
        except Exception as exc2:
            if _is_encrypted(exc2):
                raise PasswordProtected("The workbook is password-protected") from exc2
            raise CorruptFile("The file is not a valid xls workbook") from exc2

    try:
        epoch: Literal[1900, 1904] = 1904 if book.datemode == 1 else 1900
        sheets: list[Sheet] = []
        for ws in book.sheets():
            sheet = Sheet(name=ws.name)
            for r in range(ws.nrows):
                for c in range(ws.ncols):
                    ctype = ws.cell_type(r, c)
                    if ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                        continue
                    raw = ws.cell_value(r, c)
                    is_date = False
                    value: Any
                    if ctype == xlrd.XL_CELL_DATE:
                        try:
                            value = xlrd.xldate.xldate_as_datetime(raw, book.datemode)
                            is_date = True
                        except Exception:
                            value = raw
                    elif ctype == xlrd.XL_CELL_BOOLEAN:
                        value = bool(raw)
                    elif ctype == xlrd.XL_CELL_ERROR:
                        value = xlrd.error_text_from_code.get(raw, "#ERR")
                    elif ctype == xlrd.XL_CELL_TEXT:
                        if raw == "":
                            continue
                        value = raw
                    else:
                        value = raw
                    sheet.cells[(r + 1, c + 1)] = Cell(
                        sheet=sheet.name, row=r + 1, col=c + 1, value=value, is_date=is_date
                    )
            for rlo, rhi, clo, chi in getattr(ws, "merged_cells", []) or []:
                sheet.merged.append(MergedRange(rlo + 1, clo + 1, rhi, chi))
            sheets.append(_finish(sheet))
    except Exception as exc:
        raise CorruptFile("The xls workbook could not be read") from exc
    finally:
        book.release_resources()

    return Workbook(sheets=sheets, epoch=epoch, fmt="xls")


def _load_csv(data: bytes) -> Workbook:
    text = _decode_text(data)
    if text is None:
        raise CorruptFile("The file is not readable text")
    delim = _sniff_delimiter(text)
    if delim is None:
        raise CorruptFile("No delimiter found in the csv file")

    sheet = Sheet(name="Sheet1")
    try:
        for r, row in enumerate(csv.reader(io.StringIO(text, newline=""), delimiter=delim), 1):
            if r > MAX_ROW:
                break
            for c, raw in enumerate(row, 1):
                if c > MAX_COL:
                    break
                value = raw.strip()
                if value:
                    sheet.cells[(r, c)] = Cell(sheet=sheet.name, row=r, col=c, value=value)
    except csv.Error as exc:
        raise CorruptFile("The csv file could not be parsed") from exc

    return Workbook(sheets=[_finish(sheet)], epoch=1900, fmt="csv")


# --------------------------------------------------------------------------
# Formula evaluation
# --------------------------------------------------------------------------
#
# A tokenizer and a recursive-descent parser turn formula text into a small
# AST. A separate set of methods on ``FormulaEvaluator`` walks that AST. The
# text is only ever read as data: nothing in this module runs it as code.
#
# Supported: numbers, ``A1``, ``$A$1``, ``Sheet!A1``, ``'Sheet Name'!A1``,
# ranges (``A1:B5``, function arguments only), ``+ - * / ^``, unary ``+`` and
# ``-``, postfix ``%``, parentheses, and ``SUM``, ``MIN``, ``MAX``, ``ROUND``
# and ``ABS``. Precedence follows Excel, from tightest to loosest: unary sign,
# ``%``, ``^``, ``* /``, ``+ -``. Every binary operator is left-associative, so
# ``-2^2`` is ``4`` and ``2^3^2`` is ``64``.
#
# Anything else yields no value and a warning that names the cell: an
# unsupported function or operator, an unresolved sheet or name, a text
# operand, division by zero, a circular reference, or nesting deeper than
# ``_MAX_NESTING`` levels.

_MAX_FORMULA_CHARS = 32768
_MAX_NESTING = 100
_CALC_PREC = 34
_DIGITS = "0123456789"
_PRECEDENCE = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 3}
_FUNCTIONS = ("SUM", "MIN", "MAX", "ROUND", "ABS")

# Arithmetic runs in this context: 34 significant digits, and any overflow,
# invalid operation or division by zero raises instead of returning a special
# value.
_CALC_CONTEXT = Context(
    prec=_CALC_PREC,
    Emin=-999999,
    Emax=999999,
    traps=[InvalidOperation, DivisionByZero, Overflow],
)


class _FormulaError(Exception):
    """An expected failure while reading or evaluating one formula.

    ``cell`` is the ``(sheet, row, col)`` of the formula that first raised it.
    """

    def __init__(self, message: str, cell: tuple[str, int, int] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.cell = cell


def _clip(text: str, limit: int = 40) -> str:
    return text if len(text) <= limit else text[:limit] + "..."


# ---- tokens ----


class _Token(NamedTuple):
    kind: str  # num, str, ref, func, op, lparen, rparen, comma, colon
    value: Any
    pos: int


def _parse_cell_word(word: str) -> tuple[int, int] | None:
    """``A1`` or ``$AB$17`` to a 1-based ``(row, col)``; ``None`` if not a cell."""
    n = len(word)
    i = 1 if word.startswith("$") else 0
    j = i
    while j < n and word[j].isascii() and word[j].isalpha():
        j += 1
    letters = word[i:j]
    if not 1 <= len(letters) <= 3:
        return None
    if j < n and word[j] == "$":
        j += 1
    digits = word[j:]
    if not digits or not digits.isascii() or not digits.isdigit() or digits.startswith("0"):
        return None
    col = 0
    for ch in letters.upper():
        col = col * 26 + (ord(ch) - ord("A") + 1)
    row = int(digits)
    if col > MAX_COL or row > MAX_ROW:
        return None
    return row, col


def _scan_word(text: str, i: int) -> tuple[str, int]:
    n = len(text)
    j = i
    while j < n and (text[j].isalnum() or text[j] in "_.$"):
        j += 1
    return text[i:j], j


def _ref_token(sheet: str | None, word: str, pos: int) -> _Token:
    rc = _parse_cell_word(word)
    if rc is None:
        raise _FormulaError(f"unresolved name or reference '{_clip(word)}'")
    return _Token("ref", (sheet, rc[0], rc[1]), pos)


def _quoted(text: str, i: int, quote: str) -> tuple[str, int]:
    """Read a quoted run starting at ``text[i]``; a doubled quote is a literal."""
    n = len(text)
    j = i + 1
    buf: list[str] = []
    while True:
        if j >= n:
            raise _FormulaError("unterminated quoted text")
        if text[j] == quote:
            if j + 1 < n and text[j + 1] == quote:
                buf.append(quote)
                j += 2
                continue
            return "".join(buf), j + 1
        buf.append(text[j])
        j += 1


def _tokenize(text: str) -> list[_Token]:
    tokens: list[_Token] = []
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
        elif ch in _DIGITS or (ch == "." and i + 1 < n and text[i + 1] in _DIGITS):
            j = i
            while j < n and text[j] in _DIGITS:
                j += 1
            if j < n and text[j] == ".":
                j += 1
                while j < n and text[j] in _DIGITS:
                    j += 1
            if j < n and text[j] in "eE":
                k = j + 1
                if k < n and text[k] in "+-":
                    k += 1
                if k < n and text[k] in _DIGITS:
                    while k < n and text[k] in _DIGITS:
                        k += 1
                    j = k
            try:
                number = Decimal(text[i:j])
            except InvalidOperation as exc:
                raise _FormulaError("invalid number") from exc
            tokens.append(_Token("num", number, i))
            i = j
        elif ch == '"':
            value, j = _quoted(text, i, '"')
            tokens.append(_Token("str", value, i))
            i = j
        elif ch == "'":
            sheet, j = _quoted(text, i, "'")
            if j >= n or text[j] != "!":
                raise _FormulaError("quoted sheet name must be followed by '!'")
            word, k = _scan_word(text, j + 1)
            tokens.append(_ref_token(sheet, word, i))
            i = k
        elif ch.isalpha() or ch in "_$":
            word, j = _scan_word(text, i)
            if j < n and text[j] == "(":
                tokens.append(_Token("func", word.upper(), i))
                i = j
            elif j < n and text[j] == "!":
                word2, k = _scan_word(text, j + 1)
                tokens.append(_ref_token(word, word2, i))
                i = k
            else:
                tokens.append(_ref_token(None, word, i))
                i = j
        elif ch in "+-*/^%":
            tokens.append(_Token("op", ch, i))
            i += 1
        elif ch == "(":
            tokens.append(_Token("lparen", ch, i))
            i += 1
        elif ch == ")":
            tokens.append(_Token("rparen", ch, i))
            i += 1
        elif ch == ",":
            tokens.append(_Token("comma", ch, i))
            i += 1
        elif ch == ":":
            tokens.append(_Token("colon", ch, i))
            i += 1
        else:
            raise _FormulaError(f"unsupported character {ch!r}")
    return tokens


# ---- AST ----


@dataclass(frozen=True)
class _Num:
    value: Decimal


@dataclass(frozen=True)
class _Str:
    value: str


@dataclass(frozen=True)
class _CellRef:
    sheet: str | None
    row: int
    col: int


@dataclass(frozen=True)
class _RangeRef:
    sheet: str | None
    min_row: int
    min_col: int
    max_row: int
    max_col: int


@dataclass(frozen=True)
class _Unary:
    op: str
    operand: Any


@dataclass(frozen=True)
class _Percent:
    operand: Any


@dataclass(frozen=True)
class _Binary:
    op: str
    left: Any
    right: Any


@dataclass(frozen=True)
class _Call:
    name: str
    args: tuple[Any, ...]


class _Parser:
    """Recursive-descent parser with precedence climbing for binary operators."""

    def __init__(self, tokens: list[_Token]) -> None:
        self._tokens = tokens
        self._i = 0
        self._depth = 0

    def parse(self) -> Any:
        if not self._tokens:
            raise _FormulaError("empty formula")
        node = self._binary(1)
        if self._i < len(self._tokens):
            raise _FormulaError("unexpected token in formula")
        return node

    def _peek(self) -> _Token | None:
        return self._tokens[self._i] if self._i < len(self._tokens) else None

    def _enter(self) -> None:
        self._depth += 1
        if self._depth > _MAX_NESTING:
            raise _FormulaError(f"formula nesting is deeper than {_MAX_NESTING} levels")

    def _leave(self) -> None:
        self._depth -= 1

    def _expect(self, kind: str) -> None:
        tok = self._peek()
        if tok is None or tok.kind != kind:
            raise _FormulaError("unbalanced or misplaced punctuation in formula")
        self._i += 1

    def _binary(self, min_prec: int) -> Any:
        left = self._unary()
        while True:
            tok = self._peek()
            if tok is None or tok.kind != "op":
                return left
            prec = _PRECEDENCE.get(tok.value)
            if prec is None or prec < min_prec:
                return left
            self._i += 1
            right = self._binary(prec + 1)
            left = _Binary(tok.value, left, right)

    def _unary(self) -> Any:
        tok = self._peek()
        if tok is not None and tok.kind == "op" and tok.value in "+-":
            self._i += 1
            self._enter()
            operand = self._unary()
            self._leave()
            return _Unary(tok.value, operand)
        node = self._primary()
        percents = 0
        while True:
            tok = self._peek()
            if tok is None or tok.kind != "op" or tok.value != "%":
                return node
            self._i += 1
            percents += 1
            if percents > _MAX_NESTING:
                raise _FormulaError(f"formula nesting is deeper than {_MAX_NESTING} levels")
            node = _Percent(node)

    def _primary(self) -> Any:
        tok = self._peek()
        if tok is None:
            raise _FormulaError("formula ends unexpectedly")
        self._i += 1
        if tok.kind == "num":
            return _Num(tok.value)
        if tok.kind == "str":
            return _Str(tok.value)
        if tok.kind == "ref":
            sheet, row, col = tok.value
            nxt = self._peek()
            if nxt is None or nxt.kind != "colon":
                return _CellRef(sheet, row, col)
            self._i += 1
            end = self._peek()
            if end is None or end.kind != "ref":
                raise _FormulaError("range must end with a cell reference")
            self._i += 1
            sheet2, row2, col2 = end.value
            if sheet2 is not None and (sheet is None or sheet2.casefold() != sheet.casefold()):
                raise _FormulaError("range spans more than one sheet")
            return _RangeRef(
                sheet, min(row, row2), min(col, col2), max(row, row2), max(col, col2)
            )
        if tok.kind == "func":
            self._expect("lparen")
            self._enter()
            args: list[Any] = []
            nxt = self._peek()
            if nxt is not None and nxt.kind == "rparen":
                self._i += 1
            else:
                while True:
                    args.append(self._binary(1))
                    sep = self._peek()
                    if sep is not None and sep.kind == "comma":
                        self._i += 1
                        continue
                    self._expect("rparen")
                    break
            self._leave()
            return _Call(tok.value, tuple(args))
        if tok.kind == "lparen":
            self._enter()
            node = self._binary(1)
            self._expect("rparen")
            self._leave()
            return node
        raise _FormulaError("unexpected token in formula")


# ---- arithmetic ----


def _power(base: Decimal, exponent: Decimal) -> Decimal:
    if base == 0:
        if exponent == 0:
            raise _FormulaError("0 raised to the power 0 is undefined")
        if exponent < 0:
            raise _FormulaError("division by zero")
        return Decimal(0)
    if base < 0 and exponent != exponent.to_integral_value():
        raise _FormulaError("negative number raised to a fractional power")
    return base**exponent


def _apply(op: str, a: Decimal, b: Decimal) -> Decimal:
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    if op == "/":
        if b == 0:
            raise _FormulaError("division by zero")
        return a / b
    return _power(a, b)


def _round_half_away(x: Decimal, digits: Decimal) -> Decimal:
    """Excel ROUND: ties go away from zero. ``digits`` is truncated to an integer."""
    n = max(-1000, min(1000, int(digits)))
    if x == 0:
        return Decimal(0)
    if n >= 0:
        if n >= _CALC_PREC - x.adjusted() - 1:
            return x  # already has no digits beyond the working precision
        return x.quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP)
    if -n > x.adjusted() + 1:
        return Decimal(0)
    return x.quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP)


def _plain(value: Decimal) -> Decimal:
    """Normalize ``-0`` and positive exponents (``1E+3``) for stable output."""
    if value == 0:
        return Decimal(0)
    if value.as_tuple().exponent > 0:  # type: ignore[operator]
        try:
            return value.quantize(Decimal(1))
        except InvalidOperation:
            return value
    return value


# ---- evaluator ----


@dataclass(frozen=True)
class EvalResult:
    """Outcome of evaluating one cell.

    ``value`` is ``None`` when the cell cannot be read as a number, and
    ``warning`` then names the cell and the reason. ``evaluated`` is ``True``
    when the value came from running the formula and ``False`` when it was
    read from the cached value.
    """

    value: Decimal | None
    warning: str | None = None
    formula: str | None = None
    evaluated: bool = False


class FormulaEvaluator:
    """Evaluate formulas of a loaded ``Workbook`` without running any code.

    The cached value of a cell always wins. The formula is evaluated only when
    the cache is empty (Requirement 6.6) or when ``use_cache=False``.
    Referenced formula cells follow the same rule.
    """

    def __init__(self, workbook: Workbook) -> None:
        self._wb = workbook
        self._by_name = {sh.name: sh for sh in workbook.sheets}
        self._by_fold = {sh.name.casefold(): sh for sh in workbook.sheets}
        self._trees: dict[str, Any] = {}
        self._memo: dict[tuple[str, int, int], Decimal] = {}
        self._stack: list[tuple[str, int, int]] = []

    # ---- public API ----

    def evaluate_cell(
        self, sheet: str, row: int, col: int, *, use_cache: bool = True
    ) -> EvalResult:
        """Return the numeric value of one cell, or no value and a warning."""
        label = self._label(sheet, row, col)
        sh = self._sheet(sheet)
        if sh is None:
            return EvalResult(None, f"{label}: sheet not found")
        cell = sh.cells.get((row, col))
        if cell is None:
            return EvalResult(None, f"{label}: cell is empty")
        if cell.formula is None or (use_cache and cell.value is not None):
            cached = self._coerce(cell.value)
            if isinstance(cached, Decimal):
                return EvalResult(_plain(cached), None, cell.formula, False)
            return EvalResult(
                None, f"{label}: cell holds no numeric value", cell.formula, False
            )
        return self._evaluate_text(cell.formula, sh.name, row, col, label)

    def evaluate_formula(
        self, formula: str, sheet: str, row: int = 1, col: int = 1
    ) -> EvalResult:
        """Evaluate formula text as if it were written in ``sheet`` at ``row, col``."""
        label = self._label(sheet, row, col)
        sh = self._sheet(sheet)
        if sh is None:
            return EvalResult(None, f"{label}: sheet not found", formula)
        return self._evaluate_text(formula, sh.name, row, col, label)

    # ---- entry ----

    def _evaluate_text(
        self, formula: str, sheet_name: str, row: int, col: int, label: str
    ) -> EvalResult:
        self._stack = []
        top = (sheet_name, row, col)
        try:
            with localcontext(_CALC_CONTEXT):
                value = self._run_formula(formula, sheet_name, row, col)
                result = _plain(value)
        except _FormulaError as exc:
            reason = exc.message
            if exc.cell is not None and exc.cell != top:
                reason += f" (in {self._label(*exc.cell)})"
            return EvalResult(None, f"{label}: formula not evaluated: {reason}", formula)
        except RecursionError:
            return EvalResult(
                None, f"{label}: formula not evaluated: formula nesting is too deep", formula
            )
        except ArithmeticError:
            return EvalResult(
                None, f"{label}: formula not evaluated: arithmetic error or overflow", formula
            )
        finally:
            self._stack = []
        return EvalResult(result, None, formula, True)

    # ---- helpers ----

    @staticmethod
    def _label(sheet: str, row: int, col: int) -> str:
        try:
            return f"{sheet}!{a1(row, col)}"
        except ValueError:
            return f"{sheet}!R{row}C{col}"

    def _sheet(self, name: str) -> Sheet | None:
        return self._by_name.get(name) or self._by_fold.get(name.casefold())

    def _parse(self, formula: str) -> Any:
        text = formula.strip()
        if text.startswith("="):
            text = text[1:]
        if len(text) > _MAX_FORMULA_CHARS:
            raise _FormulaError("formula is too long")
        tree = self._trees.get(text)
        if tree is None:
            tree = _Parser(_tokenize(text)).parse()
            self._trees[text] = tree
        return tree

    def _run_formula(self, formula: str, sheet_name: str, row: int, col: int) -> Decimal:
        key = (sheet_name, row, col)
        self._stack.append(key)
        try:
            return self._num(self._parse(formula), sheet_name)
        except _FormulaError as exc:
            if exc.cell is None:
                exc.cell = key
            raise
        finally:
            self._stack.pop()

    def _serial(self, value: Any) -> Decimal:
        base = datetime(1904, 1, 1) if self._wb.epoch == 1904 else datetime(1899, 12, 30)
        if isinstance(value, time):
            seconds = value.hour * 3600 + value.minute * 60 + value.second
            return (Decimal(seconds) + Decimal(value.microsecond) / 1_000_000) / 86400
        if isinstance(value, datetime):
            moment = value.replace(tzinfo=None)
        else:
            moment = datetime(value.year, value.month, value.day)
        delta = moment - base
        return (
            Decimal(delta.days)
            + (Decimal(delta.seconds) + Decimal(delta.microseconds) / 1_000_000) / 86400
        )

    def _coerce(self, value: Any) -> Decimal | str | None:
        """A stored value as ``Decimal`` (number), ``str`` (text) or ``None`` (empty)."""
        if value is None:
            return None
        if isinstance(value, bool):
            return Decimal(int(value))
        if isinstance(value, (int, float, Decimal)):
            try:
                number = Decimal(str(value))
            except InvalidOperation:
                return "#NUM!"
            return number if number.is_finite() else "#NUM!"
        if isinstance(value, (datetime, date, time)):
            return self._serial(value)
        return value if isinstance(value, str) else str(value)

    def _scalar(self, sh: Sheet, row: int, col: int) -> Decimal | str | None:
        cell = sh.cells.get((row, col))
        if cell is None:
            return None
        if cell.formula is not None and cell.value is None:
            return self._formula_cell(sh, cell)
        return self._coerce(cell.value)

    def _formula_cell(self, sh: Sheet, cell: Cell) -> Decimal:
        key = (sh.name, cell.row, cell.col)
        known = self._memo.get(key)
        if known is not None:
            return known
        if key in self._stack:
            raise _FormulaError("circular reference", key)
        if len(self._stack) >= _MAX_NESTING:
            raise _FormulaError(
                f"formulas depend on each other more than {_MAX_NESTING} levels deep", key
            )
        value = self._run_formula(cell.formula or "", sh.name, cell.row, cell.col)
        self._memo[key] = value
        return value

    def _resolve_sheet(self, name: str | None, current: str) -> Sheet:
        sh = self._sheet(current if name is None else name)
        if sh is None:
            raise _FormulaError(f"sheet '{_clip(name or current)}' not found")
        return sh

    # ---- AST walk ----

    def _num(self, node: Any, sheet: str) -> Decimal:
        """Evaluate ``node`` to a number. Text operands are errors."""
        if isinstance(node, _Num):
            return node.value
        if isinstance(node, _Binary):
            # Walk the left spine iteratively so long chains (a+b+c+...) do not
            # grow the Python stack.
            spine: list[_Binary] = []
            cur: Any = node
            while isinstance(cur, _Binary):
                spine.append(cur)
                cur = cur.left
            acc = self._num(cur, sheet)
            for item in reversed(spine):
                acc = _apply(item.op, acc, self._num(item.right, sheet))
            return acc
        if isinstance(node, _Unary):
            inner = self._num(node.operand, sheet)
            return -inner if node.op == "-" else inner
        if isinstance(node, _Percent):
            return self._num(node.operand, sheet) / 100
        if isinstance(node, _CellRef):
            value = self._scalar(self._resolve_sheet(node.sheet, sheet), node.row, node.col)
            if value is None:
                return Decimal(0)
            if isinstance(value, str):
                raise _FormulaError("text operand")
            return value
        if isinstance(node, _Call):
            return self._call(node, sheet)
        if isinstance(node, _Str):
            raise _FormulaError("text operand")
        if isinstance(node, _RangeRef):
            raise _FormulaError("a range can only be used as a function argument")
        raise _FormulaError("unsupported expression")

    def _numbers(self, arg: Any, sheet: str) -> list[Decimal]:
        """Numbers an aggregate function reads from one argument.

        Ranges and single-cell references skip text, booleans and empty cells,
        as Excel does. A literal or an expression must be numeric.
        """
        if isinstance(arg, _RangeRef):
            sh = self._resolve_sheet(arg.sheet, sheet)
            found: list[Decimal] = []
            for (r, c), cell in list(sh.cells.items()):
                if arg.min_row <= r <= arg.max_row and arg.min_col <= c <= arg.max_col:
                    if isinstance(cell.value, bool):
                        continue
                    value = self._scalar(sh, r, c)
                    if isinstance(value, Decimal):
                        found.append(value)
            return found
        if isinstance(arg, _CellRef):
            sh = self._resolve_sheet(arg.sheet, sheet)
            cell = sh.cells.get((arg.row, arg.col))
            if cell is not None and isinstance(cell.value, bool):
                return []
            value = self._scalar(sh, arg.row, arg.col)
            return [value] if isinstance(value, Decimal) else []
        return [self._num(arg, sheet)]

    def _call(self, node: _Call, sheet: str) -> Decimal:
        name = node.name
        if name not in _FUNCTIONS:
            raise _FormulaError(f"unsupported function {_clip(name)}")
        if name in ("SUM", "MIN", "MAX"):
            if not node.args:
                raise _FormulaError(f"{name} needs at least one argument")
            values: list[Decimal] = []
            for arg in node.args:
                values.extend(self._numbers(arg, sheet))
            if name == "SUM":
                total = Decimal(0)
                for v in values:
                    total += v
                return total
            if not values:
                return Decimal(0)
            return min(values) if name == "MIN" else max(values)
        if name == "ABS":
            if len(node.args) != 1:
                raise _FormulaError("ABS takes one argument")
            return abs(self._num(node.args[0], sheet))
        if len(node.args) != 2:
            raise _FormulaError("ROUND takes two arguments")
        return _round_half_away(self._num(node.args[0], sheet), self._num(node.args[1], sheet))


# --------------------------------------------------------------------------
# Calendar template writer
# --------------------------------------------------------------------------
#
# The template is a workbook the Tabular_Parser reads back in the ``long``
# layout: a ``Calendar`` sheet with the columns Month, Stream, Value, Unit and
# Source, one row per month and stream key. Value is empty and Unit holds the
# stream standard unit. The Tabular_Parser skips rows with an empty Value, so a
# blank template yields no readings and a filled one yields exactly the filled
# cells.

CALENDAR_SHEET = "Calendar"
STREAMS_SHEET = "Streams"
INSTRUCTIONS_SHEET = "Instructions"
CALENDAR_HEADERS: tuple[str, ...] = ("Month", "Stream", "Value", "Unit", "Source")

# Display labels. They match ``label`` in ``CEMENT_STREAMS`` in
# backend/domain/calendar/streams.ts.
STREAM_LABELS: dict[str, str] = {
    "equivalent_product": "Total Equivalent Product",
    "clinker_production": "Total Clinker Production",
    "opc_production": "OPC Cement Production",
    "ppc_production": "PPC Cement Production",
    "psc_production": "PSC / Composite Cement Production",
    "coal_quantity": "Indian Coal Consumed",
    "coal_gcv": "Indian Coal GCV",
    "petcoke_quantity": "Petcoke Consumed",
    "petcoke_gcv": "Petcoke GCV",
    "imported_coal_quantity": "Imported Coal Consumed",
    "imported_coal_gcv": "Imported Coal GCV",
    "biomass_afr_quantity": "Biomass / Alternative Fuel (AFR)",
    "biomass_afr_gcv": "Biomass / AFR GCV",
    "fo_quantity": "Furnace Oil (FO)",
    "fo_gcv": "Furnace Oil GCV",
    "hsd_quantity": "High Speed Diesel (HSD)",
    "hsd_gcv": "High Speed Diesel GCV",
    "natural_gas_quantity": "Natural Gas (PNG/LNG)",
    "natural_gas_gcv": "Natural Gas GCV",
    "grid_electricity": "Purchased Grid Electricity",
    "cpp_generation": "Captive Power Plant (CPP) Generation",
    "whrs_generation": "WHRS Generation",
    "power_export": "Electricity Exported to Grid",
    "calcination_co2": "Clinker Calcination CO2 (Output-based)",
    "raw_meal_calcination": "Raw Meal Carbonate Calcination (Input-based)",
}


def _default_fy_label(today: date | None = None) -> str:
    """The label of the fiscal year that contains ``today`` (April to March)."""
    today = today or date.today()
    start = today.year if today.month >= 4 else today.year - 1
    return f"FY{start}-{(start + 1) % 100:02d}"


def template_months(fy_label: str | None = None) -> list[str]:
    """The twelve ``YYYY-MM`` month keys of a fiscal year, April first.

    ``fy_label`` accepts the forms ``parse_fy_label`` accepts. ``None`` means the
    fiscal year that contains today. Raises ``ValueError`` for a label that does
    not parse, so a bad year never produces a template for the wrong months.
    """
    from .dates import parse_fy_label

    label = _default_fy_label() if fy_label is None else fy_label
    window = parse_fy_label(label)
    if window is None:
        raise ValueError(f"unrecognized fiscal year label: {_clip(str(label))!r}")
    months: list[str] = []
    for i in range(12):
        month = (3 + i) % 12 + 1  # 4, 5, ..., 12, 1, 2, 3
        year = window.start_year if month >= 4 else window.start_year + 1
        months.append(f"{year:04d}-{month:02d}")
    return months


_INSTRUCTIONS: tuple[str, ...] = (
    "VerifyStack calendar template",
    "",
    "1. Fill the Value column on the Calendar sheet. Leave Value empty for any month and stream with no data.",
    "2. Month is the calendar month as YYYY-MM. The twelve months run April to March. Do not change the Month or Stream cells.",
    "3. Stream is the stream key. The Streams sheet lists every key with its label and standard unit.",
    "4. Unit is pre-filled with the standard unit of the stream. If you enter a value in another unit, change the Unit cell to match.",
    "5. Source is optional. Use it to note the document or register the value came from.",
    "6. Rows with an empty Value are ignored on import. Every imported value is saved as suggested and needs a person to accept it.",
    "7. Keep the header row (Month, Stream, Value, Unit, Source) and the sheet name Calendar.",
)


def build_calendar_template(fy_label: str | None = None) -> bytes:
    """Build the calendar template workbook and return the ``.xlsx`` bytes.

    Sheets, in order:

    * ``Calendar``: the ``long`` layout (Month, Stream, Value, Unit, Source), one
      row per month and stream key, Value empty, Unit set to the standard unit.
    * ``Streams``: every stream key with its label and standard unit.
    * ``Instructions``: how to fill the template.

    Raises ``ValueError`` when ``fy_label`` does not parse.
    """
    import openpyxl
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    from .models import BEEPATSectorStream
    from .units import STANDARD_UNIT

    months = template_months(fy_label)
    streams = list(BEEPATSectorStream)
    bold = Font(bold=True)

    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = CALENDAR_SHEET
    ws.append(list(CALENDAR_HEADERS))
    for month in months:
        for stream in streams:
            ws.append([month, stream.value, None, STANDARD_UNIT[stream], None])
            # Text format keeps Excel from turning ``2025-04`` into a date.
            ws.cell(row=ws.max_row, column=1).number_format = "@"
    for cell in ws[1]:
        cell.font = bold
    ws.freeze_panes = "A2"
    for col, width in enumerate((10, 26, 14, 12, 28), 1):
        ws.column_dimensions[get_column_letter(col)].width = width

    ref = wb.create_sheet(STREAMS_SHEET)
    ref.append(["Key", "Label", "Standard unit"])
    for stream in streams:
        label = STREAM_LABELS.get(stream.value) or stream.value.replace("_", " ").title()
        ref.append([stream.value, label, STANDARD_UNIT[stream]])
    for cell in ref[1]:
        cell.font = bold
    ref.freeze_panes = "A2"
    for col, width in enumerate((26, 48, 16), 1):
        ref.column_dimensions[get_column_letter(col)].width = width

    info = wb.create_sheet(INSTRUCTIONS_SHEET)
    for line in _INSTRUCTIONS:
        info.append([line])
    info["A1"].font = Font(bold=True, size=14)
    info.column_dimensions["A"].width = 110
    for row in info.iter_rows(min_row=2):
        row[0].alignment = Alignment(wrap_text=True, vertical="top")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
