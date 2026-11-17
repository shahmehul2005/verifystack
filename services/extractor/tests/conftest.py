"""Shared pytest setup for the Extractor_Service tests.

Every test starts with no network access to a model, no banner on stdout and none of
the extractor credentials in the environment. ``FixedModelProvider`` lives here, in the
test tree, so the package under test never imports a test model (Requirement 3.4).
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic_ai import models
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel

from services.extractor.api import app, get_model_provider

# Set before any agent runs. ``services.extractor`` also does this on import.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# The key the ``auth_headers`` fixture installs.
TEST_API_KEY = "test-extractor-key"

# Environment names removed before each test: the three named by the design plus every
# other ``EXTRACTOR_*`` setting, so a developer's shell cannot change a result.
_CLEARED_EXACT = ("GEMINI_API_KEY", "EXTRACTOR_API_KEY", "EXTRACTOR_MODEL")
_CLEARED_PREFIX = "EXTRACTOR_"


# ---------------------------------------------------------------------------
# Model stub
# ---------------------------------------------------------------------------

Handler = Callable[[list[ModelMessage], AgentInfo], dict[str, Any]]


def _minimal_value(schema: dict[str, Any]) -> Any:
    """The smallest value that satisfies a JSON schema node (for the default stub)."""
    if "default" in schema:
        return schema["default"]
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), None)
    if kind == "array":
        return []
    if kind == "string":
        return ""
    if kind in ("number", "integer"):
        return 0
    if kind == "boolean":
        return False
    if kind == "object":
        return {}
    return None


def minimal_output(info: AgentInfo) -> dict[str, Any]:
    """Arguments that fill every required property of the output tool with an empty value."""
    schema = info.output_tools[0].parameters_json_schema
    required = schema.get("required", [])
    properties = schema.get("properties", {})
    return {name: _minimal_value(properties.get(name, {})) for name in required}


@dataclass
class ModelScript:
    """Scripts what the injected model returns and records every call it receives.

    ``handler`` gets the messages and the agent info and returns the arguments of the
    structured output. The default returns an empty but valid output. ``calls`` holds the
    ``(messages, info)`` of each model request, so tests can assert on what a model saw.
    """

    handler: Handler | None = None
    calls: list[tuple[list[ModelMessage], AgentInfo]] = field(default_factory=list)

    def respond(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        self.calls.append((messages, info))
        args = self.handler(messages, info) if self.handler else minimal_output(info)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])


def make_function_model(script: ModelScript) -> FunctionModel:
    """A ``FunctionModel`` that answers through ``script``."""
    return FunctionModel(script.respond, model_name="test-function-model")


class FixedModelProvider:
    """A ``ModelProvider`` that always returns the model it was built with."""

    def __init__(self, model: Model) -> None:
        self._model = model

    def get(self) -> Model:
        return self._model


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _hermetic_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """No model requests, no banner, and no extractor credentials or settings."""
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setenv("PYDANTIC_AI_NO_BANNER", "1")
    for name in list(os.environ):
        if name in _CLEARED_EXACT or name.startswith(_CLEARED_PREFIX):
            monkeypatch.delenv(name, raising=False)


@pytest.fixture
def model_script() -> ModelScript:
    """The script behind the ``client`` fixture. Set ``model_script.handler`` in a test."""
    return ModelScript()


@pytest.fixture
def client(model_script: ModelScript) -> Iterator[TestClient]:
    """A test client whose model provider is ``FixedModelProvider(FunctionModel(...))``.

    No credential is installed, so a request to ``/v1/*`` gets 503 until the test uses
    ``auth_headers`` (or sets ``EXTRACTOR_API_KEY`` itself).
    """
    provider = FixedModelProvider(make_function_model(model_script))
    app.dependency_overrides[get_model_provider] = lambda: provider
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(get_model_provider, None)


@pytest.fixture
def auth_headers(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Set ``EXTRACTOR_API_KEY`` for this test and return the matching request header."""
    monkeypatch.setenv("EXTRACTOR_API_KEY", TEST_API_KEY)
    return {"X-Extractor-Key": TEST_API_KEY}
