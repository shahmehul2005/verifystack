import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isExtractorConfigured as configuredFromSource } from "@verifystack/backend/lib/supabase/configured";

import { extractorClient, isExtractorConfigured } from "./client";

const KEY = "secret-key-123";
const BASE = "https://extractor.example.com";

const run = { model: "m", model_calls: 0, prompt_version: "v1", input_hash: "h", duration_ms: 5 };
const health = { status: "ok", service: "extractor", version: "1", gemini_configured: true, model: "m" };
const classification = { doc_type: "invoice", confidence: 0.9, reasoning: "r" };
const classifyBody = { ok: true, classification, run };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("EXTRACTOR_URL", BASE);
  vi.stubEnv("EXTRACTOR_API_KEY", KEY);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function lastCall(): { url: URL; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: url as URL, init: init as RequestInit };
}

describe("request shape", () => {
  it("sends GET /health with the key header and redirect: error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(health));
    const r = await extractorClient.health();
    expect(r).toEqual({ ok: true, data: health });
    const { url, init } = lastCall();
    expect(url.toString()).toBe(`${BASE}/health`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ "X-Extractor-Key": KEY });
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("posts classify as multipart form data to /v1/classify", async () => {
    fetchMock.mockResolvedValue(jsonResponse(classifyBody));
    const r = await extractorClient.classify({
      file: { bytes: new Uint8Array([1, 2, 3]), filename: "a.pdf", mimeType: "application/pdf" },
      allowedDocTypes: [{ id: "invoice", label: "Invoice" }],
    });
    expect(r.ok).toBe(true);
    const { url, init } = lastCall();
    expect(url.pathname).toBe("/v1/classify");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const form = init.body as FormData;
    expect(form.get("page_number")).toBe("1");
    expect(JSON.parse(form.get("allowed_doc_types") as string)).toEqual([{ id: "invoice", label: "Invoice" }]);
    expect((form.get("file") as File).name).toBe("a.pdf");
  });

  it("encodes the year in the template URL and reads the filename", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([9, 8]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="cal_2025.xlsx"' },
      }),
    );
    const r = await extractorClient.template("FY2025-26 x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.filename).toBe("cal_2025.xlsx");
      expect(new Uint8Array(r.data.bytes)).toEqual(new Uint8Array([9, 8]));
    }
    expect(lastCall().url.search).toBe("?year=FY2025-26%20x");
  });

  it("falls back to the default template filename", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1])));
    const r = await extractorClient.template("2025-26");
    expect(r.ok && r.data.filename).toBe("verifystack_calendar_template.xlsx");
  });
});

