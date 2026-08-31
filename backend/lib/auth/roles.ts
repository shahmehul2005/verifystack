import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

export const MEMBERSHIP_ROLES: MembershipRole[] = [
  "firm_admin",
  "lead_verifier",
  "verifier",
  "independent_reviewer",
];

export const ROLE_LABEL: Record<MembershipRole, string> = {
  firm_admin: "Firm admin",
  lead_verifier: "Lead verifier",
  verifier: "Verifier",
  independent_reviewer: "Independent reviewer",
};

/** Maker-checker: lead prepares; independent reviewer must not be the same person. */
export function isMaker(role: MembershipRole) {
  return role === "lead_verifier" || role === "verifier" || role === "firm_admin";
}

export function isChecker(role: MembershipRole) {
  return role === "independent_reviewer" || role === "firm_admin";
}
