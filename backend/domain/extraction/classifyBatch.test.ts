import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_BYTES,
  MAX_DOCS_PER_BATCH,
  MAX_SINGLE_PAGE_BYTES,
  PDF_FIRST_PAGE_ESTIMATE,
  estimateFirstPageBytes,
  isBatchable,
  isRetryableProviderError,
  parseBatchOutput,
  planBatches,
  type BatchItem,
} from "./classifyBatch";

const MB = 1024 * 1024;
const items = (n: number, bytes = 100 * 1024): BatchItem[] => Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, bytes }));
const ids = (batches: BatchItem[][]) => batches.map((b) => b.map((i) => i.id));

describe("planBatches", () => {
  it("fills a batch up to the document limit and keeps the order", () => {
    const { batches, tooLarge } = planBatches(items(20));
    expect(batches.map((b) => b.length)).toEqual([8, 8, 4]);
    expect(ids(batches).flat()).toEqual(items(20).map((i) => i.id));
    expect(tooLarge).toEqual([]);
    expect(MAX_DOCS_PER_BATCH).toBe(8);
  });

  it("closes a batch when the next page would take it past the byte budget", () => {
    const { batches } = planBatches(items(5, 4 * MB), { maxBytes: 9 * MB });
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("sends a page over the batch budget alone, and sets one over the single limit aside", () => {
    const list: BatchItem[] = [
      { id: "a", bytes: MB },
      { id: "big", bytes: MAX_BATCH_BYTES + MB },
      { id: "b", bytes: MB },
      { id: "huge", bytes: MAX_SINGLE_PAGE_BYTES + 1 },
    ];
    const { batches, tooLarge } = planBatches(list);
    expect(ids(batches)).toEqual([["a"], ["big"], ["b"]]);
    expect(tooLarge.map((i) => i.id)).toEqual(["huge"]);
  });

  it("makes no batches from nothing, and never an empty one", () => {
    expect(planBatches([])).toEqual({ batches: [], tooLarge: [] });
    expect(planBatches(items(3)).batches.every((b) => b.length > 0)).toBe(true);
  });

  it("never plans a batch over either limit", () => {
    const mixed: BatchItem[] = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, bytes: ((i * 7919) % 5000) * 1024 + 1000 }));
    const { batches, tooLarge } = planBatches(mixed);
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(MAX_DOCS_PER_BATCH);
      if (b.length > 1) expect(b.reduce((n, i) => n + i.bytes, 0)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    }
    expect(batches.flat().length + tooLarge.length).toBe(60);
  });
});

describe("first page estimates", () => {
  it("bounds a PDF's first page by the estimate, and an image by its own size", () => {
    expect(estimateFirstPageBytes("application/pdf", 30 * MB)).toBe(PDF_FIRST_PAGE_ESTIMATE);
    expect(estimateFirstPageBytes("application/pdf", 200 * 1024)).toBe(200 * 1024);
    expect(estimateFirstPageBytes("image/png", 7 * MB)).toBe(7 * MB);
  });

  it("knows what a first page can be sent as", () => {
    expect(isBatchable("application/pdf")).toBe(true);
    expect(isBatchable("image/jpeg")).toBe(true);
    expect(isBatchable("image/webp")).toBe(false);
    expect(isBatchable("application/vnd.ms-excel")).toBe(false);
    expect(isBatchable(null)).toBe(false);
  });
});

describe("parseBatchOutput", () => {
  const allowed = ["fuel_invoice", "lab_certificate", "form1"];

  it("reads one answer per document, in the order sent", () => {
    const raw = JSON.stringify({
      results: [
        { index: 2, docType: "lab_certificate", confidence: 0.8, reasoning: "NABL stamp" },
        { index: 1, docType: "fuel_invoice", confidence: 0.95, reasoning: "Coal delivery" },
        { index: 3, docType: "unknown", confidence: 0.3 },
      ],
    });
    const { items: got, errors } = parseBatchOutput(raw, 3, allowed);
    expect(errors).toEqual([]);
    expect(got.map((g) => g?.docType)).toEqual(["fuel_invoice", "lab_certificate", "unknown"]);
    expect(got[2]!.reasoning).toBe("");
  });

  it("accepts a code fence and a bare list", () => {
    const body = JSON.stringify([{ index: 1, docType: "form1", confidence: 0.9, reasoning: "x" }]);
    expect(parseBatchOutput("```json\n" + body + "\n```", 1, allowed).items[0]?.docType).toBe("form1");
    expect(parseBatchOutput(body, 1, allowed).items[0]?.docType).toBe("form1");
  });

  it("leaves a document with no answer null and says which", () => {
    const { items: got, errors } = parseBatchOutput(JSON.stringify({ results: [{ index: 1, docType: "form1", confidence: 1, reasoning: "" }] }), 3, allowed);
    expect(got.map((g) => g?.docType ?? null)).toEqual(["form1", null, null]);
    expect(errors).toEqual(["Document 2 was not answered.", "Document 3 was not answered."]);
  });

  it("refuses a type the methodology does not define, without spoiling the others", () => {
    const raw = JSON.stringify({
      results: [
        { index: 1, docType: "made_up", confidence: 0.9, reasoning: "" },
        { index: 2, docType: "form1", confidence: 0.9, reasoning: "" },
      ],
    });
    const { items: got, errors } = parseBatchOutput(raw, 2, allowed);
    expect(got.map((g) => g?.docType ?? null)).toEqual([null, "form1"]);
    expect(errors.join(" ")).toMatch(/made_up/);
  });

  it("sets aside a document answered twice, and an index that was not sent", () => {
    const raw = JSON.stringify({
      results: [
        { index: 1, docType: "form1", confidence: 0.9, reasoning: "" },
        { index: 1, docType: "fuel_invoice", confidence: 0.9, reasoning: "" },
        { index: 7, docType: "form1", confidence: 0.9, reasoning: "" },
      ],
    });
    const { items: got, errors } = parseBatchOutput(raw, 2, allowed);
    expect(got).toEqual([null, null]);
    expect(errors.join(" ")).toMatch(/answered more than once/);
    expect(errors.join(" ")).toMatch(/document 7/);
  });

  it("reports an answer that is not JSON, or has no list, and answers nothing", () => {
    expect(parseBatchOutput("not json", 2, allowed)).toEqual({ items: [null, null], errors: ["The answer was not valid JSON."] });
    expect(parseBatchOutput("{}", 1, allowed).errors).toEqual(["The answer had no list of results."]);
  });

  it("rejects a confidence outside 0 to 1", () => {
    const { items: got } = parseBatchOutput(JSON.stringify({ results: [{ index: 1, docType: "form1", confidence: 1.4, reasoning: "" }] }), 1, allowed);
    expect(got[0]).toBeNull();
  });
});

describe("isRetryableProviderError", () => {
  it("recognises a rate limit and a busy service, and not a bad request", () => {
    expect(isRetryableProviderError('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')).toBe(true);
    expect(isRetryableProviderError("Quota exceeded for metric")).toBe(true);
    expect(isRetryableProviderError("503 UNAVAILABLE: The model is overloaded")).toBe(true);
    expect(isRetryableProviderError("400 INVALID_ARGUMENT: request payload size exceeds the limit")).toBe(false);
    expect(isRetryableProviderError(undefined)).toBe(false);
  });
});
