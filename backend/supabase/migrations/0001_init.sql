-- VerifyStack foundation schema
-- D1 engagements · D2 documents (bytes in Storage) · D3 packs · D4 facts
-- D5 calculation_runs · D6 findings · D7 audit_events · D8 factor_records
-- Apply with: supabase db push / supabase migration up
-- Env placeholders: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.membership_role as enum (
    'firm_admin',
    'lead_verifier',
    'verifier',
    'independent_reviewer'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pack_scheme as enum ('CCTS', 'ADEETIE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pack_status as enum ('runnable', 'scaffold');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.engagement_status as enum (
    'setup',
    'intake',
    'review',
    'calc',
    'findings',
    'signoff',
    'submitted'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Organizations & memberships (Auth: Supabase Auth + org tenancy)
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'acva' check (kind in ('acva', 'energy_auditor_firm')),
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists memberships_org_id_idx on public.memberships (organization_id);

-- ---------------------------------------------------------------------------
-- D3 Methodology packs
-- Process 3.0 / 5.0 MUST load a pack record — never sector if-branches in code.
-- ---------------------------------------------------------------------------

create table if not exists public.methodology_packs (
  pack_id text primary key,
  scheme public.pack_scheme not null,
  sector_or_cluster text not null,
  status public.pack_status not null default 'scaffold',
  version text not null,
  document_taxonomy jsonb not null default '[]'::jsonb,
  field_schemas jsonb not null default '{}'::jsonb,
  calculation_method text not null,
  emission_or_energy_factors jsonb not null default '[]'::jsonb,
  reconciliation_rules jsonb not null default '[]'::jsonb,
  clause_citations jsonb not null default '[]'::jsonb,
  report_template text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- D1 Engagements — pack bind is immutable (no pack_id updates after insert)
-- ---------------------------------------------------------------------------

create table if not exists public.engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_id text not null references public.methodology_packs(pack_id),
  pack_version text not null,
  scheme public.pack_scheme not null,
  sector_or_cluster text not null,
  client_name text not null,
  plant_name text,
  compliance_year text not null,
  gei_target numeric,
  status public.engagement_status not null default 'setup',
  draft_mode boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engagements_org_idx on public.engagements (organization_id);

create or replace function public.engagements_forbid_pack_rebind()
returns trigger
language plpgsql
as $$
begin
  if new.pack_id is distinct from old.pack_id
     or new.pack_version is distinct from old.pack_version then
    raise exception 'pack bind is immutable on engagement %', old.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists engagements_immutable_pack on public.engagements;
create trigger engagements_immutable_pack
  before update on public.engagements
  for each row execute function public.engagements_forbid_pack_rebind();

-- ---------------------------------------------------------------------------
-- D2 Documents — metadata only. Bytes live in Storage bucket `evidence`.
-- Object key = sha256 of file bytes. Same bytes = one storage object.
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  sha256 text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null,
  page_count int,
  doc_type text,
  classification_confidence numeric,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (engagement_id, sha256)
);

create index if not exists documents_sha256_idx on public.documents (sha256);
create index if not exists documents_engagement_idx on public.documents (engagement_id);

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number int not null check (page_number > 0),
  storage_path text,
  width_px int,
  height_px int,
  text_layer text,
  unique (document_id, page_number)
);

-- ---------------------------------------------------------------------------
-- Extraction jobs & suggested fields (pre-D4)
-- ---------------------------------------------------------------------------

create table if not exists public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  route text check (route in ('digital', 'vision')),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.extracted_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  extraction_job_id uuid not null references public.extraction_jobs(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  field_path text not null,
  value_json jsonb not null,
  unit text,
  confidence numeric not null,
  page int not null,
  bbox jsonb not null,
  source_text text not null,
  triage_action text not null check (triage_action in ('human_review', 'auto_commit')),
  state text not null default 'suggested' check (state in ('suggested', 'accepted', 'rejected', 'corrected')),
  correction_json jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists extracted_fields_engagement_state_idx
  on public.extracted_fields (engagement_id, state);

-- ---------------------------------------------------------------------------
-- D4 Facts — ONLY accepted fields. Provenance is mandatory (check constraints).
-- ---------------------------------------------------------------------------

create table if not exists public.facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  extracted_field_id uuid references public.extracted_fields(id),
  document_id uuid not null references public.documents(id),
  field_path text not null,
  value_json jsonb not null,
  unit text,
  page int not null check (page > 0),
  bbox jsonb not null,
  source_text text not null check (char_length(source_text) > 0),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- D5 Calculation runs — engine version + pack version + input hash
-- ---------------------------------------------------------------------------

create table if not exists public.calculation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  engine_version text not null,
  pack_id text not null,
  pack_version text not null,
  factor_set_version text not null,
  input_hash text not null,
  previous_run_hash text,
  inputs jsonb not null,
  result jsonb not null,
  draft_mode boolean not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists calculation_runs_engagement_idx
  on public.calculation_runs (engagement_id, created_at desc);

-- ---------------------------------------------------------------------------
-- D6 Findings
-- ---------------------------------------------------------------------------

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  calculation_run_id uuid references public.calculation_runs(id),
  rule_id text not null,
  severity text not null check (severity in ('block', 'warn', 'info')),
  title text not null,
  detail text not null,
  clause_ref text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  magnitude jsonb,
  state text not null default 'suggested'
    check (state in ('suggested', 'accepted', 'edited', 'rejected', 'closed')),
  heading text,
  body text,
  required_response text,
  generator text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- P7 Sign-offs (named attestation + hashed report). No DocuSign.
-- ---------------------------------------------------------------------------

create table if not exists public.signoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  role public.membership_role not null,
  attestor_name text not null,
  attestor_user_id uuid references auth.users(id),
  report_hash text not null,
  statement text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- D8 Factor records (global catalogue when organization_id is null)
-- ---------------------------------------------------------------------------

create table if not exists public.factor_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  factor_key text not null,
  label text not null,
  value numeric not null,
  unit text not null,
  vintage text not null,
  source text not null,
  verified boolean not null default false,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  cited_source_document text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists factor_records_global_key
  on public.factor_records (factor_key, vintage)
  where organization_id is null;

create unique index if not exists factor_records_org_key
  on public.factor_records (organization_id, factor_key, vintage)
  where organization_id is not null;

-- ---------------------------------------------------------------------------
-- D7 Audit events — append-only. No UPDATE/DELETE grants. Insert via definer fn.
-- ---------------------------------------------------------------------------

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_created_idx
  on public.audit_events (organization_id, created_at desc);

create table if not exists public.ai_action_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tool text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  evidence_id text,
  page_number int,
  started_at timestamptz not null,
  duration_ms int not null,
  raw_output text,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership helper (used by RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.org_role(org_id uuid)
returns public.membership_role
language sql
stable
security invoker
set search_path = public
as $$
  select m.role
  from public.memberships m
  where m.organization_id = org_id
    and m.user_id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- D7 insert-only path
-- ---------------------------------------------------------------------------

create or replace function public.append_audit_event(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_organization_id) then
    -- service role (auth.uid() is null in some JWT-less contexts) and members may insert
    -- when called as authenticated user, membership is required
    raise exception 'not a member of organization';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, payload
  ) values (
    p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb)
  ) returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.append_audit_event(uuid, text, text, text, jsonb) from public;
grant execute on function public.append_audit_event(uuid, text, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security — organization_id isolation
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.methodology_packs enable row level security;
alter table public.engagements enable row level security;
alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.extracted_fields enable row level security;
alter table public.facts enable row level security;
alter table public.calculation_runs enable row level security;
alter table public.findings enable row level security;
alter table public.signoffs enable row level security;
alter table public.factor_records enable row level security;
alter table public.audit_events enable row level security;
alter table public.ai_action_logs enable row level security;

-- Packs are catalogue data: readable by any authenticated user.
drop policy if exists methodology_packs_read on public.methodology_packs;
create policy methodology_packs_read on public.methodology_packs
  for select to authenticated using (true);

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships
  for all to authenticated
  using (public.org_role(organization_id) = 'firm_admin')
  with check (public.org_role(organization_id) = 'firm_admin');

-- Generic org isolation for tenant tables
drop policy if exists engagements_org on public.engagements;
create policy engagements_org on public.engagements
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists documents_org on public.documents;
create policy documents_org on public.documents
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists document_pages_org on public.document_pages;
create policy document_pages_org on public.document_pages
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists extraction_jobs_org on public.extraction_jobs;
create policy extraction_jobs_org on public.extraction_jobs
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists extracted_fields_org on public.extracted_fields;
create policy extracted_fields_org on public.extracted_fields
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists facts_org on public.facts;
create policy facts_org on public.facts
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists calculation_runs_org on public.calculation_runs;
create policy calculation_runs_org on public.calculation_runs
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists findings_org on public.findings;
create policy findings_org on public.findings
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists signoffs_org on public.signoffs;
create policy signoffs_org on public.signoffs
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists factor_records_select on public.factor_records;
create policy factor_records_select on public.factor_records
  for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));

