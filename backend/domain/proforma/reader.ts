/**
 * Read a pack's calculation inputs from the master pro forma workbook.
 *
 * The pack declares, as data, which labelled row holds each input, the unit the
 * fact is stored in, and the scale from the workbook's unit (for example Lakh kWh
 * to kWh). Values come from the workbook alone. Formula cells are recomputed here,
 * so a generated file with stale cached results still reads correctly. Nothing here
 * writes a fact; the route that commits the approved drafts does.
 */

import type { XlsxWorkbook } from "../intake/xlsx";
import { evaluateWorkbook } from "./formula";
import type { ProformaInput } from "./types";

export type ProformaStatus = "found" | "zero" | "missing" | "error" | "unmapped";

export interface ProformaDraft {
  /** Index of the pack's ProformaInput, so a commit can find its spec again. */
  index: number;
  fieldPath: string | null;
  /** The label as written in the workbook, or the pack's label when the row is missing. */
  label: string;
  sheet: string | null;
  cellRef: string | null;
  formula: string | null;
  /** Result stored in the file. Shown so a reviewer can see when it was stale. */
  cachedValue: number | string | boolean | null;
  /** Value in the workbook's own unit, after recomputing formulas. */
  workbookValue: number | null;
  /** Value in the fact's unit (workbookValue × scale). */
  value: number | null;
  unit: string;
  scale: number;
  status: ProformaStatus;
  note: string;
}

export interface ProformaReading {
  drafts: ProformaDraft[];
  /** Formula cells whose stored result differs from the recomputed one. */
  staleFormulaCells: number;
  formulaErrors: { sheet: string; ref: string; error: string }[];
}

export function readProforma(wb: XlsxWorkbook, inputs: readonly ProformaInput[]): ProformaReading {
  const ev = evaluateWorkbook(wb);
  const drafts: ProformaDraft[] = inputs.map((spec, index) => {
    const scale = spec.scale ?? 1;
    const base = {
      index,
      fieldPath: spec.fieldPath,
      label: spec.description,
      sheet: null,
      cellRef: null,
      formula: null,
      cachedValue: null,
      workbookValue: null,
      value: null,
      unit: spec.unit,
      scale,
    };
    const sheetRe = new RegExp(spec.sheet, "i");
    const labelRe = new RegExp(spec.label, "i");
    for (const s of wb.sheets) {
      if (!sheetRe.test(s.name)) continue;
      const labelCell = s.cells.find((c) => c.col === 1 && typeof c.value === "string" && labelRe.test(c.value));
      if (!labelCell) continue;
      const cell = s.cells
        .filter((c) => c.row === labelCell.row && c.col > 1 && (typeof c.value === "number" || c.formula))
        .sort((a, b) => a.col - b.col)[0];
      if (!cell) continue;
      const found = {
        ...base,
        label: String(labelCell.value),
        sheet: s.name,
        cellRef: cell.ref,
        formula: cell.formula ?? null,
        cachedValue: cell.value,
      };
      const v = ev.value(s.name, cell.ref);
      if (v === null) {
        const err = ev.formulaCells.find((f) => f.sheet === s.name && f.ref === cell.ref.toUpperCase())?.error;
        return { ...found, status: "error" as const, note: err ?? "The cell has no numeric value." };
      }
      const scaled = Math.round(v * scale * 1e9) / 1e9;
      if (spec.fieldPath === null) {
        return { ...found, workbookValue: v, value: scaled, status: "unmapped" as const, note: spec.note ?? "The pack has no stream for this input." };
      }
      return {
        ...found,
        workbookValue: v,
        value: scaled,
        status: v === 0 ? ("zero" as const) : ("found" as const),
        note: v === 0 ? "Declared as zero in the workbook. No fact is written, so the stream counts as zero." : (spec.note ?? ""),
      };
    }
    return { ...base, status: "missing" as const, note: "No row with this label in the workbook." };
  });

  const stale = ev.formulaCells.filter(
    (f) => f.value !== null && (typeof f.cached !== "number" || Math.abs(f.cached - f.value) > 1e-9 * Math.max(1, Math.abs(f.value)))
  ).length;

  return {
    drafts,
    staleFormulaCells: stale,
    formulaErrors: ev.formulaCells.filter((f) => f.error).map((f) => ({ sheet: f.sheet, ref: f.ref, error: f.error! })),
  };
}
