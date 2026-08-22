/**
 * Deterministic emissions calculation engine.
 *
 * Hard rules for this module:
 *  1. No AI, no network, no randomness, no clock reads inside the maths.
 *  2. Same inputs + same engine version + same factor set => byte-identical results, forever.
 *  3. Every output line records its own derivation so a verifier can defend the number.
 *
 * A language model may help decide *which* method applies. It never computes.
 */

import { createHash } from "node:crypto";
import {
  convert,
  qty,
  type Quantity,
  type Unit,
  UnitError,
} from "../units";
import {
  GCV_TO_NCV_DEFAULT,
  factorQuantity,
  getFactor,
  type FactorSet,
  type FuelPhase,
} from "../factors";

export const ENGINE_VERSION = "0.1.0";

/** Reference back to the evidence a value came from. Required on every input. */
export interface Provenance {
  /** IDs of extracted_fact rows this value derives from. */
  factIds: string[];
  /** Human-readable note, e.g. "Coal invoice SCCL/2025/1182, page 1". */
  label?: string;
}

export type CalorificBasis = "NCV" | "GCV";

export interface FuelCombustionInput {
  kind: "fuel_combustion";
  streamId: string;
  label: string;
  /** Key into FUEL_EMISSION_FACTORS, e.g. "ef_coal_subbituminous". */
  emissionFactorId: string;
  emissionFactorVintage: string;
  quantity: Quantity;
  calorificValue: Quantity;
  /**
   * Whether the supplied calorific value is net or gross. If GCV, the IPCC default
   * conversion is applied and recorded in the derivation.
   */
  calorificBasis: CalorificBasis;
  phase: FuelPhase;
  /** Oxidation factor, defaults to 1 where the methodology assumes complete oxidation. */
  oxidationFactor?: number;
  provenance: Provenance;
}

export interface ElectricityImportInput {
  kind: "electricity_import";
  streamId: string;
  label: string;
  quantity: Quantity;
  gridFactorId: string;
  gridFactorVintage: string;
  provenance: Provenance;
}

/** Process emissions supplied directly, e.g. calcination computed under a sector methodology. */
export interface ProcessDirectInput {
  kind: "process_direct";
  streamId: string;
  label: string;
  emissions: Quantity;
  methodologyRef: string;
  provenance: Provenance;
}

export type StreamInput =
  | FuelCombustionInput
  | ElectricityImportInput
  | ProcessDirectInput;

export type Scope = 1 | 2;

export interface StreamResult {
  streamId: string;
  label: string;
  scope: Scope;
  /** Canonical kgCO2e. */
  emissions: Quantity;
  derivation: string;
  factorsUsed: Array<{ id: string; vintage: string; value: number; unit: Unit; verified: boolean }>;
  provenance: Provenance;
  warnings: string[];
}

export interface ProductionInput {
  /** Equivalent product quantity forming the GEI denominator. */
  quantity: Quantity;
  /** e.g. "tonne_cement", "tonne_crude_steel". */
  productUnitLabel: string;
  provenance: Provenance;
}

export interface CalcInput {
  engagementId: string;
  complianceYear: string;
  sector: string;
  streams: StreamInput[];
  production: ProductionInput;
  /** Notified GEI target for the entity, in tCO2e per unit of equivalent product. */
  geiTarget?: number;
  /** Allow factors flagged `verified: false`. Only for development and demos. */
  allowUnverifiedFactors?: boolean;
}

export interface CalcResult {
  engineVersion: string;
  factorSetVersion: string;
  inputsHash: string;
  engagementId: string;
  complianceYear: string;
  streams: StreamResult[];
  scope1: Quantity;
  scope2: Quantity;
  totalEmissions: Quantity;
  production: Quantity;
  /** tCO2e per unit of equivalent product. */
  gei: number;
  geiTarget?: number;
  /** Positive means performing better than target. */
  geiHeadroom?: number;
  /**
   * Credit position in tCO2e. Positive = surplus (entitled to CCCs),
   * negative = deficit (must purchase).
   */
  creditPositionTCO2e?: number;
  warnings: string[];
}

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

