/**
 * Which compliance years a process emission stream is outside the intensity basis.
 *
 * The Detailed Procedure for Compliance Mechanism under the Indian Carbon Market,
 * Section 3.4(1), lists the sources an obligated entity reports: (i) direct energy
 * emissions, (ii) direct process (non-energy) emissions, (iii) indirect energy
 * emissions. Its Note on page 7 then says the intensity targets within 2024-27 are
 * calculated only on sources (i) and (iii), and later targets on (i), (ii) and (iii).
 *
 * What this module does with that, and what it refuses to do:
 *   - Inside the window a process stream is NOT REQUIRED. A plant that has no process
 *     figure is not blocked for it, and a desk review does not fail it as a gap.
 *   - Inside the window a process figure that IS supplied is still COUNTED, exactly as
 *     before, and the run warns that the intensity is then not on the same basis as a
 *     target set without it. No number is changed or dropped on an interpretation of a
 *     Note about targets; whether the achieved intensity should also leave process
 *     emissions out is open in docs/domain/regulatory-register.md until a named person
 *     confirms it against the BEE original.
 *
 * Leaf module: it imports types only, so the pack, the calc engine and the desk review
 * can all use it without importing each other.
 */

import type { PackBasisWindow } from "./types";

/** "FY2026-27", "2026-27", "FY 2026-2027" -> 2026. Anything else is unknown (null). */
export function fyStartOf(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /(?:^|[^\d])(\d{4})\s*[-\u2013/]\s*(\d{4}|\d{2})(?!\d)/.exec(label);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2]!.length === 2 ? Number(m[2]) : Number(m[2]) % 100;
  return (start + 1) % 100 === end ? start : null;
}

export function fyLabelOf(start: number): string {
  return `FY${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** True when the year is inside the window. An unknown year is never inside it. */
export function inBasisWindow(window: PackBasisWindow, fyStart: number | null): boolean {
  return fyStart !== null && fyStart >= window.fromFyStart && fyStart <= window.toFyStart;
}

/**
 * The window that applies to a stream in a compliance year, or null. An unknown or
 * unparseable year returns null: when the period cannot be placed, the stream keeps the
 * stricter treatment (required) instead of being waived on a guess.
 */
export function basisWindowFor(
  binding: { basisWindow?: PackBasisWindow },
  complianceYear: string | null | undefined
): PackBasisWindow | null {
  const window = binding.basisWindow;
  if (!window) return null;
  return inBasisWindow(window, fyStartOf(complianceYear)) ? window : null;
}

/**
 * Process (non-energy) emissions are outside the intensity basis for the first
 * trajectory period, FY2024-25 to FY2026-27.
 */
export const FIRST_TRAJECTORY_PROCESS_BASIS: PackBasisWindow = {
  fromFyStart: 2024,
  toFyStart: 2026,
  citation:
    "Detailed Procedure for Compliance Mechanism under the Indian Carbon Market, Section 3.4(1) Note, p. 7: " +
    "targets within 2024-27 are calculated only on direct energy (i) and indirect energy (iii) sources; " +
    "direct process emissions (ii) enter later targets.",
};
