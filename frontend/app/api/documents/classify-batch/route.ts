import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { LIMITS, rateLimit } from "@verifystack/backend/lib/rateLimit";
import { isGeminiConfigured } from "@verifystack/backend/lib/supabase/configured";
import { loadPack } from "@verifystack/backend/domain/packs";
import { inferSlot } from "@verifystack/backend/domain/deskreview";
import { GeminiExtractionProvider } from "@verifystack/backend/domain/extraction/gemini";
import { PageSplitError, firstEvidencePage } from "@verifystack/backend/domain/extraction/pages";
import { CONFIDENCE_POLICY } from "@verifystack/backend/domain/extraction/schemas";
import {
  MAX_BATCH_BYTES,
  MAX_DOCS_PER_BATCH,
  MAX_SINGLE_PAGE_BYTES,
  isBatchable,
  isRetryableProviderError,
} from "@verifystack/backend/domain/extraction/classifyBatch";
import type { DocOutcome } from "@verifystack/backend/domain/extraction/classifyRunner";
import type { DocumentPage } from "@verifystack/backend/domain/extraction/provider";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A file larger than this is not opened here. Its type can still be suggested on its own. */
const MAX_FILE_BYTES = 60 * 1024 * 1024;

const Body = z.object({
  engagementId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()).min(1).max(MAX_DOCS_PER_BATCH),
});

