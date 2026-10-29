/**
 * Desk-review rules on typed readings. The Shyamrock zip covers the real workbook;
 * these cases cover the branches that file does not (a closed stock ledger, a
 * complete year of samples, a fuel-oil portion of zero).
 */

import { describe, expect, it } from "vitest";
import { CEMENT_PROFORMA_FORMULAS } from "./cement";
import { deskReviewFor, runDeskReview, type Readings } from "./index";

const def = deskReviewFor("CCTS-CEMENT-v1")!;

function byId(readings: Readings) {
  return Object.fromEntries(runDeskReview(def, readings).map((r) => [r.id, r]));
}

function ghg(partial: {
  coalTj?: number;
  coalEf?: number;
  foTj?: number;
  foEf?: number;
  indirect?: number;
  total?: number;
  petcokeT?: number;
  petcokeCo2?: number | null;
  calcination?: number | null;
} = {}): Readings {
  const coalTj = partial.coalTj ?? 10;
  const coalEf = partial.coalEf ?? 10;
  const foTj = partial.foTj ?? 0;
  const foEf = partial.foEf ?? 50;
  const direct = coalTj * coalEf + foTj * foEf;
  const indirect = partial.indirect ?? 0;
  const calc = partial.calcination;
  const pet = partial.petcokeCo2;
  return {
    "pf.coal_energy_tj": coalTj,
    "pf.ef_coal": coalEf,
    "pf.fuel_oil_energy_tj": foTj,
    "pf.ef_fuel_oil": foEf,
    "pf.direct_co2": direct,
    "pf.indirect_co2": indirect,
    "pf.total_co2": partial.total ?? direct + indirect,
    "pf.calcination_state": calc === undefined || calc === null ? "missing" : "quantified",
    ...(calc !== undefined && calc !== null ? { "pf.calcination_co2": calc } : {}),
    "pf.petcoke_has_emission": pet !== undefined && pet !== null ? 1 : 0,
    ...(pet !== undefined && pet !== null ? { "pf.petcoke_co2": pet } : {}),
    "petcoke.petcoke_t_sum": partial.petcokeT ?? 0,
  };
}

function formulaReadings(overrides: Record<string, string | null> = {}): Readings {
  const out: Readings = { "pf.proforma_opened": 1 };
  for (const spec of CEMENT_PROFORMA_FORMULAS) {
    const key = `${spec.sheet}!${spec.ref}`;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      if (overrides[key] != null) out[`pf.formula@${key}`] = overrides[key]!;
    } else {
      out[`pf.formula@${key}`] = spec.formula;
    }
  }
  return out;
}

const exportBase: Readings = {
  "pf.proforma_opened": 1,
  "pf.indirect_formula": "B14*100000/1000*B15",
  "pf.indirect_sheet": "3_GHG_CCTS",
  "pf.grid_import_ref": "B14",
  "pf.grid_export_ref": "B12",
  "pf.grid_export_sheet": "2_Energy_GtG_SEC",
};

describe("cement desk review rule set", () => {
  it("replaces the purchase-order equality and the 71.7 GCV snap", () => {
    const ids = def.rules.map((r) => r.id);
    expect(ids).not.toContain("gcv_rule");
    expect(ids).not.toContain("coal_log_vs_po");
    expect(ids).toEqual(
      expect.arrayContaining([
        "source_profile",
        "gcv_samples",
        "gcv_ncv_used",
        "gcv_nabl_corroboration",
        "coal_stock_balance",
        "coal_weighfeeder",
        "sheet2_coal_tie",
        "sheet2_fuel_oil_tie",
        "sheet2_grid_tie",
        "sheet2_export",
        "workbook_vs_engine",
        "materiality_aggregate",
        "formula_integrity",
      ])
    );
    expect(def.rules.find((r) => r.id === "coverage_coal")!.needs).toEqual(["petcoke.months", "pf.coal_t", "petcoke.coal_t_sum"]);
    for (const spec of def.manual.filter((item) => item.slot === "coal_purchase")) {
      expect(spec.hint).toMatch(/purchase order is not consumption/i);
    }
  });
});

describe("coal stock and weigh-feeder", () => {
  const stock = (partial: Readings = {}) =>
    byId({
      "coal.opening_t": 100,
      "coal.receipts_t": 50,
      "coal.issues_t": 30,
      "coal.closing_t": 120,
      "petcoke.coal_t_sum": 30,
      "coal.po_t": 99999,
      ...partial,
    }).coal_stock_balance!;

  it("passes when the ledger closes and issues match the log, ignoring the purchase order", () => {
    const row = stock();
    expect(row.status).toBe("pass");
    expect(row.actual).toBe(30);
    expect(row.expected).toBe(30);
  });

  it("allows a 0.5 t rounding band and fails beyond it", () => {
    expect(stock({ "coal.issues_t": 30.5, "coal.closing_t": 119.5 }).status).toBe("pass");
    expect(stock({ "coal.issues_t": 31, "coal.closing_t": 119 }).status).toBe("fail");
    expect(stock({ "coal.opening_t": 101 }).status).toBe("fail");
  });

  it("stays pending when any stock reading is absent", () => {
    const row = byId({
      "coal.receipts_t": 50,
      "coal.issues_t": 30,
      "coal.closing_t": 120,
      "petcoke.coal_t_sum": 30,
    }).coal_stock_balance!;
    expect(row.status).toBe("pending");
    expect(row.missing).toContain("coal.opening_t");
  });

  it("compares the weigh-feeder with the same log", () => {
    expect(byId({ "coal.weighfeeder_t": 30.5, "petcoke.coal_t_sum": 30 }).coal_weighfeeder!.status).toBe("pass");
    expect(byId({ "coal.weighfeeder_t": 31, "petcoke.coal_t_sum": 30 }).coal_weighfeeder!.status).toBe("fail");
    expect(byId({ "petcoke.coal_t_sum": 30 }).coal_weighfeeder!.status).toBe("pending");
  });
});