describe("configuration and https rule", () => {
  it("returns not_configured without calling fetch when env is missing", async () => {
    vi.stubEnv("EXTRACTOR_URL", "");
    const r = await extractorClient.health();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects plain http for a non-loopback host", async () => {
    vi.stubEnv("EXTRACTOR_URL", "http://extractor.example.com");
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"])(
    "allows http on loopback %s",
    async (url) => {
      vi.stubEnv("EXTRACTOR_URL", url);
      fetchMock.mockResolvedValue(jsonResponse(health));
      const r = await extractorClient.health();
      expect(r.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an unparseable URL and other schemes", async () => {
    for (const bad of ["not a url", "ftp://localhost/x"]) {
      vi.stubEnv("EXTRACTOR_URL", bad);
      const r = await extractorClient.health();
      expect(!r.ok && r.error.kind).toBe("not_configured");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("timeout and transport errors", () => {
  it("maps TimeoutError to timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("t", "TimeoutError"));
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("maps AbortError to timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("a", "AbortError"));
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("maps a network failure to service without leaking the URL or key", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed ${BASE} ${KEY}`));
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("service");
    if (!r.ok) {
      expect(r.error.message).not.toContain(KEY);
      expect(r.error.message).not.toContain("example.com");
    }
  });

  it("maps a timeout while reading the body to timeout", async () => {
    const res = jsonResponse(health);
    vi.spyOn(res, "json").mockRejectedValue(new DOMException("t", "TimeoutError"));
    fetchMock.mockResolvedValue(res);
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("timeout");
  });

  it("uses the caller's timeoutMs", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(jsonResponse(health));
    await extractorClient.health({ timeoutMs: 1234 });
    expect(spy).toHaveBeenCalledWith(1234);
    spy.mockRestore();
  });
});

describe("status mapping", () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: { code: "bad_key", category: "auth" } }, "auth"],
    [413, {}, "too_large"],
    [415, {}, "unsupported"],
    [422, {}, "unprocessable"],
    [503, { error: { code: "gemini_key_missing", category: "config" } }, "model_unavailable"],
    [503, { error: { code: "other" } }, "service"],
    [502, { error: { code: "model_failed", category: "model" } }, "service"],
    [500, "not json at all", "service"],
  ];

  it.each(cases)("maps %i to %s", async (status, body, kind) => {
    fetchMock.mockResolvedValue(
      typeof body === "string" ? new Response(body, { status }) : jsonResponse(body, status),
    );
    const r = await extractorClient.health();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe(kind);
      expect(r.error.status).toBe(status);
    }
  });

  it("builds the message from status, code and category only", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "model_failed", category: "model", message: "SECRET DETAIL" } }, 502),
    );
    const r = await extractorClient.health();
    expect(!r.ok && r.error.message).toBe("Extractor service returned 502 (model_failed/model)");
    if (!r.ok) {
      expect(r.error.code).toBe("model_failed");
      expect(r.error.category).toBe("model");
    }
  });

  it("drops code and category that are not identifier-like tokens", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "has spaces and <b>html</b>", category: 5 } }, 500));
    const r = await extractorClient.health();
    if (r.ok) throw new Error("expected failure");
    expect(r.error.code).toBeUndefined();
    expect(r.error.category).toBeUndefined();
    expect(r.error.message).toBe("Extractor service returned 500");
  });

  it("maps error statuses on the template endpoint too", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    const r = await extractorClient.template("2025-26");
    expect(!r.ok && r.error.kind).toBe("auth");
  });
});

describe("response validation", () => {
  it("returns invalid_response when the shape does not match", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...health, status: "degraded" }));
    const r = await extractorClient.health();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("invalid_response");
      expect(r.error.status).toBe(200);
    }
  });

  it("parses a /health body with provider and model_configured", async () => {
    const body = { ...health, provider: "anthropic", model: "claude-haiku-5-5", model_configured: false };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const r = await extractorClient.health();
    expect(r).toEqual({ ok: true, data: body });
  });

  it("still parses an older /health body without provider or model_configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse(health));
    const r = await extractorClient.health();
    expect(r.ok).toBe(true);
  });

  it("rejects a wrongly typed model_configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...health, model_configured: "yes" }));
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("invalid_response");
  });

  it("rejects unknown keys on strict objects", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...health, extra: 1 }));
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("invalid_response");
  });

  it("tolerates extra keys in the run block", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...classifyBody, run: { ...run, audit_extra: "x" } }));
    const r = await extractorClient.classify({
      file: { bytes: new Uint8Array([1]), filename: "a.pdf" },
      allowedDocTypes: [],
    });
    expect(r.ok).toBe(true);
  });

  it("returns invalid_response for a 200 with a non-JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    const r = await extractorClient.health();
    expect(!r.ok && r.error.kind).toBe("invalid_response");
  });

  it("returns no data for an invalid response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const r = await extractorClient.extractCalendar({
      file: { bytes: new Blob(["x"]), filename: "a.xlsx" },
    });
    expect(r).toMatchObject({ ok: false });
    expect("data" in r).toBe(false);
  });
});

describe("isExtractorConfigured truth table", () => {
  it.each([
    ["https://x", "k", true],
    ["https://x", "", false],
    ["", "k", false],
    ["", "", false],
  ])("url=%j key=%j -> %s", (url, key, expected) => {
    vi.stubEnv("EXTRACTOR_URL", url);
    vi.stubEnv("EXTRACTOR_API_KEY", key);
    expect(isExtractorConfigured()).toBe(expected);
    expect(configuredFromSource()).toBe(expected);
  });

  it("is false when the variables are unset", () => {
    vi.stubEnv("EXTRACTOR_URL", undefined);
    vi.stubEnv("EXTRACTOR_API_KEY", undefined);
    expect(isExtractorConfigured()).toBe(false);
  });
});

describe("server-only guard", () => {
  it('starts with import "server-only" on the first line', () => {
    const src = readFileSync(path.resolve(__dirname, "client.ts"), "utf8");
    expect(src.split(/\r?\n/)[0]).toBe('import "server-only";');
  });
});
