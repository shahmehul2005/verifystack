/**
 * The lead tie-out schedule: for each figure the entity reported, what the
 * evidence shows, the difference, the band that check allows, and where it
 * stands. Built from the desk-review outcomes and nothing else, so the page,
 * a finding and the binder cannot disagree.
 *
 * Two things this deliberately does not do:
 *  - It never calls a single line "material". The procedure's 2% is a threshold
 *    on the aggregate of quantified misstatements against total reported
 *    emissions, and the footer shows exactly that.
 *  - It never says "verified". A check that agrees within its band reads
 *    "Agrees"; verifying is a named person's decision.
 */

import type { DeskOutcome, DeskSourceRef, MaterialityPosition } from "./engine";
import { clauseFor, type ClauseRef } from "./clauses";

export type LeadStatus = "agrees" | "disagrees" | "waiting" | "undecided";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  agrees: "Agrees",
  disagrees: "Disagrees",
  waiting: "Waiting for readings",
  undecided: "Cannot be decided",
};

export interface LeadRowDef {
  ruleId: string;
  label: string;
  category: string;
  unit: string;
  /** Reading keys, when the check's own actual and expected are not the two figures to compare. */
  declaredKey?: string;
  evidencedKey?: string;
}

/**
 * Every check below exists in the cement desk review. `leadSchedule.test.ts`
 * fails if one is renamed or removed, so the schedule cannot point at a check
 * that no longer runs.
 */
export const LEAD_ROWS: LeadRowDef[] = [
  { ruleId: "scada_clinker_vs_mpr", label: "Clinker: SCADA total against the monthly report", category: "Production", unit: "t" },
  { ruleId: "scada_opc_vs_mpr", label: "OPC: SCADA total against the monthly report", category: "Production", unit: "t" },
  { ruleId: "scada_ppc_vs_mpr", label: "PPC: SCADA total against the monthly report", category: "Production", unit: "t" },
  { ruleId: "scada_psc_vs_mpr", label: "PSC: SCADA total against the monthly report", category: "Production", unit: "t" },
  { ruleId: "clinker_mass_balance", label: "Clinker mass balance against cement ground", category: "Production", unit: "t" },
  { ruleId: "coverage_clinker", label: "Clinker produced: annual cell against the evidenced total", category: "Annual figures", unit: "t", declaredKey: "pf.clinker_t", evidencedKey: "scada.clinker_sum" },
  { ruleId: "coverage_cpp", label: "Captive generation: annual cell against the evidenced total", category: "Annual figures", unit: "kWh", declaredKey: "pf.cpp_kwh", evidencedKey: "cpp.kwh_sum" },
  { ruleId: "coverage_grid", label: "Grid import: annual cell against the bills", category: "Annual figures", unit: "kWh", declaredKey: "pf.grid_kwh", evidencedKey: "grid.bill_kwh" },
  { ruleId: "coverage_coal", label: "Coal consumed: annual cell against the consumption log", category: "Annual figures", unit: "t", declaredKey: "pf.coal_t", evidencedKey: "petcoke.coal_t_sum" },
  { ruleId: "coal_stock_balance", label: "Coal stock ledger against the consumption log", category: "Fuels and power", unit: "t" },
  { ruleId: "coal_weighfeeder", label: "Weigh-feeder total against the consumption log", category: "Fuels and power", unit: "t" },
  { ruleId: "cpp_report_vs_proforma", label: "Captive generation report against the pro forma", category: "Fuels and power", unit: "kWh" },
  { ruleId: "form1_eq_product", label: "Form 1 equivalent product against the pro forma", category: "Form 1 and the workbook", unit: "t" },
  { ruleId: "form1_direct", label: "Form 1 direct emissions against the recalculation", category: "Form 1 and the workbook", unit: "tCO2e" },
  { ruleId: "form1_indirect", label: "Form 1 indirect emissions against the pro forma", category: "Form 1 and the workbook", unit: "tCO2e" },
  { ruleId: "workbook_vs_engine", label: "Workbook direct emissions against the streams the engine takes", category: "Form 1 and the workbook", unit: "tCO2e" },
  { ruleId: "sheet2_coal_tie", label: "Sheet 2 coal against the emissions sheet", category: "Pro forma sheet ties", unit: "t" },
  { ruleId: "sheet2_fuel_oil_tie", label: "Sheet 2 fuel oil against the emissions sheet", category: "Pro forma sheet ties", unit: "t" },
  { ruleId: "sheet2_grid_tie", label: "Sheet 2 grid import against the emissions sheet", category: "Pro forma sheet ties", unit: "kWh" },
];

