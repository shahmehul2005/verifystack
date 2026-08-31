/**
 * Build a CCTS reconciliation context from this engagement's D4 facts and the
 * GEI result just computed. Process 5.4 must not be fed another plant's data.
 *
 * Fields we do not extract (opening/closing stock, sampling counts) stay empty.
 * Empty means the corresponding rule stays silent — it does not mean the check
 * passed.
 */

import { dimensionOf, qty, type Unit } from "../units";
import { matchFactPath } from "../extraction/fieldPaths";
import { DEFAULT_MATERIALITY_PCT } from "../factors";
import type { CalcResult } from "../calc/engine";
import type { ProvenancedFact } from "../calc/run";
import type {
  LabCertificate,
  MonthlySeriesPoint,
  ReconciliationContext,
} from "./types";

export function fyMonths(complianceYear: string): string[] {
  const m = /^FY(\d{4})-(\d{2})$/.exec(complianceYear.trim());
  if (!m) return [];
  const startYear = Number(m[1]);
  const months: string[] = [];
  for (let month = 4; month <= 12; month++) {
    months.push(`${startYear}-${String(month).padStart(2, "0")}`);
  }
  const endYear = startYear + 1;
  for (let month = 1; month <= 3; month++) {
    months.push(`${endYear}-${String(month).padStart(2, "0")}`);
  }
  return months;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v !== null && "value" in v) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function asUnit(raw: string | null | undefined): Unit | null {
  if (!raw) return null;
  try {
    dimensionOf(raw as Unit);
    return raw as Unit;
  } catch {
    return null;
  }
}

function isoMonth(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const m = /^(\d{4}-\d{2})/.exec(s);
  return m?.[1] ?? null;
}

function factsMatching(facts: ProvenancedFact[], path: string): ProvenancedFact[] {
  return facts.filter((f) => matchFactPath(f.field_path, path));
}

function firstMatch(facts: ProvenancedFact[], path: string): ProvenancedFact | undefined {
  return factsMatching(facts, path)[0];
}

function groupByDocument(facts: ProvenancedFact[]): Map<string, ProvenancedFact[]> {
  const groups = new Map<string, ProvenancedFact[]>();
  for (const f of facts) {
    const list = groups.get(f.document_id) ?? [];
    list.push(f);
    groups.set(f.document_id, list);
  }
  return groups;
}

function inferFuelKey(description: string | null): string {
  if (!description) return "unknown";
  const d = description.toLowerCase();
  if (d.includes("lignite")) return "lignite";
  if (d.includes("petcoke") || d.includes("pet coke")) return "petcoke";
  if (d.includes("biomass") || d.includes("bagasse")) return "biomass";
  if (d.includes("furnace oil") || d.includes("fuel oil")) return "furnace_oil";
  if (d.includes("diesel")) return "diesel";
  if (d.includes("png") || d.includes("natural gas")) return "natural_gas";
  if (d.includes("import")) return "coal_imported";
  if (d.includes("coal") || d.includes("coke")) return "coal_indian";
  return "unknown";
}

function inferCalorificBasis(unit: Unit | null, printed: string | null): "NCV" | "GCV" {
  if (printed === "NCV" || printed === "GCV") return printed;
  return unit === "kcal/kg" ? "GCV" : "NCV";
}

