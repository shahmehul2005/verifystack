/**
 * Provenance model v2 (DFD v3.1 section 4).
 *
 * No fact is committed without one of four provenance types. The first is the
 * original page-and-region form; the others let a value come from a spreadsheet
 * cell, a time-series range, or something a verifier saw on site.
 *
 *   document_page      document, page, bounding box, verbatim source text
 *   spreadsheet_cell   document, sheet, cell, value, formula if any
 *   time_series_range  document, tag, start, end, aggregation, row count
 *   site_observation   observation id, observer, timestamp, optional location,
 *                      evidence file ids
 *
 * Page evidence keeps its dedicated columns (`page`, `bbox`, `source_text`) so
 * every existing row and query stays valid; the other three types carry their
 * fields in the `provenance` JSON column. Migration 0013 enforces the same rule
 * in the database, so a row cannot be written around this module.
 */

import { z } from "zod";
import { BBoxSchema } from "../extraction/schemas";

export const PROVENANCE_TYPES = [
  "document_page",
  "spreadsheet_cell",
  "time_series_range",
  "site_observation",
] as const;

export type ProvenanceType = (typeof PROVENANCE_TYPES)[number];

export const PROVENANCE_LABEL: Record<ProvenanceType, string> = {
  document_page: "Document page",
  spreadsheet_cell: "Spreadsheet cell",
  time_series_range: "Time-series range",
  site_observation: "Site observation",
};

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Expected an ISO date-time");

export const DocumentPageProvenance = z.object({
  type: z.literal("document_page"),
  /** Always present on stored rows (the column is NOT NULL for this type in 0013). */
  documentId: z.string().min(1).optional(),
  page: z.number().int().positive(),
  bbox: BBoxSchema,
  sourceText: z.string().trim().min(1),
});

export const SpreadsheetCellProvenance = z.object({
  type: z.literal("spreadsheet_cell"),
  documentId: z.string().min(1),
  sheet: z.string().min(1).max(120),
  cellRef: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/, "Expected an A1-style cell reference"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  formula: z.string().max(2000).optional(),
});

export const TIME_SERIES_AGGREGATIONS = ["sum", "mean", "min", "max", "last", "count"] as const;

export const TimeSeriesRangeProvenance = z
  .object({
    type: z.literal("time_series_range"),
    documentId: z.string().min(1),
    tag: z.string().min(1).max(200),
    start: isoDate,
    end: isoDate,
    aggregation: z.enum(TIME_SERIES_AGGREGATIONS),
    rowCount: z.number().int().positive(),
  })
  .refine((p) => Date.parse(p.end) >= Date.parse(p.start), {
    message: "end must not be before start",
    path: ["end"],
  });

export const SiteObservationProvenance = z.object({
  type: z.literal("site_observation"),
  observationId: z.string().uuid(),
  observer: z.string().trim().min(1).max(200),
  timestamp: isoDate,
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().nonnegative().optional(),
    })
    .optional(),
  evidenceFileIds: z.array(z.string().min(1)).default([]),
});

export const FactProvenanceSchema = z.discriminatedUnion("type", [
  DocumentPageProvenance,
  SpreadsheetCellProvenance,
  TimeSeriesRangeProvenance,
  SiteObservationProvenance,
]);

export type Provenance = z.infer<typeof FactProvenanceSchema>;
export type DocumentPageProvenance = z.infer<typeof DocumentPageProvenance>;
export type SpreadsheetCellProvenance = z.infer<typeof SpreadsheetCellProvenance>;
export type TimeSeriesRangeProvenance = z.infer<typeof TimeSeriesRangeProvenance>;
export type SiteObservationProvenance = z.infer<typeof SiteObservationProvenance>;

/** The columns a fact or extracted field carries, whatever its provenance type. */
export interface ProvenanceColumns {
  provenance_type?: string | null;
  provenance?: unknown;
  document_id?: string | null;
  page?: number | null;
  bbox?: unknown;
  source_text?: string | null;
}

/**
 * Rebuild the typed provenance from a stored row. Returns null when the row
 * does not satisfy its own type, which callers treat as "no provenance".
 * Rows from before migration 0013 have no `provenance_type` and are page evidence.
 */
