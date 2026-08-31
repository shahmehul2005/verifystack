/**
 * ADEETIE reconciliation and eligibility rules.
 *
 * Same discipline as rules.ts: deterministic, no clock, no network, and every
 * finding is a factual statement about what was observed. A rule never concludes
 * that an application should be rejected — it states that a gate is not met and
 * cites the clause. The decision is a human's.
 *
 * Two groups:
 *   AD-EB / AD-TS / AD-CAL / AD-SEC  — data quality on the energy baseline
 *   AD-SAV / AD-ELG*                 — the scheme's money gates
 *
 * Clause references are marked TO VERIFY throughout. None has been checked
 * line-by-line against the operative ADEETIE scheme guidelines.
 */

import { convert } from "../units";
import {
  ADEETIE_CLAUSE_REFS,
  CLUSTER_PROXIMITY_KM,
  LOAN_MAX_INR,
  LOAN_MIN_INR,
  MAX_DEBT_FUNDING_PCT,
  MIN_ENERGY_SAVINGS_PCT,
  SUBVENTION_PCT,
  computeSubvention,
  formatINR,
  isAdeetieSector,
  isNotifiedCluster,
  type EnterpriseCategory,
} from "../packs/adeetie";
import type { SavingsAssessment, SecResult } from "../calc/sec";
import type { RuleFinding, Severity } from "./types";

/** Meter or instrument whose calibration underpins the baseline. */
export interface MeterCalibration {
  meterId: string;
  description: string;
  /** ISO date the calibration certificate was issued. */
  calibratedOn?: string;
  /** ISO date the calibration expires. */
  validUntil?: string;
  /** ISO date range the meter's readings are relied on for. */
  reliedOnFrom: string;
  reliedOnTo: string;
  factIds: string[];
}

/**
 * A month of the baseline or M&V year, from the enterprise's own records.
 * `billedEnergyMJ` is what the utility invoiced; `meteredEnergyMJ` is what the
 * plant's own sub-meters recorded. The gap between them is the energy balance.
 */
export interface EnergyBalanceMonth {
  month: string;
  billedEnergyMJ: number;
  meteredEnergyMJ?: number;
  factIds: string[];
}

export interface AdeetieEligibilityInput {
  enterpriseName: string;
  category: EnterpriseCategory;
  /** Udyam registration number as printed on the certificate, if held. */
  udyamRegistrationNo?: string;
  sector: string;
  /** Cluster the enterprise claims to operate in. */
  cluster: string;
  /**
   * Distance to the nearest notified cluster boundary in km, as claimed by the
   * applicant. Only relevant when the cluster itself is not notified.
   */
  claimedDistanceToClusterKm?: number;
  loanAmountINR: number;
  projectCostINR: number;
  sanctionedRatePct?: number;
  /** Subvention percentage the application claims. */
  claimedSubventionPct?: number;
  factIds: string[];
}

export interface AdeetieContext {
  /** e.g. "FY2024-25". */
  baselinePeriodLabel: string;
  /** Months a complete baseline year must contain, in ISO "YYYY-MM" form. */
  expectedMonths: string[];
  baselineSec?: SecResult;
  postSec?: SecResult;
  savings?: SavingsAssessment;
  energyBalance: EnergyBalanceMonth[];
  meterCalibrations: MeterCalibration[];
  eligibility?: AdeetieEligibilityInput;
  /** Tolerance for energy balance closure, as a percentage. */
  energyBalanceTolerancePct?: number;
  /**
   * Plausible SEC band for the sector, in the pack's reporting unit per unit of
   * output. Absent means the check is skipped rather than guessed.
   */
  secPlausibleRange?: { min: number; max: number };
}

export interface AdeetieRule {
  id: string;
  title: string;
  clauseRef: string;
  run(ctx: AdeetieContext): RuleFinding[];
}

function pct(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return ((a - b) / b) * 100;
}

