/**
 * Deterministic normalisation of a reading against a registry entry: unit, calorific basis and
 * reporting period.
 *
 * Code only. A model proposes the value and the words printed beside it; nothing here asks one.
 * Three rules hold throughout:
 *
 *  1. The original is kept. Every result carries the value, unit, basis and period exactly as given,
 *     so a normalised figure can always be traced back to what was read.
 *  2. Nothing is guessed. A unit that is not recognised, an apparent-energy unit, a basis the page
 *     does not state, a period that cannot be placed: each is refused or marked unknown with a reason
 *     a finding can quote. An unknown period is a state, not a default.
 *  3. Existing machinery is reused, not copied: dimension-checked conversion and the refusal of kVAh
 *     and Nm3 come from `domain/units`, the moisture-basis arithmetic from
 *     `deskreview/moistureBasis`, and the financial-year label reader from `packs/emissionBasis`.
 *
 * It does not compare anything across sources. That is a later step, and it never copies a value from
 * one store into another.
 */

import { convert, dimensionOf, parseUnit, qty, UnitError, type Dimension as UnitDimension, type Unit } from "../units";
import { convertCalorificValue, type MoistureBasis } from "../deskreview/moistureBasis";
import { fyStartOf } from "../packs/emissionBasis";
import type { Dimension, RegistryEntry } from "./types";

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

export type UnitRefusal =
  | "not_finite"
  | "negative"
  | "no_unit"
  | "unknown_unit"
  | "apparent_energy"
  | "wrong_dimension"
  | "not_allowed";

export type UnitOutcome =
  | {
      ok: true;
      /** In the entry's standard unit. */
      value: number;
      unit: string;
      /** The unit as the document printed it, and the value before any scaling or conversion. */
      original: { value: number; unit: string };
    }
  | { ok: false; code: UnitRefusal; reason: string };

/** Indian reports state big figures in lakh and crore. Only these two scales are understood. */
const SCALES: [RegExp, number, string][] = [
  [/^(?:lakh|lac)s?\s+/i, 100_000, "lakh"],
  [/^crores?\s+/i, 10_000_000, "crore"],
];

/** The registry's dimension, in the units module's name for it. */
const UNIT_DIMENSION: Record<Dimension, UnitDimension> = {
  mass: "mass",
  energy: "energy",
  calorific_value: "specific_energy",
};

/**
 * Put a value on the entry's standard unit, or refuse and say why.
 *
 * Refuses, never converts, when: the value is not a finite non-negative number; no unit was printed;
 * the unit is not one the units module knows; the unit is apparent energy (kVAh); the unit is of
 * another dimension (a kW is not a kWh); or the unit converts but the entry does not allow it.
 */
