import "server-only";
import { canStartWork, loadPack } from "../../domain/packs";
import { initialStage } from "../../domain/stages/stages";
import type { EngagementCreate } from "../../domain/engagements/schema";
import { auditEvent } from "../auth/auditEvent";
import type { Database } from "../supabase/types";
import type { createServiceClient } from "../supabase/admin";

type EngagementInsert = Database["public"]["Tables"]["engagements"]["Insert"];
type Client = NonNullable<ReturnType<typeof createServiceClient>>;

export class EngagementCreateError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message);
    this.name = "EngagementCreateError";
  }
}

/**
 * The one place an engagement row is created, used by the setup wizard route
 * and by bulk import so both write exactly the same columns and audit event.
 */
export async function createEngagementRecord(args: {
  supabase: Client;
  organizationId: string;
  actorUserId: string;
  input: EngagementCreate;
  via?: "wizard" | "bulk_import";
  importBatchId?: string;
}) {
  const { supabase, organizationId, actorUserId, input } = args;
  const pack = loadPack(input.packId);
  if (pack.structure_only) {
    throw new EngagementCreateError(
      "This pack describes a methodology's structure only. No engagement can be started on it."
    );
  }

  const isAdeetie = pack.scheme === "ADEETIE";
  const base: EngagementInsert = {
    organization_id: organizationId,
    pack_id: pack.pack_id,
    pack_version: pack.version,
    scheme: pack.scheme as "CCTS" | "ADEETIE", // structure-only schemes were refused above
    sector_or_cluster: pack.sector_or_cluster,
    client_name: input.clientName,
    plant_name: input.plantName ?? null,
    compliance_year: input.complianceYear,
    gei_target: input.geiTarget ?? null,
    status: "setup",
    draft_mode: false,
    created_by: actorUserId,
  };

  // Columns added by migrations 0002, 0009 and 0014, which the hand-written
  // Database types do not describe.
  const stage = initialStage(pack.stages);
  const extra = {
    ...(stage ? { stage } : {}),
    ...(isAdeetie
      ? {
          adeetie_cluster: input.adeetieCluster ?? null,
          adeetie_state: input.adeetieState ?? null,
          enterprise_category: input.enterpriseCategory ?? null,
          udyam_registration_no: input.udyamRegistrationNo ?? null,
          loan_amount_inr: input.loanAmountInr ?? null,
          project_cost_inr: input.projectCostInr ?? null,
          sanctioned_interest_rate_pct: input.sanctionedInterestRatePct ?? null,
          adeetie_phase: "IGEA",
          claimed_distance_to_cluster_km: input.claimedDistanceToClusterKm ?? null,
        }
      : {}),
  };

  const { data, error } = await supabase
    .from("engagements")
    .insert({ ...base, ...extra } as EngagementInsert)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await auditEvent({
    organizationId,
    actorUserId,
    action: "engagement.created",
    entityType: "engagement",
    entityId: data.id,
    payload: {
      pack_id: pack.pack_id,
      runnable: canStartWork(pack),
      via: args.via ?? "wizard",
      ...(args.importBatchId ? { import_batch_id: args.importBatchId } : {}),
      ...(stage ? { stage } : {}),
      ...(isAdeetie
        ? {
            adeetie_phase: "IGEA",
            adeetie_cluster: input.adeetieCluster ?? null,
            notified_cluster_claimed: Boolean(input.adeetieCluster),
            claimed_distance_to_cluster_km: input.claimedDistanceToClusterKm ?? null,
            cluster_list_verified: pack.adeetie?.clustersVerified ?? false,
          }
        : {}),
    },
  });
  return data;
}
