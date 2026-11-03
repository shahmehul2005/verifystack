/**
 * Cross-document checks for the verification-first pipeline.
 *
 * Each check takes numbers that were already read or mapped (a workbook cell,
 * a sum of daily rows, a PDF reading the auditor accepted) and returns a result
 * an auditor can read. None of them changes a fact, and none feeds a GEI run.
 * Thresholds are inputs. A caller that has no confirmed threshold must say so
 * in `thresholdSource`, and the result says so too.
 */

export type CheckStatus = "pass" | "fail" | "not_applicable";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  /** One sentence an auditor can read, with the numbers behind it. */
  detail: string;
  actual?: number;
  expected?: number;
  diff?: number;
  /** Where the threshold came from. Absent when the check has no threshold. */
  thresholdSource?: string;
}

/** Round to a fixed precision so decimal sums do not produce false diffs. */
function round(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : round(n, 3).toLocaleString("en-IN");
}

/**
 * Sum of parts must equal a target within a tolerance. `absTolerance` is in the
 * target's unit; `relTolerance` is a fraction of the target. The allowed band is
 * the larger of the two, so a one-decimal source can pass a relative band that
 * an exact comparison would fail.
 */
export function checkSumMatches(args: {
  id: string;
  label: string;
  parts: number[];
  target: number;
  absTolerance?: number;
  relTolerance?: number;
  thresholdSource?: string;
}): CheckResult {
  const sum = round(args.parts.reduce((a, b) => a + b, 0));
  const diff = round(sum - args.target);
  const band = Math.max(args.absTolerance ?? 0, (args.relTolerance ?? 0) * Math.abs(args.target));
  const pass = Math.abs(diff) <= band + 1e-9;
  return {
    id: args.id,
    label: args.label,
    status: pass ? "pass" : "fail",
    detail: `Parts sum to ${fmt(sum)}; target is ${fmt(args.target)}; difference ${fmt(diff)}. Allowed band ${fmt(round(band))}.`,
    actual: sum,
    expected: args.target,
    diff,
    ...(args.thresholdSource ? { thresholdSource: args.thresholdSource } : {}),
  };
}

/**
 * Pairwise agreement on the same days (for example DPR against SCADA). Fails if
 * any day differs by more than `relTolerance` of the reference value.
 */
export function checkDailyAgreement(args: {
  id: string;
  label: string;
  rows: { date: string; a: number; b: number }[];
  relTolerance: number;
  thresholdSource?: string;
}): CheckResult {
  const scored = args.rows.map((r) => {
    const rel = r.b === 0 ? (r.a === 0 ? 0 : Number.POSITIVE_INFINITY) : (r.a - r.b) / r.b;
    return { ...r, rel };
  });
  const bad = scored.filter((r) => Math.abs(r.rel) > args.relTolerance + 1e-12);
  const worst = scored.reduce((m, r) => (Math.abs(r.rel) > Math.abs(m.rel) ? r : m), scored[0]!);
  const pct = (x: number) => `${round(x * 100, 1)}%`;
  return {
    id: args.id,
    label: args.label,
    status: bad.length === 0 ? "pass" : "fail",
    detail:
      `${scored.length} day(s) compared. ${bad.length} outside ±${pct(args.relTolerance)}. ` +
      `Largest difference ${pct(worst.rel)} on ${worst.date} (${fmt(worst.a)} vs ${fmt(worst.b)}).`,
    actual: worst.a,
    expected: worst.b,
    diff: round(worst.a - worst.b),
    ...(args.thresholdSource ? { thresholdSource: args.thresholdSource } : {}),
  };
}

/**
 * Opening + production + import − export − closing. The identity has an outflow
 * on the left. It can only pass or fail against a consumption figure. Without
 * one it reports the implied outflow and is not applicable.
 */
export function checkMassBalance(args: {
  opening: number;
  production: number;
  imports: number;
  exports: number;
  closing: number;
  /** Clinker consumed in cement grinding. Supply it from an accepted source. */
  consumed?: number;
  absTolerance?: number;
  relTolerance?: number;
  thresholdSource?: string;
}): CheckResult {
  const outflow = round(args.opening + args.production + args.imports - args.exports - args.closing);
  if (args.consumed === undefined) {
    return {
      id: "mass_balance",
      label: "Clinker mass balance",
      status: "not_applicable",
      detail: `Opening + production + import − export − closing leaves ${fmt(outflow)} t unaccounted. The identity needs a consumption figure to close against, so it cannot pass or fail on its own.`,
      actual: outflow,
    };
  }
  const inner = checkSumMatches({
    id: "mass_balance",
    label: "Clinker mass balance",
    parts: [outflow],
    target: args.consumed,
    ...(args.absTolerance !== undefined ? { absTolerance: args.absTolerance } : {}),
    ...(args.relTolerance !== undefined ? { relTolerance: args.relTolerance } : {}),
    ...(args.thresholdSource ? { thresholdSource: args.thresholdSource } : {}),
  });
  return { ...inner, detail: `Implied outflow ${fmt(outflow)} t against consumed ${fmt(args.consumed)} t. ${inner.detail}` };
}

