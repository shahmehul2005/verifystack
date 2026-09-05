/**
 * Deterministic ECM matching. No LLM, no network, no improvisation.
 *
 * Filter library rows by sector_or_cluster + equipment_tag (and scheme when the
 * row declares one). Rank by how close the facility intensity gap sits to the
 * row's typical_savings_range. An empty filter result is an explicit no-match.
 */

import {
  ECM_NO_MATCH_MESSAGE,
  type EcmLibraryRow,
  type EcmMatchInput,
  type EcmMatchResult,
  type RankedEcm,
} from "./types";

export interface SavingsRange {
  min: number;
  max: number;
}

/**
 * Parse strings such as "5-12% of related SEC", "8%", "10–20 percent".
 * Returns null when no numeric range can be read — those rows still match on
 * tags, but rank last.
 */
export function parseSavingsRange(text: string | null | undefined): SavingsRange | null {
  if (!text) return null;
  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const finite = numbers.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return null;
  if (finite.length === 1) return { min: finite[0]!, max: finite[0]! };
  const min = Math.min(finite[0]!, finite[1]!);
  const max = Math.max(finite[0]!, finite[1]!);
  return { min, max };
}

/**
 * Distance from the facility gap to the savings range. In-range distances are
 * scaled down so any in-range row beats any out-of-range row, while still
 * preferring the midpoint when several rows cover the gap.
 */
export function relevanceDistance(gapPct: number | null, range: SavingsRange | null): number {
  if (gapPct === null || range === null) return Number.POSITIVE_INFINITY;
  const mid = (range.min + range.max) / 2;
  if (gapPct >= range.min && gapPct <= range.max) {
    return Math.abs(gapPct - mid) * 0.1;
  }
  if (gapPct < range.min) return range.min - gapPct;
  return gapPct - range.max;
}

function tagSet(tags: readonly string[]): Set<string> {
  return new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
}

function rowMatches(
  row: EcmLibraryRow,
  input: EcmMatchInput,
  tags: Set<string>
): string[] {
  if (row.sectorOrCluster.trim().toLowerCase() !== input.sectorOrCluster.trim().toLowerCase()) {
    return [];
  }
  if (row.scheme && input.scheme && row.scheme !== input.scheme) {
    return [];
  }
  const tag = row.equipmentTag.trim().toLowerCase();
  if (!tags.has(tag)) return [];
  return [row.equipmentTag];
}

export function matchEcmLibrary(
  input: EcmMatchInput,
  library: readonly EcmLibraryRow[]
): EcmMatchResult {
  const tags = tagSet(input.equipmentTags);
  if (tags.size === 0) {
    return { status: "no_match", message: ECM_NO_MATCH_MESSAGE, ranked: [] };
  }

  const ranked: RankedEcm[] = [];
  for (const row of library) {
    const matchedTags = rowMatches(row, input, tags);
    if (matchedTags.length === 0) continue;
    ranked.push({
      row,
      matchedTags,
      relevance: relevanceDistance(input.gapPct, parseSavingsRange(row.typicalSavingsRange)),
    });
  }

  ranked.sort((a, b) => {
    if (a.relevance !== b.relevance) return a.relevance - b.relevance;
    return a.row.ecmName.localeCompare(b.row.ecmName);
  });

  if (ranked.length === 0) {
    return { status: "no_match", message: ECM_NO_MATCH_MESSAGE, ranked: [] };
  }

  return { status: "matched", message: null, ranked };
}
