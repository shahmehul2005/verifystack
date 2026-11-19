"""Contract drift check: the service's real responses must keep the shape the TS client parses.

The fixtures in ``backend/lib/extractor/__fixtures__/`` are what the TypeScript contract
test feeds to ``FieldsResponseSchema`` and ``ClassifyResponseSchema``. This file regenerates
the same responses through the real app (FunctionModel as the model) and checks a JSON shape
equivalent to the strict Zod schemas, so a change on either side fails a test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo

from .conftest import ModelScript
from .factories import text_pdf

FIXTURES = Path(__file__).resolve().parents[3] / "backend" / "lib" / "extractor" / "__fixtures__"
PDF_TYPE = "application/pdf"


def _e(path: str, kind: str, options: list[str] | None = None, regulatory: bool = False) -> dict[str, Any]:
    entry: dict[str, Any] = {"path": path, "kind": kind}
    if options is not None:
        entry["options"] = options
    if regulatory:
        entry["regulatory"] = True
    return entry


# What fieldCatalogue(FuelInvoiceSchema) / fieldCatalogue(TaxInvoiceSchema) produce.
FUEL_CATALOGUE = [
    _e("supplierName", "string"),
    _e("invoiceNumber", "string"),
    _e("invoiceDate", "date"),
    _e("fuelDescription", "string"),
    _e("fuelGrade", "string"),
    _e("quantity", "measure", regulatory=True),
    _e("calorificValue", "measure"),
    _e("calorificBasis", "string"),
    _e("fuelKind", "string"),
    _e("deliveryPeriodStart", "date"),
    _e("deliveryPeriodEnd", "date"),
]
TAX_CATALOGUE = [
    _e("supplierName", "string"),
    _e("supplierGstin", "string"),
    _e("buyerName", "string"),
    _e("invoiceNumber", "string"),
    _e("invoiceDate", "date"),
    _e("taxableValue", "measure"),
    _e("cgstAmount", "measure"),
    _e("sgstAmount", "measure"),
    _e("grandTotal", "measure"),
    _e("lines.*.description", "string"),
    _e("lines.*.hsnCode", "string"),
    _e("lines.*.quantity", "measure"),
    _e("lines.*.rate", "measure"),
    _e("lines.*.amount", "measure"),
]

FUEL_LINES = [
    "Bharat Petroleum Corporation Ltd",
    "Invoice No: BP/2025/00123",
    "Invoice Date: 12/05/2025",
    "Fuel: High Speed Diesel",
    "Quantity: 12,500 Litres",
    "GCV: n/a",
]
TAX_LINES = [
    "Sri Lakshmi Traders",
    "GSTIN: 29ABCDE1234F1Z5",
    "Invoice No: INV-778",
    "Item: Steel rods  HSN 7214  Qty 10 MT  Rate 52,000  Amount 520,000",
    "Item: Binding wire  HSN 7217  Qty 2 MT  Rate 61,000  Amount 122,000",
    "Taxable value: 642,000",
    "Grand total: 757,560",
]


def _f(label: str, value: str, unit: str, path: str, source: str, conf: float = 0.96) -> dict[str, Any]:
    return {
        "label": label,
        "value_text": value,
        "unit_as_printed": unit,
        "period_text": "",
        "field_path": path,
        "source_text": source,
        "confidence": conf,
    }


FUEL_READ = [
    _f("Supplier", "Bharat Petroleum Corporation Ltd", "", "supplierName", "Bharat Petroleum Corporation Ltd"),
    _f("Invoice No", "BP/2025/00123", "", "invoiceNumber", "Invoice No: BP/2025/00123"),
    _f("Invoice Date", "12/05/2025", "", "invoiceDate", "Invoice Date: 12/05/2025"),
    _f("Quantity", "12,500", "Litres", "quantity", "Quantity: 12,500 Litres"),
    _f("GCV", "n/a", "kcal/kg", "calorificValue", "GCV: n/a", 0.5),
]
TAX_READ = [
    _f("Supplier", "Sri Lakshmi Traders", "", "supplierName", "Sri Lakshmi Traders"),
    _f("GSTIN", "29ABCDE1234F1Z5", "", "supplierGstin", "GSTIN: 29ABCDE1234F1Z5"),
    _f("Taxable value", "642,000", "", "taxableValue", "Taxable value: 642,000"),
    _f("Grand total", "757,560", "", "grandTotal", "Grand total: 757,560"),
    _f("Description", "Steel rods", "", "lines.0.description", "Item: Steel rods  HSN 7214"),
    _f("Qty", "10", "MT", "lines.0.quantity", "Qty 10 MT"),
    _f("Amount", "520,000", "", "lines.0.amount", "Amount 520,000"),
    _f("Description", "Binding wire", "", "lines[1].description", "Item: Binding wire  HSN 7217"),
    _f("Qty", "2", "MT", "lines.1.quantity", "Qty 2 MT"),
]
DOC_TYPES = [
    {"id": "fuel_invoice", "label": "Fuel invoice"},
    {"id": "tax_invoice", "label": "Tax invoice"},
]


def _post_fields(client: TestClient, headers: dict[str, str], lines: list[str], doc_type: str,
                 catalogue: list[dict[str, Any]]) -> dict[str, Any]:
    response = client.post(
        "/v1/extract-fields",
        headers=headers,
        files={"file": ("doc.pdf", text_pdf(lines), PDF_TYPE)},
        data={"doc_type": doc_type, "catalogue": json.dumps(catalogue), "page_number": "1"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def regenerate(client: TestClient, headers: dict[str, str], script: ModelScript) -> dict[str, dict[str, Any]]:
    """The three fixture responses, produced by the real app with a scripted model."""
    out: dict[str, dict[str, Any]] = {}
    for name, lines, doc_type, catalogue, read in (
        ("fuel_invoice_fields", FUEL_LINES, "fuel_invoice", FUEL_CATALOGUE, FUEL_READ),
        ("tax_invoice_fields", TAX_LINES, "tax_invoice", TAX_CATALOGUE, TAX_READ),
    ):
        script.handler = lambda m, i, read=read: {"page_period_text": "", "fields": read}
        out[name] = _post_fields(client, headers, lines, doc_type, catalogue)

    script.handler = lambda m, i: {
        "doc_type": "fuel_invoice", "confidence": 0.93, "reasoning": "Diesel delivery invoice."
    }
    response = client.post(
        "/v1/classify",
        headers=headers,
        files={"file": ("doc.pdf", text_pdf(FUEL_LINES), PDF_TYPE)},
        data={"allowed_doc_types": json.dumps(DOC_TYPES), "page_number": "1"},
    )
    assert response.status_code == 200, response.text
    out["classify"] = response.json()
    return out


# ---------------------------------------------------------------------------
# Shape check equivalent to the strict Zod schemas in client.ts
# ---------------------------------------------------------------------------


def _keys(obj: Any, expected: set[str], where: str, loose: bool = False) -> None:
    assert isinstance(obj, dict), f"{where}: not an object"
    missing = expected - obj.keys()
    extra = obj.keys() - expected
    assert not missing, f"{where}: missing {missing}"
    assert loose or not extra, f"{where}: unexpected {extra}"


def _num(v: Any, where: str, lo: float | None = None, hi: float | None = None) -> None:
    assert isinstance(v, (int, float)) and not isinstance(v, bool), f"{where}: not a number"
    assert lo is None or v >= lo, where
    assert hi is None or v <= hi, where


def _check_run(run: Any) -> None:
    _keys(run, {"model", "model_calls", "prompt_version", "input_hash", "duration_ms"}, "run", loose=True)
    assert isinstance(run["model"], str) and isinstance(run["prompt_version"], str)
    assert isinstance(run["input_hash"], str)
    for k in ("model_calls", "duration_ms"):
        assert isinstance(run[k], int) and run[k] >= 0, k


def _check_provenance(p: Any) -> None:
    _keys(p, {"page", "bbox", "sheet", "cell", "source_text", "formula"}, "provenance")
    assert p["page"] is None or (isinstance(p["page"], int) and p["page"] >= 1)
    if p["bbox"] is not None:
        _keys(p["bbox"], {"x", "y", "width", "height"}, "bbox")
        for k, v in p["bbox"].items():
            _num(v, f"bbox.{k}", 0, 1)
    for k in ("sheet", "cell", "formula"):
        assert p[k] is None or isinstance(p[k], str)
    assert isinstance(p["source_text"], str) and p["source_text"]


def _check_warning(w: Any) -> None:
    _keys(w, {"code", "message"}, "warning", loose=True)
    assert set(w) <= {"code", "message", "raw_id"}


def check_fields_shape(body: Any) -> None:
    _keys(body, {"ok", "fields", "warnings", "run"}, "response")
    assert body["ok"] is True
    for w in body["warnings"]:
        _check_warning(w)
    _check_run(body["run"])
    for f in body["fields"]:
        _keys(
            f,
            {"path", "kind", "value", "unit_as_printed", "confidence", "verified",
             "needs_review", "regulatory", "review_reasons", "provenance"},
            "field",
        )
        assert isinstance(f["path"], str)
        assert f["kind"] in {"number", "measure", "date", "enum", "string"}
        assert f["value"] is None or isinstance(f["value"], (int, float, str))
        assert f["unit_as_printed"] is None or isinstance(f["unit_as_printed"], str)
        _num(f["confidence"], "confidence", 0, 1)
        for k in ("verified", "needs_review", "regulatory"):
            assert isinstance(f[k], bool), k
        assert all(isinstance(r, str) for r in f["review_reasons"])
        _check_provenance(f["provenance"])


def check_classify_shape(body: Any) -> None:
    _keys(body, {"ok", "classification", "run"}, "response")
    assert body["ok"] is True
    _keys(body["classification"], {"doc_type", "confidence", "reasoning"}, "classification")
    assert isinstance(body["classification"]["doc_type"], str)
    _num(body["classification"]["confidence"], "confidence", 0, 1)
    assert isinstance(body["classification"]["reasoning"], str)
    _check_run(body["run"])


@pytest.fixture
def regenerated(client: TestClient, auth_headers: dict[str, str], model_script: ModelScript):
    return regenerate(client, auth_headers, model_script)


def test_regenerated_responses_match_the_client_contract(regenerated: dict[str, dict[str, Any]]) -> None:
    check_fields_shape(regenerated["fuel_invoice_fields"])
    check_fields_shape(regenerated["tax_invoice_fields"])
    check_classify_shape(regenerated["classify"])
    # The nested array paths come back with concrete indexes.
    paths = {f["path"] for f in regenerated["tax_invoice_fields"]["fields"]}
    assert {"lines.0.description", "lines.1.description", "lines.1.quantity"} <= paths


def test_checked_in_fixtures_match_the_client_contract() -> None:
    check_fields_shape(json.loads((FIXTURES / "fuel_invoice_fields.json").read_text("utf-8")))
    check_fields_shape(json.loads((FIXTURES / "tax_invoice_fields.json").read_text("utf-8")))
    check_classify_shape(json.loads((FIXTURES / "classify.json").read_text("utf-8")))
