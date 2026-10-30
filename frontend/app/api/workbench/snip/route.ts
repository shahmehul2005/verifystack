import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { loadPack, packFieldTargets } from "@verifystack/backend/domain/packs";
import { parseRegion, snipProvenance } from "@verifystack/backend/domain/deskreview/snip";
import type { Json } from "@verifystack/backend/lib/supabase/types";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  documentId: z.string().uuid(),
  page: z.number().int().min(1).max(10000),
  bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  fieldPath: z.string().min(1).max(200),
  /** The figure as typed. Every field the packs bind is a quantity, so it must be a number. */
  value: z.union([z.number(), z.string()]),
  unit: z.string().trim().max(40).nullable().optional(),
  /** What is printed in the box, as the person read it. */
  sourceText: z.string().trim().min(1).max(300),
});

/**
 * Record a value from a region the reviewer drew on the page, as a fact.
 *
 * The reviewer drew the box, named the field and typed the figure, so that is
 * the decision: the field is stored as accepted, by them, with its page, region
 * and printed text, and the fact goes to the ledger at once. It is marked as
 * drawn by a person (provenance kind "snip", `proposed_by`), so the ledger and
 * the audit log show it was not read by the model. Nothing here reads the
 * region for them.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const body = parsed.data;

    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    // Only a field the methodology binds can be added, so a snip lands where a calculation looks.
    const target = packFieldTargets(loadPack(engagement.pack_id)).find((t) => t.path === body.fieldPath);
    if (!target) {
      return NextResponse.json({ ok: false, error: "That field is not one this methodology takes." }, { status: 422 });
    }

    const region = parseRegion(body.bbox);
    if (!region) return NextResponse.json({ ok: false, error: "The region is not a box on the page." }, { status: 422 });

    const value = typeof body.value === "number" ? body.value : Number(body.value.replace(/,/g, "").trim());
    if (!Number.isFinite(value) || (typeof body.value === "string" && body.value.trim() === "")) {
      return NextResponse.json({ ok: false, error: "The figure must be a number." }, { status: 422 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, mime_type, page_count")
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

    const now = new Date().toISOString();
    const { data: created, error } = await supabase
      .from("extracted_fields")
      .insert({
        organization_id: organizationId,
        engagement_id: body.engagementId,
        document_id: doc.id,
        extraction_job_id: null,
        field_path: body.fieldPath,
        value_json: value,
        unit: body.unit?.trim() || target.defaultUnit || null,
        // A person read it, so there is no model confidence to report. Triage does not rely on this number for a snip.
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
      .single();
    if (error || !created) throw new Error(error?.message ?? "Could not add the value");

    const { error: factError } = await supabase.from("facts").insert({
      organization_id: organizationId,
      engagement_id: body.engagementId,
      extracted_field_id: created.id,
      document_id: doc.id,
      field_path: body.fieldPath,
      value_json: value,
      unit: body.unit?.trim() || target.defaultUnit || null,
      page: body.page,
      bbox: region as unknown as Json,
      source_text: body.sourceText,
      provenance_type: "document_page",
      provenance: snipProvenance(session.user.id, now) as unknown as Json,
      accepted_by: session.user.id,
      accept_mode: "individual",
    });
    if (factError) {
      // Do not leave an accepted field with no fact behind it.
      await supabase.from("extracted_fields").delete().eq("id", created.id);
      throw new Error(factError.message);
    }
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
      entityId: created.id,
      payload: { field_path: body.fieldPath, document_id: doc.id, page: body.page },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (e) {
    return jsonError(e);
  }
}
