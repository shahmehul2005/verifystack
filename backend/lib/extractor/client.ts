import "server-only";

import { z } from "zod";

import { isExtractorConfigured } from "@verifystack/backend/lib/supabase/configured";

/**
 * HTTP client for the Python Extractor_Service (`services/extractor/`).
 *
 * The Zod schemas mirror `services/extractor/models.py`. Every object is strict except
 * `run`, so the service can add audit keys without breaking the client. A response that
 * fails validation returns `invalid_response` and no data.
 *
 * Error messages are fixed strings plus the status and the service's own `code` and
 * `category`. They never contain the key, the URL, or other response text.
 */

export { isExtractorConfigured };

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const SourceTypeSchema = z.enum(["sourcing", "corroboration", "proforma"]);
export type ExtractorSourceType = z.infer<typeof SourceTypeSchema>;

const NormalizedBBoxSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const ProvenanceSchema = z.strictObject({
  page: z.number().int().min(1).nullable(),
  bbox: NormalizedBBoxSchema.nullable(),
  sheet: z.string().nullable(),
  cell: z.string().nullable(),
  source_text: z.string().min(1),
  formula: z.string().nullable(),
});

const PeriodSchema = z.strictObject({
  kind: z.enum(["daily", "monthly", "annual"]),
  month_key: z.string(),
  date: z.string().nullable(),
});

