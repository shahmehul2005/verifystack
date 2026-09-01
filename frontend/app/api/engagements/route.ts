import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { loadPack, canStartWork } from "@verifystack/backend/domain/packs";
import { ENTERPRISE_CATEGORIES } from "@verifystack/backend/domain/packs/adeetie";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import type { Database } from "@verifystack/backend/lib/supabase/types";

type EngagementInsert = Database["public"]["Tables"]["engagements"]["Insert"];

const Body = z.object({
  packId: z.string(),
  clientName: z.string().min(1),
  plantName: z.string().optional(),
  complianceYear: z.string().min(4),
  geiTarget: z.number().nullable().optional(),
  // ADEETIE header data. Every field is optional: migration 0002 adds these as
  // nullable columns because an ADEETIE row is populated progressively across
  // the IGEA -> DPR -> M&V phases, and presence is a rules question per phase.
  adeetieCluster: z.string().nullable().optional(),
  adeetieState: z.string().nullable().optional(),
  enterpriseCategory: z.enum(ENTERPRISE_CATEGORIES).nullable().optional(),
  udyamRegistrationNo: z.string().nullable().optional(),
  loanAmountInr: z.number().nonnegative().nullable().optional(),
  projectCostInr: z.number().nonnegative().nullable().optional(),
  sanctionedInterestRatePct: z.number().nonnegative().nullable().optional(),
  /**
   * Held on the audit event rather than on the engagement: there is no column
   * for it, and a claimed distance is an assertion by the applicant, not a
   * property of the engagement that anything should read back as fact.
   */
  claimedDistanceToClusterKm: z.number().nonnegative().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireCapability("engagements.create");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const pack = loadPack(parsed.data.packId);
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const isAdeetie = pack.scheme === "ADEETIE";
    const base: EngagementInsert = {
      organization_id: organizationId,
      pack_id: pack.pack_id,
      pack_version: pack.version,
      scheme: pack.scheme,
      sector_or_cluster: pack.sector_or_cluster,
      client_name: parsed.data.clientName,
      plant_name: parsed.data.plantName ?? null,
      compliance_year: parsed.data.complianceYear,
      gei_target: parsed.data.geiTarget ?? null,
      status: "setup",
      draft_mode: true,
      created_by: session.user.id,
    };

    // Columns added by migration 0002, which the hand-written Database types in
    // backend/lib/supabase/types.ts do not describe yet.
    const adeetieColumns = isAdeetie
      ? {
          adeetie_cluster: parsed.data.adeetieCluster ?? null,
          adeetie_state: parsed.data.adeetieState ?? null,
          enterprise_category: parsed.data.enterpriseCategory ?? null,
          udyam_registration_no: parsed.data.udyamRegistrationNo ?? null,
          loan_amount_inr: parsed.data.loanAmountInr ?? null,
          project_cost_inr: parsed.data.projectCostInr ?? null,
          sanctioned_interest_rate_pct: parsed.data.sanctionedInterestRatePct ?? null,
          adeetie_phase: "IGEA",
          // Migration 0009. Without this the 200 km proximity claim is only in
          // the audit trail and AD-ELG002 cannot evaluate it.
          claimed_distance_to_cluster_km: parsed.data.claimedDistanceToClusterKm ?? null,
        }
      : {};

    const { data, error } = await supabase
      .from("engagements")
      .insert({ ...base, ...adeetieColumns } as EngagementInsert)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      action: "engagement.created",
      entityType: "engagement",
      entityId: data.id,
      payload: {
        pack_id: pack.pack_id,
        runnable: canStartWork(pack),
        ...(isAdeetie
          ? {
              adeetie_phase: "IGEA",
              adeetie_cluster: parsed.data.adeetieCluster ?? null,
              notified_cluster_claimed: Boolean(parsed.data.adeetieCluster),
              claimed_distance_to_cluster_km:
                parsed.data.claimedDistanceToClusterKm ?? null,
              cluster_list_verified: pack.adeetie?.clustersVerified ?? false,
            }
          : {}),
      },
    });
    return NextResponse.json({ ok: true, engagement: data });
  } catch (e) {
    return jsonError(e);
  }
}
