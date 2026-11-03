/**
 * What the desk review page shows above the checks: which evidence slots are
 * empty or cover only part of the year, and the materiality position. Both are
 * read from what the run already saw. Nothing here is a model output.
 */

import type { DeskReviewDef, Readings } from "./engine";

export interface SlotCoverage {
  slot: string;
  label: string;
  /** `run` slots feed the calculation, `submission` slots are compared, `none` slots corroborate. */
  gate: string;
  documents: number;
  /** Months the documents cover, when the slot has a reading that counts them. */
  months: number | null;
  /** `missing` nothing attached. `partial` fewer than 12 months. `present` attached and nothing says it falls short. */
  state: "missing" | "partial" | "present";
}

export const PERIOD_MONTHS = 12;

export function slotCoverage(
  def: DeskReviewDef,
  slots: { id: string; label: string; gate: string }[],
  docs: { slot: string | null }[],
  readings: Readings
): SlotCoverage[] {
  return slots.map((s) => {
    const documents = docs.filter((d) => d.slot === s.id).length;
    const key = def.monthsEvidence?.[s.id];
    const raw = key && key in readings ? Number(readings[key]) : NaN;
    const months = Number.isFinite(raw) ? raw : null;
    const state = documents === 0 ? "missing" : months !== null && months < PERIOD_MONTHS ? "partial" : "present";
    return { slot: s.id, label: s.label, gate: s.gate, documents, months, state };
  });
}