/**
 * AD-EB001 — billed energy and metered energy must reconcile.
 *
 * A gap means either a sub-meter is missing a load or the billed figure includes
 * something outside the audit boundary. Either way the baseline SEC denominator
 * and numerator are not describing the same system.
 */
export const energyBalanceClosureRule: AdeetieRule = {
  id: "AD-EB001",
  title: "Billed energy does not reconcile with metered energy",
  clauseRef: ADEETIE_CLAUSE_REFS.energyBalance,
  run(ctx) {
    const tolerance = ctx.energyBalanceTolerancePct ?? 3;
    const findings: RuleFinding[] = [];

    const withMetered = ctx.energyBalance.filter(
      (m) => typeof m.meteredEnergyMJ === "number"
    );
    if (withMetered.length === 0) {
      if (ctx.energyBalance.length > 0) {
        findings.push({
          ruleId: this.id,
          severity: "warn",
          title: "No metered energy recorded to reconcile against billed energy",
          detail:
            `${ctx.energyBalance.length} month(s) of billed energy are recorded but no month carries a ` +
            `metered figure, so the energy balance cannot be closed. The baseline rests on the utility ` +
            `invoice alone.`,
          clauseRef: this.clauseRef,
          evidenceRefs: ctx.energyBalance.flatMap((m) => m.factIds),
        });
      }
      return findings;
    }

    const billedTotal = withMetered.reduce((a, m) => a + m.billedEnergyMJ, 0);
    const meteredTotal = withMetered.reduce((a, m) => a + (m.meteredEnergyMJ ?? 0), 0);
    const gapPct = pct(meteredTotal, billedTotal);

    if (Math.abs(gapPct) > tolerance) {
      findings.push({
        ruleId: this.id,
        severity: Math.abs(gapPct) > tolerance * 3 ? "block" : "warn",
        title: this.title,
        detail:
          `Across ${withMetered.length} month(s), billed energy totals ${billedTotal.toFixed(0)} MJ and ` +
          `metered energy totals ${meteredTotal.toFixed(0)} MJ, a difference of ` +
          `${(meteredTotal - billedTotal).toFixed(0)} MJ (${gapPct.toFixed(2)}%) against a tolerance of ` +
          `${tolerance}%. Either a load is unmetered or the billed figure covers loads outside the audit boundary.`,
        clauseRef: this.clauseRef,
        evidenceRefs: withMetered.flatMap((m) => m.factIds),
        magnitude: { value: Number(gapPct.toFixed(3)), unit: "%" },
      });
    }

    for (const m of withMetered) {
      const monthGap = pct(m.meteredEnergyMJ ?? 0, m.billedEnergyMJ);
      if (Math.abs(monthGap) > tolerance * 5) {
        findings.push({
          ruleId: this.id,
          severity: "warn",
          title: "Single-month energy balance gap far exceeds tolerance",
          detail:
            `${m.month}: billed ${m.billedEnergyMJ.toFixed(0)} MJ against metered ` +
            `${(m.meteredEnergyMJ ?? 0).toFixed(0)} MJ (${monthGap.toFixed(2)}%). A gap concentrated in one ` +
            `month usually indicates a meter outage or a reading transposition rather than an unmetered load.`,
          clauseRef: this.clauseRef,
          evidenceRefs: m.factIds,
          magnitude: { value: Number(monthGap.toFixed(3)), unit: "%" },
        });
      }
    }

    return findings;
  },
};

/**
 * AD-TS001 — the baseline year must be complete.
 *
 * A missing month understates annual energy. If output for that month is still
 * counted, SEC is understated and the savings percentage at M&V is overstated.
 */
