import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { saveCalendarReading } from "@verifystack/backend/lib/data/calendarStore";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { isExtractorConfigured } from "@verifystack/backend/lib/supabase/configured";
import {
  extractorClient,
  type ExtractorErrorKind,
} from "@verifystack/backend/lib/extractor/client";
import { jsonError, limitExceeded } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const Body = z.object({
  engagementId: z.string().uuid(),
  documentId: z.string().uuid().optional(),
  mode: z.enum(["auto-map", "proforma", "template", "two-stage"]).default("auto-map"),
  sourceType: z.enum(["sourcing", "corroboration", "proforma"]).default("corroboration"),
});

type Layout = "auto" | "proforma" | "tabular";
const LAYOUT_BY_MODE: Record<z.infer<typeof Body>["mode"], Layout> = {
  proforma: "proforma",
  template: "tabular",
  "auto-map": "auto",
  "two-stage": "auto",
};

const STATUS_BY_KIND: Record<ExtractorErrorKind, number> = {
  too_large: 413,
  unsupported: 415,
  unprocessable: 422,
  timeout: 504,
  model_unavailable: 503,
  not_configured: 503,
  auth: 502,
  service: 502,
  invalid_response: 502,
};

const MESSAGE_BY_KIND: Record<ExtractorErrorKind, string> = {
  too_large: "The file is too large to extract.",
  unsupported: "This file type is not supported.",
  unprocessable: "The file could not be read.",
  timeout: "The extractor service timed out. Try again.",
  model_unavailable: "The extractor service has no model configured.",
  not_configured: "The extractor service is not configured.",
  auth: "The extractor service rejected the request.",
  service: "The extractor service failed. Try again.",
  invalid_response: "The extractor service returned an unexpected response.",
};

function notFound() {
  return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
}