/**
 * Stable hash of the inputs. Key order is normalised so that logically identical
 * inputs always produce the same hash regardless of object construction order.
 */
export function hashInputs(input: CalcInput): string {
  const stable = JSON.stringify(input, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
  return createHash("sha256").update(stable).digest("hex");
}

function assertProvenance(streamId: string, p: Provenance) {
  if (!p || !Array.isArray(p.factIds) || p.factIds.length === 0) {
    throw new CalcError(
      `Stream "${streamId}" has no provenance. Every input must trace to at least one extracted fact.`
    );
  }
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function computeFuel(
  input: FuelCombustionInput,
  factors: FactorSet,
  allowUnverified: boolean
): StreamResult {
  assertProvenance(input.streamId, input.provenance);
  const warnings: string[] = [];

  const massKg = convert(input.quantity, "kg");

  let cv = convert(input.calorificValue, "MJ/kg");
  let basisNote = "NCV as supplied";
  if (input.calorificBasis === "GCV") {
    const ratio = GCV_TO_NCV_DEFAULT[input.phase];
    cv = qty(cv.value * ratio, "MJ/kg");
    basisNote = `GCV converted to NCV using IPCC default ${ratio} for ${input.phase} fuel`;
    warnings.push(
      `Stream "${input.streamId}": lab-tested NCV not supplied; IPCC default GCV-to-NCV conversion (${ratio}) applied.`
    );
  }

  const ef = getFactor(factors, input.emissionFactorId, input.emissionFactorVintage);
  if (!ef.verified && !allowUnverified) {
    throw new CalcError(
      `Emission factor "${ef.id}" (${ef.vintage}) is not verified against its published source. ` +
        `Verify it or run with allowUnverifiedFactors for development only.`
    );
  }
  if (!ef.verified) {
    warnings.push(`Emission factor "${ef.id}" (${ef.vintage}) is UNVERIFIED — development value only.`);
  }
  const efCanonical = convert(factorQuantity(ef), "kgCO2e/MJ");

  const oxidation = input.oxidationFactor ?? 1;
  if (oxidation <= 0 || oxidation > 1) {
    throw new CalcError(
      `Stream "${input.streamId}": oxidation factor must be in (0, 1], received ${oxidation}`
    );
  }

  const energyMJ = massKg.value * cv.value;
  const emissionsKg = energyMJ * efCanonical.value * oxidation;

  const derivation =
    `${round(massKg.value, 3)} kg x ${round(cv.value, 4)} MJ/kg = ${round(energyMJ, 3)} MJ; ` +
    `${round(energyMJ, 3)} MJ x ${round(efCanonical.value, 8)} kgCO2e/MJ` +
    (oxidation !== 1 ? ` x ${oxidation} oxidation` : "") +
    ` = ${round(emissionsKg, 3)} kgCO2e (${basisNote})`;

  return {
    streamId: input.streamId,
    label: input.label,
    scope: 1,
    emissions: qty(emissionsKg, "kgCO2e"),
    derivation,
    factorsUsed: [
      { id: ef.id, vintage: ef.vintage, value: ef.value, unit: ef.unit, verified: ef.verified },
    ],
    provenance: input.provenance,
    warnings,
  };
}

function computeElectricity(
  input: ElectricityImportInput,
  factors: FactorSet,
  allowUnverified: boolean
): StreamResult {
  assertProvenance(input.streamId, input.provenance);
  const warnings: string[] = [];

  const energyMWh = convert(input.quantity, "MWh");
  const gf = getFactor(factors, input.gridFactorId, input.gridFactorVintage);
  if (!gf.verified && !allowUnverified) {
    throw new CalcError(
      `Grid factor "${gf.id}" (${gf.vintage}) is not verified against its published source.`
    );
  }
  if (!gf.verified) {
    warnings.push(`Grid factor "${gf.id}" (${gf.vintage}) is UNVERIFIED — development value only.`);
  }

  const gfTPerMWh = convert(factorQuantity(gf), "tCO2e/MWh");
  const emissionsT = energyMWh.value * gfTPerMWh.value;
  const emissionsKg = convert(qty(emissionsT, "tCO2e"), "kgCO2e");

  return {
    streamId: input.streamId,
    label: input.label,
    scope: 2,
    emissions: emissionsKg,
    derivation:
      `${round(energyMWh.value, 4)} MWh x ${round(gfTPerMWh.value, 6)} tCO2e/MWh ` +
      `= ${round(emissionsT, 4)} tCO2e (grid factor vintage ${gf.vintage})`,
    factorsUsed: [
      { id: gf.id, vintage: gf.vintage, value: gf.value, unit: gf.unit, verified: gf.verified },
    ],
    provenance: input.provenance,
    warnings,
  };
}

function computeProcess(input: ProcessDirectInput): StreamResult {
  assertProvenance(input.streamId, input.provenance);
  const emissionsKg = convert(input.emissions, "kgCO2e");
  return {
    streamId: input.streamId,
    label: input.label,
    scope: 1,
    emissions: emissionsKg,
    derivation: `Supplied directly as ${input.emissions.value} ${input.emissions.unit} under ${input.methodologyRef}`,
    factorsUsed: [],
    provenance: input.provenance,
    warnings: [],
  };
}

export function calculate(input: CalcInput, factors: FactorSet): CalcResult {
  if (input.streams.length === 0) {
    throw new CalcError("Calculation requires at least one source stream.");
  }
  assertProvenance("production", input.production.provenance);

  const allowUnverified = input.allowUnverifiedFactors ?? false;
  const seen = new Set<string>();
  const streams: StreamResult[] = [];

  for (const s of input.streams) {
    if (seen.has(s.streamId)) {
      throw new CalcError(`Duplicate streamId "${s.streamId}".`);
    }
    seen.add(s.streamId);

    switch (s.kind) {
      case "fuel_combustion":
        streams.push(computeFuel(s, factors, allowUnverified));
        break;
      case "electricity_import":
        streams.push(computeElectricity(s, factors, allowUnverified));
        break;
      case "process_direct":
        streams.push(computeProcess(s));
        break;
      default: {
        const exhaustive: never = s;
        throw new CalcError(`Unsupported stream kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  const sumScope = (scope: Scope) =>
    streams.filter((s) => s.scope === scope).reduce((acc, s) => acc + s.emissions.value, 0);

  const scope1Kg = sumScope(1);
  const scope2Kg = sumScope(2);
  const totalKg = scope1Kg + scope2Kg;

  const productionCanonical = convert(input.production.quantity, "t");
  if (productionCanonical.value <= 0) {
    throw new CalcError("Production quantity must be greater than zero to compute GEI.");
  }

  const totalT = convert(qty(totalKg, "kgCO2e"), "tCO2e").value;
  const gei = totalT / productionCanonical.value;

  const warnings = streams.flatMap((s) => s.warnings);

  const result: CalcResult = {
    engineVersion: ENGINE_VERSION,
    factorSetVersion: factors.version,
    inputsHash: hashInputs(input),
    engagementId: input.engagementId,
    complianceYear: input.complianceYear,
    streams,
    scope1: qty(round(scope1Kg, 3), "kgCO2e"),
    scope2: qty(round(scope2Kg, 3), "kgCO2e"),
    totalEmissions: qty(round(totalKg, 3), "kgCO2e"),
    production: productionCanonical,
    gei: round(gei, 6),
    warnings,
  };

  if (typeof input.geiTarget === "number") {
    result.geiTarget = input.geiTarget;
    result.geiHeadroom = round(input.geiTarget - gei, 6);
    result.creditPositionTCO2e = round(
      (input.geiTarget - gei) * productionCanonical.value,
      3
    );
  }

  return result;
}

export { UnitError };
