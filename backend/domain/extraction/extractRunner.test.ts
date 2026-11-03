import { describe, expect, it } from "vitest";
import { needsExtraction, runExtraction, type ExtractCandidate, type ExtractProgress, type ExtractResponse } from "./extractRunner";

const docs = (n: number): ExtractCandidate[] => Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, name: `file${i + 1}.pdf` }));

function harness(send: (id: string, call: number) => ExtractResponse | Promise<ExtractResponse>) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  return {
    calls,
    sleeps,
    send: async (id: string) => {
      calls.push(id);
      return send(id, calls.length);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

describe("runExtraction", () => {
  it("reads each document once, in order, and counts the fields", async () => {
    const h = harness((id) => ({ ok: true, extracted: id === "d2" ? 0 : 5, docType: "unknown" }));
    const s = await runExtraction({ candidates: docs(3), send: h.send, sleep: h.sleep });
    expect(h.calls).toEqual(["d1", "d2", "d3"]);
    expect(s).toMatchObject({ extracted: 2, fields: 10, noFields: 1, failed: 0, stopped: false });
  });

  it("pauses between documents and not after the last", async () => {
    const h = harness(() => ({ ok: true, extracted: 1 }));
    await runExtraction({ candidates: docs(3), send: h.send, sleep: h.sleep, gapMs: 500 });
    expect(h.sleeps).toEqual([500, 500]);
  });

  it("waits out a rate limit for as long as the server says, then reads the document", async () => {
    const h = harness((_id, call) => (call === 1 ? { ok: false, retryable: true, retryAfterSeconds: 9, error: "slow" } : { ok: true, extracted: 2 }));
    const progress: ExtractProgress[] = [];
    const s = await runExtraction({ candidates: docs(1), send: h.send, sleep: h.sleep, onProgress: (p) => progress.push(p) });
    expect(h.sleeps).toEqual([9000]);
    expect(h.calls).toEqual(["d1", "d1"]);
    expect(s.extracted).toBe(1);
    expect(progress.some((p) => p.waitingSeconds === 9)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ done: 1, total: 1, current: null, waitingSeconds: null });
  });

  it("backs off 2, 4, 8 seconds when told nothing, then gives up on that document and moves on", async () => {
    const h = harness((id) => (id === "d1" ? { ok: false, retryable: true, error: "busy" } : { ok: true, extracted: 3 }));
    const s = await runExtraction({ candidates: docs(2), send: h.send, sleep: h.sleep, gapMs: 0, maxRetries: 3 });
    expect(h.sleeps).toEqual([2000, 4000, 8000]);
    expect(s).toMatchObject({ failed: 1, extracted: 1 });
    expect(s.outcomes[0]).toMatchObject({ status: "failed", reason: "busy" });
  });

  it("does not retry an error that waiting will not fix", async () => {
    const h = harness(() => ({ ok: false, retryable: false, error: "This PDF has 90 pages." }));
    const s = await runExtraction({ candidates: docs(2), send: h.send, sleep: h.sleep, gapMs: 0 });
    expect(h.calls).toEqual(["d1", "d2"]);
    expect(s.failed).toBe(2);
  });

  it("treats a request that never arrived as worth retrying", async () => {
    const h = harness((_id, call) => {
      if (call === 1) throw new Error("Failed to fetch");
      return { ok: true, extracted: 1 };
    });
    const s = await runExtraction({ candidates: docs(1), send: h.send, sleep: h.sleep });
    expect(s.extracted).toBe(1);
    expect(h.sleeps).toEqual([2000]);
  });

  it("stops when asked and leaves the rest unread", async () => {
    const signal = { aborted: false };
    const h = harness((_id, call) => {
      if (call === 1) signal.aborted = true;
      return { ok: true, extracted: 1 };
    });
    const s = await runExtraction({ candidates: docs(5), send: h.send, sleep: h.sleep, signal });
    expect(h.calls).toEqual(["d1"]);
    expect(s).toMatchObject({ extracted: 1, stopped: true });
    expect(s.outcomes).toHaveLength(1);
  });

  it("does nothing for no documents", async () => {
    const h = harness(() => ({ ok: true, extracted: 1 }));
    const s = await runExtraction({ candidates: [], send: h.send, sleep: h.sleep });
    expect(h.calls).toEqual([]);
    expect(s).toMatchObject({ outcomes: [], stopped: false });
  });
});

describe("needsExtraction", () => {
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("leaves out a document with a finished, running or waiting job, and keeps a failed one", () => {
    const jobs = [
      { document_id: "a", status: "done" },
      { document_id: "b", status: "running" },
      { document_id: "c", status: "failed" },
    ];
    expect(needsExtraction(all, jobs).map((d) => d.id)).toEqual(["c", "d"]);
  });

  it("keeps a document whose earlier job failed even if another also failed, and any with no job", () => {
    expect(needsExtraction(all, [{ document_id: "a", status: "failed" }, { document_id: "a", status: "failed" }]).map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves out a document that failed once and then finished", () => {
    expect(needsExtraction([{ id: "a" }], [{ document_id: "a", status: "failed" }, { document_id: "a", status: "done" }])).toEqual([]);
  });
});
