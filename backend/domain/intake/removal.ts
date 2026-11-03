/**
 * When may an uploaded document be removed from an engagement?
 *
 * A mistaken upload should be removable. A document that other records rest on
 * should not: an accepted fact points at its page and box (ADR 0004), a reviewed
 * extraction is a decision somebody made, and a declared figure or a desk-review
 * reading cites it. Removing the file under any of those would leave a record
 * that claims evidence the engagement no longer holds.
 *
 * This is the rule only. The route counts the references and calls it, so the
 * rule can be tested without a database.
 */

import type { Status } from "../engagements/status";

export type DocumentSource = "upload" | "evidence_pack" | "entity_response" | "fieldwork";

/** Sources a verifier may take back. The entity's responses and fieldwork belong to their own records. */
const REMOVABLE_SOURCES: ReadonlySet<DocumentSource> = new Set(["upload", "evidence_pack"]);

/** From sign-off on, the evidence is what was signed. */
const LOCKED_STATUSES: ReadonlySet<Status> = new Set(["signoff", "submitted"]);

export interface RemovalInput {
  engagementStatus: Status;
  source: DocumentSource;
  /** Accepted facts that cite this document. */
  facts: number;
  /** Extracted fields a person accepted, rejected or corrected. Unreviewed suggestions do not count. */
  reviewedFields: number;
  /** Declared figures taken from this document. */
  declaredValues: number;
  /** Desk-review figures read from this document. */
  deskReadings: number;
}

export interface RemovalAssessment {
  allowed: boolean;
  /** Plain reasons, shown to the person who tried. Empty when allowed. */
  reasons: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function assessRemoval(input: RemovalInput): RemovalAssessment {
  const reasons: string[] = [];

  if (LOCKED_STATUSES.has(input.engagementStatus)) {
    reasons.push("The engagement is at sign-off or submitted, so its evidence is locked.");
  }
  if (!REMOVABLE_SOURCES.has(input.source)) {
    reasons.push(
      input.source === "entity_response"
        ? "This file came from the entity through a response link and is part of that finding's record."
        : "This file belongs to a fieldwork record."
    );
  }
  if (input.facts > 0) {
    reasons.push(
      `${plural(input.facts, "accepted fact cites", "accepted facts cite")} this document. Remove or supersede ${input.facts === 1 ? "it" : "them"} first.`
    );
  }
  if (input.reviewedFields > 0) {
    reasons.push(
      `${plural(input.reviewedFields, "extracted field has", "extracted fields have")} already been reviewed, and that decision would be lost.`
    );
  }
  if (input.declaredValues > 0) {
    reasons.push(`${plural(input.declaredValues, "declared figure was", "declared figures were")} taken from this document.`);
  }
  if (input.deskReadings > 0) {
    reasons.push(`${plural(input.deskReadings, "desk-review figure was", "desk-review figures were")} read from this document.`);
  }

  return { allowed: reasons.length === 0, reasons };
}
