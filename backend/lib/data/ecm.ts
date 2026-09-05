import "server-only";

/**
 * Load the ECM library and produce suggestions for one engagement.
 *
 * Matching is deterministic (pack bindings + intensity gap + library rows).
 * Optional Gemini styling runs only after a row has already been selected, and
 * is discarded unless it stays grounded. This module talks to Postgres; it does
 * not invent library rows.
 */

import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import type { ProvenancedFact } from "@verifystack/backend/domain/calc/run";
import type { CalcResult } from "@verifystack/backend/domain/calc/engine";
import type { SecResult } from "@verifystack/backend/domain/calc/sec";
import { ADEETIE_MIN_SAVINGS_PCT } from "@verifystack/backend/domain/calc/sec";
import { loadPack } from "@verifystack/backend/domain/packs";
import { deriveEquipmentTags } from "@verifystack/backend/domain/ecm/equipment";
import { gapFromGeiResult, gapFromSecRuns } from "@verifystack/backend/domain/ecm/gap";
import { matchEcmLibrary } from "@verifystack/backend/domain/ecm/match";
import { styleEcmRow } from "@verifystack/backend/domain/ecm/style";
import {
  ECM_LIBRARY_PRODUCTION_READY,
  ECM_NO_MATCH_MESSAGE,
  type EcmLibraryRow,
  type EcmSuggestionsPayload,
  type EcmSuggestionView,
  type IntensityGap,
} from "@verifystack/backend/domain/ecm/types";
import { getEngagement } from "./engagements";

interface LooseResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface EcmLibraryDbRow {
  id: string;
  scheme: string | null;
  sector_or_cluster: string;
  equipment_tag: string;
  ecm_name: string;
  description: string;
  typical_savings_range: string | null;
  typical_payback_months: number | null;
  source_reference: string;
  source_url: string | null;
}

/**
 * `ecm_library` arrives with migration 0011 and is not described by the
 * hand-written Database types in lib/supabase/types.ts.
 */
interface LooseDb {
  from(table: string): {
    select(columns: string): PromiseLike<LooseResult<EcmLibraryDbRow[]>>;
  };
}

function mapDbRow(row: EcmLibraryDbRow): EcmLibraryRow {
  return {
    id: row.id,
    scheme: row.scheme,
    sectorOrCluster: row.sector_or_cluster,
    equipmentTag: row.equipment_tag,
    ecmName: row.ecm_name,
    description: row.description,
    typicalSavingsRange: row.typical_savings_range,
    typicalPaybackMonths: row.typical_payback_months,
    sourceReference: row.source_reference,
    sourceUrl: row.source_url,
  };
}


function isSecResult(value: unknown): value is SecResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SecResult>;
  return (
    typeof v.secEngineVersion === "string" &&
    typeof v.sec === "number" &&
    (v.phase === "baseline" || v.phase === "post_implementation")
  );
}

function isGeiResult(value: unknown): value is CalcResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<CalcResult>;
  return typeof v.gei === "number" && typeof v.engineVersion === "string";
}

async function dataClient() {
  return createServiceClient() ?? (await createServerSupabase());
}

async function loadLibraryRows(): Promise<EcmLibraryRow[]> {
  const supabase = await dataClient();
  if (!supabase) return [];
  const { data, error } = await (supabase as unknown as LooseDb)
    .from("ecm_library")
    .select("*");
  if (error || !data?.length) return [];
  return data.map(mapDbRow);
}

function toView(args: {
  row: EcmLibraryRow;
  relevance: number;
  matchedTags: string[];
  presentation: EcmSuggestionView["presentation"];
  sentence: string | null;
  styled: boolean;
}): EcmSuggestionView {
  return {
    id: args.row.id,
    ecmName: args.row.ecmName,
    description: args.row.description,
    typicalSavingsRange: args.row.typicalSavingsRange,
    typicalPaybackMonths: args.row.typicalPaybackMonths,
    equipmentTag: args.row.equipmentTag,
    sectorOrCluster: args.row.sectorOrCluster,
    sourceReference: args.row.sourceReference,
    sourceUrl: args.row.sourceUrl,
    presentation: args.presentation,
    sentence: args.sentence,
    styled: args.styled,
    relevance: args.relevance,
    matchedTags: args.matchedTags,
  };
}

export async function suggestEcmsForEngagement(
  engagementId: string,
  organizationId: string,
  opts?: { style?: boolean }
): Promise<EcmSuggestionsPayload | null> {
  const engagement = await getEngagement(engagementId, organizationId);
  if (!engagement) return null;

  const pack = loadPack(engagement.pack_id);
  const supabase = await dataClient();

  let facts: Pick<ProvenancedFact, "field_path">[] = [];
  let gap: IntensityGap | null = null;

  if (supabase) {
    const [{ data: factRows }, { data: runRows }] = await Promise.all([
      supabase
        .from("facts")
        .select("field_path")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId),
      supabase
        .from("calculation_runs")
        .select("result, created_at")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);
    facts = (factRows ?? []).map((f) => ({ field_path: f.field_path }));

    if (pack.calculation_method === "SEC") {
      let baselineSec: number | undefined;
      let postSec: number | undefined;
      for (const row of runRows ?? []) {
        const result = row.result;
        if (!isSecResult(result)) continue;
        if (result.phase === "baseline" && baselineSec === undefined) {
          baselineSec = result.sec;
        }
        if (result.phase === "post_implementation" && postSec === undefined) {
          postSec = result.sec;
        }
      }
      if (baselineSec !== undefined) {
        gap = gapFromSecRuns({
          baselineSec,
          postSec,
          minSavingsPct: pack.sec_config?.minSavingsPct ?? ADEETIE_MIN_SAVINGS_PCT,
        });
      }
    } else {
      for (const row of runRows ?? []) {
        if (!isGeiResult(row.result)) continue;
        gap = gapFromGeiResult(row.result);
        break;
      }
    }
  }

  const equipmentTags = deriveEquipmentTags(pack, facts);
  const library = await loadLibraryRows();
  const matched = matchEcmLibrary(
    {
      sectorOrCluster: pack.sector_or_cluster,
      scheme: pack.scheme,
      equipmentTags,
      gapPct: gap?.gapPct ?? null,
    },
    library
  );

  const shouldStyle = opts?.style !== false && matched.status === "matched";
  const suggestions: EcmSuggestionView[] = [];
  for (const ranked of matched.ranked) {
    const styled = shouldStyle ? await styleEcmRow(ranked.row) : {
      row: ranked.row,
      presentation: "raw_row" as const,
      sentence: null,
      styled: false,
      generator: "none" as const,
    };
    suggestions.push(
      toView({
        row: ranked.row,
        relevance: ranked.relevance,
        matchedTags: ranked.matchedTags,
        presentation: styled.presentation,
        sentence: styled.sentence,
        styled: styled.styled,
      })
    );
  }

  return {
    productionReady: ECM_LIBRARY_PRODUCTION_READY,
    libraryKind: "database",
    notice: null,
    matchStatus: matched.status,
    noMatchMessage: matched.status === "no_match" ? ECM_NO_MATCH_MESSAGE : null,
    equipmentTags,
    gap,
    suggestions,
  };
}
