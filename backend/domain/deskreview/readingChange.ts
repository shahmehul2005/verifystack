import type { Region } from "./snip";

/**
 * What a save does to one figure an auditor read off a document. An edit and a
 * withdrawal change the record, so each needs a reason and is kept in the
 * history; a first entry and an unchanged figure need neither.
 */

export interface ReadingState {
  value: number;
  documentId: string | null;
  page: number | null;
  bbox: Region | null;
  sourceText: string | null;
}

export type ChangeKind = "nothing" | "entered" | "edited" | "withdrawn" | "unchanged";

export const MIN_CHANGE_REASON = 8;

const EPSILON = 1e-9;

function sameRegion(a: Region | null, b: Region | null): boolean {
  if (!a || !b) return a === b;
  return (["x", "y", "width", "height"] as const).every((k) => Math.abs(a[k] - b[k]) < EPSILON);
}

function sameReading(a: ReadingState, b: ReadingState): boolean {
  return (
    a.value === b.value &&
    a.documentId === b.documentId &&
    a.page === b.page &&
    sameRegion(a.bbox, b.bbox) &&
    (a.bbox ? (a.sourceText ?? "").trim() === (b.sourceText ?? "").trim() : true)
  );
}

/** `prior` is the figure now on record, `next` the figure being saved (null to withdraw it). */
export function classifyChange(prior: ReadingState | null, next: ReadingState | null): ChangeKind {
  if (!prior && !next) return "nothing";
  if (!prior) return "entered";
  if (!next) return "withdrawn";
  return sameReading(prior, next) ? "unchanged" : "edited";
}

/** Whether the change has to be explained. */
export const needsReason = (kind: ChangeKind) => kind === "edited" || kind === "withdrawn";

/** Null when the reason is enough for this change, otherwise what is wrong. */
export function reasonProblem(kind: ChangeKind, reason: string | null | undefined): string | null {
  if (!needsReason(kind)) return null;
  const text = (reason ?? "").trim();
  if (text.length >= MIN_CHANGE_REASON) return null;
  return `Say why in at least ${MIN_CHANGE_REASON} characters.`;
}
