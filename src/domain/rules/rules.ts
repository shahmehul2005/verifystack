/**
 * Reconciliation rules.
 *
 * These are deterministic. They observe and state facts; they never conclude.
 * A language model may later phrase a finding for a verifier, grounded strictly
 * on the RuleFinding produced here — it does not decide whether a finding exists.
 *
 * Clause references are marked TO VERIFY where they have not yet been checked
 * line-by-line against the gazetted procedure.
 */

import { convert } from "../units";
import {
  DEFAULT_MATERIALITY_PCT,
  NCV_PLAUSIBLE_RANGE,
  SAMPLING_MANDATE,
} from "../factors";
import type { Rule, RuleFinding, ReconciliationContext } from "./types";

function pctDiff(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return ((a - b) / b) * 100;
}

/** Opening stock + purchases - closing stock should reconcile with reported consumption. */
export const stockBalanceRule: Rule = {
  id: "MB001",
  title: "Fuel stock movement does not reconcile with reported consumption",
  clauseRef: "CCTS Detailed Procedure — data flow and control activities (TO VERIFY)",
  run(ctx) {
    const tolerance = ctx.stockTolerancePct ?? 0.5;
    const findings: RuleFinding[] = [];

    for (const m of ctx.stockMovements) {
      const opening = convert(m.openingStock, "kg").value;
      const purchases = convert(m.purchases, "kg").value;
      const closing = convert(m.closingStock, "kg").value;
      const reported = convert(m.reportedConsumption, "kg").value;

      const implied = opening + purchases - closing;
      const diff = reported - implied;
      const diffPct = pctDiff(reported, implied);

      if (Math.abs(diffPct) > tolerance) {
        findings.push({
          ruleId: this.id,
          severity: Math.abs(diffPct) > 2 ? "block" : "warn",
          title: this.title,
          detail:
            `Stream "${m.streamId}": opening ${opening.toFixed(0)} kg + purchases ${purchases.toFixed(0)} kg ` +
            `- closing ${closing.toFixed(0)} kg implies consumption of ${implied.toFixed(0)} kg, ` +
            `but ${reported.toFixed(0)} kg was reported. Difference ${diff.toFixed(0)} kg (${diffPct.toFixed(2)}%).`,
          clauseRef: this.clauseRef,
          evidenceRefs: m.factIds,
          magnitude: { value: Number(diff.toFixed(3)), unit: "kg" },
        });
      }
    }
    return findings;
  },
};

/** Calorific values outside physical plausibility usually indicate a unit or transcription error. */
export const calorificPlausibilityRule: Rule = {
  id: "CV002",
  title: "Calorific value outside plausible range for the declared fuel",
  clauseRef: "Physical plausibility gate (internal control)",
  run(ctx) {
    const findings: RuleFinding[] = [];
    for (const cert of ctx.labCertificates) {
      const range = NCV_PLAUSIBLE_RANGE[cert.fuelKey];
      if (!range) continue;

      const cvMJkg = convert(cert.calorificValue, "MJ/kg").value;
      if (cvMJkg < range.minMJkg || cvMJkg > range.maxMJkg) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: this.title,
          detail:
            `Certificate ${cert.certificateId} reports ${cert.calorificValue.value} ${cert.calorificValue.unit} ` +
            `(${cvMJkg.toFixed(3)} MJ/kg) for ${cert.fuelKey}, outside the plausible range ` +
            `${range.minMJkg}-${range.maxMJkg} MJ/kg. Check for a unit error (kcal/kg vs MJ/kg) or transcription error.`,
          clauseRef: this.clauseRef,
          evidenceRefs: cert.factIds,
          magnitude: { value: Number(cvMJkg.toFixed(4)), unit: "MJ/kg" },
        });
      }
    }
    return findings;
  },
};

