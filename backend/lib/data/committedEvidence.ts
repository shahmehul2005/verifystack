import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import type { ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import { toProvenancedFact } from "@verifystack/backend/domain/calc/run";

export interface CommittedEvidenceFact extends ProvenancedFact {
  unit: string | null;
  document_id: string | null;
  page: number | null;
  bbox: unknown;
  source_text: string | null;
  provenance_type: string | null;
  provenance: unknown;
  canonical_key: string | null;
  period_start: string | null;
  period_end: string | null;
  period_status: string | null;
  period_note?: string | null;
  registry_version?: string | null;
  accepted_by?: string | null;
  accepted_at?: string | null;
  accept_mode?: "individual" | "bulk" | null;
  source_cev_id?: string | null;
}

/**
 * Maps a canonical registry key to its canonical methodology pack binding path.
 */
export function canonicalKeyToBindingPath(canonicalKey: string): string {
  switch (canonicalKey) {
    case "equivalent_product":
      return "production";
    case "clinker_production":
      return "clinker.production";
    case "coal_consumed":
    case "coal_stock_receipts":
      return "quantity";
    case "coal_gcv":
      return "calorificValue";
    case "grid_electricity_import":
      return "activeEnergy";
    case "clinker_calcination":
      return "process.calcinationEmissions";
    case "raw_meal_calcination":
      return "process.rawMealCalcinationEmissions";
    case "power_export":
      return "process.exportedPowerDeduction";
    case "petcoke_consumed":
      return "petcoke.quantity";
    case "furnace_oil_consumed":
      return "furnaceOil.quantity";
    case "cpp_gross_generation":
      return "cpp.generation";
    default:
      return canonicalKey;
  }
}

/**
 * Maps an accepted/corrected annual CanonicalEvidenceValue row to a CommittedEvidenceFact.
 */
export function cevToCommittedFact(cev: {
  id: string;
  canonical_key: string;
  standard_value?: number | null;
  value_numeric?: number | null;
  correction_numeric?: number | null;
  standard_unit?: string | null;
  value_unit?: string | null;
  correction_unit?: string | null;
  document_id?: string | null;
  provenance_page?: number | null;
  provenance_bbox?: unknown;
  provenance_source_text?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  registry_version?: string | null;
  state?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}): CommittedEvidenceFact {
  const value =
    cev.state === "corrected" && cev.correction_numeric !== null
      ? cev.correction_numeric
      : (cev.standard_value ?? cev.value_numeric ?? null);

  const unit =
    cev.state === "corrected" && cev.correction_unit !== null
      ? cev.correction_unit
      : (cev.standard_unit ?? cev.value_unit ?? null);

  return {
    id: cev.id,
    field_path: canonicalKeyToBindingPath(cev.canonical_key),
    value_json: value,
    unit: unit ?? null,
    document_id: cev.document_id ?? null,
    page: cev.provenance_page ?? 1,
    bbox: cev.provenance_bbox ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    source_text: cev.provenance_source_text ?? `Canonical evidence ${cev.canonical_key}`,
    provenance_type: "document_page",
    provenance: null,
    canonical_key: cev.canonical_key,
    period_start: cev.period_start ?? null,
    period_end: cev.period_end ?? null,
    period_status: "known",
    period_note: null,
    registry_version: cev.registry_version ?? null,
    accepted_by: cev.reviewed_by ?? null,
    accepted_at: cev.reviewed_at ?? null,
    accept_mode: "individual",
    source_cev_id: cev.id,
  };
}

/**
 * Loads the committed facts for an engagement.
 *
 * UNIFIED EVIDENCE STORE:
 * 1. Queries `canonical_evidence_values` for accepted/corrected annual values.
 * 2. Deduplicates by calculation `field_path` (most relevant/recent wins).
 * 3. Fills any remaining unbound paths from `public.facts` for backwards compatibility
 *    with fixtures or non-CEV workflows.
 *
 * This allows the entire platform (calculation run, technical review, submission package,
 * evidence comparison, facts page) to treat CEVs as the single source of truth without
 * double storage or "more than one accepted value" conflicts.
 */
export async function loadCommittedFactsForEngagement(
  supabase: SupabaseClient<Database>,
  engagementId: string,
  organizationId: string
): Promise<CommittedEvidenceFact[]> {
  // 1. Fetch accepted/corrected annual CEVs
  const { data: annualCevs, error: cevError } = await supabase
    .from("canonical_evidence_values")
    .select("*")
    .eq("engagement_id", engagementId)
    .eq("organization_id", organizationId)
    .eq("period_kind", "annual")
    .in("state", ["accepted", "corrected"])
    .order("period_start", { ascending: true });

  const rawCevFacts: CommittedEvidenceFact[] =
    !cevError && annualCevs ? annualCevs.map(cevToCommittedFact) : [];

  // Deduplicate CEVs by field_path so calculation runs never get conflict errors
  const cevByPath = new Map<string, CommittedEvidenceFact>();
  for (const cf of rawCevFacts) {
    const existing = cevByPath.get(cf.field_path);
    if (!existing) {
      cevByPath.set(cf.field_path, cf);
    } else {
      if (
        cf.canonical_key === "equivalent_product" ||
        (cf.accepted_at && (!existing.accepted_at || cf.accepted_at > existing.accepted_at))
      ) {
        cevByPath.set(cf.field_path, cf);
      }
    }
  }

  // 2. Fallback / supplement from public.facts
  const { data: factRows } = await supabase
    .from("facts")
    .select("*")
    .eq("engagement_id", engagementId)
    .eq("organization_id", organizationId);

  const fallbackFacts: CommittedEvidenceFact[] = (factRows ?? []).map((f) => {
    const pf = toProvenancedFact(f);
    return {
      ...pf,
      unit: pf.unit ?? null,
      document_id: pf.document_id ?? null,
      page: pf.page ?? null,
      bbox: pf.bbox ?? null,
      source_text: pf.source_text ?? null,
      provenance_type: pf.provenance_type ?? null,
      provenance: pf.provenance ?? null,
      canonical_key: f.canonical_key ?? null,
      period_start: f.period_start ?? null,
      period_end: f.period_end ?? null,
      period_status: f.period_status ?? null,
      period_note: f.period_note ?? null,
      registry_version: f.registry_version ?? null,
      accepted_by: f.accepted_by ?? null,
      accepted_at: f.accepted_at ?? null,
      accept_mode: (f as { accept_mode?: "individual" | "bulk" | null }).accept_mode ?? null,
      source_cev_id: null,
    };
  });

  if (cevByPath.size === 0) {
    return fallbackFacts;
  }

  // CEVs take precedence over facts for the paths they cover
  const uniqueCevFacts = Array.from(cevByPath.values());
  const coveredPaths = new Set(uniqueCevFacts.map((cf) => cf.field_path));
  const remainingFacts = fallbackFacts.filter((f) => !coveredPaths.has(f.field_path));

  return [...uniqueCevFacts, ...remainingFacts];
}
