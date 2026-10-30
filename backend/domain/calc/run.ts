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
import { factLabel, hasProvenance } from "../provenance";
import { loadPack, assertRunnable } from "../packs";
import { basisWindowFor } from "../packs/emissionBasis";
import type {
  MethodologyPack,
  PackProductionBinding,
  PackQuantityBinding,
  PackStreamBinding,
} from "../packs/types";

/**
 * A committed fact as the engines see it. Page evidence fills `page`, `bbox` and
 * `source_text`; the other three provenance types (backend/domain/provenance)
 * fill `provenance_type` and `provenance` instead. Rows from before provenance
 * v2 have neither and are read as page evidence.
 */
export interface ProvenancedFact {
  id: string;
  field_path: string;
  value_json: unknown;
  unit?: string | null;
  document_id?: string | null;
  page?: number | null;
  bbox?: { x: number; y: number; width: number; height: number } | unknown;
  source_text?: string | null;
  provenance_type?: string | null;
  provenance?: unknown;
}

/** Map a `facts` row to the shape the engines read. The one place that copies provenance columns. */
export function toProvenancedFact(f: {
  id: string;
  field_path: string;
  value_json: unknown;
  unit?: string | null;
  document_id?: string | null;
  page?: number | null;
  bbox?: unknown;
  source_text?: string | null;
  provenance_type?: string | null;
  provenance?: unknown;
}): ProvenancedFact {
  return {
    id: f.id,
    field_path: f.field_path,
    value_json: f.value_json,
    unit: f.unit ?? null,
    document_id: f.document_id ?? null,
    page: f.page ?? null,
    bbox: f.bbox ?? null,
    source_text: f.source_text ?? null,
    provenance_type: f.provenance_type ?? "document_page",
    provenance: f.provenance ?? null,
  };
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

function factsMatching(facts: ProvenancedFact[], path: string): ProvenancedFact[] {
  return facts.filter((f) => matchFactPath(f.field_path, path));
}

/** First match for SEC energy rows and calorific basis. GEI quantities do not use this. */
function factByPath(facts: ProvenancedFact[], path: string) {
  return factsMatching(facts, path)[0];
}

function distinctNumericValues(matched: ProvenancedFact[]): number[] {
  const values: number[] = [];
  for (const fact of matched) {
    const value = num(fact.value_json);
    if (value === null || values.includes(value)) continue;
    values.push(value);
  }
  return values;
}

/**
 * More than one fact on a calculation tag. Lists the distinct numbers and
 * refuses to pick one. A single match returns null.
 */
function acceptedValueConflict(tag: string, matched: ProvenancedFact[]): string | null {
  if (matched.length <= 1) return null;
  const values = distinctNumericValues(matched);
  const listed = values.length > 0 ? ` (${values.join(", ")})` : "";
  return `Calculation tag "${tag}" has more than one accepted value${listed}. The run will not choose one.`;
}

function assertAtMostOne(facts: ProvenancedFact[], path: string): ProvenancedFact | null {
  const matched = factsMatching(facts, path);
  const conflict = acceptedValueConflict(path, matched);
  if (conflict) throw new CalcError(conflict);
  return matched[0] ?? null;
}

function requiredFactMessage(binding: PackStreamBinding): string {
  return `Pack requires a fact at "${binding.quantity.path}" for stream "${binding.streamId}".`;
}

/** Quantity and calorific-value conflicts for one stream. Does not pick a row. */
function ambiguousStreamProblems(facts: ProvenancedFact[], binding: PackStreamBinding): string[] {
  const problems: string[] = [];
  const quantity = acceptedValueConflict(
    binding.quantity.path,
    factsMatching(facts, binding.quantity.path)
  );
  if (quantity) problems.push(quantity);
  if (binding.kind === "fuel_combustion") {
    const calorific = acceptedValueConflict(
      binding.calorificValue.path,
      factsMatching(facts, binding.calorificValue.path)
    );
    if (calorific) problems.push(calorific);
  }
  return problems;
}

export interface StreamReadiness {
  streamId: string;
  label: string;
  bound: boolean;
  /** A quantity was found but the stream cannot be priced. A run would drop real consumption. */
  partial?: boolean;
  /** The pack names this stream as required for a run, alone or as one of a group of methods. */
  required?: boolean;
  /**
   * The stream is outside the intensity basis for this compliance year, so the pack does not
   * require it. A figure that is supplied is still counted.
   */
  inBasisWindow?: boolean;
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
  /** Streams the pack does not require for this compliance year, each with its citation. */
  basisNotes: string[];
}

/** Group id to its member bindings, for streams that are alternative methods of one quantity. */
function requiredGroups(bindings: PackStreamBinding[]): Map<string, PackStreamBinding[]> {
  const groups = new Map<string, PackStreamBinding[]>();
  for (const b of bindings) {
    if (!b.requiredGroup) continue;
    groups.set(b.requiredGroup, [...(groups.get(b.requiredGroup) ?? []), b]);
  }
  return groups;
}

function groupMessage(group: string, members: PackStreamBinding[]): string {
  return (
    `A run needs at least one ${group} method, and none has a fact. Provide one of: ` +
    members.map((b) => `"${b.label}" at "${b.quantity.path}"`).join(" or ") +
    "."
  );
}

function bothMethodsMessage(group: string, members: PackStreamBinding[]): string {
  return (
    `These ${group} methods are alternatives for the same emission, and counting both would count it twice: ` +
    members.map((b) => `"${b.label}"`).join(" and ") +
    ". Keep one."
  );
}

/**
 * A counted figure whose stream is outside the intensity basis for the year. It stays in the
 * total, because no number is dropped on an interpretation of a Note about targets, and the
 * run says plainly that the basis then differs from a target set without it.
 */
function countedOutsideBasisWarning(binding: PackStreamBinding, complianceYear: string, citation: string): string {
  return (
    `"${binding.label}" is counted, but it is outside the intensity basis for ${complianceYear}. ${citation} ` +
    `The intensity includes it, so it is not on the same basis as a target set without it. Confirm the basis before relying on the headroom or the credit position.`
  );
}

/**
 * What a run will do with the current D4 facts — without executing the engine.
 * Used by the Runs page so "No runs" is not confused with "facts are missing".
 */
export function assessRunReadiness(
  pack: MethodologyPack,
  facts: ProvenancedFact[],
  opts?: { draftMode?: boolean; complianceYear?: string }
): RunReadiness {
  const productionPath = pack.production_binding?.path ?? null;
  const productionMatches = productionPath ? factsMatching(facts, productionPath) : [];
  const productionConflict = productionPath
    ? acceptedValueConflict(productionPath, productionMatches)
    : null;
  // One matching fact binds production. Several facts do not: the run will not choose.
  const productionBound = productionMatches.length === 1;
  const streams: StreamReadiness[] = [];
  const conflictedStreamIds = new Set<string>();
  const ambiguityBlockers: string[] = [];
  const basisNotes: string[] = [];
  const basisWarnings: string[] = [];

  if (pack.calculation_method === "GEI") {
    for (const binding of pack.stream_bindings) {
      const qtyMatches = factsMatching(facts, binding.quantity.path);
      const qtyConflict = acceptedValueConflict(binding.quantity.path, qtyMatches);
      let cvConflict: string | null = null;
      let cvMatches: ProvenancedFact[] = [];
      if (binding.kind === "fuel_combustion") {
        cvMatches = factsMatching(facts, binding.calorificValue.path);
        cvConflict = acceptedValueConflict(binding.calorificValue.path, cvMatches);
      }
      if (qtyConflict && !ambiguityBlockers.includes(qtyConflict)) ambiguityBlockers.push(qtyConflict);
      if (cvConflict && !ambiguityBlockers.includes(cvConflict)) ambiguityBlockers.push(cvConflict);

      if (qtyConflict || cvConflict) {
        conflictedStreamIds.add(binding.streamId);
        const reason = [qtyConflict, cvConflict]
          .filter((part): part is string => part !== null)
          .join(" ");
        streams.push({
          streamId: binding.streamId,
          label: binding.label,
          bound: false,
          reason,
        });
        continue;
      }

      const qtyFact = qtyMatches[0];
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
        const cvFact = cvMatches[0];
        if (!cvFact) {
          streams.push({
            streamId: binding.streamId,
            label: binding.label,
            bound: false,
            partial: true,
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
  if (productionConflict) {
    blockers.push(productionConflict);
  } else if (productionPath && !productionBound) {
    blockers.push(
      `Production is required at "${productionPath}". Accept that field from an equivalent-product log.`
    );
  }

  // A stream is optional unless the pack says otherwise: no consumption, no fact, counted as zero.
  // Consumption that cannot be priced is different. Dropping it would understate emissions
  // without a message, so it blocks the run. Two accepted values on one tag block as well.
  for (const s of streams) {
    if (s.partial) blockers.push(`"${s.label}": ${s.reason}. A run would leave this consumption out.`);
  }
  for (const message of ambiguityBlockers) blockers.push(message);
  if (pack.calculation_method === "GEI") {
    for (const b of pack.stream_bindings) {
      const s = streams.find((x) => x.streamId === b.streamId);
      const window = opts?.complianceYear ? basisWindowFor(b, opts.complianceYear) : null;
      if (s) {
        s.required = Boolean(b.required || b.requiredGroup) && !window;
        if (window) s.inBasisWindow = true;
      }
      if (window) {
        // Not required this year. A figure that is there is still counted, and the page says so.
        if (s?.bound) basisWarnings.push(countedOutsideBasisWarning(b, opts!.complianceYear!, window.citation));
        else basisNotes.push(`"${b.label}" is not required for ${opts!.complianceYear}. ${window.citation}`);
        continue;
      }
      if (b.required && s && !s.bound && !s.partial && !conflictedStreamIds.has(b.streamId)) {
        blockers.push(`"${b.label}" is required by the pack and has no fact at "${b.quantity.path}".`);
      }
    }
    // Alternative methods: one bound member satisfies the group. A member that is partial or
    // in conflict already has its own blocker, so the group message would only repeat it.
    for (const [group, members] of requiredGroups(pack.stream_bindings)) {
      // Alternatives for one emission: two bound at once would count it twice, in any year.
      const both = members.filter((m) => streams.find((x) => x.streamId === m.streamId)?.bound);
      if (both.length > 1) blockers.push(bothMethodsMessage(group, both));
      const active = members.filter((m) => !(opts?.complianceYear && basisWindowFor(m, opts.complianceYear)));
      if (active.length === 0) continue;
      const states = active.map((m) => streams.find((x) => x.streamId === m.streamId));
      const satisfied = states.some((s) => s?.bound);
      const alreadyBlocked = states.some((s) => s?.partial || conflictedStreamIds.has(s?.streamId ?? ""));
      if (!satisfied && !alreadyBlocked) blockers.push(groupMessage(group, active));
    }
  }
  const warnings: string[] = [...basisWarnings];
  const unbound = streams.filter(
    (s) => !s.bound && !s.partial && !s.required && !s.inBasisWindow && !conflictedStreamIds.has(s.streamId)
  );
  if (unbound.length > 0 && streams.some((s) => s.bound)) {
    warnings.push(
      `Counted as zero (no fact): ${unbound.map((s) => s.label).join(", ")}. If the plant uses any of these, add the figure before running.`
    );
  }

  return {
    factCount: facts.length,
    productionBound,
    productionPath,
    streams,
    boundStreamCount: streams.filter((s) => s.bound).length,
    canRun: blockers.length === 0 && facts.length > 0 && Boolean(productionBound),
    blockers,
    warnings,
    basisNotes,
  };
}

function requireProvenance(fact: ProvenancedFact) {
  if (!hasProvenance(fact)) {
    throw new CalcError(
      `Fact "${fact.id}" is missing provenance. It needs a document page, spreadsheet cell, time-series range or site observation.`
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
  const fact = assertAtMostOne(facts, binding.path);
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
  const ambiguous = ambiguousStreamProblems(facts, binding);
  if (ambiguous.length > 0) {
    throw new CalcError(ambiguous.join(" "));
  }
  const resolved = resolveQuantity(
    facts,
    binding.quantity,
    `Stream "${binding.streamId}" quantity`
  );
  if (!resolved) {
    if (binding.required) {
      throw new CalcError(requiredFactMessage(binding));
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
        // Zero consumption needs no calorific value. Anything else cannot be dropped silently.
        if (!binding.required && resolved.quantity.value === 0) return null;
        throw new CalcError(
          `Stream "${binding.streamId}" has a quantity but no calorific value at "${binding.calorificValue.path}". ` +
            `Add the calorific value, or remove the quantity if the fuel was not used.`
        );
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
          label: factLabel(resolved.fact),
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
          label: factLabel(resolved.fact),
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
          label: factLabel(resolved.fact),
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
  assertAtMostOne(facts, binding.path);
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
      label: factLabel(resolved.fact),
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

  // Walk every binding so one bad tag does not hide another. A single CalcError
  // lists each conflict and each missing required fact.
  const streams: StreamInput[] = [];
  const problems: string[] = [];
  const failedStreamIds = new Set<string>();
  const note = (err: unknown) => {
    if (!(err instanceof CalcError)) throw err;
    if (!problems.includes(err.message)) problems.push(err.message);
  };
  for (const binding of pack.stream_bindings) {
    try {
      const stream = buildStream(facts, binding);
      if (stream) streams.push(stream);
    } catch (err) {
      failedStreamIds.add(binding.streamId);
      note(err);
    }
  }

  // Alternative methods: at least one member of each group must have produced a stream, unless
  // the year puts the group outside the intensity basis. A member that failed already explains
  // itself, so the group message would repeat it wrongly.
  for (const [group, members] of requiredGroups(pack.stream_bindings)) {
    const both = members.filter((m) => streams.some((s) => s.streamId === m.streamId));
    if (both.length > 1) problems.push(bothMethodsMessage(group, both));
    const active = members.filter((m) => !basisWindowFor(m, req.complianceYear));
    if (active.length === 0) continue;
    const satisfied = active.some((m) => streams.some((s) => s.streamId === m.streamId));
    const memberFailed = active.some((m) => failedStreamIds.has(m.streamId));
    if (!satisfied && !memberFailed) problems.push(groupMessage(group, active));
  }

  let production: CalcInput["production"] | undefined;
  try {
    production = buildProduction(facts, pack.production_binding);
  } catch (err) {
    note(err);
  }
  if (problems.length > 0) throw new CalcError(problems.join(" "));
  if (!production) {
    throw new CalcError(
      `Production fact at "${pack.production_binding.path}" is required to compute an intensity.`
    );
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
    production,
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
  // A counted figure that sits outside the intensity basis for this year stays in the total;
  // the run carries the warning so the headroom is not read as like-for-like. The input and its
  // hash are untouched.
  for (const binding of pack.stream_bindings) {
    const window = basisWindowFor(binding, req.complianceYear);
    if (window && input.streams.some((s) => s.streamId === binding.streamId)) {
      result.warnings.push(countedOutsideBasisWarning(binding, req.complianceYear, window.citation));
    }
  }
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