export function normalizeQuantity(entry: RegistryEntry, raw: { value: number; unit: string | null | undefined }): UnitOutcome {
  const printed = (raw.unit ?? "").trim();
  if (!Number.isFinite(raw.value)) return { ok: false, code: "not_finite", reason: `${raw.value} is not a number.` };
  if (raw.value < 0) return { ok: false, code: "negative", reason: `${raw.value} is negative; ${entry.key} cannot be.` };
  if (printed === "") {
    return { ok: false, code: "no_unit", reason: `No unit was printed beside the figure, so it cannot be placed on ${entry.standardUnit}. Enter the unit from the page.` };
  }

  // Apparent energy is not active energy; the power factor sits between them. The units module refuses
  // it by leaving it out, and this says why instead of reporting an unknown unit.
  if (/(?:^|[^a-z])[kmg]?vah(?![a-z])/i.test(printed)) {
    return { ok: false, code: "apparent_energy", reason: `${printed} is apparent energy, not active energy. It differs by the power factor and is not read as kWh.` };
  }

  let scale = 1;
  let body = printed;
  for (const [pattern, factor] of SCALES) {
    if (pattern.test(body)) {
      scale = factor;
      body = body.replace(pattern, "");
      break;
    }
  }

  const unit = parseUnit(body);
  if (!unit) return { ok: false, code: "unknown_unit", reason: `The unit "${printed}" is not one this system knows, and it will not guess.` };

  const wanted = UNIT_DIMENSION[entry.dimension];
  if (dimensionOf(unit) !== wanted) {
    return { ok: false, code: "wrong_dimension", reason: `${printed} is a ${dimensionOf(unit)} unit; ${entry.key} is ${wanted}.` };
  }
  if (!entry.validation.allowedUnits.includes(unit)) {
    return { ok: false, code: "not_allowed", reason: `${unit} is not an accepted unit for ${entry.key} (accepted: ${entry.validation.allowedUnits.join(", ")}).` };
  }

  try {
    const target = entry.standardUnit as Unit;
    const out = convert(qty(raw.value * scale, unit), target);
    return { ok: true, value: out.value, unit: entry.standardUnit, original: { value: raw.value, unit: printed } };
  } catch (e) {
    if (e instanceof UnitError) return { ok: false, code: "wrong_dimension", reason: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Calorific basis
// ---------------------------------------------------------------------------------------------

/** What a certificate prints beside a calorific value. Two separate questions, often on one line. */
export interface PrintedBasis {
  /** Wet or dried: as received, air dried, dry. */
  moisture: "ARB" | "ADB" | "DB" | "unknown";
  /** Gross or net heating value. */
  heating: "GCV" | "NCV" | "unknown";
  /** The words read, exactly as given. */
  printed: string | null;
  /** True when the line states two answers to one question (ARB and ADB together). */
  conflicting: boolean;
  /** Why a part is unknown, when the words were there but not usable. */
  note?: string;
}

/**
 * Read the basis words printed beside a calorific value. Only what is printed is returned. A word that
 * is not recognised leaves that part unknown. "Dry ash free" and similar are not a moisture basis this
 * system converts, so they are reported as unknown with a note, not mapped onto the nearest basis.
 */
export function readCalorificBasis(printed: string | null | undefined): PrintedBasis {
  const text = (printed ?? "").trim();
  if (text === "") return { moisture: "unknown", heating: "unknown", printed: null, conflicting: false };
  const t = text.toLowerCase();

  const unsupported = /\bdaf\b|dry[\s,.-]*ash[\s,.-]*free|\bmmmf\b|\bmmf\b|mineral[\s-]*matter[\s-]*free/.test(t);
  const found = new Set<"ARB" | "ADB" | "DB">();
  if (!unsupported) {
    if (/\bas[\s-]*(received|fired)\b|\barb\b/.test(t)) found.add("ARB");
    if (/\bair[\s-]*(dried|dry)\b|\badb\b/.test(t)) found.add("ADB");
    // "dry" on its own, but not the "dry" inside "air dry".
    if (/\bdb\b|\bdry\s+basis\b|\bmoisture[\s-]*free\b|(?<!air[\s-])\bdry\b(?!\s*ash)/.test(t) && !found.has("ADB")) found.add("DB");
  }

  const heatingFound = new Set<"GCV" | "NCV">();
  if (/\bgcv\b|\bgross\b|\bhhv\b|higher\s+heating/.test(t)) heatingFound.add("GCV");
  if (/\bncv\b|\bnet\b|\blhv\b|lower\s+heating/.test(t)) heatingFound.add("NCV");

  const moistureConflict = found.size > 1;
  const heatingConflict = heatingFound.size > 1;
  return {
    moisture: found.size === 1 ? [...found][0]! : "unknown",
    heating: heatingFound.size === 1 ? [...heatingFound][0]! : "unknown",
    printed: text,
    conflicting: moistureConflict || heatingConflict,
    ...(unsupported ? { note: "A dry-ash-free or mineral-matter-free basis is not converted by this system." } : {}),
  };
}

export type GcvOutcome =
  | {
      ok: true;
      /** kcal/kg exactly as converted from the printed unit, on whatever basis the page states. */
      valueKcalPerKg: number;
      unit: "kcal/kg";
      basis: PrintedBasis;
      target: "ARB" | "ADB";
      /** The value on the target basis, or null with `targetReason` saying why it could not be moved there. */
      valueOnTarget: number | null;
      targetReason: string | null;
    }
  | { ok: false; code: UnitRefusal | "net_value" | "conflicting_basis"; reason: string };

export interface GcvInput {
  value: number;
  unit: string | null | undefined;
  /** The basis words as printed beside the value. */
  printedBasis: string | null | undefined;
  /** Percent, as printed, for the sample the value belongs to. */
  totalMoisturePct?: number | null;
  inherentMoisturePct?: number | null;
}

/**
 * A coal calorific value on the entry's unit and, where the page and its moisture figures allow it, on
 * the target moisture basis.
 *
 * Refuses a net value: the entry is gross, and a net figure is a different number, not a different
 * unit. Refuses a basis that states two answers. A value whose moisture basis is not printed is still
 * returned in kcal/kg, with `valueOnTarget` null and the reason; it is never assumed to be as received.
 */
export function normalizeCoalGcv(entry: RegistryEntry, input: GcvInput, target: "ARB" | "ADB" = "ARB"): GcvOutcome {
  const unit = normalizeQuantity(entry, { value: input.value, unit: input.unit });
  if (!unit.ok) return { ok: false, code: unit.code, reason: unit.reason };

  const basis = readCalorificBasis(input.printedBasis);
  if (basis.conflicting) {
    return { ok: false, code: "conflicting_basis", reason: `The basis "${basis.printed}" states two answers to one question, so none is taken.` };
  }
  if (basis.heating === "NCV") {
    return { ok: false, code: "net_value", reason: `The value is printed as a net calorific value ("${basis.printed}"). ${entry.key} is gross; a net value is a different figure and is not converted.` };
  }

  const moisture: MoistureBasis = basis.moisture === "unknown" ? "NA" : basis.moisture;
  const converted = convertCalorificValue(
    {
      value: unit.value,
      basis: moisture,
      totalMoisturePct: input.totalMoisturePct ?? null,
      inherentMoisturePct: input.inherentMoisturePct ?? null,
    },
    target
  );

  return {
    ok: true,
    valueKcalPerKg: unit.value,
    unit: "kcal/kg",
    basis,
    target,
    valueOnTarget: converted.ok ? converted.value : null,
    targetReason: converted.ok ? null : converted.reason,
  };
}

// ---------------------------------------------------------------------------------------------
// Reporting period
// ---------------------------------------------------------------------------------------------

export interface PeriodInput {
  /** The period as printed ("November 2023", "Q3 2023-24", "01/11/2023 to 30/11/2023"). */
  text?: string | null;
  /** A start and end date, where the document gives them as fields. Both are needed. */
  start?: string | number | null;
  end?: string | number | null;
}

export type PeriodKind = "day" | "month" | "quarter" | "fy" | "range";

export type PeriodOutcome =
  | {
      status: "known";
      /** Inclusive, ISO dates. */
      start: string;
      end: string;
      kind: PeriodKind;
      /** Readings made to place it, such as day-first for 03/04/2023. Empty when nothing was assumed. */
      assumptions: string[];
      raw: PeriodInput;
    }
  | { status: "unknown"; reason: string; raw: PeriodInput };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar date as YYYY-MM-DD, or null. 31 February is not a date. */
function calendar(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function monthNumber(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return 0;
  return MONTHS.findIndex((name) => name.startsWith(w)) + 1;
}

const fullYear = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

interface ParsedDate {
  iso: string;
  assumptions: string[];
}

/**
 * One date. Accepts YYYY-MM-DD, day-first numeric forms (15/11/2023, 15-11-2023, 15.11.2023), named
 * months (15-Nov-2023, 15 November 2023) and Excel serial numbers. A slashed date is read day-first,
 * never month-first: 12/25/2023 is refused, not flipped. A date where both parts could be a month
 * (03/04/2023) is read day-first and says so.
 */
function parseDate(v: unknown): ParsedDate | null {
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) return { iso: new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10), assumptions: [] };
    return null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return d ? { iso: d, assumptions: [] } : null;
  }

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const assumptions: string[] = [];
    if (dmy[3]!.length === 2) assumptions.push(`two-digit year ${dmy[3]} read as 20${dmy[3]}`);
    const d = calendar(fullYear(dmy[3]!), month, day);
    if (!d) return null;
    if (day <= 12 && month <= 12 && day !== month) assumptions.push(`${s} read day-first (${day} ${MONTHS[month - 1]})`);
    return { iso: d, assumptions };
  }

  const named = /^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})\.?,?[\s/.-]+(\d{4}|\d{2})$/.exec(s);
  if (named) {
    const month = monthNumber(named[2]!);
    if (!month) return null;
    const assumptions = named[3]!.length === 2 ? [`two-digit year ${named[3]} read as 20${named[3]}`] : [];
    const d = calendar(fullYear(named[3]!), month, Number(named[1]));
    return d ? { iso: d, assumptions } : null;
  }
  return null;
}

