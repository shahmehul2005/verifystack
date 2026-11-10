/**
 * Which registry key, and which reporting period, an extracted field carries.
 *
 * Runs when a document is extracted, in code, from the document type, the stored field path and the
 * sibling fields of the same document. The model is never asked for a key or a period: it fills the
 * closed schema it always filled, and this maps what it filled.
 *
 * A field gets a key only where the registry says that leaf, stored at that path, is the quantity.
 * Everything else is left unannotated (null), which means "not mapped", and is different from a
 * period that was looked for and not found, which is stored as `unknown` with the reason.
 */

import { normalizePeriod, type PeriodInput, type PeriodOutcome } from "./normalize";
import type { Registry } from "./types";

export interface FieldAnnotation {
  canonicalKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** `known` or `unknown`; null when no period was assessed for this field. */
  periodStatus: "known" | "unknown" | null;
  /** The reason a period is unknown, or the readings made to place a known one. */
  periodNote: string | null;
  registryVersion: string | null;
}

export const NO_ANNOTATION: FieldAnnotation = {
  canonicalKey: null,
  periodStart: null,
  periodEnd: null,
  periodStatus: null,
  periodNote: null,
  registryVersion: null,
};

export interface FlatValue {
  fieldPath: string;
  value: unknown;
}

/** Where each document type prints the period its figures cover. */
const PERIOD_SOURCES: Record<string, (get: (leaf: string) => unknown) => PeriodInput> = {
  electricity_bill: (get) => ({ start: asDate(get("billingPeriodStart")), end: asDate(get("billingPeriodEnd")) }),
  // A delivery period, not the invoice date: an invoice is raised on a day that is not the period used.
  fuel_invoice: (get) => ({ start: asDate(get("deliveryPeriodStart")), end: asDate(get("deliveryPeriodEnd")) }),
  // A certificate speaks for one sample, on the day it was taken.
  // A certificate speaks for one sample, or covers a monthly composite period.
  lab_certificate: (get) => {
    const sample = asDate(get("sampleDate"));
    if (sample) return { start: sample, end: sample };
    const start = asDate(get("periodStart")) ?? asDate(get("deliveryPeriodStart"));
    const end = asDate(get("periodEnd")) ?? asDate(get("deliveryPeriodEnd"));
    if (start && end) return { start, end };
    return { text: typeof get("reportingPeriod") === "string" ? (get("reportingPeriod") as string) : null };
  },
  production_log: (get) => ({ text: typeof get("reportingPeriod") === "string" ? (get("reportingPeriod") as string) : null }),
};

const asDate = (v: unknown): string | number | null => (typeof v === "string" || typeof v === "number" ? v : null);

const leafOf = (path: string) => path.split(".").pop() ?? path;

/**
 * The period a document states, looked for across all its fields (a bill's period may sit on another
 * page than its quantity). Null when this document type has no period rule, which is different from a
 * period that could not be found.
 */
export function documentPeriod(docType: string, fields: readonly FlatValue[]): PeriodOutcome | null {
  const source = PERIOD_SOURCES[docType];
  if (!source) return null;
  const get = (leaf: string) => fields.find((f) => f.fieldPath === leaf || leafOf(f.fieldPath) === leaf)?.value;
  return normalizePeriod(source(get));
}

/** The annotation for one stored field. */
export function annotateField(registry: Registry, docType: string, fieldPath: string, period: PeriodOutcome | null): FieldAnnotation {
  const name = `${docType}.${leafOf(fieldPath)}`;
  for (const entry of registry.entries) {
    const member = entry.members.find((m) => m.surface === "extraction_field" && m.name === name);
    if (!member) continue;
    // A leaf that is only this quantity at some stored paths (a fuel invoice's calorific value is coal's
    // unqualified or under coal, and petcoke's under petcoke) is left alone elsewhere.
    if (member.appliesToPaths && !member.appliesToPaths.includes(fieldPath)) return NO_ANNOTATION;
    return {
      canonicalKey: entry.key,
      registryVersion: registry.version,
      ...periodColumns(period),
    };
  }
  return NO_ANNOTATION;
}

function periodColumns(period: PeriodOutcome | null): Pick<FieldAnnotation, "periodStart" | "periodEnd" | "periodStatus" | "periodNote"> {
  if (period === null) return { periodStart: null, periodEnd: null, periodStatus: null, periodNote: null };
  if (period.status === "unknown") return { periodStart: null, periodEnd: null, periodStatus: "unknown", periodNote: period.reason };
  return {
    periodStart: period.start,
    periodEnd: period.end,
    periodStatus: "known",
    periodNote: period.assumptions.length > 0 ? period.assumptions.join("; ") : null,
  };
}

/** Postgres 42703 or PostgREST PGRST204: a column the database does not have (migration 0025 not applied). */
export const isMissingRegistryColumn = (e: { code?: string; message?: string }) =>
  e.code === "42703" || e.code === "PGRST204" || /canonical_key|period_status|registry_version/.test(e.message ?? "");

/** The six registry columns of an extracted field or fact, as a database row. */
export function registryColumns(a: FieldAnnotation) {
  return {
    canonical_key: a.canonicalKey,
    period_start: a.periodStart,
    period_end: a.periodEnd,
    period_status: a.periodStatus,
    period_note: a.periodNote,
    registry_version: a.registryVersion,
  };
}

/**
 * The registry columns to carry from an extracted field onto the fact accepted from it. Empty when the
 * field has no `canonical_key` property at all (a database where migration 0025 is not applied) and
 * when it carries no key, so an old database and an unmapped field both insert exactly as before.
 */
export function carriedRegistryColumns(field: {
  canonical_key?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  period_status?: "known" | "unknown" | null;
  period_note?: string | null;
  registry_version?: string | null;
}) {
  if (field.canonical_key === undefined || field.canonical_key === null) return {};
  return {
    canonical_key: field.canonical_key,
    period_start: field.period_start ?? null,
    period_end: field.period_end ?? null,
    period_status: field.period_status ?? null,
    period_note: field.period_note ?? null,
    registry_version: field.registry_version ?? null,
  };
}

/**
 * Annotate every field of one extracted document in one pass: find the period once, then key each
 * field. Returns a map by field path (a field absent from it is unannotated).
 */
export function annotateDocument(registry: Registry | null, docType: string, fields: readonly FlatValue[]): Map<string, FieldAnnotation> {
  const out = new Map<string, FieldAnnotation>();
  if (!registry) return out;
  const period = documentPeriod(docType, fields);
  for (const f of fields) {
    const a = annotateField(registry, docType, f.fieldPath, period);
    if (a.canonicalKey !== null) out.set(f.fieldPath, a);
  }
  return out;
}
