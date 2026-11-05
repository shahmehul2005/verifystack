import { describe, expect, it } from "vitest";
import { CEMENT_REGISTRY } from "./index";
import { normalizeCoalGcv, normalizePeriod, normalizeQuantity, normalizeReading, readCalorificBasis } from "./normalize";
import { convertCalorificValue } from "../deskreview/moistureBasis";
import { isoDate } from "../deskreview/engine";
import { dimensionOf, parseUnit } from "../units";

const entry = (key: string) => CEMENT_REGISTRY.entries.find((e) => e.key === key)!;
const clinker = entry("clinker_production");
const gcv = entry("coal_gcv");
const grid = entry("grid_electricity_import");

describe("the registry's units are ones the normalizer understands", () => {
  const dim = { mass: "mass", energy: "energy", calorific_value: "specific_energy" } as const;
  it("every standard and allowed unit parses to itself, in the entry's dimension", () => {
    for (const e of CEMENT_REGISTRY.entries) {
      for (const u of [e.standardUnit, ...e.validation.allowedUnits]) {
        const parsed = parseUnit(u);
        expect(parsed, `${e.key}: ${u}`).toBe(u);
        expect(dimensionOf(parsed!), `${e.key}: ${u}`).toBe(dim[e.dimension]);
      }
    }
  });
});

