/**
 * Classify + extract one stored document and persist suggested fields.
 * Used by the upload path and by Inngest. No sector branches — pack taxonomy only.
 *
 * Multi-page PDFs are split (Process 2.0) then each sheet is classified/extracted
 * with its original page number stamped on provenance. A one-page PDF sent to
 * Gemini always reports page 1; we remap.
 */

import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack } from "@verifystack/backend/domain/packs";
import {
  CONFIDENCE_POLICY,
  DOC_SCHEMAS,
  isExtractable,
  triageFields,
  type Classification,
  type DocType,
} from "./schemas";
import { provenanceGate } from "./provenance";
import { GeminiExtractionProvider } from "./gemini";
import { isGeminiConfigured } from "@verifystack/backend/lib/supabase/configured";
import { qualifyExtractedFieldPaths } from "./fieldPaths";
import { chooseRoute } from "./digital";
import {
  PageSplitError,
  documentPageInserts,
  mapLimit,
  splitEvidencePages,
  type SplitPage,
} from "./pages";
import type { Json } from "@verifystack/backend/lib/supabase/types";
import type { AiActionLog, DocumentPage, ExtractionResult } from "./provider";

const EXTRACT_CONCURRENCY = 3;

export interface RunDocumentExtractionInput {
  organizationId: string;
  engagementId: string;
  documentId: string;
  packId: string;
}

export interface RunDocumentExtractionResult {
  ok: boolean;
  jobId?: string;
  docType?: string;
  extracted: number;
  dropped: number;
  pages?: number;
  error?: string;
}

function flattenProvenanced(
  payload: unknown,
  prefix = ""
): Array<{
  fieldPath: string;
  value: unknown;
  unit?: string;
  confidence: number;
  page?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  sourceText?: string;
}> {
  const out: ReturnType<typeof flattenProvenanced> = [];
  if (payload === null || typeof payload !== "object") return out;
  if (Array.isArray(payload)) {
    payload.forEach((item, i) => {
      out.push(...flattenProvenanced(item, prefix ? `${prefix}.${i}` : String(i)));
    });
    return out;
  }
  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (raw === null || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    if (typeof node.confidence === "number" && node.provenance) {
      const prov = node.provenance as {
        page?: number;
        bbox?: { x: number; y: number; width: number; height: number };
        sourceText?: string;
      };
      out.push({
        fieldPath: path,
        value: node.value,
        unit: typeof node.unitAsPrinted === "string" ? node.unitAsPrinted : undefined,
        confidence: node.confidence,
        page: prov.page,
        bbox: prov.bbox,
        sourceText: prov.sourceText,
      });
    } else {
      out.push(...flattenProvenanced(node, path));
    }
  }
  return out;
}

function asPageMime(mime: string): "image/png" | "image/jpeg" | "application/pdf" | null {
  if (mime === "image/png" || mime === "image/jpeg" || mime === "application/pdf") return mime;
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "image/webp") return "image/png";
  return null;
}

function toDocumentPage(split: SplitPage, evidenceId: string): DocumentPage {
  return {
    evidenceId,
    pageNumber: split.pageNumber,
    mimeType: split.mimeType,
    data: Buffer.from(split.bytes).toString("base64"),
  };
}

function classificationScore(result: ExtractionResult<Classification>): number {
  if (!result.ok || !result.data) return 0;
  if (result.data.docType === "unknown") return result.data.confidence * 0.1;
  return result.data.confidence;
}

