/**
 * Calculation run wrapper. Maps committed D4 facts → CalcInput and persists a
 * hash-chained run. Does not rewrite engine.ts — code still computes there.
 */

import { createHash } from "node:crypto";
import { qty, type Unit } from "../units";
import { buildFactorSet, type FactorSet } from "../factors";
import {
  calculate,
  hashInputs,
  ENGINE_VERSION,
  type CalcInput,
  type CalcResult,
  type StreamInput,
  CalcError,
} from "./engine";
import { matchFactPath } from "../extraction/fieldPaths";
import { loadPack, assertRunnable } from "../packs";
import type {
  MethodologyPack,
  PackProductionBinding,
  PackQuantityBinding,
  PackStreamBinding,
} from "../packs/types";

export interface ProvenancedFact {
  id: string;
  field_path: string;
  value_json: unknown;
  unit?: string | null;
  document_id: string;
  page: number;
  bbox: { x: number; y: number; width: number; height: number } | unknown;
  source_text: string;
}

export interface RunRequest {
  engagementId: string;
  organizationId: string;
  packId: string;
  packVersion: string;
  complianceYear: string;
  geiTarget?: number;
  draftMode: boolean;
  facts: ProvenancedFact[];
  previousRunHash?: string | null;
  factorSet?: FactorSet;
}

