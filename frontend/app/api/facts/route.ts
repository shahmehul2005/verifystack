import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { CONFIDENCE_POLICY } from "@verifystack/backend/domain/extraction/schemas";
import type { Json } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  engagementId: z.string().uuid(),
  extractedFieldId: z.string().uuid(),
  state: z.enum(["accepted", "rejected", "corrected"]),
  correction: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireSession();
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

    const leaf = field.field_path.split(".").pop() ?? field.field_path;
    if (CONFIDENCE_POLICY.alwaysReview.has(leaf) && parsed.data.state === "accepted") {
      // still a human decision — allowed; just never auto-commit these
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
        accepted_by: session.user.id,
      });
      if (insErr) throw new Error(insErr.message);
    }

    await auditEvent({
      organizationId,
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