export function provenanceFromColumns(row: ProvenanceColumns): Provenance | null {
  const type = (row.provenance_type ?? "document_page") as string;
  if (type === "document_page") {
    const parsed = DocumentPageProvenance.safeParse({
      type,
      documentId: row.document_id ?? undefined,
      page: row.page ?? undefined,
      bbox: row.bbox,
      sourceText: row.source_text ?? undefined,
    });
    return parsed.success ? parsed.data : null;
  }
  if (!isProvenanceType(type)) return null;
  const payload =
    typeof row.provenance === "object" && row.provenance !== null && !Array.isArray(row.provenance)
      ? (row.provenance as Record<string, unknown>)
      : {};
  const parsed = FactProvenanceSchema.safeParse({
    ...payload,
    type,
    ...(type === "spreadsheet_cell" || type === "time_series_range"
      ? { documentId: payload.documentId ?? row.document_id ?? undefined }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function isProvenanceType(value: unknown): value is ProvenanceType {
  return typeof value === "string" && (PROVENANCE_TYPES as readonly string[]).includes(value);
}

export function hasProvenance(row: ProvenanceColumns): boolean {
  return provenanceFromColumns(row) !== null;
}

/**
 * Split typed provenance into the columns to insert. Page evidence stays in the
 * legacy columns and leaves `provenance` null, so one value never lives in two
 * places.
 */
export function provenanceToColumns(p: Provenance): {
  provenance_type: ProvenanceType;
  provenance: Record<string, unknown> | null;
  document_id: string | null;
  page: number | null;
  bbox: unknown;
  source_text: string | null;
} {
  switch (p.type) {
    case "document_page":
      return {
        provenance_type: p.type,
        provenance: null,
        document_id: p.documentId ?? null,
        page: p.page,
        bbox: p.bbox,
        source_text: p.sourceText,
      };
    case "spreadsheet_cell": {
      const { type: _t, documentId, ...rest } = p;
      void _t;
      return {
        provenance_type: p.type,
        provenance: rest,
        document_id: documentId,
        page: null,
        bbox: null,
        source_text: null,
      };
    }
    case "time_series_range": {
      const { type: _t, documentId, ...rest } = p;
      void _t;
      return {
        provenance_type: p.type,
        provenance: rest,
        document_id: documentId,
        page: null,
        bbox: null,
        source_text: null,
      };
    }
    case "site_observation": {
      const { type: _t, ...rest } = p;
      void _t;
      return {
        provenance_type: p.type,
        provenance: rest,
        document_id: null,
        page: null,
        bbox: null,
        source_text: null,
      };
    }
  }
}

export interface ProvenanceDescription {
  type: ProvenanceType;
  label: string;
  /** One line a reviewer can read: where the value came from. */
  detail: string;
}

/** Plain-language source of a value, for ledgers, queues and report labels. */
export function describeProvenance(p: Provenance): ProvenanceDescription {
  const label = PROVENANCE_LABEL[p.type];
  switch (p.type) {
    case "document_page":
      return { type: p.type, label, detail: `Page ${p.page}: "${p.sourceText}"` };
    case "spreadsheet_cell":
      return {
        type: p.type,
        label,
        detail: `${p.sheet}!${p.cellRef} = ${p.value === null ? "(empty)" : String(p.value)}${
          p.formula ? ` (formula ${p.formula})` : ""
        }`,
      };
    case "time_series_range":
      return {
        type: p.type,
        label,
        detail: `${p.tag}, ${p.aggregation} of ${p.rowCount} rows, ${p.start} to ${p.end}`,
      };
    case "site_observation":
      return {
        type: p.type,
        label,
        detail: `Observed by ${p.observer} on ${p.timestamp}${
          p.evidenceFileIds.length ? `, ${p.evidenceFileIds.length} evidence file(s)` : ""
        }`,
      };
  }
}

/** Short label for a calculation input's provenance, or undefined if the row has none. */
export function factLabel(row: ProvenanceColumns): string | undefined {
  const p = provenanceFromColumns(row);
  if (!p) return undefined;
  return p.type === "document_page" ? p.sourceText : describeProvenance(p).detail;
}