/** Using GCV where the methodology requires NCV overstates energy by roughly 5-10%. */
export const calorificBasisRule: Rule = {
  id: "CV001",
  title: "Gross calorific value used where net calorific value is required",
  clauseRef: "CCTS Detailed Procedure — emissions estimated using actual NCV (TO VERIFY)",
  run(ctx) {
    return ctx.labCertificates
      .filter((c) => c.calorificBasis === "GCV")
      .map((c) => ({
        ruleId: this.id,
        severity: "warn" as const,
        title: this.title,
        detail:
          `Certificate ${c.certificateId} reports a GROSS calorific value. The procedure requires net ` +
          `calorific value; the IPCC default conversion has been applied. Confirm whether a lab-tested ` +
          `NCV exists, since the default conversion introduces avoidable uncertainty.`,
        clauseRef: this.clauseRef,
        evidenceRefs: c.factIds,
      }));
  },
};

/** A lab result is only usable if the lab's accreditation was live on the test date. */
export const nablValidityRule: Rule = {
  id: "LB001",
  title: "Lab accreditation not valid on the date of test",
  clauseRef: "CCTS Detailed Procedure — NABL accredited lab testing (TO VERIFY)",
  run(ctx) {
    const findings: RuleFinding[] = [];
    for (const cert of ctx.labCertificates) {
      if (!cert.nablAccreditationNo) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: "Lab certificate carries no NABL accreditation number",
          detail: `Certificate ${cert.certificateId} from ${cert.labName} has no NABL accreditation number recorded.`,
          clauseRef: this.clauseRef,
          evidenceRefs: cert.factIds,
        });
        continue;
      }
      if (cert.nablValidUntil && cert.testDate > cert.nablValidUntil) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: this.title,
          detail:
            `Certificate ${cert.certificateId}: sample tested on ${cert.testDate}, but NABL accreditation ` +
            `${cert.nablAccreditationNo} expired on ${cert.nablValidUntil}.`,
          clauseRef: this.clauseRef,
          evidenceRefs: cert.factIds,
        });
      }
    }
    return findings;
  },
};

/** A missing month silently understates annual totals. */
export const seriesCompletenessRule: Rule = {
  id: "TS001",
  title: "Gap in monthly data series",
  clauseRef: "CCTS Detailed Procedure — completeness of monitored data (TO VERIFY)",
  run(ctx) {
    const findings: RuleFinding[] = [];
    for (const [streamId, points] of Object.entries(ctx.monthlySeries)) {
      const present = new Set(points.map((p) => p.month));
      const missing = ctx.expectedMonths.filter((m) => !present.has(m));
      if (missing.length > 0) {
        findings.push({
          ruleId: this.id,
          severity: "block",
          title: this.title,
          detail:
            `Stream "${streamId}" is missing data for ${missing.length} month(s): ${missing.join(", ")}. ` +
            `Annual totals derived from this series will understate actual activity.`,
          clauseRef: this.clauseRef,
          evidenceRefs: points.flatMap((p) => p.factIds),
          magnitude: { value: missing.length, unit: "months" },
        });
      }
    }
    return findings;
  },
};

/** Using a grid factor from the wrong year is a recurring finding. */
export const gridVintageRule: Rule = {
  id: "EF001",
  title: "Grid emission factor vintage does not match the compliance year",
  clauseRef: "CEA CO2 baseline database applicable to the compliance year (TO VERIFY)",
  run(ctx) {
    if (!ctx.gridFactorVintageUsed) return [];
    if (ctx.gridFactorVintageUsed === ctx.complianceYear) return [];
    return [
      {
        ruleId: this.id,
        severity: "warn",
        title: this.title,
        detail:
          `Compliance year is ${ctx.complianceYear} but the grid emission factor applied carries vintage ` +
          `${ctx.gridFactorVintageUsed}. Confirm which CEA database version applies to this cycle.`,
        clauseRef: this.clauseRef,
        evidenceRefs: [],
      },
    ];
  },
};

