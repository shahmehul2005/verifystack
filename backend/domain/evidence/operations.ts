/**
 * Canonical Evidence Values — domain operations.
 *
 * All writes go through the service-role client (same pattern as facts and
 * desk_readings). No model output ever reaches the DB without first entering
 * state 'suggested' and being accepted by an auditor.
 *
 * Working agreement reminders baked into this module:
 *   - Code computes; models never do.
 *     standard_value is always computed here, never taken from an AI response.
 *   - Every accepted/corrected value must carry provenance.
 *     The insert guards enforce this for ai_extraction rows.
 *   - Append-only. No accepted row's evidence columns are ever mutated.
 *   - Escalate rather than improvise on regulatory values.
 *     This module never infers emission factors or regulatory thresholds.
 */

import "server-only";

import { createHash } from "crypto";
import { createDataClient } from "../../lib/supabase/admin";
import {
  type AcceptCevInput,
  type CanonicalEvidenceValue,
  type CevPeriodKind,
  type CorrectCevInput,
  type CreateCevFromExtraction,
  type CreateCevFromManualEntry,
  type CreateCevFromProposal,
  type RejectCevInput,
  type RollUpInput,
  type RollUpResult,
  type WithdrawCevInput,
} from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute the input hash from document file hash + extraction params. */
function computeInputHash(params: {
  documentFileHash: string;
  extractionParams: string; // JSON-serialised extraction config
  promptVersion: string;
}): string {
  return createHash("sha256")
    .update(`${params.documentFileHash}|${params.extractionParams}|${params.promptVersion}`)
    .digest("hex");
}