export const baselineCompletenessRule: AdeetieRule = {
  id: "AD-TS001",
  title: "Baseline year is incomplete",
  clauseRef:
    "BEE General Guidelines for Energy Audit — a baseline year must be complete (TO VERIFY)",
  run(ctx) {
    if (ctx.expectedMonths.length === 0) return [];
    const present = new Set(ctx.energyBalance.map((m) => m.month));
    const missing = ctx.expectedMonths.filter((m) => !present.has(m));
    if (missing.length === 0) return [];

    return [
      {
        ruleId: this.id,
        severity: "block",
        title: this.title,
        detail:
          `The ${ctx.baselinePeriodLabel} baseline is missing energy data for ${missing.length} of ` +
          `${ctx.expectedMonths.length} month(s): ${missing.join(", ")}. Annual energy derived from this ` +
          `series understates actual consumption, which understates the baseline SEC and overstates any ` +
          `savings measured against it.`,
        clauseRef: this.clauseRef,
        evidenceRefs: ctx.energyBalance.flatMap((m) => m.factIds),
        magnitude: { value: missing.length, unit: "months" },
      },
    ];
  },
};

/**
 * AD-CAL001 — a reading is only usable if the meter's calibration was live when
 * the reading was taken.
 */
export const meterCalibrationRule: AdeetieRule = {
  id: "AD-CAL001",
  title: "Meter calibration not valid over the period its readings are relied on",
  clauseRef: ADEETIE_CLAUSE_REFS.calibration,
  run(ctx) {
    const findings: RuleFinding[] = [];
    for (const m of ctx.meterCalibrations) {
      if (!m.calibratedOn && !m.validUntil) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: "Meter has no calibration record",
          detail:
            `Meter ${m.meterId} (${m.description}) is relied on for ${m.reliedOnFrom} to ${m.reliedOnTo} ` +
            `but carries no calibration date and no validity date.`,
          clauseRef: this.clauseRef,
          evidenceRefs: m.factIds,
        });
        continue;
      }
      if (m.validUntil && m.validUntil < m.reliedOnTo) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: this.title,
          detail:
            `Meter ${m.meterId} (${m.description}): calibration expired on ${m.validUntil}, but its ` +
            `readings are relied on up to ${m.reliedOnTo}.`,
          clauseRef: this.clauseRef,
          evidenceRefs: m.factIds,
        });
      }
      if (m.calibratedOn && m.calibratedOn > m.reliedOnFrom) {
        findings.push({
          ruleId: this.id,
          severity: "warn",
          title: "Meter calibrated after the period its readings are relied on began",
          detail:
            `Meter ${m.meterId} (${m.description}) was calibrated on ${m.calibratedOn}, but its readings ` +
            `are relied on from ${m.reliedOnFrom}. Readings before the calibration date are outside its ` +
            `demonstrated accuracy.`,
          clauseRef: this.clauseRef,
          evidenceRefs: m.factIds,
        });
      }
    }
    return findings;
  },
};

/**
 * AD-SEC001 — physical plausibility of the baseline SEC.
 *
 * Catches unit errors and denominator mistakes, not inefficiency. Skipped entirely
 * when the pack has not declared a plausible band, because a made-up band would
 * produce made-up findings.
 */
export const secPlausibilityRule: AdeetieRule = {
  id: "AD-SEC001",
  title: "Specific energy consumption outside the plausible range for the sector",
  clauseRef: "Physical plausibility gate (internal control)",
  run(ctx) {
    const range = ctx.secPlausibleRange;
    if (!range) return [];

    const findings: RuleFinding[] = [];
    const checks: Array<{ label: string; sec: SecResult | undefined }> = [
      { label: "Baseline", sec: ctx.baselineSec },
      { label: "Post-implementation", sec: ctx.postSec },
    ];

    for (const { label, sec } of checks) {
      if (!sec) continue;
      if (sec.sec < range.min || sec.sec > range.max) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: this.title,
          detail:
            `${label} SEC is ${sec.sec} ${sec.secUnitLabel}, outside the plausible range ` +
            `${range.min}-${range.max} ${sec.secUnitLabel}. Check the output unit on the production log and ` +
            `the units on each energy stream before treating this as a real figure.`,
          clauseRef: this.clauseRef,
          evidenceRefs: sec.streams.flatMap((s) => s.provenance.factIds),
          magnitude: { value: sec.sec, unit: sec.secUnitLabel },
        });
      }
    }
    return findings;
  },
};

