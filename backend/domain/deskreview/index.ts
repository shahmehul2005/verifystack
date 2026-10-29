import { CEMENT_DESK_REVIEW } from "./cement";
import type { DeskReviewDef } from "./engine";

export * from "./engine";
export * from "./propose";

const DEFS: Record<string, DeskReviewDef> = {
  [CEMENT_DESK_REVIEW.packId]: CEMENT_DESK_REVIEW,
};

/** The desk review for a pack, or null when none is defined. A new sector adds a def, not a code path. */
export function deskReviewFor(packId: string): DeskReviewDef | null {
  return DEFS[packId] ?? null;
}
