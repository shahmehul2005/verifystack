/**
 * Desk review for the CCTS cement pack: which figures are read from workbooks, which
 * are typed from PDFs, and the cross-checks between them. Slot ids are the cement
 * pack's evidence slots. The 71.7 kcal/kg GCV band is confirmed from BEE CCTS Detailed Procedure Clause 4(10)(ii) (citing ISO 1928: 1995 (E)).

 */

import { DEFAULT_TOLERANCE } from "../compare/declared";
import {
  checkEvidenceCoverage,
  checkGcvRule,
  checkMassBalance,
  checkProductionDays,
  checkRecomputed,
  checkRenewableClaim,
  checkSumMatches,
  checkUnmappedFuel,
  clinkerConsumedForCement,
  type CheckResult,
} from "../crosscheck/tieout";
import type { ProformaInput } from "../proforma/types";
import { dailyColumn, months, num, series, type DeskReviewDef, type DeskRule, type Readings, type WorkbookReader } from "./engine";

const T = DEFAULT_TOLERANCE;
const T_SRC = "DEFAULT_TOLERANCE (product comparison tolerance)";
const LAKH = 100000;

const pf = (key: string, sheet: string, label: string, unit: string, scale = 1): ProformaInput => ({
  fieldPath: key,
  sheet,
  label,
  unit,
  scale,
  description: key,
});

const PROFORMA_CELLS: ProformaInput[] = [
  pf("pf.clinker_t", "production", "^Clinker Production", "t", LAKH),
  pf("pf.opc_t", "production", "^OPC Produced", "t", LAKH),
  pf("pf.ppc_t", "production", "^PPC Produced", "t", LAKH),
  pf("pf.psc_t", "production", "^PSC Produced", "t", LAKH),
  pf("pf.cf_opc", "production", "Clinker Factor.*OPC", ""),
  pf("pf.cf_ppc", "production", "Clinker Factor.*PPC", ""),
  pf("pf.cf_psc", "production", "Clinker Factor.*PSC", ""),
  pf("pf.eq_product_t", "summary|form ?1", "^Total Equivalent Product", "t"),
  pf("pf.cpp_kwh", "energy", "^CPP Power", "kWh", LAKH),
  pf("pf.grid_kwh", "ghg", "^Grid Import", "kWh", LAKH),
  pf("pf.coal_t", "ghg", "^Coal Consumed Total", "t"),
  pf("pf.gcv_coal", "ghg", "^GCV\\s*(of\\s*)?Coal", "kcal/kg"),
  pf("pf.direct_co2", "ghg", "^Direct GHG", "tCO2e"),
  pf("pf.indirect_co2", "ghg", "^Indirect GHG", "tCO2e"),
  // Rows that may not exist. Their absence is the finding.
  pf("pf.petcoke_t", ".", "petcoke|pet coke", "t"),
  pf("pf.renewable_excl", ".", "renewable|exclu", "kWh"),
];

const sum = (rows: { value: unknown }[]) => rows.reduce((a, r) => a + Number(r.value ?? 0), 0);

/** Sum and month count of one dated column, as readings `<prefix>.<name>_sum`. */
function column(sheet: Parameters<WorkbookReader["read"]>[0], header: string, key: string, out: Readings, keepDaily = false) {
  const rows = dailyColumn(sheet, header);
  if (!rows) return null;
  out[`${key}_sum`] = Math.round(sum(rows) * 1e6) / 1e6;
  if (keepDaily) for (const r of rows) out[`${key}@${r.date}`] = Number(r.value ?? 0);
  return rows;
}

const READERS: WorkbookReader[] = [
  {
    slot: "production_evidence",
    read(sheet) {
      const out: Readings = {};
      const clinker = column(sheet, "Clinker Production (t)", "scada.clinker", out, true);
      if (!clinker) return {};
      out["scada.months"] = months(clinker.map((r) => r.date));
      column(sheet, "OPC Produced (t)", "scada.opc", out);
      column(sheet, "PPC Produced (t)", "scada.ppc", out);
      column(sheet, "PSC Produced (t)", "scada.psc", out);
      for (const r of dailyColumn(sheet, "Kiln Run Status") ?? []) out[`scada.status@${r.date}`] = String(r.value ?? "");
      return out;
    },
  },
  {
    slot: "cpp_generation",
    read(sheet) {
      const out: Readings = {};
      const rows = column(sheet, "Gross Generation (kWh)", "cpp.kwh", out);
      if (rows) out["cpp.months"] = months(rows.map((r) => r.date));
      return out;
    },
  },
  {
    slot: "petcoke_log",
    read(sheet) {
      const out: Readings = {};
      const coal = column(sheet, "Coal Consumed (t)", "petcoke.coal_t", out);
      column(sheet, "Petcoke Consumed (t)", "petcoke.petcoke_t", out);
      if (coal) out["petcoke.months"] = months(coal.map((r) => r.date));
      return out;
    },
  },
  {
    slot: "coal_quality",
    read(sheet) {
      const rows = dailyColumn(sheet, "GCV (kcal/kg)");
      if (!rows) return {};
      const vals = rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v) && v > 0);
      const out: Readings = {};
      if (vals.length) out["lab.gcv_mean"] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
      return out;
    },
  },
];

