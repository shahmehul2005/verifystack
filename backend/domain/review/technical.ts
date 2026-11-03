/**
 * Independent technical review (DFD 8.4).
 *
 * Technical review is a step before sign-off in which the independent reviewer
 * reads the work (facts, calculation, findings) and records approve or
 * changes-requested with comments. It is not a new role and not a new signature:
 * it is the independent reviewer's job, done earlier and on the record, and the
 * reviewer still signs separately. Both attestations are kept.
 *
 * Three rules make it mean something:
 *
 *  1. Independence. The reviewer must not have drafted the work: anyone who
 *     accepted a fact or executed a run in this engagement cannot review it.
 *  2. Freshness. A review is of a snapshot, the hash of the run inputs and the
 *     accepted facts. If either changes afterwards the review is stale and does
 *     not count; the reviewer has to look again.
 *  3. Last word. If the latest review asked for changes, sign-off is blocked
 *     whether or not the pack requires review, because a reviewer said no.
 *
 * Whether a given scheme *requires* a technical review is a pack field that
 * defaults to off. Which schemes require one is an open item in the regulatory
 * register; this module enforces the rule where a pack asks for it.
 */

import { hashCanonical } from "../canonical";

export class TechnicalReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TechnicalReviewError";
  }
}

export type ReviewDecision = "approved" | "changes_requested";

export interface ReviewSnapshotInput {
  /** `input_hash` of the latest calculation run, or null when none has run. */
  runInputHash: string | null;
  facts: Array<{ id: string; value_json: unknown; unit?: string | null }>;
}

/** Hash of what the reviewer was looking at. Order-independent over facts. */
export function reviewSnapshotHash(input: ReviewSnapshotInput): string {
  const facts = [...input.facts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => [f.id, f.value_json ?? null, f.unit ?? null]);
  return hashCanonical({ v: 1, run: input.runInputHash, facts });
}

export interface ReviewRecord {
  id: string;
  reviewer_user_id: string;
  decision: ReviewDecision;
  snapshot_hash: string;
  created_at: string;
}

export type TechnicalReviewStatus =
  | "not_required"
  | "missing"
  | "stale"
  | "changes_requested"
  | "approved";

export interface TechnicalReviewState {
  status: TechnicalReviewStatus;
  /** The review the status is based on, when there is one. */
  latest: ReviewRecord | null;
  /** True when sign-off must stop. */
  blocks: boolean;
  message: string | null;
}

/** Newest first, whatever order the caller passes. */
function newestFirst(reviews: ReviewRecord[]): ReviewRecord[] {
  return [...reviews].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function evaluateTechnicalReview(args: {
  required: boolean;
  reviews: ReviewRecord[];
  currentSnapshotHash: string;
}): TechnicalReviewState {
  const latest = newestFirst(args.reviews)[0] ?? null;

  if (!latest) {
    return args.required
      ? {
          status: "missing",
          latest: null,
          blocks: true,
          message: "This pack requires an independent technical review before sign-off, and none has been recorded.",
        }
      : { status: "not_required", latest: null, blocks: false, message: null };
  }
  if (latest.snapshot_hash !== args.currentSnapshotHash) {
    // A stale "approved" does not count. A stale "changes requested" no longer
    // describes the current work either, so it only blocks if review is required.
    return {
      status: "stale",
      latest,
      blocks: args.required,
      message: args.required
        ? "The facts or the calculation changed after the last technical review. It needs to be done again."
        : null,
    };
  }
  if (latest.decision === "changes_requested") {
    return {
      status: "changes_requested",
      latest,
      blocks: true,
      message: "The independent reviewer asked for changes. Address them and request a new review before sign-off.",
    };
  }
  return { status: "approved", latest, blocks: false, message: null };
}

export function assertTechnicalReviewAllowsSignoff(state: TechnicalReviewState): void {
  if (state.blocks && state.message) throw new TechnicalReviewError(state.message);
}

/** Users who drafted the work: accepted a fact or executed a run. */
export function draftersOf(args: {
  factAcceptors: Array<string | null | undefined>;
  runCreators: Array<string | null | undefined>;
}): Set<string> {
  const out = new Set<string>();
  for (const id of [...args.factAcceptors, ...args.runCreators]) if (id) out.add(id);
  return out;
}

export function assertReviewerIndependent(reviewerUserId: string, drafters: Set<string>): void {
  if (drafters.has(reviewerUserId)) {
    throw new TechnicalReviewError(
      "You accepted facts or executed a run in this engagement, so you cannot be its technical reviewer. Another independent reviewer has to do it."
    );
  }
}

export const MIN_REVIEW_COMMENT_CHARS = 10;

/** Changes-requested needs reasons; an approval may be brief but not silent. */
export function assertReviewInput(decision: ReviewDecision, comments: string): void {
  const text = comments.trim();
  if (decision === "changes_requested" && text.length < MIN_REVIEW_COMMENT_CHARS) {
    throw new TechnicalReviewError("Say what needs to change (at least a short sentence).");
  }
  if (decision === "approved" && text.length === 0) {
    throw new TechnicalReviewError("Record what you checked, even briefly, before approving.");
  }
}
