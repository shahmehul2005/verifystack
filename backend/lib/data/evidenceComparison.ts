import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { DEFAULT_TOLERANCE } from "@verifystack/backend/domain/compare/declared";
import { registryForPack } from "@verifystack/backend/domain/registry";
import { compareEvidence, type Comparison, type ReadingInput } from "@verifystack/backend/domain/registry/compare";
import { loadCommittedFactsForEngagement } from "./committedEvidence";

/**
 * Line up an engagement's desk-review readings with the facts a person approved, by registry key.
 *
 * Read only: it selects and compares, and writes nothing anywhere. `readings` is whatever the caller
 * already holds (the pro forma cells, the workbook readers' figures and the verifier's typed readings,
 * with the document each typed one was read from). The facts are read here. A pack with no registry
 * returns null, and so does any read that fails: a comparison is advisory and must never stop a review.
 */
export async function loadEvidenceComparison(args: {
  organizationId: string;
  engagementId: string;
  packId: string;
  readings: Record<string, ReadingInput>;
}): Promise<Comparison | null> {
  const registry = registryForPack(args.packId);
  if (!registry) return null;
  try {
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return null;
    const [facts, { data: docs, error: docsError }] = await Promise.all([
      loadCommittedFactsForEngagement(db, args.engagementId, args.organizationId),
      db.from("documents").select("id, original_filename").eq("engagement_id", args.engagementId).eq("organization_id", args.organizationId),
    ]);
    if (docsError) return null;
    const names = new Map((docs ?? []).map((d) => [d.id, d.original_filename]));
    return compareEvidence({
      registry,
      readings: args.readings,
      facts: facts.map((f) => ({
        id: f.id,
        documentId: f.document_id ?? null,
        fieldPath: f.field_path,
        value: f.value_json,
        unit: f.unit ?? null,
        canonicalKey: f.canonical_key ?? null,
        periodStatus: f.period_status === "known" || f.period_status === "unknown" ? f.period_status : null,
        periodStart: f.period_start ?? null,
        periodEnd: f.period_end ?? null,
        periodNote: f.period_note ?? null,
      })),
      documentName: (id) => names.get(id) ?? null,
      tolerance: DEFAULT_TOLERANCE,
    });
  } catch {
    return null;
  }
}

/**
 * The readings map the comparison needs, from desk review's own two stores: the workbook readings and
 * the verifier's typed ones (whose document is recorded). Typed readings win a key, as they do in a run.
 */
export function readingsForComparison(
  workbook: Record<string, number | string>,
  typed: { key: string; value: number | string; document_id: string | null }[]
): Record<string, ReadingInput> {
  const out: Record<string, ReadingInput> = {};
  for (const [key, value] of Object.entries(workbook)) out[key] = { value };
  for (const t of typed) out[t.key] = { value: t.value, documentId: t.document_id };
  return out;
}
