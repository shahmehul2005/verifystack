import type { DeskOutcome } from "./engine";
import { clauseFor, clauseText, requiredResponseFor } from "./clauses";
import { buildLeadSchedule } from "./leadSchedule";

/** Checks whose finding holds sign-off by itself, whatever the verifier decides about them. */
export const BLOCK_IDS = new Set(["materiality_aggregate", "source_profile"]);

export interface DeskFindingDraft {
  ruleId: string;
  title: string;
  detail: string;
  severity: "block" | "warn";
  clauseRef: string;
  /** The check has a clause of its own and the register lists it as verified. */
  clauseVerified: boolean;
  /** The size of the disagreement, in the check's own unit. Absent when the check has no figure to put on it. */
  magnitude?: { value: number; unit: string };
  /** What the plant is asked to supply. */
  requiredResponse: string;
  /** One line per reading the check used: the value and the document and cell or page it came from. */
  evidenceRefs: string[];
}

/** A finding's evidence list is short text, not fact ids. Each line stays under the 200 characters the CAR drafter accepts. */
export function deskEvidenceRefs(outcome: DeskOutcome): string[] {
  return (outcome.sources ?? []).map((s) => {
    const value = typeof s.value === "number" ? String(Math.round(s.value * 1e6) / 1e6) : String(s.value);
    const where = [s.filename ?? s.slot, s.location].filter(Boolean).join(" · ");
    const line = `${s.label}: ${value}${s.unit ? ` ${s.unit}` : ""}${where ? ` — ${where}` : ""}`;
    return line.length > 200 ? `${line.slice(0, 197)}...` : line;
  });
}

/** How big the disagreement is. The aggregate check reports the quantified sum; every other check reports evidenced minus declared. */
function magnitudeOf(outcome: DeskOutcome): DeskFindingDraft["magnitude"] {
  if (outcome.status !== "fail") return undefined;
  if (outcome.id === "materiality_aggregate") {
    return typeof outcome.actual === "number" ? { value: Math.abs(outcome.actual), unit: "tCO2e" } : undefined;
  }
  const row = buildLeadSchedule({ outcomes: [outcome] }).rows[0];
  if (!row || row.variance === null) return undefined;
  return { value: Math.abs(row.variance), unit: row.unit };
}

/**
 * A finding draft for one check, whatever its status. Built only from the
 * check's own outcome and the clause registry, so a finding never carries text
 * a browser supplied. Used when a verifier decides a check that has no finding yet.
 */
export function deskFindingDraft(outcome: DeskOutcome): DeskFindingDraft {
  const waiting = outcome.status === "pending";
  const clause = clauseFor(outcome.id);
  const magnitude = magnitudeOf(outcome);
  return {
    ruleId: `DESK-${outcome.id}`,
    title: outcome.label,
    detail: waiting ? `Waiting for readings: ${(outcome.missing ?? []).join(", ")}.` : outcome.detail,
    severity: BLOCK_IDS.has(outcome.id) ? "block" : "warn",
    clauseRef: clauseText(clause),
    clauseVerified: clause.verified && clause.specific,
    ...(magnitude ? { magnitude } : {}),
    requiredResponse: requiredResponseFor(outcome.id),
    evidenceRefs: deskEvidenceRefs(outcome),
  };
}

/**
 * One finding draft per failed desk-review check.
 * Pending and pass outcomes are omitted. The function only maps; it does not
 * remember earlier calls. The route that inserts findings skips a rule id
 * already stored in any state.
 */
export function deskFindings(outcomes: DeskOutcome[]): DeskFindingDraft[] {
  return outcomes.filter((outcome) => outcome.status === "fail").map(deskFindingDraft);
}
