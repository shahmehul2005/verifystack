import type { Quantity } from "../units";
import type { CalcResult } from "../calc/engine";

export type Severity = "block" | "warn" | "info";

export interface RuleFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  /** Plain factual statement of what was observed. No interpretation, no advice. */
  detail: string;
  /** Clause of the governing procedure this check enforces. */
  clauseRef: string;
  /** extracted_fact / evidence ids supporting the finding. */
  evidenceRefs: string[];
  /** Populated only where the rule computes a magnitude, e.g. a discrepancy. */
  magnitude?: { value: number; unit: string };
}

export interface MonthlySeriesPoint {
  /** ISO month, e.g. "2025-04". */
  month: string;
  quantity: Quantity;
  factIds: string[];
}

export interface StockMovement {
  streamId: string;
  openingStock: Quantity;
  purchases: Quantity;
  closingStock: Quantity;
  reportedConsumption: Quantity;
  factIds: string[];
}

export interface LabCertificate {
  certificateId: string;
  labName: string;
  /** NABL accreditation certificate number, if the lab is accredited. */
  nablAccreditationNo?: string;
  /** ISO date the NABL accreditation expires. */
  nablValidUntil?: string;
  /** ISO date the sample was tested. */
  testDate: string;
  fuelKey: string;
  calorificValue: Quantity;
  calorificBasis: "NCV" | "GCV";
  factIds: string[];
}

export interface SamplingRecord {
  materialKind: "coal" | "raw_material";
  month: string;
  samplesTaken: number;
  throughput: Quantity;
  factIds: string[];
}

export interface ReconciliationContext {
  complianceYear: string;
  /** Months expected in a complete series for this compliance year. */
  expectedMonths: string[];
  calc: CalcResult;
  monthlySeries: Record<string, MonthlySeriesPoint[]>;
  stockMovements: StockMovement[];
  labCertificates: LabCertificate[];
  samplingRecords: SamplingRecord[];
  /** Grid factor vintage the entity actually used, for vintage checking. */
  gridFactorVintageUsed?: string;
  materialityPct?: number;
  /** Tolerance for stock balance reconciliation, as a fraction. */
  stockTolerancePct?: number;
}

export interface Rule {
  id: string;
  title: string;
  clauseRef: string;
  run(ctx: ReconciliationContext): RuleFinding[];
}
