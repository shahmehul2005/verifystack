/**
 * Calculation method dispatcher (DFD 5.0).
 *
 * One place that answers "which engine runs this pack?". Callers switch on the
 * returned `engine`, never on `pack.calculation_method` directly, so adding a
 * method is one edit here and a refusal is the same refusal everywhere.
 *
 * A method that is declared but not implemented is refused with the reason.
 * Silently falling through to GEI would put a number on a report that no
 * methodology produced.
 */

import { loadPack } from "../packs";
import type { CalculationMethod, MethodologyPack } from "../packs/types";

export type ImplementedEngine = "GEI" | "SEC";

export type MethodDispatch =
  | { implemented: true; engine: ImplementedEngine; method: CalculationMethod }
  | { implemented: false; method: CalculationMethod; reason: string };

export class MethodNotImplementedError extends Error {
  constructor(
    readonly method: CalculationMethod,
    reason: string
  ) {
    super(reason);
    this.name = "MethodNotImplementedError";
  }
}

export function resolveMethod(pack: Pick<MethodologyPack, "pack_id" | "calculation_method">): MethodDispatch {
  switch (pack.calculation_method) {
    case "GEI":
    case "SEC":
      return { implemented: true, engine: pack.calculation_method, method: pack.calculation_method };
    case "EMBEDDED_EMISSIONS":
      return {
        implemented: false,
        method: pack.calculation_method,
        reason: `${pack.pack_id} describes embedded-emissions reporting as structure only. The method, factors and report format are open items, so no calculation is run.`,
      };
    case "H2_INTENSITY":
      return {
        implemented: false,
        method: pack.calculation_method,
        reason: `${pack.pack_id} describes hydrogen carbon-intensity reporting as structure only. The notified methodology and threshold are open items, so no calculation is run.`,
      };
    case "TBD":
      return {
        implemented: false,
        method: pack.calculation_method,
        reason: `${pack.pack_id} has no calculation method yet.`,
      };
  }
}

/** Resolve by id, throwing when the pack's method has no engine. */
export function requireEngine(packId: string): ImplementedEngine {
  const pack = loadPack(packId);
  const d = resolveMethod(pack);
  if (!d.implemented) throw new MethodNotImplementedError(d.method, d.reason);
  return d.engine;
}
