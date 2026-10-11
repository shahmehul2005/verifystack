/**
 * Declared vs extracted comparison (DFD 4.2).
 *
 * The entity under verification declares figures (in a submission form, an
 * evidence pack, or typed in at setup). The evidence says something too. This
 * module lines the two up, per field, and says whether they agree. It is
 * arithmetic and unit conversion only: it never decides which side is right,
 * and a disagreement is a prompt for a person, not a verdict.
 *
 * The tolerance is a matching policy, not a regulatory threshold. A declared
 * 18,250 against an extracted 18,247.5 is the same number rounded; 18,250
 * against 15,000 is not. Where a scheme prescribes a tolerance, it goes in the
 * pack and replaces the default.
 */

import { convert, dimensionOf, parseUnit, qty } from "../units";
import { matchFactPath } from "../extraction/fieldPaths";

/** Relative difference below which two figures count as the same. */
export const DEFAULT_TOLERANCE = 0.005;

export interface DeclaredValue {
  fieldPath: string;
  value: number | string | boolean | null;
  unit?: string | null;
  /** Where the declaration came from, e.g. "evidence_pack", "setup", "manual". */
  source: string;
}

export interface EvidenceValue {
  fieldPath: string;
  value: unknown;
  unit?: string | null;
  /** Id of the fact or extracted field, so a finding can point at it. */
  refId: string;
}

export type ComparisonStatus =
  | "match"
  | "within_tolerance"
  | "mismatch"
  | "unit_mismatch"
  | "not_comparable"
  | "no_evidence"
  | "no_declaration";

export interface Comparison {
  fieldPath: string;
  status: ComparisonStatus;
  declared: DeclaredValue | null;
  evidence: EvidenceValue | null;
  /** Evidence minus declared, in the declared unit. Null unless both are numbers in one dimension. */
  difference: number | null;
  /** |difference| / |declared|. Null when declared is zero or not comparable. */
  relativeDifference: number | null;
  note: string;
}

function numeric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v !== null && "value" in v) {
    return numeric((v as { value: unknown }).value);
  }
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(/,/g, "")))) {
    return Number(v.replace(/,/g, ""));
  }
  return null;
}

type Outcome = Pick<Comparison, "status" | "difference" | "relativeDifference" | "note">;

function compareOne(declared: DeclaredValue, evidence: EvidenceValue, tolerance: number): Outcome {
  const dNum = numeric(declared.value);
  const eNum = numeric(evidence.value);

  // Non-numeric: exact comparison after trimming and case folding.
  if (dNum === null || eNum === null) {
    if (dNum !== null || eNum !== null) {
      return { status: "not_comparable", difference: null, relativeDifference: null, note: "One side is a number and the other is text." };
    }
    const same =
      String(declared.value ?? "").trim().toLowerCase() === String(evidence.value ?? "").trim().toLowerCase();
    return {
      status: same ? "match" : "mismatch",
      difference: null,
      relativeDifference: null,
      note: same ? "Text agrees." : "Text differs.",
    };
  }

  let eInDeclared = eNum;
  const dUnitRaw = declared.unit?.trim();
  const eUnitRaw = evidence.unit?.trim();
  if (dUnitRaw && eUnitRaw && dUnitRaw !== eUnitRaw) {
    const du = parseUnit(dUnitRaw);
    const eu = parseUnit(eUnitRaw);
    if (!du || !eu) {
      return {
        status: "unit_mismatch",
        difference: null,
        relativeDifference: null,
        note: `Unit not recognised (${!du ? dUnitRaw : eUnitRaw}).`,
      };
    }
    if (dimensionOf(du) !== dimensionOf(eu)) {
      return {
        status: "unit_mismatch",
        difference: null,
        relativeDifference: null,
        note: `Declared in ${dUnitRaw} (${dimensionOf(du)}) but evidence is in ${eUnitRaw} (${dimensionOf(eu)}).`,
      };
    }
    eInDeclared = convert(qty(eNum, eu), du).value;
  } else if ((dUnitRaw && !eUnitRaw) || (!dUnitRaw && eUnitRaw)) {
    return {
      status: "unit_mismatch",
      difference: null,
      relativeDifference: null,
      note: "Only one side states a unit, so the figures cannot be compared safely.",
    };
  }

  const difference = eInDeclared - dNum;
  const relative = dNum === 0 ? (difference === 0 ? 0 : null) : Math.abs(difference) / Math.abs(dNum);
  if (difference === 0) return { status: "match", difference, relativeDifference: 0, note: "Identical." };
  if (relative !== null && relative <= tolerance) {
    return {
      status: "within_tolerance",
      difference,
      relativeDifference: relative,
      note: `Differs by ${(relative * 100).toFixed(3)}%, inside the ${(tolerance * 100).toFixed(2)}% matching tolerance.`,
    };
  }
  return {
    status: "mismatch",
    difference,
    relativeDifference: relative,
    note:
      relative === null
        ? "Declared zero, evidence is not."
        : `Differs by ${(relative * 100).toFixed(2)}%, outside the ${(tolerance * 100).toFixed(2)}% matching tolerance.`,
  };
}

