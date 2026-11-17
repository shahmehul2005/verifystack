"""Property 10: No input is dropped.

For any PDF of 1 to the page cap pages, the Reader is called for every page. For any list
of lines and any maximum size, every line is in at least one chunk, no chunk exceeds the
maximum unless it is a single line, and merging chunk results removes only fields that are
equal after normalization.

The first group tests ``chunk_lines`` directly. The others go through the HTTP API with a
scripted Reader_Agent model that records every prompt it receives, so they check what the
model was actually sent and what the pipeline returned.

**Validates: Requirements 5.1, 5.7**
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from services.extractor.pdf_text import chunk_lines
from services.extractor.tests.conftest import ModelScript
from services.extractor.tests.factories import text_pdf

PDF_TYPE = "application/pdf"
MARKER = "--- PAGE TEXT ---"
PAGE_RE = re.compile(r"Page (\d+) of (\d+)\. Text chunk (\d+) of (\d+)\.")

FIXTURE_SETTINGS = settings(
    max_examples=25,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)

_WORD = st.text(
    st.characters(whitelist_categories=("Ll", "Lu", "Nd"), max_codepoint=0x7A),
    min_size=1,
    max_size=10,
)


# ---------------------------------------------------------------------------
# chunk_lines
# ---------------------------------------------------------------------------

line_lists = st.lists(
    st.text(st.characters(blacklist_categories=("Cc", "Cs"), max_codepoint=0x24F), max_size=90),
    max_size=60,
)


@given(lines=line_lists, max_chars=st.integers(min_value=1, max_value=300), overlap=st.integers(0, 4))
@settings(max_examples=300, deadline=None)
def test_chunk_lines_cover_every_line_within_the_limit(
    lines: list[str], max_chars: int, overlap: int
) -> None:
    ranges = chunk_lines(lines, max_chars, overlap)

    if not lines:
        assert ranges == []
        return

    covered: set[int] = set()
    for start, end in ranges:
        assert 0 <= start < end <= len(lines)
        covered.update(range(start, end))
        size = len("\n".join(lines[start:end]))
        if size > max_chars:
            # Only a single line that is longer than the maximum may exceed it.
            assert end - start == 1
            assert len(lines[start]) > max_chars

    # Every line is in at least one chunk, so none is dropped.
    assert covered == set(range(len(lines)))
    assert ranges[0][0] == 0
    assert ranges[-1][1] == len(lines)

    # Chunks advance, leave no gap and overlap by at most ``overlap`` lines.
    for (prev_start, prev_end), (start, end) in zip(ranges, ranges[1:], strict=False):
        assert start > prev_start
        assert end > prev_end
        assert start <= prev_end
        assert prev_end - start <= overlap


@given(lines=line_lists, overlap=st.integers(0, 4))
@settings(max_examples=100, deadline=None)
def test_chunk_lines_with_room_for_everything_gives_one_chunk(
    lines: list[str], overlap: int
) -> None:
    room = len("\n".join(lines)) + 1
    assert chunk_lines(lines, room, overlap) == ([(0, len(lines))] if lines else [])


# ---------------------------------------------------------------------------
# What the model is sent
# ---------------------------------------------------------------------------


def _prompts(script: ModelScript) -> list[tuple[int, int, int, int, str]]:
    """``(page, pages, chunk, chunks, chunk_text)`` for each Reader request in ``script``."""
    out: list[tuple[int, int, int, int, str]] = []
    for messages, _info in script.calls:
        for message in messages:
            for part in getattr(message, "parts", []):
                content = getattr(part, "content", None)
                texts = [content] if isinstance(content, str) else list(content or [])
                for text in texts:
                    if not isinstance(text, str) or MARKER not in text:
                        continue
                    found = PAGE_RE.search(text)
                    assert found, text
                    page, pages, chunk, chunks = (int(g) for g in found.groups())
                    body = text.split(MARKER + "\n", 1)[1]
                    out.append((page, pages, chunk, chunks, body))
    return out


@st.composite
def pdf_pages(draw: st.DrawFn) -> list[list[str]]:
    """1 to 12 pages, each of 0 to 8 lines. Every line starts with a unique ``P<page>L<line>``."""
    page_count = draw(st.integers(min_value=1, max_value=12))
    pages: list[list[str]] = []
    for p in range(1, page_count + 1):
        count = draw(st.integers(min_value=0, max_value=8))
        pages.append(
            [
                f"P{p}L{i} " + " ".join(draw(st.lists(_WORD, min_size=1, max_size=6)))
                for i in range(1, count + 1)
            ]
        )
    return pages


@FIXTURE_SETTINGS
@given(pages=pdf_pages(), chunk_chars=st.integers(min_value=20, max_value=400))
def test_reader_is_called_for_every_page_and_sees_every_line(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    pages: list[list[str]],
    chunk_chars: int,
) -> None:
    monkeypatch.setenv("EXTRACTOR_CHUNK_CHARS", str(chunk_chars))
    model_script.calls.clear()

    response = client.post(
        "/v1/extract-calendar",
        headers=auth_headers,
        files={"file": ("doc.pdf", text_pdf(pages), PDF_TYPE)},
    )
    assert response.status_code == 200, response.text

    prompts = _prompts(model_script)
    for number, lines in enumerate(pages, start=1):
        mine = [p for p in prompts if p[0] == number]
        # The Reader is called for every page, however short, and with the true page count.
        assert mine, f"page {number} was never read"
        assert {p[1] for p in mine} == {len(pages)}
        # Each page is read in exactly the chunks ``chunk_lines`` defines, none missing.
        expected = chunk_lines(lines, chunk_chars) if lines else [(0, 0)]
        assert sorted(p[2] for p in mine) == list(range(1, len(expected) + 1))
        assert {p[3] for p in mine} == {len(expected)}
        # Every line of the page reaches the model whole, in at least one chunk.
        sent = "\n".join(p[4] for p in mine)
        for line in lines:
            assert line in sent, f"page {number}: line never sent: {line!r}"
        # No chunk exceeds the maximum unless it is a single line.
        for p in mine:
            if len(p[4]) > chunk_chars:
                assert "\n" not in p[4]

    assert response.json()["run"]["model_calls"] == len(prompts)


@FIXTURE_SETTINGS
@given(page_count=st.integers(min_value=1, max_value=10))
def test_page_cap_boundary_reads_all_pages_and_rejects_one_more(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    page_count: int,
) -> None:
    """A PDF at the cap is read in full. One page over the cap is refused, never cut."""
    pdf = text_pdf([[f"Page {p} entry marker"] for p in range(1, page_count + 1)])
    files = {"file": ("doc.pdf", pdf, PDF_TYPE)}

    monkeypatch.setenv("EXTRACTOR_MAX_PDF_PAGES", str(page_count))
    model_script.calls.clear()
    response = client.post("/v1/extract-calendar", headers=auth_headers, files=files)
    assert response.status_code == 200, response.text
    assert {p[0] for p in _prompts(model_script)} == set(range(1, page_count + 1))

    if page_count > 1:
        monkeypatch.setenv("EXTRACTOR_MAX_PDF_PAGES", str(page_count - 1))
        model_script.calls.clear()
        response = client.post("/v1/extract-calendar", headers=auth_headers, files=files)
        assert response.status_code == 413
        assert model_script.calls == []


# ---------------------------------------------------------------------------
# Merging chunk results
# ---------------------------------------------------------------------------

_ITEM_RE = re.compile(r"^Item (\d+) reading (\d+)$")


def _raw_field(label: str, value_text: str, path: str) -> dict[str, object]:
    return {
        "label": label,
        "value_text": value_text,
        "unit_as_printed": "t",
        "period_text": "",
        "field_path": path,
        "source_text": f"{label} {value_text}",
        "confidence": 0.9,
    }


def _read_items(model_script: ModelScript) -> None:
    """Reader stub: one field per ``Item k reading v`` line in the chunk it was sent."""

    def handler(messages: list[object], _info: object) -> dict[str, object]:
        fields: list[dict[str, object]] = []
        for message in messages:
            for part in getattr(message, "parts", []):
                content = getattr(part, "content", None)
                texts = [content] if isinstance(content, str) else list(content or [])
                for text in texts:
                    if not isinstance(text, str) or MARKER not in text:
                        continue
                    for line in text.split(MARKER + "\n", 1)[1].splitlines():
                        found = _ITEM_RE.match(line)
                        if found:
                            k, v = found.groups()
                            fields.append(_raw_field(f"Item {k}", v, f"items.{k}.v"))
        return {"page_period_text": "", "fields": fields}

    model_script.handler = handler  # type: ignore[assignment]


@FIXTURE_SETTINGS
@given(
    count=st.integers(min_value=3, max_value=40),
    chunk_chars=st.integers(min_value=30, max_value=300),
    data=st.data(),
)
def test_merging_chunks_removes_only_equal_fields(
    client: TestClient,
    model_script: ModelScript,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    count: int,
    chunk_chars: int,
    data: st.DataObject,
) -> None:
    """Chunks overlap, so a line can be read twice. The copies merge. Nothing else is lost."""
    monkeypatch.setenv("EXTRACTOR_CHUNK_CHARS", str(chunk_chars))
    _read_items(model_script)
    model_script.calls.clear()

    values = [
        data.draw(st.integers(min_value=1, max_value=999_999), label=f"value {k}")
        for k in range(count)
    ]
    lines: Sequence[str] = [f"Item {k} reading {v}" for k, v in enumerate(values)]
    catalogue = json.dumps([{"path": "items.*.v", "kind": "number"}])

    response = client.post(
        "/v1/extract-fields",
        headers=auth_headers,
        files={"file": ("page.pdf", text_pdf([list(lines)]), PDF_TYPE)},
        data={"doc_type": "register", "catalogue": catalogue},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    chunks = chunk_lines(lines, chunk_chars)
    assert len(_prompts(model_script)) == len(chunks)
    # The overlap is what makes a duplicate possible. Merging must hide it.
    reads = sum(
        1 for k in range(count) for start, end in chunks if start <= k < end
    )
    assert reads >= count

    got = {f["path"]: f for f in body["fields"]}
    assert len(body["fields"]) == count, "a line was dropped or a duplicate survived"
    assert set(got) == {f"items.{k}.v" for k in range(count)}
    for k, v in enumerate(values):
        assert got[f"items.{k}.v"]["value"] == v
        assert got[f"items.{k}.v"]["verified"] is True
    assert not [w for w in body["warnings"] if w["code"] == "field_path_duplicate"]
