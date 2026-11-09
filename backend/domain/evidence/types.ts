/**
 * Canonical Evidence Values — domain types.
 *
 * This module defines the TypeScript surface for the `canonical_evidence_values`
 * table introduced in migration 0026.
 *
 * POSITION IN THE PIPELINE
 * ------------------------
 *
 *   Document
 *     → extracted_fields  (AI extraction, state machine: suggested → accepted)
 *     → CanonicalEvidenceValue  (linked by extracted_field_id, or created from
 *                                desk_readings / regex proposals / site obs)
 *       → Roll-up aggregate CanonicalEvidenceValue  (monthly → annual)
 *         → facts row  (the calculation engine reads from facts, not from here)
 *
 * INVARIANTS (enforced by DB triggers and application code)
 * ---------------------------------------------------------
 * 1. Code computes; models never do — no AI output may ever become
 *    standard_value or any value used in a calculation without an auditor
 *    review step first (state must reach 'accepted' or 'corrected').
 * 2. Append-only: once a row reaches 'accepted' / 'corrected', its core
 *    evidence columns are immutable. Corrections write new column values
 *    (correction_*) on the same row; withdrawals set state = 'withdrawn'.
 * 3. Only an annual row (period_kind = 'annual') in state 'accepted' or
 *    'corrected' may produce a facts row (fact_id becomes non-null).
 * 4. Every value must carry provenance. AI-extracted rows require at minimum
 *    provenance_page + provenance_source_text. Manual rows require
 *    document_id + page at minimum.
 */

// ---------------------------------------------------------------------------
// String literal union types (must mirror the CHECK constraints in 0026)
// ---------------------------------------------------------------------------

export type CevExtractionMethod =
  | "ai_extraction"   // Gemini / other LLM extracted from PDF / image
  | "workbook_reader" // computed by a WorkbookReader from XLSX SCADA data
  | "regex_propose"   // propose.ts pattern-matched the corroboration reading
  | "manual_entry"    // auditor typed the value in the corroboration drawer
  | "site_observation"; // site visit instrument or interview note

export type CevPeriodKind =
  | "daily"           // a single calendar day
  | "monthly"         // one calendar month (period_start = first day of month)
  | "quarterly"       // one calendar quarter
  | "annual"          // one compliance year (1 Apr – 31 Mar)
  | "single_reading"  // one certificate / one slip (no inherent span)
  | "document_period"; // whatever period the document states

export type CevState =
  | "suggested"       // created by automation (AI, regex, workbook reader)
  | "pending_review"  // flagged for mandatory human review before use
  | "accepted"        // auditor confirmed the value is correct
  | "corrected"       // auditor overrode the value (correction_* columns set)
  | "rejected"        // auditor discarded the value
  | "withdrawn";      // previously accepted/corrected row was retracted

export type CevAggregationMethod =
  | "sum"             // arithmetic sum (coal tonnes, kWh)
  | "mean"            // simple arithmetic mean (GCV samples)
  | "weighted_mean"   // mass-weighted mean (GCV across coal lots)
  | "point_in_time";  // one child row selected as representative

// ---------------------------------------------------------------------------
// Bounding box (same normalised form used by extracted_fields)
// ---------------------------------------------------------------------------

export interface CevBbox {
  x: number;      // left edge, 0–1 of page width
  y: number;      // top edge, 0–1 of page height
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Row type — mirrors the full table column set
// ---------------------------------------------------------------------------

export interface CanonicalEvidenceValue {
  id: string;
  organization_id: string;
  engagement_id: string;

  // Registry binding
  canonical_key: string;
  registry_version: string;

  // How the value was obtained
  extraction_method: CevExtractionMethod;

  // Source links (at most one is set)
  document_id: string | null;
  extracted_field_id: string | null;
  desk_reading_id: string | null;

  // Period
  period_kind: CevPeriodKind;
  period_start: string | null; // ISO date "YYYY-MM-DD"
  period_end: string | null;   // ISO date "YYYY-MM-DD"

  // Value as extracted from the source
  value_numeric: number | null;
  value_text: string | null;
  value_unit: string | null;
  value_as_stated: string | null;

  // Value normalised to the registry's standardUnit (computed by code, not AI)
  standard_value: number | null;
  standard_unit: string | null;

  // AI confidence (null for manual_entry / site_observation)
  confidence: number | null;

