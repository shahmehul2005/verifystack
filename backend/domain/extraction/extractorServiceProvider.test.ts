import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  ExtractorErrorKind,
  ExtractorField,
  ExtractorRun,
  extractorClient,
} from "@verifystack/backend/lib/extractor/client";
import { ExtractorServiceProvider, PROVIDER_NAME, rebuildPayload } from "./extractorServiceProvider";
import type { DocumentPage } from "./provider";
import { CONFIDENCE_POLICY, DOC_SCHEMAS } from "./schemas";

type Client = typeof extractorClient;

const run: ExtractorRun = {
  model: "gemini-test",
  model_calls: 1,
  prompt_version: "pv-7",
  input_hash: "abc123",
  duration_ms: 42,
};

const page: DocumentPage = {
  evidenceId: "ev/../1",
  pageNumber: 3,
  mimeType: "image/png",
  data: Buffer.from("hello").toString("base64"),
};

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };

function field(over: Partial<ExtractorField> & { path: string }): ExtractorField {
  return {
    kind: "string",
    value: "x",
    unit_as_printed: null,
    confidence: 0.97,
    verified: true,
    needs_review: false,
    regulatory: false,
    review_reasons: [],
    provenance: { page: 1, bbox: box, sheet: null, cell: null, source_text: "printed", formula: null },
    ...over,
  };
}

const err = (kind: ExtractorErrorKind) => ({
  ok: false as const,
  error: { kind, message: `${kind} happened` },
});

/** A fake client; every method is a vi.fn so calls can be inspected. */
function fake(over: Partial<Record<keyof Client, unknown>> = {}) {
  const client = {
    classify: vi.fn(),
    classifyBatch: vi.fn(),
    extractFields: vi.fn(),
    ...over,
  };
  return client as unknown as Client & {
    [K in "classify" | "classifyBatch" | "extractFields"]: ReturnType<typeof vi.fn>;
  };
}

const cls = (doc_type: string, confidence = 0.9) => ({ doc_type, confidence, reasoning: "because" });

describe("rebuildPayload", () => {
  it("builds nested objects and uses the caller's page number", () => {
    const out = rebuildPayload(
      [field({ path: "supplierName", value: "Acme" })],
      page,
    ) as { supplierName: { value: string; provenance: { page: number; sourceText: string } } };
    expect(out.supplierName.value).toBe("Acme");
    expect(out.supplierName.provenance.page).toBe(3);
    expect(out.supplierName.provenance.sourceText).toBe("printed");
  });

  it("accepts dotted and bracketed concrete indexes and skips * paths", () => {
    const out = rebuildPayload(
      [
        field({ path: "lines.0.description", value: "A" }),
        field({ path: "lines[1].description", value: "B" }),
        field({ path: "lines.*.description", value: "C" }),
      ],
      page,
    ) as { lines: { description: { value: string } }[] };
    expect(Array.isArray(out.lines)).toBe(true);
    expect(out.lines.map((l) => l.description.value)).toEqual(["A", "B"]);
  });

  it("uses the full-page box when the service gives none, and keeps null values as null", () => {
    const out = rebuildPayload(
      [
        field({
          path: "a",
          provenance: { page: 1, bbox: null, sheet: null, cell: null, source_text: "t", formula: null },
        }),
        field({ path: "b", value: null }),
      ],
      page,
    ) as Record<string, { provenance: { bbox: unknown } }>;
    expect(out.a.provenance.bbox).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect((out as Record<string, unknown>).b).toBeNull();
  });

  it("adds unitAsPrinted for measures", () => {
    const out = rebuildPayload(
      [field({ path: "quantity", kind: "measure", value: 12.5, unit_as_printed: "MT" })],
      page,
    ) as { quantity: { unitAsPrinted: string } };
    expect(out.quantity.unitAsPrinted).toBe("MT");
  });

  it("caps confidence below the review threshold for needs_review and regulatory fields", () => {
    const cap = CONFIDENCE_POLICY.reviewBelow - 0.01;
    const out = rebuildPayload(
      [
        field({ path: "a", confidence: 0.99, needs_review: true }),
        field({ path: "b", confidence: 0.99, regulatory: true }),
        field({ path: "c", confidence: 0.5, needs_review: true }),
        field({ path: "d", confidence: 0.99 }),
      ],
      page,
    ) as Record<string, { confidence: number }>;
    expect(out.a.confidence).toBeCloseTo(cap);
    expect(out.b.confidence).toBeCloseTo(cap);
    expect(out.c.confidence).toBe(0.5);
    expect(out.d.confidence).toBe(0.99);
    expect(out.a.confidence).toBeLessThan(CONFIDENCE_POLICY.reviewBelow);
  });
});

