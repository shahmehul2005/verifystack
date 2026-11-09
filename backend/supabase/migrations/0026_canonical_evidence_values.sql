-- =============================================================================
-- Migration 0026: Canonical Evidence Values
--
-- PURPOSE
-- -------
-- A unified, period-aware, multi-source evidence store that sits BETWEEN the
-- document extraction layer (extracted_fields, desk_readings) and the calculation
-- layer (facts).
--
-- WHAT IT SOLVES
-- --------------
-- 1. Multi-source: the same canonical quantity (e.g. coal_gcv) may be observed
--    in a lab certificate, an NABL cert, a fuel invoice and an internal log.
--    Currently assertAtMostOne() crashes when two accepted facts share a path.
--    This table holds all N sources as distinct rows linked by canonical_key.
--
-- 2. Period hierarchy: monthly rows roll up to quarterly, then to annual.
--    The calculation engine needs exactly one annual value; that value is a
--    *derived* roll-up row, never the raw extraction. Roll-up rows carry a
--    parent_id pointing at a canonical_evidence_value that acts as the
--    aggregate, and that aggregate row is what ultimately yields a fact.
--
-- 3. Auditor provenance for corroboration drawer suggestions: today,
--    desk_readings are entered directly (no suggestion / accept cycle). This
--    table adds the same suggest → accept cycle that extracted_fields already
--    has, so a regex-proposed or AI-proposed corroboration reading must be
--    reviewed before it can influence a desk-review run.
--
-- 4. Both-sides hashing: input_hash commits to the source (document bytes +
--    extraction params + prompt version). output_hash commits to the extracted
--    value + provenance. Together they make the pipeline auditable end-to-end.
--
-- WHAT IT IS NOT
-- --------------
-- - Not a replacement for extracted_fields (AI extraction output). Those rows
--   continue to exist and are linked here by extracted_field_id.
-- - Not a replacement for desk_readings (auditor-typed figures). Those rows
--   continue to exist. A desk_reading that is promoted to canonical evidence
--   is linked here by desk_reading_id.
-- - Not a calculation input directly. A canonical evidence value must be
--   accepted AND its roll-up (if needed) committed before a facts row is
--   written. The calculation engine reads from facts, not from here.
-- - Not editable. Every auditor decision appends a new row or creates a
--   corrected successor row; the original is never mutated.
--
-- INTEGRATION WITH EXISTING TABLES
-- ---------------------------------
--   extracted_fields  → canonical_evidence_values (via extracted_field_id)
--   desk_readings     → canonical_evidence_values (via desk_reading_id)
--   canonical_evidence_values (accepted, annual) → facts (via fact_id)
--
-- REQUIRES: 0025 (canonical_key + period columns on extracted_fields / facts)
-- NEXT MIGRATION: 0027
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum-like text domains (enforced by CHECK, not CREATE TYPE, so they can
--    be altered without an ALTER TYPE … ADD VALUE that must run outside a
--    transaction on older Postgres).
-- ---------------------------------------------------------------------------

-- extraction_method values:
--   ai_extraction       — Gemini / other LLM extracted from a PDF/image
--   workbook_reader     — computed by a WorkbookReader from XLSX SCADA data
--   regex_propose       — propose.ts pattern-matched the corroboration reading
--   manual_entry        — auditor typed the value in the corroboration drawer
--   site_observation    — value from a site visit instrument or interview note

-- period_kind values:
--   daily               — a single calendar day
--   monthly             — one calendar month
--   quarterly           — one calendar quarter
--   annual              — one compliance year (1 Apr – 31 Mar)
--   single_reading      — one certificate / one slip (no inherent period)
--   document_period     — whatever period the document states

-- state values:
--   suggested           — created by automation (AI, regex, workbook reader)
--   pending_review      — flagged for mandatory human review before use
--   accepted            — auditor confirmed the value is correct
--   corrected           — auditor overrode the value (correction_* columns set)
--   rejected            — auditor discarded the value
--   withdrawn           — previously accepted/corrected row was retracted;
--                         a withdrawal_reason is required

-- aggregation_method values (roll-up rows only):
--   sum                 — arithmetic sum of child values (coal tonnes, kWh)
--   mean                — simple mean of child values (GCV samples)
--   weighted_mean       — mean weighted by child weight_kg column
--   point_in_time       — one child row is selected as the representative value

-- ---------------------------------------------------------------------------
-- 2. Main table
-- ---------------------------------------------------------------------------