/**
 * Compare every declared value with the evidence for the same field. A declared
 * path is matched to evidence with `matchFactPath`, the same matcher the
 * calculation bindings use, so "electricity.activeEnergy" finds the stored
 * `activeEnergy`. When several evidence values match, the closest one is
 * compared and the count is noted.
 */
export function compareDeclared(
  declared: DeclaredValue[],
  evidence: EvidenceValue[],
  opts: { tolerance?: number } = {}
): Comparison[] {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const out: Comparison[] = [];
  const used = new Set<string>();

  for (const d of declared) {
    const candidates = evidence.filter((e) => matchFactPath(e.fieldPath, d.fieldPath));
    if (candidates.length === 0) {
      out.push({
        fieldPath: d.fieldPath,
        status: "no_evidence",
        declared: d,
        evidence: null,
        difference: null,
        relativeDifference: null,
        note: "Declared, but no evidence has been extracted for it.",
      });
      continue;
    }
    const rank = (x: Outcome) => (x.relativeDifference === null ? Infinity : x.relativeDifference);
    let best = candidates[0]!;
    let bestResult = compareOne(d, best, tolerance);
    for (const c of candidates.slice(1)) {
      const r = compareOne(d, c, tolerance);
      if (rank(r) < rank(bestResult)) {
        best = c;
        bestResult = r;
      }
    }
    candidates.forEach((c) => used.add(c.refId));
    out.push({
      fieldPath: d.fieldPath,
      declared: d,
      evidence: best,
      ...bestResult,
      note:
        candidates.length > 1
          ? `${bestResult.note} Closest of ${candidates.length} matching values.`
          : bestResult.note,
    });
  }

  // Evidence nobody declared: informational, so a gap in the declaration is visible.
  const declaredPaths = declared.map((d) => d.fieldPath);
  for (const e of evidence) {
    if (used.has(e.refId)) continue;
    if (declaredPaths.some((p) => matchFactPath(e.fieldPath, p))) continue;
    out.push({
      fieldPath: e.fieldPath,
      status: "no_declaration",
      declared: null,
      evidence: e,
      difference: null,
      relativeDifference: null,
      note: "Evidence exists for this field but the entity declared nothing.",
    });
  }
  return out;
}

export interface ComparisonSummary {
  compared: number;
  agree: number;
  disagree: number;
  unitProblems: number;
  noEvidence: number;
  noDeclaration: number;
}

export function summariseComparisons(c: Comparison[]): ComparisonSummary {
  const count = (...s: ComparisonStatus[]) => c.filter((x) => s.includes(x.status)).length;
  const agree = count("match", "within_tolerance");
  const disagree = count("mismatch", "not_comparable");
  return {
    compared: agree + disagree + count("unit_mismatch"),
    agree,
    disagree,
    unitProblems: count("unit_mismatch"),
    noEvidence: count("no_evidence"),
    noDeclaration: count("no_declaration"),
  };
}

/** Field paths whose evidence disagrees with the declaration, for risk tiering. */
export function mismatchedPaths(c: Comparison[]): Set<string> {
  const out = new Set<string>();
  for (const x of c) {
    if (x.evidence && (x.status === "mismatch" || x.status === "not_comparable" || x.status === "unit_mismatch")) {
      out.add(x.evidence.fieldPath);
    }
  }
  return out;
}
