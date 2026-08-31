import "server-only";
import {
  applyVerifications,
  buildFactorSet,
  type FactorSet,
  type FactorVerification,
} from "@verifystack/backend/domain/factors";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";

const CATALOGUE_VERSION = "verifystack-factors-0.2.0";

interface StateRow {
  factor_id: string;
  vintage: string;
  verified: boolean;
  current_value: number | null;
  cited_source: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

/**
 * Catalogue plus this organisation's human verifications. Unverified catalogue
 * values stay unverified. A run that does not load this still sees placeholders.
 */
export async function factorSetForOrganization(organizationId: string): Promise<FactorSet> {
  const base = buildFactorSet(CATALOGUE_VERSION);
  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) return base;

  const { data, error } = await supabase
    .from("factor_verification_state")
    .select("factor_id, vintage, verified, current_value, cited_source, verified_by, verified_at")
    .eq("organization_id", organizationId)
    .eq("verified", true);
  if (error || !data?.length) return base;

  const verifications: FactorVerification[] = [];
  for (const row of data as StateRow[]) {
    if (!row.cited_source || !row.verified_by || !row.verified_at) continue;
    verifications.push({
      factorId: row.factor_id,
      vintage: row.vintage,
      citedSource: row.cited_source,
      ...(row.current_value != null ? { correctedValue: Number(row.current_value) } : {}),
      verifiedBy: row.verified_by,
      verifiedAt: row.verified_at,
    });
  }
  if (verifications.length === 0) return base;

  const ids = verifications.map((v) => `${v.factorId}@${v.vintage}`).sort();
  return applyVerifications(base, verifications, `${CATALOGUE_VERSION}+${ids.join(",")}`);
}
