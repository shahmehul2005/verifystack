/**
 * ADEETIE scheme parameters.
 *
 * "Assistance in Deploying Energy Efficient Technologies in Industries &
 * Establishments" — Bureau of Energy Efficiency, Ministry of Power.
 *
 * Every number here is a hard gate that decides whether an enterprise gets money,
 * so each one carries the clause it comes from and a verification marker. These
 * were compiled from the BEE scheme description; none has been read back against
 * the operative scheme guidelines document. Treat all of them as TO VERIFY.
 */

export const ADEETIE_SCHEME = {
  id: "ADEETIE",
  name:
    "Assistance in Deploying Energy Efficient Technologies in Industries & Establishments",
  administrator: "Bureau of Energy Efficiency (BEE), Ministry of Power",
  implementationPeriod: "FY2025-26 to FY2027-28",
  outlayCroreINR: 1_000,
  homepage: "https://adeetie.beeindia.gov.in/",
  sourceNote:
    "BEE ADEETIE scheme description — TO VERIFY every parameter below against the operative scheme guidelines before an eligibility determination is relied on.",
} as const;

/** MSME classification. Drives the subvention rate and the reimbursement cap. */
export const ENTERPRISE_CATEGORIES = ["Micro", "Small", "Medium"] as const;
export type EnterpriseCategory = (typeof ENTERPRISE_CATEGORIES)[number];

/**
 * Loan size window. Outside this range the project is not eligible.
 * Held in rupees to avoid lakh/crore ambiguity anywhere in the codebase.
 */
export const LOAN_MIN_INR = 10_00_000; //  10 lakh
export const LOAN_MAX_INR = 15_00_00_000; //  15 crore

/** Share of project cost that may be met by qualifying debt. */
export const MAX_DEBT_FUNDING_PCT = 75;

/** Minimum energy savings, achieved and sustained, before subvention releases. */
export const MIN_ENERGY_SAVINGS_PCT = 10;

/** Interest subvention rate by enterprise category, in percentage points. */
export const SUBVENTION_PCT: Record<EnterpriseCategory, number> = {
  Micro: 5,
  Small: 5,
  Medium: 3,
};

/**
 * Floor on what the borrower actually pays. Subvention is capped so the net rate
 * never falls below this, which means the subvention applied is not always the
 * headline rate.
 */
export const MIN_NET_BORROWING_RATE_PCT = 2;

/** IGEA and DPR preparation cost reimbursement ceiling, per project or loan. */
export const AUDIT_REIMBURSEMENT_CAP_INR: Record<EnterpriseCategory, number> = {
  Micro: 75_000,
  Small: 75_000,
  Medium: 1_00_000,
};

/**
 * Distance provision: an enterprise outside a notified cluster may still qualify
 * if it lies within this distance of a notified cluster boundary.
 *
 * This is handled as a reviewable exception, never an automatic pass. Distance to
 * a cluster *boundary* needs the notified boundary geometry, which this system does
 * not hold, so a claimed distance is evidence to be checked, not a computation.
 */
export const CLUSTER_PROXIMITY_KM = 200;

export const ADEETIE_CLAUSE_REFS = {
  savings: "ADEETIE scheme — minimum 10% energy savings, achieved and sustained (TO VERIFY)",
  udyam: "ADEETIE scheme — MSME must hold a valid Udyam Registration (TO VERIFY)",
  cluster:
    "ADEETIE scheme — enterprise must operate in a notified cluster or within 200 km of a notified cluster boundary (TO VERIFY)",
  loanRange: "ADEETIE scheme — eligible loan size Rs 10 lakh to Rs 15 crore (TO VERIFY)",
  debtShare: "ADEETIE scheme — up to 75% debt funding of project cost qualifies (TO VERIFY)",
  subvention:
    "ADEETIE scheme — interest subvention 5% Micro/Small, 3% Medium, subject to a minimum net borrowing rate of 2% (TO VERIFY)",
  reimbursement:
    "ADEETIE scheme — IGEA/DPR cost reimbursement up to Rs 1 lakh Medium, Rs 75,000 Micro/Small, per project or loan (TO VERIFY)",
  igea:
    "ADEETIE scheme — Investment Grade Energy Audit by a BEE-empanelled Certified/Accredited Energy Auditor firm (TO VERIFY)",
  dpr: "ADEETIE scheme — Detailed Project Report on the BEE template (TO VERIFY)",
  mv: "ADEETIE scheme — post-implementation Monitoring & Verification (TO VERIFY)",
  energyBalance:
    "BEE General Guidelines for Energy Audit — energy balance closure (TO VERIFY)",
  calibration:
    "Legal Metrology / BEE audit guidelines — validity of measuring instrument calibration (TO VERIFY)",
} as const;

/**
 * Interest subvention computation.
 *
 * Code computes; nothing here is inferred by a model. The subvention applied is
 * the lesser of the category rate and the headroom above the minimum net rate.
 */
export interface SubventionInput {
  category: EnterpriseCategory;
  /** Rate the FI sanctioned the loan at, in percent per annum. */
  sanctionedRatePct: number;
  /** Principal outstanding the subvention is computed on, in rupees. */
  principalINR: number;
}

export interface SubventionResult {
  category: EnterpriseCategory;
  headlineSubventionPct: number;
  /** Subvention actually applicable once the net-rate floor is respected. */
  appliedSubventionPct: number;
  netBorrowingRatePct: number;
  /** Annual interest relief in rupees, before any sustained-savings gate. */
  annualReliefINR: number;
  cappedByNetRateFloor: boolean;
  clauseRef: string;
  notes: string[];
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function computeSubvention(input: SubventionInput): SubventionResult {
  const headline = SUBVENTION_PCT[input.category];
  const headroom = input.sanctionedRatePct - MIN_NET_BORROWING_RATE_PCT;
  const applied = Math.max(0, Math.min(headline, headroom));
  const notes: string[] = [];

  if (headroom < headline) {
    notes.push(
      `Sanctioned rate ${input.sanctionedRatePct}% leaves only ${round(headroom, 4)} percentage points ` +
        `above the ${MIN_NET_BORROWING_RATE_PCT}% minimum net borrowing rate, so the full ` +
        `${headline}% subvention cannot be applied.`
    );
  }
  if (headroom <= 0) {
    notes.push(
      `Sanctioned rate is at or below the minimum net borrowing rate, so no subvention is payable.`
    );
  }

  return {
    category: input.category,
    headlineSubventionPct: headline,
    appliedSubventionPct: round(applied, 4),
    netBorrowingRatePct: round(input.sanctionedRatePct - applied, 4),
    annualReliefINR: round((input.principalINR * applied) / 100, 2),
    cappedByNetRateFloor: headroom < headline,
    clauseRef: ADEETIE_CLAUSE_REFS.subvention,
    notes,
  };
}

/** Rupee formatting helper for reports. Uses the Indian digit grouping. */
export function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
