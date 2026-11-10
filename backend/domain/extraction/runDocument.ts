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
import { inferSlot } from "../deskreview/engine";
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
import { registryForPack } from "../registry";
import { annotateDocument, isMissingRegistryColumn, registryColumns } from "../registry/annotate";
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
import { createCevFromExtraction } from "../evidence";
import type { CevPeriodKind } from "../evidence/types";

/** Derive the CEV period kind from the annotation's period span. */
function cevPeriodKind(
  periodStart: string | null,
  periodEnd: string | null,
  periodStatus: "known" | "unknown" | null
): CevPeriodKind {
  if (!periodStart || !periodEnd || periodStatus !== "known") return "document_period";
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days <= 1) return "single_reading";
  if (days <= 2) return "daily";
  if (days <= 35) return "monthly";
  if (days <= 100) return "quarterly";
  return "annual";
}


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
    const pack = loadPack(input.packId);
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

    let docType: DocType | null = (doc.doc_type as DocType) || null;
    if (!docType && doc.slot && isExtractable(doc.slot as DocType)) {
      docType = doc.slot as DocType;
    }

    if (!docType) {
      const allowedTaxonomy = (pack.document_taxonomy ?? []).map((t) => ({
        id: t.id,
        label: t.label,
        notes: t.notes,
      }));

      const classified = await classifyBestPage(
        provider,
        pages,
        doc.sha256,
        admin,
        input.organizationId,
        allowedTaxonomy
      );

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

      docType = classified.data.docType as DocType;
      const effectiveSlot = doc.slot ?? inferSlot({ name: doc.original_filename, slot: doc.slot, docType });
      await admin
        .from("documents")
        .update({
          doc_type: docType,
          ...(effectiveSlot ? { slot: effectiveSlot } : {}),
          classification_confidence: classified.data.confidence,
        })
        .eq("id", input.documentId);
    }

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

    // The registry key and the reporting period of each field, worked out in code from the whole
    // document (a bill's period may sit on another page than its quantity). Only the cement pack has a
    // registry; any other pack stores exactly what it did before.
    const registry = registryForPack(input.packId);
    const annotations = annotateDocument(
      registry,
      docType,
      pageResults.flatMap(({ extracted }) =>
        extracted.ok && extracted.data
          ? qualifyExtractedFieldPaths(flattenProvenanced(extracted.data)).map((f) => ({ fieldPath: f.fieldPath, value: f.value }))
          : []
      )
    );
    // A database that has not had migration 0025 applied has no registry columns. Fall back to the old
    // insert once, rather than fail an extraction over an annotation.
    let registryColumnsAvailable = true;

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
        const row = {
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
          triage_action: action as "human_review" | "auto_commit",
          state: "suggested" as const,
        };
        const annotation = registryColumnsAvailable ? annotations.get(field.fieldPath) : undefined;
        let insertedFieldId: string | undefined;
        let { data: insertedRow, error: insErr } = await admin.from("extracted_fields").insert(annotation ? { ...row, ...registryColumns(annotation) } : row).select("id").single();
        if (!insErr && insertedRow) insertedFieldId = insertedRow.id;
        if (insErr && annotation && isMissingRegistryColumn(insErr)) {
          registryColumnsAvailable = false;
          ({ data: insertedRow, error: insErr } = await admin.from("extracted_fields").insert(row).select("id").single());
          if (!insErr && insertedRow) insertedFieldId = insertedRow.id;
        }
        if (insErr) throw new Error(insErr.message);
        saved += 1;

        // Wire CEV: if this field mapped to a registry entry, create a suggested CEV.
        // We do NOT block extraction on CEV failure -- wrap in try/catch.
        if (annotation?.canonicalKey && insertedFieldId) {
          try {
            const pk = cevPeriodKind(annotation.periodStart, annotation.periodEnd, annotation.periodStatus);
            const rawNum =
              typeof field.value === "number"
                ? field.value
                : typeof field.value === "string"
                  ? Number(field.value)
                  : null;
            const valueNumeric = rawNum !== null && isFinite(rawNum) ? rawNum : undefined;
            await createCevFromExtraction({
              organization_id: input.organizationId,
              engagement_id: input.engagementId,
              canonical_key: annotation.canonicalKey,
              registry_version: annotation.registryVersion ?? "unknown",
              document_id: input.documentId,
              extracted_field_id: insertedFieldId,
              period_kind: pk,
              period_start: annotation.periodStart ?? undefined,
              period_end: annotation.periodEnd ?? undefined,
              value_numeric: valueNumeric,
              value_unit: field.unit ?? undefined,
              value_as_stated:
                typeof field.value === "string"
                  ? field.value
                  : field.value !== null && field.value !== undefined
                    ? String(field.value)
                    : undefined,
              confidence: field.confidence,
              provenance_page: split.pageNumber,
              provenance_bbox: gate.bbox ?? undefined,
              provenance_source_text: gate.sourceText ?? "",
              document_file_hash: doc.sha256,
              extraction_params: JSON.stringify({ packId: input.packId, docType }),
              prompt_version: "gemini-1.0",
            });
          } catch (cevErr) {
            // CEV failure must not abort extraction -- log and continue.
            await admin.rpc("append_audit_event", {
              p_organization_id: input.organizationId,
              p_action: "cev.create_failed",
              p_entity_type: "extracted_field",
              p_entity_id: input.documentId,
              p_payload: {
                fieldPath: field.fieldPath,
                canonicalKey: annotation.canonicalKey,
                error: String(cevErr),
              },
            });
          }
        }
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
  organizationId: string,
  allowedDocTypes?: Array<{ id: string; label: string; notes?: string }>
): Promise<ExtractionResult<Classification>> {
  const first = await provider.classify(toDocumentPage(pages[0]!, evidenceId), { allowedDocTypes });
  await insertAiLog(admin, organizationId, first.log);
  if (classificationScore(first) >= 0.5) return first;
  if (!pages[1]) return first;
  const second = await provider.classify(toDocumentPage(pages[1], evidenceId), { allowedDocTypes });
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