create table if not exists public.canonical_evidence_values (
  -- Identity
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references public.organizations(id) on delete cascade,
  engagement_id         uuid        not null references public.engagements(id)   on delete cascade,

  -- Registry key (required; must include version so the key meaning is unambiguous)
  canonical_key         text        not null check (length(canonical_key) between 1 and 120),
  registry_version      text        not null check (length(registry_version) between 1 and 40),

  -- How was this value obtained?
  extraction_method     text        not null check (extraction_method in (
                          'ai_extraction', 'workbook_reader', 'regex_propose',
                          'manual_entry', 'site_observation'
                        )),

  -- Source links (at most one of these is set for a given row)
  document_id           uuid        references public.documents(id)         on delete set null,
  extracted_field_id    uuid        references public.extracted_fields(id)  on delete set null,
  desk_reading_id       uuid        references public.desk_readings(id)     on delete set null,

  -- Period the value covers
  period_kind           text        not null check (period_kind in (
                          'daily', 'monthly', 'quarterly', 'annual',
                          'single_reading', 'document_period'
                        )),
  period_start          date,
  period_end            date,

  -- The value itself — numeric or text, plus the unit as stated on the source
  value_numeric         numeric,
  value_text            text,
  value_unit            text,          -- unit as printed on the source document
  value_as_stated       text,          -- verbatim string from the source (never transformed)

  -- Normalised value — in the registry's standardUnit, computed by code not AI
  standard_value        numeric,
  standard_unit         text,

  -- AI confidence (null for manual_entry / site_observation)
  confidence            numeric       check (confidence is null or confidence between 0 and 1),

  -- Provenance (at minimum page+bbox required when extraction_method is ai_extraction)
  provenance_page       int           check (provenance_page is null or provenance_page > 0),
  provenance_bbox       jsonb,         -- {x, y, width, height} normalised 0–1
  provenance_source_text text,         -- verbatim OCR / cell content that the value was read from

  -- Hashes
  -- input_hash:  SHA-256 of (document sha256 | extraction params | prompt version)
  -- output_hash: SHA-256 of (value_numeric::text | value_unit | provenance_page | provenance_source_text)
  input_hash            text,
  output_hash           text,

  -- Auditor decision state machine
  state                 text        not null default 'suggested' check (state in (
                          'suggested', 'pending_review', 'accepted', 'corrected',
                          'rejected', 'withdrawn'
                        )),
  proposed_by           uuid        references auth.users(id),    -- null for fully automated rows
  reviewed_by           uuid        references auth.users(id),
  reviewed_at           timestamptz,

  -- Correction: when an auditor changes the value rather than rejecting it
  correction_numeric    numeric,
  correction_text       text,
  correction_unit       text,
  correction_note       text,

  -- Withdrawal: superseded rows (append-only — never delete an accepted row)
  withdrawal_reason     text,
  withdrawn_by          uuid        references auth.users(id),
  withdrawn_at          timestamptz,

  -- Roll-up hierarchy
  -- A roll-up row is created by code when N monthly rows are aggregated into
  -- one annual (or N daily rows into one monthly). It points at the aggregate
  -- row via parent_id. The aggregate row's children are found by
  -- querying WHERE parent_id = <aggregate_id>.
  parent_id             uuid        references public.canonical_evidence_values(id),
  aggregation_method    text        check (aggregation_method in (
                          'sum', 'mean', 'weighted_mean', 'point_in_time'
                        )),
  aggregated_child_count int,        -- how many child rows contributed to this aggregate
  weight_kg             numeric,     -- for weighted_mean: the mass this reading is weighted by

  -- The fact row this value eventually produced (set only after acceptance and
  -- fact creation; null until then)
  fact_id               uuid        references public.facts(id)   on delete set null,

  -- Timestamps
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- ---------------------------------------------------------------------------
  -- Structural constraints
  -- ---------------------------------------------------------------------------

  -- At least one value column must carry something
  constraint cev_has_value check (
    value_numeric is not null or value_text is not null
  ),

  -- A period of kind daily/monthly/quarterly/annual must have explicit dates
  constraint cev_period_dates check (
    period_kind in ('single_reading', 'document_period')
    or (period_start is not null and period_end is not null and period_start <= period_end)
  ),

  -- A roll-up aggregate must have an aggregation_method
  constraint cev_rollup_method check (
    parent_id is null or aggregation_method is not null
  ),

  -- A withdrawn row must have a reason and actor
  constraint cev_withdrawal_complete check (
    state != 'withdrawn'
    or (withdrawal_reason is not null and length(btrim(withdrawal_reason)) >= 8
        and withdrawn_by is not null and withdrawn_at is not null)
  ),

  -- A corrected row must carry at least one corrected value column
  constraint cev_correction_has_value check (
    state != 'corrected'
    or (correction_numeric is not null or correction_text is not null)
  ),

  -- AI extraction provenance: page and source_text are mandatory
  constraint cev_ai_provenance check (
    extraction_method != 'ai_extraction'
    or (provenance_page is not null and provenance_source_text is not null)
  ),

  -- A snip-style reading (manual_entry with bbox) must include source_text
  constraint cev_snip_complete check (
    provenance_bbox is null
    or (provenance_page is not null and provenance_source_text is not null)
  )
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

-- Primary query pattern: all values for an engagement and a canonical key
create index if not exists cev_engagement_key_idx
  on public.canonical_evidence_values (engagement_id, canonical_key)
  where state not in ('rejected', 'withdrawn');

-- Find non-aggregated rows (leaves) for a key and period
create index if not exists cev_engagement_key_period_idx
  on public.canonical_evidence_values (engagement_id, canonical_key, period_start, period_end)
  where parent_id is null and state not in ('rejected', 'withdrawn');

-- Roll-up: find children of a given aggregate
create index if not exists cev_parent_idx
  on public.canonical_evidence_values (parent_id)
  where parent_id is not null;

-- Find accepted annual rows ready to yield facts
create index if not exists cev_accepted_annual_idx
  on public.canonical_evidence_values (engagement_id, canonical_key)
  where period_kind = 'annual' and state in ('accepted', 'corrected') and fact_id is null;

-- Traceability: find which canonical_evidence_value came from an extracted_field
create index if not exists cev_extracted_field_idx
  on public.canonical_evidence_values (extracted_field_id)
  where extracted_field_id is not null;

-- Traceability: find which canonical_evidence_value came from a desk_reading
create index if not exists cev_desk_reading_idx
  on public.canonical_evidence_values (desk_reading_id)
  where desk_reading_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Auto-update updated_at
-- ---------------------------------------------------------------------------

create or replace function public.cev_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cev_updated_at on public.canonical_evidence_values;
create trigger cev_updated_at
  before update on public.canonical_evidence_values
  for each row execute procedure public.cev_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Append-only guard: once accepted or corrected, a row's value and
--    provenance columns may not change. Only state transitions and the
--    withdrawal columns may be mutated after acceptance.
-- ---------------------------------------------------------------------------

create or replace function public.cev_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Rows that have been accepted, corrected, or withdrawn cannot have their
  -- core evidence columns changed. Only state, reviewed_by/at, withdrawal_*,
  -- and fact_id may change after that point.
  if old.state in ('accepted', 'corrected', 'withdrawn') then
    if (
      new.canonical_key         is distinct from old.canonical_key         or
      new.registry_version      is distinct from old.registry_version      or
      new.extraction_method     is distinct from old.extraction_method     or
      new.document_id           is distinct from old.document_id           or
      new.extracted_field_id    is distinct from old.extracted_field_id    or
      new.desk_reading_id       is distinct from old.desk_reading_id       or
      new.period_kind           is distinct from old.period_kind           or
      new.period_start          is distinct from old.period_start          or
      new.period_end            is distinct from old.period_end            or
      new.value_numeric         is distinct from old.value_numeric         or
      new.value_text            is distinct from old.value_text            or
      new.value_unit            is distinct from old.value_unit            or
      new.value_as_stated       is distinct from old.value_as_stated       or
      new.standard_value        is distinct from old.standard_value        or
      new.standard_unit         is distinct from old.standard_unit         or
      new.input_hash            is distinct from old.input_hash            or
      new.output_hash           is distinct from old.output_hash           or
      new.parent_id             is distinct from old.parent_id             or
      new.aggregation_method    is distinct from old.aggregation_method    or
      new.aggregated_child_count is distinct from old.aggregated_child_count or
      new.weight_kg             is distinct from old.weight_kg             or
      new.provenance_page       is distinct from old.provenance_page       or
      new.provenance_bbox       is distinct from old.provenance_bbox       or
      new.provenance_source_text is distinct from old.provenance_source_text or
      new.proposed_by           is distinct from old.proposed_by
    ) then
      raise exception
        'canonical_evidence_values: core evidence columns are immutable once a row is accepted, corrected, or withdrawn'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cev_immutable_guard on public.canonical_evidence_values;
create trigger cev_immutable_guard
  before update on public.canonical_evidence_values
  for each row execute procedure public.cev_guard_immutable();

-- ---------------------------------------------------------------------------
-- 6. Row-level security
--    Members of the engagement's organisation may read all rows.
--    Writes are service_role only (same pattern as facts, desk_readings).
-- ---------------------------------------------------------------------------

alter table public.canonical_evidence_values enable row level security;

drop policy if exists cev_member_read on public.canonical_evidence_values;
create policy cev_member_read on public.canonical_evidence_values
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Writes (insert, update, delete) are intentionally not granted to `authenticated`.
-- The API routes use the service role client for writes, matching the existing
-- pattern for facts and desk_readings.
revoke insert, update, delete, truncate
  on public.canonical_evidence_values from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. Canonical evidence audit log view
--    A lightweight append-only trail of every state transition.
--    The main audit_events table covers all actions; this view makes it easy
--    to pull the full life of one canonical_evidence_values row.
-- ---------------------------------------------------------------------------

create or replace view public.cev_audit_trail as
  select
    ae.id,
    ae.organization_id,
    ae.actor_user_id,
    ae.action,
    ae.entity_type,
    ae.entity_id,
    ae.payload,
    ae.created_at
  from public.audit_events ae
  where ae.entity_type = 'canonical_evidence_value'
  order by ae.created_at;

-- ---------------------------------------------------------------------------
-- 8. Convenience view: active canonical values per engagement
--    Returns the "winning" value for each (engagement, canonical_key,
--    period_start, period_end) tuple — the last accepted/corrected row,
--    preferring corrected over accepted.
-- ---------------------------------------------------------------------------

create or replace view public.cev_active as
  select distinct on (
    engagement_id,
    canonical_key,
    coalesce(period_start::text, 'null'),
    coalesce(period_end::text,   'null')
  )
    id,
    organization_id,
    engagement_id,
    canonical_key,
    registry_version,
    extraction_method,
    document_id,
    extracted_field_id,
    desk_reading_id,
    period_kind,
    period_start,
    period_end,
    value_numeric,
    value_text,
    value_unit,
    value_as_stated,
    standard_value,
    standard_unit,
    confidence,
    state,
    -- Effective value: use correction if the auditor overrode it
    case
      when state = 'corrected' and correction_numeric is not null then correction_numeric
      else value_numeric
    end as effective_numeric,
    case
      when state = 'corrected' and correction_text is not null then correction_text
      else value_text
    end as effective_text,
    case
      when state = 'corrected' and correction_unit is not null then correction_unit
      else value_unit
    end as effective_unit,
    reviewed_by,
    reviewed_at,
    parent_id,
    aggregation_method,
    aggregated_child_count,
    fact_id,
    created_at
  from public.canonical_evidence_values
  where state in ('accepted', 'corrected')
  order by
    engagement_id,
    canonical_key,
    coalesce(period_start::text, 'null'),
    coalesce(period_end::text,   'null'),
    -- Prefer corrected over accepted, then most recently reviewed
    case state when 'corrected' then 0 else 1 end,
    reviewed_at desc nulls last,
    created_at desc;

-- ---------------------------------------------------------------------------
-- 9. Comments
-- ---------------------------------------------------------------------------

comment on table public.canonical_evidence_values is
  'Unified, period-aware, multi-source evidence store. '
  'Sits between extraction (extracted_fields, desk_readings) and calculation (facts). '
  'Every value carries full provenance and must be auditor-accepted before yielding a facts row. '
  'Append-only: accepted/corrected rows are never mutated; withdrawals create a new state transition.';

comment on column public.canonical_evidence_values.canonical_key is
  'The registry key this value is a reading of. Required. Must match a key in the pack''s canonical registry (backend/domain/registry/).';

comment on column public.canonical_evidence_values.extraction_method is
  'ai_extraction: Gemini/LLM extracted from PDF. '
  'workbook_reader: computed from XLSX SCADA data. '
  'regex_propose: corroboration drawer pattern-match. '
  'manual_entry: auditor typed in the UI. '
  'site_observation: site visit reading.';

comment on column public.canonical_evidence_values.state is
  'State machine: suggested → (pending_review →) accepted/corrected/rejected. '
  'accepted or corrected rows may transition to withdrawn. '
  'Only accepted/corrected rows may yield a facts row (via fact_id).';

comment on column public.canonical_evidence_values.input_hash is
  'SHA-256 of: document_file_hash | extraction_params_json | prompt_version. '
  'Null for manual_entry and site_observation rows.';

comment on column public.canonical_evidence_values.output_hash is
  'SHA-256 of: value_numeric::text | value_unit | provenance_page::text | provenance_source_text. '
  'Null for manual_entry rows where there is no machine-readable source.';

comment on column public.canonical_evidence_values.parent_id is
  'For roll-up aggregate rows: points at this row''s parent aggregate. '
  'For leaf rows (direct extraction / manual entry): null. '
  'The aggregate that is the annual value used by the calculation engine has parent_id null '
  'and aggregation_method set.';

comment on column public.canonical_evidence_values.fact_id is
  'Set by the API when this canonical evidence value is promoted to a facts row. '
  'Null until then. Only accepted or corrected annual rows produce facts rows.';

comment on column public.canonical_evidence_values.weight_kg is
  'For weighted_mean aggregation: the mass in kg this reading is weighted by. '
  'Example: a coal lot of 500 t has weight_kg = 500000.';

