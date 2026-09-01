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

/** Shown on sign-in / create account. Maps 1:1 to DFD processes. */
export const ROLE_BLURB: Record<MembershipRole, string> = {
  firm_admin: "Team, audit log, pack catalogue. Not intake, calculation, or sign-off.",
  lead_verifier: "Open engagements, run the engine, cite factors, lead sign-off (P1, P5, D8, P7).",
  verifier: "Upload evidence, extract, review fields, draft findings (P2, P3, P4, P6).",
  independent_reviewer: "Review queue and independent sign-off (P4, P7). Must be a different person from the lead.",
};

export function parseMembershipRole(value: unknown): MembershipRole | null {
  if (typeof value !== "string") return null;
  return MEMBERSHIP_ROLES.includes(value as MembershipRole) ? (value as MembershipRole) : null;
}

/** Maker-checker: lead prepares; independent reviewer must not be the same person. */
export function isMaker(role: MembershipRole) {
  return role === "lead_verifier" || role === "verifier";
}

export function isChecker(role: MembershipRole) {
  return role === "independent_reviewer";
}
