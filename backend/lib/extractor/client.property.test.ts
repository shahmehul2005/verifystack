// Feature: industrial-extractor, Property 34: Client validates every response
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractorClient } from "./client";

const ENV_KEYS = ["EXTRACTOR_URL", "EXTRACTOR_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.EXTRACTOR_URL = "http://localhost:8000";
  process.env.EXTRACTOR_API_KEY = "test-key";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

const word = fc.string({ minLength: 1, maxLength: 20 });

const runArb = fc.record({
  model: word,
  model_calls: fc.nat(1000),
  prompt_version: word,
  input_hash: word,
  duration_ms: fc.nat(100000),
});

const classificationArb = fc.record({
  doc_type: word,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoning: fc.string({ maxLength: 40 }),
});

const classifyArb = fc.record({
  ok: fc.constant(true as const),
  classification: classificationArb,
  run: runArb,
});

const healthArb = fc.record({
  status: fc.constant("ok" as const),
  service: word,
  version: word,
  gemini_configured: fc.boolean(),
  model: word,
});

const fieldsArb = fc.record({
  ok: fc.constant(true as const),
  fields: fc.constant([]),
  warnings: fc.array(
    fc.record({ code: word, message: word, raw_id: fc.option(word, { nil: null }) }),
    { maxLength: 3 },
  ),
  run: runArb,
});

type Case = {
  name: string;
  arb: fc.Arbitrary<Record<string, unknown>>;
  call: () => Promise<{ ok: boolean; data?: unknown; error?: { kind: string } }>;
  /** Top-level keys that can be dropped or mistyped. */
  keys: string[];
};

const file = { bytes: new Uint8Array([1]), filename: "a.pdf" };
const cases: Case[] = [
  { name: "health", arb: healthArb, call: () => extractorClient.health(), keys: ["status", "service", "version", "gemini_configured", "model"] },
  {
    name: "classify",
    arb: classifyArb,
    call: () => extractorClient.classify({ file, allowedDocTypes: [{ id: "a", label: "A" }] }),
    keys: ["ok", "classification", "run"],
  },
  {
    name: "extractFields",
    arb: fieldsArb,
    call: () => extractorClient.extractFields({ file, docType: "a", catalogue: [] }),
    keys: ["ok", "fields", "warnings", "run"],
  },
];

const caseArb = fc.constantFrom(...cases);
const runOpt = { numRuns: 100 };

describe("Property 34: Client validates every response", () => {
  it("returns the data for any response that matches the schema", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, fc.nat(1000), async (c, seed) => {
        const body = fc.sample(c.arb, { seed, numRuns: 1 })[0]!;
        mockFetch(200, body);
        const r = await c.call();
        expect(r.ok).toBe(true);
        expect(r.data).toEqual(body);
      }),
      runOpt,
    );
  });

  it("returns invalid_response and no data for a missing required field", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, fc.nat(1000), fc.nat(10), async (c, seed, pick) => {
        const body = { ...fc.sample(c.arb, { seed, numRuns: 1 })[0]! };
        delete body[c.keys[pick % c.keys.length]!];
        mockFetch(200, body);
        const r = await c.call();
        expect(r.ok).toBe(false);
        expect(r.data).toBeUndefined();
        expect(r.error?.kind).toBe("invalid_response");
      }),
      runOpt,
    );
  });

  it("returns invalid_response and no data for a mistyped field", async () => {
    await fc.assert(
      fc.asyncProperty(
        caseArb,
        fc.nat(1000),
        fc.nat(10),
        fc.constantFrom<unknown>(null, 12345, { x: 1 }),
        async (c, seed, pick, junk) => {
          const body = { ...fc.sample(c.arb, { seed, numRuns: 1 })[0]! };
          const key = c.keys[pick % c.keys.length]!;
          // Skip the case where the junk value happens to equal the original.
          fc.pre(JSON.stringify(body[key]) !== JSON.stringify(junk));
          body[key] = junk;
          mockFetch(200, body);
          const r = await c.call();
          expect(r.ok).toBe(false);
          expect(r.data).toBeUndefined();
          expect(r.error?.kind).toBe("invalid_response");
        },
      ),
      runOpt,
    );
  });

  it("returns invalid_response for an extra key on a strict object", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, fc.nat(1000), word, async (c, seed, extra) => {
        const base = fc.sample(c.arb, { seed, numRuns: 1 })[0]!;
        fc.pre(!(extra in base));
        mockFetch(200, { ...base, [extra]: 1 });
        const r = await c.call();
        expect(r.ok).toBe(false);
        expect(r.data).toBeUndefined();
        expect(r.error?.kind).toBe("invalid_response");
      }),
      runOpt,
    );
  });

  it("tolerates extra keys inside run", async () => {
    await fc.assert(
      fc.asyncProperty(classifyArb, word, async (body, extra) => {
        fc.pre(!(extra in body.run));
        mockFetch(200, { ...body, run: { ...body.run, [extra]: "x" } });
        const r = await extractorClient.classify({ file, allowedDocTypes: [] });
        expect(r.ok).toBe(true);
      }),
      runOpt,
    );
  });

  it("maps every status in the table to its error kind", async () => {
    const table: Array<[number, string]> = [
      [401, "auth"],
      [413, "too_large"],
      [415, "unsupported"],
      [422, "unprocessable"],
      [400, "service"],
      [404, "service"],
      [500, "service"],
      [502, "service"],
      [503, "service"],
    ];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...table), fc.option(word, { nil: undefined }), async ([status, kind], code) => {
        mockFetch(status, code ? { error: { code: code.replace(/[^A-Za-z0-9_.-]/g, "a"), category: "c" } } : {});
        const r = await extractorClient.health();
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe(kind);
      }),
      runOpt,
    );
  });

  it("maps 503 gemini_key_missing to model_unavailable", async () => {
    mockFetch(503, { error: { code: "gemini_key_missing", category: "config" } });
    const r = await extractorClient.health();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("model_unavailable");
  });
});
