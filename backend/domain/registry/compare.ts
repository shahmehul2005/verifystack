/**
 * Side by side: what the entity declared, what the verifier read, and what a person approved from a
 * document, for each registry quantity.
 *
 * Read only. Nothing here writes, and nothing copies a value from one source into another. The three
 * sources stay independent: the pro forma and the workbook readers are the entity's own figures, desk
 * readings are what the verifier read off a page, and facts are what a person approved from an
 * extraction. This module only lines them up, puts each on the entry's standard unit, and says where
 * two of them can honestly be compared.
 *
 * It compares sparingly, on purpose. Two figures are compared only when the registry says they cover
 * the same thing: a reading typed from a document and a fact approved from the same document. A bill
 * for one month against an annual cell, or a lab's sample mean against one certificate, are different
 * spans, so they are shown together and not compared. A false disagreement is worse than a gap.
 */

import { normalizeQuantity } from "./normalize";
import type { Period, Registry, RegistryEntry, RegistryMember, Surface } from "./types";

export interface FactInput {
  id: string;
  documentId: string | null;
  fieldPath: string;
  value: unknown;
  unit: string | null;
  canonicalKey?: string | null;
  periodStatus?: "known" | "unknown" | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodNote?: string | null;
}

export interface ReadingInput {
  value: number | string;
  /** The document the figure was read from, where one is recorded. */
  documentId?: string | null;
}

export interface ComparisonInput {
  registry: Registry;
  /** Every desk-review reading by key: pro forma cells, workbook-reader figures and typed readings. */
  readings: Readonly<Record<string, ReadingInput>>;
  facts: readonly FactInput[];
  documentName: (id: string) => string | null;
  /** Relative tolerance for two readings of one printed figure. The caller passes desk review's own. */
  tolerance: number;
}

export type Origin = "proforma" | "workbook" | "desk_reading" | "fact";

export interface SourceRow {
  origin: Origin;
  surface: Surface;
  /** The registry name, or the fact's stored path. */
  name: string;
  /** The figure as it was stated, with its unit. */
  asStated: string;
  /** On the entry's standard unit, or null with the reason in `note`. */
  standard: number | null;
  note: string | null;
  scope: Period;
  /** The period the source states, or why there is none. */
  period: string | null;
  documentId: string | null;
  documentName: string | null;
  factId?: string;
}

export interface PairResult {
  /** Indexes into the entry's sources: the fact, and what it was set against. */
  fact: number;
  other: number;
  state: "agree" | "disagree" | "not_compared";
  reason: string;
  /** Relative difference, for a compared pair. */
  relDiff?: number;
}

export interface EntryComparison {
  key: string;
  meaning: string;
  standardUnit: string;
  sources: SourceRow[];
  pairs: PairResult[];
}

export interface Comparison {
  entries: EntryComparison[];
  /** Approved facts with no registry key: accepted before the registry, or from a source it does not map. */
  unmappedFacts: number;
}

const ORIGIN: Partial<Record<Surface, Origin>> = {
  proforma_cell: "proforma",
  desk_reader: "workbook",
  desk_manual: "desk_reading",
};

/** Spans that mean "this one document's figure". A fact and a reading of the same document can be compared. */
const DOCUMENT_SCOPE: ReadonlySet<Period> = new Set(["single_reading", "document_period"]);

const SCOPE_WORDS: Record<Period, string> = {
  annual: "the whole compliance year",
  period_total: "a total over the months the evidence covers",
  period_mean: "a mean over the months the evidence covers",
  single_reading: "one document",
  daily_series: "a series of days",
  document_period: "the period one document states",
};

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const show = (n: number) => (Math.round(n * 1e6) / 1e6).toLocaleString("en-IN", { maximumFractionDigits: 6 });

function periodText(f: FactInput): string {
  if (f.periodStatus === "known" && f.periodStart && f.periodEnd) return `${f.periodStart} to ${f.periodEnd}`;
  if (f.periodStatus === "unknown") return `period unknown${f.periodNote ? `: ${f.periodNote}` : ""}`;
  return "no period recorded";
}

function sourceFrom(entry: RegistryEntry, member: RegistryMember, reading: ReadingInput, input: ComparisonInput): SourceRow | null {
  const origin = ORIGIN[member.surface];
  if (!origin) return null;
  // A series is many values, not one; it has no single figure to line up.
  if (member.name.endsWith("@*")) return null;
  const value = num(reading.value);
  const unit = member.unit ?? "";
  const std = value === null ? null : normalizeQuantity(entry, { value, unit });
  return {
    origin,
    surface: member.surface,
    name: member.name,
    asStated: value === null ? String(reading.value) : `${show(value)}${unit ? ` ${unit}` : ""}`,
    standard: std?.ok ? std.value : null,
    note: value === null ? "Not a number." : std && !std.ok ? std.reason : null,
    scope: member.period,
    period: null,
    documentId: reading.documentId ?? null,
    documentName: reading.documentId ? input.documentName(reading.documentId) : null,
  };
}

function sourceFromFact(entry: RegistryEntry, f: FactInput, input: ComparisonInput): SourceRow {
  const value = num(f.value);
  const std = value === null ? null : normalizeQuantity(entry, { value, unit: f.unit });
  return {
    origin: "fact",
    surface: "extraction_field",
    name: f.fieldPath,
    asStated: value === null ? String(f.value) : `${show(value)}${f.unit ? ` ${f.unit}` : ""}`,
    standard: std?.ok ? std.value : null,
    note: value === null ? "Not a number." : std && !std.ok ? std.reason : null,
    scope: "document_period",
    period: periodText(f),
    documentId: f.documentId,
    documentName: f.documentId ? input.documentName(f.documentId) : null,
    factId: f.id,
  };
}