  // Provenance
  provenance_page: number | null;
  provenance_bbox: CevBbox | null;
  provenance_source_text: string | null;

  // Hashes
  input_hash: string | null;
  output_hash: string | null;

  // State machine
  state: CevState;
  proposed_by: string | null;  // auth.users id; null for fully automated rows
  reviewed_by: string | null;
  reviewed_at: string | null;  // ISO timestamp

  // Correction (set when state = 'corrected')
  correction_numeric: number | null;
  correction_text: string | null;
  correction_unit: string | null;
  correction_note: string | null;

  // Withdrawal (set when state = 'withdrawn')
  withdrawal_reason: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;

  // Roll-up hierarchy
  parent_id: string | null;              // null for leaf rows and root aggregates
  aggregation_method: CevAggregationMethod | null;
  aggregated_child_count: number | null;
  weight_kg: number | null;             // for weighted_mean

  // Downstream link
  fact_id: string | null;              // set once an annual row produces a facts row

  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Effective value helper (matches the cev_active view logic)
// ---------------------------------------------------------------------------

/**
 * Returns the value an auditor considers authoritative, respecting any
 * correction the auditor applied.
 *
 * Rules:
 *  - If state = 'corrected' and correction_numeric is set → use correction_numeric
 *  - If state = 'corrected' and correction_text is set    → use correction_text
 *  - Otherwise                                            → use value_numeric / value_text
 *
 * Code computes; models never do. This function MUST NOT be called before
 * state is 'accepted' or 'corrected'.
 */
export function effectiveValue(cev: CanonicalEvidenceValue): {
  numeric: number | null;
  text: string | null;
  unit: string | null;
} {
  if (cev.state !== "accepted" && cev.state !== "corrected") {
    throw new Error(
      `effectiveValue: row ${cev.id} is in state '${cev.state}'; ` +
        "only accepted or corrected rows have an authoritative value"
    );
  }
  if (cev.state === "corrected") {
    return {
      numeric: cev.correction_numeric ?? cev.value_numeric,
      text: cev.correction_text ?? cev.value_text,
      unit: cev.correction_unit ?? cev.value_unit,
    };
  }
  return {
    numeric: cev.value_numeric,
    text: cev.value_text,
    unit: cev.value_unit,
  };
}

// ---------------------------------------------------------------------------
// Insert payload types — the shapes the API routes accept
// ---------------------------------------------------------------------------

/**
 * Fields required to create a new canonical evidence value from an AI
 * extraction result (extracted_fields row already accepted or accepted in
 * the same transaction).
 */
export interface CreateCevFromExtraction {
  engagement_id: string;
  organization_id: string;
  canonical_key: string;
  registry_version: string;
  document_id: string;
  extracted_field_id: string;
  period_kind: CevPeriodKind;
  period_start?: string;
  period_end?: string;
  value_numeric?: number;
  value_text?: string;
  value_unit?: string;
  value_as_stated?: string;
  standard_value?: number;
  standard_unit?: string;
  confidence: number;
  provenance_page: number;
  provenance_bbox?: CevBbox;
  provenance_source_text: string;
  input_hash?: string;
  output_hash?: string;
  proposed_by?: string;
}

/**
 * Fields required to create a new canonical evidence value from a
 * regex-proposed corroboration drawer suggestion.
 *
 * These rows start in state 'suggested'. An auditor must accept or reject
 * them (the same cycle used for extracted_fields) before they can be used
 * in desk review checks. This satisfies the working agreement "never skip
 * a retrieval or groundedness step".
 */
export interface CreateCevFromProposal {
  engagement_id: string;
  organization_id: string;
  canonical_key: string;
  registry_version: string;
  document_id?: string;
  desk_reading_id?: string;
  period_kind: CevPeriodKind;
  period_start?: string;
  period_end?: string;
  value_numeric?: number;
  value_text?: string;
  value_unit?: string;
  value_as_stated?: string;
  standard_value?: number;
  standard_unit?: string;
  provenance_page?: number;
  provenance_bbox?: CevBbox;
  provenance_source_text?: string;
}

/**
 * Fields required to create a new canonical evidence value from an auditor's
 * manual entry in the corroboration drawer.
 *
 * Manual entries start in state 'accepted' (the act of typing IS the
 * acceptance). They still require document_id + page so the value is
 * traceable to a source document.
 */
export interface CreateCevFromManualEntry {
  engagement_id: string;
  organization_id: string;
  canonical_key: string;
  registry_version: string;
  document_id: string;
  desk_reading_id?: string;
  period_kind: CevPeriodKind;
  period_start?: string;
  period_end?: string;
  value_numeric?: number;
  value_text?: string;
  value_unit?: string;
  value_as_stated?: string;
  standard_value?: number;
  standard_unit?: string;
  provenance_page: number;
  provenance_bbox?: CevBbox;
  provenance_source_text?: string;
  reviewed_by: string;
}

// ---------------------------------------------------------------------------
// State transition payloads
// ---------------------------------------------------------------------------

export interface AcceptCevInput {
  id: string;
  engagement_id: string;
  organization_id: string;
  reviewed_by: string;
}

export interface CorrectCevInput {
  id: string;
  engagement_id: string;
  organization_id: string;
  reviewed_by: string;
  correction_numeric?: number;
  correction_text?: string;
  correction_unit?: string;
  correction_note: string; // required: why the correction was made
}

export interface RejectCevInput {
  id: string;
  engagement_id: string;
  organization_id: string;
  reviewed_by: string;
  rejection_note?: string;
}

export interface WithdrawCevInput {
  id: string;
  engagement_id: string;
  organization_id: string;
  withdrawn_by: string;
  withdrawal_reason: string; // minimum 8 chars
}

// ---------------------------------------------------------------------------
// Roll-up types
// ---------------------------------------------------------------------------

/**
 * Input for creating a roll-up aggregate canonical evidence value.
 *
 * The aggregate row's period_start and period_end are derived from the span
 * of its children. The aggregation_method determines how effective_numeric
 * is computed.
 *
 * Example: 12 monthly coal_gcv rows (each with period_kind = 'monthly') are
 * rolled up into one annual row (period_kind = 'annual') using
 * aggregation_method = 'weighted_mean', where weight_kg is the monthly coal
 * consumed in kg.
 */
export interface RollUpInput {
  engagement_id: string;
  organization_id: string;
  canonical_key: string;
  registry_version: string;
  child_ids: string[];         // ids of the CanonicalEvidenceValue rows being aggregated
  period_kind: CevPeriodKind;  // the target period (usually 'annual')
  aggregation_method: CevAggregationMethod;
  computed_value: number;      // the result of the aggregation, computed by code
  value_unit: string;
  standard_value?: number;
  standard_unit?: string;
  created_by: string;          // audit trail: who triggered the roll-up
}

/**
 * Result of a roll-up computation.
 *
 * The aggregate row starts in state 'suggested' and must be auditor-accepted
 * before it can produce a facts row, unless the engagement's triage policy
 * marks it 'auto_accept' (which is a separate business rule).
 */
export interface RollUpResult {
  aggregateId: string;              // the new canonical_evidence_values row id
  childCount: number;
  period_start: string;
  period_end: string;
  computed_value: number;
  aggregation_method: CevAggregationMethod;
}

// ---------------------------------------------------------------------------
// Query result types used by API route handlers
// ---------------------------------------------------------------------------

/**
 * A summary row returned by the /api/engagements/[id]/canonical-evidence
 * list endpoint. Corresponds to the cev_active view.
 */
export interface CevActiveSummary {
  id: string;
  canonical_key: string;
  registry_version: string;
  extraction_method: CevExtractionMethod;
  document_id: string | null;
  period_kind: CevPeriodKind;
  period_start: string | null;
  period_end: string | null;
  effective_numeric: number | null;
  effective_text: string | null;
  effective_unit: string | null;
  state: CevState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  parent_id: string | null;
  aggregation_method: CevAggregationMethod | null;
  aggregated_child_count: number | null;
  fact_id: string | null;
  created_at: string;
}

/**
 * Response shape for the corroboration drawer suggestions endpoint.
 * Groups suggested values by canonical_key so the UI can show "here are
 * N sources for coal_gcv, all awaiting your review".
 */
export interface CevCorroborationGroup {
  canonical_key: string;
  registry_version: string;
  suggestions: Array<{
    id: string;
    extraction_method: CevExtractionMethod;
    document_id: string | null;
    period_kind: CevPeriodKind;
    period_start: string | null;
    period_end: string | null;
    value_numeric: number | null;
    value_text: string | null;
    value_unit: string | null;
    value_as_stated: string | null;
    confidence: number | null;
    provenance_page: number | null;
    provenance_source_text: string | null;
    state: CevState;
    created_at: string;
  }>;
}

