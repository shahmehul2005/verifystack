/**
 * Drives an "extract everything" run: one document at a time, because each one
 * is a long model job, waiting out a rate limit and stopping when asked. The
 * caller injects the request and the timer, so the same logic runs in the
 * browser and in a test.
 */

import { backoffSeconds } from "./classifyRunner";

export interface ExtractCandidate {
  id: string;
  name: string;
}

export type ExtractResponse =
  | { ok: true; extracted: number; pages?: number; docType?: string }
  | { ok: false; retryable: boolean; retryAfterSeconds?: number; error: string };

export type ExtractOutcome =
  | { id: string; name: string; status: "extracted"; fields: number }
  | { id: string; name: string; status: "no_fields"; docType?: string }
  | { id: string; name: string; status: "failed"; reason: string };

export interface ExtractProgress {
  done: number;
  total: number;
  /** The file being read now, and a wait if the model is rate-limiting. */
  current: string | null;
  waitingSeconds: number | null;
}

export interface ExtractSummary {
  outcomes: ExtractOutcome[];
  extracted: number;
  fields: number;
  noFields: number;
  failed: number;
  stopped: boolean;
}

export interface ExtractRunOptions {
  candidates: readonly ExtractCandidate[];
  send: (documentId: string) => Promise<ExtractResponse>;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (p: ExtractProgress) => void;
  signal?: { aborted: boolean };
  /** Pause between documents. */
  gapMs?: number;
  /** Tries per document on a retryable failure, after the first. */
  maxRetries?: number;
}

export async function runExtraction(opts: ExtractRunOptions): Promise<ExtractSummary> {
  const gap = opts.gapMs ?? 500;
  const maxRetries = opts.maxRetries ?? 3;
  const outcomes: ExtractOutcome[] = [];
  const total = opts.candidates.length;
  const report = (current: string | null, waitingSeconds: number | null = null) =>
    opts.onProgress?.({ done: outcomes.length, total, current, waitingSeconds });
  report(null);

  let stopped = false;
  for (let i = 0; i < opts.candidates.length; i++) {
    if (opts.signal?.aborted) {
      stopped = true;
      break;
    }
    const doc = opts.candidates[i]!;
    report(doc.name);
    let attempt = 0;
    for (;;) {
      let response: ExtractResponse;
      try {
        response = await opts.send(doc.id);
      } catch (e) {
        response = { ok: false, retryable: true, error: e instanceof Error ? e.message : "The request did not reach the server." };
      }
      if (response.ok) {
        outcomes.push(
          response.extracted > 0
            ? { id: doc.id, name: doc.name, status: "extracted", fields: response.extracted }
            : { id: doc.id, name: doc.name, status: "no_fields", ...(response.docType ? { docType: response.docType } : {}) }
        );
        break;
      }
      if (response.retryable && attempt < maxRetries && !opts.signal?.aborted) {
        const seconds = Math.max(1, Math.ceil(response.retryAfterSeconds ?? backoffSeconds(attempt)));
        attempt += 1;
        report(doc.name, seconds);
        await opts.sleep(seconds * 1000);
        report(doc.name);
        continue;
      }
      outcomes.push({ id: doc.id, name: doc.name, status: "failed", reason: response.error });
      break;
    }
    report(null);
    if (i < opts.candidates.length - 1 && gap > 0 && !opts.signal?.aborted) await opts.sleep(gap);
  }

  return {
    outcomes,
    extracted: outcomes.filter((o) => o.status === "extracted").length,
    fields: outcomes.reduce((n, o) => n + (o.status === "extracted" ? o.fields : 0), 0),
    noFields: outcomes.filter((o) => o.status === "no_fields").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    stopped,
  };
}

/** Jobs that mean a document does not need reading again: one running or waiting, or one finished. A failed job does not. */
export const ACTIVE_JOB_STATUSES = ["queued", "running", "done"] as const;

/** The documents still to read: not yet read, in the order given. */
export function needsExtraction<T extends { id: string }>(docs: readonly T[], jobs: readonly { document_id: string; status: string }[]): T[] {
  const handled = new Set(jobs.filter((j) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status)).map((j) => j.document_id));
  return docs.filter((d) => !handled.has(d.id));
}
