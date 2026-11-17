/**
 * Engagement acceptance and impartiality (CCTS).
 *
 * Before an ACVA verifies an entity it has to be able to say the work is
 * impartial, that it holds a contract in its own name, that the contract was
 * reviewed, and that the sector is inside its accredited scope. The BEE ACVA
 * accreditation procedure (v1.0, July 2024) says so in these places:
 *
 *   3.5      the agency is accredited for the sector scope it verifies
 *   5.5.8    no relation with the entity that is an unacceptable threat to
 *            impartiality (ownership, governance, finances, management,
 *            resources, contracts, markets)
 *   5.5.9    the agency should not verify the report of an obligated entity for
 *            which it advised on monitoring and reporting or helped develop the
 *            monitoring plan
 *   5.5.10   no common-ownership relationship with a consultancy working for the
 *            entity
 *   5.5.5    threats are monitored and measures are taken to eliminate or
 *            minimise them
 *   6.6.2    a legally enforceable contract in the agency's name
 *   6.6.3    the contract review and the justification for taking the work are
 *            recorded for every engagement
 *
 * This module turns a declaration into an outcome. It does not decide whether a
 * safeguard is adequate: it requires one to be written down, and a person reads
 * it. Declarations are versioned and immutable, like verification plans.
 */

import { z } from "zod";
import { hashCanonical } from "../canonical";

export class AcceptanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceError";
  }
}

export const MIN_SAFEGUARD_CHARS = 20;
export const MIN_JUSTIFICATION_CHARS = 20;

export const AcceptanceDeclarationSchema = z.object({
  /** 5.5.9: advised on monitoring and reporting, or helped develop the monitoring plan. */
  advisedOnMonitoringPlan: z.boolean(),
  /** 5.5.8: common ownership, governance, finances, management, resources, contracts or markets with the entity. */
  relationshipWithEntity: z.boolean(),
  /** 5.5.10: common ownership with a consultancy that works for the entity. */
  consultancyOwnershipLink: z.boolean(),
  /** 5.5.2 and 5.5.5: any other commercial, financial or other threat to impartiality. */
  otherImpartialityThreat: z.boolean(),
  /** How a declared threat is eliminated or minimised. Needed when a threat is declared and the work can still go ahead. */
  safeguards: z.string().trim().max(2000).optional(),
  /** 6.6.2 */
  contractInAgencyName: z.boolean(),
  contractReference: z.string().trim().min(2).max(200),
  /** 6.6.3: why the agency decided to take this engagement. */
  contractReviewJustification: z.string().trim().min(MIN_JUSTIFICATION_CHARS).max(2000),
  /** 3.5 */
  sectorInAccreditedScope: z.boolean(),
});

export type AcceptanceDeclaration = z.infer<typeof AcceptanceDeclarationSchema>;

export interface AcceptanceBlocker {
  code:
    | "advised_on_monitoring_plan"
    | "consultancy_ownership_link"
    | "safeguards_missing"
    | "contract_not_in_agency_name"
    | "sector_outside_scope";
  clause: string;
  message: string;
  /** True when the agency has to decline the engagement. False when something can be put right and recorded again. */
  decline: boolean;
}

export interface AcceptanceOutcome {
  outcome: "cleared" | "blocked";
  blockers: AcceptanceBlocker[];
  /** A threat was declared and the engagement goes ahead on written safeguards. */
  safeguarded: boolean;
}

export function evaluateAcceptance(d: AcceptanceDeclaration): AcceptanceOutcome {
  const blockers: AcceptanceBlocker[] = [];

  if (d.advisedOnMonitoringPlan) {
    blockers.push({
      code: "advised_on_monitoring_plan",
      clause: "ACVA accreditation procedure 5.5.9",
      message:
        "The agency advised on this entity's monitoring and reporting or helped develop its monitoring plan, so it should not verify the entity's report. Decline the engagement.",
      decline: true,
    });
  }
  if (d.consultancyOwnershipLink) {
    blockers.push({
      code: "consultancy_ownership_link",
      clause: "ACVA accreditation procedure 5.5.10",
      message:
        "The agency shares ownership with a consultancy that works for this entity. The procedure says there should be no such relationship. Decline the engagement.",
      decline: true,
    });
  }

  const threat = d.relationshipWithEntity || d.otherImpartialityThreat;
  const safeguardOk = (d.safeguards ?? "").trim().length >= MIN_SAFEGUARD_CHARS;
  if (threat && !safeguardOk) {
    blockers.push({
      code: "safeguards_missing",
      clause: "ACVA accreditation procedure 5.5.5 and 5.5.8",
      message: `An impartiality threat is declared. Say how it is eliminated or minimised (at least ${MIN_SAFEGUARD_CHARS} characters), or decline the engagement.`,
      decline: false,
    });
  }

  if (!d.contractInAgencyName) {
    blockers.push({
      code: "contract_not_in_agency_name",
      clause: "ACVA accreditation procedure 6.6.2",
      message: "The contract with the entity has to be legally enforceable and in the name of the agency.",
      decline: false,
    });
  }
  if (!d.sectorInAccreditedScope) {
    blockers.push({
      code: "sector_outside_scope",
      clause: "ACVA accreditation procedure 3.5",
      message: "The agency can verify only in the sector scopes it is accredited for. Apply for the scope, or decline.",
      decline: false,
    });
  }

  return {
    outcome: blockers.length === 0 ? "cleared" : "blocked",
    blockers,
    safeguarded: threat && safeguardOk && blockers.length === 0,
  };
}

export function acceptanceContentHash(d: AcceptanceDeclaration): string {
  return hashCanonical(d);
}

/** Schemes whose engagements need an acceptance declaration before sign-off. */
export function acceptanceRequired(scheme: string | null | undefined): boolean {
  return scheme === "CCTS";
}

export type AcceptanceStatus = "not_required" | "missing" | "blocked" | "cleared";

export interface AcceptanceState {
  status: AcceptanceStatus;
  /** True when sign-off must stop. */
  blocks: boolean;
  message: string | null;
}

export function evaluateAcceptanceState(args: {
  required: boolean;
  /** The latest recorded version, or null when none exists. */
  latest: { outcome: "cleared" | "blocked" } | null;
}): AcceptanceState {
  if (!args.required) return { status: "not_required", blocks: false, message: null };
  if (!args.latest) {
    return {
      status: "missing",
      blocks: true,
      message:
        "No engagement acceptance is recorded. Declare impartiality, the contract and the sector scope before sign-off (Plan page).",
    };
  }
  if (args.latest.outcome === "blocked") {
    return {
      status: "blocked",
      blocks: true,
      message:
        "The latest engagement acceptance has an unresolved impartiality or scope problem. Resolve it and record a new declaration, or decline the engagement.",
    };
  }
  return { status: "cleared", blocks: false, message: null };
}

export function assertAcceptanceAllowsSignoff(state: AcceptanceState): void {
  if (state.blocks && state.message) throw new AcceptanceError(state.message);
}