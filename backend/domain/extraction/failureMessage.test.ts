import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ExtractorErrorKind, extractorClient } from "@verifystack/backend/lib/extractor/client";
import {
  classificationFailureMessage,
  describeFailure,
  extractionFailureMessage,
} from "./failureMessage";
import { ExtractorServiceProvider } from "./extractorServiceProvider";
import type { DocumentPage, ProviderFailure } from "./provider";
import { validate } from "./validate";

type Client = typeof extractorClient;

const KINDS: ProviderFailure["kind"][] = [
  "not_configured",
  "timeout",
  "auth",
  "too_large",
  "unsupported",
  "unprocessable",
  "model_unavailable",
  "service",
  "invalid_response",
  "schema_validation",
];

const SECRET = "sk-secret-123";
const URL_TEXT = "https://extractor.example.com";

const page: DocumentPage = {
  evidenceId: "ev1",
  pageNumber: 1,
  mimeType: "image/png",
  data: Buffer.from("x").toString("base64"),
};

describe("describeFailure", () => {
  for (const stage of ["classification", "extraction"] as const) {
    it.each(KINDS)(`returns a non-empty message for %s (${stage})`, (kind) => {
      const msg = describeFailure({ kind, message: "status 500 code boom" }, stage);
      expect(msg.length).toBeGreaterThan(10);
    });
  }

  it("never echoes a key or URL that is not in the sanitised message", () => {
    for (const kind of KINDS) {
      const msg = describeFailure({ kind, message: "status 500" }, "extraction");
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(URL_TEXT);
      expect(msg).not.toMatch(/https?:\/\//);
    }
  });

  it("points at the right setting for auth, service and not_configured", () => {
    expect(describeFailure({ kind: "auth", message: "" }, "classification")).toContain("EXTRACTOR_API_KEY");
    expect(describeFailure({ kind: "service", message: "status 500" }, "extraction")).toContain("EXTRACTOR_MODEL");
    expect(describeFailure({ kind: "not_configured", message: "" }, "extraction")).toContain("EXTRACTOR_URL");
  });

  it("labels schema_validation by stage", () => {
    expect(describeFailure({ kind: "schema_validation", message: "a: bad" }, "extraction")).toContain(
      "schema validation",
    );
    expect(describeFailure({ kind: "schema_validation", message: "a: bad" }, "classification")).toContain(
      "Classification failed",
    );
  });
});

describe("runDocument message helpers", () => {
  it("maps a client error kind to the described message", () => {
    const failure: ProviderFailure = { kind: "timeout", message: "timeout" };
    expect(classificationFailureMessage({ failure, log: {} })).toBe(describeFailure(failure, "classification"));
    expect(extractionFailureMessage({ failure, log: {} })).toBe(describeFailure(failure, "extraction"));
  });

  it("reports a genuine validation failure with its errors, not a service message", () => {
    const r = validate(z.object({ a: z.string() }), JSON.stringify({ a: 1 }), {
      tool: "extract_fields",
      provider: "p",
      model: "m",
      promptVersion: "v",
      inputHash: "h",
      evidenceId: "e",
      pageNumber: 1,
      startedAt: "",
      durationMs: 0,
      rawOutput: "",
      ok: true,
    }, { soften: false });
    expect(r.ok).toBe(false);
    const msg = extractionFailureMessage(r);
    expect(msg).toContain("schema validation");
    expect(msg).toContain("a:");
    expect(msg).not.toContain("EXTRACTOR_MODEL");
  });

  it("falls back to log error and a generic line", () => {
    expect(classificationFailureMessage({ log: { error: "x" } })).toBe("Classification failed. x");
    expect(extractionFailureMessage(undefined)).toBe("Field extraction failed on every page.");
  });

  it("runDocument builds its job errors through these helpers", () => {
    const src = readFileSync(path.resolve(__dirname, "runDocument.ts"), "utf8");
    expect(src).toContain("classificationFailureMessage(classified)");
    expect(src).toContain("extractionFailureMessage(firstErr?.extracted)");
  });
});

describe("ExtractorServiceProvider failure fields", () => {
  const err = (kind: ExtractorErrorKind) => ({ ok: false as const, error: { kind, message: `${kind} happened` } });
  const clientKinds = KINDS.filter((k) => k !== "schema_validation") as ExtractorErrorKind[];

  it.each(clientKinds)("sets failure for %s on classify, classifyBatch and extract", async (kind) => {
    const client = {
      classify: vi.fn().mockResolvedValue(err(kind)),
      classifyBatch: vi.fn().mockResolvedValue(err(kind)),
      extractFields: vi.fn().mockResolvedValue(err(kind)),
    } as unknown as Client;
    const p = new ExtractorServiceProvider(client);
    const expected = { kind, message: `${kind} happened` };

    const c = await p.classify(page);
    expect(c.ok).toBe(false);
    expect(c.failure).toEqual(expected);

    const b = await p.classifyBatch([page], { allowedDocTypes: [] });
    expect(b.ok).toBe(false);
    expect(b.failure).toEqual(expected);

    const e = await p.extract(page, "tax_invoice", z.object({}));
    expect(e.ok).toBe(false);
    expect(e.failure).toEqual(expected);
  });
});

describe("validate failure field", () => {
  const log = {
    tool: "extract_fields" as const,
    provider: "p",
    model: "m",
    promptVersion: "v",
    inputHash: "h",
    evidenceId: "e",
    pageNumber: 1,
    startedAt: "",
    durationMs: 0,
    rawOutput: "",
    ok: true,
  };

  it("sets schema_validation for invalid JSON and for schema mismatch", () => {
    const bad = validate(z.object({ a: z.string() }), "not json", log, { soften: false });
    expect(bad.failure?.kind).toBe("schema_validation");
    const mismatch = validate(z.object({ a: z.string() }), JSON.stringify({ a: 1 }), log, { soften: false });
    expect(mismatch.failure?.kind).toBe("schema_validation");
    expect(mismatch.failure?.message).toContain("a:");
  });
});