/** Clinker consumed in grinding, from cement output and each cement type's clinker factor. */
export function clinkerConsumedForCement(
  lines: { label: string; tonnes: number; clinkerFactor: number }[]
): { total: number; lines: { label: string; clinker: number }[] } {
  const detail = lines.map((l) => ({ label: l.label, clinker: round(l.tonnes * l.clinkerFactor) }));
  return { total: round(detail.reduce((a, b) => a + b.clinker, 0)), lines: detail };
}

/**
 * An annual figure can only be evidenced by as many months as the period has.
 * Twelve months of evidence for a 12-month period; one month is a gap, however
 * closely the annual figure matches monthly × 12.
 *
 * Counting months is not enough on its own, so the check also fails when:
 *  - the evidence runs past the period, because rows outside it would sit in the total;
 *  - a month is thin (`thinMonths`), because a few rows do not evidence a month;
 *  - the period is fully evidenced but the evidenced total is not the annual cell
 *    within `relTolerance`. `monthlyReading` is the total of the evidenced rows.
 */
export function checkEvidenceCoverage(args: {
  id: string;
  label: string;
  monthsEvidenced: number;
  periodMonths: number;
  annualCell: number;
  monthlyReading: number;
  /** Months (YYYY-MM) with far fewer rows than the series' typical month. */
  thinMonths?: string[];
  /** Band for the evidenced total against the annual cell. Without it the totals are not compared. */
  relTolerance?: number;
  thresholdSource?: string;
}): CheckResult {
  const annualised = round(args.monthlyReading * args.periodMonths);
  const matchesMonthly = Math.abs(annualised - args.annualCell) <= Math.abs(args.annualCell) * 0.0005;
  const thin = args.thinMonths ?? [];
  const short = args.monthsEvidenced < args.periodMonths;
  const over = args.monthsEvidenced > args.periodMonths;
  const total = round(args.monthlyReading - args.annualCell);
  const band = args.relTolerance === undefined ? null : args.relTolerance * Math.abs(args.annualCell);
  const totalOff = !short && !over && band !== null && Math.abs(total) > band + 1e-9;
  const problems: string[] = [];
  if (over) {
    problems.push(
      `The evidence spans ${args.monthsEvidenced} months, more than the ${args.periodMonths}-month period, so rows outside the period may be in the total.`
    );
  }
  if (thin.length > 0) {
    problems.push(`${thin.length} month(s) have far fewer rows than the rest (${thin.slice(0, 4).join(", ")}${thin.length > 4 ? ", ..." : ""}), so they are not fully evidenced.`);
  }
  if (totalOff) {
    problems.push(`The evidenced total ${fmt(args.monthlyReading)} is not the annual cell ${fmt(args.annualCell)}: difference ${fmt(total)}, allowed band ${fmt(round(band!))}.`);
  }
  return {
    id: args.id,
    label: args.label,
    status: short || problems.length > 0 ? "fail" : "pass",
    detail:
      `Annual cell ${fmt(args.annualCell)} is backed by ${args.monthsEvidenced} of ${args.periodMonths} month(s) of evidence. ` +
      (matchesMonthly
        ? `It equals one month × ${args.periodMonths} (${fmt(annualised)}), so the annual figure is a single month scaled up.`
        : `One month × ${args.periodMonths} is ${fmt(annualised)}.`) +
      (problems.length > 0 ? ` ${problems.join(" ")}` : ""),
    actual: args.monthsEvidenced,
    expected: args.periodMonths,
    ...(args.thresholdSource ? { thresholdSource: args.thresholdSource } : {}),
  };
}

/**
 * Internal lab GCV against the NABL external result. If the gap exceeds the
 * threshold, the corrected (external) GCV must be the value in the workbook. If
 * not, the internal figure stands. The threshold is an input and the caller
 * names its source.
 */
export function checkGcvRule(args: {
  internal: number;
  external: number;
  cell: number;
  thresholdKcal: number;
  thresholdSource: string;
  /**
   * Rounding band on the workbook cell, kcal/kg. Lab results are reported to the
   * whole unit, so a cell of 4,230.3 against 4,230 is rounding, not a different
   * value. Default 0 compares exactly.
   */
  roundingKcal?: number;
}): CheckResult {
  const dev = round(Math.abs(args.external - args.internal));
  const exceeds = dev > args.thresholdKcal;
  const expected = exceeds ? args.external : args.internal;
  const ok = Math.abs(args.cell - expected) <= (args.roundingKcal ?? 0) + 1e-9;
  return {
    id: "gcv_nabl_rule",
    label: "GCV: internal vs NABL correction",
    status: ok ? "pass" : "fail",
    detail:
      `Internal ${fmt(args.internal)}, NABL ${fmt(args.external)}, deviation ${fmt(dev)} kcal/kg against ±${fmt(args.thresholdKcal)}. ` +
      (exceeds
        ? `Threshold exceeded, so the workbook must hold the NABL value ${fmt(expected)}; it holds ${fmt(args.cell)}.`
        : `Within threshold, so the workbook holds the internal value ${fmt(expected)}; it holds ${fmt(args.cell)}.`),
    actual: args.cell,
    expected,
    diff: round(args.cell - expected),
    thresholdSource: args.thresholdSource,
  };
}