const known = (start: string, end: string, kind: PeriodKind, assumptions: string[], raw: PeriodInput): PeriodOutcome => ({ status: "known", start, end, kind, assumptions, raw });
const unknown = (reason: string, raw: PeriodInput): PeriodOutcome => ({ status: "unknown", reason, raw });

/** Whether a start-to-end span is exactly one calendar month. */
function isWholeMonth(start: string, end: string): boolean {
  const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = end.split("-").map(Number) as [number, number, number];
  return sy === ey && sm === em && sd === 1 && ed === lastDay(sy, sm);
}

function fromDates(a: ParsedDate, b: ParsedDate, raw: PeriodInput): PeriodOutcome {
  if (b.iso < a.iso) return unknown(`The period ends (${b.iso}) before it starts (${a.iso}).`, raw);
  const assumptions = [...a.assumptions, ...b.assumptions];
  const kind: PeriodKind = a.iso === b.iso ? "day" : isWholeMonth(a.iso, b.iso) ? "month" : "range";
  return known(a.iso, b.iso, kind, assumptions, raw);
}

/**
 * Place a printed reporting period on the calendar, or say that it cannot be placed.
 *
 * Understood: a start and end date given as fields; a single date; "01/11/2023 to 30/11/2023"; a month
 * ("November 2023", "Nov-23", "2023-11", "11/2023"); a financial year ("FY2023-24", "2023-24"); and an
 * Indian financial-year quarter with its year ("Q3 2023-24" is October to December 2023). A quarter with
 * no financial year ("Q3 2023") is refused: it could be a calendar quarter. Anything else is unknown.
 */
