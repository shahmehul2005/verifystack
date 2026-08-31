import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

export interface OpenFinding {
  id: string;
  severity: "block" | "warn" | "info";
  state: string;
}

export interface ExistingSignoff {
  role: MembershipRole;
  attestor_user_id: string | null;
}

export class SignoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignoffError";
  }
}

const TERMINAL = new Set(["closed", "rejected"]);

export function openBlockFindings(findings: OpenFinding[]) {
  return findings.filter((f) => f.severity === "block" && !TERMINAL.has(f.state));
}

export function assertCanSignOff(findings: OpenFinding[]) {
  const open = openBlockFindings(findings);
  if (open.length > 0) {
    throw new SignoffError(
      `Cannot sign off with ${open.length} open block finding(s). Close or reject them first.`
    );
  }
}

export function assertMakerChecker(
  signerRole: MembershipRole,
  signerUserId: string,
  existing: ExistingSignoff[]
) {
  if (signerRole === "independent_reviewer") {
    const lead = existing.find((s) => s.role === "lead_verifier");
    if (lead?.attestor_user_id && lead.attestor_user_id === signerUserId) {
      throw new SignoffError(
        "Independent reviewer cannot be the same person as the lead verifier (maker-checker)."
      );
    }
  }
}

export function canSubmit(existing: ExistingSignoff[]) {
  const hasLead = existing.some((s) => s.role === "lead_verifier");
  const hasReviewer = existing.some((s) => s.role === "independent_reviewer");
  return hasLead && hasReviewer;
}
