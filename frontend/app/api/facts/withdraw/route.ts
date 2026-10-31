import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { MIN_CHANGE_REASON } from "@verifystack/backend/domain/deskreview/readingChange";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  factId: z.string().uuid(),
  reason: z.string().trim().min(MIN_CHANGE_REASON, `Say why in at least ${MIN_CHANGE_REASON} characters.`).max(500),
});

/** Once sign-off starts, the ledger the lead and the reviewer are signing is fixed. */
const FROZEN = new Set(["signoff", "submitted"]);

const isMissingTable = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /fact_withdrawals/.test(e.message ?? "");

/**
 * Take a wrong fact out of the ledger a run reads, keeping it.
 *
 * The fact is copied in full to fact_withdrawals with who, when and why, and
 * only then removed from facts, so a withdrawal is never an erasure. If the
 * history cannot be written the fact is left where it is. The extracted value it
 * came from is marked rejected, since a person has decided it is not right; a
 * replacement comes from a new snip or another accepted value. Calculation runs
 * already made keep the figures they used, so run again afterwards.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const body = parsed.data;

    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (FROZEN.has(engagement.status)) {
      return NextResponse.json({ ok: false, error: "Sign-off has started, so the facts ledger can no longer change." }, { status: 409 });
    }
    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: fact, error: factError } = await supabase
      .from("facts")
      .select("*")
      .eq("id", body.factId)
      .eq("engagement_id", body.engagementId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (factError) throw new Error(factError.message);
    if (!fact) return NextResponse.json({ ok: false, error: "That fact is not in this engagement." }, { status: 404 });

    const now = new Date().toISOString();
    const { data: record, error: recordError } = await supabase
      .from("fact_withdrawals")
      .insert({
        organization_id: organizationId,
        engagement_id: body.engagementId,
        fact_id: fact.id,
        extracted_field_id: fact.extracted_field_id,
        document_id: fact.document_id,
        field_path: fact.field_path,
        value_json: fact.value_json,
        unit: fact.unit,
        page: fact.page,
        bbox: fact.bbox,
        source_text: fact.source_text,
        provenance_type: fact.provenance_type,
        provenance: fact.provenance,
        accept_mode: fact.accept_mode,
        accepted_by: fact.accepted_by,
        accepted_at: fact.accepted_at,
        reason: body.reason,
        withdrawn_by: session.user.id,
        withdrawn_at: now,
      })
      .select("id")
      .single();
    if (recordError || !record) {
      if (recordError && isMissingTable(recordError)) {
        return NextResponse.json({ ok: false, error: "Apply migration 0022 first: a fact is only withdrawn once its history can be kept." }, { status: 409 });
      }
      throw new Error(recordError?.message ?? "Could not record the withdrawal");
    }

    const { error: deleteError } = await supabase.from("facts").delete().eq("id", fact.id).eq("organization_id", organizationId);
    if (deleteError) {
      // Do not leave a withdrawal on record for a fact that is still in the ledger.
      await supabase.from("fact_withdrawals").delete().eq("id", record.id);
      throw new Error(deleteError.message);
    }

    if (fact.extracted_field_id) {
      await supabase
        .from("extracted_fields")
        .update({ state: "rejected", reviewed_by: session.user.id, reviewed_at: now })
        .eq("id", fact.extracted_field_id)
        .eq("organization_id", organizationId)
        .in("state", ["accepted", "corrected"]);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "fact.withdrawn",
      entityType: "fact",
      entityId: fact.id,
      payload: { field_path: fact.field_path, value: fact.value_json, unit: fact.unit, reason: body.reason },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
