import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadPack } from "@verifystack/backend/domain/packs";
import { isKnownSlot } from "@verifystack/backend/domain/crosscheck/checklist";

export const runtime = "nodejs";

const Body = z.object({ slot: z.string().min(1).max(80).nullable() });

/**
 * Assign a document to one evidence-checklist slot, or clear it. The slot must be
 * one the engagement's methodology pack defines. Assignment is a person's choice
 * and is audit-logged with the previous value.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: doc } = await supabase
      .from("documents")
      .select("id, engagement_id, slot")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const pack = loadPack(engagement.pack_id);
    if (!isKnownSlot(pack.evidence_slots, parsed.data.slot)) {
      return NextResponse.json(
        { ok: false, error: "This methodology pack does not define that evidence slot." },
        { status: 422 }
      );
    }

    const { error } = await supabase
      .from("documents")
      .update({ slot: parsed.data.slot })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "document.slot_set",
      entityType: "document",
      entityId: id,
      payload: { from: doc.slot ?? null, to: parsed.data.slot },
    });

    return NextResponse.json({ ok: true, slot: parsed.data.slot });
  } catch (e) {
    return jsonError(e);
  }
}
