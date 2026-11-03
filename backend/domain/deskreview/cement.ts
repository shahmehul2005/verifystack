/**
 * Desk review for the CCTS cement pack: workbook readings, figures the auditor
 * types from PDFs, and the cross-checks between them. Slot ids are the cement
 * pack's evidence slots. An emission factor, a calcination factor, or a stock
 * figure is never invented here. A missing figure stays missing.
 */

import { DEFAULT_TOLERANCE } from "../compare/declared";
import {
  checkDailyAgreement,
  checkEvidenceCoverage,
  checkMassBalance,
  checkProductionDays,
  checkRecomputed,
  checkRenewableClaim,
  checkSumMatches,
  checkUnmappedFuel,
  clinkerConsumedForCement,
  type CheckResult,
} from "../crosscheck/tieout";
import { parseCellRef, type XlsxWorkbook } from "../intake/xlsx";
import { FIRST_TRAJECTORY_PROCESS_BASIS, fyLabelOf, inBasisWindow } from "../packs/emissionBasis";
import { evaluateWorkbook } from "../proforma/formula";
import type { ProformaInput } from "../proforma/types";
import { checkOxideFloor, stoichiometricCalcinationFloor } from "./calcinationChemistry";
import { benfordApplies, benfordFirstDigit, describeScreen, roundEndingShare, terminalDigitUniformity } from "./digitScreen";
import { checkWeighbridgeSlip, WEIGHBRIDGE_TOLERANCE_T } from "./documentConsistency";
import { BASIS_LABEL, convertCalorificValue, type MoistureBasis } from "./moistureBasis";
import {
  dailyColumn,
  dailyColumnReport,
  filledDates,
  isFilled,
  noteDailyColumn,
  thinMonths,
  type DailyRow,
  months,
  num,
  series,
  type DeskReviewDef,
  type DeskRule,
  type MaterialityPosition,
  type Readings,
  type WorkbookReader,
} from "./engine";

const T = DEFAULT_TOLERANCE;
const T_SRC = "DEFAULT_TOLERANCE (product comparison tolerance)";
const LAKH = 100000;
const TONNE_BAND = 0.5;
const KWH_BAND = 1;
const MATERIALITY = 0.02;
const MATERIALITY_SOURCE =
  "CCTS Detailed Procedure: materiality threshold of 2% of total reported emissions for the reporting period (ICAI-hosted copy; confirm against the BEE original).";
const GCV_SAMPLE_SOURCE =
  "CCTS Detailed Procedure, solid fuel sampling (every 20,000 t or monthly, whichever is more often), as read from the ICAI-hosted copy.";
/** Detailed Procedure clause 4(10)(ii): coal deviation between internal and NABL results, kcal/kg. */
const NABL_GCV_BAND_KCAL = 71.7;
const NABL_GCV_SOURCE =
  "Detailed Procedure for Compliance Mechanism under the Indian Carbon Market, clause 4(10)(ii)-(iii), p. 14: " +
  "internal and NABL results for coal should deviate by less than 71.7 kcal/kg (ISO 1928:1995(E)), and an excess is added " +
  "to the internal lab's analysed parameter for that quarter. Clause 4(10)(i) says external tests are quarterly and " +
  "4(10)(v) says at least monthly; the source is inconsistent, so the cadence is not tested here.";
/**
 * How far the total moisture on the certificate and in the internal log may differ before
 * the two calorific values stop describing the same coal. A screening default of this
 * product, not a figure from the procedure: the procedure assumes both results are on the
 * same basis and says nothing about checking that they are.
 */
const NABL_MOISTURE_BAND_PCT = 0.5;
const FORMULA_NOTE = "This is the formula set taken from the sector pro forma structure, not a BEE-issued blank file.";
const NOT_CONSUMPTION = "The purchase order is not consumption.";

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
  pf("pf.fuel_oil_t", "ghg", "^Fuel Oil Consumed", "t"),
  pf("pf.gcv_coal", "ghg", "^GCV\\s*(of\\s*)?Coal", "kcal/kg"),
  pf("pf.coal_energy_tj", "ghg", "^Coal Energy", "TJ"),
  pf("pf.fuel_oil_energy_tj", "ghg", "^Fuel Oil Energy", "TJ"),
  pf("pf.ef_coal", "ghg", "^EF Coal", "tCO2e/TJ"),
  pf("pf.ef_fuel_oil", "ghg", "^EF Fuel Oil", "tCO2e/TJ"),
  pf("pf.direct_co2", "ghg", "^Direct GHG", "tCO2e"),
  pf("pf.indirect_co2", "ghg", "^Indirect GHG", "tCO2e"),
  pf("pf.total_co2", "ghg", "^TOTAL Direct\\s*&\\s*Indirect", "tCO2e"),
  pf("pf.s2_process_coal_t", "energy", "^Coal Consumed.*Process", "t", LAKH),
  pf("pf.s2_power_coal_t", "energy", "^Coal Consumed.*Power", "t", LAKH),
  pf("pf.s2_fuel_oil_t", "energy", "^Fuel Oil Consumed", "t", LAKH),
  pf("pf.s2_grid_import_kwh", "energy", "^Import from Grid", "kWh", LAKH),
  pf("pf.s2_grid_export_kwh", "energy", "^Export(?:ed)? to Grid", "kWh", LAKH),
  // Rows that may not exist. Their absence is the finding.
  pf("pf.petcoke_t", ".", "petcoke|pet coke", "t"),
  pf("pf.renewable_excl", ".", "renewable|exclu", "kWh"),
];

/**
 * Green-cell formulas observed on the Shyamrock sector pro forma. Not a BEE blank.
 *
 * `label` is the row label the workbook prints in column A for that cell. A cell is
 * checked only where the workbook shows the expected label at the expected address:
 * that is how the check knows the file is this template and the cell is that cell. On a
 * workbook laid out differently the cell is simply not part of this template, and the
 * rule reports that instead of calling every cell "overwritten".
 */
export const CEMENT_PROFORMA_FORMULAS: { sheet: string; ref: string; formula: string; label: RegExp }[] = [
  { sheet: "1_Production", ref: "B17", formula: "B9*B12/B13", label: /^\(i\)\s*Eq\.?\s*Major Product from OPC/i },
  { sheet: "1_Production", ref: "B18", formula: "B10*B13/B13", label: /^\(ii\)\s*Eq\.?\s*Major Product from PPC/i },
  { sheet: "1_Production", ref: "B19", formula: "B11*B14/B13", label: /^\(iii\)\s*Eq\.?\s*Major Product from PSC/i },
  { sheet: "1_Production", ref: "B20", formula: "B7/B13", label: /Major Product from Exported Clinker/i },
  { sheet: "1_Production", ref: "B21", formula: "B17+B18+B19+B20", label: /TOTAL Equivalent Major Product/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B22", formula: "(B6+B7)*B9*100+B8*B10*100-B12*2717/10", label: /Total Thermal Energy Consumption/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B23", formula: "B11*860/10", label: /Energy for Imported Electricity/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B24", formula: "B11*(3208-860)/10", label: /Notional Energy.*Imported Electricity/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B25", formula: "(B11*3208+B13*B15+B14*B16)/(B11+B13+B14)", label: /Weighted Avg Heat Rate/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B26", formula: "'1_Production'!B20*B19*B25/10", label: /Notional Energy.*Grinding Exported Clinker/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B27", formula: "'1_Production'!B8*(B17*1000+B18*B25)/10", label: /Notional Energy.*Clinkerisation of Imported Clinker/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B28", formula: "B22+B23+B24+B26+B27", label: /Gate-to-Gate Energy Consumption/i },
  { sheet: "2_Energy_GtG_SEC", ref: "B29", formula: "B28/('1_Production'!B21*100)", label: /Gate-to-Gate SEC/i },
  { sheet: "3_GHG_CCTS", ref: "B18", formula: "B6*1000*B8*B10*B13", label: /^Coal Energy/i },
  { sheet: "3_GHG_CCTS", ref: "B19", formula: "B7*1000*B9*B10*B13", label: /^Fuel Oil Energy/i },
  { sheet: "3_GHG_CCTS", ref: "B20", formula: "B18*B11+B19*B12", label: /^Direct GHG Emissions/i },
  { sheet: "3_GHG_CCTS", ref: "B21", formula: "B14*100000/1000*B15", label: /^Indirect GHG Emissions/i },
  { sheet: "3_GHG_CCTS", ref: "B22", formula: "B20+B21", label: /^TOTAL Direct/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B5", formula: "'1_Production'!B21*100000", label: /^Total Equivalent Product/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B6", formula: "('2_Energy_GtG_SEC'!B22+'2_Energy_GtG_SEC'!B23)/('1_Production'!B21*100)", label: /Without Normali[sz]ation/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B7", formula: "'2_Energy_GtG_SEC'!B29", label: /Normali[sz]ed.*GtG SEC/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B8", formula: "'3_GHG_CCTS'!B20", label: /^Direct GHG Emissions/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B9", formula: "'3_GHG_CCTS'!B21", label: /^Indirect GHG Emissions/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B10", formula: "'3_GHG_CCTS'!B22", label: /^Total Direct/i },
  { sheet: "4_Summary_Form1_Feed", ref: "B11", formula: "B10/B5", label: /^Specific GHG Emissions/i },
];

const sum = (rows: { value: unknown }[]) => rows.reduce((a, r) => a + Number(r.value ?? 0), 0);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function plain(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

/** A figure at an explicit number of decimals, for values too fine to round to three places. */
function fixed(n: number, decimals: number): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : String(n);
}

function normFormula(formula: string): string {
  return formula.trim().replace(/^=/, "").replace(/\s+/g, "");
}

function mentionsCell(formula: string, ref: string): boolean {
  if (!formula || !ref) return false;
  const cell = ref.replace(/\$/g, "").toUpperCase();
  return new RegExp(`(?:^|[^A-Z0-9_])\\$?${cell}(?![A-Z0-9])`, "i").test(normFormula(formula));
}

function subtractsCell(formula: string, formulaSheet: string, targetSheet: string, targetRef: string): boolean {
  if (!formula || !targetRef) return false;
  const f = normFormula(formula);
  const cell = targetRef.replace(/\$/g, "").toUpperCase();
  const same = !targetSheet || !formulaSheet || targetSheet.toLowerCase() === formulaSheet.toLowerCase();
  if (same) return new RegExp(`-\\$?${cell}(?![A-Z0-9])`, "i").test(f);
  const name = targetSheet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`-(?:'${name}'!|${name}!)\\$?${cell}(?![A-Z0-9])`, "i").test(f);
}