const UNIT_BY_CHECK = new Map(LEAD_ROWS.map((r) => [r.ruleId, r.unit]));

/** The unit a check's figures are in, when the schedule knows it. */
export function unitForCheck(checkId: string): string | null {
  return UNIT_BY_CHECK.get(checkId) ?? null;
}

export interface LeadRow {
  ruleId: string;
  label: string;
  category: string;
  unit: string;
  /** What the entity reported. */
  declared: number | null;
  /** What the evidence shows. */
  evidenced: number | null;
  /** Evidenced minus declared. */
  variance: number | null;
  /** The variance as a share of the declared figure, in percent. */
  variancePct: number | null;
  status: LeadStatus;
  /** What the check says, in words, with its numbers. */
  detail: string;
  /** The band the check allowed and where it came from. */
  band: string | null;
  clause: ClauseRef;
  sources: DeskSourceRef[];
  /** The verifier's decision, when there is one. */
  decision: { state: string; reason: string } | null;
}

export interface LeadSchedule {
  rows: LeadRow[];
  counts: Record<LeadStatus, number>;
  /** Disagreeing or waiting rows that carry no decision yet. */
  undecided: number;
  aggregate: {
    reportedTotal: number;
    fraction: number;
    threshold: number;
    quantified: number;
    over: boolean;
    limitations: string[];
  } | null;
}

const round = (n: number, places = 6) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

function sourceNumber(outcome: DeskOutcome, key: string): number | null {
  const s = outcome.sources?.find((x) => x.key === key);
  return typeof s?.value === "number" && Number.isFinite(s.value) ? s.value : null;
}

const finite = (n: number | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

function statusOf(outcome: DeskOutcome): LeadStatus {
  switch (outcome.status) {
    case "pass":
      return "agrees";
    case "fail":
      return "disagrees";
    case "pending":
      return "waiting";
    default:
      return "undecided";
  }
}

export function buildLeadSchedule(args: {
  outcomes: DeskOutcome[];
  materiality?: MaterialityPosition | null;
  resolutions?: Record<string, { state: string; reason: string }>;
}): LeadSchedule {
  const byId = new Map(args.outcomes.map((o) => [o.id, o]));
  const rows: LeadRow[] = [];
  for (const def of LEAD_ROWS) {
    const outcome = byId.get(def.ruleId);
    if (!outcome) continue;
    const declared = def.declaredKey ? sourceNumber(outcome, def.declaredKey) : finite(outcome.expected);
    const evidenced = def.evidencedKey ? sourceNumber(outcome, def.evidencedKey) : finite(outcome.actual);
    const variance = declared !== null && evidenced !== null ? round(evidenced - declared) : null;
    const variancePct = variance !== null && declared !== null && declared !== 0 ? round((Math.abs(variance) / Math.abs(declared)) * 100, 3) : null;
    const status = statusOf(outcome);
    rows.push({
      ruleId: def.ruleId,
      label: def.label,
      category: def.category,
      unit: def.unit,
      declared,
      evidenced,
      variance,
      variancePct,
      status,
      detail: status === "waiting" ? `Waiting for readings: ${(outcome.missing ?? []).join(", ")}.` : outcome.detail,
      band: outcome.thresholdSource ?? null,
      clause: clauseFor(def.ruleId),
      sources: outcome.sources ?? [],
      decision: args.resolutions?.[def.ruleId] ?? null,
    });
  }

  const counts: Record<LeadStatus, number> = { agrees: 0, disagrees: 0, waiting: 0, undecided: 0 };
  for (const r of rows) counts[r.status] += 1;
  const undecided = rows.filter((r) => (r.status === "disagrees" || r.status === "waiting") && !r.decision).length;

  const m = args.materiality ?? null;
  const aggregate = m
    ? {
        reportedTotal: m.reportedTotal,
        fraction: m.fraction,
        threshold: m.threshold,
        quantified: m.quantified,
        over: m.quantified > m.threshold + 1e-9,
        limitations: m.limitations,
      }
    : null;

  return { rows, counts, undecided, aggregate };
}
