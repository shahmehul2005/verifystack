/**
 * Deterministic Specific Energy Consumption engine.
 *
 * SEC is the metric ADEETIE is judged on: total energy input into a boundary,
 * normalised to one energy unit, divided by the useful output of that boundary.
 * The subvention gate is a comparison of two SEC figures, so both must be
 * reproducible years apart.
 *
 * Same hard rules as engine.ts, and for the same reason:
 *  1. No AI, no network, no randomness, no clock reads inside the maths.
 *  2. Same inputs + same engine version + same factor set => byte-identical results.
 *  3. Every line records its own derivation.
 *
 * This file deliberately does not import engine.ts. GEI and SEC are different
 * metrics with different denominators and must be able to version independently.
 */

import { createHash } from "node:crypto";
import {
  convert,
  dimensionOf,
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
import type { Provenance } from "./engine";

export const SEC_ENGINE_VERSION = "0.1.0";

/** Energy unit an SEC total may be reported in. */
export type ReportingEnergyUnit = Extract<Unit, "GJ" | "toe" | "MJ" | "kWh">;

/**
 * Electricity drawn or generated. Already an energy quantity, so no factor is
 * needed to turn it into energy — only a unit conversion.
 */
export interface ElectricityEnergyInput {
  kind: "electricity";
  streamId: string;
  label: string;
  /** kWh / MWh as billed. */
  quantity: Quantity;
  /**
   * Set for on-site renewable or captive generation so it can be reported
   * separately without being excluded from the energy balance.
   */
  onSiteGeneration?: boolean;
  provenance: Provenance;
}

/**
 * A fuel whose energy content must be looked up or read from a certificate.
 * `fuel_mass` consumes a mass quantity against a specific_energy value;
 * `fuel_volume` consumes a volume quantity against an energy_density value. The
 * split is what stops a kL of diesel being multiplied by a per-kg figure.
 */
export interface FuelEnergyInput {
  kind: "fuel_mass" | "fuel_volume";
  streamId: string;
  label: string;
  quantity: Quantity;
  /**
   * Lab-tested or invoice-printed calorific value. Takes precedence over the
   * registry default, and is strongly preferred — the defaults are wide bands.
   */
  energyContent?: Quantity;
  /** Registry lookup used when `energyContent` is absent. */
  energyFactorId?: string;
  energyFactorVintage?: string;
  energyContentBasis: "NCV" | "GCV";
  phase: FuelPhase;
  provenance: Provenance;
}

/** Purchased steam, hot water, or any energy already metered in energy units. */
export interface ThermalEnergyInput {
  kind: "thermal_direct";
  streamId: string;
  label: string;
  quantity: Quantity;
  methodologyRef: string;
  provenance: Provenance;
}

export type EnergyStreamInput =
  | ElectricityEnergyInput
  | FuelEnergyInput
  | ThermalEnergyInput;

/**
 * Contracted and maximum demand.
 *
 * Held apart from the energy streams on purpose. kVA is apparent power, not
 * energy; it drives the demand charge on the bill and it is where a large share
 * of ADEETIE-eligible savings actually sit, but it must never be added into a
 * consumption total. `units.ts` refuses the conversion, and this shape keeps the
 * two from ever meeting.
 */
export interface DemandInput {
  /** Sanctioned or contracted demand, in kVA. */
  contractedDemand?: Quantity;
  /** Recorded maximum demand in the period, in kVA. */
  maximumDemand?: Quantity;
  provenance: Provenance;
}

export interface SecProductionInput {
  quantity: Quantity;
  /** e.g. "tonne_castings_dispatched". */
  productUnitLabel: string;
  provenance: Provenance;
}

export type SecPhase = "baseline" | "post_implementation";

export interface SecInput {
  engagementId: string;
  /** e.g. "FY2024-25". Free text; it is hashed, so it must be stable. */
  periodLabel: string;
  phase: SecPhase;
  reportingEnergyUnit: ReportingEnergyUnit;
  /** Displayed intensity unit, e.g. "GJ/t". Recorded so a report cannot mislabel it. */
  secUnitLabel: string;
  streams: EnergyStreamInput[];
  production: SecProductionInput;
  demand?: DemandInput;
  /** Allow factors flagged `verified: false`. Only for development and demos. */
  allowUnverifiedFactors?: boolean;
}

export interface SecStreamResult {
  streamId: string;
  label: string;
  kind: EnergyStreamInput["kind"];
  /** Canonical MJ. */
  energyMJ: Quantity;
  /** Same energy in the reporting unit. */
  energyReported: Quantity;
  /** Share of the total energy input, in percent. */
  sharePct: number;
  derivation: string;
  factorsUsed: Array<{
    id: string;
    vintage: string;
    value: number;
    unit: Unit;
    verified: boolean;
  }>;
  provenance: Provenance;
  warnings: string[];
}

export interface SecDemandResult {
  contractedDemandKVA?: number;
  maximumDemandKVA?: number;
  /** Maximum demand as a percentage of contracted demand, where both are present. */
  demandUtilisationPct?: number;
  provenance: Provenance;
}

export interface SecResult {
  secEngineVersion: string;
  factorSetVersion: string;
  inputsHash: string;
  engagementId: string;
  periodLabel: string;
  phase: SecPhase;
  streams: SecStreamResult[];
  totalEnergyMJ: Quantity;
  totalEnergy: Quantity;
  production: Quantity;
  /** Reporting energy unit per unit of product. */
  sec: number;
  secUnitLabel: string;
  productUnitLabel: string;
  demand?: SecDemandResult;
  warnings: string[];
}

export class SecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecError";
  }
}