interface LabelHit {
  sheet: string;
  ref: string;
  label: string;
  formula: string | null;
}

function labelHits(wb: XlsxWorkbook, sheetRe: RegExp | null, labelRe: RegExp): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const s of wb.sheets) {
    if (sheetRe && !sheetRe.test(s.name)) continue;
    for (const labelCell of s.cells) {
      if (labelCell.col !== 1 || typeof labelCell.value !== "string" || !labelRe.test(labelCell.value)) continue;
      const cell = s.cells
        .filter((c) => c.row === labelCell.row && c.col > 1 && (typeof c.value === "number" || c.formula))
        .sort((a, b) => a.col - b.col)[0];
      if (!cell) continue;
      hits.push({ sheet: s.name, ref: cell.ref.toUpperCase(), label: labelCell.value, formula: cell.formula ?? null });
    }
  }
  return hits;
}

function annotateCementProforma(wb: XlsxWorkbook): Readings {
  const out: Readings = {};
  const first = (sheetRe: RegExp | null, labelRe: RegExp) => labelHits(wb, sheetRe, labelRe)[0] ?? null;
  const coalEnergy = first(/ghg/i, /^Coal Energy\b/i);
  const ncv = first(/ghg/i, /GCV\s*->\s*NCV/i);
  const indirect = first(/ghg/i, /^Indirect GHG\b/i);
  const gridImport = first(/ghg/i, /^Grid Import\b/i);
  const gridExport = first(/energy/i, /^Export(?:ed)? to Grid\b/i);
  out["pf.coal_energy_formula"] = coalEnergy?.formula ?? "";
  out["pf.gcv_ncv_ref"] = ncv?.ref ?? "";
  out["pf.indirect_formula"] = indirect?.formula ?? "";
  out["pf.indirect_sheet"] = indirect?.sheet ?? "";
  out["pf.grid_import_ref"] = gridImport?.ref ?? "";
  out["pf.grid_export_ref"] = gridExport?.ref ?? "";
  out["pf.grid_export_sheet"] = gridExport?.sheet ?? "";

  const ev = evaluateWorkbook(wb);
  const calc = first(null, /calcination/i);
  const calcValue = calc ? ev.value(calc.sheet, calc.ref) : null;
  if (calc && calcValue !== null) {
    out["pf.calcination_state"] = "quantified";
    out["pf.calcination_co2"] = calcValue;
  } else {
    out["pf.calcination_state"] = "missing";
  }

  const petcokeCo2 = labelHits(wb, null, /pet\s*coke/i).find((hit) => /co2|emission/i.test(hit.label));
  const petValue = petcokeCo2 ? ev.value(petcokeCo2.sheet, petcokeCo2.ref) : null;
  if (petcokeCo2 && petValue !== null) {
    out["pf.petcoke_has_emission"] = 1;
    out["pf.petcoke_co2"] = petValue;
  } else {
    out["pf.petcoke_has_emission"] = 0;
  }

  // The label the workbook prints beside each template cell. The formula-integrity rule
  // compares a cell's formula only where this label confirms the cell is the one it expects.
  for (const spec of CEMENT_PROFORMA_FORMULAS) {
    const at = parseCellRef(spec.ref);
    const sheet = wb.sheets.find((s) => s.name === spec.sheet);
    const label = at && sheet?.cells.find((c) => c.col === 1 && c.row === at.row)?.value;
    if (typeof label === "string") out[`pf.label@${spec.sheet}!${spec.ref}`] = label;
  }
  return out;
}

/** Sum and month count of one dated column, as readings `<prefix>.<name>_sum`. */
function column(
  sheet: Parameters<WorkbookReader["read"]>[0],
  header: string,
  key: string,
  out: Readings,
  note?: (message: string) => void,
  keepDaily = false,
  aliases: readonly string[] = []
) {
  const report = dailyColumnReport(sheet, header, aliases);
  if (!report) return null;
  noteDailyColumn(report, header, note);
  // A cell holding text ("-", "NA", "n/a") is not a figure. Left in, it would turn the total into NaN
  // and a check that compares it could pass on nothing, so it is left out and the page says so.
  const unreadable = report.rows.filter((r) => isFilled(r.value) && cellNumber(r.value) === null);
  if (unreadable.length > 0 && note) {
    const first = unreadable[0]!;
    note(`${unreadable.length} cell(s) under "${header}" hold text and not a number (first: ${first.date}, "${String(first.value)}"), so they are left out of the total, the daily series and the months of evidence.`);
  }
  const rows = report.rows.filter((r) => !isFilled(r.value) || cellNumber(r.value) !== null);
  out[`${key}_sum`] = Math.round(sum(rows.map((r) => ({ value: cellNumber(r.value) ?? 0 }))) * 1e6) / 1e6;
  // A dated row with nothing in it is not a day of zero output, so it stays out of the daily series.
  if (keepDaily) for (const r of rows) if (isFilled(r.value)) out[`${key}@${r.date}`] = cellNumber(r.value)!;
  return rows;
}

