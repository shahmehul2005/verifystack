"""Property 29: Input hash is deterministic.

Feature: industrial-extractor, Property 29: Input hash is deterministic.

For any request, repeating it with the same bytes, parameters and model gives the same
``input_hash``. Changing any one byte of the file, any parameter that affects the result, or
the model name gives a different hash.

**Validates: Requirements 17.4**
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import re

from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.agents import PROMPT_VERSION
from services.extractor.config import get_settings
from services.extractor.models import CalendarParams, SourceType
from services.extractor.pipeline import (
    PipelineDeps,
    Upload,
    compute_input_hash,
    extract_calendar,
)
from services.extractor.tests.conftest import FixedModelProvider, ModelScript, make_function_model

FY = "FY2023-24"

sha_hex = st.binary(max_size=64).map(lambda b: hashlib.sha256(b).hexdigest())
file_hash_lists = st.lists(sha_hex, min_size=1, max_size=4)
json_scalars = st.one_of(
    st.none(), st.booleans(), st.integers(-10**6, 10**6), st.text(max_size=12)
)
param_dicts = st.dictionaries(st.text(min_size=1, max_size=8), json_scalars, max_size=5)
model_names = st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-.", min_size=1, max_size=20)


# ---------------------------------------------------------------------------
# compute_input_hash
# ---------------------------------------------------------------------------


@settings(max_examples=100, deadline=None)
@given(file_hash_lists, param_dicts, model_names)
def test_same_input_gives_same_hash(files: list[str], params: dict, model: str) -> None:  # type: ignore[type-arg]
    first = compute_input_hash(files, dict(params), model)
    # Key order of the parameters must not matter.
    reordered = dict(reversed(list(params.items())))
    second = compute_input_hash(list(files), reordered, model)
    assert first == second
    assert re.fullmatch(r"[0-9a-f]{64}", first)


@settings(max_examples=100, deadline=None)
@given(file_hash_lists, param_dicts, model_names, st.data())
def test_changing_a_file_param_or_model_changes_the_hash(
    files: list[str], params: dict, model: str, data: st.DataObject  # type: ignore[type-arg]
) -> None:
    base = compute_input_hash(files, params, model)

    # One file's bytes change, so its SHA-256 changes.
    i = data.draw(st.integers(0, len(files) - 1))
    other = hashlib.sha256(files[i].encode() + b"x").hexdigest()
    changed_files = [*files[:i], other, *files[i + 1 :]]
    assert compute_input_hash(changed_files, params, model) != base

    # One parameter value changes.
    key = data.draw(st.text(min_size=1, max_size=8))
    new_params = dict(params)
    new_params[key] = ["changed", params.get(key)]
    assert compute_input_hash(files, new_params, model) != base

    # The model name changes.
    assert compute_input_hash(files, params, model + "x") != base


# ---------------------------------------------------------------------------
# End to end through extract_calendar
# ---------------------------------------------------------------------------


def _csv(values: list[int]) -> bytes:
    months = ["Apr-2023", "May-2023", "Jun-2023", "Jul-2023"]
    lines = ["Month,Stream,Value,Unit"]
    lines += [f"{months[i]},coal_quantity,{v},t" for i, v in enumerate(values)]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _run(data: bytes, params: CalendarParams, model: str):  # type: ignore[no-untyped-def]
    base = get_settings()
    deps = PipelineDeps(
        dataclasses.replace(base, model=model),
        FixedModelProvider(make_function_model(ModelScript())),
    )
    return asyncio.run(extract_calendar(Upload("data.csv", data), params, deps)).run


values_lists = st.lists(st.integers(1, 10**6), min_size=1, max_size=4)
calendar_params = st.builds(
    CalendarParams,
    compliance_year=st.sampled_from([FY, "FY2024-25", None]),
    source_type=st.sampled_from(list(SourceType)),
    layout=st.sampled_from(["auto", "tabular"]),
)


@settings(max_examples=40, deadline=None)
@given(values_lists, calendar_params, model_names, st.data())
def test_extract_calendar_run_hash(
    values: list[int], params: CalendarParams, model: str, data: st.DataObject
) -> None:
    raw = _csv(values)
    a = _run(raw, params, model)
    b = _run(raw, params.model_copy(), model)
    assert a.input_hash == b.input_hash
    assert a.prompt_version == PROMPT_VERSION
    assert a.model == model

    # Change one byte of the file.
    k = data.draw(st.integers(0, len(values) - 1))
    changed = list(values)
    changed[k] = values[k] + 1
    assert _run(_csv(changed), params, model).input_hash != a.input_hash

    # Change the model name.
    assert _run(raw, params, model + "x").input_hash != a.input_hash

    # Change a parameter that affects the result.
    other_source = next(s for s in SourceType if s != params.source_type)
    assert _run(raw, params.model_copy(update={"source_type": other_source}), model).input_hash != a.input_hash
    other_fy = "FY2030-31" if params.compliance_year != "FY2030-31" else FY
    assert _run(raw, params.model_copy(update={"compliance_year": other_fy}), model).input_hash != a.input_hash
