/**
 * Evidence checklist: which labelled slots hold at least one document, and
 * whether that blocks a run or a submission.
 *
 * A slot is a label, not a classifier. The auditor assigns each document to a
 * slot by hand. Nothing here reads a filename or a model output.
 */

import type { EvidenceSlot } from "../packs/types";

export interface SlotAssignment {
  documentId: string;
  /** Slot id, or null when the document is not assigned yet. */
  slot: string | null;
}

export interface SlotStatus {
  slot: EvidenceSlot;
  documentIds: string[];
  ticked: boolean;
}

export interface ChecklistResult {
  slots: SlotStatus[];
  /** Documents assigned to a slot id the pack does not define. Shown, never counted. */
  unknownAssignments: SlotAssignment[];
  missingForRun: EvidenceSlot[];
  missingForSubmission: EvidenceSlot[];
  canRun: boolean;
  canSubmit: boolean;
}

export function evaluateChecklist(
  slots: readonly EvidenceSlot[],
  assignments: readonly SlotAssignment[]
): ChecklistResult {
  const known = new Set(slots.map((s) => s.id));
  const byId = new Map<string, string[]>();
  const unknownAssignments: SlotAssignment[] = [];
  for (const a of assignments) {
    if (a.slot === null) continue;
    if (!known.has(a.slot)) {
      unknownAssignments.push(a);
      continue;
    }
    const list = byId.get(a.slot) ?? [];
    list.push(a.documentId);
    byId.set(a.slot, list);
  }

  const statuses: SlotStatus[] = slots.map((slot) => {
    const documentIds = byId.get(slot.id) ?? [];
    return { slot, documentIds, ticked: documentIds.length > 0 };
  });

  const missingForRun = statuses.filter((s) => s.slot.gate === "run" && !s.ticked).map((s) => s.slot);
  const missingForSubmission = statuses
    .filter((s) => (s.slot.gate === "run" || s.slot.gate === "submission") && !s.ticked)
    .map((s) => s.slot);

  return {
    slots: statuses,
    unknownAssignments,
    missingForRun,
    missingForSubmission,
    canRun: missingForRun.length === 0,
    canSubmit: missingForSubmission.length === 0,
  };
}

/** True when `slotId` names a slot the pack defines. A null slot is always allowed (unassigned). */
export function isKnownSlot(slots: readonly EvidenceSlot[] | undefined, slotId: string | null): boolean {
  if (slotId === null) return true;
  return (slots ?? []).some((s) => s.id === slotId);
}
