import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError, limitExceeded } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { displayNameOf } from "@verifystack/backend/lib/auth/displayName";
import {
  ObservationInputSchema,
  checkObservation,
  isProposable,
  observationSummary,
  toSiteProvenance,
  captureDelayHours,
} from "@verifystack/backend/domain/fieldwork/observation";
import { provenanceToColumns } from "@verifystack/backend/domain/provenance";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import type { Json } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({ engagementId: z.string().uuid(), observation: ObservationInputSchema });

/**
 * Record one site observation (DFD 14.0). Idempotent on the device's client id,
 * so an offline queue can retry safely. A 4xx tells the device the observation
 * itself is invalid (kept for the user to fix); anything else is retried.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("fieldwork.record");
    const organizationId = assertOrgId(session.organizationId);
    const limited = limitExceeded(`fieldwork:${session.user.id}`, LIMITS.fieldwork);
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues.map((i) => i.message).join(" ") || "Invalid observation" },
        { status: 422 }
      );
    }
    const { engagementId, observation: o } = parsed.data;
    const check = checkObservation(o);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.errors.join(" ") }, { status: 422 });

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: existing } = await db
      .from("site_observations")
      .select("id")
      .eq("engagement_id", engagementId)
      .eq("client_id", o.clientId)
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true, duplicate: true, id: existing.id });

    if (o.visitId) {
      const { data: visit } = await db
        .from("site_visits")
        .select("id, status")
        .eq("id", o.visitId)
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!visit) return NextResponse.json({ ok: false, error: "That site visit does not belong to this engagement." }, { status: 422 });
      if (visit.status === "cancelled" || visit.status === "completed") {
        return NextResponse.json({ ok: false, error: `The visit is ${visit.status}; open a new one.` }, { status: 422 });
      }
    }
    if (o.evidenceFileIds.length > 0) {
      const { data: files } = await db
        .from("documents")
        .select("id")
        .in("id", o.evidenceFileIds)
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId);
      if ((files ?? []).length !== o.evidenceFileIds.length) {
        return NextResponse.json({ ok: false, error: "An attached photograph was not found on this engagement." }, { status: 422 });
      }
    }

    const observer = displayNameOf(session.user);
    const recordedAt = new Date();
    const { data: row, error } = await db
      .from("site_observations")
      .insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        visit_id: o.visitId ?? null,
        client_id: o.clientId,
        kind: o.kind,
        observer_user_id: session.user.id,
        observer_name: observer,
        observed_at: new Date(check.observedAtMs!).toISOString(),
        recorded_at: recordedAt.toISOString(),
        lat: o.location?.lat ?? null,
        lng: o.location?.lng ?? null,
        accuracy_m: o.location?.accuracyM ?? null,
        field_path: o.fieldPath ?? null,
        value_json: (o.value ?? null) as Json,
        unit: o.unit ?? null,
        note: o.note ?? null,
        evidence_file_ids: o.evidenceFileIds as unknown as Json,
      })
      .select("id")
      .single();
    if (error) {
      // Two syncs of the same observation racing: the unique key makes the second one a duplicate.
      if (error.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
      throw new Error(error.message);
    }

    let proposed = false;
    if (isProposable(o)) {
      const prov = toSiteProvenance(o, { observationId: row.id, observer });
      const cols = provenanceToColumns(prov);
      const { data: field, error: fErr } = await db
        .from("extracted_fields")
        .insert({
          organization_id: organizationId,
          engagement_id: engagementId,
          extraction_job_id: null,
          document_id: null,
          field_path: o.fieldPath!,
          value_json: o.value as Json,
          unit: o.unit ?? null,
          confidence: 1,
          page: null,
          bbox: null,
          source_text: null,
          provenance_type: cols.provenance_type,
          provenance: cols.provenance as Json | null,
          triage_action: "human_review",
          state: "suggested",
          proposed_by: session.user.id,
        })
        .select("id")
        .single();
      if (fErr) throw new Error(fErr.message);
      await db.from("site_observations").update({ extracted_field_id: field.id }).eq("id", row.id);
      proposed = true;
    }

    if (o.visitId) {
      await db
        .from("site_visits")
        .update({ status: "in_progress" })
        .eq("id", o.visitId)
        .eq("status", "planned");
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "observation.recorded",
      entityType: "site_observation",
      entityId: row.id,
      payload: {
        engagementId,
        kind: o.kind,
        proposed,
        summary: observationSummary(o, observer),
        captureDelayHours: Math.round(captureDelayHours(check.observedAtMs!, recordedAt) * 10) / 10,
        warnings: check.warnings,
      },
    });
    return NextResponse.json({ ok: true, id: row.id, proposed, warnings: check.warnings });
  } catch (e) {
    return jsonError(e);
  }
}
