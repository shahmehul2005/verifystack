import "server-only";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { AuthError, getSession, orgScope, type SessionContext } from "./getSession";

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) {
    throw new AuthError("Sign in required", 401);
  }
  return session;
}

export async function requireRole(
  roles: MembershipRole | MembershipRole[],
  organizationId?: string
): Promise<SessionContext & { organizationId: string; role: MembershipRole }> {
  const session = await requireSession();
  const allowed = Array.isArray(roles) ? roles : [roles];
  const scoped = orgScope(session, organizationId);
  if (!allowed.includes(scoped.role) && scoped.role !== "firm_admin") {
    throw new AuthError(`Requires role: ${allowed.join(" or ")}`, 403);
  }
  return { ...session, organizationId: scoped.organizationId, role: scoped.role };
}

export function assertOrgId(organizationId: string | null | undefined): string {
  if (!organizationId) {
    throw new AuthError("organization_id is required", 403);
  }
  return organizationId;
}