export interface PersistedRun {
  engineVersion: string;
  packId: string;
  packVersion: string;
  factorSetVersion: string;
  inputHash: string;
  previousRunHash: string | null;
  chainHash: string;
  draftMode: boolean;
  input: CalcInput;
  result: CalcResult;
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

export interface StreamReadiness {
  streamId: string;
  label: string;
  bound: boolean;
  reason?: string;
}

export interface RunReadiness {
  factCount: number;
  productionBound: boolean;
  productionPath: string | null;
  streams: StreamReadiness[];
  boundStreamCount: number;
  canRun: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * What a run will do with the current D4 facts — without executing the engine.
 * Used by the Runs page so "No runs" is not confused with "facts are missing".
 */
export function assessRunReadiness(
  pack: MethodologyPack,
  facts: ProvenancedFact[],
  _opts?: { draftMode?: boolean }
): RunReadiness {
  const productionPath = pack.production_binding?.path ?? null;
  const productionBound = productionPath ? Boolean(factByPath(facts, productionPath)) : false;
  const streams: StreamReadiness[] = [];

  if (pack.calculation_method === "GEI") {
    for (const binding of pack.stream_bindings) {
      const qtyFact = factByPath(facts, binding.quantity.path);
      if (!qtyFact) {
        streams.push({
          streamId: binding.streamId,
          label: binding.label,
          bound: false,
          reason: `No fact at "${binding.quantity.path}"`,
        });
        continue;
      }
      if (binding.kind === "fuel_combustion") {
        const cvFact = factByPath(facts, binding.calorificValue.path);
        if (!cvFact) {
          streams.push({
            streamId: binding.streamId,
            label: binding.label,
            bound: false,
            reason: `Quantity found, but no calorific value at "${binding.calorificValue.path}"`,
          });
          continue;
        }
      }
      streams.push({ streamId: binding.streamId, label: binding.label, bound: true });
    }
  } else if (pack.calculation_method === "SEC") {
    for (const binding of pack.energy_bindings ?? []) {
      const qtyFact = factByPath(facts, binding.quantity.path);
      if (!qtyFact) {
        streams.push({
          streamId: binding.streamId,
          label: binding.label,
          bound: false,
          reason: `No fact at "${binding.quantity.path}"`,
        });
        continue;
      }
      streams.push({ streamId: binding.streamId, label: binding.label, bound: true });
    }
  }

  const blockers: string[] = [];
  if (facts.length === 0) {
    blockers.push("No D4 facts yet. Upload evidence, extract, and accept fields on the workbench.");
  }
  if (productionPath && !productionBound) {
    blockers.push(
      `Production is required at "${productionPath}". Accept that field from an equivalent-product log.`
    );
  }

  const warnings: string[] = [];

  return {
    factCount: facts.length,
    productionBound,
    productionPath,
    streams,
    boundStreamCount: streams.filter((s) => s.bound).length,
    canRun: blockers.length === 0 && facts.length > 0 && Boolean(productionBound),
    blockers,
    warnings,
  };
}

function requireProvenance(fact: ProvenancedFact) {
  if (!fact.source_text || !fact.page || !fact.bbox) {
    throw new CalcError(
      `Fact "${fact.id}" is missing provenance (document/page/bbox/sourceText).`
    );
  }
}

/**
 * Resolve a bound quantity from the fact set.
 *
 * The unit as printed is honoured only if the binding lists it. Anything else
 * falls back to the binding's default, which prevents a stray unit string on an
 * invoice from changing the dimension of a stream.
 */
function resolveQuantity(
  facts: ProvenancedFact[],
  binding: PackQuantityBinding,
  what: string
): { quantity: ReturnType<typeof qty>; fact: ProvenancedFact } | null {
  const fact = factByPath(facts, binding.path);
  if (!fact) return null;
  const value = num(fact.value_json);
  if (value === null) {
    throw new CalcError(`${what} ("${binding.path}") is not numeric.`);
  }
  const printed = (fact.unit ?? binding.defaultUnit) as Unit;
  const unit = binding.units.includes(printed) ? printed : binding.defaultUnit;
  return { quantity: qty(value, unit), fact };
}

/**
 * Indian fuel invoices and lab reports quote gross calorific value in kcal/kg by
 * convention and net calorific value in MJ/kg. This is a document convention, not
 * a sector rule, and any pack can override it by declaring `calorificBasis` or
 * pointing `calorificBasisPath` at an extracted basis field.
 */
function inferCalorificBasis(unit: Unit): "NCV" | "GCV" {
  return unit === "kcal/kg" ? "GCV" : "NCV";
}

function buildStream(
  facts: ProvenancedFact[],
  binding: PackStreamBinding
): StreamInput | null {
  const resolved = resolveQuantity(
    facts,
    binding.quantity,
    `Stream "${binding.streamId}" quantity`
  );
  if (!resolved) {
    if (binding.required) {
      throw new CalcError(
        `Pack requires a fact at "${binding.quantity.path}" for stream "${binding.streamId}".`
      );
    }
    return null;
  }

  switch (binding.kind) {
    case "fuel_combustion": {
      const cv = resolveQuantity(
        facts,
        binding.calorificValue,
        `Stream "${binding.streamId}" calorific value`
      );
      if (!cv) {
        if (binding.required) {
          throw new CalcError(
            `Pack requires a calorific value at "${binding.calorificValue.path}" for stream "${binding.streamId}".`
          );
        }
        return null;
      }

      let basis = binding.calorificBasis;
      if (!basis && binding.calorificBasisPath) {
        const basisFact = factByPath(facts, binding.calorificBasisPath);
        const raw = basisFact?.value_json;
        if (raw === "NCV" || raw === "GCV") basis = raw;
      }
      basis ??= inferCalorificBasis(cv.quantity.unit);

      return {
        kind: "fuel_combustion",
        streamId: binding.streamId,
        label: binding.label,
        emissionFactorId: binding.factorKey,
        emissionFactorVintage: binding.factorVintage,
        quantity: resolved.quantity,
        calorificValue: cv.quantity,
        calorificBasis: basis,
        phase: binding.phase,
        ...(binding.oxidationFactor === undefined
          ? {}
          : { oxidationFactor: binding.oxidationFactor }),
        provenance: {
          factIds: [resolved.fact.id, cv.fact.id],
          label: resolved.fact.source_text,
        },
      };
    }
    case "electricity_import":
      return {
        kind: "electricity_import",
        streamId: binding.streamId,
        label: binding.label,
        quantity: resolved.quantity,
        gridFactorId: binding.factorKey,
        gridFactorVintage: binding.factorVintage,
        provenance: {
          factIds: [resolved.fact.id],
          label: resolved.fact.source_text,
        },
      };
    case "process_direct":
      return {
        kind: "process_direct",
        streamId: binding.streamId,
        label: binding.label,
        emissions: resolved.quantity,
        methodologyRef: binding.methodologyRef,
        provenance: {
          factIds: [resolved.fact.id],
          label: resolved.fact.source_text,
        },
      };
    default: {
      const exhaustive: never = binding;
      throw new CalcError(`Unsupported stream binding: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function buildProduction(
  facts: ProvenancedFact[],
  binding: PackProductionBinding
): CalcInput["production"] {
  const resolved = resolveQuantity(facts, binding, "Production");
  if (!resolved) {
    throw new CalcError(
      `Production fact at "${binding.path}" is required to compute an intensity.`
    );
  }
  return {
    quantity: resolved.quantity,
    productUnitLabel: binding.productUnitLabel,
    provenance: {
      factIds: [resolved.fact.id],
      label: resolved.fact.source_text,
    },
  };
}

/**
 * Map accepted facts onto CalcInput by walking the pack's declared bindings.
 *
 * There is deliberately no sector or scheme branch in this function. A new
 * sector is a new pack record, not a new code path here.
 */
export function mapFactsToCalcInput(
  pack: MethodologyPack,
  req: Pick<
    RunRequest,
    "engagementId" | "complianceYear" | "geiTarget" | "draftMode" | "facts"
  >
): CalcInput {
  if (pack.calculation_method !== "GEI") {
    throw new CalcError(
      `Pack ${pack.pack_id} declares calculation method "${pack.calculation_method}", ` +
        `which is not handled by the GEI mapper. SEC packs run through domain/calc/sec.ts.`
    );
  }
  if (pack.stream_bindings.length === 0) {
    throw new CalcError(
      `Pack ${pack.pack_id} declares no stream bindings, so no run can be mapped from it.`
    );
  }
  if (!pack.production_binding) {
    throw new CalcError(
      `Pack ${pack.pack_id} declares no production binding, so the GEI denominator is undefined.`
    );
  }

  const { facts } = req;
  for (const f of facts) requireProvenance(f);

  const streams: StreamInput[] = [];
  for (const binding of pack.stream_bindings) {
    const stream = buildStream(facts, binding);
    if (stream) streams.push(stream);
  }

  return {
    engagementId: req.engagementId,
    complianceYear: req.complianceYear,
    // The engine treats `sector` as an opaque label and branches on nothing.
    // Sector identity is carried by packId on the persisted run.
    sector: "from-pack",
    allowUnverifiedFactors: true,
    geiTarget: req.geiTarget,
    streams,
    production: buildProduction(facts, pack.production_binding),
  };
}

export function chainHash(inputHash: string, previousRunHash: string | null) {
  return createHash("sha256")
    .update(previousRunHash ?? "genesis")
    .update(inputHash)
    .digest("hex");
}

export function executeRun(req: RunRequest): PersistedRun {
  const pack = loadPack(req.packId);
  assertRunnable(pack);
  if (pack.version !== req.packVersion) {
    throw new CalcError(
      `Pack version mismatch: engagement bound to ${req.packVersion}, loaded ${pack.version}.`
    );
  }

  // Version bumped from the Cement-only fallback: the default set now also carries
  // process, coke, and energy-content records. Recorded on every run.
  const factors = req.factorSet ?? buildFactorSet("verifystack-factors-0.2.0");
  const input = mapFactsToCalcInput(pack, req);
  const result = calculate(input, factors);
  const inputHash = result.inputsHash;
  const previousRunHash = req.previousRunHash ?? null;

  return {
    engineVersion: ENGINE_VERSION,
    packId: pack.pack_id,
    packVersion: pack.version,
    factorSetVersion: factors.version,
    inputHash,
    previousRunHash,
    chainHash: chainHash(inputHash, previousRunHash),
    draftMode: req.draftMode,
    input,
    result,
  };
}

export { hashInputs, ENGINE_VERSION };
