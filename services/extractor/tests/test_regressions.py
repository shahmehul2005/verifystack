"""One named regression test per known bug of the old extractor (Requirement 18.5).

Each test states the bug it guards against in its docstring. Tests drive the real code:
the Rules_Mapper, the parsers and the HTTP API. The model, when one is needed, is a
``FunctionModel`` injected through the ``client`` fixture, so no test makes a network call.
"""

from __future__ import annotations

import ast
import importlib
import io
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import openpyxl
import pytest
from fastapi.testclient import TestClient

from services.extractor.agents import GeminiModelProvider, ModelNotConfigured
from services.extractor.config import get_settings
from services.extractor.models import BEEPATSectorStream as S
from services.extractor.streams import match_label
from services.extractor.units import STANDARD_UNIT
from services.extractor.workbook import a1, make_raw_id, parse_a1, split_raw_id

from .conftest import ModelScript
from .factories import long_table, multi_page_pdf, proforma_workbook, text_pdf

PACKAGE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PACKAGE_DIR.parents[1]

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]*$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def post_calendar(
    client: TestClient,
    headers: dict[str, str],
    data: bytes,
    *,
    name: str = "upload.xlsx",
    media_type: str = XLSX_TYPE,
    **form: str,
) -> Any:
    return client.post(
        "/v1/extract-calendar",
        headers=headers,
        files={"file": (name, data, media_type)},
        data=form,
    )


def readings_of(response: Any) -> list[dict[str, Any]]:
    assert response.status_code == 200, response.text
    return response.json()["readings"]


def prompt_text(script: ModelScript) -> str:
    """Every string the model received, joined. Binary parts (page images) are skipped."""
    out: list[str] = []
    for messages, _info in script.calls:
        for message in messages:
            for part in getattr(message, "parts", []):
                content = getattr(part, "content", None)
                if isinstance(content, str):
                    out.append(content)
                elif isinstance(content, (list, tuple)):
                    out.extend(c for c in content if isinstance(c, str))
    return "\n".join(out)


def cell_value(data: bytes, sheet: str, ref: str) -> Any:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    return wb[sheet][ref].value


# A pro forma with three recognized rows, each with a unit in the label.
PROFORMA_ROWS: list[tuple[Any, ...]] = [
    ("Clinker Production (t)", 150000),
    ("Imported Coal consumed (t)", 2500),
    ("GCV of Imported Coal (kcal/kg)", 6100),
]


# ---------------------------------------------------------------------------
# Substring matching
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "wrong"),
    [
        ("Charcoal consumed", S.COAL_QUANTITY),
        ("Charcoal GCV", S.COAL_GCV),
        ("After treatment", S.BIOMASS_AFR_QUANTITY),
        ("Afterburner fuel consumed", S.BIOMASS_AFR_QUANTITY),
    ],
)
def test_synonyms_do_not_match_inside_longer_words(label: str, wrong: S) -> None:
    """Bug: keyword matching was by substring, so ``charcoal`` mapped to coal and ``after`` to AFR."""
    result = match_label(label)
    # The generic word ("consumed", "GCV") may leave the label ambiguous. It must not map.
    assert result.status != "mapped"
    assert result.stream != wrong


def test_synonym_still_matches_as_a_whole_word() -> None:
    """The word-boundary rule must not stop the real words from matching."""
    assert match_label("Coal consumed (t)").stream == S.COAL_QUANTITY
    assert match_label("AFR consumed (t)").stream == S.BIOMASS_AFR_QUANTITY


# ---------------------------------------------------------------------------
# Columns beyond Z
# ---------------------------------------------------------------------------


def test_cell_addresses_beyond_column_z() -> None:
    """Bug: column letters were built with ``chr(64 + n)``, which broke past Z."""
    assert a1(1, 26) == "Z1"
    assert a1(1, 27) == "AA1"
    assert a1(17, 28) == "AB17"
    assert a1(5, 16384) == "XFD5"
    for col in (1, 26, 27, 28, 52, 53, 702, 703, 16384):
        assert parse_a1(a1(9, col)) == (9, col)
    raw_id = make_raw_id("Form-Sb", 17, 28)
    assert raw_id == "Form-Sb!AB17"
    assert split_raw_id(raw_id) == ("Form-Sb", "AB17")


