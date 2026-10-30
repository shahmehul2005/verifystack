import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadPack } from "@verifystack/backend/domain/packs";
import { deskReviewFor, inferSlot, readWorkbooks, runDeskReview, type DeskWorkbook, type Readings } from "@verifystack/backend/domain/deskreview";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const Body = z.object({ engagementId: z.string().uuid() });

/**
 * Run the desk review. Workbook readings are computed here from the stored files
 * in their evidence slots; PDF readings are the ones the auditor entered. The
 * result and every reading the rules saw are saved, so the run can be replayed.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const { engagementId } = parsed.data;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const def = deskReviewFor(engagement.pack_id);
    if (!def) return NextResponse.json({ ok: false, error: "This methodology has no desk review." }, { status: 409 });
    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const [{ data: docs, error: dErr }, { data: manual, error: mErr }] = await Promise.all([
      supabase
        .from("documents")
        .select("id, original_filename, mime_type, storage_path, slot, doc_type")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId)
        .eq("mime_type", XLSX_MIME)
        .limit(40),
      supabase.from("desk_readings").select("key, value").eq("engagement_id", engagementId).eq("organization_id", organizationId),
    ]);
    if (dErr) throw new Error(dErr.message);
    if (mErr) throw new Error(mErr.message);

    const files = (
      await Promise.all(
        (docs ?? []).map(async (d): Promise<DeskWorkbook | null> => {
          const { data: blob, error } = await supabase.storage.from("evidence").download(d.storage_path);
          if (error || !blob) return null;
          const effectiveSlot = d.slot ?? inferSlot({ name: d.original_filename, slot: d.slot, docType: d.doc_type });
          if (!effectiveSlot) return null;
          return { slot: effectiveSlot, name: d.original_filename, bytes: new Uint8Array(await blob.arrayBuffer()) };
        })
      )
    ).filter((f): f is DeskWorkbook => f !== null);

    const { readings, notes } = readWorkbooks(def, files, loadPack(engagement.pack_id).proforma_inputs ?? []);
    const all: Readings = { ...readings };
    for (const m of manual ?? []) all[m.key] = Number(m.value);
    const results = runDeskReview(def, all);

    const { data: saved, error } = await supabase
      .from("desk_reviews")
      .insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        pack_id: engagement.pack_id,
        results: results as unknown as Json,
        readings: all as unknown as Json,
        notes: notes as unknown as Json,
        run_by: session.user.id,
      })
      .select("id")
      .single();
    if (error || !saved) throw new Error(error?.message ?? "Could not save the desk review");

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "desk_review.run",
      entityType: "engagement",
      entityId: engagementId,
      payload: {
        reviewId: saved.id,
        pass: results.filter((r) => r.status === "pass").length,
        fail: results.filter((r) => r.status === "fail").length,
        pending: results.filter((r) => r.status === "pending").length,
      },
    });
    return NextResponse.json({ ok: true, id: saved.id, results });
  } catch (e) {
    return jsonError(e);
  }
}
