/**
 * Extraction provider backed by the Python Extractor_Service.
 *
 * The service returns flat fields keyed by path. This provider rebuilds the nested
 * provenanced shape and runs it through `softenExtraction` and the Zod `DOC_SCHEMAS`
 * schema, so the persistence layer (provenanceGate, extracted_fields, CEV, ai_action_logs)
 * sees the same shape the Gemini provider produced. No model output becomes a number
 * here beyond the values the service reports with provenance; nothing is computed.
 */

import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  extractorClient,
  type ExtractorErrorKind,
  type ExtractorField,
  type ExtractorRun,
} from "@verifystack/backend/lib/extractor/client";
import { fieldCatalogue } from "./fieldCatalogue";
import {
  ClassificationSchema,
  CONFIDENCE_POLICY,
  type Classification,
  type DocType,
} from "./schemas";
import { validate } from "./validate";
import type {
  AiActionLog,
  BatchClassifyResult,
  DocumentPage,
  ExtractionProvider,
  ExtractionResult,
  TaxonomyOption,
} from "./provider";

export const PROVIDER_NAME = "extractor-service";
const FALLBACK_PROMPT_VERSION = "extractor-service";
const FULL_PAGE = { x: 0, y: 0, width: 1, height: 1 };
const REVIEW_CAP = CONFIDENCE_POLICY.reviewBelow - 0.01;

type Client = typeof extractorClient;

