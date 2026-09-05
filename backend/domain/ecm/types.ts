/**
 * ECM recommendation types.
 *
 * Matching is deterministic. The only generative step is optional styling of a
 * matched row's own fields, which is discarded unless it stays grounded.
 */

/**
 * Library rows are loaded from `ecm_library`. Matching stays deterministic;
 * groundedness still rejects styled text that adds facts not on the row.
 */
export const ECM_LIBRARY_PRODUCTION_READY = true;

export const ECM_NO_MATCH_MESSAGE = "no matching ECM in library";

export const ECM_LIBRARY_ESCALATION = {
  productionReady: ECM_LIBRARY_PRODUCTION_READY,
  bannerTitle: "Synthetic library — not for production decisions",
  bannerBody:
    "ecm_library is not production-seeded. The rows shown are a SYNTHETIC fixture " +
    "for tests and demo only. They are not BEE-published measures and must not be " +
    "used to choose, cost, or implement an intervention. Enable this feature in " +
    "production only after a domain advisor loads the library from a real BEE " +
    "published ECM guide.",
} as const;

export interface EcmLibraryRow {
  id: string;
  scheme: string | null;
  sectorOrCluster: string;
  equipmentTag: string;
  ecmName: string;
  description: string;
  typicalSavingsRange: string | null;
  typicalPaybackMonths: number | null;
  sourceReference: string;
  sourceUrl: string | null;
}

export interface IntensityGap {
  metric: "SEC" | "GEI";
  facilityValue: number;
  benchmarkValue: number;
  /**
   * Positive means the facility is worse than the benchmark, expressed as a
   * percentage of the facility value. Used only to rank library rows.
   */
  gapPct: number;
}

export interface EcmMatchInput {
  sectorOrCluster: string;
  scheme?: string | null;
  equipmentTags: string[];
  gapPct: number | null;
}

export interface RankedEcm {
  row: EcmLibraryRow;
  /** Lower is more relevant. In-range rows beat out-of-range rows. */
  relevance: number;
  matchedTags: string[];
}

export type EcmMatchStatus = "matched" | "no_match";

export interface EcmMatchResult {
  status: EcmMatchStatus;
  /** Set to ECM_NO_MATCH_MESSAGE when status is no_match. Never an improvised measure. */
  message: string | null;
  ranked: RankedEcm[];
}

export type EcmPresentation = "styled" | "raw_row";

export interface StyledEcm {
  row: EcmLibraryRow;
  presentation: EcmPresentation;
  /** Present only when presentation is "styled" and the sentence passed the gate. */
  sentence: string | null;
  styled: boolean;
  generator: "gemini" | "none";
  model?: string;
}

export type EcmLibraryKind = "synthetic_fixture" | "database";

export interface EcmSuggestionView {
  id: string;
  ecmName: string;
  description: string;
  typicalSavingsRange: string | null;
  typicalPaybackMonths: number | null;
  equipmentTag: string;
  sectorOrCluster: string;
  sourceReference: string;
  sourceUrl: string | null;
  presentation: EcmPresentation;
  sentence: string | null;
  styled: boolean;
  relevance: number;
  matchedTags: string[];
}

export interface EcmSuggestionsPayload {
  productionReady: boolean;
  libraryKind: EcmLibraryKind;
  notice: { title: string; body: string } | null;
  matchStatus: EcmMatchStatus;
  noMatchMessage: string | null;
  equipmentTags: string[];
  gap: IntensityGap | null;
  suggestions: EcmSuggestionView[];
}