/**
 * Stable hash of the inputs, using the same key-normalisation convention as
 * engine.ts so the two hashes are comparable artefacts.
 */
export function hashSecInputs(input: SecInput): string {
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

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function assertProvenance(streamId: string, p: Provenance) {
  if (!p || !Array.isArray(p.factIds) || p.factIds.length === 0) {
    throw new SecError(
      `Stream "${streamId}" has no provenance. Every input must trace to at least one extracted fact.`
    );
  }
}

function computeElectricity(input: ElectricityEnergyInput): SecStreamResult {
  assertProvenance(input.streamId, input.provenance);
  if (dimensionOf(input.quantity.unit) !== "energy") {
    throw new SecError(
      `Stream "${input.streamId}": electricity must be an energy quantity, received ${input.quantity.unit}. ` +
        `A kVA or kW figure is a demand, not a consumption.`
    );
  }
  const energyMJ = convert(input.quantity, "MJ");
  return {
    streamId: input.streamId,
    label: input.label,
    kind: "electricity",
    energyMJ,
    energyReported: energyMJ,
    sharePct: 0,
    derivation:
      `${input.quantity.value} ${input.quantity.unit} = ${round(energyMJ.value, 3)} MJ ` +
      `(exact unit conversion, no factor)` +
      (input.onSiteGeneration ? "; recorded as on-site generation" : ""),
    factorsUsed: [],
    provenance: input.provenance,
    warnings: [],
  };
}

function computeFuel(
  input: FuelEnergyInput,
  factors: FactorSet,
  allowUnverified: boolean
): SecStreamResult {
  assertProvenance(input.streamId, input.provenance);
  const warnings: string[] = [];

  const expectedActivity = input.kind === "fuel_mass" ? "mass" : "volume";
  if (dimensionOf(input.quantity.unit) !== expectedActivity) {
    throw new SecError(
      `Stream "${input.streamId}" is declared ${input.kind} but its quantity is ` +
        `${input.quantity.unit} (${dimensionOf(input.quantity.unit)}). Expected a ${expectedActivity}.`
    );
  }

  const factorsUsed: SecStreamResult["factorsUsed"] = [];
  let content: Quantity;
  let contentNote: string;

  if (input.energyContent) {
    content = input.energyContent;
    contentNote = `calorific value as supplied (${content.value} ${content.unit})`;
  } else {
    if (!input.energyFactorId || !input.energyFactorVintage) {
      throw new SecError(
        `Stream "${input.streamId}" supplies no calorific value and names no energy content factor.`
      );
    }
    const rec = getFactor(factors, input.energyFactorId, input.energyFactorVintage);
    if (!rec.verified && !allowUnverified) {
      throw new SecError(
        `Energy content factor "${rec.id}" (${rec.vintage}) is not verified against its published source. ` +
          `Verify it or run with allowUnverifiedFactors for development only.`
      );
    }
    if (!rec.verified) {
      warnings.push(
        `Energy content factor "${rec.id}" (${rec.vintage}) is UNVERIFIED — development value only.`
      );
    }
    warnings.push(
      `Stream "${input.streamId}": no measured calorific value supplied; registry default ` +
        `"${rec.id}" applied. A tested value materially reduces uncertainty in the SEC baseline.`
    );
    content = factorQuantity(rec);
    contentNote = `registry default ${rec.id} (${rec.vintage})`;
    factorsUsed.push({
      id: rec.id,
      vintage: rec.vintage,
      value: rec.value,
      unit: rec.unit,
      verified: rec.verified,
    });
  }

  // The dimension pairing is the safety net: a mass activity can only meet a
  // per-mass calorific value, and a volume activity a per-volume one.
  const expectedContentDim =
    input.kind === "fuel_mass" ? "specific_energy" : "energy_density";
  if (dimensionOf(content.unit) !== expectedContentDim) {
    throw new SecError(
      `Stream "${input.streamId}": a ${expectedActivity} activity needs a ${expectedContentDim} ` +
        `calorific value, but ${content.unit} is ${dimensionOf(content.unit)}.`
    );
  }

  let contentCanonical =
    input.kind === "fuel_mass"
      ? convert(content, "MJ/kg")
      : convert(content, "MJ/m3");

  let basisNote = "NCV as supplied";
  if (input.energyContentBasis === "GCV") {
    const ratio = GCV_TO_NCV_DEFAULT[input.phase];
    contentCanonical = qty(
      contentCanonical.value * ratio,
      contentCanonical.unit
    );
    basisNote = `GCV converted to NCV using IPCC default ${ratio} for ${input.phase} fuel`;
    warnings.push(
      `Stream "${input.streamId}": gross calorific value supplied; IPCC default GCV-to-NCV conversion (${ratio}) applied.`
    );
  }

  const activityCanonical =
    input.kind === "fuel_mass"
      ? convert(input.quantity, "kg")
      : convert(input.quantity, "m3");

  const energy = activityCanonical.value * contentCanonical.value;
  if (energy < 0) {
    throw new SecError(
      `Stream "${input.streamId}" resolves to negative energy. Check the sign of the consumption figure.`
    );
  }

  const energyMJ = qty(energy, "MJ");
  return {
    streamId: input.streamId,
    label: input.label,
    kind: input.kind,
    energyMJ,
    energyReported: energyMJ,
    sharePct: 0,
    derivation:
      `${round(activityCanonical.value, 3)} ${activityCanonical.unit} x ` +
      `${round(contentCanonical.value, 6)} ${contentCanonical.unit} = ` +
      `${round(energy, 3)} MJ (${contentNote}; ${basisNote})`,
    factorsUsed,
    provenance: input.provenance,
    warnings,
  };
}

function computeThermal(input: ThermalEnergyInput): SecStreamResult {
  assertProvenance(input.streamId, input.provenance);
  if (dimensionOf(input.quantity.unit) !== "energy") {
    throw new SecError(
      `Stream "${input.streamId}": thermal energy must be an energy quantity, received ${input.quantity.unit}.`
    );
  }
  const energyMJ = convert(input.quantity, "MJ");
  return {
    streamId: input.streamId,
    label: input.label,
    kind: "thermal_direct",
    energyMJ,
    energyReported: energyMJ,
    sharePct: 0,
    derivation: `Supplied directly as ${input.quantity.value} ${input.quantity.unit} under ${input.methodologyRef}`,
    factorsUsed: [],
    provenance: input.provenance,
    warnings: [],
  };
}

function computeDemand(input: DemandInput): SecDemandResult {
  const out: SecDemandResult = { provenance: input.provenance };
  if (input.contractedDemand) {
    // Throws on anything that is not apparent power, which is the point.
    out.contractedDemandKVA = round(convert(input.contractedDemand, "kVA").value, 3);
  }
  if (input.maximumDemand) {
    out.maximumDemandKVA = round(convert(input.maximumDemand, "kVA").value, 3);
  }
  if (out.contractedDemandKVA && out.maximumDemandKVA) {
    out.demandUtilisationPct = round(
      (out.maximumDemandKVA / out.contractedDemandKVA) * 100,
      3
    );
  }
  return out;
}

export function calculateSec(input: SecInput, factors: FactorSet): SecResult {
  if (input.streams.length === 0) {
    throw new SecError("An SEC calculation requires at least one energy stream.");
  }
  assertProvenance("production", input.production.provenance);

  const allowUnverified = input.allowUnverifiedFactors ?? false;
  const seen = new Set<string>();
  const streams: SecStreamResult[] = [];

  for (const s of input.streams) {
    if (seen.has(s.streamId)) {
      throw new SecError(`Duplicate streamId "${s.streamId}".`);
    }
    seen.add(s.streamId);

    switch (s.kind) {
      case "electricity":
        streams.push(computeElectricity(s));
        break;
      case "fuel_mass":
      case "fuel_volume":
        streams.push(computeFuel(s, factors, allowUnverified));
        break;
      case "thermal_direct":
        streams.push(computeThermal(s));
        break;
      default: {
        const exhaustive: never = s;
        throw new SecError(`Unsupported energy stream: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  const totalMJ = streams.reduce((acc, s) => acc + s.energyMJ.value, 0);
  if (totalMJ <= 0) {
    throw new SecError("Total energy input must be greater than zero to compute SEC.");
  }

  const unit = input.reportingEnergyUnit;
  for (const s of streams) {
    s.energyReported = qty(round(convert(s.energyMJ, unit).value, 6), unit);
    s.sharePct = round((s.energyMJ.value / totalMJ) * 100, 4);
    s.energyMJ = qty(round(s.energyMJ.value, 3), "MJ");
  }

  const totalReported = convert(qty(totalMJ, "MJ"), unit);
  const production = input.production.quantity;
  if (production.value <= 0) {
    throw new SecError("Production quantity must be greater than zero to compute SEC.");
  }

  const sec = totalReported.value / production.value;
  const warnings = streams.flatMap((s) => s.warnings);

  const result: SecResult = {
    secEngineVersion: SEC_ENGINE_VERSION,
    factorSetVersion: factors.version,
    inputsHash: hashSecInputs(input),
    engagementId: input.engagementId,
    periodLabel: input.periodLabel,
    phase: input.phase,
    streams,
    totalEnergyMJ: qty(round(totalMJ, 3), "MJ"),
    totalEnergy: qty(round(totalReported.value, 6), unit),
    production,
    sec: round(sec, 6),
    secUnitLabel: input.secUnitLabel,
    productUnitLabel: input.production.productUnitLabel,
    warnings,
  };

  if (input.demand) {
    result.demand = computeDemand(input.demand);
  }

  return result;
}

/**
 * The ADEETIE savings gate.
 *
 * Minimum 10% energy savings, achieved and sustained, before annual interest
 * subvention releases. Percentage TO VERIFY against the operative ADEETIE
 * scheme guidelines; sourced from the BEE scheme description.
 */
export const ADEETIE_MIN_SAVINGS_PCT = 10;

export interface SavingsAssessment {
  baselineSec: number;
  postSec: number;
  secUnitLabel: string;
  /** Positive means SEC fell, i.e. the plant became more efficient. */
  savingsPct: number;
  thresholdPct: number;
  meetsThreshold: boolean;
  /** Absolute energy saved at post-implementation output, in the reporting unit. */
  energySavedAtPostOutput: Quantity;
  /** Reasons the comparison is not like-for-like, if any. */
  comparabilityWarnings: string[];
  baselineInputHash: string;
  postInputHash: string;
}

/**
 * Compare two SEC results. Deterministic and total: it states the percentage and
 * whether it clears the threshold, and refuses comparisons that are not
 * like-for-like rather than quietly normalising them.
 */
export function assessSavings(
  baseline: SecResult,
  post: SecResult,
  thresholdPct: number = ADEETIE_MIN_SAVINGS_PCT
): SavingsAssessment {
  if (baseline.phase !== "baseline") {
    throw new SecError(
      `Savings assessment needs a baseline SEC result; received phase "${baseline.phase}".`
    );
  }
  if (post.phase !== "post_implementation") {
    throw new SecError(
      `Savings assessment needs a post-implementation SEC result; received phase "${post.phase}".`
    );
  }
  if (baseline.secUnitLabel !== post.secUnitLabel) {
    throw new SecError(
      `Cannot compare SEC in ${baseline.secUnitLabel} against ${post.secUnitLabel}.`
    );
  }
  if (baseline.sec <= 0) {
    throw new SecError("Baseline SEC must be greater than zero to express a saving.");
  }

  const comparabilityWarnings: string[] = [];
  if (baseline.productUnitLabel !== post.productUnitLabel) {
    comparabilityWarnings.push(
      `Baseline output is measured as "${baseline.productUnitLabel}" but post-implementation output as ` +
        `"${post.productUnitLabel}". The two SEC figures are not directly comparable.`
    );
  }
  if (baseline.factorSetVersion !== post.factorSetVersion) {
    comparabilityWarnings.push(
      `Baseline used factor set ${baseline.factorSetVersion} and post-implementation used ` +
        `${post.factorSetVersion}. Part of the movement may be a factor revision rather than a saving.`
    );
  }
  if (baseline.totalEnergy.unit !== post.totalEnergy.unit) {
    comparabilityWarnings.push(
      `Reporting energy units differ (${baseline.totalEnergy.unit} vs ${post.totalEnergy.unit}).`
    );
  }
  const baselineStreams = new Set(baseline.streams.map((s) => s.streamId));
  const postStreams = new Set(post.streams.map((s) => s.streamId));
  const droppedStreams = [...baselineStreams].filter((s) => !postStreams.has(s));
  if (droppedStreams.length > 0) {
    comparabilityWarnings.push(
      `Stream(s) present in the baseline but absent post-implementation: ${droppedStreams.join(", ")}. ` +
        `A dropped stream reduces SEC without an efficiency gain.`
    );
  }

  const savingsPct = ((baseline.sec - post.sec) / baseline.sec) * 100;
  const savedPerUnit = baseline.sec - post.sec;

  return {
    baselineSec: baseline.sec,
    postSec: post.sec,
    secUnitLabel: baseline.secUnitLabel,
    savingsPct: round(savingsPct, 4),
    thresholdPct,
    meetsThreshold: savingsPct >= thresholdPct,
    energySavedAtPostOutput: qty(
      round(savedPerUnit * post.production.value, 6),
      post.totalEnergy.unit
    ),
    comparabilityWarnings,
    baselineInputHash: baseline.inputsHash,
    postInputHash: post.inputsHash,
  };
}

export { UnitError };