function labCertificatesFromFacts(facts: ProvenancedFact[]): LabCertificate[] {
  const out: LabCertificate[] = [];
  for (const [documentId, docs] of groupByDocument(facts)) {
    const cv = firstMatch(docs, "calorificValue");
    const testDate = firstMatch(docs, "testDate");
    const certNo = firstMatch(docs, "certificateNumber");
    const nablNo = firstMatch(docs, "nablAccreditationNo");
    const nablUntil = firstMatch(docs, "nablValidUntil");
    if (!cv && !testDate && !certNo && !nablNo && !nablUntil) continue;
    if (!cv || !testDate) continue;

    const cvValue = num(cv.value_json);
    const cvUnit = asUnit(cv.unit) ?? "MJ/kg";
    if (cvValue == null) continue;

    const basisFact = firstMatch(docs, "calorificBasis");
    const lab = firstMatch(docs, "labName");
    const material = firstMatch(docs, "materialDescription");
    const testDateValue = str(testDate.value_json);
    if (!testDateValue) continue;

    const factIds = [cv, testDate, certNo, nablNo, nablUntil, basisFact, lab, material]
      .filter((f): f is ProvenancedFact => Boolean(f))
      .map((f) => f.id);

    const nablAccreditationNo = nablNo ? str(nablNo.value_json) ?? undefined : undefined;
    const nablValidUntil = nablUntil ? str(nablUntil.value_json) ?? undefined : undefined;

    out.push({
      certificateId: str(certNo?.value_json) ?? `lab:${documentId}`,
      labName: str(lab?.value_json) ?? "Lab name not extracted",
      ...(nablAccreditationNo ? { nablAccreditationNo } : {}),
      ...(nablValidUntil ? { nablValidUntil } : {}),
      testDate: testDateValue,
      fuelKey: inferFuelKey(str(material?.value_json)),
      calorificValue: qty(cvValue, cvUnit),
      calorificBasis: inferCalorificBasis(cvUnit, str(basisFact?.value_json)),
      factIds,
    });
  }
  return out;
}

function monthlySeriesFromFacts(
  facts: ProvenancedFact[],
  calc: CalcResult
): Record<string, MonthlySeriesPoint[]> {
  const series: Record<string, MonthlySeriesPoint[]> = {};

  for (const stream of calc.streams) {
    const streamFacts = facts.filter((f) => stream.provenance.factIds.includes(f.id));
    if (streamFacts.length === 0) continue;
    const docIds = new Set(streamFacts.map((f) => f.document_id));
    const related = facts.filter((f) => docIds.has(f.document_id));

    const points: MonthlySeriesPoint[] = [];
    for (const [, docs] of groupByDocument(related)) {
      const dateFact =
        firstMatch(docs, "billingPeriodStart") ??
        firstMatch(docs, "invoiceDate") ??
        firstMatch(docs, "deliveryPeriodStart") ??
        firstMatch(docs, "periodStart");
      const month = isoMonth(dateFact?.value_json);
      if (!month) continue;

      const qtyFact =
        firstMatch(docs, "activeEnergy") ??
        firstMatch(docs, "electricity.activeEnergy") ??
        firstMatch(docs, "quantity");
      const value = qtyFact ? num(qtyFact.value_json) : null;
      const unit = asUnit(qtyFact?.unit);
      if (value == null || !unit) continue;

      points.push({
        month,
        quantity: qty(value, unit),
        factIds: [dateFact, qtyFact].filter((f): f is ProvenancedFact => Boolean(f)).map((f) => f.id),
      });
    }
    if (points.length > 0) series[stream.streamId] = points;
  }
  return series;
}

function gridVintageFromCalc(calc: CalcResult): string | undefined {
  for (const s of calc.streams) {
    const grid = s.factorsUsed.find((f) => f.id === "cea_grid_ef");
    if (grid) return grid.vintage;
  }
  return undefined;
}

export function reconciliationContextFromFacts(opts: {
  complianceYear: string;
  calc: CalcResult;
  facts: ProvenancedFact[];
}): ReconciliationContext {
  return {
    complianceYear: opts.complianceYear,
    expectedMonths: fyMonths(opts.complianceYear),
    calc: opts.calc,
    monthlySeries: monthlySeriesFromFacts(opts.facts, opts.calc),
    stockMovements: [],
    labCertificates: labCertificatesFromFacts(opts.facts),
    samplingRecords: [],
    gridFactorVintageUsed: gridVintageFromCalc(opts.calc),
    materialityPct: DEFAULT_MATERIALITY_PCT,
    stockTolerancePct: 0.5,
  };
}