export function normalizePeriod(input: PeriodInput): PeriodOutcome {
  const raw: PeriodInput = { text: input.text ?? null, start: input.start ?? null, end: input.end ?? null };
  const hasStart = input.start !== null && input.start !== undefined && String(input.start).trim() !== "";
  const hasEnd = input.end !== null && input.end !== undefined && String(input.end).trim() !== "";

  if (hasStart || hasEnd) {
    if (!(hasStart && hasEnd)) return unknown("Only one end of the period was given; a start and an end are both needed.", raw);
    const a = parseDate(input.start);
    const b = parseDate(input.end);
    if (!a) return unknown(`The period start "${input.start}" is not a date this system can read.`, raw);
    if (!b) return unknown(`The period end "${input.end}" is not a date this system can read.`, raw);
    return fromDates(a, b, raw);
  }

  const text = (input.text ?? "").trim();
  if (text === "") return unknown("No reporting period was printed.", raw);

  // Quarter of an Indian financial year, with the year stated.
  const quarter = /\bq\s*([1-4])\b[\s,.-]*(?:fy|f\.y\.?)?[\s-]*(\d{4}\s*[-–/]\s*(?:\d{4}|\d{2}))/i.exec(text);
  if (quarter) {
    const fy = fyStartOf(quarter[2]);
    if (fy === null) return unknown(`"${quarter[2]}" is not a financial year this system can read.`, raw);
    const q = Number(quarter[1]);
    const [y, m] = q === 1 ? [fy, 4] : q === 2 ? [fy, 7] : q === 3 ? [fy, 10] : [fy + 1, 1];
    return known(`${y}-${pad(m)}-01`, `${y}-${pad(m + 2)}-${pad(lastDay(y, m + 2))}`, "quarter", [`Q${q} read as a quarter of the Indian financial year (April to March)`], raw);
  }
  if (/\bq\s*[1-4]\b/i.test(text)) {
    return unknown(`"${text}" names a quarter without a financial year, so it could be a calendar quarter. It is not guessed.`, raw);
  }

  // A financial year on its own.
  if (/^(?:fy|f\.y\.?|financial\s+year)?[\s:]*\d{4}\s*[-–/]\s*(?:\d{4}|\d{2})$/i.test(text)) {
    const fy = fyStartOf(text);
    if (fy !== null) {
      // "2011-12" is both a financial year and December 2011. For any later year the second part is not
      // a month, so this only bites where the two readings genuinely collide.
      const asMonth = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
      if (asMonth) return unknown(`"${text}" could be the financial year ${fy}-${String((fy + 1) % 100).padStart(2, "0")} or the month ${text}. It is not guessed.`, raw);
      return known(`${fy}-04-01`, `${fy + 1}-03-31`, "fy", [], raw);
    }
    // Two years that are not consecutive ("2023-25") may still be a year and a month ("2023-11"); fall through.
  }

  // A range written as text.
  const parts = text.split(/\s+(?:to|till|until)\s+|\s+[-–—]\s+/i);
  if (parts.length === 2) {
    const a = parseDate(parts[0]);
    const b = parseDate(parts[1]);
    if (a && b) return fromDates(a, b, raw);
    return unknown(`"${text}" looks like a range but its ends are not dates this system can read.`, raw);
  }

  // A month.
  const monthYear = /^(?:month\s+of\s+)?([A-Za-z]{3,9})\.?[\s,.-]+(\d{4}|\d{2})$/i.exec(text);
  if (monthYear) {
    const month = monthNumber(monthYear[1]!);
    if (month) {
      const y = fullYear(monthYear[2]!);
      const assumptions = monthYear[2]!.length === 2 ? [`two-digit year ${monthYear[2]} read as 20${monthYear[2]}`] : [];
      if (calendar(y, month, 1)) return known(`${y}-${pad(month)}-01`, `${y}-${pad(month)}-${pad(lastDay(y, month))}`, "month", assumptions, raw);
    }
  }
  const ym = /^(\d{4})-(\d{2})$/.exec(text) ?? /^(\d{1,2})[/.-](\d{4})$/.exec(text);
  if (ym) {
    const [y, m] = ym[0].includes("-") && ym[1]!.length === 4 ? [Number(ym[1]), Number(ym[2])] : [Number(ym[2]), Number(ym[1])];
    if (m >= 1 && m <= 12 && calendar(y, m, 1)) return known(`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay(y, m))}`, "month", [], raw);
  }

  // A single date.
  const single = parseDate(text);
  if (single) return known(single.iso, single.iso, "day", single.assumptions, raw);

  return unknown(`"${text}" is not a period this system can place on the calendar.`, raw);
}

