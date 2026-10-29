import type { DeskOutcome } from "./engine";

/** Checks whose finding holds sign-off by itself, whatever the verifier decides about them. */
export const BLOCK_IDS = new Set(["materiality_aggregate", "source_profile"]);

const MATERIALITY_CLAUSE =
  "CCTS Detailed Procedure — materiality 2% of total reported emissions (ICAI-hosted copy; confirm against the BEE original)";

const DESK_CLAUSE = "Desk review cross-check";

export interface DeskFindingDraft {
  ruleId: string;
  title: string;
  detail: string;
  severity: "block" | "warn";
  clauseRef: string;
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

/** A finding draft for one check, whatever its status. Used when a verifier decides a check that has no finding yet. */
export function deskFindingDraft(outcome: DeskOutcome): DeskFindingDraft {
  const waiting = outcome.status === "pending";
  return {
    ruleId: `DESK-${outcome.id}`,
    title: outcome.label,
    detail: waiting ? `Waiting for readings: ${(outcome.missing ?? []).join(", ")}.` : outcome.detail,
    severity: BLOCK_IDS.has(outcome.id) ? "block" : "warn",
    clauseRef: outcome.id === "materiality_aggregate" ? MATERIALITY_CLAUSE : DESK_CLAUSE,
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
