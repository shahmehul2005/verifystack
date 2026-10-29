import { CEMENT_DESK_REVIEW } from "./cement";
import type { DeskReviewDef } from "./engine";

export * from "./engine";
export * from "./propose";
export * from "./summary";
export * from "./resolution";

const DEFS: Record<string, DeskReviewDef> = {
  [CEMENT_DESK_REVIEW.packId]: CEMENT_DESK_REVIEW,
};

/** The desk review for a pack, or fallback to the CCTS verification definition. */
export function deskReviewFor(packId: string): DeskReviewDef | null {
  return DEFS[packId] ?? CEMENT_DESK_REVIEW;
}
