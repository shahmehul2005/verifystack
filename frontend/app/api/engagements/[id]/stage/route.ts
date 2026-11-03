import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { loadPack } from "@verifystack/backend/domain/packs";
import { StageError, assertStageMove } from "@verifystack/backend/domain/stages/stages";

const Body = z.object({
  stage: z.string().min(1).max(60),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Move an engagement along its scheme's stage list. The stage is a tracker:
 * moving it never changes the engagement status or ADEETIE phase, and never
 * unlocks or locks calculation or sign-off.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("engagements.stage");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const engagement = await getEngagement(id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const stages = loadPack(engagement.pack_id).stages;
    if (!stages || stages.length === 0) {
      throw new StageError("This scheme has no stage list yet.");
    }
    const from = engagement.stage ?? null;
    const direction = assertStageMove(stages, from, parsed.data.stage, parsed.data.note);

    const admin = createServiceClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    // Compare-and-set on the stage we read, so two moves cannot both apply.
    let update = admin
      .from("engagements")
      .update({ stage: parsed.data.stage, updated_at: new Date().toISOString() })
      .eq("id", engagement.id)
      .eq("organization_id", organizationId);
    update = from === null ? update.is("stage", null) : update.eq("stage", from);
    const { data: written, error } = await update.select("id");
    if (error) throw new Error(error.message);
    if (!written || written.length === 0) {
      return NextResponse.json({ ok: false, error: "The stage changed meanwhile. Reload and try again." }, { status: 409 });
    }

    const { error: evErr } = await admin.from("engagement_stage_events").insert({
      organization_id: organizationId,
      engagement_id: engagement.id,
      from_stage: from,
      to_stage: parsed.data.stage,
      direction,
      note: parsed.data.note || null,
      actor_user_id: session.user.id,
    });
    if (evErr) throw new Error(evErr.message);

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "engagement.stage_changed",
      entityType: "engagement",
      entityId: engagement.id,
      payload: { from, to: parsed.data.stage, direction, ...(parsed.data.note ? { note: parsed.data.note } : {}) },
    });

    return NextResponse.json({ ok: true, stage: parsed.data.stage, direction });
  } catch (e) {
    return jsonError(e);
  }
}