drop policy if exists factor_records_write on public.factor_records;
create policy factor_records_write on public.factor_records
  for all to authenticated
  using (organization_id is not null and public.is_org_member(organization_id))
  with check (organization_id is not null and public.is_org_member(organization_id));

drop policy if exists ai_action_logs_org on public.ai_action_logs;
create policy ai_action_logs_org on public.ai_action_logs
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- audit_events: SELECT for members; INSERT only via append_audit_event; no UPDATE/DELETE
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Explicit deny for direct inserts by authenticated (function is SECURITY DEFINER)
drop policy if exists audit_events_no_direct_insert on public.audit_events;
create policy audit_events_no_direct_insert on public.audit_events
  for insert to authenticated
  with check (false);

drop policy if exists audit_events_no_update on public.audit_events;
create policy audit_events_no_update on public.audit_events
  for update to authenticated
  using (false);

drop policy if exists audit_events_no_delete on public.audit_events;
create policy audit_events_no_delete on public.audit_events
  for delete to authenticated
  using (false);

revoke update, delete on public.audit_events from authenticated, anon;
grant select on public.audit_events to authenticated;
grant insert, select on public.audit_events to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket `evidence`
-- Object key = sha256 of bytes (content-addressed). Same bytes = one object.
-- Bucket is private. Clients never upload directly — hashed-upload API uses
-- SUPABASE_SERVICE_ROLE after membership checks, then issues signed URLs.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- No storage.objects policies for anon/authenticated: access is server-mediated.
comment on table public.documents is
  'D2 metadata. Bytes in storage.buckets evidence; storage_path = sha256 hex of file bytes.';

comment on table public.audit_events is
  'D7 append-only. Insert via public.append_audit_event. No UPDATE/DELETE.';

comment on table public.facts is
  'D4 committed facts. Every row must have document, page, bbox, source_text.';
