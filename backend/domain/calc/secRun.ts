/**
 * SEC calculation run wrapper.
 *
 * The SEC counterpart of run.ts: it walks the pack's declared `energy_bindings`
 * and never asks which sector or cluster it is looking at. Adding an ADEETIE
 * sector is a pack record, not a branch in this file.
 */

import { createHash } from "node:crypto";
import { qty, type Unit } from "../units";
import { buildFactorSet, type FactorSet } from "../factors";
import {
  calculateSec,
  hashSecInputs,
  SEC_ENGINE_VERSION,
  SecError,
  type EnergyStreamInput,
  type SecInput,
  type SecPhase,
  type SecResult,
} from "./sec";
import { matchFactPath } from "../extraction/fieldPaths";
import { loadPack, assertRunnable } from "../packs";
import type {
  MethodologyPack,
  PackEnergyBinding,
  PackQuantityBinding,
} from "../packs/types";
import type { ProvenancedFact } from "./run";

export interface SecRunRequest {
  engagementId: string;
  organizationId: string;
  packId: string;
  packVersion: string;
  /** e.g. "FY2024-25". Identifies the period the energy data covers. */
  periodLabel: string;
  phase: SecPhase;
  draftMode: boolean;
  facts: ProvenancedFact[];
  previousRunHash?: string | null;
  factorSet?: FactorSet;
}

export interface PersistedSecRun {
  secEngineVersion: string;
  packId: string;
  packVersion: string;
  factorSetVersion: string;
  inputHash: string;
  previousRunHash: string | null;
  chainHash: string;
  draftMode: boolean;
  phase: SecPhase;
  input: SecInput;
  result: SecResult;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v !== null && "value" in v) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "number") return inner;
  }
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function factByPath(facts: ProvenancedFact[], path: string) {
  return facts.find((f) => matchFactPath(f.field_path, path));
}

function requireProvenance(fact: ProvenancedFact) {
  if (!fact.source_text || !fact.page || !fact.bbox) {
    throw new SecError(
      `Fact "${fact.id}" is missing provenance (document/page/bbox/sourceText).`
    );
  }
}

function resolveQuantity(
  facts: ProvenancedFact[],
  binding: PackQuantityBinding,
  what: string
) {
  const fact = factByPath(facts, binding.path);
  if (!fact) return null;
  const value = num(fact.value_json);
  if (value === null) {
    throw new SecError(`${what} ("${binding.path}") is not numeric.`);
  }
  const printed = (fact.unit ?? binding.defaultUnit) as Unit;
  const unit = binding.units.includes(printed) ? printed : binding.defaultUnit;
  return { quantity: qty(value, unit), fact };
}

