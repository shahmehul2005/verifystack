import { parseMembershipRole } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

export const INTENDED_ROLE_KEY = "verifystack.intended_role";

export function rememberIntendedRole(role: MembershipRole) {
  sessionStorage.setItem(INTENDED_ROLE_KEY, role);
}

export function readIntendedRole(): MembershipRole | null {
  if (typeof window === "undefined") return null;
  return parseMembershipRole(sessionStorage.getItem(INTENDED_ROLE_KEY));
}

export function takeIntendedRole(): MembershipRole | null {
  const role = readIntendedRole();
  sessionStorage.removeItem(INTENDED_ROLE_KEY);
  return role;
}