/** A cell as a number: a figure, or text such as "1,234.5". Null for anything else. */
function cellNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const text = v.replace(/,/g, "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The thin months a reader recorded for a series, or none when the run predates the reading. */
function thinList(r: Readings, prefix: string): string[] {
  const v = r[`${prefix}.thin_months`];
  return typeof v === "string" && v !== "" ? v.split(", ") : [];
}

/** Months with evidence, and the months too sparse to count, for the coverage checks. */
function coverageReadings(prefix: string, rows: DailyRow[], out: Readings) {
  const dates = filledDates(rows);
  out[`${prefix}.months`] = months(dates);
  out[`${prefix}.thin_months`] = thinMonths(dates).join(", ");
  const sorted = [...dates].sort();
  if (sorted.length > 0) {
    out[`${prefix}.first_date`] = sorted[0]!;
    out[`${prefix}.last_date`] = sorted[sorted.length - 1]!;
  }
}

const READERS: WorkbookReader[] = [
  {
    slot: "production_evidence",
    read(sheet, note) {
      const out: Readings = {};
      // Plants print the same column under several names. Each list is only the
      // spellings of that one quantity, so "Clinker Factor" never matches here.
      const clinker = column(
        sheet,
        "Clinker Production (t)",
        "scada.clinker",
        out,
        note,
        true,
        ["Clinker Output (t)", "Clinker Produced (t)", "Clinker (t)", "Daily Clinker Production (t)"]
      );
      if (!clinker) return {};
      coverageReadings("scada", clinker, out);
      column(sheet, "OPC Produced (t)", "scada.opc", out, note, false, ["OPC Output (t)", "OPC (t)", "Cement - OPC (t)"]);
      column(sheet, "PPC Produced (t)", "scada.ppc", out, note, false, ["PPC Output (t)", "PPC (t)", "Cement - PPC (t)"]);
      column(sheet, "PSC Produced (t)", "scada.psc", out, note, false, ["PSC Output (t)", "PSC (t)", "Cement - PSC (t)"]);
      const status = dailyColumn(sheet, "Kiln Run Status", ["Kiln Status", "Kiln State", "Operating Status"]);
      for (const r of status ?? []) out[`scada.status@${r.date}`] = String(r.value ?? "");
      return out;
    },
  },
  {
    slot: "cpp_generation",
    read(sheet, note) {
      const out: Readings = {};
      const rows = column(sheet, "Gross Generation (kWh)", "cpp.kwh", out, note, false, [
        "Gross Generation (kWh)",
        "Gross Output (kWh)",
        "Generation (kWh)",
      ]);
      if (rows) coverageReadings("cpp", rows, out);
      return out;
    },
  },
  {
    slot: "petcoke_log",
    read(sheet, note) {
      const out: Readings = {};
      const coal = column(sheet, "Coal Consumed (t)", "petcoke.coal_t", out, note, false, [
        "Coal Input (t)",
        "Coal Consumed (t)",
        "Coal Feed (t)",
      ]);
      column(sheet, "Petcoke Consumed (t)", "petcoke.petcoke_t", out, note, false, [
        "Petcoke Input (t)",
        "Petcoke Consumed (t)",
        "Petcoke Feed (t)",
      ]);
      // A register that records the petcoke share of kiln fuel per posting date.
      const share = dailyColumn(sheet, "Petcoke Share of Kiln Fuel (%)", ["Petcoke Share (%)", "Petcoke Share of Kiln Fuel"]);
      if (share) {
        const values = share.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
        if (values.length > 0) out["petcoke.share_pct_mean"] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
      }
      if (coal) coverageReadings("petcoke", coal, out);
      return out;
    },
  },
  {
    slot: "coal_quality",
    read(sheet) {
      // The internal lab prints one row per sample, not one row per day, so the
      // date column is the sample date and the GCV column is the analysed value.
      const rows = dailyColumn(sheet, "GCV (kcal/kg)", ["GCV", "Gross Calorific Value (kcal/kg)", "GCV ARB (kcal/kg)"]);
      if (!rows) return {};
      const dated = rows.filter((r) => Number.isFinite(Number(r.value)) && Number(r.value) > 0);
      const vals = dated.map((r) => Number(r.value));
      const out: Readings = {};
      if (vals.length) {
        out["lab.gcv_mean"] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
        out["lab.gcv_n"] = vals.length;
        out["lab.gcv_months"] = months(dated.map((r) => r.date));
        const labDates = dated.map((r) => r.date).sort();
        out["lab.first_date"] = labDates[0]!;
        out["lab.last_date"] = labDates[labDates.length - 1]!;
        // A sample the lab measured and the workbook left out is only visible if the
        // sample itself is kept, so each dated GCV is a reading of its own.
        for (const r of dated) {
          if (Number(r.value) > 0) out[`lab.gcv@${r.date}`] = Number(r.value);
        }
      }
      // Moisture and ash decide whether a calorific value is on an as-received or a
      // dried basis, and a proximate analysis has to close to 100%.
      const means = meanOf(sheet, ["Moisture (%)", "Total Moisture (%)"], ["Ash (%)", "Ash Content (%)"], ["Hydrogen (%)", "H (%)"]);
      if (means.moisture !== null) out["lab.moisture_mean_pct"] = means.moisture;
      if (means.ash !== null) out["lab.ash_mean_pct"] = means.ash;
      if (means.hydrogen !== null) out["lab.hydrogen_mean_pct"] = means.hydrogen;
      return out;
    },
  },
];

/** Column mean for each of a named set of columns, or null where the column is absent. */
function meanOf(
  sheet: Parameters<WorkbookReader["read"]>[0],
  ...columns: readonly string[][]
): { moisture: number | null; ash: number | null; hydrogen: number | null } {
  const mean = (names: string[]) => {
    for (const name of names) {
      const rows = dailyColumn(sheet, name);
      if (!rows) continue;      const values = rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
      if (values.length > 0) return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    }
    return null;
  };
  return {
    moisture: mean(columns[0] ?? []),
    ash: mean(columns[1] ?? []),
    hydrogen: mean(columns[2] ?? []),
  };
}

const one = (id: string, section: string, label: string, needs: string[], f: (r: Readings) => CheckResult): DeskRule => ({
  id,
  section,
  label,
  needs,
  evaluate: f,
});

/**
 * A check whose inputs a pack may not carry at all. A missing reading makes it
 * not applicable rather than pending: pending means "waiting for a reading someone
 * is expected to enter", and an engagement without a clinker chemistry report or a
 * weighbridge slip would otherwise wait forever.
 */
const optional = (id: string, section: string, label: string, needs: string[], f: (r: Readings) => CheckResult): DeskRule => ({
  id,
  section,
  label,
  needs: [],
  evaluate: (r) => {
    const present = needs.every((k) => k in r);
    if (!present) {
      return {
        id,
        label,
        status: "not_applicable",
        detail: `Not checked: this pack has no ${needs.filter((k) => !(k in r)).join(", ")}. Enter them from the evidence to run this check.`,
      };
    }
    return f(r);
  },
});

/** Parse one of the four moisture bases an auditor may type, tolerating case and spaces. */
function parseBasis(text: Readings[string]): MoistureBasis {
  const t = String(text ?? "").trim().toUpperCase();
  if (t === "ARB" || t.includes("AS RECEIVED") || t.includes("AS-RECEIVED")) return "ARB";
  if (t === "ADB" || t.includes("AIR DRIED") || t.includes("AIR-DRIED")) return "ADB";
  if (t === "DB" || t.includes("DRY BASIS")) return "DB";
  return "NA";
}

function emissionPortions(r: Readings) {
  const coal = round6(num(r, "pf.coal_energy_tj") * num(r, "pf.ef_coal"));
  const fuelOil = round6(num(r, "pf.fuel_oil_energy_tj") * num(r, "pf.ef_fuel_oil"));
  const direct = round6(num(r, "pf.direct_co2"));
  const indirect = round6(num(r, "pf.indirect_co2"));
  return { coal, fuelOil, direct, indirect, misstatement: round6(direct - coal) };
}

function reportedTotal(r: Readings): number {
  if ("pf.total_co2" in r && Number.isFinite(num(r, "pf.total_co2"))) return num(r, "pf.total_co2");
  return num(r, "pf.direct_co2") + num(r, "pf.indirect_co2");
}

function sourceGaps(r: Readings) {
  const logged = "petcoke.petcoke_t_sum" in r ? num(r, "petcoke.petcoke_t_sum") : 0;
  const cell = "pf.petcoke_t" in r ? num(r, "pf.petcoke_t") : 0;
  const petcokeT = Math.max(logged, cell);
  const petcokeCo2 = num(r, "pf.petcoke_has_emission") === 1 && Number.isFinite(num(r, "pf.petcoke_co2")) ? num(r, "pf.petcoke_co2") : null;
  const calcinationCo2 =
    r["pf.calcination_state"] === "quantified" && Number.isFinite(num(r, "pf.calcination_co2")) ? num(r, "pf.calcination_co2") : null;
  // The engagement's compliance year, placed by the route as `ctx.fy_start`. When it is absent
  // or unreadable the period is unknown, so calcination keeps the stricter treatment.
  const fyStart = typeof r["ctx.fy_start"] === "number" ? (r["ctx.fy_start"] as number) : null;
  const calcinationOutOfBasis = inBasisWindow(FIRST_TRAJECTORY_PROCESS_BASIS, fyStart);
  return {
    petcokeT,
    petcokeCo2,
    petcokeGap: petcokeT > 0 && petcokeCo2 === null,
    calcinationCo2,
    calcinationOutOfBasis,
    fyLabel: fyStart === null ? null : fyLabelOf(fyStart),
    // Process emissions are outside the intensity basis for FY2024-25 to FY2026-27
    // (Detailed Procedure Section 3.4(1) Note, p. 7). A missing figure is then not a gap.
    calcinationGap: calcinationCo2 === null && !calcinationOutOfBasis,
  };
}

/**
 * The aggregate position, in one place for the check and the page banner.
 * Fuel oil has an engine stream, so it is not a misstatement. What is left is
 * whatever the workbook's direct total holds beyond coal and fuel oil.
 */
function materialityPosition(r: Readings) {
  const { fuelOil, misstatement } = emissionPortions(r);
  const remainder = round6(misstatement - fuelOil);
  const quantified = Math.abs(remainder) > TONNE_BAND ? Math.abs(remainder) : 0;
  const total = round6(reportedTotal(r));
  return { quantified, total, threshold: round6(total * MATERIALITY) };
}

function cementMateriality(r: Readings): MaterialityPosition | null {
  const need = ["pf.direct_co2", "pf.indirect_co2", "pf.coal_energy_tj", "pf.ef_coal", "pf.fuel_oil_energy_tj", "pf.ef_fuel_oil"];
  if (need.some((k) => !(k in r))) return null;
  const { quantified, total, threshold } = materialityPosition(r);
  const gaps = sourceGaps(r);
  const limitations: string[] = [];
  if (gaps.calcinationGap) limitations.push("Calcination CO2 is missing: no workbook cell and no fact. Process emissions are not in the total.");
  if (gaps.petcokeGap) limitations.push(`Petcoke is ${plain(gaps.petcokeT)} t with no emission calculation.`);
  return { reportedTotal: total, fraction: MATERIALITY, threshold, quantified, limitations };
}

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
    return checkDailyAgreement({ id: "dpr_scada", label: "DPR vs SCADA", rows, relTolerance: T, thresholdSource: T_SRC });
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
  one(
    "form1_direct",
    "Form 1 against the pro forma",
    "Form 1 direct energy CO2",
    ["pf.direct_co2", "form1.direct_co2_t", "pf.coal_energy_tj", "pf.ef_coal", "pf.fuel_oil_energy_tj", "pf.ef_fuel_oil"],
    (r) => {
      // The two direct streams the pack carries: coal and furnace oil. Both come from the
      // workbook's own energy and factor cells, recomputed by code.
      const { coal, fuelOil } = emissionPortions(r);
      return checkRecomputed({
        id: "form1_direct",
        label: "Form 1 direct CO2 vs the coal and fuel-oil recalculation",
        claimed: num(r, "form1.direct_co2_t"),
        recomputed: round6(coal + fuelOil),
        relTolerance: T,
        thresholdSource: `${T_SRC}. Recalculation: coal ${plain(coal)} t + fuel oil ${plain(fuelOil)} t, from the pro forma's own factors.`,
      });
    }
  ),
  one("form1_indirect", "Form 1 against the pro forma", "Form 1 indirect energy CO2", ["pf.indirect_co2", "form1.indirect_co2_t"], (r) =>
    checkRecomputed({ id: "form1_indirect", label: "Form 1 indirect CO2 vs pro forma (recomputed)", claimed: num(r, "form1.indirect_co2_t"), recomputed: num(r, "pf.indirect_co2"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("coverage_clinker", "Annual figures and evidence coverage", "Clinker: months of evidence behind the annual cell", ["scada.months", "pf.clinker_t", "scada.clinker_sum"], (r) =>
    checkEvidenceCoverage({ id: "cov_clinker", label: "Clinker production", monthsEvidenced: num(r, "scada.months"), periodMonths: 12, annualCell: num(r, "pf.clinker_t"), monthlyReading: num(r, "scada.clinker_sum"), thinMonths: thinList(r, "scada"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("coverage_cpp", "Annual figures and evidence coverage", "CPP generation: months of evidence", ["cpp.months", "pf.cpp_kwh", "cpp.kwh_sum"], (r) =>
    checkEvidenceCoverage({ id: "cov_cpp", label: "CPP generation", monthsEvidenced: num(r, "cpp.months"), periodMonths: 12, annualCell: num(r, "pf.cpp_kwh"), monthlyReading: num(r, "cpp.kwh_sum"), thinMonths: thinList(r, "cpp"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("coverage_grid", "Annual figures and evidence coverage", "Grid import: months of evidence", ["grid.bill_months", "pf.grid_kwh", "grid.bill_kwh"], (r) =>
    checkEvidenceCoverage({ id: "cov_grid", label: "Grid electricity", monthsEvidenced: num(r, "grid.bill_months"), periodMonths: 12, annualCell: num(r, "pf.grid_kwh"), monthlyReading: num(r, "grid.bill_kwh"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("coverage_coal", "Annual figures and evidence coverage", "Coal: months of evidence from the consumption log", ["petcoke.months", "pf.coal_t", "petcoke.coal_t_sum"], (r) =>
    checkEvidenceCoverage({ id: "cov_coal", label: "Coal consumed", monthsEvidenced: num(r, "petcoke.months"), periodMonths: 12, annualCell: num(r, "pf.coal_t"), monthlyReading: num(r, "petcoke.coal_t_sum"), thinMonths: thinList(r, "petcoke"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("evidence_period", "Annual figures and evidence coverage", "Evidence dates fall inside the compliance year", ["scada.first_date", "scada.last_date"], (r) => {
    const fy = typeof r["ctx.fy_start"] === "number" ? (r["ctx.fy_start"] as number) : null;
    if (fy === null) {
      return {
        id: "evidence_period",
        label: "Evidence dates fall inside the compliance year",
        status: "not_applicable",
        detail: "The engagement's compliance year is not an FY range this check can place (for example FY2026-27), so the dates in the evidence cannot be compared with it.",
      };
    }
    const start = `${fy}-04-01`;
    const end = `${fy + 1}-03-31`;
    const series: [string, string][] = [
      ["SCADA production", "scada"],
      ["CPP generation", "cpp"],
      ["Petcoke and coal log", "petcoke"],
      ["Lab GCV samples", "lab"],
    ];
    const outside: string[] = [];
    const inside: string[] = [];
    for (const [name, prefix] of series) {
      const first = r[`${prefix}.first_date`];
      const last = r[`${prefix}.last_date`];
      if (typeof first !== "string" || typeof last !== "string") continue;
      const text = `${name} ${first} to ${last}`;
      (first < start || last > end ? outside : inside).push(text);
    }
    const label = fyLabelOf(fy);
    return {
      id: "evidence_period",
      label: "Evidence dates fall inside the compliance year",
      status: outside.length > 0 ? "fail" : "pass",
      detail:
        outside.length > 0
          ? `${label} runs ${start} to ${end}. Dated rows outside it: ${outside.join("; ")}. ` +
            `Evidence from another period cannot support this year's figures, and the other period may sit under a different intensity basis. ` +
            (inside.length ? `Inside the year: ${inside.join("; ")}.` : "")
          : `${label} runs ${start} to ${end}. Every dated series sits inside it: ${inside.join("; ")}.`,
      actual: outside.length,
      expected: 0,
      thresholdSource: "Compliance year of the engagement (financial year, 1 April to 31 March)",
    };
  }),
  one(
    "coal_stock_balance",
    "Fuels and power",
    "Coal stock identity against the consumption log",
    ["coal.opening_t", "coal.receipts_t", "coal.issues_t", "coal.closing_t", "petcoke.coal_t_sum"],
    (r) => {
      const opening = num(r, "coal.opening_t");
      const receipts = num(r, "coal.receipts_t");
      const issues = num(r, "coal.issues_t");
      const closing = num(r, "coal.closing_t");
      const log = num(r, "petcoke.coal_t_sum");
      // The ledger closes when opening + receipts − issues − closing is 0. Issues are the consumption.
      const residual = round6(opening + receipts - issues - closing);
      const diff = round6(issues - log);
      const pass = Math.abs(residual) <= TONNE_BAND + 1e-9 && Math.abs(diff) <= TONNE_BAND + 1e-9;
      return {
        id: "coal_stock_balance",
        label: "Coal stock identity against the consumption log",
        status: pass ? "pass" : "fail",
        detail:
          `Opening ${plain(opening)} t + receipts ${plain(receipts)} t − issues ${plain(issues)} t − closing ${plain(closing)} t = ${plain(residual)} t. ` +
          `Issues compared with the petcoke-log coal sum ${plain(log)} t for the evidenced period; difference ${plain(diff)} t. ` +
          `Allowed band ${plain(TONNE_BAND)} t. ${NOT_CONSUMPTION}`,
        actual: issues,
        expected: log,
        diff,
        thresholdSource: "Rounding band 0.5 t",
      };
    }
  ),
  one("coal_weighfeeder", "Fuels and power", "Weigh-feeder total against the consumption log", ["coal.weighfeeder_t", "petcoke.coal_t_sum"], (r) =>
    checkSumMatches({
      id: "coal_weighfeeder",
      label: "Weigh-feeder vs consumption log",
      parts: [num(r, "coal.weighfeeder_t")],
      target: num(r, "petcoke.coal_t_sum"),
      absTolerance: TONNE_BAND,
      thresholdSource: "Rounding band 0.5 t",
    })
  ),
  one("cpp_report_vs_proforma", "Fuels and power", "CPP report generation vs pro forma", ["cpp.report_lakh_kwh", "pf.cpp_kwh"], (r) =>
    checkSumMatches({ id: "cpp_report", label: "CPP report vs pro forma", parts: [num(r, "cpp.report_lakh_kwh") * LAKH], target: num(r, "pf.cpp_kwh"), relTolerance: T, thresholdSource: T_SRC })
  ),
  one("petcoke_cell", "Fuels and power", "Petcoke logged but absent from the pro forma", ["petcoke.petcoke_t_sum", "pf.eq_product_t"], (r) =>
    checkUnmappedFuel({ id: "petcoke", label: "Petcoke", tonnes: num(r, "petcoke.petcoke_t_sum"), workbookHasCell: "pf.petcoke_t" in r })
  ),
  one("gcv_samples", "Fuels and power", "Coal GCV sample frequency", ["lab.gcv_n", "lab.gcv_months", "pf.coal_t"], (r) => {
    const samples = num(r, "lab.gcv_n");
    const covered = num(r, "lab.gcv_months");
    const tonnes = num(r, "pf.coal_t");
    if (!Number.isFinite(samples) || !Number.isFinite(covered) || !Number.isFinite(tonnes)) {
      return { id: "gcv_samples", label: "Coal GCV sample frequency", status: "not_applicable", detail: "The lab sample count or the GHG-sheet coal tonnes could not be read." };
    }
    const byTonnes = Math.ceil(tonnes / 20_000);
    const monthsShort = covered < 12;
    const samplesShort = samples < byTonnes;
    const fail = monthsShort || samplesShort;
    return {
      id: "gcv_samples",
      label: "Coal GCV sample frequency",
      status: fail ? "fail" : "pass",
      detail:
        `The lab file has ${plain(samples)} dated GCV sample(s) in ${plain(covered)} distinct month(s). ` +
        `Coal on the GHG sheet is ${plain(tonnes)} t. Required frequency is at least once a month and at least once per 20,000 t, whichever is more often, over a 12-month period: ` +
        `${plain(covered)} of 12 month(s), and ${plain(samples)} sample(s) against ceil(annual tonnes / 20000) = ${plain(byTonnes)}. ` +
        (monthsShort ? "The lab file covers fewer months than 12. " : "") +
        (samplesShort ? "The lab file has fewer samples than the throughput rule. " : "") +
        (fail ? "" : "Both the monthly coverage and the throughput count are met."),
      actual: samples,
      expected: byTonnes,
      thresholdSource: GCV_SAMPLE_SOURCE,
    };
  }),
  one("gcv_ncv_used", "Fuels and power", "Coal energy formula uses the GCV-to-NCV factor", ["pf.proforma_opened", "pf.coal_energy_formula", "pf.gcv_ncv_ref"], (r) => {
    const formula = String(r["pf.coal_energy_formula"] ?? "");
    const ref = String(r["pf.gcv_ncv_ref"] ?? "");
    if (!formula) {
      return { id: "gcv_ncv_used", label: "Coal energy uses GCV-to-NCV", status: "not_applicable", detail: "The coal energy formula cell cannot be read." };
    }
    if (!ref) {
      return {
        id: "gcv_ncv_used",
        label: "Coal energy uses GCV-to-NCV",
        status: "not_applicable",
        detail: "The GCV-to-NCV factor cell cannot be read, so the coal energy formula cannot be checked against it.",
      };
    }
    const used = mentionsCell(formula, ref);
    return {
      id: "gcv_ncv_used",
      label: "Coal energy uses GCV-to-NCV",
      status: used ? "pass" : "fail",
      detail: used
        ? `The coal energy formula ${formula} references the GCV-to-NCV cell ${ref}.`
        : `The coal energy formula ${formula} uses GCV only. It does not reference the GCV-to-NCV cell ${ref}.`,
    };
  }),
  one("gcv_nabl_corroboration", "Fuels and power", "NABL coal GCV corroboration", ["lab.gcv_mean", "coal.nabl_gcv", "pf.gcv_coal"], (r) => {
    // A certificate on a dried basis reads higher than the same coal as burned. Set beside the internal
    // log's as-fired mean it would fail for the water alone, so the basis check compares them instead.
    const certBasis = "coal.nabl_basis" in r ? parseBasis(r["coal.nabl_basis"]) : null;
    if (certBasis === "ADB" || certBasis === "DB") {
      return {
        id: "gcv_nabl_corroboration",
        label: "NABL coal GCV corroboration",
        status: "not_applicable",
        detail: `The NABL certificate states its GCV on the ${BASIS_LABEL[certBasis]}, so it cannot be set directly beside the internal log's as-fired mean. The moisture-basis check compares them after converting the certificate.`,
      };
    }
    const internal = num(r, "lab.gcv_mean");
    const external = num(r, "coal.nabl_gcv");
    const cell = num(r, "pf.gcv_coal");
    const deviation = round6(Math.abs(external - internal));
    const exceeds = deviation > NABL_GCV_BAND_KCAL + 1e-9;
    return {
      id: "gcv_nabl_corroboration",
      label: "NABL coal GCV corroboration",
      status: exceeds ? "fail" : "pass",
      detail:
        `Internal lab mean ${plain(internal)} kcal/kg, NABL ${plain(external)} kcal/kg, deviation ${plain(deviation)} kcal/kg against the ${plain(NABL_GCV_BAND_KCAL)} kcal/kg band. ` +
        (exceeds
          ? `The deviation is over the band. The Procedure adds the difference to the internal lab's analysed parameter for that quarter, so the internal figure cannot stand as it is. ` +
            `The Procedure does not say whether "the difference" is signed, so no corrected GCV is computed here; it is an open item for the engagement. `
          : `The deviation is inside the band, so the internal samples stand. `) +
        `Workbook GCV cell ${plain(cell)} kcal/kg. The Procedure compares quarter by quarter; this check uses the mean of every dated sample in the lab file against the one certificate, ` +
        `so it is a screen and not the quarterly reconciliation. It does not replace the sample-frequency rule.`,
      actual: internal,
      expected: external,
      diff: round6(internal - external),
      thresholdSource: NABL_GCV_SOURCE,
    };
  }),
  one("renewable_claim", "Fuels and power", "Renewable claim and REC declaration", ["rec.claim_mwh", "rec.purchases_mwh"], (r) =>
    checkRenewableClaim({ renewableClaimMwh: num(r, "rec.claim_mwh"), recPurchasesMwh: num(r, "rec.purchases_mwh"), workbookHasExclusion: Number(r["pf.renewable_excl"] ?? 0) > 0 })
  ),
  one("sheet2_coal_tie", "Sheet 2 completeness", "Process plus power coal vs GHG-sheet coal", ["pf.s2_process_coal_t", "pf.s2_power_coal_t", "pf.coal_t"], (r) =>
    checkSumMatches({
      id: "sheet2_coal_tie",
      label: "Sheet 2 process plus power coal vs GHG coal",
      parts: [num(r, "pf.s2_process_coal_t"), num(r, "pf.s2_power_coal_t")],
      target: num(r, "pf.coal_t"),
      absTolerance: TONNE_BAND,
      thresholdSource: "Rounding band 0.5 t",
    })
  ),
  one("sheet2_fuel_oil_tie", "Sheet 2 completeness", "Sheet 2 fuel oil vs GHG-sheet fuel oil", ["pf.s2_fuel_oil_t", "pf.fuel_oil_t"], (r) =>
    checkSumMatches({
      id: "sheet2_fuel_oil_tie",
      label: "Sheet 2 fuel oil vs GHG fuel oil",
      parts: [num(r, "pf.s2_fuel_oil_t")],
      target: num(r, "pf.fuel_oil_t"),
      absTolerance: TONNE_BAND,
      thresholdSource: "Rounding band 0.5 t",
    })
  ),
  one("sheet2_grid_tie", "Sheet 2 completeness", "Sheet 2 grid import vs GHG-sheet grid import", ["pf.s2_grid_import_kwh", "pf.grid_kwh"], (r) =>
    checkSumMatches({
      id: "sheet2_grid_tie",
      label: "Sheet 2 grid import vs GHG grid import",
      parts: [num(r, "pf.s2_grid_import_kwh")],
      target: num(r, "pf.grid_kwh"),
      absTolerance: KWH_BAND,
      thresholdSource: "Rounding band 1 kWh",
    })
  ),
  one(
    "sheet2_export",
    "Sheet 2 completeness",
    "Grid export and the indirect GHG formula",
    ["pf.proforma_opened", "pf.indirect_formula", "pf.indirect_sheet", "pf.grid_import_ref", "pf.grid_export_ref", "pf.grid_export_sheet"],
    (r) => {
      if (!("pf.s2_grid_export_kwh" in r)) {
        return { id: "sheet2_export", label: "Grid export deduction", status: "not_applicable", detail: "Sheet 2 grid export is missing, so this check cannot see an export figure." };
      }
      const exp = num(r, "pf.s2_grid_export_kwh");
      if (!(exp > 0)) {
        return { id: "sheet2_export", label: "Grid export deduction", status: "not_applicable", detail: `Sheet 2 grid export is ${plain(exp)} kWh, so there is no export to deduct.` };
      }
      const formula = String(r["pf.indirect_formula"] ?? "");
      if (!formula) {
        return { id: "sheet2_export", label: "Grid export deduction", status: "not_applicable", detail: "The GHG indirect formula cell cannot be read." };
      }
      const deducted = subtractsCell(formula, String(r["pf.indirect_sheet"] ?? ""), String(r["pf.grid_export_sheet"] ?? ""), String(r["pf.grid_export_ref"] ?? ""));
      const importRef = String(r["pf.grid_import_ref"] ?? "");
      if (!deducted) {
        const usesImport = mentionsCell(formula, importRef);
        return {
          id: "sheet2_export",
          label: "Grid export deduction",
          status: "fail",
          detail:
            `Sheet 2 grid export is ${plain(exp)} kWh. The GHG indirect formula ${formula} ` +
            (usesImport && importRef ? `uses the grid import cell ${importRef} and does not subtract export. ` : "does not subtract export. ") +
            "Export was not deducted. The plant must confirm whether the procedure requires deduction.",
          actual: exp,
        };
      }
      return {
        id: "sheet2_export",
        label: "Grid export deduction",
        status: "pass",
        detail: `Sheet 2 grid export is ${plain(exp)} kWh and the GHG indirect formula ${formula} subtracts that export cell.`,
        actual: exp,
      };
    }
  ),
  one(
    "source_profile",
    "Source profile",
    "Sources the workbook and the run can see",
    ["pf.coal_energy_tj", "pf.ef_coal", "pf.fuel_oil_energy_tj", "pf.ef_fuel_oil", "pf.indirect_co2", "pf.calcination_state", "pf.petcoke_has_emission", "petcoke.petcoke_t_sum"],
    (r) => {
      const { coal, fuelOil, indirect } = emissionPortions(r);
      const gaps = sourceGaps(r);
      const ranked = [
        { label: `coal combustion ${plain(coal)} tCO2 (GHG sheet formula result)`, co2: coal },
        { label: `fuel oil ${plain(fuelOil)} tCO2 (workbook formula result)`, co2: fuelOil },
        { label: `grid indirect ${plain(indirect)} tCO2 (workbook formula result)`, co2: indirect },
      ];
      if (gaps.petcokeCo2 !== null) ranked.push({ label: `petcoke ${plain(gaps.petcokeCo2)} tCO2 (workbook formula result)`, co2: gaps.petcokeCo2 });
      if (gaps.calcinationCo2 !== null) ranked.push({ label: `calcination ${plain(gaps.calcinationCo2)} tCO2 (workbook formula result)`, co2: gaps.calcinationCo2 });
      ranked.sort((a, b) => b.co2 - a.co2);
      const tail: string[] = [];
      if (gaps.petcokeCo2 === null) {
        tail.push(gaps.petcokeT > 0 ? `petcoke ${plain(gaps.petcokeT)} t, unquantified, no emission factor` : "petcoke is absent or zero");
      }
      if (gaps.calcinationGap) tail.push("calcination is missing: no workbook cell and no fact");
      if (gaps.calcinationOutOfBasis) {
        tail.push(
          `calcination is outside the intensity basis for ${gaps.fyLabel} (Detailed Procedure Section 3.4(1) Note, p. 7: 2024-27 targets are set on direct energy and indirect sources only), so a missing figure is not a gap` +
            (gaps.calcinationCo2 !== null
              ? `; the workbook's ${plain(gaps.calcinationCo2)} tCO2 is listed above and, if the run counts it, the intensity is not on the same basis as such a target`
              : "")
        );
      }
      let detail = `Sources, largest quantified CO2 first: ${ranked.map((s) => s.label).join("; ")}.`;
      if (tail.length) detail += ` ${tail.join(". ")}.`;
      if (gaps.petcokeGap && gaps.calcinationGap) {
        detail += " They cannot be counted as zero because either is large enough to move a 2% materiality threshold, and no factor was invented.";
      } else if (gaps.petcokeGap || gaps.calcinationGap) {
        detail += ` ${gaps.petcokeGap ? "Petcoke" : "Calcination"} cannot be counted as zero because it is large enough to move a 2% materiality threshold, and no factor was invented.`;
      }
      return {
        id: "source_profile",
        label: "Sources the workbook and the run can see",
        status: gaps.petcokeGap || gaps.calcinationGap ? "fail" : "pass",
        detail,
      };
    }
  ),
  one(
    "workbook_vs_engine",
    "Recalculation",
    "Workbook direct CO2 against the streams the engine takes",
    ["pf.direct_co2", "pf.indirect_co2", "pf.coal_energy_tj", "pf.ef_coal", "pf.fuel_oil_energy_tj", "pf.ef_fuel_oil"],
    (r) => {
      // The engine takes coal and furnace oil. Direct CO2 in the workbook should be those two and
      // nothing else. A remainder is a source the run cannot see.
      const { coal, fuelOil, direct, indirect } = emissionPortions(r);
      const taken = round6(coal + fuelOil);
      const remainder = round6(direct - taken);
      const ok = Math.abs(remainder) <= Math.abs(direct) * T + 1e-6;
      return {
        id: "workbook_vs_engine",
        label: "Workbook direct CO2 against the streams the engine takes",
        status: ok ? "pass" : "fail",
        detail:
          `Workbook direct CO2 is ${plain(direct)} t. Coal ${plain(coal)} t plus fuel oil ${plain(fuelOil)} t is ${plain(taken)} t, both streams the calculation takes. ` +
          (ok
            ? "Nothing else sits inside the direct total. "
            : `The remaining ${plain(remainder)} t is not from either stream, so a run would not see it. `) +
          "The run prices both fuels with the engine's factor set, which is not the workbook's own factor, so the two totals differ slightly. " +
          `Workbook indirect CO2 is ${plain(indirect)} t.`,
        actual: direct,
        expected: taken,
        diff: remainder,
        thresholdSource: T_SRC,
      };
    }
  ),
  one(
    "materiality_aggregate",
    "Materiality",
    "Quantified misstatements against 2% of reported emissions",
    ["pf.direct_co2", "pf.indirect_co2", "pf.coal_energy_tj", "pf.ef_coal", "pf.fuel_oil_energy_tj", "pf.ef_fuel_oil", "pf.calcination_state", "pf.petcoke_has_emission", "petcoke.petcoke_t_sum"],
    (r) => {
      const { quantified, total, threshold } = materialityPosition(r);
      const gaps = sourceGaps(r);
      const over = quantified > threshold + 1e-9;
      const fail = over || gaps.petcokeGap || gaps.calcinationGap;
      const reasons: string[] = [];
      if (over) reasons.push("The quantified sum exceeds 2% of reported emissions.");
      if (gaps.calcinationGap) reasons.push("Calcination is missing, so the aggregate is incomplete and cannot pass.");
      if (gaps.petcokeGap) reasons.push(`Petcoke is ${plain(gaps.petcokeT)} t with no emission calculation, so the aggregate is incomplete and cannot pass.`);
      if (!over && (gaps.petcokeGap || gaps.calcinationGap)) reasons.unshift("The quantified sum does not by itself exceed 2%.");
      return {
        id: "materiality_aggregate",
        label: "Quantified misstatements against 2% of reported emissions",
        status: fail ? "fail" : "pass",
        detail:
          `Quantified misstatements sum to ${plain(quantified)} tCO2. Reported total direct and indirect GHG is ${plain(total)} tCO2. ` +
          `The 2% threshold is ${plain(threshold)} tCO2. No calcination number was added. ${reasons.join(" ")}`,
        actual: quantified,
        expected: threshold,
        diff: round6(quantified - threshold),
        thresholdSource: MATERIALITY_SOURCE,
      };
    }
  ),
  one("formula_integrity", "Formula integrity", "Sector pro forma green cells still hold their formulas", ["pf.proforma_opened"], (r) => {
    // A cell is judged only where the workbook prints this template's label beside it. That is
    // how the rule knows the file is the template and the cell is the one it expects.
    const problems: string[] = [];
    const recognised = CEMENT_PROFORMA_FORMULAS.filter((spec) => {
      const label = r[`pf.label@${spec.sheet}!${spec.ref}`];
      return typeof label === "string" && spec.label.test(label.trim());
    });
    // Less than half the rows found means this is another layout, not a tampered one.
    if (recognised.length * 2 < CEMENT_PROFORMA_FORMULAS.length) {
      return {
        id: "formula_integrity",
        label: "Sector pro forma green cells still hold their formulas",
        status: "not_applicable",
        detail:
          `${recognised.length} of ${CEMENT_PROFORMA_FORMULAS.length} template rows were found at their expected addresses with their expected labels, ` +
          `so this workbook is laid out differently from the pro forma this check knows. Formula integrity was not assessed, and that is not a pass. ${FORMULA_NOTE}`,
        actual: recognised.length,
        expected: CEMENT_PROFORMA_FORMULAS.length,
      };
    }
    for (const spec of recognised) {
      const got = r[`pf.formula@${spec.sheet}!${spec.ref}`];
      const ref = `${spec.sheet}!${spec.ref}`;
      if (typeof got !== "string") problems.push(`${ref} holds a typed value, not its formula`);
      else if (normFormula(got) !== normFormula(spec.formula)) problems.push(`${ref} overwritten`);
    }
    const notFound = CEMENT_PROFORMA_FORMULAS.length - recognised.length;
    return {
      id: "formula_integrity",
      label: "Sector pro forma green cells still hold their formulas",
      status: problems.length === 0 ? "pass" : "fail",
      detail:
        (problems.length === 0
          ? `All ${recognised.length} template formula cell(s) found match. `
          : `${problems.length} formula cell(s) overwritten or typed over: ${problems.join(", ")}. `) +
        (notFound > 0 ? `${notFound} further template row(s) were not at their expected address and were not assessed. ` : "") +
        FORMULA_NOTE,
      actual: problems.length,
      expected: 0,
    };
  }),
  one("engine_coverage", "Run inputs", "Pro forma inputs the calculation cannot take", ["pf.unmapped_count"], (r) => {
    const n = num(r, "pf.unmapped_count");
    return {
      id: "engine_coverage",
      label: "Inputs without a calculation stream",
      status: n === 0 ? "pass" : "fail",
      detail: n === 0 ? "Every non-zero pro forma input has a stream in the calculation." : `The pro forma holds inputs the calculation has no stream for, so a run leaves them out: ${r["pf.unmapped_list"]}.`,
    };
  }),

  // ---- Calorific value basis (Process 5.2) -------------------------------------------
  optional(
    "gcv_basis_nabl",
    "Fuels and power",
    "NABL GCV against the internal lab, on the same moisture basis",
    ["coal.nabl_gcv", "coal.nabl_basis", "coal.nabl_moisture_pct", "lab.gcv_mean", "lab.moisture_mean_pct"],
    (r) => {
      const external = num(r, "coal.nabl_gcv");
      const basis = parseBasis(r["coal.nabl_basis"]);
      const externalMoisture = num(r, "coal.nabl_moisture_pct");
      // The air-dried moisture the certificate prints. Only a dried-basis value needs it, so it is
      // not one of the readings that must be present for this check to run.
      const inherentMoisture = "coal.nabl_inherent_moisture_pct" in r ? num(r, "coal.nabl_inherent_moisture_pct") : null;
      const internal = num(r, "lab.gcv_mean");
      const internalMoisture = num(r, "lab.moisture_mean_pct");

      // Both figures on the as-received basis. The internal figure is the mean of the
      // daily log, whose moisture column is the as-fired basis the log states.
      const converted = convertCalorificValue(
        { value: external, basis, totalMoisturePct: externalMoisture, inherentMoisturePct: inherentMoisture },
        "ARB"
      );
      const externalArb = basis === "ARB" ? external : converted.ok ? converted.value : null;
      if (externalArb === null) {
        const why = converted.ok ? "the basis could not be applied" : converted.reason;
        return {
          id: "gcv_basis_nabl",
          label: "NABL GCV against the internal lab, on the same moisture basis",
          status: "not_applicable",
          detail: `The NABL figure cannot be put on an as-received basis, so it is not compared: ${why}`,
        };
      }
      const moistureGap = externalMoisture - internalMoisture;
      // The moisture has to describe the same coal before the two calorific values can
      // be compared at all. A gap beyond the stated band is the double-count signature.
      const moistureAgrees = Math.abs(moistureGap) <= NABL_MOISTURE_BAND_PCT + 1e-9;
      const deviation = round6(Math.abs(externalArb - internal));
      const exceeds = deviation > NABL_GCV_BAND_KCAL + 1e-9;
      const status = !moistureAgrees || exceeds ? "fail" : "pass";
      return {
        id: "gcv_basis_nabl",
        label: "NABL GCV against the internal lab, on the same moisture basis",
        status,
        detail:
          `NABL ${plain(external)} kcal/kg printed as ${BASIS_LABEL[basis]} at ${plain(externalMoisture)}% total moisture` +
          (basis === "ARB" ? "" : `, which is ${plain(externalArb)} kcal/kg as received`) +
          `. The internal log averages ${plain(internal)} kcal/kg at ${plain(internalMoisture)}% moisture. ` +
          (moistureAgrees
            ? `The two moistures agree within ${plain(NABL_MOISTURE_BAND_PCT)} percentage points, so the figures describe the same coal, and the deviation is ${plain(deviation)} kcal/kg against the ${plain(NABL_GCV_BAND_KCAL)} band. `
            : `The moisture differs by ${plain(round6(moistureGap))} percentage points, more than the ${plain(NABL_MOISTURE_BAND_PCT)} allowed, so the two figures do not describe the same coal. A calorific value compared across a moisture gap, or a moisture deduction applied to the tonnage as well, counts the water twice. `) +
          (exceeds ? `The deviation is over the ${plain(NABL_GCV_BAND_KCAL)} kcal/kg band. ` : "") +
          `The Procedure does not say whether the "difference" it adds back is signed, so no corrected value is computed here; that is an open item.`,
        actual: externalArb,
        expected: internal,
        diff: round6(externalArb - internal),
        thresholdSource: `${NABL_GCV_SOURCE} Moisture agreement band ${NABL_MOISTURE_BAND_PCT} percentage points is a firm screening default, not a scheme figure.`,
      };
    }
  ),

  // ---- Calcination stoichiometry (Process 5.7) ---------------------------------------
  optional(
    "calcination_stoich",
    "Recalculation",
    "Calcination factor against the carbonate floor",
    ["clinker.cao_pct", "clinker.mgo_pct"],
    (r) => {
      const cao = num(r, "clinker.cao_pct") / 100;
      const mgo = num(r, "clinker.mgo_pct") / 100;
      const floor = stoichiometricCalcinationFloor(cao, mgo);
      // The declared factor, where the pro forma carries one.
      const declared = r["pf.calcination_state"] === "quantified" && "pf.calcination_co2" in r ? num(r, "pf.calcination_co2") : null;
      const clinkerT = "pf.clinker_t" in r ? num(r, "pf.clinker_t") : null;
      if (declared === null || clinkerT === null || clinkerT <= 0) {
        return {
          id: "calcination_stoich",
          label: "Calcination factor against the carbonate floor",
          status: "not_applicable",
          detail:
            `CaO ${fixed(cao * 100, 2)}% and MgO ${fixed(mgo * 100, 2)}% set a floor of ${fixed(floor, 4)} tCO2 per tonne of clinker. ` +
            `The pro forma carries no calcination figure or no clinker tonnage to divide by, so there is no declared factor to test against it.`,
          actual: floor,
        };
      }
      const declaredPerTonne = round6(declared / clinkerT);
      const verdict = checkOxideFloor({ caoFraction: cao, mgoFraction: mgo, declaredFactor: declaredPerTonne });
      return {
        id: "calcination_stoich",
        label: "Calcination factor against the carbonate floor",
        status: verdict.status === "impossible" ? "fail" : verdict.status === "possible" ? "pass" : "not_applicable",
        detail: verdict.detail,
        actual: declaredPerTonne,
        expected: round6(floor),
        diff: verdict.status === "impossible" ? round6(declaredPerTonne - floor) : undefined,
        thresholdSource:
          "Stoichiometry of CaCO3 and MgCO3 decomposition, CO2/CaO and CO2/MgO from atomic masses (Annexure II.G.1). A 2% analytical tolerance is a firm default, not a scheme figure.",
      };
    }
  ),

  // ---- Self-consistency of one document (Processes 3.0 and 4.3) ----------------------
  optional("weighbridge_slip", "Fuels and power", "Weighbridge slip agrees with itself", ["slip.gross_t", "slip.tare_t", "slip.net_t"], (r) => {
    const verdict = checkWeighbridgeSlip({
      grossT: num(r, "slip.gross_t"),
      tareT: num(r, "slip.tare_t"),
      netT: num(r, "slip.net_t"),
    });
    return {
      id: "weighbridge_slip",
      label: "Weighbridge slip agrees with itself",
      status: verdict.status === "inconsistent" ? "fail" : verdict.status === "consistent" ? "pass" : "not_applicable",
      detail: verdict.detail,
      ...(verdict.status !== "not_applicable" ? { actual: verdict.computedNet, expected: num(r, "slip.net_t") } : {}),
      thresholdSource: `Rounding band ${WEIGHBRIDGE_TOLERANCE_T} t on a slip's three weights.`,
    };
  }),

  // ---- Digit patterns in typed quantities (Process 13.3) -----------------------------
  one("gcv_digit_screen", "Fuels and power", "Coal GCV readings: digit pattern", ["lab.gcv@*"], (r) => {
    const values = series(r, "lab.gcv").map((s) => Number(s.value)).filter((n) => Number.isFinite(n) && n > 0);
    const applies = benfordApplies(values);
    const benford = benfordFirstDigit(values);
    const terminal = terminalDigitUniformity(values);
    const round = roundEndingShare(values);
    const terminalDeviates = !terminal.smallSample && terminal.pValue < 0.01;
    const benfordDeviates = applies.ok && !benford.smallSample && benford.pValue < 0.01;
    const suspicious = benfordDeviates || terminalDeviates;
    const benfordNote = applies.ok ? describeScreen("First digit", benford) : `First digit not tested: ${applies.reason}`;
    return {
      id: "gcv_digit_screen",
      label: "Coal GCV readings: digit pattern",
      status: suspicious ? "fail" : "pass",
      detail:
        `${benfordNote} ${describeScreen("Terminal digit", terminal)} ` +
        `${round.n > 0 ? `${Math.round(round.share * 100)}% of ${round.n} values end in 0 or 5. ` : ""}` +
        (suspicious
          ? `A digit pattern like this does not prove a figure wrong, but it is a reason to pull the originals and check that the figures were copied, not typed.`
          : `Nothing in the digits of these readings calls them into question.`),
      actual: terminalDeviates ? terminal.pValue : benford.pValue,
      thresholdSource:
        "Terminal-digit uniformity for a typed quantity, and Benford's first digit where the values span one to three orders of magnitude. A p-value below 0.01 is reported as a strong deviation. Product screens, not a scheme requirement.",
    };
  }),
];

const m = (key: string, label: string, unit: string, slot: string, hint?: string) => ({ key, label, unit, slot, ...(hint ? { hint } : {}) });

export const CEMENT_DESK_REVIEW: DeskReviewDef = {
  packId: "CCTS-CEMENT-v1",
  proformaCells: PROFORMA_CELLS,
  readers: READERS,
  rules: RULES,
  proformaAnnotations: annotateCementProforma,
  monthsEvidence: {
    production_evidence: "scada.months",
    cpp_generation: "cpp.months",
    petcoke_log: "petcoke.months",
    coal_quality: "lab.gcv_months",
    grid_electricity: "grid.bill_months",
  },
  materiality: (r) => cementMateriality(r),
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
    m("coal.po_t", "Coal purchase order: quantity", "t", "coal_purchase", `${NOT_CONSUMPTION} The ordered quantity is not the quantity consumed.`),
    m("coal.po_months", "Coal purchase orders: number of months covered", "months", "coal_purchase", `${NOT_CONSUMPTION} Months on the purchase order are not the months of consumption evidence.`),
    m("coal.opening_t", "Coal stock: opening", "t", "coal_purchase", `${NOT_CONSUMPTION} Enter opening stock for the evidenced period.`),
    m("coal.receipts_t", "Coal stock: receipts", "t", "coal_purchase", `${NOT_CONSUMPTION} Enter receipts for the evidenced period.`),
    m("coal.issues_t", "Coal stock: issues", "t", "coal_purchase", `${NOT_CONSUMPTION} Enter issues, the stock-ledger consumption, for the evidenced period.`),
    m("coal.closing_t", "Coal stock: closing", "t", "coal_purchase", `${NOT_CONSUMPTION} Enter closing stock for the evidenced period.`),
    m("coal.weighfeeder_t", "Coal weigh-feeder total", "t", "coal_purchase", `${NOT_CONSUMPTION} Enter the weigh-feeder total for the evidenced period.`),
    m("coal.nabl_gcv", "NABL certificate: coal GCV", "kcal/kg", "coal_quality"),
    m(
      "coal.nabl_basis",
      "NABL certificate: moisture basis of the GCV",
      "text",
      "coal_quality",
      "Type ARB, ADB, DB or NA. The certificate prints its basis beside the parameter; a value with no stated basis cannot be compared with the workbook."
    ),
    m("coal.nabl_moisture_pct", "NABL certificate: total moisture", "%", "coal_quality", "As printed on the certificate."),
    m(
      "coal.nabl_inherent_moisture_pct",
      "NABL certificate: air-dried (inherent) moisture",
      "%",
      "coal_quality",
      "Only needed when the certificate's GCV is on an air-dried or dry basis. Without it that value cannot be put on an as-received basis."
    ),
    m(
      "clinker.cao_pct",
      "Clinker analysis: CaO",
      "%",
      "production_evidence",
      "From the clinker chemistry report. The stoichiometric floor cannot be checked without it."
    ),
    m("clinker.mgo_pct", "Clinker analysis: MgO", "%", "production_evidence", "From the clinker chemistry report."),
    m(
      "slip.gross_t",
      "Weighbridge slip: gross weight",
      "t",
      "coal_purchase",
      `${NOT_CONSUMPTION} Enter one slip's gross, tare and net to check that the slip agrees with itself.`
    ),
    m("slip.tare_t", "Weighbridge slip: tare weight", "t", "coal_purchase", `${NOT_CONSUMPTION} From the same slip as the gross weight.`),
    m("slip.net_t", "Weighbridge slip: net weight as printed", "t", "coal_purchase", `${NOT_CONSUMPTION} From the same slip as the gross and tare.`),
    m("rec.claim_mwh", "REC declaration: renewable claim", "MWh", "rec_declaration", "Enter 0 for a nil declaration"),
    m("rec.purchases_mwh", "REC declaration: certificates purchased", "MWh", "rec_declaration"),
    m("form1.eq_product_t", "Form 1: total equivalent product", "t", "form1"),
    m("form1.direct_co2_t", "Form 1: direct energy CO2", "tCO2e", "form1"),
    m("form1.indirect_co2_t", "Form 1: indirect energy CO2", "tCO2e", "form1"),
  ],
};