/**
 * AD-SAV001 — the 10% savings gate.
 *
 * This is the gate the annual interest subvention release depends on. The rule
 * states the measured percentage and whether it clears the threshold; it also
 * surfaces every reason the two SEC figures may not be comparable, because a
 * saving produced by a dropped stream or a changed output unit is not a saving.
 */
export const savingsGateRule: AdeetieRule = {
  id: "AD-SAV001",
  title: "Measured energy savings below the scheme minimum",
  clauseRef: ADEETIE_CLAUSE_REFS.savings,
  run(ctx) {
    const s = ctx.savings;
    if (!s) return [];

    const findings: RuleFinding[] = [];
    const evidenceRefs = [
      ...(ctx.baselineSec?.streams.flatMap((x) => x.provenance.factIds) ?? []),
      ...(ctx.postSec?.streams.flatMap((x) => x.provenance.factIds) ?? []),
    ];

    if (!s.meetsThreshold) {
      findings.push({
        ruleId: this.id,
        severity: "block",
        title: this.title,
        detail:
          `Baseline SEC ${s.baselineSec} ${s.secUnitLabel} against post-implementation SEC ${s.postSec} ` +
          `${s.secUnitLabel} is a reduction of ${s.savingsPct.toFixed(2)}%, below the scheme minimum of ` +
          `${s.thresholdPct}%. The scheme requires the minimum to be achieved and sustained before an ` +
          `annual interest subvention release.`,
        clauseRef: this.clauseRef,
        evidenceRefs,
        magnitude: { value: s.savingsPct, unit: "%" },
      });
    }

    for (const w of s.comparabilityWarnings) {
      findings.push({
        ruleId: this.id,
        severity: "block",
        title: "Baseline and post-implementation SEC are not comparable",
        detail:
          `${w} The measured ${s.savingsPct.toFixed(2)}% movement cannot be relied on as an energy saving ` +
          `until this is resolved.`,
        clauseRef: this.clauseRef,
        evidenceRefs,
      });
    }

    return findings;
  },
};

function eligibilityFinding(
  rule: AdeetieRule,
  severity: Severity,
  title: string,
  detail: string,
  ctx: AdeetieContext,
  magnitude?: RuleFinding["magnitude"]
): RuleFinding {
  return {
    ruleId: rule.id,
    severity,
    title,
    detail,
    clauseRef: rule.clauseRef,
    evidenceRefs: ctx.eligibility?.factIds ?? [],
    ...(magnitude ? { magnitude } : {}),
  };
}

/** AD-ELG001 — Udyam registration. */
export const udyamRegistrationRule: AdeetieRule = {
  id: "AD-ELG001",
  title: "MSME Udyam registration not evidenced",
  clauseRef: ADEETIE_CLAUSE_REFS.udyam,
  run(ctx) {
    const e = ctx.eligibility;
    if (!e) return [];
    const raw = e.udyamRegistrationNo?.trim();

    if (!raw) {
      return [
        eligibilityFinding(
          this,
          "block",
          this.title,
          `No Udyam Registration Number is recorded for ${e.enterpriseName}. The scheme is open to ` +
            `Udyam-registered MSMEs.`,
          ctx
        ),
      ];
    }

    // Udyam numbers are printed as UDYAM-<STATE>-<DD>-<NNNNNNN>. A number that does
    // not match the printed form is a transcription question, not a rejection.
    if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/i.test(raw)) {
      return [
        eligibilityFinding(
          this,
          "warn",
          "Udyam Registration Number does not match the printed format",
          `"${raw}" does not match the UDYAM-<STATE>-<DD>-<NNNNNNN> form printed on the certificate. ` +
            `Confirm the transcription against the certificate and validate the number on the Udyam portal ` +
            `— this system does not verify registrations against the registry.`,
          ctx
        ),
      ];
    }
    return [];
  },
};

/**
 * AD-ELG002 — cluster eligibility.
 *
 * The 200 km provision is treated as a reviewable exception, never an automatic
 * pass. Distance to a notified cluster *boundary* needs the notified boundary
 * geometry, which this system does not hold, so a claimed distance is evidence for
 * a human to check.
 */
