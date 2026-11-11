/**
 * Stream-Calendar Architecture Types
 *
 * Grounded in the official Bureau of Energy Efficiency (BEE) PAT-2 / CCTS Cement Sector Proforma.
 * Replaces abstract flat fact stores with a 12-Month Calendar Grid per Stream, supporting
 * three distinct source layers: Sourcing (primary), Corroboration (internal), and Pro Forma (declared).
 */

export type SourceType = "sourcing" | "corroboration" | "proforma";

export type StreamCategory =
  | "production"
  | "solid_fuel"
  | "liquid_fuel"
  | "gaseous_fuel"
  | "electricity"
  | "process";

export type EmissionScope = "scope_1" | "scope_2" | "production" | "other";

export type AggregationMethod = "sum" | "weighted_mean" | "latest";

export interface StreamDefinition {
  key: string;
  label: string;
  category: StreamCategory;
  scope: EmissionScope;
  standardUnit: string;
  aggregation: AggregationMethod;
  /** For weighted_mean, the stream key whose monthly values serve as weights (e.g. coal_quantity for coal_gcv) */
  weightStreamKey?: string;
  /** The binding path expected by the calculation engine (e.g. "production", "quantity", "calorificValue", "activeEnergy") */
  calcBindingPath: string;
  /** Official reference in BEE PAT-2 Form-Sb / Form 1 */
  proformaRef?: string;
  description?: string;
  /** Acceptable input units that can be normalized to standardUnit */
  acceptableUnits?: string[];
}

export interface CalendarMonth {
  key: string; // "2023-04"
  label: string; // "Apr 2023"
  monthIndex: number; // 0 to 11
  startDate: string; // "2023-04-01"
  endDate: string; // "2023-04-30"
}

export interface CalendarReading {
  id: string;
  engagementId: string;
  streamKey: string;
  monthKey: string; // "2023-04" or "annual"
  startDate: string;
  endDate: string;
  periodKind?: "single_reading" | "daily" | "monthly" | "quarterly" | "annual";
  readingDate?: string | null; // e.g. "2023-05-12"
  sourceType: SourceType;
  valueNumeric: number;
  unit: string;
  standardValue: number;
  standardUnit: string;
  documentId?: string | null;
  documentName?: string | null;
  provenancePage?: number | null;
  provenanceBbox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    sheet?: string;
    cellRef?: string;
  } | null;
  provenanceSourceText?: string | null;
  inputHash?: string | null;
  state: "suggested" | "accepted" | "corrected";
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

export interface MonthCell {
  monthKey: string;
  label: string;
  startDate: string;
  endDate: string;
  sourcing?: CalendarReading;
  corroboration?: CalendarReading;
  proforma?: CalendarReading;
  /** All granular readings (daily, monthly, single-reading) belonging to this month */
  allReadings?: CalendarReading[];
  /** Specific daily or single-day readings */
  dailyReadings?: CalendarReading[];
  dailyCount?: number;
  /** Percentage variance between available sources, e.g. |sourcing - corroboration| / sourcing * 100 */
  variancePercent?: number | null;
  /** High variance (> 5%) flagged for audit attention */
  hasVarianceAlert?: boolean;
  isComplete: boolean;
}

export interface AnnualRollup {
  value: number | null;
  unit: string;
  aggregation: AggregationMethod;
  completedMonthsCount: number;
  totalMonthsCount: number;
  isComplete: boolean;
  proformaAnnual?: number | null;
  varianceToProformaPercent?: number | null;
  sourceType: SourceType;
}

export interface StreamCalendarRow {
  stream: StreamDefinition;
  months: MonthCell[];
  annualRollup: AnnualRollup;
}

export interface CalendarGridCategory {
  category: StreamCategory;
  label: string;
  scope: EmissionScope;
  rows: StreamCalendarRow[];
}

export interface CalendarGridData {
  engagementId: string;
  complianceYear: string;
  months: CalendarMonth[];
  categories: CalendarGridCategory[];
  summary: {
    totalStreams: number;
    activeStreamsCount: number;
    complete12MonthStreams: number;
    totalReadingsCount: number;
    varianceAlertsCount: number;
  };
}

