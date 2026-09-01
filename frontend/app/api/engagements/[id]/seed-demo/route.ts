import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { sha256Bytes, evidenceObjectKey } from "@verifystack/backend/lib/hash";
import { CEMENT_DEMO_RUN_FACTS } from "@verifystack/backend/demo/seed";
import {
  adeetieSyntheticFacts,
  canSeedAdeetiePack,
  ADEETIE_DEMO_ENTERPRISE,
  ADEETIE_DEMO_MEASURES,
  type SyntheticFact,
} from "@verifystack/backend/demo/adeetieFacts";
import { loadPack } from "@verifystack/backend/domain/packs";
import { isAdeetiePhase } from "@verifystack/backend/domain/packs/adeetie/phases";
import { secPhaseForAdeetiePhase } from "@verifystack/backend/domain/adeetie/lifecycle";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import type { AdeetiePhase, Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const BBOX = { x: 0.1, y: 0.2, width: 0.35, height: 0.05 };

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("engagements.create");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (!engagement.draft_mode) {
      return NextResponse.json(
        { ok: false, error: "Seed demo facts only on draft-mode engagements." },
        { status: 409 }
      );
    }

    const pack = loadPack(engagement.pack_id);
    const isCement = engagement.pack_id === "CCTS-CEMENT-v1";
    const isAdeetie = engagement.scheme === "ADEETIE" && canSeedAdeetiePack(pack);
    if (!isCement && !isAdeetie) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Synthetic facts exist for CCTS Cement and for the ADEETIE sector packs. This pack has none.",
        },
        { status: 409 }
      );
    }

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    /**
     * ADEETIE evidence is scoped to the pass it was taken in, so the phase the
     * engagement is standing in decides which year of synthetic facts is
     * written and which tag the placeholder document carries. A baseline pass
     * and an M&V pass therefore seed two distinct fact sets.
     */
    const adeetiePhase =
      isAdeetie && engagement.adeetie_phase && isAdeetiePhase(engagement.adeetie_phase)
        ? (engagement.adeetie_phase as AdeetiePhase)
        : null;
    const secPhase = adeetiePhase ? secPhaseForAdeetiePhase(adeetiePhase) : null;

    const wanted: SyntheticFact[] = isCement
      ? CEMENT_DEMO_RUN_FACTS.map((f) => ({
          field_path: f.field_path,
          value_json: f.value_json as number,
          unit: f.unit,
          source_text: f.source_text,
        }))
      : adeetieSyntheticFacts(pack, secPhase ?? "baseline");

    // Facts already committed under the same pass are left alone. Scoping the
    // duplicate check by document phase is what lets M&V seed the same field
    // paths as the baseline without colliding with them.
    const { data: existing } = await admin
      .from("facts")
      .select("field_path, document_id")
      .eq("engagement_id", id)
      .eq("organization_id", organizationId);

    let samePhaseDocIds = new Set<string>();
    if (adeetiePhase) {
      const { data: docsInPhase } = await admin
        .from("documents")
        .select("id, adeetie_phase")
        .eq("engagement_id", id)
        .eq("organization_id", organizationId);
      samePhaseDocIds = new Set(
        (docsInPhase ?? [])
          .filter((d) => (d.adeetie_phase ?? "IGEA") === adeetiePhase)
          .map((d) => d.id)
      );
    }
    const have = new Set(
      (existing ?? [])
        .filter((f) =>
          adeetiePhase ? !f.document_id || samePhaseDocIds.has(f.document_id) : true
        )
        .map((f) => f.field_path)
    );
    const missing = wanted.filter((f) => !have.has(f.field_path));

    const seededExtras = isAdeetie
      ? await seedAdeetieContext({ admin, engagement, id, organizationId, adeetiePhase, userId: session.user.id })
      : { enterprise: false, measures: 0 };

    if (missing.length === 0) {
      return NextResponse.json({
        ok: true,
        seeded: 0,
        ...seededExtras,
        message: "Demo facts for this pass are already present.",
      });
    }

    // The placeholder is a 1×1 PNG, not a real scan. It exists so every fact has
    // a document to point at: provenance is mandatory and a fact with no
    // document would be refused by the engine.
    const phaseSalt = adeetiePhase ?? "";
    const sha256 = sha256Bytes(Buffer.concat([PNG, Buffer.from(id + phaseSalt)]));
    const storagePath = evidenceObjectKey(sha256);
    await admin.storage.from("evidence").upload(storagePath, PNG, {
      contentType: "image/png",
      upsert: true,
    });

    const { data: existingDoc } = await admin
      .from("documents")
      .select("id")
      .eq("engagement_id", id)
      .eq("sha256", sha256)
      .maybeSingle();

    let documentId = existingDoc?.id;
    if (!documentId) {
      const filename = isCement
        ? "aravalli-synthetic-placeholder.png"
        : `adeetie-${(adeetiePhase ?? "IGEA").toLowerCase()}-synthetic-placeholder.png`;
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .insert({
          organization_id: organizationId,
          engagement_id: id,
          sha256,
          storage_path: storagePath,
          original_filename: filename,
          mime_type: "image/png",
          byte_size: PNG.byteLength,
          doc_type: "production_log",
          created_by: session.user.id,
          ...(adeetiePhase ? { adeetie_phase: adeetiePhase } : {}),
        })
        .select("id")
        .single();
      if (docErr || !doc) throw new Error(docErr?.message ?? "Could not store placeholder document");
      documentId = doc.id;
    }

    const rows = missing.map((f) => ({
      organization_id: organizationId,
      engagement_id: id,
      document_id: documentId,
      field_path: f.field_path,
      value_json: f.value_json as Json,
      unit: f.unit,
      page: 1,
      bbox: BBOX as Json,
      source_text: f.source_text,
      accepted_by: session.user.id,
    }));
    const { error: factErr } = await admin.from("facts").insert(rows);
    if (factErr) throw new Error(factErr.message);

    await auditEvent({
      organizationId,
      action: "facts.seeded_demo",
      entityType: "engagement",
      entityId: id,
      payload: {
        fields: missing.map((f) => f.field_path),
        ...(adeetiePhase ? { adeetie_phase: adeetiePhase } : {}),
      },
    });

    await ensureEngagementStatus({
      organizationId,
      engagementId: id,
      current: engagement.status,
      target: "review",
    });

    return NextResponse.json({ ok: true, seeded: rows.length, ...seededExtras });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Fill in the enterprise and finance context the eligibility rules read.
 *
 * Without a recorded category the whole AD-ELG* family stays silent, which makes
 * a demo look as though the scheme checks do not exist. Only unset columns are
 * written, so anything a human already entered stands.
 */
