import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import {
  acceptanceRequired,
  evaluateAcceptanceState,
  type AcceptanceState,
} from "@verifystack/backend/domain/engagements/acceptance";
import type { Tables } from "@verifystack/backend/lib/supabase/types";

export interface AcceptanceContext {
  required: boolean;
  state: AcceptanceState;
  versions: Tables<"engagement_acceptances">[];
}

/** The acceptance declarations for an engagement, newest first, and what they mean for sign-off now. */
export async function loadAcceptance(
  organizationId: string,
  engagement: Pick<Tables<"engagements">, "id" | "scheme">
): Promise<AcceptanceContext> {
  const required = acceptanceRequired(engagement.scheme);
  if (!required) {
    return { required, state: evaluateAcceptanceState({ required, latest: null }), versions: [] };
  }
  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) throw new Error("Supabase is not configured");
  const { data } = await supabase
    .from("engagement_acceptances")
    .select("*")
    .eq("engagement_id", engagement.id)
    .eq("organization_id", organizationId)
    .order("version", { ascending: false });
  const versions = data ?? [];
  return {
    required,
    state: evaluateAcceptanceState({ required, latest: versions[0] ?? null }),
    versions,
  };
}