function pairOf(entry: RegistryEntry, fi: number, oi: number, fact: SourceRow, other: SourceRow, tolerance: number): PairResult {
  const base = { fact: fi, other: oi };
  const notCompared = (reason: string): PairResult => ({ ...base, state: "not_compared", reason });

  if (fact.standard === null) return notCompared(`The fact could not be put on ${entry.standardUnit}: ${fact.note ?? "unreadable"}`);
  if (other.standard === null) return notCompared(`The ${other.origin.replace("_", " ")} could not be put on ${entry.standardUnit}: ${other.note ?? "unreadable"}`);

  if (!DOCUMENT_SCOPE.has(other.scope)) {
    return notCompared(`They cover different spans: the fact is ${SCOPE_WORDS.document_period}, ${other.name} is ${SCOPE_WORDS[other.scope]}.`);
  }
  if (!fact.documentId || !other.documentId) {
    return notCompared(`${!other.documentId ? other.name : "The fact"} is not linked to a document, so it cannot be shown to be the same page.`);
  }
  if (fact.documentId !== other.documentId) {
    return notCompared(`They were read from different documents (${fact.documentName ?? "one"} and ${other.documentName ?? "another"}).`);
  }

  const a = fact.standard;
  const b = other.standard;
  const relDiff = b === 0 ? (a === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(a - b) / Math.abs(b);
  const agree = relDiff <= tolerance + 1e-12;
  return {
    ...base,
    state: agree ? "agree" : "disagree",
    relDiff,
    reason: agree
      ? `Both were read from ${fact.documentName ?? "the same document"} and agree within ${(tolerance * 100).toFixed(1)}%.`
      : `Both were read from ${fact.documentName ?? "the same document"} but differ: ${show(a)} and ${show(b)} ${entry.standardUnit} (${Number.isFinite(relDiff) ? (relDiff * 100).toFixed(2) + "%" : "a zero figure"}, allowed ${(tolerance * 100).toFixed(1)}%).`,
  };
}

export function compareEvidence(input: ComparisonInput): Comparison {
  const keyed = input.facts.filter((f) => f.canonicalKey);
  const entries: EntryComparison[] = input.registry.entries.map((entry) => {
    const sources: SourceRow[] = [];
    for (const member of entry.members) {
      const reading = input.readings[member.name];
      if (!reading || !ORIGIN[member.surface]) continue;
      const row = sourceFrom(entry, member, reading, input);
      if (row) sources.push(row);
    }
    const factIndexes: number[] = [];
    for (const f of keyed.filter((x) => x.canonicalKey === entry.key)) {
      factIndexes.push(sources.length);
      sources.push(sourceFromFact(entry, f, input));
    }
    const pairs: PairResult[] = [];
    for (const fi of factIndexes) {
      sources.forEach((s, oi) => {
        if (s.origin !== "fact") pairs.push(pairOf(entry, fi, oi, sources[fi]!, s, input.tolerance));
      });
    }
    return { key: entry.key, meaning: entry.meaning, standardUnit: entry.standardUnit, sources, pairs };
  });
  return { entries, unmappedFacts: input.facts.length - keyed.length };
}

// ---------------------------------------------------------------------------------------------
// The one check desk review runs from this
// ---------------------------------------------------------------------------------------------

/**
 * The readings desk review's `evidence_nabl_gcv` check is given. It compares the NABL certificate figure
 * a verifier typed with the figure Workbench extraction read from the same certificate and a person
 * approved. The values are passed as `xcmp.*` readings of that run; they are never written into the
 * verifier's own readings or into the facts.
 */
export function nablGcvReadings(c: Comparison): Record<string, number | string> {
  const entry = c.entries.find((e) => e.key === "coal_gcv");
  const out: Record<string, number | string> = {};
  const say = (state: string, why: string) => {
    out["xcmp.coal_gcv.state"] = state;
    out["xcmp.coal_gcv.why"] = why;
    return out;
  };
  if (!entry) return say("not_run", "The registry has no coal GCV entry.");

  const reading = entry.sources.find((s) => s.name === "coal.nabl_gcv");
  const facts = entry.sources.filter((s) => s.origin === "fact");
  if (!reading) return say("no_reading", "No NABL certificate figure has been typed yet.");
  if (facts.length === 0) return say("no_fact", "No Workbench fact has been approved for coal GCV, so there is nothing to set the typed figure against.");
  if (!reading.documentId) return say("unlinked", "The typed NABL figure is not linked to a document, so it cannot be shown to be the same page as a fact.");

  const same = facts.filter((f) => f.documentId === reading.documentId);
  if (same.length === 0) {
    return say("different_document", `${facts.length} Workbench fact${facts.length === 1 ? "" : "s"} for coal GCV ${facts.length === 1 ? "was" : "were"} approved from other documents, not from ${reading.documentName ?? "the certificate the figure was typed from"}.`);
  }
  if (same.length > 1) {
    return say("ambiguous", `${same.length} Workbench facts for coal GCV were approved from the same document. Withdraw the wrong one so only one stands.`);
  }
  const fact = same[0]!;
  if (fact.standard === null || reading.standard === null) {
    return say("unreadable", `A figure could not be put on kcal/kg: ${fact.standard === null ? `the fact (${fact.note})` : `the typed figure (${reading.note})`}.`);
  }
  out["xcmp.coal_gcv.state"] = "compared";
  out["xcmp.coal_gcv.fact"] = fact.standard;
  out["xcmp.coal_gcv.reading"] = reading.standard;
  out["xcmp.coal_gcv.document"] = reading.documentName ?? "";
  return out;
}
