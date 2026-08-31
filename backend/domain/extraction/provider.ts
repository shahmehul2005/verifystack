/**
 * Provider-agnostic extraction interface.
 *
 * The rest of the system must never import a vendor SDK directly. Swapping models,
 * or running two models against the same page to cross-check a high-materiality
 * field, has to be a configuration change rather than a rewrite.
 */

import type { z } from "zod";
import type { Classification, DocType } from "./schemas";

export interface DocumentPage {
  /** Content-addressed id of the parent evidence item. */
  evidenceId: string;
  pageNumber: number;
  mimeType: "image/png" | "image/jpeg" | "application/pdf";
  /** Base64-encoded page content. */
  data: string;
}

/** Everything needed to reproduce or audit a single model call. */
export interface AiActionLog {
  tool: "classify_document" | "extract_fields";
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  evidenceId: string;
  pageNumber: number;
  startedAt: string;
  durationMs: number;
  /** Raw model output before validation, kept for dispute resolution. */
  rawOutput: string;
  ok: boolean;
  error?: string;
}

export interface ExtractionResult<T> {
  ok: boolean;
  data?: T;
  /** Populated when the model output failed schema validation. */
  validationErrors?: string[];
  log: AiActionLog;
}

export interface ExtractionProvider {
  readonly name: string;
  readonly model: string;

  classify(page: DocumentPage): Promise<ExtractionResult<Classification>>;

  extract<T extends z.ZodTypeAny>(
    page: DocumentPage,
    docType: DocType,
    schema: T
  ): Promise<ExtractionResult<z.infer<T>>>;
}

/**
 * Cross-check a field by running extraction twice and comparing.
 * Disagreement escalates to a human rather than picking a winner.
 */
export function crossCheck<T>(
  a: T | undefined,
  b: T | undefined,
  isEqual: (x: T, y: T) => boolean
): { agreed: boolean; value?: T; reason: string } {
  if (a === undefined || b === undefined) {
    return { agreed: false, reason: "One of the two extraction passes produced no value" };
  }
  if (isEqual(a, b)) {
    return { agreed: true, value: a, reason: "Both passes agree" };
  }
  return { agreed: false, reason: "Extraction passes disagree — routed to human review" };
}
