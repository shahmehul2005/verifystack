import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { assertAccepterIndependent } from "@verifystack/backend/domain/fieldwork/observation";
import type { Json } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  engagementId: z.string().uuid(),
  extractedFieldId: z.string().uuid(),
  state: z.enum(["accepted", "rejected", "corrected"]),
  correction: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: field, error: fErr } = await supabase
      .from("extracted_fields")
      .select("*")
      .eq("id", parsed.data.extractedFieldId)
      .eq("organization_id", organizationId)
      .eq("engagement_id", parsed.data.engagementId)
      .single();
    if (fErr || !field) {
      return NextResponse.json({ ok: false, error: "Field not found" }, { status: 404 });
    }

    if (field.state === "accepted" || field.state === "rejected") {
      return NextResponse.json({ ok: false, error: "That value has already been decided." }, { status: 409 });
    }

    // The person who recorded a site observation cannot be the one who makes it a fact.
    if (
      field.provenance_type === "site_observation" &&
      field.proposed_by &&
      (parsed.data.state === "accepted" || parsed.data.state === "corrected")
    ) {
      assertAccepterIndependent(field.proposed_by, session.user.id);
    }

    const valueJson: Json =
      parsed.data.state === "corrected" && parsed.data.correction
        ? parsed.data.correction
        : field.value_json;

    await supabase
      .from("extracted_fields")
      .update({
        state: parsed.data.state,
        correction_json: parsed.data.state === "corrected" ? (parsed.data.correction ?? null) : null,
        reviewed_by: session.user.id,
        reviewed_at: new Date().toISOString(),
        accept_mode: "individual",
      })
      .eq("id", field.id);

    if (parsed.data.state === "accepted" || parsed.data.state === "corrected") {
      const { error: insErr } = await supabase.from("facts").insert({
        organization_id: organizationId,
        engagement_id: field.engagement_id,
        extracted_field_id: field.id,
        document_id: field.document_id,
        field_path: field.field_path,
        value_json: valueJson,
        unit: field.unit,
        page: field.page,
        bbox: field.bbox,
        source_text: field.source_text,
        provenance_type: field.provenance_type,
        provenance: field.provenance,
        accepted_by: session.user.id,
        accept_mode: "individual",
      });
      if (insErr) throw new Error(insErr.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: `field.${parsed.data.state}`,
      entityType: "extracted_field",
      entityId: field.id,
      payload: { field_path: field.field_path },
    });

    if (parsed.data.state === "accepted" || parsed.data.state === "corrected") {
      const engagement = await getEngagement(field.engagement_id, organizationId);
      if (engagement) {
        await ensureEngagementStatus({
          organizationId,
          actorUserId: session.user.id,
          engagementId: engagement.id,
          current: engagement.status,
          target: "review",
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
