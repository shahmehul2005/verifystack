import {
  ADEETIE_MIN_SAVINGS_PCT,
  assessSavings,
  type SavingsAssessment,
  type SecResult,
} from "@verifystack/backend/domain/calc/sec";

/**
 * A calculation_runs row as the hand-written Database types describe it. SEC runs
 * live in the same table as GEI runs (migration 0003), and the promoted SEC
 * scalar columns are not in `lib/supabase/types.ts` yet, so the SEC projection is
 * read back out of the `result` jsonb instead of off the columns.
 */
export interface RunRow {
  id: string;
  created_at: string;
  draft_mode: boolean;
  engine_version: string;
  factor_set_version: string;
  input_hash: string;
  pack_id: string;
  pack_version: string;
  result: unknown;
}

export interface SecRun {
  row: RunRow;
  result: SecResult;
}

function isSecResult(value: unknown): value is SecResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SecResult>;
  return (
    typeof v.secEngineVersion === "string" &&
    typeof v.sec === "number" &&
    Array.isArray(v.streams) &&
    (v.phase === "baseline" || v.phase === "post_implementation")
  );
}

export interface SecRunSet {
  runs: SecRun[];
  baseline: SecRun | null;
  post: SecRun | null;
}

/** Newest-first rows in, latest run per phase out. */
export function pickSecRuns(rows: RunRow[]): SecRunSet {
  const runs: SecRun[] = [];
  for (const row of rows) {
    if (isSecResult(row.result)) runs.push({ row, result: row.result });
  }
  return {
    runs,
    baseline: runs.find((r) => r.result.phase === "baseline") ?? null,
    post: runs.find((r) => r.result.phase === "post_implementation") ?? null,
  };
}

export type SavingsOutcome =
  | { kind: "ok"; assessment: SavingsAssessment }
  | { kind: "missing"; reason: string }
  | { kind: "refused"; reason: string };

/**
 * `assessSavings` throws rather than normalising a comparison it cannot make.
 * The screen has to show that refusal, so it is caught and carried as data.
 */
export function safeAssessSavings(
  set: SecRunSet,
  thresholdPct: number = ADEETIE_MIN_SAVINGS_PCT
): SavingsOutcome {
  if (!set.baseline && !set.post) {
    return {
      kind: "missing",
      reason: "No SEC run has been recorded, so the savings gate cannot be evaluated.",
    };
  }
  if (!set.baseline) {
    return {
      kind: "missing",
      reason:
        "A post-implementation SEC exists but no baseline SEC. The savings percentage is measured against the baseline, so it cannot be computed.",
    };
  }
  if (!set.post) {
    return {
      kind: "missing",
      reason:
        "A baseline SEC exists but no post-implementation SEC. The savings gate is evaluated at M&V, after implementation.",
    };
  }
  try {
    return {
      kind: "ok",
      assessment: assessSavings(set.baseline.result, set.post.result, thresholdPct),
    };
  } catch (e) {
    return { kind: "refused", reason: e instanceof Error ? e.message : "Comparison refused." };
  }
}

export { ADEETIE_MIN_SAVINGS_PCT };
