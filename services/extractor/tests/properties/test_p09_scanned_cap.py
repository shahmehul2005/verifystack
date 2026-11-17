"""Property 9: Scanned pages are capped.

For any confidence in ``[0, 1]`` reported for a field on a page with fewer than 20
characters of text, the Reading confidence is at most 0.6 and ``needs_review`` is true.

The tests go through the HTTP API with a scripted Reader_Agent model, so the cap is
checked on the real pipeline output: ``/v1/extract-fields`` (a field of a PDF page or an
image) and ``/v1/extract-calendar`` (a Reading from a PDF page).

**Validates: Requirements 5.5**
"""

from __future__ import annotations

import io
import json
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.pdf_text import SCANNED_THRESHOLD
from services.extractor.tests.conftest import ModelScript
from services.extractor.tests.factories import (
    decimals,
    image_only_pdf,
    render_number,
    text_pdf,
)

CAP = 0.6
PDF_TYPE = "application/pdf"
CATALOGUE = json.dumps([{"path": "total", "kind": "number"}])

# Confidences on and around the cap, mixed with arbitrary values in [0, 1].
confidences = st.one_of(
    st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
    st.sampled_from([0.0, 0.5, 0.59, CAP, 0.61, 0.7, 0.99, 1.0]),
)

_ALNUM = st.characters(whitelist_categories=("Ll", "Lu", "Nd"), max_codepoint=0x7A)


def _png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (80, 40), (255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


@st.composite
def short_text_lines(draw: st.DrawFn) -> list[str]:
    """Words whose characters add up to fewer than 20 (the text layer of a scanned page)."""
    budget = SCANNED_THRESHOLD - 1
    words: list[str] = []
    for _ in range(draw(st.integers(min_value=0, max_value=4))):
        if budget <= 0:
            break
        word = draw(st.text(_ALNUM, min_size=1, max_size=budget))
        budget -= len(word)
        words.append(word)
    return [" ".join(words)] if words else []


@st.composite
def scanned_inputs(draw: st.DrawFn) -> tuple[str, bytes, str]:
    """``(kind, bytes, media type)`` of an input the Extractor_Service treats as scanned."""
    kind = draw(st.sampled_from(["image_pdf", "short_text_pdf", "empty_pdf", "png"]))
    if kind == "image_pdf":
        return kind, image_only_pdf(draw(st.integers(min_value=1, max_value=2))), PDF_TYPE
    if kind == "short_text_pdf":
        return kind, text_pdf([draw(short_text_lines())]), PDF_TYPE
    if kind == "empty_pdf":
        return kind, text_pdf([[]]), PDF_TYPE
    return kind, _png(), "image/png"


def _raw_field(
    label: str, value_text: str, confidence: float, period_text: str = ""
) -> dict[str, Any]:
    return {
        "label": label,
        "value_text": value_text,
        "unit_as_printed": "t",
        "period_text": period_text,
        "field_path": "total",
        "source_text": f"{label} {value_text}",
        "confidence": confidence,
    }


def _script_reader(model_script: ModelScript, fields: list[dict[str, Any]]) -> None:
    model_script.handler = lambda _messages, _info: {"page_period_text": "", "fields": fields}


FIXTURE_SETTINGS = settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


@FIXTURE_SETTINGS
@given(
    source=scanned_inputs(),
    value=decimals(max_int_digits=7, max_places=2),
    style=st.sampled_from(["plain", "western", "indian"]),
    confidence=confidences,
)
def test_extract_fields_scanned_page_is_capped(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    source: tuple[str, bytes, str],
    value: Decimal,
    style: str,
    confidence: float,
) -> None:
    _kind, data, media_type = source
    _script_reader(model_script, [_raw_field("Total", render_number(value, style), confidence)])

    response = client.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("scan", data, media_type)},
        data={"doc_type": "invoice", "catalogue": CATALOGUE},
    )

    assert response.status_code == 200, response.text
    fields = response.json()["fields"]
    assert len(fields) == 1
    got = fields[0]
    assert got["confidence"] <= CAP
    assert got["confidence"] == pytest.approx(min(confidence, CAP))
    assert got["needs_review"] is True
    assert "scanned_page" in got["review_reasons"]


@FIXTURE_SETTINGS
@given(
    source=scanned_inputs().filter(lambda s: s[2] == PDF_TYPE),
    value=decimals(max_int_digits=7, max_places=2),
    confidence=confidences,
)
def test_extract_calendar_scanned_page_is_capped(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    source: tuple[str, bytes, str],
    value: Decimal,
    confidence: float,
) -> None:
    _kind, data, media_type = source
    # "coal_quantity" is placed by the key rule, so only the Reader_Agent is called.
    _script_reader(
        model_script,
        [_raw_field("coal_quantity", render_number(value, "plain"), confidence, "Apr-2023")],
    )

    response = client.post(
        "/v1/extract-calendar",
        headers=auth_headers,
        files={"file": ("scan.pdf", data, media_type)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    readings = body["readings"]
    # Every field of every scanned page of the document becomes a Reading and is capped.
    assert readings, body
    for reading in readings:
        assert reading["source"] == "pdf"
        assert reading["confidence"] <= CAP
        assert reading["confidence"] == pytest.approx(min(confidence, CAP))
        assert reading["needs_review"] is True
        assert reading["verified"] is False
        assert "scanned_page" in reading["review_reasons"]


# ---------------------------------------------------------------------------
# Boundary: the cap applies below 20 characters only
# ---------------------------------------------------------------------------


@FIXTURE_SETTINGS
@given(chars=st.integers(min_value=0, max_value=SCANNED_THRESHOLD + 10), confidence=confidences)
def test_cap_applies_exactly_below_the_threshold(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    chars: int,
    confidence: float,
) -> None:
    """A page of ``chars`` letters is scanned when ``chars < 20`` and uncapped otherwise."""
    lines = ["x" * chars] if chars else []
    # The value sits in the text layer when there is room for it, so a page that has a
    # usable text layer verifies it and has no reason to cap or flag the reading.
    _script_reader(model_script, [_raw_field("Total", "1500", confidence)])
    if chars >= SCANNED_THRESHOLD:
        lines = ["x" * (chars - 4), "1500"]
    response = client.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("p.pdf", text_pdf([lines]), PDF_TYPE)},
        data={"doc_type": "invoice", "catalogue": CATALOGUE},
    )
    assert response.status_code == 200, response.text
    got = response.json()["fields"][0]
    if chars < SCANNED_THRESHOLD:
        assert got["confidence"] <= CAP
        assert got["needs_review"] is True
        assert "scanned_page" in got["review_reasons"]
    else:
        assert got["confidence"] == pytest.approx(confidence)
        assert "scanned_page" not in got["review_reasons"]
        assert got["verified"] is True


def test_text_layer_page_keeps_high_confidence(
    client: TestClient, model_script: ModelScript, auth_headers: dict[str, str]
) -> None:
    """Contrast case: a page with a text layer is not capped."""
    _script_reader(model_script, [_raw_field("Total", "1,500", 0.95)])
    response = client.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("p.pdf", text_pdf(["Kiln feed report", "Total 1,500 t"]), PDF_TYPE)},
        data={"doc_type": "invoice", "catalogue": CATALOGUE},
    )
    assert response.status_code == 200, response.text
    got = response.json()["fields"][0]
    assert got["confidence"] == pytest.approx(0.95)
    assert got["verified"] is True
    assert "scanned_page" not in got["review_reasons"]