describe("ExtractorServiceProvider.classify", () => {
  it("returns the classification and a log built from the run block", async () => {
    const client = fake();
    client.classify.mockResolvedValue({ ok: true, data: { ok: true, classification: cls("fuel_invoice"), run } });
    const p = new ExtractorServiceProvider(client);
    const res = await p.classify(page, { allowedDocTypes: [{ id: "fuel_invoice", label: "Fuel", notes: "n" }] });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ docType: "fuel_invoice", confidence: 0.9, reasoning: "because" });
    expect(res.log).toMatchObject({
      tool: "classify_document",
      provider: PROVIDER_NAME,
      model: "gemini-test",
      promptVersion: "pv-7",
      inputHash: "abc123",
      durationMs: 42,
      evidenceId: "ev/../1",
      pageNumber: 3,
      ok: true,
    });
    const arg = client.classify.mock.calls[0][0];
    expect(arg.allowedDocTypes).toEqual([{ id: "fuel_invoice", label: "Fuel", notes: "n" }]);
    expect(arg.file.filename).toBe("ev1-p3.png");
    expect(Buffer.from(arg.file.bytes).toString()).toBe("hello");
  });

  it("truncates long reasoning to 500 characters", async () => {
    const client = fake();
    client.classify.mockResolvedValue({
      ok: true,
      data: { ok: true, classification: { ...cls("x"), reasoning: "r".repeat(900) }, run },
    });
    const res = await new ExtractorServiceProvider(client).classify(page);
    expect(res.data?.reasoning).toHaveLength(500);
  });

  it("turns a client error into a failed result with the error kind in the log", async () => {
    const client = fake();
    client.classify.mockResolvedValue(err("timeout"));
    const res = await new ExtractorServiceProvider(client).classify(page);
    expect(res.ok).toBe(false);
    expect(res.data).toBeUndefined();
    expect(res.log).toMatchObject({ ok: false, error: "timeout", provider: PROVIDER_NAME, tool: "classify_document" });
  });
});

describe("ExtractorServiceProvider.classifyBatch", () => {
  const pages = [page, { ...page, evidenceId: "ev2" }, { ...page, evidenceId: "ev3" }];
  const options = { allowedDocTypes: [{ id: "fuel_invoice", label: "Fuel" }] };

  it("places answers by index and reports failed slots", async () => {
    const client = fake();
    client.classifyBatch.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        items: [
          { index: 0, classification: cls("fuel_invoice"), error: null },
          { index: 1, classification: null, error: "bad page" },
          { index: 2, classification: cls("not_allowed"), error: null },
          { index: 9, classification: cls("fuel_invoice"), error: null },
        ],
        run,
      },
    });
    const res = await new ExtractorServiceProvider(client).classifyBatch(pages, options);
    expect(res.ok).toBe(true);
    expect(res.items[0]?.docType).toBe("fuel_invoice");
    expect(res.items[1]).toBeNull();
    expect(res.items[2]).toBeNull();
    expect(res.errors).toHaveLength(3);
    expect(res.errors.join("|")).toContain("bad page");
    expect(res.log).toMatchObject({ tool: "classify_batch", ok: true, model: "gemini-test" });
    expect(res.log.evidenceId).toMatch(/^batch:[0-9a-f]{16}$/);
    expect(client.classifyBatch.mock.calls[0][0].files).toHaveLength(3);
  });

  it("allows 'unknown' even when it is not in the allowed list", async () => {
    const client = fake();
    client.classifyBatch.mockResolvedValue({
      ok: true,
      data: { ok: true, items: [{ index: 0, classification: cls("unknown", 0), error: null }], run },
    });
    const res = await new ExtractorServiceProvider(client).classifyBatch([page], options);
    expect(res.items[0]?.docType).toBe("unknown");
  });

  it("fails when no slot was answered", async () => {
    const client = fake();
    client.classifyBatch.mockResolvedValue({
      ok: true,
      data: { ok: true, items: [{ index: 0, classification: null, error: "nope" }], run },
    });
    const res = await new ExtractorServiceProvider(client).classifyBatch([page], options);
    expect(res.ok).toBe(false);
    expect(res.log.ok).toBe(false);
    expect(res.log.error).toContain("nope");
  });

  it("returns empty slots and the error kind on a client error", async () => {
    const client = fake();
    client.classifyBatch.mockResolvedValue(err("service"));
    const res = await new ExtractorServiceProvider(client).classifyBatch(pages, options);
    expect(res.ok).toBe(false);
    expect(res.items).toEqual([null, null, null]);
    expect(res.errors).toEqual(["service happened"]);
    expect(res.log).toMatchObject({ ok: false, error: "service" });
  });
});