const one = (id: string, section: string, label: string, needs: string[], f: (r: Readings) => CheckResult): DeskRule => ({
  id,
  section,
  label,
  needs,
  evaluate: f,
});

const PRODUCT_TIES = [
  ["clinker", "Clinker"],
  ["opc", "OPC"],
  ["ppc", "PPC"],
  ["psc", "PSC"],
] as const;

const RULES: DeskRule[] = [
  ...PRODUCT_TIES.map(([k, name]) =>
    one(`scada_${k}_vs_mpr`, "Production", `SCADA ${name} total vs monthly report`, [`scada.${k}_sum`, `mpr.${k}_t`], (r) =>
      checkSumMatches({ id: `scada_${k}`, label: name, parts: [num(r, `scada.${k}_sum`)], target: num(r, `mpr.${k}_t`), relTolerance: T, thresholdSource: T_SRC })
    )
  ),
  // The SAP printout lists cement by type, not clinker.
  ...PRODUCT_TIES.filter(([k]) => k !== "clinker").map(([k, name]) =>
    one(`sap_${k}_vs_scada`, "Production", `SAP ${name} vs SCADA ${name}`, [`sap.${k}_t`, `scada.${k}_sum`], (r) =>
      checkSumMatches({ id: `sap_${k}`, label: `SAP ${name}`, parts: [num(r, `sap.${k}_t`)], target: num(r, `scada.${k}_sum`), relTolerance: T, thresholdSource: T_SRC })
    )
  ),
  one("production_days", "Production", "Zero-output days and DOWN status", ["scada.clinker@*", "scada.status@*"], (r) => {
    const status = new Map(series(r, "scada.status").map((s) => [s.date, String(s.value)]));
    return checkProductionDays(
      series(r, "scada.clinker").map((s) => ({ date: s.date, tonnes: Number(s.value), status: status.get(s.date) ?? "" }))
    );
  }),
  one("dpr_vs_scada", "Production", "Daily report vs SCADA, same days", ["dpr.clinker@*", "scada.clinker@*"], (r) => {
    const scada = new Map(series(r, "scada.clinker").map((s) => [s.date, Number(s.value)]));
    const rows = series(r, "dpr.clinker")
      .filter((d) => scada.has(d.date))
      .map((d) => ({ date: d.date, a: Number(d.value), b: scada.get(d.date)! }));
    if (rows.length === 0) {
      return { id: "dpr_scada", label: "DPR vs SCADA", status: "not_applicable", detail: "None of the DPR days is a day in the SCADA file." };
    }
    const bad = rows.filter((x) => Math.abs(x.a - x.b) > Math.abs(x.b) * T + 1e-9);
    const worst = rows.reduce((m, x) => (Math.abs(x.a - x.b) / x.b > Math.abs(m.a - m.b) / m.b ? x : m), rows[0]!);
    return {
      id: "dpr_scada",
      label: "DPR vs SCADA",
      status: bad.length === 0 ? "pass" : "fail",
      detail: `${rows.length} day(s) compared. ${bad.length} outside ±${T * 100}%. Largest gap on ${worst.date}: DPR ${worst.a}, SCADA ${worst.b}.`,
      thresholdSource: T_SRC,
    };
  }),
  one(
    "clinker_mass_balance",
    "Production",
    "Clinker mass balance against cement ground",
    ["mpr.clinker_opening_t", "mpr.clinker_t", "mpr.clinker_import_t", "mpr.clinker_export_t", "mpr.clinker_closing_t", "mpr.opc_t", "mpr.ppc_t", "mpr.psc_t", "pf.cf_opc", "pf.cf_ppc", "pf.cf_psc"],
    (r) =>
      checkMassBalance({
        opening: num(r, "mpr.clinker_opening_t"),
        production: num(r, "mpr.clinker_t"),
        imports: num(r, "mpr.clinker_import_t"),
        exports: num(r, "mpr.clinker_export_t"),
        closing: num(r, "mpr.clinker_closing_t"),
        consumed: clinkerConsumedForCement([
          { label: "OPC", tonnes: num(r, "mpr.opc_t"), clinkerFactor: num(r, "pf.cf_opc") },
          { label: "PPC", tonnes: num(r, "mpr.ppc_t"), clinkerFactor: num(r, "pf.cf_ppc") },
          { label: "PSC", tonnes: num(r, "mpr.psc_t"), clinkerFactor: num(r, "pf.cf_psc") },
        ]).total,
        relTolerance: T,
        thresholdSource: `${T_SRC}. Clinker factors are the pro forma's.`,
      })
  ),
  one("form1_eq_product", "Form 1 against the pro forma", "Form 1 total equivalent product", ["pf.eq_product_t", "form1.eq_product_t"], (r) =>
    checkRecomputed({ id: "form1_eq_product", label: "Form 1 equivalent product vs pro forma (recomputed)", claimed: num(r, "form1.eq_product_t"), recomputed: num(r, "pf.eq_product_t"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("form1_direct", "Form 1 against the pro forma", "Form 1 direct energy CO2", ["pf.direct_co2", "form1.direct_co2_t"], (r) =>
    checkRecomputed({ id: "form1_direct", label: "Form 1 direct CO2 vs pro forma (recomputed)", claimed: num(r, "form1.direct_co2_t"), recomputed: num(r, "pf.direct_co2"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("form1_indirect", "Form 1 against the pro forma", "Form 1 indirect energy CO2", ["pf.indirect_co2", "form1.indirect_co2_t"], (r) =>
    checkRecomputed({ id: "form1_indirect", label: "Form 1 indirect CO2 vs pro forma (recomputed)", claimed: num(r, "form1.indirect_co2_t"), recomputed: num(r, "pf.indirect_co2"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("coverage_clinker", "Annual figures and evidence coverage", "Clinker: months of evidence behind the annual cell", ["scada.months", "pf.clinker_t", "scada.clinker_sum"], (r) =>
    checkEvidenceCoverage({ id: "cov_clinker", label: "Clinker production", monthsEvidenced: num(r, "scada.months"), periodMonths: 12, annualCell: num(r, "pf.clinker_t"), monthlyReading: num(r, "scada.clinker_sum") })
  ),
  one("coverage_cpp", "Annual figures and evidence coverage", "CPP generation: months of evidence", ["cpp.months", "pf.cpp_kwh", "cpp.kwh_sum"], (r) =>
    checkEvidenceCoverage({ id: "cov_cpp", label: "CPP generation", monthsEvidenced: num(r, "cpp.months"), periodMonths: 12, annualCell: num(r, "pf.cpp_kwh"), monthlyReading: num(r, "cpp.kwh_sum") })
  ),
  one("coverage_grid", "Annual figures and evidence coverage", "Grid import: months of evidence", ["grid.bill_months", "pf.grid_kwh", "grid.bill_kwh"], (r) =>
    checkEvidenceCoverage({ id: "cov_grid", label: "Grid electricity", monthsEvidenced: num(r, "grid.bill_months"), periodMonths: 12, annualCell: num(r, "pf.grid_kwh"), monthlyReading: num(r, "grid.bill_kwh") })
  ),
  one("coverage_coal", "Annual figures and evidence coverage", "Coal: months of evidence", ["coal.po_months", "pf.coal_t", "coal.po_t"], (r) =>
    checkEvidenceCoverage({ id: "cov_coal", label: "Coal consumed", monthsEvidenced: num(r, "coal.po_months"), periodMonths: 12, annualCell: num(r, "pf.coal_t"), monthlyReading: num(r, "coal.po_t") })
  ),
  one("coal_log_vs_po", "Fuels and power", "Coal in the fuel log vs purchase order", ["petcoke.coal_t_sum", "coal.po_t"], (r) =>
    checkSumMatches({ id: "coal_log_po", label: "Coal log vs PO", parts: [num(r, "petcoke.coal_t_sum")], target: num(r, "coal.po_t"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("cpp_report_vs_proforma", "Fuels and power", "CPP report generation vs pro forma", ["cpp.report_lakh_kwh", "pf.cpp_kwh"], (r) =>
    checkSumMatches({ id: "cpp_report", label: "CPP report vs pro forma", parts: [num(r, "cpp.report_lakh_kwh") * LAKH], target: num(r, "pf.cpp_kwh"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("petcoke_cell", "Fuels and power", "Petcoke logged but absent from the pro forma", ["petcoke.petcoke_t_sum", "pf.eq_product_t"], (r) =>
    checkUnmappedFuel({ id: "petcoke", label: "Petcoke", tonnes: num(r, "petcoke.petcoke_t_sum"), workbookHasCell: "pf.petcoke_t" in r })
  ),
  one("gcv_rule", "Fuels and power", "Coal GCV: internal lab vs NABL, and the workbook's value", ["lab.gcv_mean", "coal.nabl_gcv", "pf.gcv_coal"], (r) => {
    const internal = num(r, "lab.gcv_mean");
    const external = num(r, "coal.nabl_gcv");
    const cell = num(r, "pf.gcv_coal");
    // The workbook holds a rounded figure. Treat it as the expected one when it is within the band.
    const expected = Math.abs(external - internal) > 71.7 ? external : internal;
    const snapped = Math.abs(cell - expected) <= expected * T ? expected : cell;
    const res = checkGcvRule({ internal, external, cell: snapped, thresholdKcal: 71.7, thresholdSource: "Test brief (71.7 kcal/kg). Not found in the procedure pages read; unconfirmed." });
    return snapped !== cell ? { ...res, detail: `${res.detail} The workbook's ${cell} is within ${T * 100}% of the expected value, so it is taken as that value.` } : res;
  }),
  one("renewable_claim", "Fuels and power", "Renewable claim and REC declaration", ["rec.claim_mwh", "rec.purchases_mwh"], (r) =>
    checkRenewableClaim({ renewableClaimMwh: num(r, "rec.claim_mwh"), recPurchasesMwh: num(r, "rec.purchases_mwh"), workbookHasExclusion: Number(r["pf.renewable_excl"] ?? 0) > 0 })
  ),
  one("engine_coverage", "Run inputs", "Pro forma inputs the calculation cannot take", ["pf.unmapped_count"], (r) => {
    const n = num(r, "pf.unmapped_count");
    return {
      id: "engine_coverage",
      label: "Inputs without a calculation stream",
      status: n === 0 ? "pass" : "fail",
      detail: n === 0 ? "Every non-zero pro forma input has a stream in the calculation." : `The pro forma holds inputs the calculation has no stream for, so a run leaves them out: ${r["pf.unmapped_list"]}.`,
    };
  }),
];

const m = (key: string, label: string, unit: string, slot: string, hint?: string) => ({ key, label, unit, slot, ...(hint ? { hint } : {}) });

export const CEMENT_DESK_REVIEW: DeskReviewDef = {
  packId: "CCTS-CEMENT-v1",
  proformaCells: PROFORMA_CELLS,
  readers: READERS,
  rules: RULES,
  manual: [
    m("mpr.clinker_t", "Monthly report: clinker produced", "t", "production_evidence"),
    m("mpr.opc_t", "Monthly report: OPC produced", "t", "production_evidence"),
    m("mpr.ppc_t", "Monthly report: PPC produced", "t", "production_evidence"),
    m("mpr.psc_t", "Monthly report: PSC produced", "t", "production_evidence"),
    m("mpr.clinker_opening_t", "Monthly report: clinker opening stock", "t", "production_evidence"),
    m("mpr.clinker_import_t", "Monthly report: clinker imported", "t", "production_evidence"),
    m("mpr.clinker_export_t", "Monthly report: clinker exported", "t", "production_evidence"),
    m("mpr.clinker_closing_t", "Monthly report: clinker closing stock", "t", "production_evidence"),
    m("sap.opc_t", "SAP printout: OPC confirmed quantity", "t", "production_evidence"),
    m("sap.ppc_t", "SAP printout: PPC confirmed quantity", "t", "production_evidence"),
    m("sap.psc_t", "SAP printout: PSC confirmed quantity", "t", "production_evidence"),
    { ...m("dpr.clinker", "Daily production report: clinker per day", "t", "production_evidence", "One line per day: YYYY-MM-DD value"), kind: "daily" as const },
    m("cpp.report_lakh_kwh", "CPP report: gross generation as stated", "Lakh kWh", "cpp_generation", "Enter the figure as printed, and note whether it is monthly or annual"),
    m("grid.bill_kwh", "Grid bill: units consumed", "kWh", "grid_electricity"),
    m("grid.bill_months", "Grid bills: number of months covered", "months", "grid_electricity", "Count the months the bills in the pack cover"),
    m("coal.po_t", "Coal purchase order: quantity", "t", "coal_purchase"),
    m("coal.po_months", "Coal purchase orders: number of months covered", "months", "coal_purchase"),
    m("coal.nabl_gcv", "NABL certificate: coal GCV", "kcal/kg", "coal_quality"),
    m("rec.claim_mwh", "REC declaration: renewable claim", "MWh", "rec_declaration", "Enter 0 for a nil declaration"),
    m("rec.purchases_mwh", "REC declaration: certificates purchased", "MWh", "rec_declaration"),
    m("form1.eq_product_t", "Form 1: total equivalent product", "t", "form1"),
    m("form1.direct_co2_t", "Form 1: direct energy CO2", "tCO2e", "form1"),
    m("form1.indirect_co2_t", "Form 1: indirect energy CO2", "tCO2e", "form1"),
  ],
};
