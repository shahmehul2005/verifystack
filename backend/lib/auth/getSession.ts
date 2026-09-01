import "server-only";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import type { MembershipRole, Tables } from "@verifystack/backend/lib/supabase/types";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SessionContext {
  user: User;
  memberships: Tables<"memberships">[];
  organizationId: string | null;
  role: MembershipRole | null;
}

export async function getSession(): Promise<SessionContext | null> {
  const supabase = await createServerSupabase();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Ordered so the primary membership is stable across requests. Without an
  // order the row Postgres happens to return first decides which organisation
  // and role the whole session runs under, which would make authorisation
  // non-deterministic the moment a user belongs to two firms.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .order("organization_id", { ascending: true });

  let list = memberships ?? [];
  // Pre-0006 RLS deadlock: the user client cannot see memberships it owns.
  // Service role bypasses RLS so bootstrap can take effect immediately.
  if (list.length === 0) {
    const admin = createServiceClient();
    if (admin) {
      const { data: adminRows } = await admin
        .from("memberships")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .order("organization_id", { ascending: true });
      list = adminRows ?? [];
    }
  }
  const primary = list[0] ?? null;

  return {
    user,
    memberships: list,
    organizationId: primary?.organization_id ?? null,
    role: primary?.role ?? null,
  };
}

export function orgScope(session: SessionContext, organizationId?: string | null) {
  const orgId = organizationId ?? session.organizationId;
  if (!orgId) {
    throw new AuthError("No organization in session", 403);
  }
  const membership = session.memberships.find((m) => m.organization_id === orgId);
  if (!membership) {
    throw new AuthError("Not a member of this organization", 403);
  }
  return { organizationId: orgId, role: membership.role, membership };
}