describe("GCV checks", () => {
  it("fails a one-month lab file and a short throughput count, and passes when both are met", () => {
    const oneMonth = byId({ "lab.gcv_n": 30, "lab.gcv_months": 1, "pf.coal_t": 34970 }).gcv_samples!;
    expect(oneMonth.status).toBe("fail");
    expect(oneMonth.expected).toBe(2);
    expect(oneMonth.detail).toMatch(/fewer months than 12/);

    expect(byId({ "lab.gcv_n": 12, "lab.gcv_months": 12, "pf.coal_t": 34970 }).gcv_samples!.status).toBe("pass");
    expect(byId({ "lab.gcv_n": 12, "lab.gcv_months": 12, "pf.coal_t": 500000 }).gcv_samples!.status).toBe("fail");
    expect(byId({ "lab.gcv_n": 25, "lab.gcv_months": 12, "pf.coal_t": 500000 }).gcv_samples!.status).toBe("pass");
  });

  it("passes only when the coal-energy formula references the GCV-to-NCV cell", () => {
    expect(
      byId({ "pf.proforma_opened": 1, "pf.coal_energy_formula": "B6*1000*B8*B10*B13", "pf.gcv_ncv_ref": "B10" }).gcv_ncv_used!.status
    ).toBe("pass");
    const gcvOnly = byId({ "pf.proforma_opened": 1, "pf.coal_energy_formula": "B6*1000*B8*B13", "pf.gcv_ncv_ref": "B10" }).gcv_ncv_used!;
    expect(gcvOnly.status).toBe("fail");
    expect(gcvOnly.detail).toMatch(/GCV only/);
    const unread = byId({ "pf.proforma_opened": 1, "pf.coal_energy_formula": "", "pf.gcv_ncv_ref": "B10" }).gcv_ncv_used!;
    expect(unread.status).toBe("not_applicable");
    expect(unread.detail).toMatch(/cannot be read/);
  });

  it("reports NABL as corroboration and does not pass or fail on a numeric band", () => {
    const row = byId({ "lab.gcv_mean": 4200, "coal.nabl_gcv": 4000, "pf.gcv_coal": 4200 }).gcv_nabl_corroboration!;
    expect(row.status).toBe("not_applicable");
    expect(row.detail).toMatch(/Internal lab mean 4200/);
    expect(row.detail).toMatch(/NABL 4000/);
    expect(row.detail).toMatch(/Workbook GCV cell 4200/);
    expect(row.detail).toMatch(/corroborat/i);
    expect(row.detail).toMatch(/does not replace the sample-frequency rule/);
    expect(row.detail).not.toMatch(/71\.7/);
    expect(byId({ "lab.gcv_mean": 4200, "pf.gcv_coal": 4200 }).gcv_nabl_corroboration!.status).toBe("pending");
  });
});

