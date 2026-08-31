import { CCTS_CEMENT_V1 } from "./cement";
import { CCTS_IRON_AND_STEEL_V1 } from "./ironsteel";
import { CCTS_ALUMINIUM_V1 } from "./aluminium";
import { CCTS_REMAINING_PACKS } from "./ccts/remaining";
import { ADEETIE_PACKS } from "./adeetie";
import { PackError, type MethodologyPack, type PackScheme } from "./types";

export { PackError };

/** v0 scaffold ids kept as FK targets. loadPack serves the matching v1 record. */
const SUPERSEDED_PACK_IDS: Record<string, string> = {
  "CCTS-CHLOR-ALKALI-v0": "CCTS-CHLOR-ALKALI-v1",
  "CCTS-PULP-AND-PAPER-v0": "CCTS-PULP-AND-PAPER-v1",
  "CCTS-FERTILIZER-v0": "CCTS-FERTILIZER-v1",
  "CCTS-PETROCHEMICALS-v0": "CCTS-PETROCHEMICALS-v1",
  "CCTS-PETROLEUM-REFINING-v0": "CCTS-PETROLEUM-REFINING-v1",
  "CCTS-TEXTILES-v0": "CCTS-TEXTILES-v1",
  "ADEETIE-BRASS-v0": "ADEETIE-BRASS-v1",
  "ADEETIE-BRICKS-v0": "ADEETIE-BRICKS-v1",
  "ADEETIE-CERAMICS-v0": "ADEETIE-CERAMICS-v1",
  "ADEETIE-CHEMICALS-v0": "ADEETIE-CHEMICALS-v1",
  "ADEETIE-FISHERIES-v0": "ADEETIE-FISHERIES-v1",
  "ADEETIE-FOOD-PROCESSING-v0": "ADEETIE-FOOD-PROCESSING-v1",
  "ADEETIE-FORGING-v0": "ADEETIE-FORGING-v1",
  "ADEETIE-GLASS-AND-REFRACTORY-v0": "ADEETIE-GLASS-AND-REFRACTORY-v1",
  "ADEETIE-LEATHER-v0": "ADEETIE-LEATHER-v1",
  "ADEETIE-PAPER-v0": "ADEETIE-PAPER-v1",
  "ADEETIE-PHARMA-v0": "ADEETIE-PHARMA-v1",
  "ADEETIE-STEEL-RE-ROLLING-v0": "ADEETIE-STEEL-RE-ROLLING-v1",
  "ADEETIE-TEXTILES-v0": "ADEETIE-TEXTILES-v1",
};

const REGISTRY: MethodologyPack[] = [
  CCTS_CEMENT_V1,
  CCTS_IRON_AND_STEEL_V1,
  CCTS_ALUMINIUM_V1,
  ...CCTS_REMAINING_PACKS,
  ...ADEETIE_PACKS,
];

const BY_ID = new Map(REGISTRY.map((p) => [p.pack_id, p]));

/** Load a methodology pack by id. Process 3.0 and 5.0 must go through this. */
export function loadPack(packId: string): MethodologyPack {
  const resolved = SUPERSEDED_PACK_IDS[packId] ?? packId;
  const pack = BY_ID.get(resolved);
  if (!pack) {
    throw new PackError(`Unknown methodology pack "${packId}".`);
  }
  return structuredClone(pack);
}

export function listPacks(filter?: {
  scheme?: PackScheme;
  status?: MethodologyPack["status"];
}) {
  return REGISTRY.filter((p) => {
    if (filter?.scheme && p.scheme !== filter.scheme) return false;
    if (filter?.status && p.status !== filter.status) return false;
    return true;
  }).map((p) => structuredClone(p));
}

export function assertRunnable(pack: MethodologyPack) {
  if (pack.status !== "runnable") {
    throw new PackError(
      `Pack "${pack.pack_id}" is ${pack.status}. Start work is disabled until the pack is runnable.`
    );
  }
}

export function canStartWork(pack: MethodologyPack) {
  return pack.status === "runnable";
}

/**
 * Structural validation of a pack record.
 *
 * A runnable pack has to declare enough for the generic mappers to work, and the
 * mappers refuse rather than guess. Checking it here means the failure surfaces in
 * a test or the pack browser instead of halfway through a run.
 */
export function validatePack(pack: MethodologyPack): string[] {
  const problems: string[] = [];

  if (pack.status !== "runnable") return problems;

  if (pack.calculation_method === "GEI") {
    if (pack.stream_bindings.length === 0) {
      problems.push(`${pack.pack_id}: runnable GEI pack declares no stream_bindings.`);
    }
    if (!pack.production_binding) {
      problems.push(`${pack.pack_id}: runnable GEI pack declares no production_binding.`);
    }
  } else if (pack.calculation_method === "SEC") {
    if (!pack.energy_bindings || pack.energy_bindings.length === 0) {
      problems.push(`${pack.pack_id}: runnable SEC pack declares no energy_bindings.`);
    }
    if (!pack.production_binding) {
      problems.push(`${pack.pack_id}: runnable SEC pack declares no production_binding.`);
    }
    if (!pack.sec_config) {
      problems.push(`${pack.pack_id}: runnable SEC pack declares no sec_config.`);
    }
  } else {
    problems.push(
      `${pack.pack_id}: status is runnable but calculation_method is "${pack.calculation_method}".`
    );
  }

  const ids = new Set<string>();
  for (const b of [...pack.stream_bindings, ...(pack.energy_bindings ?? [])]) {
    if (ids.has(b.streamId)) {
      problems.push(`${pack.pack_id}: duplicate streamId "${b.streamId}".`);
    }
    ids.add(b.streamId);
  }

  const cited = new Set(pack.clause_citations.map((c) => c.ruleId));
  for (const ruleId of pack.reconciliation_rules) {
    if (!cited.has(ruleId)) {
      problems.push(`${pack.pack_id}: rule ${ruleId} has no clause citation.`);
    }
  }

  return problems;
}

export function validateRegistry(): string[] {
  return REGISTRY.flatMap(validatePack);
}

export { REGISTRY as PACK_REGISTRY };
