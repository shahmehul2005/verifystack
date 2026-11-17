"""Property 2: Authentication gate.

For any ``/v1/*`` route and any ``X-Extractor-Key`` value that is absent or differs from the
configured key, the response is 401 and no model is called. When the configured key is
empty, the response for any header is 503 naming ``EXTRACTOR_API_KEY``.

**Validates: Requirements 2.1, 2.2**
"""

from __future__ import annotations

import string

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.tests.conftest import ModelScript

# Every /v1/* route: (method, path). The POST routes get a multipart body so a request
# that passes the gate would have something to read.
ROUTES = [
    ("GET", "/v1/template"),
    ("POST", "/v1/classify"),
    ("POST", "/v1/classify-batch"),
    ("POST", "/v1/extract-fields"),
    ("POST", "/v1/extract-calendar"),
]

# Printable ASCII: what an HTTP header value can carry without ambiguity.
_HEADER_CHARS = string.ascii_letters + string.digits + string.punctuation + " "
header_values = st.text(alphabet=_HEADER_CHARS, max_size=64)
# ``get_settings`` strips the configured value, so a configured key is a non-empty string
# without surrounding whitespace. A whitespace-only value counts as empty (see below).
configured_keys = st.text(alphabet=_HEADER_CHARS, min_size=1, max_size=64).filter(
    lambda s: s == s.strip()
)

# ``None`` means the header is not sent at all.
supplied_values = st.one_of(st.none(), header_values)

PROPERTY_SETTINGS = settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)


def _send(client: TestClient, method: str, path: str, key: str | None):
    headers = {} if key is None else {"X-Extractor-Key": key}
    if method == "GET":
        return client.get(path, headers=headers)
    return client.post(
        path,
        headers=headers,
        files={"file": ("a.csv", b"Month,Stream,Value\n", "text/csv")},
        data={"doc_type": "x", "catalogue": "[]", "allowed_doc_types": "[]"},
    )


def _assert_no_model_call(script: ModelScript) -> None:
    assert script.calls == []


@pytest.mark.parametrize(("method", "path"), ROUTES)
@PROPERTY_SETTINGS
@given(configured=configured_keys, supplied=supplied_values)
def test_wrong_or_absent_key_gets_401_and_no_model_call(
    client: TestClient,
    model_script: ModelScript,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    configured: str,
    supplied: str | None,
) -> None:
    if supplied == configured:
        supplied = supplied + "x"  # a wrong key that is always different from the real one
    monkeypatch.setenv("EXTRACTOR_API_KEY", configured)

    response = _send(client, method, path, supplied)

    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unauthorized"
    _assert_no_model_call(model_script)


@pytest.mark.parametrize(("method", "path"), ROUTES)
@PROPERTY_SETTINGS
@given(configured=configured_keys, data=st.data())
def test_near_miss_keys_get_401(
    client: TestClient,
    model_script: ModelScript,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    configured: str,
    data: st.DataObject,
) -> None:
    """Keys built from the real one (prefix, suffix, case change) are still rejected."""
    extra = data.draw(st.text(alphabet=_HEADER_CHARS, min_size=1, max_size=4))
    candidates = [
        configured[:-1],
        configured + extra,
        extra + configured,
        configured.swapcase(),
        configured.upper(),
        configured.lower(),
    ]
    near = data.draw(st.sampled_from(candidates))
    if near == configured:
        near = configured + extra
    monkeypatch.setenv("EXTRACTOR_API_KEY", configured)

    response = _send(client, method, path, near)

    assert response.status_code == 401
    _assert_no_model_call(model_script)


@pytest.mark.parametrize(("method", "path"), ROUTES)
@PROPERTY_SETTINGS
@given(supplied=supplied_values, blank=st.text(alphabet=" \t", max_size=5))
def test_empty_configured_key_gets_503_naming_the_setting(
    client: TestClient,
    model_script: ModelScript,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    supplied: str | None,
    blank: str,
) -> None:
    # An explicitly empty value and a whitespace-only one both count as "empty".
    monkeypatch.setenv("EXTRACTOR_API_KEY", blank)

    response = _send(client, method, path, supplied)

    assert response.status_code == 503
    body = response.json()
    assert body["ok"] is False
    assert "EXTRACTOR_API_KEY" in body["error"]["message"]
    _assert_no_model_call(model_script)


@pytest.mark.parametrize(("method", "path"), ROUTES)
@PROPERTY_SETTINGS
@given(supplied=supplied_values)
def test_unset_configured_key_gets_503(
    client: TestClient,
    model_script: ModelScript,
    method: str,
    path: str,
    supplied: str | None,
) -> None:
    # The autouse fixture removed EXTRACTOR_API_KEY, so the setting is unset.
    response = _send(client, method, path, supplied)

    assert response.status_code == 503
    assert "EXTRACTOR_API_KEY" in response.json()["error"]["message"]
    _assert_no_model_call(model_script)


def test_correct_key_passes_the_gate(
    client: TestClient, auth_headers: dict[str, str], model_script: ModelScript
) -> None:
    """Sanity check for the property above: the right key is not answered with 401 or 503."""
    response = client.get("/v1/template", headers=auth_headers)

    assert response.status_code == 200
    _assert_no_model_call(model_script)