export async function runDocumentExtraction(
  input: RunDocumentExtractionInput
): Promise<RunDocumentExtractionResult> {
  const admin = createServiceClient();
  if (!admin) return { ok: false, extracted: 0, dropped: 0, error: "Supabase service role is not configured" };

  const { data: doc } = await admin.from("documents").select("*").eq("id", input.documentId).single();
  if (!doc) return { ok: false, extracted: 0, dropped: 0, error: "Document not found" };

  const route = chooseRoute(0, doc.mime_type);
  const { data: job, error: jobErr } = await admin
    .from("extraction_jobs")
    .insert({
      organization_id: input.organizationId,
      document_id: input.documentId,
      status: "running",
      route,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return { ok: false, extracted: 0, dropped: 0, error: jobErr?.message ?? "Could not create extraction job" };
  }

  if (!isGeminiConfigured()) {
    await admin
      .from("extraction_jobs")
      .update({
        status: "failed",
        error: "GEMINI_API_KEY is not set.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return {
      ok: false,
      jobId: job.id,
      extracted: 0,
      dropped: 0,
      error: "Gemini is not configured, so nothing can be read off the page.",
    };
  }

  const mime = asPageMime(doc.mime_type);
  if (!mime) {
    await admin
      .from("extraction_jobs")
      .update({
        status: "failed",
        error: `Unsupported mime type ${doc.mime_type}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return {
      ok: false,
      jobId: job.id,
      extracted: 0,
      dropped: 0,
      error: `Cannot extract ${doc.mime_type}. Use PDF, PNG, or JPEG.`,
    };
  }

  try {
    loadPack(input.packId);
    const { data: file, error: fileErr } = await admin.storage.from("evidence").download(doc.storage_path);
    if (fileErr || !file) throw new Error(fileErr?.message ?? "Storage object missing");

    const buf = Buffer.from(await file.arrayBuffer());
    const pages = await splitEvidencePages(buf, doc.mime_type);

    await admin.from("document_pages").upsert(
      documentPageInserts(input.organizationId, input.documentId, pages.length, doc.storage_path),
      { onConflict: "document_id,page_number" }
    );
    await admin.from("documents").update({ page_count: pages.length }).eq("id", input.documentId);

    const provider = new GeminiExtractionProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: process.env.GEMINI_MODEL || undefined,
    });

    const classified = await classifyBestPage(provider, pages, doc.sha256, admin, input.organizationId);

    if (!classified.ok || !classified.data) {
      await admin
        .from("extraction_jobs")
        .update({
          status: "failed",
          error: classified.validationErrors?.join("; ") ?? classified.log.error ?? "classify failed",
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return {
        ok: false,
        jobId: job.id,
        extracted: 0,
        dropped: 0,
        pages: pages.length,
        error: classified.validationErrors?.length
          ? `Classification failed. ${classified.validationErrors.slice(0, 4).join("; ")}`
          : classified.log.error
            ? `Classification failed. ${classified.log.error}`
            : "Classification failed. The model could not identify this document type.",
      };
    }

    const docType = classified.data.docType as DocType;
    await admin
      .from("documents")
      .update({
        doc_type: docType,
        classification_confidence: classified.data.confidence,
      })
      .eq("id", input.documentId);

    if (!isExtractable(docType)) {
      await admin
        .from("extraction_jobs")
        .update({
          status: "done",
          error: null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return {
        ok: true,
        jobId: job.id,
        docType,
        extracted: 0,
        dropped: 0,
        pages: pages.length,
        error: `Classified as ${docType}, which has no field schema yet.`,
      };
    }

    const pageResults = await mapLimit(pages, EXTRACT_CONCURRENCY, async (split) => {
      const extracted = await provider.extract(
        toDocumentPage(split, doc.sha256),
        docType,
        DOC_SCHEMAS[docType]
      );
      await insertAiLog(admin, input.organizationId, extracted.log);
      return { split, extracted };
    });

    let dropped = 0;
    let saved = 0;
    let extractFailures = 0;
    for (const { split, extracted } of pageResults) {
      if (!extracted.ok || !extracted.data) {
        extractFailures += 1;
        continue;
      }
      const triage = triageFields(extracted.data);
      const flat = qualifyExtractedFieldPaths(flattenProvenanced(extracted.data)).map((field) => ({
        ...field,
        page: split.pageNumber,
      }));
      for (const field of flat) {
        const gate = provenanceGate({
          fieldPath: field.fieldPath,
          page: field.page,
          bbox: field.bbox,
          sourceText: field.sourceText,
        });
        if (!gate.ok) {
          dropped += 1;
          await admin.rpc("append_audit_event", {
            p_organization_id: input.organizationId,
            p_action: "extraction.dropped_no_provenance",
            p_entity_type: "extracted_field",
            p_entity_id: input.documentId,
            p_payload: { fieldPath: field.fieldPath, page: split.pageNumber, reason: gate.reason },
          });
          continue;
        }
        const leaf = field.fieldPath.split(".").pop() ?? field.fieldPath;
        const decision = triage.find((t) => t.fieldPath === field.fieldPath);
        const highMat = CONFIDENCE_POLICY.alwaysReview.has(leaf);
        const action =
          highMat || decision?.action === "human_review" ? "human_review" : "auto_commit";
        const { error: insErr } = await admin.from("extracted_fields").insert({
          organization_id: input.organizationId,
          extraction_job_id: job.id,
          document_id: input.documentId,
          engagement_id: input.engagementId,
          field_path: field.fieldPath,
          value_json: field.value as Json,
          unit: field.unit ?? null,
          confidence: field.confidence,
          page: split.pageNumber,
          bbox: gate.bbox,
          source_text: gate.sourceText,
          triage_action: action,
          state: "suggested",
        });
        if (insErr) throw new Error(insErr.message);
        saved += 1;
      }
    }

    if (saved === 0 && extractFailures === pages.length) {
      const firstErr = pageResults.find((r) => !r.extracted.ok);
      await admin
        .from("extraction_jobs")
        .update({
          status: "failed",
          error:
            firstErr?.extracted.validationErrors?.join("; ") ??
            firstErr?.extracted.log.error ??
            "extract failed on every page",
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return {
        ok: false,
        jobId: job.id,
        docType,
        extracted: 0,
        dropped,
        pages: pages.length,
        error: firstErr?.extracted.validationErrors?.length
          ? `Field extraction failed schema validation. ${firstErr.extracted.validationErrors.slice(0, 4).join("; ")}`
          : "Field extraction failed schema validation on every page.",
      };
    }

    await admin
      .from("extraction_jobs")
      .update({
        status: "done",
        error: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return { ok: true, jobId: job.id, docType, extracted: saved, dropped, pages: pages.length };
  } catch (error) {
    const message =
      error instanceof PageSplitError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Extraction failed";
    await admin
      .from("extraction_jobs")
      .update({
        status: "failed",
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return { ok: false, jobId: job.id, extracted: 0, dropped: 0, error: message };
  }
}

async function classifyBestPage(
  provider: GeminiExtractionProvider,
  pages: SplitPage[],
  evidenceId: string,
  admin: NonNullable<ReturnType<typeof createServiceClient>>,
  organizationId: string
): Promise<ExtractionResult<Classification>> {
  const first = await provider.classify(toDocumentPage(pages[0]!, evidenceId));
  await insertAiLog(admin, organizationId, first.log);
  if (classificationScore(first) >= 0.5) return first;
  if (!pages[1]) return first;
  const second = await provider.classify(toDocumentPage(pages[1], evidenceId));
  await insertAiLog(admin, organizationId, second.log);
  return classificationScore(second) > classificationScore(first) ? second : first;
}

async function insertAiLog(
  admin: NonNullable<ReturnType<typeof createServiceClient>>,
  organizationId: string,
  log: AiActionLog
) {
  await admin.from("ai_action_logs").insert({
    organization_id: organizationId,
    tool: log.tool,
    provider: log.provider,
    model: log.model,
    prompt_version: log.promptVersion,
    input_hash: log.inputHash,
    evidence_id: log.evidenceId,
    page_number: log.pageNumber,
    started_at: log.startedAt,
    duration_ms: log.durationMs,
    raw_output: log.rawOutput,
    ok: log.ok,
    error: log.error ?? null,
  });
}