// ---------------------------------------------------------------------------------------------
// A reading, normalised
// ---------------------------------------------------------------------------------------------

export interface RawReading {
  value: number;
  unit: string | null | undefined;
  /** For a calorific value: the basis words as printed, and the moisture figures beside it. */
  printedBasis?: string | null;
  totalMoisturePct?: number | null;
  inherentMoisturePct?: number | null;
  period?: PeriodInput;
}

export interface NormalizedReading {
  key: string;
  /** Exactly what was given. */
  original: RawReading;
  quantity: UnitOutcome;
  /** Present for a calorific value only. */
  gcv?: GcvOutcome;
  period: PeriodOutcome;
  /** True when the quantity (and, for a calorific value, its basis) can be set beside another source. */
  comparable: boolean;
  /** Why it cannot be compared, in words a finding can quote. Empty when comparable. */
  blockers: string[];
}

/**
 * Normalise one reading against its entry. The period is reported on its own and does not block
 * comparability: whether a reading's period matters depends on what it is compared with, which is the
 * comparison's decision, not this one's.
 */
export function normalizeReading(entry: RegistryEntry, raw: RawReading, target: "ARB" | "ADB" = "ARB"): NormalizedReading {
  const period = normalizePeriod(raw.period ?? {});
  const blockers: string[] = [];

  if (entry.dimension === "calorific_value") {
    const gcv = normalizeCoalGcv(entry, { value: raw.value, unit: raw.unit, printedBasis: raw.printedBasis, totalMoisturePct: raw.totalMoisturePct, inherentMoisturePct: raw.inherentMoisturePct }, target);
    const quantity: UnitOutcome = gcv.ok
      ? { ok: true, value: gcv.valueKcalPerKg, unit: "kcal/kg", original: { value: raw.value, unit: (raw.unit ?? "").trim() } }
      : normalizeQuantity(entry, { value: raw.value, unit: raw.unit });
    if (!gcv.ok) blockers.push(gcv.reason);
    else if (gcv.valueOnTarget === null) blockers.push(gcv.targetReason ?? "The basis could not be applied.");
    return { key: entry.key, original: raw, quantity, gcv, period, comparable: blockers.length === 0, blockers };
  }

  const quantity = normalizeQuantity(entry, { value: raw.value, unit: raw.unit });
  if (!quantity.ok) blockers.push(quantity.reason);
  return { key: entry.key, original: raw, quantity, period, comparable: quantity.ok, blockers };
}