function buildEnergyStream(
  facts: ProvenancedFact[],
  binding: PackEnergyBinding
): EnergyStreamInput | null {
  const resolved = resolveQuantity(
    facts,
    binding.quantity,
    `Stream "${binding.streamId}" quantity`
  );
  if (!resolved) {
    if (binding.required) {
      throw new SecError(
        `Pack requires a fact at "${binding.quantity.path}" for energy stream "${binding.streamId}".`
      );
    }
    return null;
  }

  const provenanceIds = [resolved.fact.id];

  switch (binding.kind) {
    case "electricity":
      return {
        kind: "electricity",
        streamId: binding.streamId,
        label: binding.label,
        quantity: resolved.quantity,
        ...(binding.onSiteGeneration === undefined
          ? {}
          : { onSiteGeneration: binding.onSiteGeneration }),
        provenance: { factIds: provenanceIds, label: resolved.fact.source_text },
      };

    case "fuel_mass":
    case "fuel_volume": {
      const measured = binding.calorificValue
        ? resolveQuantity(
            facts,
            binding.calorificValue,
            `Stream "${binding.streamId}" calorific value`
          )
        : null;
      if (measured) provenanceIds.push(measured.fact.id);

      if (!measured && !binding.factorKey) {
        throw new SecError(
          `Stream "${binding.streamId}" has no measured calorific value and the pack names no ` +
            `energy content factor, so its energy cannot be derived.`
        );
      }

      return {
        kind: binding.kind,
        streamId: binding.streamId,
        label: binding.label,
        quantity: resolved.quantity,
        ...(measured ? { energyContent: measured.quantity } : {}),
        ...(measured
          ? {}
          : {
              energyFactorId: binding.factorKey,
              energyFactorVintage: binding.factorVintage,
            }),
        energyContentBasis: binding.energyContentBasis ?? "GCV",
        phase: binding.phase ?? "solid",
        provenance: { factIds: provenanceIds, label: resolved.fact.source_text },
      };
    }

    case "thermal_direct":
      return {
        kind: "thermal_direct",
        streamId: binding.streamId,
        label: binding.label,
        quantity: resolved.quantity,
        methodologyRef: binding.methodologyRef ?? "Metered thermal energy",
        provenance: { factIds: provenanceIds, label: resolved.fact.source_text },
      };

    default: {
      const exhaustive: never = binding.kind;
      throw new SecError(`Unsupported energy binding kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Map accepted facts onto SecInput by walking the pack's declared energy bindings.
 * No sector or cluster branch appears in this function.
 */
export function mapFactsToSecInput(
  pack: MethodologyPack,
  req: Pick<SecRunRequest, "engagementId" | "periodLabel" | "phase" | "draftMode" | "facts">
): SecInput {
  if (pack.calculation_method !== "SEC") {
    throw new SecError(
      `Pack ${pack.pack_id} declares calculation method "${pack.calculation_method}", ` +
        `which is not handled by the SEC mapper.`
    );
  }
  const bindings = pack.energy_bindings ?? [];
  if (bindings.length === 0) {
    throw new SecError(
      `Pack ${pack.pack_id} declares no energy bindings, so no SEC run can be mapped from it.`
    );
  }
  if (!pack.production_binding) {
    throw new SecError(
      `Pack ${pack.pack_id} declares no production binding, so the SEC denominator is undefined.`
    );
  }
  if (!pack.sec_config) {
    throw new SecError(
      `Pack ${pack.pack_id} declares no SEC reporting configuration.`
    );
  }

  const { facts } = req;
  for (const f of facts) requireProvenance(f);

  const streams: EnergyStreamInput[] = [];
  for (const binding of bindings) {
    const stream = buildEnergyStream(facts, binding);
    if (stream) streams.push(stream);
  }

  const production = resolveQuantity(facts, pack.production_binding, "Production");
  if (!production) {
    throw new SecError(
      `Production fact at "${pack.production_binding.path}" is required to compute SEC.`
    );
  }

  const input: SecInput = {
    engagementId: req.engagementId,
    periodLabel: req.periodLabel,
    phase: req.phase,
    reportingEnergyUnit: pack.sec_config.reportingEnergyUnit,
    secUnitLabel: pack.sec_config.secUnitLabel,
    streams,
    production: {
      quantity: production.quantity,
      productUnitLabel: pack.production_binding.productUnitLabel,
      provenance: {
        factIds: [production.fact.id],
        label: production.fact.source_text,
      },
    },
    allowUnverifiedFactors: req.draftMode,
  };

  const demand = pack.demand_binding;
  if (demand) {
    const contracted = demand.contractedDemand
      ? resolveQuantity(facts, demand.contractedDemand, "Contracted demand")
      : null;
    const maximum = demand.maximumDemand
      ? resolveQuantity(facts, demand.maximumDemand, "Maximum demand")
      : null;
    if (contracted || maximum) {
      input.demand = {
        ...(contracted ? { contractedDemand: contracted.quantity } : {}),
        ...(maximum ? { maximumDemand: maximum.quantity } : {}),
        provenance: {
          factIds: [contracted?.fact.id, maximum?.fact.id].filter(
            (id): id is string => typeof id === "string"
          ),
          label: (contracted ?? maximum)?.fact.source_text,
        },
      };
    }
  }

  return input;
}

export function secChainHash(inputHash: string, previousRunHash: string | null) {
  return createHash("sha256")
    .update(previousRunHash ?? "genesis")
    .update("sec")
    .update(inputHash)
    .digest("hex");
}

export function executeSecRun(req: SecRunRequest): PersistedSecRun {
  const pack = loadPack(req.packId);
  assertRunnable(pack);
  if (pack.version !== req.packVersion) {
    throw new SecError(
      `Pack version mismatch: engagement bound to ${req.packVersion}, loaded ${pack.version}.`
    );
  }

  const factors = req.factorSet ?? buildFactorSet("verifystack-factors-0.2.0");
  const input = mapFactsToSecInput(pack, req);
  const result = calculateSec(input, factors);
  const previousRunHash = req.previousRunHash ?? null;

  return {
    secEngineVersion: SEC_ENGINE_VERSION,
    packId: pack.pack_id,
    packVersion: pack.version,
    factorSetVersion: factors.version,
    inputHash: result.inputsHash,
    previousRunHash,
    chainHash: secChainHash(result.inputsHash, previousRunHash),
    draftMode: req.draftMode,
    phase: req.phase,
    input,
    result,
  };
}

export { hashSecInputs, SEC_ENGINE_VERSION };
