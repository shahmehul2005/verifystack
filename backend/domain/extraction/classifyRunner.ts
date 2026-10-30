/**
 * Drives a "name everything" run: plans batches, sends them one after another,
 * waits out a rate limit, puts back what the server could not fit, and stops
 * when asked. It knows nothing about fetch or timers; the caller injects both,
 * so the same logic runs in the browser and in a test.
 */

import { estimateFirstPageBytes, planBatches, type BatchItem } from "./classifyBatch";

export interface Candidate {
  id: string;
  mimeType: string;
  byteSize: number;
}

export type DocOutcome =
  | { id: string; status: "suggested"; docType: string; confidence: number }
  | { id: string; status: "unknown"; confidence: number }
  | { id: string; status: "skipped"; reason: string }
  | { id: string; status: "failed"; reason: string };

export type BatchResponse =
  | { ok: true; results: DocOutcome[]; deferred: string[] }
  | { ok: false; retryable: boolean; retryAfterSeconds?: number; error: string };

export interface Progress {
  /** Documents with an answer so far, of any kind. */
  done: number;
  total: number;
  /** Batches sent so far, and the number planned (it can grow when the server defers some). */
  batch: number;
  batches: number;
  /** Set while waiting out a rate limit. */
  waitingSeconds: number | null;
}

export interface RunSummary {
  outcomes: DocOutcome[];
  suggested: number;
  unknown: number;
  skipped: number;
  failed: number;
  stopped: boolean;
}

export interface RunOptions {
  candidates: readonly Candidate[];
  /** Sends one batch of document ids. A thrown error is treated as a retryable network failure. */
  send: (ids: string[]) => Promise<BatchResponse>;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (p: Progress) => void;
  signal?: { aborted: boolean };
  /** Pause between batches, so a long run does not hammer the model. */
  gapMs?: number;
  /** Tries per batch on a retryable failure, after the first. */
  maxRetries?: number;
}

/** Wait before retry n (0-based) when the server did not say how long. 2, 4, 8, then 16 seconds at most. */
export const backoffSeconds = (attempt: number) => Math.min(2 ** (attempt + 1), 16);

export async function runClassification(opts: RunOptions): Promise<RunSummary> {
  const gap = opts.gapMs ?? 600;
  const maxRetries = opts.maxRetries ?? 3;
  const outcomes = new Map<string, DocOutcome>();
  const byId = new Map(opts.candidates.map((c) => [c.id, c]));

  const items: BatchItem[] = opts.candidates.map((c) => ({ id: c.id, bytes: estimateFirstPageBytes(c.mimeType, c.byteSize) }));
  const plan = planBatches(items);
  for (const big of plan.tooLarge) {
    outcomes.set(big.id, { id: big.id, status: "skipped", reason: "The first page is too large to send in a batch. Suggest its type on its own." });
  }
  const queue: string[][] = plan.batches.map((b) => b.map((i) => i.id));

  let sent = 0;
  let planned = queue.length;
  const report = (waitingSeconds: number | null = null) =>
    opts.onProgress?.({ done: outcomes.size, total: opts.candidates.length, batch: sent, batches: planned, waitingSeconds });
  report();

  let stopped = false;
  while (queue.length > 0) {
    if (opts.signal?.aborted) {
      stopped = true;
      break;
    }
    const ids = queue.shift()!;
    let attempt = 0;
    for (;;) {
      let response: BatchResponse;
      try {
        response = await opts.send(ids);
      } catch (e) {
        response = { ok: false, retryable: true, error: e instanceof Error ? e.message : "The request did not reach the server." };
      }

      if (response.ok) {
        sent += 1;
        for (const r of response.results) outcomes.set(r.id, r);
        const deferred = response.deferred.filter((id) => byId.has(id) && !outcomes.has(id));
        // Nothing moved, so asking again would loop. Say so instead.
        if (deferred.length > 0 && deferred.length === ids.length) {
          for (const id of deferred) outcomes.set(id, { id, status: "failed", reason: "The server could not fit this document in a batch." });
        } else if (deferred.length > 0) {
          queue.unshift(deferred);
          planned += 1;
        }
        // Anything the server did not mention at all is not left unanswered.
        for (const id of ids) {
          if (!outcomes.has(id) && !deferred.includes(id)) outcomes.set(id, { id, status: "failed", reason: "The server gave no answer for this document." });
        }
        break;
      }

      if (response.retryable && attempt < maxRetries && !opts.signal?.aborted) {
        const seconds = Math.max(1, Math.ceil(response.retryAfterSeconds ?? backoffSeconds(attempt)));
        attempt += 1;
        report(seconds);
        await opts.sleep(seconds * 1000);
        // The wait is over, so the progress stops saying so while the retry is in flight.
        report();
        continue;
      }

      sent += 1;
      for (const id of ids) outcomes.set(id, { id, status: "failed", reason: response.error });
      break;
    }
    report();
    if (queue.length > 0 && gap > 0) await opts.sleep(gap);
  }

  // A stop leaves the rest untouched: they are not marked failed, and a later run picks them up.
  const list = [...outcomes.values()];
  return {
    outcomes: list,
    suggested: list.filter((o) => o.status === "suggested").length,
    unknown: list.filter((o) => o.status === "unknown").length,
    skipped: list.filter((o) => o.status === "skipped").length,
    failed: list.filter((o) => o.status === "failed").length,
    stopped,
  };
}
