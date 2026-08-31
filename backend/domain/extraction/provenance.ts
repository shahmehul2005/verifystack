import { BBoxSchema, ProvenanceSchema } from "./schemas";
import type { BBox } from "./schemas";

export interface ProvenanceGateInput {
  fieldPath: string;
  page?: number;
  bbox?: BBox;
  sourceText?: string;
}

export type ProvenanceGateResult =
  | { ok: true; page: number; bbox: BBox; sourceText: string }
  | { ok: false; reason: string; fieldPath: string };

/**
 * Process 3.5 — values lacking provenance are dropped (and must be logged to D7).
 */
export function provenanceGate(input: ProvenanceGateInput): ProvenanceGateResult {
  const parsed = ProvenanceSchema.safeParse({
    page: input.page,
    bbox: input.bbox,
    sourceText: input.sourceText,
  });
  if (!parsed.success) {
    return {
      ok: false,
      fieldPath: input.fieldPath,
      reason: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const bbox = BBoxSchema.safeParse(parsed.data.bbox);
  if (!bbox.success) {
    return { ok: false, fieldPath: input.fieldPath, reason: "Invalid bbox" };
  }
  return {
    ok: true,
    page: parsed.data.page,
    bbox: bbox.data,
    sourceText: parsed.data.sourceText,
  };
}