async function seedAdeetieContext({
  admin,
  engagement,
  id,
  organizationId,
  adeetiePhase,
  userId,
}: {
  admin: NonNullable<ReturnType<typeof createServiceClient>>;
  engagement: Record<string, unknown>;
  id: string;
  organizationId: string;
  adeetiePhase: AdeetiePhase | null;
  userId: string;
}): Promise<{ enterprise: boolean; measures: number }> {
  const patch: Record<string, unknown> = {};
  if (engagement.enterprise_category == null) {
    patch.enterprise_category = ADEETIE_DEMO_ENTERPRISE.enterpriseCategory;
  }
  if (engagement.udyam_registration_no == null) {
    patch.udyam_registration_no = ADEETIE_DEMO_ENTERPRISE.udyamRegistrationNo;
  }
  if (engagement.loan_amount_inr == null) {
    patch.loan_amount_inr = ADEETIE_DEMO_ENTERPRISE.loanAmountINR;
  }
  if (engagement.project_cost_inr == null) {
    patch.project_cost_inr = ADEETIE_DEMO_ENTERPRISE.projectCostINR;
  }
  if (engagement.sanctioned_interest_rate_pct == null) {
    patch.sanctioned_interest_rate_pct = ADEETIE_DEMO_ENTERPRISE.sanctionedRatePct;
  }

  let enterprise = false;
  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from("engagements")
      // These ADEETIE columns arrive with migration 0002 and are not described
      // by the hand-written Database types.
      .update(patch as never)
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    enterprise = true;
  }

  // Measures are the DPR work product. Seeding them during IGEA would put a
  // costed project in front of a baseline that has not been signed off.
  let measures = 0;
  if (adeetiePhase === "DPR") {
    const { data: have } = await admin
      .from("adeetie_measures")
      .select("id")
      .eq("engagement_id", id)
      .eq("organization_id", organizationId);
    if ((have ?? []).length === 0) {
      const { error } = await admin.from("adeetie_measures").insert(
        ADEETIE_DEMO_MEASURES.map((m) => ({
          organization_id: organizationId,
          engagement_id: id,
          description: m.description,
          projected_annual_saving: m.projectedAnnualSaving,
          saving_unit: m.savingUnit,
          capital_cost_inr: m.capitalCostINR,
          basis: m.basis,
          created_by: userId,
        }))
      );
      if (error) throw new Error(error.message);
      measures = ADEETIE_DEMO_MEASURES.length;
    }
  }

  return { enterprise, measures };
}