const EXTENSIONS: Record<DocumentPage["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

function fileOf(page: DocumentPage) {
  const safeId = page.evidenceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "page";
  return {
    bytes: new Uint8Array(Buffer.from(page.data, "base64")),
    filename: `${safeId}-p${page.pageNumber}.${EXTENSIONS[page.mimeType]}`,
    mimeType: page.mimeType,
  };
}

function hashPages(pages: DocumentPage[]): string {
  const hash = createHash("sha256");
  for (const p of pages) hash.update(p.evidenceId).update(String(p.pageNumber)).update(p.data);
  return hash.digest("hex");
}

function toOptions(options: TaxonomyOption[]) {
  return options.map((o) => ({ id: o.id, label: o.label, ...(o.notes ? { notes: o.notes } : {}) }));
}

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

/** Split `lines.0.description` or `lines[0].description` into segments. `*` is not a concrete index. */
function segmentsOf(path: string): (string | number)[] | null {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter((s) => s !== "");
  if (parts.length === 0 || parts.includes("*")) return null;
  return parts.map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

function leafOf(field: ExtractorField, page: DocumentPage): Record<string, unknown> | null {
  if (field.value === null) return null;
  // The bytes sent are a single page, so the page number is the caller's, not the service's.
  const leaf: Record<string, unknown> = {
    value: field.value,
    confidence:
      field.needs_review || field.regulatory
        ? Math.min(field.confidence, REVIEW_CAP)
        : field.confidence,
    provenance: {
      page: page.pageNumber,
      bbox: field.provenance.bbox ?? FULL_PAGE,
      sourceText: field.provenance.source_text,
    },
  };
  if (field.kind === "measure") leaf.unitAsPrinted = field.unit_as_printed ?? "";
  return leaf;
}

/** Build the nested provenanced payload from the service's flat fields. */
export function rebuildPayload(fields: ExtractorField[], page: DocumentPage): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const field of fields) {
    const segs = segmentsOf(field.path);
    if (!segs || typeof segs[0] !== "string") continue;
    const leaf = leafOf(field, page);

    let node: Record<string, unknown> | unknown[] = root;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      const next = typeof segs[i + 1] === "number" ? [] : {};
      const slot = node as Record<string | number, unknown>;
      const existing = slot[seg];
      if (existing === undefined || existing === null) {
        slot[seg] = next;
      } else if (typeof existing !== "object") {
        ok = false;
        break;
      }
      node = slot[seg] as Record<string, unknown> | unknown[];
    }
    if (!ok) continue;
    (node as Record<string | number, unknown>)[segs[segs.length - 1]] = leaf;
  }
  return root;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ExtractorServiceProvider implements ExtractionProvider {
  readonly name = PROVIDER_NAME;
  readonly model: string;

  constructor(private readonly client: Client = extractorClient) {
    this.model = process.env.EXTRACTOR_MODEL || "gemini-2.5-flash";
  }

  private baseLog(
    tool: AiActionLog["tool"],
    page: DocumentPage,
    inputHash: string,
    evidenceId = page.evidenceId,
  ): AiActionLog {
    return {
      tool,
      provider: this.name,
      model: this.model,
      promptVersion: FALLBACK_PROMPT_VERSION,
      inputHash,
      evidenceId,
      pageNumber: page.pageNumber,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      rawOutput: "",
      ok: false,
    };
  }

  private okLog(base: AiActionLog, run: ExtractorRun, rawOutput: unknown): AiActionLog {
    return {
      ...base,
      model: run.model,
      promptVersion: run.prompt_version,
      inputHash: run.input_hash,
      durationMs: run.duration_ms,
      rawOutput: JSON.stringify(rawOutput),
      ok: true,
    };
  }

  private failLog(base: AiActionLog, kind: ExtractorErrorKind, started: number): AiActionLog {
    return { ...base, durationMs: Date.now() - started, ok: false, error: kind };
  }

  async classify(
    page: DocumentPage,
    options?: { allowedDocTypes?: TaxonomyOption[] },
  ): Promise<ExtractionResult<Classification>> {
    const base = this.baseLog("classify_document", page, hashPages([page]));
    const started = Date.now();
    const res = await this.client.classify({
      file: fileOf(page),
      allowedDocTypes: toOptions(options?.allowedDocTypes ?? []),
    });
    if (!res.ok) return { ok: false, log: this.failLog(base, res.error.kind, started) };

    const { classification, run } = res.data;
    const log = this.okLog(base, run, res.data);
    return validate(
      ClassificationSchema,
      JSON.stringify({
        docType: classification.doc_type,
        confidence: classification.confidence,
        reasoning: classification.reasoning.slice(0, 500),
      }),
      log,
      { soften: false },
    );
  }

  async classifyBatch(
    pages: DocumentPage[],
    options: { allowedDocTypes: TaxonomyOption[] },
  ): Promise<BatchClassifyResult> {
    const empty = pages.map(() => null);
    const evidenceId = `batch:${createHash("sha256")
      .update(pages.map((p) => p.evidenceId).join(","))
      .digest("hex")
      .slice(0, 16)}`;
    const base = this.baseLog(
      "classify_batch",
      { evidenceId, pageNumber: 1 } as DocumentPage,
      hashPages(pages),
      evidenceId,
    );
    const started = Date.now();
    const res = await this.client.classifyBatch({
      files: pages.map(fileOf),
      allowedDocTypes: toOptions(options.allowedDocTypes),
    });
    if (!res.ok) {
      return {
        ok: false,
        items: empty,
        errors: [res.error.message],
        log: this.failLog(base, res.error.kind, started),
      };
    }

    const allowed = new Set([...options.allowedDocTypes.map((t) => t.id), "unknown"]);
    const items: (Classification | null)[] = pages.map(() => null);
    const errors: string[] = [];
    for (const item of res.data.items) {
      if (item.index < 0 || item.index >= pages.length) {
        errors.push(`Result index ${item.index} is out of range`);
        continue;
      }
      if (!item.classification) {
        errors.push(`Document ${item.index + 1}: ${item.error ?? "no answer"}`);
        continue;
      }
      const parsed = ClassificationSchema.safeParse({
        docType: item.classification.doc_type,
        confidence: item.classification.confidence,
        reasoning: item.classification.reasoning.slice(0, 500),
      });
      if (!parsed.success) {
        errors.push(`Document ${item.index + 1}: classification failed validation`);
      } else if (!allowed.has(parsed.data.docType)) {
        errors.push(`Document ${item.index + 1}: type is not in the allowed list`);
      } else {
        items[item.index] = parsed.data;
      }
    }

    const answered = items.some((i) => i !== null);
    const log = this.okLog(base, res.data.run, res.data);
    return {
      ok: answered,
      items,
      errors,
      log: answered ? log : { ...log, ok: false, error: errors[0] ?? "no usable answer" },
    };
  }

  async extract<T extends z.ZodTypeAny>(
    page: DocumentPage,
    docType: DocType,
    schema: T,
  ): Promise<ExtractionResult<z.infer<T>>> {
    const base = this.baseLog("extract_fields", page, hashPages([page]));
    const started = Date.now();
    const res = await this.client.extractFields({
      file: fileOf(page),
      docType,
      catalogue: fieldCatalogue(schema),
    });
    if (!res.ok) return { ok: false, log: this.failLog(base, res.error.kind, started) };

    const log = this.okLog(base, res.data.run, res.data);
    const payload = rebuildPayload(res.data.fields, page);
    return validate(schema, JSON.stringify(payload), log, { soften: true });
  }
}
