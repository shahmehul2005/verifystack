"""Property 25: Mapper receives only leftovers and results are flagged.

For any mix of rule-mappable and unmappable labels, the items sent to the Mapper_Agent are
exactly those the Rules_Mapper left unmapped, and every Reading produced from a mapper
answer has ``mapping_source="llm"`` and ``needs_review=True``.

**Validates: Requirements 9.3, 9.4**
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.function import AgentInfo

from services.extractor.config import get_settings
from services.extractor.models import CalendarParams
from services.extractor.pipeline import PipelineDeps, Upload, extract_calendar

from ..conftest import FixedModelProvider, ModelScript, make_function_model
from ..factories import long_table

RULE_LABELS = [
    "coal_quantity",
    "clinker_production",
    "opc_production",
    "ppc_production",
    "psc_production",
]
LLM_STREAMS = [
    "petcoke_quantity",
    "imported_coal_quantity",
    "biomass_afr_quantity",
]  # solid fuels, whose standard unit is the "t" the rows carry
FY = "FY2023-24"

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

values = st.integers(min_value=1, max_value=10**6)


@st.composite
def scenarios(draw: st.DrawFn) -> dict[str, Any]:
    rule_labels = draw(st.lists(st.sampled_from(RULE_LABELS), unique=True, max_size=5))
    n_left = draw(st.integers(min_value=0, max_value=5))
    leftovers = [f"Zzq widget {i}" for i in range(n_left)]
    # What the model answers per leftover: a valid stream, or null.
    answers = draw(
        st.lists(
            st.one_of(st.none(), st.sampled_from(LLM_STREAMS)),
            min_size=n_left,
            max_size=n_left,
        )
    )
    # A stream may be answered for one label only, so no two readings collide.
    seen: set[str] = set()
    answers = [a if a is None or a not in seen and not seen.add(a) else None for a in answers]
    rows = [(lbl, draw(values)) for lbl in rule_labels + leftovers]
    order = draw(st.permutations(rows))
    return {
        "rule_labels": rule_labels,
        "leftovers": leftovers,
        "answers": dict(zip(leftovers, answers)),
        "rows": list(order),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sent_items(messages: list[ModelMessage]) -> list[dict[str, Any]]:
    text: list[str] = []
    for message in messages:
        for part in getattr(message, "parts", []):
            content = getattr(part, "content", None)
            if isinstance(content, str):
                text.append(content)
    joined = "\n".join(text)
    return json.loads(joined.split("Items (JSON):\n", 1)[1].splitlines()[0])


# ---------------------------------------------------------------------------
# Property
# ---------------------------------------------------------------------------


@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(scenarios())
def test_mapper_gets_exactly_the_leftovers_and_llm_readings_are_flagged(
    scenario: dict[str, Any],
) -> None:
    answers: dict[str, str | None] = scenario["answers"]

    def handler(messages: list[ModelMessage], info: AgentInfo) -> dict[str, Any]:
        return {
            "mappings": [
                {
                    "raw_id": it["raw_id"],
                    "stream_key": answers[it["label"]],
                    "confidence": 0.99,
                }
                for it in _sent_items(messages)
            ]
        }

    script = ModelScript(handler=handler)
    deps = PipelineDeps(get_settings(), FixedModelProvider(make_function_model(script)))
    data = long_table([("Apr-2023", label, value, "t") for label, value in scenario["rows"]])
    result = asyncio.run(
        extract_calendar(Upload("upload.xlsx", data), CalendarParams(compliance_year=FY), deps)
    )

    leftovers: list[str] = scenario["leftovers"]
    sent: list[str] = []
    for messages, _info in script.calls:
        sent.extend(it["label"] for it in _sent_items(messages))

    # Exactly the unmapped labels were sent, each once, and no call without leftovers.
    assert sorted(sent) == sorted(leftovers)
    assert (len(script.calls) == 0) == (not leftovers)

    # Readings from a mapper answer are flagged, and only those.
    mapped_streams = {s for s in answers.values() if s is not None}
    rule_streams = set(scenario["rule_labels"])
    for reading in result.readings:
        key = reading.stream_key.value
        if key in mapped_streams:
            assert reading.mapping_source == "llm"
            assert reading.needs_review is True
        else:
            assert key in rule_streams
            assert reading.mapping_source != "llm"
    assert {r.stream_key.value for r in result.readings} == mapped_streams | rule_streams

    # Leftovers the model left null are reported as unmapped.
    assert sorted(result.unmapped) == sorted(lbl for lbl, s in answers.items() if s is None)