def test_proforma_value_in_column_ab_has_the_real_cell_in_provenance(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Bug: a value past column Z got a wrong cell reference in its provenance."""
    # The label goes in column AB (28) and the value in column AC (29).
    data = proforma_workbook(PROFORMA_ROWS, col_offset=27)
    found = readings_of(post_calendar(client, auth_headers, data))
    assert found
    for reading in found:
        sheet, cell = reading["provenance"]["sheet"], reading["provenance"]["cell"]
        assert cell.startswith("AC"), cell
        assert reading["raw_id"] == f"{sheet}!{cell}"
        assert cell_value(data, sheet, cell) == reading["value"]


# ---------------------------------------------------------------------------
# Unit default
# ---------------------------------------------------------------------------


def test_missing_unit_uses_the_stream_standard_unit_not_tonnes(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Bug: a label without a unit defaulted to ``t``, even for kWh and kcal/kg streams."""
    data = proforma_workbook(
        [
            ("Clinker Production (t)", 150000),
            ("Electricity imported from grid", 3_000_000),
            ("HSD consumed", 40),
            ("GCV of coal", 5500),
        ]
    )
    by_stream = {r["stream_key"]: r for r in readings_of(post_calendar(client, auth_headers, data))}
    for stream in (S.GRID_ELECTRICITY, S.HSD_QUANTITY, S.COAL_GCV):
        reading = by_stream[stream.value]
        assert reading["unit_assumed"] is True
        assert reading["needs_review"] is True
        assert reading["normalized_unit"] == STANDARD_UNIT[stream]
        assert reading["normalized_unit"] != "t"
    # A label that states its unit is not flagged.
    assert by_stream[S.CLINKER_PRODUCTION.value]["unit_assumed"] is False


# ---------------------------------------------------------------------------
# Input truncation
# ---------------------------------------------------------------------------


def test_long_page_reaches_the_model_without_truncation(
    client: TestClient,
    auth_headers: dict[str, str],
    model_script: ModelScript,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Bug: page text was cut before it reached the model, so later lines were never read.

    The chunk size is lowered so one page needs several requests. Every line of the page
    must appear in at least one of them.
    """
    monkeypatch.setenv("EXTRACTOR_CHUNK_CHARS", "400")
    assert get_settings().chunk_chars == 400
    lines = [f"Register entry {i:03d} marker QZ{i:03d}X" for i in range(1, 51)]
    response = post_calendar(
        client, auth_headers, text_pdf(lines), name="long.pdf", media_type="application/pdf"
    )
    assert response.status_code == 200, response.text
    assert response.json()["run"]["model_calls"] > 1, "the page should be split into chunks"
    seen = prompt_text(model_script)
    missing = [line for line in lines if line not in seen]
    assert not missing, f"lines never sent to the model: {missing[:3]}"


# ---------------------------------------------------------------------------
# PDF page limit
# ---------------------------------------------------------------------------


def test_seven_page_pdf_gives_seven_page_reads(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    """Bug: only the first 3 pages of a PDF were read."""
    response = post_calendar(
        client,
        auth_headers,
        multi_page_pdf(7),
        name="seven.pdf",
        media_type="application/pdf",
    )
    assert response.status_code == 200, response.text
    assert response.json()["run"]["model_calls"] == 7
    seen = prompt_text(model_script)
    for page in range(1, 8):
        assert f"Page {page} of 7." in seen
        assert f"Page {page} line 1" in seen


def test_pdf_over_the_page_cap_is_rejected_not_cut(
    client: TestClient,
    auth_headers: dict[str, str],
    model_script: ModelScript,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The cap is configured. A PDF beyond it gets 413 and no model call, never a silent cut."""
    monkeypatch.setenv("EXTRACTOR_MAX_PDF_PAGES", "5")
    response = post_calendar(
        client, auth_headers, multi_page_pdf(7), name="seven.pdf", media_type="application/pdf"
    )
    assert response.status_code == 413
    assert model_script.calls == []


# ---------------------------------------------------------------------------
# Missing key
# ---------------------------------------------------------------------------


def test_missing_gemini_key_returns_503_and_does_not_fall_back_to_a_test_model(
    auth_headers: dict[str, str],
) -> None:
    """Bug: with no key the service quietly ran pydantic-ai's ``test`` model and made up output.

    This test uses the real model provider (no override), so it exercises the real path.
    """
    assert get_settings().gemini_api_key == ""
    with pytest.raises(ModelNotConfigured, match="GEMINI_API_KEY"):
        GeminiModelProvider(get_settings()).get()

    from services.extractor.api import app

    with TestClient(app, raise_server_exceptions=False) as real:
        response = post_calendar(
            real,
            auth_headers,
            multi_page_pdf(1),
            name="one.pdf",
            media_type="application/pdf",
        )
        assert response.status_code == 503
        body = response.json()
        assert body["ok"] is False
        assert "GEMINI_API_KEY" in body["error"]["message"]
        assert "readings" not in body
        health = real.get("/health").json()
        assert health["gemini_configured"] is False


def test_missing_extractor_key_returns_503_naming_the_setting(client: TestClient) -> None:
    """With ``EXTRACTOR_API_KEY`` empty every ``/v1/*`` request is refused with 503."""
    response = client.get("/v1/template")
    assert response.status_code == 503
    assert "EXTRACTOR_API_KEY" in response.json()["error"]["message"]


def test_package_never_imports_a_test_model() -> None:
    """The service must not be able to reach ``TestModel`` at run time (Requirement 3.4)."""
    offenders: list[str] = []
    for path in PACKAGE_DIR.rglob("*.py"):
        if "tests" in path.relative_to(PACKAGE_DIR).parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.ImportFrom):
                names = [node.module or "", *(a.name for a in node.names)]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            if any(n == "TestModel" or n.endswith("models.test") for n in names):
                offenders.append(f"{path.name}:{node.lineno}")
    assert not offenders, offenders


# ---------------------------------------------------------------------------
# Fabricated Excel provenance
# ---------------------------------------------------------------------------


def test_excel_provenance_is_the_real_cell_and_has_no_page(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Bug: Excel readings carried ``page=1`` and made-up cells such as ``Col3_Row5``."""
    data = proforma_workbook(PROFORMA_ROWS, sheet="Plant Data", row_offset=2, col_offset=1)
    found = readings_of(post_calendar(client, auth_headers, data))
    assert len(found) == len(PROFORMA_ROWS)
    for reading in found:
        prov = reading["provenance"]
        assert prov["page"] is None
        assert prov["bbox"] is None
        assert prov["sheet"] == "Plant Data"
        assert CELL_RE.match(prov["cell"]), prov["cell"]
        assert not prov["cell"].startswith("Col")
        assert "_Row" not in prov["cell"]
        assert cell_value(data, prov["sheet"], prov["cell"]) == reading["value"]
        assert reading["verified"] is True


def test_tabular_provenance_is_the_real_cell_and_has_no_page(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """The same bug in the tabular parser: the cell is the one that holds the value."""
    data = long_table(
        [
            ("2025-04", "coal_quantity", 1200, "t"),
            ("2025-05", "coal_quantity", 1300, "t"),
            ("2025-04", "grid_electricity", 450000, "kWh"),
        ],
        sheet="Calendar",
    )
    found = readings_of(post_calendar(client, auth_headers, data, compliance_year="FY2025-26"))
    assert len(found) == 3
    for reading in found:
        prov = reading["provenance"]
        assert prov["page"] is None
        assert prov["sheet"] == "Calendar"
        assert CELL_RE.match(prov["cell"]), prov["cell"]
        assert cell_value(data, "Calendar", prov["cell"]) == reading["value"]


# ---------------------------------------------------------------------------
# Hardcoded cell addresses
# ---------------------------------------------------------------------------


def test_shifted_proforma_gives_the_same_readings(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Bug: values were read from fixed addresses, so a pro forma that moved read wrong cells."""

    def values(data: bytes) -> dict[str, float]:
        return {r["stream_key"]: r["value"] for r in readings_of(post_calendar(client, auth_headers, data))}

    base = values(proforma_workbook(PROFORMA_ROWS))
    assert base == {
        "clinker_production": 150000,
        "imported_coal_quantity": 2500,
        "imported_coal_gcv": 6100,
    }
    assert values(proforma_workbook(PROFORMA_ROWS, row_offset=9, col_offset=4)) == base
    assert values(proforma_workbook(PROFORMA_ROWS, title="Form-Sb, Old DC in PAT-2")) == base
    assert values(proforma_workbook(PROFORMA_ROWS, gap_rows=2)) == base


def test_proforma_with_baseline_and_current_columns_reads_current_after_a_shift(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """A moved table with both year columns still reads the Current column, not Baseline."""
    rows = [
        ("Clinker Production (t)", 100, 150),
        ("Imported Coal consumed (t)", 20, 25),
    ]
    for current_first in (False, True):
        data = proforma_workbook(
            rows,
            baseline_current=True,
            current_first=current_first,
            row_offset=3,
            col_offset=2,
        )
        values = {r["stream_key"]: r["value"] for r in readings_of(post_calendar(client, auth_headers, data))}
        assert values == {"clinker_production": 150, "imported_coal_quantity": 25}


# ---------------------------------------------------------------------------
# Import error
# ---------------------------------------------------------------------------


def test_api_module_imports_cleanly() -> None:
    """Bug: ``api.py`` raised ImportError because it imported a name the agent module no longer had."""
    module = importlib.import_module("services.extractor.api")
    assert module.app.title == "VerifyStack Extractor"
    # Run in a fresh interpreter from the repo root, the way ``uvicorn`` would load it.
    result = subprocess.run(
        [sys.executable, "-c", "import services.extractor.api"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr[-500:]


@pytest.mark.parametrize(
    "name",
    [
        "calendar_agent",
        "raw_extractor",
        "pdf_extractor",
        "excel_processor",
        "unit_normalizer",
        "test_extractor",
    ],
)
def test_obsolete_modules_are_gone(name: str) -> None:
    """The modules behind the ImportError are deleted, not patched (Requirement 1.5)."""
    assert not (PACKAGE_DIR / f"{name}.py").exists()
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(f"services.extractor.{name}")
