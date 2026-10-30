import { describe, expect, it } from "vitest";
import { backoffSeconds, runClassification, type BatchResponse, type Candidate, type DocOutcome, type Progress } from "./classifyRunner";

const MB = 1024 * 1024;
const docs = (n: number, bytes = 100 * 1024): Candidate[] => Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, mimeType: "application/pdf", byteSize: bytes }));
const suggested = (id: string): DocOutcome => ({ id, status: "suggested", docType: "form1", confidence: 0.9 });
const answerAll = (ids: string[]): BatchResponse => ({ ok: true, results: ids.map(suggested), deferred: [] });

function harness(send: (ids: string[], call: number) => BatchResponse | Promise<BatchResponse>) {
  const calls: string[][] = [];
  const sleeps: number[] = [];
  return {
    calls,
    sleeps,
    send: async (ids: string[]) => {
      calls.push(ids);
      return send(ids, calls.length);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

describe("runClassification", () => {
  it("names thirty documents in four calls, not thirty", async () => {
    const h = harness((ids) => answerAll(ids));
    const summary = await runClassification({ candidates: docs(30), send: h.send, sleep: h.sleep });
    expect(h.calls.map((c) => c.length)).toEqual([8, 8, 8, 6]);
    expect(summary).toMatchObject({ suggested: 30, failed: 0, skipped: 0, stopped: false });
  });

  it("pauses between calls, and not after the last", async () => {
    const h = harness((ids) => answerAll(ids));
    await runClassification({ candidates: docs(17), send: h.send, sleep: h.sleep, gapMs: 600 });
    expect(h.sleeps).toEqual([600, 600]);
  });

  it("puts back what the server could not fit and sends it in the next call", async () => {
    const h = harness((ids, call) => (call === 1 ? { ok: true, results: ids.slice(0, 6).map(suggested), deferred: ids.slice(6) } : answerAll(ids)));
    const progress: Progress[] = [];
    const summary = await runClassification({ candidates: docs(8), send: h.send, sleep: h.sleep, onProgress: (p) => progress.push(p) });
    expect(h.calls).toEqual([["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"], ["d7", "d8"]]);
    expect(summary.suggested).toBe(8);
    expect(progress.at(-1)).toMatchObject({ done: 8, total: 8, batch: 2, batches: 2 });
  });

  it("does not loop when the server defers every document", async () => {
    const h = harness((ids) => ({ ok: true, results: [], deferred: ids }));
    const summary = await runClassification({ candidates: docs(3), send: h.send, sleep: h.sleep });
    expect(h.calls).toHaveLength(1);
    expect(summary.failed).toBe(3);
  });

  it("waits out a rate limit for as long as the server says, then carries on", async () => {
    const h = harness((ids, call) => (call === 1 ? { ok: false, retryable: true, retryAfterSeconds: 7, error: "Slow down" } : answerAll(ids)));
    const progress: Progress[] = [];
    const summary = await runClassification({ candidates: docs(3), send: h.send, sleep: h.sleep, onProgress: (p) => progress.push(p) });
    expect(h.sleeps).toEqual([7000]);
    expect(h.calls).toHaveLength(2);
    expect(summary.suggested).toBe(3);
    expect(progress.some((p) => p.waitingSeconds === 7)).toBe(true);
  });

  it("stops saying it is waiting once the wait is over", async () => {
    let latest: Progress | undefined;
    let atRetry: number | null | undefined;
    const h = harness((ids, call) => {
      if (call === 2) atRetry = latest?.waitingSeconds;
      return call === 1 ? { ok: false, retryable: true, retryAfterSeconds: 5, error: "Slow" } : answerAll(ids);
    });
    await runClassification({ candidates: docs(2), send: h.send, sleep: h.sleep, onProgress: (p) => (latest = p) });
    expect(atRetry).toBeNull();
  });

  it("backs off 2, 4, 8 seconds when told nothing, then gives up and says why", async () => {
    const h = harness(() => ({ ok: false, retryable: true, error: "Busy" }));
    const summary = await runClassification({ candidates: docs(2), send: h.send, sleep: h.sleep, maxRetries: 3 });
    expect(h.sleeps).toEqual([2000, 4000, 8000]);
    expect(h.calls).toHaveLength(4);
    expect(summary.failed).toBe(2);
    expect(summary.outcomes[0]).toMatchObject({ status: "failed", reason: "Busy" });
    expect([0, 1, 2, 3, 4, 5].map(backoffSeconds)).toEqual([2, 4, 8, 16, 16, 16]);
  });

  it("does not retry an error that waiting will not fix", async () => {
    const h = harness(() => ({ ok: false, retryable: false, error: "Gemini is not configured" }));
    const summary = await runClassification({ candidates: docs(2), send: h.send, sleep: h.sleep });
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect(summary.failed).toBe(2);
  });

  it("treats a request that never arrived as worth retrying", async () => {
    const h = harness((ids, call) => {
      if (call === 1) throw new Error("Failed to fetch");
      return answerAll(ids);
    });
    const summary = await runClassification({ candidates: docs(2), send: h.send, sleep: h.sleep });
    expect(summary.suggested).toBe(2);
    expect(h.sleeps).toEqual([2000]);
  });

  it("moves on after one failed batch and still names the rest", async () => {
    const h = harness((ids, call) => (call === 2 ? { ok: false, retryable: false, error: "Bad page" } : answerAll(ids)));
    const summary = await runClassification({ candidates: docs(20), send: h.send, sleep: h.sleep });
    expect(summary.suggested).toBe(12);
    expect(summary.failed).toBe(8);
  });

  it("stops when asked, and leaves the rest untouched for a later run", async () => {
    const signal = { aborted: false };
    const h = harness((ids, call) => {
      if (call === 1) signal.aborted = true;
      return answerAll(ids);
    });
    const summary = await runClassification({ candidates: docs(30), send: h.send, sleep: h.sleep, signal });
    expect(h.calls).toHaveLength(1);
    expect(summary).toMatchObject({ suggested: 8, failed: 0, stopped: true });
    expect(summary.outcomes).toHaveLength(8);
  });

  it("names a first page that is too large to batch, and carries on without it", async () => {
    const list: Candidate[] = [
      { id: "ok", mimeType: "image/png", byteSize: 1 * MB },
      { id: "huge", mimeType: "image/png", byteSize: 13 * MB },
    ];
    const h = harness((ids) => answerAll(ids));
    const summary = await runClassification({ candidates: list, send: h.send, sleep: h.sleep });
    expect(h.calls).toEqual([["ok"]]);
    expect(summary).toMatchObject({ suggested: 1, skipped: 1 });
  });

  it("counts a document the server did not mention as failed, not as done", async () => {
    const h = harness((ids) => ({ ok: true, results: [suggested(ids[0]!)], deferred: [] }));
    const summary = await runClassification({ candidates: docs(2), send: h.send, sleep: h.sleep });
    expect(summary).toMatchObject({ suggested: 1, failed: 1 });
  });

  it("does nothing, and sends nothing, for no candidates", async () => {
    const h = harness((ids) => answerAll(ids));
    const summary = await runClassification({ candidates: [], send: h.send, sleep: h.sleep });
    expect(h.calls).toEqual([]);
    expect(summary).toMatchObject({ outcomes: [], suggested: 0, stopped: false });
  });
});