export async function POST(req: Request) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const limited = limitExceeded(`model:${session.user.id}`, LIMITS.modelCallsPerUser);
    if (limited) return limited;

    if (!isExtractorConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error: "The extractor service is not configured. Set EXTRACTOR_URL and EXTRACTOR_API_KEY.",
        },
        { status: 503 },
      );
    }

    // Parse the body. complianceYear and organizationId from the client are never read.
    let upload: File | null = null;
    let raw: Record<string, unknown>;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
      const f = form.get("file");
      upload = f instanceof File ? f : null;
      raw = {};
      for (const key of ["engagementId", "documentId", "mode", "sourceType"] as const) {
        const v = form.get(key);
        if (typeof v === "string" && v !== "") raw[key] = v;
      }
    } else {
      const json: unknown = await req.json().catch(() => null);
      raw = json && typeof json === "object" ? { ...(json as Record<string, unknown>) } : {};
      for (const key of Object.keys(raw)) {
        if (raw[key] === null || raw[key] === "") delete raw[key];
      }
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }
    const { engagementId, documentId, mode, sourceType } = parsed.data;

    // Engagement first: missing and foreign engagements look the same, before any file is read.
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return notFound();

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
    }

    let bytes: Uint8Array;
    let filename: string;
    let mimeType: string | undefined;
    let resolvedDocumentId: string | null = null;

    if (upload) {
      if (upload.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ ok: false, error: "The file is larger than 25 MB." }, { status: 413 });
      }
      bytes = new Uint8Array(await upload.arrayBuffer());
      filename = upload.name || "upload";
      mimeType = upload.type || undefined;
      resolvedDocumentId = documentId ?? null;
      if (resolvedDocumentId) {
        const { data: own } = await admin
          .from("documents")
          .select("id")
          .eq("id", resolvedDocumentId)
          .eq("organization_id", organizationId)
          .eq("engagement_id", engagementId)
          .maybeSingle();
        if (!own) return notFound();
      }
    } else if (documentId) {
      const { data: doc } = await admin
        .from("documents")
        .select("id, original_filename, storage_path, mime_type")
        .eq("id", documentId)
        .eq("organization_id", organizationId)
        .eq("engagement_id", engagementId)
        .maybeSingle();
      if (!doc) return notFound();
      const { data: blob, error: dlErr } = await admin.storage.from("evidence").download(doc.storage_path);
      if (dlErr || !blob) {
        return NextResponse.json({ ok: false, error: "Failed to read the document from storage." }, { status: 502 });
      }
      if (blob.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ ok: false, error: "The file is larger than 25 MB." }, { status: 413 });
      }
      bytes = new Uint8Array(await blob.arrayBuffer());
      filename = doc.original_filename;
      mimeType = doc.mime_type ?? undefined;
      resolvedDocumentId = doc.id;
    } else {
      return NextResponse.json(
        { ok: false, error: "Either a file or a documentId is required." },
        { status: 400 },
      );
    }

    const complianceYear = engagement.compliance_year;
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const result = await extractorClient.extractCalendar({
      file: { bytes, filename, mimeType },
      complianceYear,
      sourceType,
      layout: LAYOUT_BY_MODE[mode],
    });

    if (!result.ok) {
      const kind = result.error.kind;
      await admin.from("ai_action_logs").insert({
        organization_id: organizationId,
        tool: "extract_calendar",
        provider: "extractor_service",
        model: "unknown",
        prompt_version: "unknown",
        input_hash: "unknown",
        evidence_id: resolvedDocumentId,
        page_number: null,
        started_at: startedAt,
        duration_ms: Date.now() - t0,
        raw_output: "",
        ok: false,
        error: kind,
      });
      return NextResponse.json(
        { ok: false, error: MESSAGE_BY_KIND[kind] },
        { status: STATUS_BY_KIND[kind] },
      );
    }

    const data = result.data;
    const skipped: Array<{ rawId: string | null; label: string | null; reason: string; detail?: string | null }> =
      data.skipped.map((s) => ({ rawId: s.raw_id, label: s.label, reason: s.reason, detail: s.detail }));
    const mappings: Record<string, string> = {};
    let savedCount = 0;

    for (const r of data.readings) {
      if (r.label) mappings[r.label] = r.stream_key;
      if (r.normalized_value === null) {
        skipped.push({ rawId: r.raw_id, label: r.label, reason: "no_normalized_value" });
        continue;
      }
      const page = r.provenance.page;
      const saved = await saveCalendarReading(admin, {
        engagementId,
        organizationId,
        streamKey: r.stream_key,
        monthKey: r.period.month_key,
        readingDate: r.period.date,
        sourceType: r.source_type,
        valueNumeric: r.value,
        unit: r.unit_as_stated ?? r.normalized_unit,
        standardValue: r.normalized_value,
        valueAsStated: r.value_as_stated,
        documentId: resolvedDocumentId,
        provenancePage: page,
        provenanceBbox: page !== null ? r.provenance.bbox : null,
        provenanceSourceText: r.provenance.source_text,
        confidence: r.confidence,
        extractionMethod: page !== null ? "ai_extraction" : "workbook_reader",
        state: "suggested",
        complianceYear,
        readingMeta: {
          verified: r.verified,
          needsReview: r.needs_review,
          derived: r.derived,
          unitAssumed: r.unit_assumed,
          mappingSource: r.mapping_source,
          reviewReasons: r.review_reasons,
          locator: {
            ...(r.provenance.sheet ? { sheet: r.provenance.sheet } : {}),
            ...(r.provenance.cell ? { cellRef: r.provenance.cell } : {}),
          },
          rawId: r.raw_id,
          model: data.run.model,
          inputHash: data.run.input_hash,
        },
      });
      if (saved.ok) {
        savedCount++;
      } else {
        skipped.push({ rawId: r.raw_id, label: r.label, reason: "save_failed", detail: saved.error ?? null });
      }
    }

    await admin.from("ai_action_logs").insert({
      organization_id: organizationId,
      tool: "extract_calendar",
      provider: "extractor_service",
      model: data.run.model,
      prompt_version: data.run.prompt_version,
      input_hash: data.run.input_hash,
      evidence_id: resolvedDocumentId,
      page_number: null,
      started_at: startedAt,
      duration_ms: data.run.duration_ms,
      raw_output: JSON.stringify({ extracted: data.readings.length, saved: savedCount }),
      ok: true,
      error: null,
    });

    return NextResponse.json({
      ok: true,
      mode,
      extractedCount: data.readings.length,
      savedCount,
      skipped,
      warnings: data.warnings,
      unmapped: data.unmapped,
      mappings,
      model: data.run.model,
      inputHash: data.run.input_hash,
    });
  } catch (error) {
    return jsonError(error);
  }
}
