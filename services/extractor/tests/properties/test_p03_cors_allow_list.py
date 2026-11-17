"""Property 3: CORS allow-list.

For any request origin and any configured allow-list, the response carries an
``Access-Control-Allow-Origin`` header only when the origin is in the list.

**Validates: Requirements 2.5**

The allow-list is read from ``EXTRACTOR_CORS_ORIGINS`` when ``create_app()`` runs, so each
example builds a fresh app under a patched environment. The check covers a simple
cross-origin request (``GET /health``, which needs no key) and a preflight (``OPTIONS``).
"""

from __future__ import annotations

from unittest import mock

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from services.extractor.api import create_app

ACAO = "access-control-allow-origin"

_LABEL = st.from_regex(r"[a-z][a-z0-9]{0,9}", fullmatch=True)


@st.composite
def origins(draw: st.DrawFn) -> str:
    """``scheme://host[.tld][:port]``, written the way a browser sends an Origin header."""
    scheme = draw(st.sampled_from(["http", "https"]))
    host = ".".join(draw(st.lists(_LABEL, min_size=1, max_size=3)))
    port = draw(st.one_of(st.none(), st.integers(min_value=1, max_value=65535)))
    return f"{scheme}://{host}" if port is None else f"{scheme}://{host}:{port}"


@st.composite
def scenarios(draw: st.DrawFn) -> tuple[list[str], str]:
    """``(allow_list, origin)`` where the origin is sometimes listed and sometimes not."""
    allow_list = draw(st.lists(origins(), max_size=5))
    if allow_list and draw(st.booleans()):
        origin = draw(st.sampled_from(allow_list))
    else:
        origin = draw(origins())
    return allow_list, origin


def _env_value(allow_list: list[str], pad: str) -> str:
    """The comma list as an operator might type it, with spaces around the commas."""
    return f"{pad},{pad}".join(allow_list)


def _client(allow_list: list[str], pad: str) -> TestClient:
    env = {"EXTRACTOR_CORS_ORIGINS": _env_value(allow_list, pad)}
    with mock.patch.dict("os.environ", env):
        app = create_app()
    return TestClient(app, raise_server_exceptions=False)


@settings(max_examples=100, deadline=None)
@given(scenario=scenarios(), pad=st.sampled_from(["", " ", "  "]))
def test_simple_request_gets_allow_origin_only_when_listed(
    scenario: tuple[list[str], str], pad: str
) -> None:
    allow_list, origin = scenario
    response = _client(allow_list, pad).get("/health", headers={"Origin": origin})

    assert response.status_code == 200
    if origin in allow_list:
        assert response.headers.get(ACAO) == origin
    else:
        assert ACAO not in response.headers


@settings(max_examples=100, deadline=None)
@given(scenario=scenarios(), pad=st.sampled_from(["", " ", "  "]))
def test_preflight_gets_allow_origin_only_when_listed(
    scenario: tuple[list[str], str], pad: str
) -> None:
    allow_list, origin = scenario
    response = _client(allow_list, pad).options(
        "/v1/classify",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Extractor-Key",
        },
    )

    if origin in allow_list:
        assert response.status_code == 200
        assert response.headers.get(ACAO) == origin
    else:
        assert ACAO not in response.headers


@settings(max_examples=50, deadline=None)
@given(origin=origins())
def test_empty_allow_list_never_allows_an_origin(origin: str) -> None:
    """The default (no configured origins) allows none, so no header is ever added."""
    with mock.patch.dict("os.environ", {}, clear=False):
        app = create_app()
    response = TestClient(app, raise_server_exceptions=False).get(
        "/health", headers={"Origin": origin}
    )

    assert response.status_code == 200
    assert ACAO not in response.headers


@settings(max_examples=50, deadline=None)
@given(allow_list=st.lists(origins(), min_size=1, max_size=5))
def test_request_without_origin_gets_no_allow_origin(allow_list: list[str]) -> None:
    response = _client(allow_list, "").get("/health")

    assert response.status_code == 200
    assert ACAO not in response.headers