/** Sampling below the mandated frequency undermines the fuel quality basis. */
export const samplingFrequencyRule: Rule = {
  id: "SM001",
  title: "Sampling frequency below the mandated minimum",
  clauseRef: "CCTS Detailed Procedure — sampling (coal monthly or per 20,000 t; raw material monthly or per 50,000 t)",
  run(ctx) {
    const findings: RuleFinding[] = [];
    for (const rec of ctx.samplingRecords) {
      const mandate = SAMPLING_MANDATE[rec.materialKind];
      const throughputTonnes = convert(rec.throughput, "t").value;
      const requiredByThroughput = Math.ceil(throughputTonnes / mandate.perTonnes);
      const required = Math.max(mandate.perMonth, requiredByThroughput);

      if (rec.samplesTaken < required) {
        findings.push({
          ruleId: this.id,
          severity: "warn",
          title: this.title,
          detail:
            `${rec.materialKind} sampling in ${rec.month}: ${rec.samplesTaken} sample(s) recorded against ` +
            `${throughputTonnes.toFixed(0)} t throughput. Minimum required is ${required} ` +
            `(monthly minimum ${mandate.perMonth}, plus one per ${mandate.perTonnes} t).`,
          clauseRef: this.clauseRef,
          evidenceRefs: rec.factIds,
          magnitude: { value: required - rec.samplesTaken, unit: "samples" },
        });
      }
    }
    return findings;
  },
};

/**
 * Individually immaterial discrepancies aggregate. This checks the accumulated
 * magnitude of quantified findings against the materiality threshold.
 */
export const cumulativeMaterialityRule: Rule = {
  id: "MT001",
  title: "Aggregated discrepancies approach the materiality threshold",
  clauseRef: "ISO 14064-3 — materiality and aggregation of errors (TO VERIFY)",
  run(ctx) {
    const pct = ctx.materialityPct ?? DEFAULT_MATERIALITY_PCT;
    const totalKg = ctx.calc.totalEmissions.value;
    if (totalKg <= 0) return [];

    // Only kg-denominated discrepancies aggregate meaningfully here.
    const aggregate = ctx.stockMovements.reduce((acc, m) => {
      const opening = convert(m.openingStock, "kg").value;
      const purchases = convert(m.purchases, "kg").value;
      const closing = convert(m.closingStock, "kg").value;
      const reported = convert(m.reportedConsumption, "kg").value;
      return acc + Math.abs(reported - (opening + purchases - closing));
    }, 0);

    if (aggregate === 0) return [];

    // Express the aggregate mass discrepancy as a share of reported activity mass.
    const activityKg = ctx.stockMovements.reduce(
      (acc, m) => acc + convert(m.reportedConsumption, "kg").value,
      0
    );
    if (activityKg <= 0) return [];

    const sharePct = (aggregate / activityKg) * 100;
    if (sharePct < pct * 0.5) return [];

    return [
      {
        ruleId: this.id,
        severity: sharePct >= pct ? "block" : "warn",
        title: this.title,
        detail:
          `Unresolved quantity discrepancies total ${aggregate.toFixed(0)} kg, which is ` +
          `${sharePct.toFixed(2)}% of reported activity mass against a materiality threshold of ${pct}%. ` +
          `Errors in the same direction aggregate and must be assessed together.`,
        clauseRef: this.clauseRef,
        evidenceRefs: ctx.stockMovements.flatMap((m) => m.factIds),
        magnitude: { value: Number(sharePct.toFixed(3)), unit: "%" },
      },
    ];
  },
};

export const ALL_RULES: Rule[] = [
  stockBalanceRule,
  calorificPlausibilityRule,
  calorificBasisRule,
  nablValidityRule,
  seriesCompletenessRule,
  gridVintageRule,
  samplingFrequencyRule,
  cumulativeMaterialityRule,
];

export interface RuleRunResult {
  findings: RuleFinding[];
  blocks: number;
  warns: number;
  rulesEvaluated: string[];
}

export function runRules(
  ctx: ReconciliationContext,
  rules: Rule[] = ALL_RULES
): RuleRunResult {
  const findings = rules.flatMap((r) => r.run(ctx));
  return {
    findings,
    blocks: findings.filter((f) => f.severity === "block").length,
    warns: findings.filter((f) => f.severity === "warn").length,
    rulesEvaluated: rules.map((r) => r.id),
  };
}
