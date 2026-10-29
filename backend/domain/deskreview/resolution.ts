/**
 * What a verifier can decide about a desk-review check, and what each decision
 * does to the linked finding. Pure: the route reads and writes, this decides.
 *
 * Five states, from the CCTS procedure's treatment of unresolved items
 * (materiality 2% of reported emissions, scope limitations):
 *
 *   resolved                    set by code when a check agrees on a re-run
 *   accepted_with_explanation   the verifier accepts the plant's explanation; the finding is closed
 *   unresolved_immaterial       noted for the report; sign-off is not held
 *   unresolved_material         the finding blocks sign-off
 *   scope_limitation            evidence is missing; the finding blocks sign-off
 *
 * A model never picks one of these. The state is the verifier's decision, with a reason.
 */

import { allowedTransitions, type IssueSeverity, type IssueState } from "../issues/lifecycle";
import type { DeskStatus } from "./engine";

export const RESOLUTION_STATES = [
  "resolved",
  "accepted_with_explanation",
  "unresolved_immaterial",
  "unresolved_material",
  "scope_limitation",
] as const;

export type ResolutionState = (typeof RESOLUTION_STATES)[number];

/** The four a verifier chooses. `resolved` is only ever set by a re-run. */
export const DECIDABLE_STATES = RESOLUTION_STATES.filter((s) => s !== "resolved") as Exclude<ResolutionState, "resolved">[];

export const RESOLUTION_LABEL: Record<ResolutionState, string> = {
  resolved: "Resolved",
  accepted_with_explanation: "Accepted with explanation",
  unresolved_immaterial: "Unresolved, immaterial",
  unresolved_material: "Unresolved, material",
  scope_limitation: "Scope limitation",
};

export const RESOLUTION_HELP: Record<Exclude<ResolutionState, "resolved">, string> = {
  accepted_with_explanation: "The plant's explanation is enough. The finding is closed and the explanation is kept with it.",
  unresolved_immaterial: "Noted for the report. Sign-off is not held.",
  unresolved_material: "The finding blocks sign-off until it is answered, verified and closed.",
  scope_limitation: "Evidence is missing. The finding blocks sign-off until it is supplied or the opinion is qualified.",
};

export const MIN_REASON_LENGTH = 10;

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}

export interface ResolutionPlan {
  /** Severity the finding has afterwards. */
  severity: IssueSeverity;
  /** States to move through, in order, from the finding's current state. Empty when the state stays. */
  path: IssueState[];
  /** The reason is logged as a response by the verifier, which a block finding's path to closed needs. */
  recordExplanation: boolean;
  blocksSignOff: boolean;
}

/** Shortest legal route to `closed`, by the lifecycle's own transition table. */
function pathToClosed(from: IssueState, severity: IssueSeverity): IssueState[] {
  if (from === "closed") return [];
  const seen = new Set<IssueState>([from]);
  let frontier: { at: IssueState; path: IssueState[] }[] = [{ at: from, path: [] }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { at, path } of frontier) {
      for (const to of allowedTransitions(at, severity)) {
        if (seen.has(to)) continue;
        // Rejected is a different outcome: the verifier is explaining, not discarding.
        if (to === "rejected") continue;
        if (to === "closed") return [...path, to];
        seen.add(to);
        next.push({ at: to, path: [...path, to] });
      }
    }
    frontier = next;
  }
  throw new ResolutionError("This finding cannot reach closed from where it is.");
}

export function planDeskResolution(input: {
  state: Exclude<ResolutionState, "resolved">;
  reason: string;
  checkStatus: DeskStatus;
  /** The linked finding, or null when it has not been raised yet. */
  finding: { severity: IssueSeverity; state: IssueState } | null;
  /** The finding for this check is block by design, whatever the verifier decides. */
  inherentBlock: boolean;
}): ResolutionPlan {
  const { state, reason, checkStatus, finding, inherentBlock } = input;
  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw new ResolutionError(`Write at least ${MIN_REASON_LENGTH} characters saying why.`);
  }
  if (checkStatus === "pass") throw new ResolutionError("This check agrees. There is nothing to decide.");
  if (checkStatus === "pending" && state !== "scope_limitation") {
    throw new ResolutionError("This check is still waiting for readings. Enter them, or record a scope limitation.");
  }
  if (checkStatus === "not_applicable") throw new ResolutionError("This check could not be decided, so there is nothing to resolve.");

  const current = finding?.state ?? "suggested";
  const terminal = current === "closed" || current === "rejected";
  const currentSeverity: IssueSeverity = finding?.severity ?? (inherentBlock ? "block" : "warn");

  switch (state) {
    case "accepted_with_explanation": {
      const path = terminal ? [] : pathToClosed(current, currentSeverity);
      return { severity: currentSeverity, path, recordExplanation: true, blocksSignOff: false };
    }
    case "unresolved_immaterial": {
      if (inherentBlock) {
        throw new ResolutionError(
          "This check holds sign-off on its own, so it cannot be marked immaterial. Accept it with an explanation, or mark it material."
        );
      }
      return { severity: "warn", path: [], recordExplanation: false, blocksSignOff: false };
    }
    case "unresolved_material":
    case "scope_limitation": {
      if (terminal) {
        throw new ResolutionError("The finding for this check is already closed or rejected, so it cannot be held open again.");
      }
      return { severity: "block", path: [], recordExplanation: false, blocksSignOff: true };
    }
  }
}

/**
 * After a re-run: checks that now agree are resolved by code, and a resolved
 * check that no longer agrees goes back to unresolved. Decisions the verifier
 * made on a check that still disagrees are left alone.
 */
export function reconcileResolutions(
  results: { id: string; status: DeskStatus }[],
  existing: { rule_id: string; resolution_state: ResolutionState }[],
  findingRuleIds: ReadonlySet<string>
): { markResolved: string[]; reopen: string[] } {
  const byRule = new Map(existing.map((e) => [e.rule_id, e.resolution_state]));
  const markResolved: string[] = [];
  const reopen: string[] = [];
  for (const r of results) {
    const had = byRule.get(r.id);
    if (r.status === "pass") {
      if (had !== undefined ? had !== "resolved" : findingRuleIds.has(`DESK-${r.id}`)) markResolved.push(r.id);
    } else if (had === "resolved") {
      reopen.push(r.id);
    }
  }
  return { markResolved, reopen };
}
