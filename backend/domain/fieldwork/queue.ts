/**
 * Offline capture queue (DFD 14.0).
 *
 * Plants have patchy signal. Capture writes to a local queue first, and the
 * queue syncs when the device is online. This module is the pure logic; the
 * browser component owns storage and network. Because it is pure it is tested
 * without a browser, and the rules are stated once.
 *
 * Guarantees:
 *  - Enqueueing the same clientId twice keeps one entry.
 *  - Sync order is capture order, so a reading and its follow-up arrive in sequence.
 *  - A permanent rejection (the server said the observation is invalid) is kept
 *    for the user to fix or discard, never retried blindly or silently dropped.
 *  - A transient failure is retried with a growing delay, capped.
 *  - Nothing leaves the queue except on a confirmed save or an explicit discard.
 *
 * Photographs are not queued: a camera image is too large for browser storage
 * limits. They upload while online and are attached by id.
 */

import type { ObservationInput } from "./observation";

export interface QueueItem {
  clientId: string;
  payload: ObservationInput;
  queuedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  /** Set on a permanent rejection; the item then waits for the user. */
  rejected: string | null;
  lastError: string | null;
}

export const MAX_QUEUE_ITEMS = 200;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

export function enqueue(queue: QueueItem[], payload: ObservationInput, now: Date = new Date()): QueueItem[] {
  if (queue.some((q) => q.clientId === payload.clientId)) return queue;
  if (queue.length >= MAX_QUEUE_ITEMS) {
    throw new RangeError(`The offline queue holds at most ${MAX_QUEUE_ITEMS} observations. Sync or discard some first.`);
  }
  return [
    ...queue,
    {
      clientId: payload.clientId,
      payload,
      queuedAt: now.toISOString(),
      attempts: 0,
      nextAttemptAt: null,
      rejected: null,
      lastError: null,
    },
  ];
}

/** Items to send now, in capture order. */
export function dueItems(queue: QueueItem[], now: Date = new Date()): QueueItem[] {
  return queue
    .filter((q) => !q.rejected && (q.nextAttemptAt === null || Date.parse(q.nextAttemptAt) <= now.getTime()))
    .sort((a, b) => Date.parse(a.payload.observedAt) - Date.parse(b.payload.observedAt) || a.queuedAt.localeCompare(b.queuedAt));
}

export type SyncOutcome =
  | { kind: "saved" }
  | { kind: "duplicate" }
  | { kind: "rejected"; reason: string }
  | { kind: "retry"; reason: string };

export function applyOutcome(queue: QueueItem[], clientId: string, outcome: SyncOutcome, now: Date = new Date()): QueueItem[] {
  if (outcome.kind === "saved" || outcome.kind === "duplicate") {
    return queue.filter((q) => q.clientId !== clientId);
  }
  return queue.map((q) => {
    if (q.clientId !== clientId) return q;
    if (outcome.kind === "rejected") return { ...q, rejected: outcome.reason, lastError: outcome.reason };
    const attempts = q.attempts + 1;
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempts - 1));
    return {
      ...q,
      attempts,
      lastError: outcome.reason,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    };
  });
}

/** After a user fixes a rejected item, it goes back in line. */
export function reviseItem(queue: QueueItem[], clientId: string, payload: ObservationInput): QueueItem[] {
  return queue.map((q) =>
    q.clientId === clientId ? { ...q, payload: { ...payload, clientId }, rejected: null, lastError: null, attempts: 0, nextAttemptAt: null } : q
  );
}

export function discardItem(queue: QueueItem[], clientId: string): QueueItem[] {
  return queue.filter((q) => q.clientId !== clientId);
}

/** Parse what was stored, tolerating a corrupt or older value by starting empty. */
export function parseQueue(raw: string | null): QueueItem[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (q): q is QueueItem =>
        typeof q === "object" && q !== null && typeof (q as QueueItem).clientId === "string" && typeof (q as QueueItem).payload === "object"
    );
  } catch {
    return [];
  }
}

export function queueSummary(queue: QueueItem[]): { pending: number; rejected: number } {
  const rejected = queue.filter((q) => q.rejected).length;
  return { pending: queue.length - rejected, rejected };
}