describe("ExtractorServiceProvider.extract", () => {
  const schema = DOC_SCHEMAS.tax_invoice;

  it("rebuilds nested array lines from concrete index paths and validates against the schema", async () => {
    const client = fake();
    client.extractFields.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        warnings: [],
        run,
        fields: [
          field({ path: "supplierName", value: "Acme Ltd" }),
          field({ path: "lines.0.description", value: "Coal" }),
          field({ path: "lines.0.quantity", kind: "measure", value: 10, unit_as_printed: "MT" }),
          field({ path: "lines.1.description", value: "Lime" }),
        ],
      },
    });
    const res = await new ExtractorServiceProvider(client).extract(page, "tax_invoice", schema);
    expect(res.ok).toBe(true);
    expect(res.validationErrors).toBeUndefined();
    const data = res.data as z.infer<typeof schema>;
    expect(data.supplierName?.value).toBe("Acme Ltd");
    expect(data.lines).toHaveLength(2);
    expect(data.lines?.[0].quantity?.value).toBe(10);
    expect(data.lines?.[0].quantity?.unitAsPrinted).toBe("MT");
    expect(data.lines?.[1].description?.value).toBe("Lime");
    expect(res.log).toMatchObject({ tool: "extract_fields", ok: true, promptVersion: "pv-7", durationMs: 42 });

    const arg = client.extractFields.mock.calls[0][0];
    expect(arg.docType).toBe("tax_invoice");
    expect(arg.catalogue.some((e: { path: string }) => e.path === "lines.*.description")).toBe(true);
  });

  it("routes needs_review and regulatory fields below the review threshold", async () => {
    const client = fake();
    client.extractFields.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        warnings: [],
        run,
        fields: [
          field({ path: "supplierName", confidence: 0.99, needs_review: true }),
          field({ path: "invoiceNumber", confidence: 0.99, regulatory: true }),
          field({ path: "buyerName", confidence: 0.99 }),
        ],
      },
    });
    const res = await new ExtractorServiceProvider(client).extract(page, "tax_invoice", schema);
    const d = res.data as z.infer<typeof schema>;
    expect(d.supplierName!.confidence).toBeLessThan(CONFIDENCE_POLICY.reviewBelow);
    expect(d.invoiceNumber!.confidence).toBeLessThan(CONFIDENCE_POLICY.reviewBelow);
    expect(d.buyerName!.confidence).toBe(0.99);
  });

  it("returns a valid object without fields when the service reports no fields", async () => {
    const client = fake();
    client.extractFields.mockResolvedValue({ ok: true, data: { ok: true, warnings: [], run, fields: [] } });
    const res = await new ExtractorServiceProvider(client).extract(page, "tax_invoice", schema);
    expect(res.ok).toBe(true);
    expect(res.validationErrors).toBeUndefined();
    expect(res.data).not.toHaveProperty("supplierName");
  });

  it("keeps a partial result with validation errors when a value fails the schema", async () => {
    const client = fake();
    client.extractFields.mockResolvedValue({
      ok: true,
      data: { ok: true, warnings: [], run, fields: [field({ path: "supplierName", value: "" })] },
    });
    const res = await new ExtractorServiceProvider(client).extract(page, "tax_invoice", schema);
    expect(res.ok).toBe(true);
    expect(res.validationErrors?.length).toBeGreaterThan(0);
    expect(res.log.error).toContain("Partial extraction");
  });

  it.each<ExtractorErrorKind>(["timeout", "model_unavailable", "invalid_response"])(
    "turns client error %s into a failed result",
    async (kind) => {
      const client = fake();
      client.extractFields.mockResolvedValue(err(kind));
      const res = await new ExtractorServiceProvider(client).extract(page, "tax_invoice", schema);
      expect(res.ok).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.log).toMatchObject({ ok: false, error: kind, provider: PROVIDER_NAME, tool: "extract_fields" });
    },
  );
});
