import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { parseRegion, snipProvenance } from "@verifystack/backend/domain/deskreview/snip";
import { matchDateToMonthKey } from "@verifystack/backend/domain/calendar/months";
import { getStreamDefinition } from "@verifystack/backend/domain/calendar/streams";
import { saveCalendarReading, inferSourceType } from "@verifystack/backend/lib/data/calendarStore";
import type { Json } from "@verifystack/backend/lib/supabase/types";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  documentId: z.string().uuid(),
  page: z.number().int().min(1).max(10000),
  bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  fieldPath: z.string().min(1).max(200),
  streamKey: z.string().optional(),
  monthKey: z.string().optional(),
  readingDate: z.string().optional().nullable(),
  sourceType: z.enum(["sourcing", "corroboration", "proforma"]).optional(),
  /** The figure as typed. Every field the packs bind is a quantity, so it must be a number. */
  value: z.union([z.number(), z.string()]),
  unit: z.string().trim().max(40).nullable().optional(),
  /** What is printed in the box, as the person read it. */
  sourceText: z.string().trim().min(1).max(300),
});

/**
 * Record a value from a region the reviewer drew on the page, as a verified calendar reading and fact.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    const body = parsed.data;

    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const region = parseRegion(body.bbox);
    if (!region) return NextResponse.json({ ok: false, error: "The region is not a box on the page." }, { status: 422 });

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const value = typeof body.value === "number" ? body.value : Number(body.value.replace(/,/g, "").trim());
    if (!Number.isFinite(value) || (typeof body.value === "string" && body.value.trim() === "")) {
      return NextResponse.json({ ok: false, error: "The figure must be a number." }, { status: 422 });
    }

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, original_filename, slot, doc_type, mime_type, page_count")
      .eq("id", body.documentId)
      .eq("engagement_id", body.engagementId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) return NextResponse.json({ ok: false, error: "That document is not in this engagement." }, { status: 404 });
    if (!(doc.mime_type === "application/pdf" || doc.mime_type.startsWith("image/"))) {
      return NextResponse.json({ ok: false, error: "A region can only be drawn on a PDF or an image." }, { status: 422 });
    }
    if (doc.page_count && body.page > doc.page_count) {
      return NextResponse.json({ ok: false, error: `That document has ${doc.page_count} page(s).` }, { status: 422 });
    }

    // Determine streamKey
    const streamDef = getStreamDefinition(body.streamKey || body.fieldPath);
    const resolvedStreamKey = streamDef?.key ?? body.streamKey ?? body.fieldPath;

    // Determine sourceType
    const resolvedSourceType = body.sourceType ?? inferSourceType(doc, "manual_entry");

    // Determine monthKey
    let resolvedMonthKey = body.monthKey;
    if (!resolvedMonthKey) {
      resolvedMonthKey = matchDateToMonthKey(doc.original_filename) ?? "annual";
    }

    const now = new Date().toISOString();

    // 1. Save into calendar store (canonical_evidence_values)
    const calResult = await saveCalendarReading(supabase, {
      engagementId: body.engagementId,
      organizationId,
      streamKey: resolvedStreamKey,
      monthKey: resolvedMonthKey,
      readingDate: body.readingDate,
      sourceType: resolvedSourceType,
      valueNumeric: value,
      unit: body.unit,
      documentId: doc.id,
      provenancePage: body.page,
      provenanceBbox: region,
      provenanceSourceText: body.sourceText,
      reviewedBy: session.user.id,
    });

    if (!calResult.ok) {
      return NextResponse.json({ ok: false, error: calResult.error }, { status: 400 });
    }

    // 2. Also record in extracted_fields for review workbench backward-compat
    const { data: created } = await supabase
      .from("extracted_fields")
      .insert({
        organization_id: organizationId,
        engagement_id: body.engagementId,
        document_id: doc.id,
        extraction_job_id: null,
        field_path: streamDef?.calcBindingPath ?? body.fieldPath,
        value_json: value,
        unit: body.unit?.trim() || streamDef?.standardUnit || null,
        confidence: 1,
        page: body.page,
        bbox: region as unknown as Json,
        source_text: body.sourceText,
        triage_action: "human_review",
        state: "accepted",
        provenance_type: "document_page",
        provenance: snipProvenance(session.user.id, now) as unknown as Json,
        proposed_by: session.user.id,
        reviewed_by: session.user.id,
        reviewed_at: now,
        accept_mode: "individual",
      })
      .select("id")
      .maybeSingle();

    await ensureEngagementStatus({
      organizationId,
      actorUserId: session.user.id,
      engagementId: engagement.id,
      current: engagement.status,
      target: "review",
    });

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "field.snipped_accepted",
      entityType: "extracted_field",
      entityId: created?.id ?? calResult.id ?? doc.id,
      payload: {
        field_path: body.fieldPath,
        stream_key: resolvedStreamKey,
        month_key: resolvedMonthKey,
        source_type: resolvedSourceType,
        document_id: doc.id,
        page: body.page,
      },
    });

    return NextResponse.json({ ok: true, id: created?.id ?? calResult.id });
  } catch (e) {
    return jsonError(e);
  }
}
