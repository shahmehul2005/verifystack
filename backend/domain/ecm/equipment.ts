/**
 * Derive facility equipment tags from pack bindings that have committed facts.
 *
 * No LLM. A bound energy or GEI stream's `streamId` is the equipment_tag the
 * library is filtered on. We do not invent furnaces, boilers, or other kit that
 * the pack did not declare.
 */

import { matchFactPath } from "../extraction/fieldPaths";
import type { MethodologyPack } from "../packs/types";

export interface FactPath {
  field_path: string;
}

/**
 * Tags for streams whose quantity fact is present. Unbound (absent) streams are
 * not tags — a plant that does not use coke must not match coke-tagged rows.
 */
export function deriveEquipmentTags(
  pack: MethodologyPack,
  facts: readonly FactPath[]
): string[] {
  const tags = new Set<string>();
  const bindings =
    pack.calculation_method === "SEC"
      ? (pack.energy_bindings ?? [])
      : pack.stream_bindings;

  for (const binding of bindings) {
    const bound = facts.some((f) => matchFactPath(f.field_path, binding.quantity.path));
    if (bound) tags.add(binding.streamId);
  }

  return [...tags].sort();
}