export const clusterEligibilityRule: AdeetieRule = {
  id: "AD-ELG002",
  title: "Enterprise is not in a notified cluster",
  clauseRef: ADEETIE_CLAUSE_REFS.cluster,
  run(ctx) {
    const e = ctx.eligibility;
    if (!e) return [];

    if (!isAdeetieSector(e.sector)) {
      return [
        eligibilityFinding(
          this,
          "block",
          "Sector is not an ADEETIE Phase 1 sector",
          `"${e.sector}" is not one of the 14 sectors notified for ADEETIE Phase 1.`,
          ctx
        ),
      ];
    }

    if (isNotifiedCluster(e.sector, e.cluster)) {
      return [
        eligibilityFinding(
          this,
          "info",
          "Cluster matched against an unverified notified-cluster list",
          `"${e.cluster}" matches a row in the ${e.sector} notified cluster list held by this system. ` +
            `That list is flagged unverified — the official BEE cluster page has not been read back against ` +
            `it — so the match must be confirmed against the published list before it is relied on.`,
          ctx
        ),
      ];
    }

    const km = e.claimedDistanceToClusterKm;
    if (typeof km === "number" && km <= CLUSTER_PROXIMITY_KM) {
      return [
        eligibilityFinding(
          this,
          "warn",
          "Eligibility rests on the 200 km proximity provision",
          `"${e.cluster}" is not in the ${e.sector} notified cluster list. The application claims ` +
            `${km} km to the nearest notified cluster, within the ${CLUSTER_PROXIMITY_KM} km provision. ` +
            `This system holds no notified cluster boundary geometry and has not computed or confirmed that ` +
            `distance — it must be evidenced and accepted by a reviewer, and does not pass automatically.`,
          ctx,
          { value: km, unit: "km" }
        ),
      ];
    }

    return [
      eligibilityFinding(
        this,
        "block",
        this.title,
        `"${e.cluster}" is not in the ${e.sector} notified cluster list, and no distance to a notified ` +
          `cluster within ${CLUSTER_PROXIMITY_KM} km has been claimed.`,
        ctx
      ),
    ];
  },
};

/** AD-ELG003 — loan size window. */
export const loanRangeRule: AdeetieRule = {
  id: "AD-ELG003",
  title: "Loan amount outside the eligible range",
  clauseRef: ADEETIE_CLAUSE_REFS.loanRange,
  run(ctx) {
    const e = ctx.eligibility;
    if (!e) return [];
    if (e.loanAmountINR >= LOAN_MIN_INR && e.loanAmountINR <= LOAN_MAX_INR) return [];

    const side = e.loanAmountINR < LOAN_MIN_INR ? "below the minimum" : "above the maximum";
    return [
      eligibilityFinding(
        this,
        "block",
        this.title,
        `Loan amount ${formatINR(e.loanAmountINR)} is ${side} of the eligible range ` +
          `${formatINR(LOAN_MIN_INR)} to ${formatINR(LOAN_MAX_INR)}.`,
        ctx,
        { value: e.loanAmountINR, unit: "INR" }
      ),
    ];
  },
};

/** AD-ELG004 — debt share of project cost. */
export const debtFundingShareRule: AdeetieRule = {
  id: "AD-ELG004",
  title: "Debt funding exceeds the qualifying share of project cost",
  clauseRef: ADEETIE_CLAUSE_REFS.debtShare,
  run(ctx) {
    const e = ctx.eligibility;
    if (!e) return [];
    if (e.projectCostINR <= 0) {
      return [
        eligibilityFinding(
          this,
          "block",
          "Project cost is not stated",
          `Project cost is recorded as ${formatINR(e.projectCostINR)}, so the debt share cannot be computed.`,
          ctx
        ),
      ];
    }

    const sharePct = (e.loanAmountINR / e.projectCostINR) * 100;
    if (sharePct <= MAX_DEBT_FUNDING_PCT) return [];

    const qualifying = (e.projectCostINR * MAX_DEBT_FUNDING_PCT) / 100;
    return [
      eligibilityFinding(
        this,
        "block",
        this.title,
        `Loan of ${formatINR(e.loanAmountINR)} against a project cost of ${formatINR(e.projectCostINR)} ` +
          `is ${sharePct.toFixed(2)}% debt funding, above the ${MAX_DEBT_FUNDING_PCT}% that qualifies. ` +
          `At this project cost, ${formatINR(qualifying)} qualifies.`,
        ctx,
        { value: Number(sharePct.toFixed(3)), unit: "%" }
      ),
    ];
  },
};

