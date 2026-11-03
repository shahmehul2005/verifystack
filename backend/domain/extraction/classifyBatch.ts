/**
 * Naming many documents in few model calls.
 *
 * One call carries the first page of several documents and returns one type for
 * each, so thirty unassigned files take four calls, not thirty. The limits that
 * decide how many go in one call are here, with the planner, the parser for what
 * comes back and the test for "the provider said slow down".
 *
 * Three limits shape a batch:
 *  - the number of documents, so one wrong or missing answer costs a few files;
 *  - the bytes of page data, because the model's inline request cap is about
 *    20 MB and base64 adds a third;
 *  - the model's call rate, handled by the caller with the retry-after below.
 */

import { z } from "zod";

/** Documents in one model call. */
export const MAX_DOCS_PER_BATCH = 8;

/** Raw page bytes in one call. Base64 makes this about 12 MB on the wire, well under the inline cap. */
export const MAX_BATCH_BYTES = 9 * 1024 * 1024;

/** The largest single first page sent alone, raw. About 16 MB on the wire. */
export const MAX_SINGLE_PAGE_BYTES = 12 * 1024 * 1024;

/** A PDF's first page is usually small even when the file is large. Used only to plan before the file is read. */
export const PDF_FIRST_PAGE_ESTIMATE = 2 * 1024 * 1024;

/** Types a first page can be sent as. WebP is not one of them. */
export const BATCHABLE_MIME = ["application/pdf", "image/png", "image/jpeg", "image/jpg"] as const;

export const isBatchable = (mimeType: string | null | undefined) => (BATCHABLE_MIME as readonly string[]).includes(mimeType ?? "");

export interface BatchItem {
  id: string;
  /** Bytes the first page is expected to take, raw. */
  bytes: number;
}

/** What a file's first page is expected to weigh, before the file is opened. An upper bound for an image, an estimate for a PDF. */
export function estimateFirstPageBytes(mimeType: string, fileBytes: number): number {
  return mimeType === "application/pdf" ? Math.min(fileBytes, PDF_FIRST_PAGE_ESTIMATE) : fileBytes;
}

export interface BatchPlan {
  batches: BatchItem[][];
  /** Items too large to send even alone. They are named, never dropped silently. */
  tooLarge: BatchItem[];
}

/**
 * Group items into batches in the order given. A batch closes when the next item
 * would take it past `maxDocs` or `maxBytes`. An item over `maxSingle` is set
 * aside; an item over `maxBytes` but within `maxSingle` goes alone.
 */
export function planBatches(
  items: readonly BatchItem[],
  limits: { maxDocs?: number; maxBytes?: number; maxSingle?: number } = {}
): BatchPlan {
  const maxDocs = Math.max(1, limits.maxDocs ?? MAX_DOCS_PER_BATCH);
  const maxBytes = limits.maxBytes ?? MAX_BATCH_BYTES;
  const maxSingle = limits.maxSingle ?? MAX_SINGLE_PAGE_BYTES;
  const batches: BatchItem[][] = [];
  const tooLarge: BatchItem[] = [];
  let current: BatchItem[] = [];
  let bytes = 0;
  const close = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    bytes = 0;
  };
  for (const item of items) {
    if (item.bytes > maxSingle) {
      tooLarge.push(item);
      continue;
    }
    if (item.bytes > maxBytes) {
      close();
      batches.push([item]);
      continue;
    }
    if (current.length >= maxDocs || bytes + item.bytes > maxBytes) close();
    current.push(item);
    bytes += item.bytes;
  }
  close();
  return { batches, tooLarge };
}

/* ------------------------------------------------------------------ */
/* What the model sends back                                           */
/* ------------------------------------------------------------------ */

const BatchEntry = z.object({
  index: z.number().int().min(1),
  docType: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500).optional().default(""),
});

const BatchOutput = z.object({ results: z.array(z.unknown()) });

export interface BatchClassification {
  docType: string;
  confidence: number;
  reasoning: string;
}

export interface ParsedBatch {
  /** One slot per document, in the order they were sent. Null where the model gave no usable answer. */
  items: (BatchClassification | null)[];
  /** Why a slot is null, or what was wrong with the output as a whole. */
  errors: string[];
}

function stripFence(raw: string): string {
  const m = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : raw.trim();
}

/**
 * Read the model's answer for a batch of `count` documents. An answer that is
 * not one of `allowed` (or "unknown"), is out of range, repeats an index or
 * misses a document leaves that slot null with the reason, so the caller can
 * report it and ask again; one bad entry never spoils the others.
 */
export function parseBatchOutput(raw: string, count: number, allowed: readonly string[]): ParsedBatch {
  const items: (BatchClassification | null)[] = Array.from({ length: count }, () => null);
  const errors: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(stripFence(raw));
  } catch {
    return { items, errors: ["The answer was not valid JSON."] };
  }
  // A bare array is accepted as the list of results.
  const wrapped = Array.isArray(json) ? { results: json } : json;
  const top = BatchOutput.safeParse(wrapped);
  if (!top.success) return { items, errors: ["The answer had no list of results."] };

  const ok = new Set([...allowed, "unknown"]);
  const seen = new Set<number>();
  for (const entry of top.data.results) {
    const parsed = BatchEntry.safeParse(entry);
    if (!parsed.success) {
      errors.push("An entry was not shaped as expected.");
      continue;
    }
    const { index, docType, confidence, reasoning } = parsed.data;
    if (index > count) {
      errors.push(`The answer named document ${index}, but only ${count} were sent.`);
      continue;
    }
    if (seen.has(index)) {
      errors.push(`Document ${index} was answered more than once; both answers are set aside.`);
      items[index - 1] = null;
      continue;
    }
    seen.add(index);
    if (!ok.has(docType)) {
      errors.push(`Document ${index} was given "${docType}", which is not a type this methodology defines.`);
      continue;
    }
    items[index - 1] = { docType, confidence, reasoning };
  }
  // An index that repeated stays null even though it was seen once before the repeat.
  for (let i = 0; i < count; i++) {
    if (items[i] === null && !errors.some((e) => e.includes(`ocument ${i + 1} `))) errors.push(`Document ${i + 1} was not answered.`);
  }
  return { items, errors };
}

/* ------------------------------------------------------------------ */
/* Slowing down                                                        */
/* ------------------------------------------------------------------ */

const RATE_LIMITED = /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota|too many requests|\b503\b|UNAVAILABLE|overloaded|try again/i;

/** Does a provider error say "too fast" or "busy", so that waiting and trying again is the right answer? */
export function isRetryableProviderError(message: string | null | undefined): boolean {
  return RATE_LIMITED.test(message ?? "");
}