/** Compute the output hash from the extracted value + provenance. */
function computeOutputHash(params: {
  valueNumeric: number | null;
  valueUnit: string | null;
  provenance_page: number | null;
  provenance_source_text: string | null;
}): string {
  const parts = [
    params.valueNumeric !== null ? String(params.valueNumeric) : "null",
    params.valueUnit ?? "null",
    params.provenance_page !== null ? String(params.provenance_page) : "null",
    params.provenance_source_text ?? "null",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Derive period start from period_kind when only a date string is provided. */
function coercePeriodDates(
  kind: CevPeriodKind,
  start: string | undefined,
  end: string | undefined
): { period_start: string | null; period_end: string | null } {
  if (kind === "single_reading" || kind === "document_period") {
    return { period_start: null, period_end: null };
  }
  return {
    period_start: start ?? null,
    period_end: end ?? null,
  };
}

// ---------------------------------------------------------------------------
// Create operations
// ---------------------------------------------------------------------------

/**
 * Create a canonical evidence value from an AI extraction result.
 * The row starts in state 'suggested' and must be auditor-accepted.
 *
 * standard_value is NOT taken from AI output. The caller must compute it
 * using the registry's normalizeQuantity() function before calling this.
 */
export async function createCevFromExtraction(
  input: CreateCevFromExtraction & {
    standard_value?: number;
    standard_unit?: string;
    document_file_hash: string;
    extraction_params: string;
    prompt_version: string;
  }
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("createCevFromExtraction: database client not available");

  const { period_start, period_end } = coercePeriodDates(
    input.period_kind,
    input.period_start,
    input.period_end
  );

  const input_hash = computeInputHash({
    documentFileHash: input.document_file_hash,
    extractionParams: input.extraction_params,
    promptVersion: input.prompt_version,
  });

  const output_hash = computeOutputHash({
    valueNumeric: input.value_numeric ?? null,
    valueUnit: input.value_unit ?? null,
    provenance_page: input.provenance_page,
    provenance_source_text: input.provenance_source_text,
  });

  const { data, error } = await db
    .from("canonical_evidence_values")
    .insert({
      organization_id: input.organization_id,
      engagement_id: input.engagement_id,
      canonical_key: input.canonical_key,
      registry_version: input.registry_version,
      extraction_method: "ai_extraction",
      document_id: input.document_id,
      extracted_field_id: input.extracted_field_id,
      period_kind: input.period_kind,
      period_start,
      period_end,
      value_numeric: input.value_numeric ?? null,
      value_text: null,
      value_unit: input.value_unit ?? null,
      value_as_stated: input.value_as_stated ?? null,
      standard_value: input.standard_value ?? null,
      standard_unit: input.standard_unit ?? null,
      confidence: input.confidence,
      provenance_page: input.provenance_page,
      provenance_bbox: (input.provenance_bbox ?? null) as import("../../lib/supabase/types").Json | null,
      provenance_source_text: input.provenance_source_text,
      input_hash,
      output_hash,
      state: "suggested",
      proposed_by: input.proposed_by ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`createCevFromExtraction: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

/**
 * Create a canonical evidence value from a regex-proposed corroboration
 * drawer suggestion. The row starts in state 'suggested'. An auditor must
 * accept it before it feeds desk-review checks.
 *
 * This replaces the previous pattern of persisting to desk_readings directly
 * from propose.ts without an acceptance step.
 */
export async function createCevFromProposal(
  input: CreateCevFromProposal
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("createCevFromProposal: database client not available");

  const { period_start, period_end } = coercePeriodDates(
    input.period_kind,
    input.period_start,
    input.period_end
  );

  const { data, error } = await db
    .from("canonical_evidence_values")
    .insert({
      organization_id: input.organization_id,
      engagement_id: input.engagement_id,
      canonical_key: input.canonical_key,
      registry_version: input.registry_version,
      extraction_method: "regex_propose",
      document_id: input.document_id ?? null,
      desk_reading_id: input.desk_reading_id ?? null,
      period_kind: input.period_kind,
      period_start,
      period_end,
      value_numeric: input.value_numeric ?? null,
      value_text: input.value_text ?? null,
      value_unit: input.value_unit ?? null,
      value_as_stated: input.value_as_stated ?? null,
      standard_value: input.standard_value ?? null,
      standard_unit: input.standard_unit ?? null,
      provenance_page: input.provenance_page ?? null,
      provenance_bbox: (input.provenance_bbox ?? null) as import("../../lib/supabase/types").Json | null,
      provenance_source_text: input.provenance_source_text ?? null,
      state: "suggested",
      proposed_by: null, // automated
    })
    .select()
    .single();

  if (error) throw new Error(`createCevFromProposal: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

/**
 * Create a canonical evidence value from an auditor's manual entry.
 * Manual entries start in state 'accepted' — the act of typing IS the
 * acceptance. The auditor's user ID is captured as both proposed_by and
 * reviewed_by.
 */
export async function createCevFromManualEntry(
  input: CreateCevFromManualEntry
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("createCevFromManualEntry: database client not available");

  const { period_start, period_end } = coercePeriodDates(
    input.period_kind,
    input.period_start,
    input.period_end
  );

  const { data, error } = await db
    .from("canonical_evidence_values")
    .insert({
      organization_id: input.organization_id,
      engagement_id: input.engagement_id,
      canonical_key: input.canonical_key,
      registry_version: input.registry_version,
      extraction_method: "manual_entry",
      document_id: input.document_id,
      desk_reading_id: input.desk_reading_id ?? null,
      period_kind: input.period_kind,
      period_start,
      period_end,
      value_numeric: input.value_numeric ?? null,
      value_text: input.value_text ?? null,
      value_unit: input.value_unit ?? null,
      value_as_stated: input.value_as_stated ?? null,
      standard_value: input.standard_value ?? null,
      standard_unit: input.standard_unit ?? null,
      provenance_page: input.provenance_page,
      provenance_bbox: (input.provenance_bbox ?? null) as import("../../lib/supabase/types").Json | null,
      provenance_source_text: input.provenance_source_text ?? null,
      state: "accepted", // manual entry = already accepted by the typing auditor
      proposed_by: input.reviewed_by,
      reviewed_by: input.reviewed_by,
      reviewed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`createCevFromManualEntry: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Accept a suggested or pending_review canonical evidence value.
 * Only 'suggested' and 'pending_review' rows may be accepted.
 */
export async function acceptCanonicalEvidenceValue(
  input: AcceptCevInput
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("acceptCanonicalEvidenceValue: database client not available");

  // Fetch current state first to guard invalid transitions
  const { data: current, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("state, engagement_id, organization_id")
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .single();

  if (fetchError || !current) throw new Error("acceptCanonicalEvidenceValue: row not found");
  if (!["suggested", "pending_review"].includes(current.state)) {
    throw new Error(
      `acceptCanonicalEvidenceValue: row is in state '${current.state}'; only suggested or pending_review rows may be accepted`
    );
  }

  const { data, error } = await db
    .from("canonical_evidence_values")
    .update({
      state: "accepted",
      reviewed_by: input.reviewed_by,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .select()
    .single();

  if (error) throw new Error(`acceptCanonicalEvidenceValue: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

/**
 * Correct a suggested, pending_review, or accepted canonical evidence value.
 * The original extracted value is preserved; the correction is stored in the
 * correction_* columns. A correction_note is mandatory.
 */
export async function correctCanonicalEvidenceValue(
  input: CorrectCevInput
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("correctCanonicalEvidenceValue: database client not available");

  if (!input.correction_numeric && !input.correction_text) {
    throw new Error("correctCanonicalEvidenceValue: at least one of correction_numeric or correction_text is required");
  }
  if (!input.correction_note || input.correction_note.trim().length < 8) {
    throw new Error("correctCanonicalEvidenceValue: correction_note must be at least 8 characters");
  }

  const { data: current, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("state")
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .single();

  if (fetchError || !current) throw new Error("correctCanonicalEvidenceValue: row not found");
  if (!["suggested", "pending_review", "accepted"].includes(current.state)) {
    throw new Error(
      `correctCanonicalEvidenceValue: row is in state '${current.state}'; only suggested, pending_review, or accepted rows may be corrected`
    );
  }

  const { data, error } = await db
    .from("canonical_evidence_values")
    .update({
      state: "corrected",
      reviewed_by: input.reviewed_by,
      reviewed_at: new Date().toISOString(),
      correction_numeric: input.correction_numeric ?? null,
      correction_text: input.correction_text ?? null,
      correction_unit: input.correction_unit ?? null,
      correction_note: input.correction_note,
    })
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .select()
    .single();

  if (error) throw new Error(`correctCanonicalEvidenceValue: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

/**
 * Reject a suggested or pending_review canonical evidence value.
 * Rejected rows stay in the DB for audit purposes.
 */
export async function rejectCanonicalEvidenceValue(
  input: RejectCevInput
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("rejectCanonicalEvidenceValue: database client not available");

  const { data: current, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("state")
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .single();

  if (fetchError || !current) throw new Error("rejectCanonicalEvidenceValue: row not found");
  if (!["suggested", "pending_review"].includes(current.state)) {
    throw new Error(
      `rejectCanonicalEvidenceValue: row is in state '${current.state}'; only suggested or pending_review rows may be rejected (use withdraw for accepted/corrected rows)`
    );
  }

  const { data, error } = await db
    .from("canonical_evidence_values")
    .update({
      state: "rejected",
      reviewed_by: input.reviewed_by,
      reviewed_at: new Date().toISOString(),
      correction_note: input.rejection_note ?? null,
    })
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .select()
    .single();

  if (error) throw new Error(`rejectCanonicalEvidenceValue: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

/**
 * Withdraw an accepted or corrected canonical evidence value.
 * This is the append-only equivalent of "undo" — the row transitions to
 * 'withdrawn' and the fact_id link is severed (the caller must also withdraw
 * the downstream facts row separately via withdraw_fact()).
 *
 * A withdrawal_reason of at least 8 characters is required.
 */
export async function withdrawCanonicalEvidenceValue(
  input: WithdrawCevInput
): Promise<CanonicalEvidenceValue> {
  const db = createDataClient();
  if (!db) throw new Error("withdrawCanonicalEvidenceValue: database client not available");

  if (!input.withdrawal_reason || input.withdrawal_reason.trim().length < 8) {
    throw new Error("withdrawCanonicalEvidenceValue: withdrawal_reason must be at least 8 characters");
  }

  const { data: current, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("state, fact_id")
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .single();

  if (fetchError || !current) throw new Error("withdrawCanonicalEvidenceValue: row not found");
  if (!["accepted", "corrected"].includes(current.state)) {
    throw new Error(
      `withdrawCanonicalEvidenceValue: row is in state '${current.state}'; only accepted or corrected rows may be withdrawn`
    );
  }

  if (current.fact_id) {
    // Surface to the caller — they must withdraw the fact first.
    throw new Error(
      `withdrawCanonicalEvidenceValue: row has a downstream fact (${current.fact_id}). ` +
        "Call withdraw_fact() on the facts row first, then retry this withdrawal."
    );
  }

  const { data, error } = await db
    .from("canonical_evidence_values")
    .update({
      state: "withdrawn",
      withdrawal_reason: input.withdrawal_reason.trim(),
      withdrawn_by: input.withdrawn_by,
      withdrawn_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id)
    .select()
    .single();

  if (error) throw new Error(`withdrawCanonicalEvidenceValue: ${error.message}`);
  return data as unknown as CanonicalEvidenceValue;
}

// ---------------------------------------------------------------------------
// Roll-up aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate N child canonical evidence values into one parent row.
 *
 * Rules:
 *   - All children must be in state 'accepted' or 'corrected'.
 *   - All children must share the same canonical_key and engagement_id.
 *   - The computed_value MUST be computed by application code — never taken
 *     from an AI response.
 *   - The aggregate row starts in state 'suggested' so an auditor reviews
 *     the computed total before it proceeds to a facts row.
 *
 * Example: 12 monthly coal_gcv rows → one annual weighted_mean aggregate.
 */
export async function rollUpCanonicalEvidenceValues(
  input: RollUpInput
): Promise<RollUpResult> {
  const db = createDataClient();
  if (!db) throw new Error("rollUpCanonicalEvidenceValues: database client not available");

  if (input.child_ids.length === 0) {
    throw new Error("rollUpCanonicalEvidenceValues: child_ids must not be empty");
  }

  // Fetch and validate all children
  const { data: children, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("id, state, canonical_key, engagement_id, organization_id, period_start, period_end")
    .in("id", input.child_ids)
    .eq("canonical_key", input.canonical_key)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id);

  if (fetchError) throw new Error(`rollUpCanonicalEvidenceValues: fetch failed — ${fetchError.message}`);
  if (!children || children.length !== input.child_ids.length) {
    throw new Error(
      `rollUpCanonicalEvidenceValues: expected ${input.child_ids.length} children, found ${children?.length ?? 0}. ` +
        "Some may belong to a different engagement or canonical_key."
    );
  }

  const invalid = children.filter((c) => !["accepted", "corrected"].includes(c.state));
  if (invalid.length > 0) {
    throw new Error(
      `rollUpCanonicalEvidenceValues: ${invalid.length} child row(s) are not in accepted/corrected state: ` +
        invalid.map((c) => `${c.id} (${c.state})`).join(", ")
    );
  }

  // Derive aggregate period from the span of children
  const starts = children.map((c) => c.period_start).filter(Boolean) as string[];
  const ends = children.map((c) => c.period_end).filter(Boolean) as string[];
  const period_start = starts.length > 0 ? starts.sort()[0]! : null;
  const period_end = ends.length > 0 ? ends.sort().at(-1)! : null;

  if (!period_start || !period_end) {
    throw new Error(
      "rollUpCanonicalEvidenceValues: children must all have period_start and period_end for a roll-up"
    );
  }

  const output_hash = computeOutputHash({
    valueNumeric: input.computed_value,
    valueUnit: input.value_unit,
    provenance_page: null,
    provenance_source_text: `roll_up:${input.aggregation_method}:${input.child_ids.join(",")}`,
  });

  const { data: aggregate, error: insertError } = await db
    .from("canonical_evidence_values")
    .insert({
      organization_id: input.organization_id,
      engagement_id: input.engagement_id,
      canonical_key: input.canonical_key,
      registry_version: input.registry_version,
      extraction_method: "workbook_reader", // roll-ups are computed by code
      period_kind: input.period_kind,
      period_start,
      period_end,
      value_numeric: input.computed_value,
      value_unit: input.value_unit,
      value_as_stated: null,
      standard_value: input.standard_value ?? null,
      standard_unit: input.standard_unit ?? null,
      output_hash,
      aggregation_method: input.aggregation_method,
      aggregated_child_count: input.child_ids.length,
      state: "suggested", // auditor must review the computed aggregate
      proposed_by: null,
    })
    .select()
    .single();

  if (insertError || !aggregate) {
    throw new Error(`rollUpCanonicalEvidenceValues: insert failed — ${insertError?.message}`);
  }

  // Link children to the new aggregate via parent_id
  const { error: linkError } = await db
    .from("canonical_evidence_values")
    .update({ parent_id: aggregate.id })
    .in("id", input.child_ids)
    .eq("engagement_id", input.engagement_id)
    .eq("organization_id", input.organization_id);

  if (linkError) {
    throw new Error(`rollUpCanonicalEvidenceValues: failed to link children — ${linkError.message}`);
  }

  return {
    aggregateId: aggregate.id,
    childCount: input.child_ids.length,
    period_start,
    period_end,
    computed_value: input.computed_value,
    aggregation_method: input.aggregation_method,
  };
}

// ---------------------------------------------------------------------------
// Promote accepted annual row → facts row
// ---------------------------------------------------------------------------

/**
 * Promote an accepted or corrected annual canonical evidence value to a facts
 * row for the calculation engine. Only call this for period_kind = 'annual'
 * rows in state 'accepted' or 'corrected'.
 *
 * This writes to public.facts using the existing schema. The canonical
 * evidence row is updated with the new fact_id.
 *
 * Returns the new fact's id.
 */
export async function promoteToFact(params: {
  cevId: string;
  engagement_id: string;
  organization_id: string;
  field_path: string;    // e.g. 'calorificValue' — the pack binding path
  unit: string;
  accepted_by: string;
}): Promise<{ factId: string }> {
  const db = createDataClient();
  if (!db) throw new Error("promoteToFact: database client not available");

  const { data: cev, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("*")
    .eq("id", params.cevId)
    .eq("engagement_id", params.engagement_id)
    .eq("organization_id", params.organization_id)
    .single();

  if (fetchError || !cev) throw new Error("promoteToFact: canonical evidence value not found");

  if (!["accepted", "corrected"].includes(cev.state)) {
    throw new Error(`promoteToFact: row is in state '${cev.state}'; only accepted/corrected rows may be promoted`);
  }
  if (cev.period_kind !== "annual") {
    throw new Error(`promoteToFact: period_kind is '${cev.period_kind}'; only annual rows may be promoted to facts`);
  }
  if (cev.fact_id) {
    throw new Error(`promoteToFact: row already has a fact (${cev.fact_id})`);
  }
  if (!cev.document_id) {
    throw new Error("promoteToFact: document_id is required for a facts row (trace to source document)");
  }

  // Effective value: correction takes precedence
  const effectiveNumeric =
    cev.state === "corrected" && cev.correction_numeric !== null
      ? cev.correction_numeric
      : cev.value_numeric;
  const effectiveUnit =
    cev.state === "corrected" && cev.correction_unit !== null
      ? cev.correction_unit
      : cev.value_unit;

  if (effectiveNumeric === null) {
    throw new Error("promoteToFact: effective_numeric is null; cannot create a numeric fact");
  }

  const page = cev.provenance_page;
  const bbox = cev.provenance_bbox ?? { x: 0, y: 0, width: 0, height: 0 };
  const source_text = cev.provenance_source_text ?? "";

  if (!page || page <= 0) {
    throw new Error("promoteToFact: provenance_page is required for a facts row");
  }

  // Insert facts row
  const { data: fact, error: factError } = await db
    .from("facts")
    .insert({
      organization_id: params.organization_id,
      engagement_id: params.engagement_id,
      document_id: cev.document_id,
      field_path: params.field_path,
      value_json: JSON.stringify(effectiveNumeric),
      unit: effectiveUnit ?? params.unit,
      page,
      bbox,
      source_text: source_text || `Canonical evidence value ${cev.id}`,
      accepted_by: params.accepted_by,
      accepted_at: new Date().toISOString(),
      canonical_key: cev.canonical_key,
      period_start: cev.period_start,
      period_end: cev.period_end,
      period_status: "known",
      registry_version: cev.registry_version,
    })
    .select("id")
    .single();

  if (factError || !fact) throw new Error(`promoteToFact: facts insert failed — ${factError?.message}`);

  // Back-link: update the canonical evidence row with the fact id
  const { error: updateError } = await db
    .from("canonical_evidence_values")
    .update({ fact_id: fact.id })
    .eq("id", cev.id)
    .eq("engagement_id", params.engagement_id)
    .eq("organization_id", params.organization_id);

  if (updateError) {
    // Not fatal — the fact was created. Log but do not throw.
    console.error(`promoteToFact: could not back-link fact_id on cev ${cev.id}: ${updateError.message}`);
  }

  return { factId: fact.id };
}
