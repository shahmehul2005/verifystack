import { z } from "zod";
import { ENTERPRISE_CATEGORIES } from "../packs/adeetie/scheme";

/**
 * The fields needed to create an engagement. One schema for the setup wizard
 * and for bulk import, so a row imported from a spreadsheet is held to exactly
 * the rules a person typing into the wizard is.
 *
 * Every ADEETIE field is optional: an ADEETIE row is filled progressively
 * across IGEA, DPR and M&V, and whether a missing value matters is a rules
 * question per phase (migration 0002).
 */
export const EngagementCreateSchema = z.object({
  packId: z.string().max(80),
  clientName: z.string().trim().min(1).max(200),
  plantName: z.string().trim().max(200).optional(),
  complianceYear: z.string().trim().min(4).max(20),
  geiTarget: z.number().nullable().optional(),
  adeetieCluster: z.string().max(200).nullable().optional(),
  adeetieState: z.string().max(100).nullable().optional(),
  enterpriseCategory: z.enum(ENTERPRISE_CATEGORIES).nullable().optional(),
  udyamRegistrationNo: z.string().max(40).nullable().optional(),
  loanAmountInr: z.number().nonnegative().nullable().optional(),
  projectCostInr: z.number().nonnegative().nullable().optional(),
  sanctionedInterestRatePct: z.number().nonnegative().nullable().optional(),
  /**
   * Held on the audit event rather than on the engagement: a claimed distance is
   * an assertion by the applicant, not a property anything should read back as fact.
   */
  claimedDistanceToClusterKm: z.number().nonnegative().nullable().optional(),
});

export type EngagementCreate = z.infer<typeof EngagementCreateSchema>;
