import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

const Create = z.object({
  engagementId: z.string().uuid(),
  plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  location: z.string().trim().min(2).max(200),
  scope: z.string().trim().min(5).max(1000),
  assignedTo: z.string().uuid().optional(),
});

const Update = z.object({
  engagementId: z.string().uuid(),
  visitId: z.string().uuid(),
  status: z.enum(["in_progress", "completed", "cancelled"]),
});

/** Schedule a site visit. The lead verifier plans; verifiers capture. */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("plan.manage");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Create.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    const d = parsed.data;
    const engagement = await getEngagement(d.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    if (d.assignedTo) {
      const { data: m } = await db
        .from("memberships")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("user_id", d.assignedTo)
        .maybeSingle();
      if (!m) return NextResponse.json({ ok: false, error: "That person is not on your team." }, { status: 422 });
    }
    const { data: row, error } = await db
      .from("site_visits")
      .insert({
        organization_id: organizationId,
        engagement_id: d.engagementId,
        planned_for: d.plannedFor || null,
        location: d.location,
        scope: d.scope,
        assigned_to: d.assignedTo ?? null,
        created_by: session.user.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "site_visit.scheduled",
      entityType: "site_visit",
      entityId: row.id,
      payload: { engagementId: d.engagementId, location: d.location },
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return jsonError(e);
  }
}

/** Move a visit along. A finished or cancelled visit takes no more observations. */
export async function PUT(req: Request) {
  try {
    const session = await requireCapability("fieldwork.record");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Update.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const d = parsed.data;
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    const { data: visit } = await db
      .from("site_visits")
      .select("id, status")
      .eq("id", d.visitId)
      .eq("engagement_id", d.engagementId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!visit) return NextResponse.json({ ok: false, error: "Visit not found" }, { status: 404 });
    if (visit.status === "completed" || visit.status === "cancelled") {
      return NextResponse.json({ ok: false, error: `The visit is already ${visit.status}.` }, { status: 409 });
    }
    const { error } = await db.from("site_visits").update({ status: d.status }).eq("id", visit.id);
    if (error) throw new Error(error.message);
    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: `site_visit.${d.status}`,
      entityType: "site_visit",
      entityId: visit.id,
      payload: { engagementId: d.engagementId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
