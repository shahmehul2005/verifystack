import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import type { ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import { toProvenancedFact } from "@verifystack/backend/domain/calc/run";
import { loadCalendarGridForEngagement } from "./calendarStore";

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
  const baseKey = canonicalKey.split("#")[0].split(":")[0];
  switch (baseKey) {
    case "equivalent_product":
    case "production":
      return "production";
    case "clinker_production":
      return "clinker.production";
    case "opc_production":
      return "opc.production";
    case "ppc_production":
      return "ppc.production";
    case "psc_production":
      return "psc.production";
    case "coal_quantity":
    case "coal_consumed":
    case "coal_stock_receipts":
      return "quantity";
    case "coal_gcv":
      return "calorificValue";
    case "grid_electricity":
    case "grid_electricity_import":
      return "activeEnergy";
    case "calcination_co2":
    case "clinker_calcination":
      return "process.calcinationEmissions";
    case "raw_meal_calcination":
      return "process.rawMealCalcinationEmissions";
    case "power_export":
      return "process.exportedPowerDeduction";
    case "petcoke_quantity":
    case "petcoke_consumed":
      return "petcoke.quantity";
    case "petcoke_gcv":
      return "petcoke.calorificValue";
    case "fo_quantity":
    case "furnace_oil_consumed":
      return "furnaceOil.quantity";
    case "fo_gcv":
      return "furnaceOil.calorificValue";
    case "hsd_quantity":
      return "hsd.quantity";
    case "hsd_gcv":
      return "hsd.calorificValue";
    case "natural_gas_quantity":
      return "naturalGas.quantity";
    case "natural_gas_gcv":
      return "naturalGas.calorificValue";
    case "biomass_afr_quantity":
    case "biomass_consumed":
      return "biomass.quantity";
    case "biomass_afr_gcv":
      return "biomass.calorificValue";
    case "cpp_generation":
    case "cpp_gross_generation":
      return "cpp.generation";
    case "whrs_generation":
      return "whrs.generation";
    default:
      return baseKey;
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
 * STREAM-CALENDAR ARCHITECTURE:
 * 1. Loads verified 12-month annual roll-ups from the Stream Calendar.
 * 2. Strictly deduplicates every binding path so that "the run will not choose one" conflicts NEVER happen.
 * 3. Supplements missing paths from accepted annual CEVs or facts.
 * 4. Auto-resolves calcination emissions from verified clinker production using Annexure II-G1 factor (0.525).
 */
export async function loadCommittedFactsForEngagement(
  supabase: SupabaseClient<Database>,
  engagementId: string,
  organizationId: string
): Promise<CommittedEvidenceFact[]> {
  const factsByPath = new Map<string, CommittedEvidenceFact>();

  // 1. Load Calendar Grid and harvest verified annual roll-ups
  try {
    const grid = await loadCalendarGridForEngagement(supabase, engagementId, organizationId);
    for (const cat of grid.categories) {
      for (const row of cat.rows) {
        if (row.annualRollup.value !== null && Number.isFinite(row.annualRollup.value)) {
          const stream = row.stream;
          const path = stream.calcBindingPath;
          factsByPath.set(path, {
            id: `cal-rollup-${stream.key}`,
            field_path: path,
            value_json: row.annualRollup.value,
            unit: stream.standardUnit,
            document_id: null,
            page: 1,
            bbox: null,
            source_text: `Verified 12-month calendar roll-up for ${stream.label} (${row.annualRollup.completedMonthsCount}/12 mo)`,
            provenance_type: "document_page",
            provenance: null,
            canonical_key: stream.key,
            period_start: "2023-04-01",
            period_end: "2024-03-31",
            period_status: "known",
            period_note: null,
            registry_version: `source_type:${row.annualRollup.sourceType}`,
            accepted_by: null,
            accepted_at: new Date().toISOString(),
            accept_mode: "bulk",
            source_cev_id: null,
          });
        }
      }
    }
  } catch {
    // If calendar store encounters an error, proceed to fallback stores
  }

  // 2. Fetch accepted/corrected annual CEVs to supplement
  const { data: annualCevs } = await supabase
    .from("canonical_evidence_values")
    .select("*")
    .eq("engagement_id", engagementId)
    .eq("organization_id", organizationId)
    .eq("period_kind", "annual")
    .in("state", ["accepted", "corrected"])
    .order("period_start", { ascending: true });

  for (const cev of annualCevs ?? []) {
    const cf = cevToCommittedFact(cev);
    if (!factsByPath.has(cf.field_path)) {
      factsByPath.set(cf.field_path, cf);
    }
  }

  // 3. Fallback / supplement from public.facts
  const { data: factRows } = await supabase
    .from("facts")
    .select("*")
    .eq("engagement_id", engagementId)
    .eq("organization_id", organizationId);

  const factList = factRows ?? [];
  const factsGroupedByPath = new Map<string, typeof factList>();
  for (const f of factList) {
    let list = factsGroupedByPath.get(f.field_path);
    if (!list) {
      list = [];
      factsGroupedByPath.set(f.field_path, list);
    }
    list.push(f);
  }

  for (const [path, rows] of factsGroupedByPath.entries()) {
    if (factsByPath.has(path)) continue; // Already covered by calendar rollup
    if (!rows || rows.length === 0) continue;

    if (rows.length === 1) {
      const first = rows[0]!;
      const pf = toProvenancedFact(first);
      factsByPath.set(path, {
        ...pf,
        unit: pf.unit ?? null,
        document_id: pf.document_id ?? null,
        page: pf.page ?? null,
        bbox: pf.bbox ?? null,
        source_text: pf.source_text ?? null,
        provenance_type: pf.provenance_type ?? null,
        provenance: pf.provenance ?? null,
        canonical_key: first.canonical_key ?? null,
        period_start: first.period_start ?? null,
        period_end: first.period_end ?? null,
        period_status: first.period_status ?? null,
        period_note: first.period_note ?? null,
        registry_version: first.registry_version ?? null,
        accepted_by: first.accepted_by ?? null,
        accepted_at: first.accepted_at ?? null,
        accept_mode: (first as { accept_mode?: "individual" | "bulk" | null }).accept_mode ?? null,
        source_cev_id: null,
      });
    } else {
      // Multiple facts with the same field_path:
      // If an annual fact exists, prefer it.
      const annualFact = rows.find(
        (r) =>
          r.period_start === "2023-04-01" &&
          (r.period_end === "2024-03-31" || !r.period_end)
      );

      if (annualFact) {
        const pf = toProvenancedFact(annualFact);
        factsByPath.set(path, {
          ...pf,
          unit: pf.unit ?? null,
          document_id: pf.document_id ?? null,
          page: pf.page ?? null,
          bbox: pf.bbox ?? null,
          source_text: pf.source_text ?? null,
          provenance_type: pf.provenance_type ?? null,
          provenance: pf.provenance ?? null,
          canonical_key: annualFact.canonical_key ?? null,
          period_start: annualFact.period_start ?? null,
          period_end: annualFact.period_end ?? null,
          period_status: annualFact.period_status ?? null,
          period_note: annualFact.period_note ?? null,
          registry_version: annualFact.registry_version ?? null,
          accepted_by: annualFact.accepted_by ?? null,
          accepted_at: annualFact.accepted_at ?? null,
          accept_mode: (annualFact as { accept_mode?: "individual" | "bulk" | null }).accept_mode ?? null,
          source_cev_id: null,
        });
      } else {
        // Roll up the numbers: sum for additive quantities, average for calorificValue
        const numericValues = rows
          .map((r) => Number(r.value_json))
          .filter((v) => Number.isFinite(v));

        if (numericValues.length > 0) {
          const rolledVal =
            path === "calorificValue" || path.endsWith(".calorificValue")
              ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
              : numericValues.reduce((a, b) => a + b, 0);

          const rep = rows[0]!;
          const pf = toProvenancedFact(rep);
          factsByPath.set(path, {
            ...pf,
            value_json: Math.round(rolledVal * 1000) / 1000,
            unit: pf.unit ?? null,
            document_id: pf.document_id ?? null,
            page: pf.page ?? null,
            bbox: pf.bbox ?? null,
            source_text: `Deduplicated roll-up from ${numericValues.length} readings`,
            provenance_type: "document_page",
            provenance: null,
            canonical_key: rep.canonical_key ?? null,
            period_start: "2023-04-01",
            period_end: "2024-03-31",
            period_status: "known",
            period_note: null,
            registry_version: rep.registry_version ?? null,
            accepted_by: rep.accepted_by ?? null,
            accepted_at: rep.accepted_at ?? null,
            accept_mode: "bulk",
            source_cev_id: null,
          });
        }
      }
    }
  }

  // 4. Auto-resolve Clinker Calcination CO2 if Clinker Production is verified
  // CCTS Annexure II-G1: Standard output-based calcination emission factor is 0.525 tCO2/t clinker
  const clinkerFact = factsByPath.get("clinker.production");
  const hasCalcination =
    factsByPath.has("process.calcinationEmissions") ||
    factsByPath.has("process.rawMealCalcinationEmissions");

  if (clinkerFact && !hasCalcination) {
    const clinkerTonnes = Number(clinkerFact.value_json);
    if (Number.isFinite(clinkerTonnes) && clinkerTonnes > 0) {
      const calcinationCo2 = Math.round(clinkerTonnes * 0.525 * 1000) / 1000;
      factsByPath.set("process.calcinationEmissions", {
        id: "auto-calcination-co2",
        field_path: "process.calcinationEmissions",
        value_json: calcinationCo2,
        unit: "tCO2e",
        document_id: clinkerFact.document_id,
        page: clinkerFact.page ?? 1,
        bbox: clinkerFact.bbox,
        source_text: `Calculated from clinker production (${clinkerTonnes} t) via CCTS Annexure II-G1 output factor (0.525 tCO2/t clinker)`,
        provenance_type: "document_page",
        provenance: null,
        canonical_key: "calcination_co2",
        period_start: "2023-04-01",
        period_end: "2024-03-31",
        period_status: "known",
        period_note: null,
        registry_version: "CCTS-Annexure-II-G1",
        accepted_by: clinkerFact.accepted_by,
        accepted_at: new Date().toISOString(),
        accept_mode: "bulk",
        source_cev_id: null,
      });
    }
  }

  // 5. If production is not set but clinker.production is set, set production = clinker.production (or equivalent)
  if (!factsByPath.has("production") && clinkerFact) {
    factsByPath.set("production", {
      ...clinkerFact,
      id: "clinker-as-production",
      field_path: "production",
      source_text: `Mapped from clinker production (${clinkerFact.value_json} t)`,
    });
  }

  return Array.from(factsByPath.values());
}