function fail(status: number, error: string, retryable: boolean, retryAfterSeconds?: number) {
  return NextResponse.json({ ok: false, error, retryable, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, { status });
}

/**
 * Suggest a type for up to eight unassigned documents with one model call.
 *
 * The request names the documents and nothing else. Which ones are eligible, the
 * size of each first page and the batch budget are all decided here, so a client
 * cannot overrun the model's request cap: a document that does not fit is handed
 * back as `deferred` for the next call. A document that already has a type is
 * never touched, even if someone gave it one while the model was thinking. No
 * filename or other metadata goes to the model, only the first page.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "Invalid request", false);
    const { engagementId, documentIds } = parsed.data;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return fail(404, "Not found", false);
    if (!isGeminiConfigured()) return fail(503, "Gemini is not configured for document classification.", false);
    const supabase = createServiceClient();
    if (!supabase) return fail(503, "Supabase is not configured", false);

    const { limit, windowMs } = LIMITS.modelCallsPerUser;
    const limited = rateLimit(`classify-batch:${session.user.id}`, limit, windowMs);
    if (!limited.ok) return fail(429, "Too many model calls in a short time. Waiting, then trying again.", true, limited.retryAfterSec);

    const pack = loadPack(engagement.pack_id);
    const taxonomy = (pack.document_taxonomy ?? []).map((t) => ({ id: t.id, label: t.label, notes: t.notes }));
    const slots = pack.evidence_slots ?? [];

    const { data: rows, error: rowsError } = await supabase
      .from("documents")
      .select("id, sha256, storage_path, mime_type, byte_size, doc_type, slot")
      .in("id", documentIds)
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId);
    if (rowsError) throw new Error(rowsError.message);
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));

    const results: DocOutcome[] = [];
    const deferred: string[] = [];
    const toSend: { id: string; slot: string | null; page: DocumentPage }[] = [];
    let budget = 0;

    for (const id of documentIds) {
      const doc = byId.get(id);
      if (!doc) {
        results.push({ id, status: "skipped", reason: "Not found in this engagement." });
        continue;
      }
      if (doc.doc_type) {
        results.push({ id, status: "skipped", reason: "It already has a type, so it was left as it is." });
        continue;
      }
      if (!isBatchable(doc.mime_type)) {
        results.push({ id, status: "skipped", reason: "Only PDF, PNG and JPEG files can be named by the model." });
        continue;
      }
      if (doc.byte_size > MAX_FILE_BYTES) {
        results.push({ id, status: "skipped", reason: "The file is too large to open here. Suggest its type on its own." });
        continue;
      }
      const { data: blob, error: downloadError } = await supabase.storage.from("evidence").download(doc.storage_path);
      if (downloadError || !blob) {
        results.push({ id, status: "failed", reason: "The stored file could not be read." });
        continue;
      }
      let first;
      try {
        first = await firstEvidencePage(Buffer.from(await blob.arrayBuffer()), doc.mime_type);
      } catch (e) {
        results.push({ id, status: "failed", reason: e instanceof PageSplitError ? e.message : "The first page could not be read." });
        continue;
      }
      const bytes = first.bytes.byteLength;
      if (bytes > MAX_SINGLE_PAGE_BYTES) {
        results.push({ id, status: "skipped", reason: "The first page is too large to send in a batch. Suggest its type on its own." });
        continue;
      }
      // Over the budget with others already in: hand it back for the next call.
      if (toSend.length > 0 && budget + bytes > MAX_BATCH_BYTES) {
        deferred.push(id);
        continue;
      }
      budget += bytes;
      toSend.push({
        id,
        slot: doc.slot,
        page: { evidenceId: doc.sha256, pageNumber: 1, mimeType: first.mimeType, data: Buffer.from(first.bytes).toString("base64") },
      });
    }

    let inputHash: string | null = null;
    if (toSend.length > 0) {
      const provider = new GeminiExtractionProvider({ apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL || undefined });
      const answer = await provider.classifyBatch(
        toSend.map((t) => t.page),
        { allowedDocTypes: taxonomy }
      );
      inputHash = answer.log.inputHash;
      // Keep the call on record, as extraction does. A failure to record it does not undo the answer.
      await supabase
        .from("ai_action_logs")
        .insert({
          organization_id: organizationId,
          tool: answer.log.tool,
          provider: answer.log.provider,
          model: answer.log.model,
          prompt_version: answer.log.promptVersion,
          input_hash: answer.log.inputHash,
          evidence_id: answer.log.evidenceId,
          page_number: answer.log.pageNumber,
          started_at: answer.log.startedAt,
          duration_ms: answer.log.durationMs,
          raw_output: answer.log.rawOutput,
          ok: answer.log.ok,
          error: answer.log.error ?? null,
        })
        .then(() => undefined, () => undefined);

      if (!answer.ok) {
        const message = answer.log.error ?? answer.errors[0] ?? "The model gave no usable answer.";
        return isRetryableProviderError(message)
          ? fail(429, "The model is busy or rate-limited. Waiting, then trying again.", true, 20)
          : fail(502, message, false);
      }

      for (let i = 0; i < toSend.length; i++) {
        const target = toSend[i]!;
        const item = answer.items[i];
        if (!item) {
          const why = answer.errors.find((e) => e.includes(`ocument ${i + 1} `));
          results.push({ id: target.id, status: "failed", reason: why ?? "The model gave no usable answer for this document." });
          continue;
        }
        // The slot follows the type only when the model is sure enough that no one has to look first.
        const slot = item.docType === "unknown" ? null : (inferSlot({ docType: item.docType }) ?? null);
        const slotId = slot && slots.some((s) => s.id === slot) ? slot : slots.some((s) => s.id === item.docType) ? item.docType : null;
        const setSlot = !target.slot && slotId !== null && item.confidence >= CONFIDENCE_POLICY.reviewBelow;
        const { data: updated, error: updateError } = await supabase
          .from("documents")
          .update({
            doc_type: item.docType,
            classification_confidence: item.confidence,
            ...(setSlot ? { slot: slotId } : {}),
          })
          .eq("id", target.id)
          .eq("organization_id", organizationId)
          .is("doc_type", null)
          .select("id");
        if (updateError) {
          results.push({ id: target.id, status: "failed", reason: updateError.message });
        } else if (!updated || updated.length === 0) {
          results.push({ id: target.id, status: "skipped", reason: "A type was set while this ran, so it was left as it is." });
        } else {
          results.push(
            item.docType === "unknown"
              ? { id: target.id, status: "unknown", confidence: item.confidence }
              : { id: target.id, status: "suggested", docType: item.docType, confidence: item.confidence }
          );
        }
      }
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "documents.classified_batch",
      entityType: "engagement",
      entityId: engagementId,
      payload: {
        requested: documentIds.length,
        sent: toSend.length,
        suggested: results.filter((r) => r.status === "suggested").length,
        unknown: results.filter((r) => r.status === "unknown").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        deferred: deferred.length,
        inputHash,
      },
    });

    return NextResponse.json({ ok: true, results, deferred });
  } catch (e) {
    return jsonError(e);
  }
}
