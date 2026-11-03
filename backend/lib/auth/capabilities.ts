import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

/**
 * DFD-aligned capabilities. Nav, pages, and APIs must all call `hasCapability`.
 * Firm admin is firm ops (D7 audit, team) — not a bypass for P2–P7.
 *
 *   P1 Engagement & pack setup     → engagements.create
 *   P2 Document intake             → documents.upload
 *   P3 Extraction trigger          → documents.extract
 *   P4 Human review gate           → review.decide
 *   P5 Calculation run             → runs.execute
 *   P6 Findings                    → findings.decide
 *   P7 Lead / independent sign-off → signoff.lead / signoff.reviewer
 *   13.0 Verification planning     → plan.manage
 *   14.0 Fieldwork capture         → fieldwork.record
 *   8.4  Independent tech review   → review.technical
 *   1.0  Stage manager / bulk load → engagements.stage / engagements.import
 *   D3 Pack catalogue              → nav.packs
 *   D7 Audit log                   → nav.audit
 *   D8 Factor register             → nav.factors / factors.verify
 */
export const CAPABILITIES = [
  "nav.engagements",
  "nav.reviewQueue",
  "nav.packs",
  "nav.factors",
  "nav.audit",
  "nav.team",
  "engagements.create",
  "engagements.draftMode",
  "documents.view",
  "documents.upload",
  "documents.extract",
  "review.decide",
  "runs.view",
  "runs.execute",
  "findings.decide",
  "signoff.lead",
  "signoff.reviewer",
  "plan.manage",
  "fieldwork.record",
  "review.technical",
  "engagements.stage",
  "engagements.import",
  "reports.download",
  "factors.verify",
  "adeetie.view",
  "adeetie.operate",
  "team.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<MembershipRole, readonly Capability[]> = {
  firm_admin: [
    "nav.engagements",
    "nav.packs",
    "nav.audit",
    "nav.team",
    "documents.view",
    "reports.download",
    "team.manage",
  ],
  lead_verifier: [
    "nav.engagements",
    "nav.reviewQueue",
    "nav.packs",
    "engagements.create",
    "engagements.draftMode",
    "documents.view",
    "documents.upload",
    "documents.extract",
    "review.decide",
    "runs.view",
    "runs.execute",
    "findings.decide",
    "signoff.lead",
    "plan.manage",
    "fieldwork.record",
    "engagements.stage",
    "engagements.import",
    "reports.download",
    "factors.verify",
    "adeetie.view",
    "adeetie.operate",
  ],
  verifier: [
    "nav.engagements",
    "nav.reviewQueue",
    "nav.packs",
    "documents.view",
    "documents.upload",
    "documents.extract",
    "review.decide",
    "runs.view",
    "findings.decide",
    "fieldwork.record",
    "reports.download",
    "adeetie.view",
  ],
  independent_reviewer: [
    "nav.engagements",
    "nav.reviewQueue",
    "nav.packs",
    "documents.view",
    "review.decide",
    "runs.view",
    "findings.decide",
    "signoff.reviewer",
    "review.technical",
    "reports.download",
    "adeetie.view",
  ],
};

export const APP_NAV: { href: string; label: string; capability: Capability }[] = [
  { href: "/engagements", label: "Engagements", capability: "nav.engagements" },
  { href: "/review-queue", label: "Review queue", capability: "nav.reviewQueue" },
  { href: "/packs", label: "Packs", capability: "nav.packs" },
  { href: "/factors", label: "Factors", capability: "nav.factors" },
  { href: "/audit", label: "Audit log", capability: "nav.audit" },
  { href: "/team", label: "Team", capability: "nav.team" },
];

/** In the order the work is done: plan, intake, review the extracted values, cross-check, fieldwork, calculate, then findings and sign-off. */
export const ENGAGEMENT_LINKS: { slug: string; label: string; capability: Capability }[] = [
  { slug: "plan", label: "Plan", capability: "runs.view" },
  { slug: "documents", label: "Documents", capability: "documents.view" },
  { slug: "workbench", label: "Workbench", capability: "review.decide" },
  { slug: "facts", label: "Facts ledger", capability: "review.decide" },
  { slug: "desk-review", label: "Desk review", capability: "review.decide" },
  { slug: "fieldwork", label: "Fieldwork", capability: "fieldwork.record" },
  { slug: "runs", label: "Calculation", capability: "runs.view" },
  { slug: "findings", label: "Findings", capability: "findings.decide" },
  { slug: "ecm", label: "ECM suggestions", capability: "adeetie.view" },
  { slug: "technical-review", label: "Technical review", capability: "review.technical" },
  { slug: "signoff", label: "Sign-off", capability: "signoff.lead" },
  { slug: "package", label: "Submission package", capability: "signoff.lead" },
];

export function hasCapability(
  role: MembershipRole | null | undefined,
  capability: Capability
): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function hasAnyCapability(
  role: MembershipRole | null | undefined,
  capabilities: readonly Capability[]
): boolean {
  return capabilities.some((c) => hasCapability(role, c));
}

/**
 * No role means no membership in any organisation yet. Such a user has nothing
 * to navigate to — every page behind these links reads org-scoped data — so the
 * shell shows an empty rail and the bootstrap prompt does the talking.
 */
export function navForRole(role: MembershipRole | null | undefined) {
  if (!role) return [];
  return APP_NAV.filter((item) => hasCapability(role, item.capability));
}

export function engagementLinksForRole(role: MembershipRole | null | undefined) {
  return ENGAGEMENT_LINKS.filter((item) => {
    if (item.slug === "signoff") {
      return hasCapability(role, "signoff.lead") || hasCapability(role, "signoff.reviewer");
    }
    if (item.slug === "technical-review") {
      // The lead sees the review status; only the independent reviewer decides.
      return hasCapability(role, "review.technical") || hasCapability(role, "signoff.lead");
    }
    return hasCapability(role, item.capability);
  });
}

export function homePathFor(role: MembershipRole | null | undefined): string {
  if (role === "firm_admin") return "/team";
  return "/engagements";
}
