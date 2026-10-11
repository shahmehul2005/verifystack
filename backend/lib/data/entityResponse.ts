import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { verifyResponseLink, type ResponseLinkPayload } from "@verifystack/backend/lib/auth/responseLink";
import type { Tables } from "@verifystack/backend/lib/supabase/types";

export interface ResponseTarget {
  payload: ResponseLinkPayload;
  finding: Tables<"findings">;
  engagement: Tables<"engagements">;
  firmName: string;
}

export type ResolveResult =
  | { ok: true; target: ResponseTarget }
  /** `invalid`: not a token this server signed, or expired. `inactive`: signed and current but revoked or already answered. */
  | { ok: false; reason: "invalid" | "inactive" | "unavailable" };

/**
 * Resolve a response link to the one issue it opens.
 *
 * A token alone is not enough. The issue must still be open with the entity AND
 * carry the same nonce the token was minted with, so a revoked, replaced or
 * already-used link stops working even before its expiry.
 */
export async function resolveResponseLink(token: string): Promise<ResolveResult> {
  const payload = verifyResponseLink(token);
  if (!payload) return { ok: false, reason: "invalid" };
  const admin = createServiceClient();
  if (!admin) return { ok: false, reason: "unavailable" };

  const { data: finding } = await admin
    .from("findings")
    .select("*")
    .eq("id", payload.findingId)
    .eq("organization_id", payload.organizationId)
    .eq("engagement_id", payload.engagementId)
    .maybeSingle();
  if (!finding || finding.state !== "open" || !finding.response_nonce || finding.response_nonce !== payload.nonce) {
    return { ok: false, reason: "inactive" };
  }

  const [{ data: engagement }, { data: org }] = await Promise.all([
    admin.from("engagements").select("*").eq("id", finding.engagement_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", payload.organizationId).maybeSingle(),
  ]);
  if (!engagement) return { ok: false, reason: "inactive" };

  return {
    ok: true,
    target: { payload, finding, engagement, firmName: org?.name ?? "Your verifier" },
  };
}