/**
 * A day with no output needs a DOWN status. Output on a DOWN day is also a
 * contradiction, reported separately.
 */
export function checkProductionDays(rows: { date: string; tonnes: number; status: string }[]): CheckResult {
  const isDown = (s: string) => /^\s*DOWN/i.test(s);
  const zeroNotDown = rows.filter((r) => r.tonnes === 0 && !isDown(r.status));
  const downWithOutput = rows.filter((r) => isDown(r.status) && r.tonnes > 0);
  const problems = zeroNotDown.length + downWithOutput.length;
  const parts: string[] = [`${rows.length} day(s) checked.`];
  if (zeroNotDown.length) parts.push(`${zeroNotDown.length} zero-output day(s) without a DOWN status: ${zeroNotDown.map((r) => r.date).join(", ")}.`);
  if (downWithOutput.length) parts.push(`${downWithOutput.length} DOWN day(s) with output: ${downWithOutput.map((r) => `${r.date} (${fmt(r.tonnes)} t)`).join(", ")}.`);
  if (problems === 0) parts.push("Every zero-output day is marked DOWN and no DOWN day has output.");
  return {
    id: "production_days",
    label: "Zero-output days and DOWN status",
    status: problems === 0 ? "pass" : "fail",
    detail: parts.join(" "),
    actual: problems,
    expected: 0,
  };
}

/**
 * Petcoke with no workbook cell has nowhere to be counted. It must not be added
 * to the coal line. A finding, not a number.
 */
export function checkUnmappedFuel(args: {
  id: string;
  label: string;
  tonnes: number;
  workbookHasCell: boolean;
}): CheckResult {
  const gap = args.tonnes > 0 && !args.workbookHasCell;
  return {
    id: args.id,
    label: args.label,
    status: gap ? "fail" : "pass",
    detail: gap
      ? `${fmt(args.tonnes)} t logged, but the pro forma has no cell for this fuel. It is not counted into any other line.`
      : args.tonnes > 0
        ? `${fmt(args.tonnes)} t logged and the pro forma has a cell for it.`
        : "No quantity logged.",
    actual: args.tonnes,
  };
}

/**
 * A renewable claim needs an exclusion in the workbook. REC purchases alone are
 * not a claim under the CCTS procedure (p.14, 4(12)(iii)).
 */
export function checkRenewableClaim(args: {
  renewableClaimMwh: number;
  recPurchasesMwh: number;
  workbookHasExclusion: boolean;
}): CheckResult {
  const claimed = args.renewableClaimMwh > 0;
  const ok = !claimed || args.workbookHasExclusion;
  return {
    id: "renewable_claim",
    label: "Renewable claim exclusion",
    status: ok ? "pass" : "fail",
    detail: claimed
      ? args.workbookHasExclusion
        ? `Renewable claim of ${fmt(args.renewableClaimMwh)} MWh has a matching exclusion in the workbook.`
        : `Renewable claim of ${fmt(args.renewableClaimMwh)} MWh with no exclusion in the workbook. The grid figure would count it.`
      : `No renewable claim. ${fmt(args.recPurchasesMwh)} MWh of RECs purchased is not a claim under the procedure.`,
    actual: args.renewableClaimMwh,
    expected: 0,
    thresholdSource: "CCTS Detailed Procedure p.14, 4(12)(iii)",
  };
}

/**
 * Every green (formula) cell in the template must still hold a formula. A
 * typed-over formula is a finding. The template is a clean copy, not the file
 * under review.
 */
export function checkFormulaIntegrity(args: {
  template: Map<string, string>;
  submitted: Map<string, { formula: string | null; value: unknown }>;
}): CheckResult {
  const broken: string[] = [];
  for (const [ref, formula] of args.template) {
    const s = args.submitted.get(ref);
    if (!s || s.formula !== formula) broken.push(ref);
  }
  return {
    id: "formula_integrity",
    label: "Formula cells still formulas",
    status: broken.length === 0 ? "pass" : "fail",
    detail:
      broken.length === 0
        ? `All ${args.template.size} formula cell(s) in the template are still formulas.`
        : `${broken.length} formula cell(s) overwritten or changed: ${broken.slice(0, 12).join(", ")}${broken.length > 12 ? " …" : ""}.`,
    actual: broken.length,
    expected: 0,
  };
}

/** Form 1 field against the value recomputed from accepted inputs. */
export function checkRecomputed(args: {
  id: string;
  label: string;
  claimed: number;
  recomputed: number;
  relTolerance: number;
  thresholdSource?: string;
}): CheckResult {
  return checkSumMatches({
    id: args.id,
    label: args.label,
    parts: [args.recomputed],
    target: args.claimed,
    relTolerance: args.relTolerance,
    ...(args.thresholdSource ? { thresholdSource: args.thresholdSource } : {}),
  });
}