/** AD-ELG005 — enterprise category against the subvention rate claimed. */
export const subventionRateRule: AdeetieRule = {
  id: "AD-ELG005",
  title: "Claimed interest subvention does not match the enterprise category",
  clauseRef: ADEETIE_CLAUSE_REFS.subvention,
  run(ctx) {
    const e = ctx.eligibility;
    if (!e) return [];

    const findings: RuleFinding[] = [];
    const entitled = SUBVENTION_PCT[e.category];

    if (typeof e.claimedSubventionPct === "number" && e.claimedSubventionPct > entitled) {
      findings.push(
        eligibilityFinding(
          this,
          "block",
          this.title,
          `The application claims a ${e.claimedSubventionPct}% interest subvention. A ${e.category} ` +
            `enterprise is entitled to ${entitled}%.`,
          ctx,
          { value: e.claimedSubventionPct - entitled, unit: "percentage points" }
        )
      );
    }

    if (typeof e.sanctionedRatePct === "number") {
      const computed = computeSubvention({
        category: e.category,
        sanctionedRatePct: e.sanctionedRatePct,
        principalINR: e.loanAmountINR,
      });
      if (computed.cappedByNetRateFloor) {
        findings.push(
          eligibilityFinding(
            this,
            "warn",
            "Subvention is capped by the minimum net borrowing rate",
            `${computed.notes.join(" ")} The applicable subvention is ${computed.appliedSubventionPct}%, ` +
              `not the headline ${computed.headlineSubventionPct}%, leaving a net borrowing rate of ` +
              `${computed.netBorrowingRatePct}%.`,
            ctx,
            { value: computed.appliedSubventionPct, unit: "%" }
          )
        );
      }
    }

    return findings;
  },
};

export const ADEETIE_RULES: AdeetieRule[] = [
  energyBalanceClosureRule,
  baselineCompletenessRule,
  meterCalibrationRule,
  secPlausibilityRule,
  savingsGateRule,
  udyamRegistrationRule,
  clusterEligibilityRule,
  loanRangeRule,
  debtFundingShareRule,
  subventionRateRule,
];

export interface AdeetieRuleRunResult {
  findings: RuleFinding[];
  blocks: number;
  warns: number;
  rulesEvaluated: string[];
}

export function runAdeetieRules(
  ctx: AdeetieContext,
  rules: AdeetieRule[] = ADEETIE_RULES
): AdeetieRuleRunResult {
  const findings = rules.flatMap((r) => r.run(ctx));
  return {
    findings,
    blocks: findings.filter((f) => f.severity === "block").length,
    warns: findings.filter((f) => f.severity === "warn").length,
    rulesEvaluated: rules.map((r) => r.id),
  };
}

/**
 * Convenience helper for building an energy balance series from SEC results,
 * where the enterprise supplies only annual figures. Exposed so the caller does
 * the conversion explicitly rather than the rule guessing a unit.
 */
export function energyBalanceMonthFromBilled(
  month: string,
  billed: { value: number; unit: Parameters<typeof convert>[1] },
  factIds: string[]
): EnergyBalanceMonth {
  return {
    month,
    billedEnergyMJ: convert({ value: billed.value, unit: billed.unit }, "MJ").value,
    factIds,
  };
}

export { MIN_ENERGY_SAVINGS_PCT };
