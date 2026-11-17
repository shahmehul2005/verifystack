"""Property 8: Absent values are retried, then flagged.

For any value the Reader returns that is absent from a page's text layer, the validator
raises ``ModelRetry`` while retries remain, and a corrected second answer yields a
verified Reading. When every attempt returns the absent value, the request succeeds and
the Reading has ``verified=false`` and ``needs_review=true``.

Feature: industrial-extractor, Property 8: Absent values are retried, then flagged

**Validates: Requirements 5.3, 5.4**
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic_ai.messages import ModelMessage, ModelRequest, RetryPromptPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo

from services.extractor.agents import ReaderDeps, reader_agent
from services.extractor.pdf_text import open_pdf
from services.extractor.tests.conftest import ModelScript, make_function_model
from services.extractor.tests.factories import (
    decimals,
    render_number,
    text_pdf,
)
from services.extractor.units import parse_number

# One first attempt plus two output retries (``retries={"output": 2}``).
ATTEMPTS = 3

STYLES = st.sampled_from(["plain", "western", "indian"])


@st.composite
def absent_scenarios(
    draw: st.DrawFn,
) -> tuple[Decimal, str, str, int]:
    """``(true value, text printed on the page, absent value text, wrong answers first)``.

    The page prints ``true value`` once. The absent value is a different number that
    appears nowhere on the page. ``wrong_first`` is how many answers repeat the absent
    value before the Reader gives the printed one: 0 to 4, so it covers a correction on
    the second or third attempt and a Reader that never corrects.
    """
    true = draw(decimals(max_int_digits=7, max_places=2))
    printed = render_number(true, draw(STYLES))
    wrong = draw(decimals(max_int_digits=7, max_places=2).filter(lambda d: d != true))
    wrong_text = render_number(wrong, draw(STYLES))
    wrong_first = draw(st.integers(min_value=0, max_value=ATTEMPTS + 1))
    return true, printed, wrong_text, wrong_first


def _page_pdf(printed: str) -> bytes:
    # Long enough to count as a text-layer page, and no other number on it.
    return text_pdf([f"Monthly consumption report: Coal quantity {printed} t"])


def _field(value_text: str) -> dict[str, Any]:
    return {
        "label": "Coal quantity",
        "value_text": value_text,
        "unit_as_printed": "t",
        "period_text": "Apr 2023",
        "source_text": f"Coal quantity {value_text} t",
        "confidence": 0.9,
    }


def _answers(wrong_text: str, printed: str, wrong_first: int) -> list[dict[str, Any]]:
    """The Reader answer for each attempt: ``wrong_first`` wrong ones, then the printed one."""
    texts = [wrong_text] * wrong_first + [printed]
    return [{"page_period_text": "", "fields": [_field(t)]} for t in texts]


def _scripted(answers: list[dict[str, Any]], script: ModelScript | None = None) -> ModelScript:
    """Answers in order and repeats the last one when the model is asked again."""
    script = script or ModelScript()
    script.calls.clear()

    def handler(_messages: list[ModelMessage], _info: AgentInfo) -> dict[str, Any]:
        return answers[min(len(script.calls) - 1, len(answers) - 1)]

    script.handler = handler
    return script


def _feedback(messages: list[ModelMessage]) -> list[str]:
    """Text of the retry feedback in a request (pydantic-ai 2.67 sends it as a tool return)."""
    out: list[str] = []
    for message in messages:
        if isinstance(message, ModelRequest):
            for part in message.parts:
                if isinstance(part, (RetryPromptPart, ToolReturnPart)):
                    out.append(str(part.content))
    return out


# ---------------------------------------------------------------------------
# The validator (Requirement 5.3)
# ---------------------------------------------------------------------------


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(absent_scenarios())
def test_validator_retries_absent_values_while_retries_remain(
    scenario: tuple[Decimal, str, str, int],
) -> None:
    _true, printed, wrong_text, wrong_first = scenario
    script = _scripted(_answers(wrong_text, printed, wrong_first))
    with open_pdf(_page_pdf(printed), max_pages=5) as doc:
        page = doc.page(1)

    result = reader_agent.run_sync(
        "page", deps=ReaderDeps(page=page), model=make_function_model(script)
    )

    # The model is asked again after every absent answer, up to the retry budget.
    expected_calls = min(wrong_first + 1, ATTEMPTS)
    assert len(script.calls) == expected_calls
    # Each re-ask carries feedback that names the absent value.
    for _messages, _info in script.calls[1:]:
        assert any(wrong_text in text for text in _feedback(_messages))
    if wrong_first < ATTEMPTS:
        # A corrected answer within the budget is the one returned.
        assert result.output.fields[0].value_text == printed
    else:
        # The last attempt is returned unchanged instead of raising (Requirement 5.4).
        assert result.output.fields[0].value_text == wrong_text


# ---------------------------------------------------------------------------
# The request (Requirement 5.3 and 5.4 end to end)
# ---------------------------------------------------------------------------


@settings(
    max_examples=30,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(absent_scenarios())
def test_request_verifies_a_corrected_value_and_flags_one_that_stays_absent(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    scenario: tuple[Decimal, str, str, int],
) -> None:
    true, printed, wrong_text, wrong_first = scenario
    _scripted(_answers(wrong_text, printed, wrong_first), model_script)

    response = client.post(
        "/v1/extract-calendar",
        headers=auth_headers,
        files={"file": ("a.pdf", _page_pdf(printed), "application/pdf")},
    )

    # An absent value never fails the request.
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["readings"]) == 1
    reading = body["readings"][0]
    corrected = wrong_first < ATTEMPTS

    if corrected:
        assert reading["verified"] is True
        assert "unverified" not in reading["review_reasons"]
        assert parse_number(reading["value_as_stated"]) == true
        box = reading["provenance"]["bbox"]
        assert box is not None
        for key in ("x", "y", "width", "height"):
            assert 0.0 <= box[key] <= 1.0
    else:
        assert reading["verified"] is False
        assert reading["needs_review"] is True
        assert "unverified" in reading["review_reasons"]
        assert reading["value_as_stated"] == wrong_text
        assert reading["provenance"]["bbox"] is None
        assert reading["provenance"]["page"] == 1