describe("sheet 2, source profile, recalculation, materiality, formulas", () => {
  it("ties sheet 2 quantities inside the rounding band", () => {
    const rows = byId({
      "pf.s2_process_coal_t": 25000,
      "pf.s2_power_coal_t": 9970,
      "pf.coal_t": 34970,
      "pf.s2_fuel_oil_t": 120,
      "pf.fuel_oil_t": 120.4,
      "pf.s2_grid_import_kwh": 3_000_000,
      "pf.grid_kwh": 3_000_001,
    });
    expect(rows.sheet2_coal_tie!.status).toBe("pass");
    expect(rows.sheet2_fuel_oil_tie!.status).toBe("pass");
    expect(rows.sheet2_grid_tie!.status).toBe("pass");
    expect(byId({ "pf.s2_process_coal_t": 25000, "pf.s2_power_coal_t": 9970, "pf.coal_t": 34970.6 }).sheet2_coal_tie!.status).toBe("fail");
    expect(byId({ "pf.s2_grid_import_kwh": 100, "pf.grid_kwh": 101.1 }).sheet2_grid_tie!.status).toBe("fail");
  });

  it("fails when export is positive and the indirect formula does not subtract it", () => {
    const fail = byId({ ...exportBase, "pf.s2_grid_export_kwh": 1_000_000 }).sheet2_export!;
    expect(fail.status).toBe("fail");
    expect(fail.detail).toMatch(/not deducted/i);
    expect(fail.detail).toMatch(/confirm whether the procedure requires deduction/i);
    expect(byId({ ...exportBase, "pf.s2_grid_export_kwh": 0 }).sheet2_export!.detail).toMatch(/no export to deduct/);
    expect(byId(exportBase).sheet2_export!.detail).toMatch(/missing/);
    const deducted = byId({
      ...exportBase,
      "pf.s2_grid_export_kwh": 1_000_000,
      "pf.indirect_formula": "B14*100000/1000*B15-'2_Energy_GtG_SEC'!B12",
    }).sheet2_export!;
    expect(deducted.status).toBe("pass");
  });

  it("fails the source profile when petcoke or calcination has no CO2, and passes when both are closed", () => {
    const gap = byId(ghg({ coalTj: 50, coalEf: 100, foTj: 1, foEf: 80, indirect: 2000, petcokeT: 208.4 })).source_profile!;
    expect(gap.status).toBe("fail");
    expect(gap.detail).toMatch(/coal combustion 5000 tCO2/);
    expect(gap.detail.indexOf("coal combustion")).toBeLessThan(gap.detail.indexOf("grid indirect"));
    expect(gap.detail.indexOf("grid indirect")).toBeLessThan(gap.detail.indexOf("fuel oil"));
    expect(gap.detail).toMatch(/unquantified, no emission factor/);
    expect(gap.detail).toMatch(/calcination is missing: no workbook cell and no fact/);
    expect(gap.detail).toMatch(/cannot be counted as zero because either is large enough to move a 2% materiality threshold, and no factor was invented/);

    const closed = byId(ghg({ petcokeT: 0, calcination: 0 })).source_profile!;
    expect(closed.status).toBe("pass");
    expect(closed.detail).not.toMatch(/cannot be counted as zero/);
  });

  it("treats coal plus fuel oil as what the engine takes, and reports only the remainder as a misstatement", () => {
    const gap = byId(ghg({ coalTj: 100, coalEf: 10, foTj: 2, foEf: 5, indirect: 2148, petcokeT: 10 }));
    expect(gap.workbook_vs_engine!.status).toBe("pass");
    expect(gap.workbook_vs_engine!.diff).toBeCloseTo(0, 6);
    expect(gap.workbook_vs_engine!.detail).toMatch(/Workbook direct CO2 is 1010 t/);
    expect(gap.workbook_vs_engine!.detail).toMatch(/fuel oil 10 t/);
    expect(gap.workbook_vs_engine!.detail).toMatch(/Workbook indirect CO2 is 2148 t/);

    // Calcination missing and petcoke unquantified still stop the aggregate passing.
    expect(gap.materiality_aggregate!.status).toBe("fail");
    expect(gap.materiality_aggregate!.actual).toBe(0);
    expect(gap.materiality_aggregate!.expected).toBeCloseTo((1010 + 2148) * 0.02, 6);
    expect(gap.materiality_aggregate!.detail).toMatch(/No calcination number was added/);

    // A direct total that holds more than coal and fuel oil: the remainder is the misstatement.
    const rem = ghg({ coalTj: 100, coalEf: 10, foTj: 2, foEf: 5, indirect: 970, total: 1000, petcokeT: 0, calcination: 0 });
    rem["pf.direct_co2"] = 1040;
    const over = byId(rem);
    expect(over.workbook_vs_engine!.status).toBe("fail");
    expect(over.workbook_vs_engine!.diff).toBeCloseTo(30, 6);
    expect(over.materiality_aggregate!.status).toBe("fail");
    expect(over.materiality_aggregate!.actual).toBeCloseTo(30, 6);
    expect(over.materiality_aggregate!.expected).toBeCloseTo(20, 6);

    const clear = byId(ghg({ petcokeT: 0, calcination: 0 }));
    expect(clear.workbook_vs_engine!.status).toBe("pass");
    expect(clear.materiality_aggregate!.status).toBe("pass");
    expect(clear.materiality_aggregate!.actual).toBe(0);
  });

  it("compares green-cell formulas after stripping a leading equals sign and spaces", () => {
    expect(byId(formulaReadings()).formula_integrity!.status).toBe("pass");
    expect(byId(formulaReadings()).formula_integrity!.detail).toMatch(/not a BEE-issued blank file/);
    expect(byId(formulaReadings({ "1_Production!B17": "= B9 * B12 / B13" })).formula_integrity!.status).toBe("pass");
    const missing = byId(formulaReadings({ "1_Production!B21": null })).formula_integrity!;
    expect(missing.status).toBe("fail");
    expect(missing.detail).toMatch(/1_Production!B21 missing/);
    const overwritten = byId(formulaReadings({ "3_GHG_CCTS!B20": "B18*B11" })).formula_integrity!;
    expect(overwritten.status).toBe("fail");
    expect(overwritten.detail).toMatch(/3_GHG_CCTS!B20 overwritten/);
  });
});
