import "server-only";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { walkStatus, type Status } from "@verifystack/backend/domain/engagements/status";
import type { AdeetiePhase } from "@verifystack/backend/domain/packs/adeetie/phases";
import type { Tables } from "@verifystack/backend/lib/supabase/types";

async function dataClient() {
  return createServiceClient() ?? (await createServerSupabase());
}

export async function listEngagements(organizationId: string) {
  const supabase = await dataClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("engagements")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Tables<"engagements">[];
}

export async function getEngagement(id: string, organizationId: string) {
  const supabase = await dataClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("engagements")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Tables<"engagements"> | null;
}

/** Move the engagement forward to `target` (never backwards). */
export async function ensureEngagementStatus(opts: {
  organizationId: string;
  engagementId: string;
  current: string;
  target: Status;
}): Promise<Status> {
  const from = opts.current as Status;
  const walked = walkStatus(from, opts.target);
  if (walked.length === 0) return from;
  const to = walked[walked.length - 1]!;
  const supabase = await dataClient();
  if (!supabase) return from;
  const { error } = await supabase
    .from("engagements")
    .update({ status: to })
    .eq("id", opts.engagementId)
    .eq("organization_id", opts.organizationId);
  if (error) throw new Error(error.message);
  await auditEvent({
    organizationId: opts.organizationId,
    action: "engagement.status",
    entityType: "engagement",
    entityId: opts.engagementId,
    payload: { from, to, walked },
  });
  return to;
}

/**
 * Open the next ADEETIE pass. Status restarts at setup; pack bind is untouched.
 * The caller has already passed assertPhaseAdvanceReady.
 */
export async function resetForAdeetiePhase(opts: {
  organizationId: string;
  engagementId: string;
  fromPhase: AdeetiePhase;
  fromStatus: Status;
  toPhase: AdeetiePhase;
}): Promise<void> {
  const supabase = await dataClient();
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }
  const { error } = await supabase
    .from("engagements")
    .update({ status: "setup", adeetie_phase: opts.toPhase })
    .eq("id", opts.engagementId)
    .eq("organization_id", opts.organizationId);
  if (error) throw new Error(error.message);
  await auditEvent({
    organizationId: opts.organizationId,
    action: "engagement.adeetie_phase",
    entityType: "engagement",
    entityId: opts.engagementId,
    payload: {
      fromPhase: opts.fromPhase,
      toPhase: opts.toPhase,
      fromStatus: opts.fromStatus,
      toStatus: "setup",
    },
  });
}