describe("normalizeQuantity: units", () => {
  it("leaves a value already on the standard unit unchanged and keeps the original", () => {
    const r = normalizeQuantity(grid, { value: 1_250_000, unit: " kWh " });
    expect(r).toEqual({ ok: true, value: 1_250_000, unit: "kWh", original: { value: 1_250_000, unit: "kWh" } });
  });

  it("converts MWh to kWh, and an Indian bill's 'units' to kWh", () => {
    expect(normalizeQuantity(grid, { value: 1.25, unit: "MWh" })).toMatchObject({ ok: true, value: 1250 });
    expect(normalizeQuantity(grid, { value: 4000, unit: "units" })).toMatchObject({ ok: true, value: 4000 });
  });

  it("reads lakh and crore, the scales Indian reports use", () => {
    expect(normalizeQuantity(grid, { value: 12.5, unit: "Lakh kWh" })).toMatchObject({ ok: true, value: 1_250_000 });
    expect(normalizeQuantity(grid, { value: 12.5, unit: "lac units" })).toMatchObject({ ok: true, value: 1_250_000 });
    expect(normalizeQuantity(grid, { value: 0.1, unit: "crore kWh" })).toMatchObject({ ok: true, value: 1_000_000 });
    // The original keeps the scale word.
    expect(normalizeQuantity(grid, { value: 12.5, unit: "Lakh kWh" })).toMatchObject({ original: { value: 12.5, unit: "Lakh kWh" } });
  });

  it("refuses apparent energy: kVAh is not kWh", () => {
    for (const unit of ["kVAh", "KVAH", "MVAh", "lakh kVAh"]) {
      const r = normalizeQuantity(grid, { value: 5_000_000, unit });
      expect(r, unit).toMatchObject({ ok: false, code: "apparent_energy" });
      expect((r as { reason: string }).reason).toMatch(/power factor/);
    }
  });

  it("refuses a unit of the wrong dimension rather than coercing it", () => {
    expect(normalizeQuantity(grid, { value: 100, unit: "kW" })).toMatchObject({ ok: false, code: "wrong_dimension" });
    expect(normalizeQuantity(grid, { value: 100, unit: "kVA" })).toMatchObject({ ok: false, code: "wrong_dimension" });
    expect(normalizeQuantity(clinker, { value: 100, unit: "kWh" })).toMatchObject({ ok: false, code: "wrong_dimension" });
    expect(normalizeQuantity(gcv, { value: 100, unit: "kJ" })).toMatchObject({ ok: false, code: "wrong_dimension" });
  });

  it("refuses a unit it does not know, and does not guess Nm3", () => {
    expect(normalizeQuantity(clinker, { value: 100, unit: "bags" })).toMatchObject({ ok: false, code: "unknown_unit" });
    expect(normalizeQuantity(clinker, { value: 100, unit: "Nm3" })).toMatchObject({ ok: false, code: "unknown_unit" });
  });

  it("refuses a convertible unit the entry does not accept", () => {
    expect(normalizeQuantity(grid, { value: 1, unit: "GWh" })).toMatchObject({ ok: false, code: "not_allowed" });
    expect(normalizeQuantity(clinker, { value: 1, unit: "kt" })).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("refuses a missing unit: a bare number is not placed on a unit by assumption", () => {
    for (const unit of [null, undefined, "", "   "]) {
      expect(normalizeQuantity(grid, { value: 1000, unit })).toMatchObject({ ok: false, code: "no_unit" });
    }
  });

  it("refuses a value that is not a finite, non-negative number", () => {
    expect(normalizeQuantity(grid, { value: Number.NaN, unit: "kWh" })).toMatchObject({ ok: false, code: "not_finite" });
    expect(normalizeQuantity(grid, { value: Number.POSITIVE_INFINITY, unit: "kWh" })).toMatchObject({ ok: false, code: "not_finite" });
    expect(normalizeQuantity(grid, { value: -1, unit: "kWh" })).toMatchObject({ ok: false, code: "negative" });
    expect(normalizeQuantity(grid, { value: 0, unit: "kWh" })).toMatchObject({ ok: true, value: 0 });
  });

  it("converts clinker tonnes written several ways", () => {
    expect(normalizeQuantity(clinker, { value: 12_500, unit: "MT" })).toMatchObject({ ok: true, value: 12_500 });
    expect(normalizeQuantity(clinker, { value: 12_500, unit: "tonnes" })).toMatchObject({ ok: true, value: 12_500 });
    expect(normalizeQuantity(clinker, { value: 5_000_000, unit: "kg" })).toMatchObject({ ok: true, value: 5000 });
  });

  it("converts a calorific value between kcal/kg and MJ/kg with the thermochemical calorie", () => {
    expect(normalizeQuantity(gcv, { value: 4200, unit: "kcal/kg" })).toMatchObject({ ok: true, value: 4200 });
    expect(normalizeQuantity(gcv, { value: 4200, unit: "Kcal per Kg" })).toMatchObject({ ok: true, value: 4200 });
    const mj = normalizeQuantity(gcv, { value: 17.58456, unit: "MJ/kg" });
    expect(mj.ok && mj.value).toBeCloseTo(4200, 6);
  });
});

describe("readCalorificBasis: what the page prints", () => {
  const moisture = (s: string) => readCalorificBasis(s).moisture;
  it("reads as received and as fired as ARB", () => {
    expect(moisture("As received basis (ARB)")).toBe("ARB");
    expect(moisture("GCV (kcal/kg, as fired)")).toBe("ARB");
    expect(moisture("ARB")).toBe("ARB");
  });
  it("reads air dried as ADB, and not also as dry", () => {
    expect(moisture("Air-dried basis (ADB)")).toBe("ADB");
    expect(moisture("air dry")).toBe("ADB");
    expect(moisture("ADB")).toBe("ADB");
  });
  it("reads dry basis as DB", () => {
    expect(moisture("Dry basis")).toBe("DB");
    expect(moisture("DB")).toBe("DB");
    expect(moisture("moisture free")).toBe("DB");
  });
  it("separates the heating basis from the moisture basis", () => {
    expect(readCalorificBasis("GCV on ADB")).toMatchObject({ moisture: "ADB", heating: "GCV" });
    expect(readCalorificBasis("Net calorific value (ARB)")).toMatchObject({ moisture: "ARB", heating: "NCV" });
    expect(readCalorificBasis("Gross")).toMatchObject({ moisture: "unknown", heating: "GCV" });
  });
  it("leaves unknown what the page does not say, and keeps the words", () => {
    expect(readCalorificBasis("")).toMatchObject({ moisture: "unknown", heating: "unknown", printed: null });
    expect(readCalorificBasis(null)).toMatchObject({ moisture: "unknown", printed: null });
    expect(readCalorificBasis("kcal/kg")).toMatchObject({ moisture: "unknown", heating: "unknown", printed: "kcal/kg" });
  });
  it("marks two answers to one question as conflicting and takes neither", () => {
    expect(readCalorificBasis("ARB / ADB")).toMatchObject({ moisture: "unknown", conflicting: true });
    expect(readCalorificBasis("GCV / NCV")).toMatchObject({ heating: "unknown", conflicting: true });
  });
  it("does not map dry-ash-free onto a basis it can convert", () => {
    const r = readCalorificBasis("dry ash free basis (DAF)");
    expect(r.moisture).toBe("unknown");
    expect(r.note).toMatch(/not converted/);
  });
});

describe("normalizeCoalGcv: moisture basis", () => {
  it("moves an air-dried value to as received with the existing converter's arithmetic", () => {
    const r = normalizeCoalGcv(gcv, { value: 4500, unit: "kcal/kg", printedBasis: "Air-dried basis (ADB)", totalMoisturePct: 12, inherentMoisturePct: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valueKcalPerKg).toBe(4500);
    expect(r.valueOnTarget).toBeCloseTo(4125, 6); // 4500 x (1 - 0.12) / (1 - 0.04)
    const direct = convertCalorificValue({ value: 4500, basis: "ADB", totalMoisturePct: 12, inherentMoisturePct: 4 }, "ARB");
    expect(direct.ok && direct.value).toBeCloseTo(r.valueOnTarget!, 9);
  });

  it("moves an as-received value to air dried when asked", () => {
    const r = normalizeCoalGcv(gcv, { value: 4200, unit: "kcal/kg", printedBasis: "as received", totalMoisturePct: 12, inherentMoisturePct: 4 }, "ADB");
    expect(r.ok && r.valueOnTarget).toBeCloseTo(4581.818182, 5);
  });

  it("returns an as-received value on the target unchanged", () => {
    const r = normalizeCoalGcv(gcv, { value: 4200, unit: "kcal/kg", printedBasis: "As fired" });
    expect(r).toMatchObject({ ok: true, valueOnTarget: 4200, targetReason: null });
  });

  it("converts the unit first, then the basis", () => {
    const r = normalizeCoalGcv(gcv, { value: 18.8496, unit: "MJ/kg", printedBasis: "ARB" });
    expect(r.ok && r.valueKcalPerKg).toBeCloseTo(4502.0, 0);
    expect(r.ok && r.valueOnTarget).toBeCloseTo(r.ok ? r.valueKcalPerKg : -1, 9);
  });

  it("does not assume as received when the page prints no basis", () => {
    const r = normalizeCoalGcv(gcv, { value: 4200, unit: "kcal/kg", printedBasis: null, totalMoisturePct: 12 });
    expect(r).toMatchObject({ ok: true, valueKcalPerKg: 4200, valueOnTarget: null });
    expect(r.ok && r.targetReason).toMatch(/does not state the moisture basis/);
  });

  it("says what is missing when a dried value cannot be moved without inherent moisture", () => {
    const r = normalizeCoalGcv(gcv, { value: 4500, unit: "kcal/kg", printedBasis: "ADB", totalMoisturePct: 12 });
    expect(r).toMatchObject({ ok: true, valueOnTarget: null });
    expect(r.ok && r.targetReason).toMatch(/Inherent moisture is not stated/);
  });

  it("refuses a net value: it is a different figure, not a different unit", () => {
    const r = normalizeCoalGcv(gcv, { value: 4000, unit: "kcal/kg", printedBasis: "NCV (ARB)" });
    expect(r).toMatchObject({ ok: false, code: "net_value" });
  });

  it("refuses a basis that states two answers", () => {
    expect(normalizeCoalGcv(gcv, { value: 4000, unit: "kcal/kg", printedBasis: "ARB / ADB" })).toMatchObject({ ok: false, code: "conflicting_basis" });
  });

  it("carries a unit refusal through", () => {
    expect(normalizeCoalGcv(gcv, { value: 4000, unit: "kJ", printedBasis: "ARB" })).toMatchObject({ ok: false, code: "wrong_dimension" });
    expect(normalizeCoalGcv(gcv, { value: 4000, unit: null, printedBasis: "ARB" })).toMatchObject({ ok: false, code: "no_unit" });
  });
});

describe("normalizePeriod: placing a printed period on the calendar", () => {
  const known = (input: Parameters<typeof normalizePeriod>[0]) => {
    const r = normalizePeriod(input);
    expect(r.status, JSON.stringify(input)).toBe("known");
    return r as Extract<ReturnType<typeof normalizePeriod>, { status: "known" }>;
  };
  const unknown = (input: Parameters<typeof normalizePeriod>[0]) => {
    const r = normalizePeriod(input);
    expect(r.status, JSON.stringify(input)).toBe("unknown");
    return r as Extract<ReturnType<typeof normalizePeriod>, { status: "unknown" }>;
  };

  it("takes a start and end given as fields", () => {
    expect(known({ start: "2023-11-01", end: "2023-11-30" })).toMatchObject({ start: "2023-11-01", end: "2023-11-30", kind: "month", assumptions: [] });
    expect(known({ start: "01/11/2023", end: "15/11/2023" })).toMatchObject({ start: "2023-11-01", end: "2023-11-15", kind: "range" });
    expect(known({ start: "2023-11-15", end: "2023-11-15" })).toMatchObject({ kind: "day" });
  });

  it("reads slashed dates day-first, and says so when the day could be a month", () => {
    const r = known({ start: "03/04/2023", end: "30/04/2023" });
    expect(r.start).toBe("2023-04-03");
    expect(r.assumptions.join(" ")).toMatch(/day-first/);
    // An unambiguous date assumes nothing.
    expect(known({ start: "25/12/2023", end: "31/12/2023" }).assumptions).toEqual([]);
    // Same day and month cannot be read two ways.
    expect(known({ text: "05/05/2023" }).assumptions).toEqual([]);
  });

  it("refuses a month-first date rather than flipping it", () => {
    const r = unknown({ start: "12/25/2023", end: "12/31/2023" });
    expect(r.reason).toMatch(/not a date this system can read/);
    expect(unknown({ text: "11/25/2023" }).status).toBe("unknown");
  });

  it("refuses an impossible date", () => {
    expect(unknown({ start: "31/02/2023", end: "28/02/2023" }).reason).toMatch(/not a date/);
    expect(unknown({ text: "29 Feb 2023" }).status).toBe("unknown");
    expect(known({ text: "29 Feb 2024" })).toMatchObject({ start: "2024-02-29", kind: "day" });
  });

  it("refuses a period that ends before it starts, and one with only one end", () => {
    expect(unknown({ start: "2023-11-30", end: "2023-11-01" }).reason).toMatch(/ends .* before it starts/);
    expect(unknown({ start: "2023-11-01" }).reason).toMatch(/Only one end/);
    expect(unknown({ end: "2023-11-30" }).reason).toMatch(/Only one end/);
  });

  it("reads a month in several written forms", () => {
    for (const text of ["November 2023", "Nov 2023", "Nov-2023", "Month of November 2023", "2023-11", "11/2023", "11-2023"]) {
      expect(known({ text }), text).toMatchObject({ start: "2023-11-01", end: "2023-11-30", kind: "month" });
    }
    const short = known({ text: "Nov-23" });
    expect(short).toMatchObject({ start: "2023-11-01", end: "2023-11-30" });
    expect(short.assumptions.join(" ")).toMatch(/two-digit year/);
    expect(known({ text: "February 2024" }).end).toBe("2024-02-29");
    expect(known({ text: "February 2023" }).end).toBe("2023-02-28");
  });

  it("reads a financial year", () => {
    for (const text of ["FY2023-24", "FY 2023-24", "2023-24", "2023-2024", "Financial Year 2023-24", "F.Y. 2023-24"]) {
      expect(known({ text }), text).toMatchObject({ start: "2023-04-01", end: "2024-03-31", kind: "fy" });
    }
  });

  it("refuses two years that are not consecutive, and a year-month that is also a financial year", () => {
    expect(unknown({ text: "2023-25" }).status).toBe("unknown");
    expect(unknown({ text: "2011-12" }).reason).toMatch(/financial year .* or the month/);
  });

  it("reads a quarter of the Indian financial year when the year is stated", () => {
    expect(known({ text: "Q1 2023-24" })).toMatchObject({ start: "2023-04-01", end: "2023-06-30", kind: "quarter" });
    expect(known({ text: "Q2 FY2023-24" })).toMatchObject({ start: "2023-07-01", end: "2023-09-30" });
    expect(known({ text: "Period: Q3 2023-24" })).toMatchObject({ start: "2023-10-01", end: "2023-12-31" });
    expect(known({ text: "Q4 2023-24" })).toMatchObject({ start: "2024-01-01", end: "2024-03-31" });
    expect(known({ text: "Q3 2023-24" }).assumptions.join(" ")).toMatch(/April to March/);
  });

  it("refuses a quarter with no financial year: it may be a calendar quarter", () => {
    expect(unknown({ text: "Q3 2023" }).reason).toMatch(/calendar quarter/);
    expect(unknown({ text: "Q3" }).status).toBe("unknown");
  });

  it("reads a range written as text", () => {
    expect(known({ text: "01/11/2023 to 30/11/2023" })).toMatchObject({ start: "2023-11-01", end: "2023-11-30", kind: "month" });
    expect(known({ text: "1-Nov-23 - 15-Nov-23" })).toMatchObject({ start: "2023-11-01", end: "2023-11-15", kind: "range" });
    expect(known({ text: "2023-11-01 – 2023-11-30" })).toMatchObject({ kind: "month" });
    expect(unknown({ text: "Nov to Dec" }).reason).toMatch(/looks like a range/);
  });

  it("marks what it cannot place as unknown with a reason, and keeps what was given", () => {
    for (const text of [null, undefined, "", "   "]) {
      expect(unknown({ text })).toMatchObject({ reason: "No reporting period was printed." });
    }
    const r = unknown({ text: "the last quarter or so" });
    expect(r.reason).toMatch(/not a period this system can place/);
    expect(r.raw.text).toBe("the last quarter or so");
    expect(unknown({}).raw).toEqual({ text: null, start: null, end: null });
  });

  it("agrees with desk review's date reader wherever both read a date, and both refuse the same ones", () => {
    const inputs = ["2023-11-15", "15/11/2023", "15-11-2023", "15-Nov-2023", "15-Nov-23", "15 November 2023", "01/04/2023", "31/02/2023", "11/25/2023", "2023-02-30", "not a date", "15/13/2023"];
    for (const text of inputs) {
      const engine = isoDate(text);
      const mine = normalizePeriod({ text });
      if (engine === null) expect(mine.status, text).toBe("unknown");
      else expect(mine.status === "known" && mine.start, text).toBe(engine);
    }
    // Excel serial dates, given as fields.
    const serial = 45245;
    expect(known({ start: serial, end: serial }).start).toBe(isoDate(serial));
  });
});

describe("junk in never throws and never produces a made-up result", () => {
  const junk = ["", " ", "\u0000", "💥", "x".repeat(10_000), "1/1/1", "99/99/9999", "Q9 2023-24", "-", " - ", "to", "2023-13-01", "0000-00-00", "FY99-00", "NaN", "Infinity"];
  it("a period either places itself on a real calendar day or is unknown", () => {
    for (const text of junk) {
      const r = normalizePeriod({ text });
      if (r.status === "known") {
        expect(r.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.end >= r.start, text).toBe(true);
        expect(Number.isNaN(Date.parse(r.start)), text).toBe(false);
        expect(Number.isNaN(Date.parse(r.end)), text).toBe(false);
      } else {
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });
  it("a unit either converts to a finite number on the standard unit or is refused", () => {
    for (const unit of [...junk, "kWh2", "k Wh", "KWH", "kwh.", "µWh"]) {
      const r = normalizeQuantity(grid, { value: 100, unit });
      if (r.ok) {
        expect(Number.isFinite(r.value)).toBe(true);
        expect(r.unit).toBe("kWh");
      } else {
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });
  it("a basis never throws", () => {
    for (const text of junk) expect(() => readCalorificBasis(text)).not.toThrow();
  });
});

describe("normalizeReading: a whole reading", () => {
  it("keeps the original and reports a clean grid reading as comparable, with its period", () => {
    const raw = { value: 12.5, unit: "Lakh kWh", period: { text: "November 2023" } };
    const r = normalizeReading(grid, raw);
    expect(r.original).toBe(raw);
    expect(r.quantity).toMatchObject({ ok: true, value: 1_250_000, unit: "kWh", original: { value: 12.5, unit: "Lakh kWh" } });
    expect(r.period).toMatchObject({ status: "known", start: "2023-11-01", end: "2023-11-30" });
    expect(r).toMatchObject({ comparable: true, blockers: [] });
  });

  it("blocks a bill printed in kVAh, and still reports its period", () => {
    const r = normalizeReading(grid, { value: 5_000_000, unit: "kVAh", period: { start: "2023-11-01", end: "2023-11-30" } });
    expect(r.comparable).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/apparent energy/);
    expect(r.period.status).toBe("known");
  });

  it("an unknown period is marked unknown and does not make the quantity incomparable", () => {
    const r = normalizeReading(clinker, { value: 12_500, unit: "t", period: { text: "" } });
    expect(r.period).toMatchObject({ status: "unknown" });
    expect(r.comparable).toBe(true);
    expect(normalizeReading(clinker, { value: 12_500, unit: "t" }).period.status).toBe("unknown");
  });

  it("a certificate on a dried basis is comparable once its moisture is stated, and blocked until then", () => {
    const base = { value: 4500, unit: "kcal/kg", printedBasis: "Air-dried basis (ADB)", period: { text: "Q3 2023-24" } };
    const full = normalizeReading(gcv, { ...base, totalMoisturePct: 12, inherentMoisturePct: 4 });
    expect(full.comparable).toBe(true);
    expect(full.gcv && full.gcv.ok && full.gcv.valueOnTarget).toBeCloseTo(4125, 6);
    expect(full.period).toMatchObject({ status: "known", start: "2023-10-01", end: "2023-12-31", kind: "quarter" });

    const partial = normalizeReading(gcv, { ...base, totalMoisturePct: 12 });
    expect(partial.comparable).toBe(false);
    expect(partial.blockers.join(" ")).toMatch(/Inherent moisture/);
    // The unit still normalised; only the basis is open.
    expect(partial.quantity).toMatchObject({ ok: true, value: 4500 });
  });

  it("a net value is blocked, not converted", () => {
    const r = normalizeReading(gcv, { value: 4000, unit: "kcal/kg", printedBasis: "NCV" });
    expect(r.comparable).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/net calorific value/);
  });

  it("a coal value with no unit is blocked on the unit", () => {
    const r = normalizeReading(gcv, { value: 4200, unit: "", printedBasis: "ARB" });
    expect(r.comparable).toBe(false);
    expect(r.quantity).toMatchObject({ ok: false, code: "no_unit" });
  });
});