export const ReadingSchema = z.strictObject({
  raw_id: z.string(),
  label: z.string().nullable(),
  stream_key: z.string(),
  period: PeriodSchema,
  source_type: SourceTypeSchema,
  source: z.enum(["excel", "csv", "pdf"]),
  value_as_stated: z.string(),
  unit_as_stated: z.string().nullable(),
  value: z.number(),
  normalized_value: z.number().nullable(),
  normalized_unit: z.string(),
  verified: z.boolean(),
  needs_review: z.boolean(),
  derived: z.boolean(),
  unit_assumed: z.boolean(),
  regulatory: z.boolean(),
  mapping_source: z.enum(["key", "phrase", "title", "llm", "proforma_label"]),
  confidence: z.number().min(0).max(1),
  review_reasons: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type ExtractorReading = z.infer<typeof ReadingSchema>;

export const ExtractedFieldSchema = z.strictObject({
  path: z.string(),
  kind: z.enum(["number", "measure", "date", "enum", "string"]),
  value: z.union([z.number(), z.string()]).nullable(),
  unit_as_printed: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
  needs_review: z.boolean(),
  regulatory: z.boolean(),
  review_reasons: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type ExtractorField = z.infer<typeof ExtractedFieldSchema>;

const WarningSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  raw_id: z.string().nullable().optional(),
});
export type ExtractorWarning = z.infer<typeof WarningSchema>;

const SkippedItemSchema = z.strictObject({
  raw_id: z.string().nullable(),
  label: z.string().nullable(),
  reason: z.string(),
  detail: z.string().nullable(),
});

/** Tolerates extra keys so the service can extend the audit block. */
export const RunSchema = z.looseObject({
  model: z.string(),
  model_calls: z.number().int().min(0),
  prompt_version: z.string(),
  input_hash: z.string(),
  duration_ms: z.number().int().min(0),
});
export type ExtractorRun = z.infer<typeof RunSchema>;

const FileInfoSchema = z.strictObject({
  name: z.string(),
  format: z.enum(["xlsx", "xls", "csv", "pdf"]),
  size_bytes: z.number().int().min(0),
  sha256: z.string(),
});

const ClassificationSchema = z.strictObject({
  doc_type: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export const CalendarResponseSchema = z.strictObject({
  ok: z.literal(true),
  file: FileInfoSchema,
  readings: z.array(ReadingSchema),
  skipped: z.array(SkippedItemSchema),
  unmapped: z.array(z.string()),
  warnings: z.array(WarningSchema),
  run: RunSchema,
});
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;

export const FieldsResponseSchema = z.strictObject({
  ok: z.literal(true),
  fields: z.array(ExtractedFieldSchema),
  warnings: z.array(WarningSchema),
  run: RunSchema,
});
export type FieldsResponse = z.infer<typeof FieldsResponseSchema>;

export const ClassifyResponseSchema = z.strictObject({
  ok: z.literal(true),
  classification: ClassificationSchema,
  run: RunSchema,
});
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

export const BatchClassifyResponseSchema = z.strictObject({
  ok: z.literal(true),
  items: z.array(
    z.strictObject({
      index: z.number().int().min(0),
      classification: ClassificationSchema.nullable(),
      error: z.string().nullable(),
    }),
  ),
  run: RunSchema,
});
export type BatchClassifyResponse = z.infer<typeof BatchClassifyResponseSchema>;

export const HealthSchema = z.strictObject({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  gemini_configured: z.boolean(),
  model: z.string(),
  // Added with the selectable provider. Optional so an older service still parses.
  provider: z.string().optional(),
  model_configured: z.boolean().optional(),
});
export type Health = z.infer<typeof HealthSchema>;

// ---------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------

export type ExtractorErrorKind =
  | "not_configured"
  | "timeout"
  | "auth"
  | "too_large"
  | "unsupported"
  | "unprocessable"
  | "model_unavailable"
  | "service"
  | "invalid_response";

export class ExtractorError extends Error {
  constructor(
    readonly kind: ExtractorErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly category?: string,
  ) {
    super(message);
    this.name = "ExtractorError";
  }
}

export type ExtractorResult<T> = { ok: true; data: T } | { ok: false; error: ExtractorError };

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

type FileBytes = Uint8Array | ArrayBuffer | Blob;

export type ExtractorFile = { bytes: FileBytes; filename: string; mimeType?: string };

type Common = { timeoutMs?: number };

export type DocTypeOption = { id: string; label: string; notes?: string | null };
export type CatalogueEntry = {
  path: string;
  kind: "number" | "measure" | "date" | "enum" | "string";
  options?: string[] | null;
  regulatory?: boolean;
};

export type ClassifyInput = Common & {
  file: ExtractorFile;
  allowedDocTypes: DocTypeOption[];
  pageNumber?: number;
};
export type ClassifyBatchInput = Common & {
  files: ExtractorFile[];
  allowedDocTypes: DocTypeOption[];
};
export type ExtractFieldsInput = Common & {
  file: ExtractorFile;
  docType: string;
  catalogue: CatalogueEntry[];
  pageNumber?: number;
};
export type CalendarInput = Common & {
  file: ExtractorFile;
  complianceYear?: string | null;
  sourceType?: ExtractorSourceType;
  layout?: "auto" | "proforma" | "tabular";
};

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const TIMEOUT_MS = {
  health: 15_000,
  template: 15_000,
  classify: 30_000,
  classifyBatch: 60_000,
  extractFields: 120_000,
  extractCalendar: 120_000,
} as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function fail<T>(
  kind: ExtractorErrorKind,
  message: string,
  extra: { status?: number; code?: string; category?: string } = {},
): ExtractorResult<T> {
  return { ok: false, error: new ExtractorError(kind, message, extra.status, extra.code, extra.category) };
}

/** `https://` for any host, `http://` for loopback only (D10). Returns null otherwise. */
function resolveBase(): { base: URL; key: string } | null {
  if (!isExtractorConfigured()) return null;
  const raw = process.env.EXTRACTOR_URL ?? "";
  const key = process.env.EXTRACTOR_API_KEY ?? "";
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return null;
  }
  const secure = base.protocol === "https:";
  const loopbackHttp = base.protocol === "http:" && LOOPBACK_HOSTS.has(base.hostname);
  if (!secure && !loopbackHttp) return null;
  return { base, key };
}

const NOT_CONFIGURED = "The extractor service is not configured (EXTRACTOR_URL, EXTRACTOR_API_KEY)";

/** Keep only a short, identifier-like token from the service's own envelope. */
function token(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

async function errorFromResponse<T>(res: Response): Promise<ExtractorResult<T>> {
  let code: string | undefined;
  let category: string | undefined;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error?: unknown }).error;
      if (err && typeof err === "object") {
        code = token((err as { code?: unknown }).code);
        category = token((err as { category?: unknown }).category);
      }
    }
  } catch {
    // A non-JSON body carries nothing we may show.
  }
  const status = res.status;
  let kind: ExtractorErrorKind;
  if (status === 401) kind = "auth";
  else if (status === 413) kind = "too_large";
  else if (status === 415) kind = "unsupported";
  else if (status === 422) kind = "unprocessable";
  else if (status === 503 && code === "gemini_key_missing") kind = "model_unavailable";
  else kind = "service";
  const message =
    `Extractor service returned ${status}` + (code ? ` (${code}${category ? `/${category}` : ""})` : "");
  return fail(kind, message, { status, code, category });
}

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

