/**
 * Deterministic intensity gap vs the sector / scheme benchmark.
 *
 * GEI: notified `geiTarget` on the engagement is the benchmark.
 * SEC: packs in this repo do not store a published sector SEC. The scheme
 * minimum-savings gate applied to the baseline SEC is used as the implied
 * benchmark (baseline × (1 − minSavingsPct/100)). Code computes; no LLM.
 */

import type { IntensityGap } from "./types";

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function gapPct(facility: number, benchmark: number): number | null {
  if (!(facility > 0) || !Number.isFinite(facility) || !Number.isFinite(benchmark)) {
    return null;
  }
  return round(((facility - benchmark) / facility) * 100);
}

export function impliedSecBenchmark(baselineSec: number, minSavingsPct: number): number {
  return baselineSec * (1 - minSavingsPct / 100);
}

export function gapFromGeiResult(result: {
  gei: number;
  geiTarget?: number;
}): IntensityGap | null {
  if (typeof result.geiTarget !== "number" || !Number.isFinite(result.geiTarget)) {
    return null;
  }
  const pct = gapPct(result.gei, result.geiTarget);
  if (pct === null) return null;
  return {
    metric: "GEI",
    facilityValue: result.gei,
    benchmarkValue: result.geiTarget,
    gapPct: pct,
  };
}

export function gapFromSecRuns(opts: {
  baselineSec: number;
  postSec?: number;
  minSavingsPct: number;
}): IntensityGap | null {
  if (!(opts.baselineSec > 0)) return null;
  const facility = opts.postSec ?? opts.baselineSec;
  const benchmark = impliedSecBenchmark(opts.baselineSec, opts.minSavingsPct);
  const pct = gapPct(facility, benchmark);
  if (pct === null) return null;
  return {
    metric: "SEC",
    facilityValue: facility,
    benchmarkValue: benchmark,
    gapPct: pct,
  };
}
