-- DFD v3.1: stages, issue lifecycle, technical review, planning, fieldwork,
-- declared values, audited bulk accept, SAVINGS_DPR runs, non-PDF evidence.
--
-- Same conventions as 0012. Every new tenant table is readable by members of
-- its organisation and writable only through route handlers using the service
-- role. Records that must not change are append-only via public.forbid_mutation().

-- ---------------------------------------------------------------------------
-- 1. Stage manager (DFD 1.5)
-- ---------------------------------------------------------------------------

alter table public.engagements add column if not exists stage text;

create table if not exists public.engagement_stage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  direction text not null check (direction in ('forward', 'back')),
  note text,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists engagement_stage_events_eng_idx
  on public.engagement_stage_events (engagement_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Evidence that is not a page: documents, extraction proposals, facts
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists source text not null default 'upload'
    check (source in ('upload', 'evidence_pack', 'entity_response', 'fieldwork')),
  add column if not exists finding_id uuid references public.findings(id),
  add column if not exists scan_assessment jsonb;

-- Spreadsheet, time-series and archive uploads. Served as attachments only.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/zip'
]
where id = 'evidence';

alter table public.extraction_jobs drop constraint if exists extraction_jobs_route_check;
alter table public.extraction_jobs
  add constraint extraction_jobs_route_check check (route in ('digital', 'vision', 'tabular', 'fieldwork'));

-- A proposal from a spreadsheet mapping or a site visit has no extraction job,
-- and a site observation has no document.
alter table public.extracted_fields alter column extraction_job_id drop not null;
alter table public.extracted_fields alter column document_id drop not null;

alter table public.extracted_fields
  add column if not exists proposed_by uuid references auth.users(id),
  add column if not exists accept_mode text check (accept_mode in ('individual', 'bulk')),
  add column if not exists bulk_batch_id uuid;

alter table public.facts
  add column if not exists accept_mode text not null default 'individual'
    check (accept_mode in ('individual', 'bulk')),
  add column if not exists bulk_batch_id uuid;

-- ---------------------------------------------------------------------------
-- 3. Declared values (DFD 4.2). What the entity says; never a fact.
-- ---------------------------------------------------------------------------

create table if not exists public.declared_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  field_path text not null,
  value_json jsonb not null,
  unit text,
  source text not null check (source in ('evidence_pack', 'manual', 'setup')),
  document_id uuid references public.documents(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (engagement_id, field_path, source)
);

-- ---------------------------------------------------------------------------
-- 4. Audited bulk accept (DFD 4.0)
-- ---------------------------------------------------------------------------

create table if not exists public.bulk_accept_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  accepted_by uuid not null references auth.users(id),
  accepted_count int not null check (accepted_count > 0),
  sample_rate numeric not null,
  sample_field_ids jsonb not null,
  accepted_field_ids jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Issue lifecycle and entity response (DFD 7.0)
-- ---------------------------------------------------------------------------

alter table public.findings drop constraint if exists findings_state_check;
alter table public.findings
  add constraint findings_state_check check (
    state in ('suggested', 'accepted', 'edited', 'rejected', 'open', 'responded', 'verified', 'closed')
  );

alter table public.findings
  add column if not exists due_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists verified_at timestamptz,
  -- Matches the nonce inside the signed response link. Clearing it revokes the link.
  add column if not exists response_nonce text;

create table if not exists public.issue_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  kind text not null check (kind in ('entity', 'verifier')),
  responder_name text not null,
  responder_contact text,
  body text not null check (char_length(body) > 0),
  document_ids jsonb not null default '[]'::jsonb,
  recorded_by uuid references auth.users(id),
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists issue_responses_finding_idx on public.issue_responses (finding_id, created_at);

-- ---------------------------------------------------------------------------
-- 6. Independent technical review (DFD 8.4)
-- ---------------------------------------------------------------------------

create table if not exists public.technical_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  adeetie_phase text,
  reviewer_user_id uuid not null references auth.users(id),
  reviewer_name text not null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  comments text not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists technical_reviews_eng_idx on public.technical_reviews (engagement_id, created_at);

-- ---------------------------------------------------------------------------
-- 7. Verification plans (DFD 13.0). Versioned and immutable.
-- ---------------------------------------------------------------------------

create table if not exists public.verification_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  version int not null check (version > 0),
  status text not null check (status in ('draft', 'approved')),
  content jsonb not null,
  content_hash text not null,
  overall_risk text not null check (overall_risk in ('low', 'medium', 'high')),
  sample_rate numeric not null check (sample_rate > 0 and sample_rate <= 1),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (engagement_id, version)
);

-- ---------------------------------------------------------------------------
-- 8. Fieldwork (DFD 14.0, store D13)
-- ---------------------------------------------------------------------------

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  planned_for date,
  location text not null,
  scope text not null,
  assigned_to uuid references auth.users(id),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.site_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  visit_id uuid references public.site_visits(id),
  -- Idempotency key from the device, so an offline sync can be retried safely.
  client_id uuid not null,
  kind text not null check (kind in ('meter_reading', 'nameplate', 'process_note', 'photo', 'interview')),
  observer_user_id uuid not null references auth.users(id),
  observer_name text not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  field_path text,
  value_json jsonb,
  unit text,
  note text,
  evidence_file_ids jsonb not null default '[]'::jsonb,
  extracted_field_id uuid references public.extracted_fields(id),
  unique (engagement_id, client_id)
);
create index if not exists site_observations_eng_idx on public.site_observations (engagement_id, observed_at);

-- ---------------------------------------------------------------------------
-- 9. SAVINGS_DPR runs (DFD 5.0). A layer over ADEETIE; SEC runs are untouched.
-- ---------------------------------------------------------------------------

create table if not exists public.savings_dpr_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  engine_version text not null,
  input_hash text not null,
  previous_run_hash text,
  chain_hash text not null,
  inputs jsonb not null,
  result jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.adeetie_measures
  add column if not exists annual_cost_saving_inr numeric check (annual_cost_saving_inr is null or annual_cost_saving_inr >= 0);

-- ---------------------------------------------------------------------------
-- 10. Row level security and append-only enforcement
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'engagement_stage_events',
    'declared_values',
    'bulk_accept_batches',
    'issue_responses',
    'technical_reviews',
    'verification_plans',
    'site_visits',
    'site_observations',
    'savings_dpr_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))',
      t || '_member_read',
      t
    );
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;

  foreach t in array array[
    'engagement_stage_events',
    'bulk_accept_batches',
    'issue_responses',
    'technical_reviews',
    'verification_plans',
    'savings_dpr_runs'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.forbid_mutation()',
      t || '_append_only',
      t
    );
  end loop;
end
$$;

comment on table public.declared_values is
  'What the entity declared (evidence pack, setup or manual). Compared with facts in the review UI; never itself a fact.';
comment on table public.site_observations is
  'D13. Fieldwork records with observer, device time and location. An observation naming a field becomes a proposal in extracted_fields and needs a second person to accept it.';
comment on column public.findings.response_nonce is
  'Matches the nonce in the signed per-issue response link. Cleared on response or revocation.';