async function send(
  method: "GET" | "POST",
  path: string,
  timeoutMs: number,
  body?: FormData,
): Promise<{ ok: true; res: Response } | { ok: false; error: ExtractorError }> {
  const cfg = resolveBase();
  if (!cfg) return { ok: false, error: new ExtractorError("not_configured", NOT_CONFIGURED) };
  try {
    const res = await fetch(new URL(path, cfg.base), {
      method,
      headers: { "X-Extractor-Key": cfg.key },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    return { ok: true, res };
  } catch (e) {
    if (isTimeout(e)) {
      return { ok: false, error: new ExtractorError("timeout", "The extractor service timed out") };
    }
    return { ok: false, error: new ExtractorError("service", "The extractor service could not be reached") };
  }
}

async function requestJson<S extends z.ZodType>(
  method: "GET" | "POST",
  path: string,
  timeoutMs: number,
  schema: S,
  body?: FormData,
): Promise<ExtractorResult<z.infer<S>>> {
  const sent = await send(method, path, timeoutMs, body);
  if (!sent.ok) return { ok: false, error: sent.error };
  const { res } = sent;
  if (!res.ok) return errorFromResponse(res);
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    if (isTimeout(e)) return fail("timeout", "The extractor service timed out");
    return fail("invalid_response", "The extractor service returned a response that is not valid JSON", {
      status: res.status,
    });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return fail("invalid_response", "The extractor service response did not match the expected shape", {
      status: res.status,
    });
  }
  return { ok: true, data: parsed.data };
}

function appendFile(form: FormData, name: string, file: ExtractorFile): void {
  const blob =
    file.bytes instanceof Blob
      ? file.bytes
      : new Blob([file.bytes as BlobPart], { type: file.mimeType ?? "application/octet-stream" });
  form.append(name, blob, file.filename);
}

function filenameFrom(disposition: string | null): string {
  const match = disposition ? /filename="?([A-Za-z0-9_.-]{1,120})"?/.exec(disposition) : null;
  return match?.[1] ?? "verifystack_calendar_template.xlsx";
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const extractorClient = {
  health(opts: Common = {}): Promise<ExtractorResult<Health>> {
    return requestJson("GET", "/health", opts.timeoutMs ?? TIMEOUT_MS.health, HealthSchema);
  },

  classify(input: ClassifyInput): Promise<ExtractorResult<ClassifyResponse>> {
    const form = new FormData();
    appendFile(form, "file", input.file);
    form.append("allowed_doc_types", JSON.stringify(input.allowedDocTypes));
    form.append("page_number", String(input.pageNumber ?? 1));
    return requestJson(
      "POST",
      "/v1/classify",
      input.timeoutMs ?? TIMEOUT_MS.classify,
      ClassifyResponseSchema,
      form,
    );
  },

  classifyBatch(input: ClassifyBatchInput): Promise<ExtractorResult<BatchClassifyResponse>> {
    const form = new FormData();
    for (const file of input.files) appendFile(form, "files", file);
    form.append("allowed_doc_types", JSON.stringify(input.allowedDocTypes));
    return requestJson(
      "POST",
      "/v1/classify-batch",
      input.timeoutMs ?? TIMEOUT_MS.classifyBatch,
      BatchClassifyResponseSchema,
      form,
    );
  },

  extractFields(input: ExtractFieldsInput): Promise<ExtractorResult<FieldsResponse>> {
    const form = new FormData();
    appendFile(form, "file", input.file);
    form.append("doc_type", input.docType);
    form.append("catalogue", JSON.stringify(input.catalogue));
    form.append("page_number", String(input.pageNumber ?? 1));
    return requestJson(
      "POST",
      "/v1/extract-fields",
      input.timeoutMs ?? TIMEOUT_MS.extractFields,
      FieldsResponseSchema,
      form,
    );
  },

  extractCalendar(input: CalendarInput): Promise<ExtractorResult<CalendarResponse>> {
    const form = new FormData();
    appendFile(form, "file", input.file);
    if (input.complianceYear) form.append("compliance_year", input.complianceYear);
    if (input.sourceType) form.append("source_type", input.sourceType);
    if (input.layout) form.append("layout", input.layout);
    return requestJson(
      "POST",
      "/v1/extract-calendar",
      input.timeoutMs ?? TIMEOUT_MS.extractCalendar,
      CalendarResponseSchema,
      form,
    );
  },

  async template(
    year: string,
    opts: Common = {},
  ): Promise<ExtractorResult<{ bytes: ArrayBuffer; filename: string }>> {
    const path = `/v1/template?year=${encodeURIComponent(year)}`;
    const sent = await send("GET", path, opts.timeoutMs ?? TIMEOUT_MS.template);
    if (!sent.ok) return { ok: false, error: sent.error };
    const { res } = sent;
    if (!res.ok) return errorFromResponse(res);
    try {
      const bytes = await res.arrayBuffer();
      return { ok: true, data: { bytes, filename: filenameFrom(res.headers.get("content-disposition")) } };
    } catch (e) {
      if (isTimeout(e)) return fail("timeout", "The extractor service timed out");
      return fail("service", "The extractor service response could not be read", { status: res.status });
    }
  },
};
