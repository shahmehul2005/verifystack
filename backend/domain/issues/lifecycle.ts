/**
 * Issue lifecycle (DFD 7.0).
 *
 *   suggested ──► accepted / edited ──► open ──► responded ──► verified ──► closed
 *        │              │                │          │
 *        └► rejected ◄──┴────────────────┘          └──► open (response not enough)
 *
 * `suggested`, `accepted`, `edited` and `rejected` are the drafting states the
 * product already had: a rule or a model proposes, a person decides. `open`,
 * `responded` and `verified` are the new states that track the conversation
 * with the entity once an issue has been raised.
 *
 * Severity changes the path. A `block` issue must be answered and verified
 * before it can close: closing it straight from a draft would let the verifier
 * sign off a calculation the rules said was unsafe without ever recording why
 * it was now fine. `warn` and `info` issues may close from a decided draft,
 * because they inform rather than gate.
 */

export type IssueState =
  | "suggested"
  | "accepted"
  | "edited"
  | "rejected"
  | "open"
  | "responded"
  | "verified"
  | "closed";

export type IssueSeverity = "block" | "warn" | "info";

export const ISSUE_STATES: readonly IssueState[] = [
  "suggested",
  "accepted",
  "edited",
  "rejected",
  "open",
  "responded",
  "verified",
  "closed",
];

export const ISSUE_STATE_LABEL: Record<IssueState, string> = {
  suggested: "Suggested",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
  open: "Open with entity",
  responded: "Responded",
  verified: "Verified",
  closed: "Closed",
};

const BASE: Record<IssueState, IssueState[]> = {
  suggested: ["accepted", "edited", "rejected"],
  accepted: ["edited", "open", "rejected", "closed"],
  edited: ["accepted", "open", "rejected", "closed"],
  open: ["responded", "rejected"],
  responded: ["verified", "open"],
  verified: ["closed", "open"],
  rejected: [],
  closed: [],
};

export class IssueTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueTransitionError";
  }
}

export function allowedTransitions(from: IssueState, severity: IssueSeverity): IssueState[] {
  const next = BASE[from] ?? [];
  // block: a decided draft cannot skip the response and verification steps.
  return severity === "block" && (from === "accepted" || from === "edited")
    ? next.filter((s) => s !== "closed")
    : next;
}

export function canTransition(from: IssueState, to: IssueState, severity: IssueSeverity): boolean {
  return allowedTransitions(from, severity).includes(to);
}

export function assertTransition(from: IssueState, to: IssueState, severity: IssueSeverity): void {
  if (from === to) throw new IssueTransitionError(`The issue is already ${ISSUE_STATE_LABEL[from].toLowerCase()}.`);
  if (canTransition(from, to, severity)) return;
  if (severity === "block" && to === "closed" && (from === "accepted" || from === "edited")) {
    throw new IssueTransitionError(
      "A block issue has to be opened with the entity, answered and verified before it can close."
    );
  }
  throw new IssueTransitionError(
    `An issue cannot move from ${ISSUE_STATE_LABEL[from].toLowerCase()} to ${ISSUE_STATE_LABEL[to].toLowerCase()}.`
  );
}

/** Issues that stop an engagement reaching sign-off. A rejected or closed block issue does not. */
export function isBlockingOpen(f: { severity: IssueSeverity; state: IssueState }): boolean {
  return f.severity === "block" && f.state !== "closed" && f.state !== "rejected";
}

/** States in which the entity may be asked something, or has been. */
export const WITH_ENTITY: readonly IssueState[] = ["open", "responded"];

export type Ageing = "no_due_date" | "on_time" | "due_soon" | "overdue" | "settled";

export const DUE_SOON_DAYS = 3;
/** The date offered when an issue is opened. A firm default, not a scheme period. */
export const DEFAULT_RESPONSE_DAYS = 14;

export function defaultDueDate(from: Date, days = DEFAULT_RESPONSE_DAYS): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

export function ageing(
  f: { state: IssueState; due_at?: string | null },
  now: Date = new Date()
): { status: Ageing; daysLeft: number | null } {
  if (f.state === "verified" || f.state === "closed" || f.state === "rejected") {
    return { status: "settled", daysLeft: null };
  }
  if (f.state !== "open" && f.state !== "responded") return { status: "no_due_date", daysLeft: null };
  if (!f.due_at) return { status: "no_due_date", daysLeft: null };
  const due = Date.parse(f.due_at);
  if (!Number.isFinite(due)) return { status: "no_due_date", daysLeft: null };
  // A responded issue is waiting on the verifier, not the entity, so it cannot be late.
  const daysLeft = Math.ceil((due - now.getTime()) / 86_400_000);
  if (f.state === "responded") return { status: "on_time", daysLeft };
  if (due < now.getTime()) return { status: "overdue", daysLeft };
  return { status: daysLeft <= DUE_SOON_DAYS ? "due_soon" : "on_time", daysLeft };
}

export interface IssueSummary {
  total: number;
  byState: Record<IssueState, number>;
  blockingOpen: number;
  overdue: number;
  awaitingVerifier: number;
}

export function summariseIssues(
  issues: Array<{ state: IssueState; severity: IssueSeverity; due_at?: string | null }>,
  now: Date = new Date()
): IssueSummary {
  const byState = Object.fromEntries(ISSUE_STATES.map((s) => [s, 0])) as Record<IssueState, number>;
  let blockingOpen = 0;
  let overdue = 0;
  for (const i of issues) {
    byState[i.state] += 1;
    if (isBlockingOpen(i)) blockingOpen++;
    if (ageing(i, now).status === "overdue") overdue++;
  }
  return { total: issues.length, byState, blockingOpen, overdue, awaitingVerifier: byState.responded };
}
