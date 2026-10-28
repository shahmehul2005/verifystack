/**
 * Which accepted facts a calculation run may use.
 *
 * A pack with `workbook_required` true runs only on facts that came from an
 * accepted spreadsheet cell or time-series window, or from a site observation,
 * or that an auditor has explicitly overridden. A PDF reading stays on the
 * ledger, visible and cited, and is left out of the run.
 *
 * A pack without the flag gets every fact, exactly as before. The engine and
 * the GEI formulas are not touched here. This only chooses the inputs.
 */

import type { MethodologyPack } from "../packs/types";

export interface ScopedFact {
  id: string;
  field_path: string;
  provenance_type?: string | null;
}

export interface ExcludedFact {
  id: string;
  fieldPath: string;
  provenanceType: string;
  reason: string;
}

export interface RunFactSelection<F extends ScopedFact> {
  facts: F[];
  excluded: ExcludedFact[];
  /** True when the pack's workbook rule was applied. */
  workbookRule: boolean;
}

const WORKBOOK_TYPES = new Set(["spreadsheet_cell", "spreadsheet_range", "time_series_range", "site_observation"]);

export function selectRunFacts<F extends ScopedFact>(
  pack: Pick<MethodologyPack, "workbook_required">,
  facts: readonly F[],
  overrides: ReadonlySet<string> = new Set()
): RunFactSelection<F> {
  if (!pack.workbook_required) {
    return { facts: [...facts], excluded: [], workbookRule: false };
  }
  const kept: F[] = [];
  const excluded: ExcludedFact[] = [];
  for (const f of facts) {
    const type = f.provenance_type ?? "document_page";
    if (WORKBOOK_TYPES.has(type)) {
      kept.push(f);
      continue;
    }
    if (overrides.has(f.field_path)) {
      kept.push(f);
      continue;
    }
    excluded.push({
      id: f.id,
      fieldPath: f.field_path,
      provenanceType: type,
      reason:
        "A PDF reading. This pack takes its inputs from accepted workbook cells. Map the cell, or record an override for this input with a note.",
    });
  }
  return { facts: kept, excluded, workbookRule: true };
}
