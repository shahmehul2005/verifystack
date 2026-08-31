-- Factor verification audit
--
-- domain/factors.ts ships every reference factor with `verified: false` and a
-- source string ending in "TO VERIFY". Promoting one to verified is a human act
-- with a citation attached, and it changes calculation output, so it is
-- recorded as an event, not just as a flag flip.
--
-- Two objects:
--   public.factor_verifications      append-only log of each promotion/correction
--   public.factor_verification_state current state per (factor_id, vintage) per org
--
-- The state table is a separate table rather than columns on
-- public.factor_records because factor_records holds the *global* catalogue
-- (organization_id null) as well as org overrides, and verification is an
-- organization's own attestation: two ACVAs may verify the same global factor
-- independently, and one must not see or overwrite the other's attestation.
--
-- `factor_id` is the domain FactorRecord.id (= public.factor_records.factor_key).
-- No FK: factor_records is uniquely keyed by two *partial* indexes
-- (factor_records_global_key / factor_records_org_key), which cannot be the
-- target of a foreign key, and a factor may be verified while it exists only in
-- the code-side catalogue.

create table if not exists public.factor_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  factor_id text not null,
  vintage text not null,
  -- The whole point of the row. A citation must actually cite something, so a
  -- token like "ok" or "-" is rejected.
  cited_source text not null,
  -- Set when the verifier read a different number from the published source
  -- than the one the catalogue carried. Null means "confirmed as-is".
  corrected_value numeric,
  previous_value numeric,
  verified_by uuid references auth.users(id),
  verified_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  constraint factor_verifications_cited_source_check
    check (char_length(btrim(cited_source)) >= 12)
);

create index if not exists factor_verifications_org_factor_idx
  on public.factor_verifications (organization_id, factor_id, vintage, verified_at desc);

comment on table public.factor_verifications is
  'Append-only log of human factor verifications. Insert only: no UPDATE/DELETE, following the audit_events pattern in 0001.';

comment on column public.factor_verifications.corrected_value is
  'Null when the verifier confirmed the existing value. Non-null records the value read from the cited source.';

create table if not exists public.factor_verification_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  factor_id text not null,
  vintage text not null,
  verified boolean not null default false,
  -- Value in force for this organization once verification settled. Null means
  -- the catalogue value stands unchanged.
  current_value numeric,
  cited_source text,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  last_verification_id uuid references public.factor_verifications(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint factor_verification_state_unique unique (organization_id, factor_id, vintage),
  -- A verified state must carry the citation that made it verified.
  constraint factor_verification_state_verified_check
    check (
      verified = false
      or (cited_source is not null
          and char_length(btrim(cited_source)) >= 12
          and verified_at is not null)
    )
);

create index if not exists factor_verification_state_org_idx
  on public.factor_verification_state (organization_id, verified);

comment on table public.factor_verification_state is
  'Current verification state per (factor_id, vintage) per organization. Derived from factor_verifications; the log is the record of authority.';

-- ---------------------------------------------------------------------------
-- Row Level Security — organization_id isolation (same shape as 0001)
-- ---------------------------------------------------------------------------

alter table public.factor_verifications enable row level security;
alter table public.factor_verification_state enable row level security;

drop policy if exists factor_verifications_select on public.factor_verifications;
create policy factor_verifications_select on public.factor_verifications
  for select to authenticated
  using (public.is_org_member(organization_id));

-- INSERT is allowed directly (unlike audit_events, which routes through a
-- SECURITY DEFINER function) because the row carries the verifier's own
-- attestation and must be written in the same transaction as the state row.
drop policy if exists factor_verifications_insert on public.factor_verifications;
create policy factor_verifications_insert on public.factor_verifications
  for insert to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists factor_verifications_no_update on public.factor_verifications;
create policy factor_verifications_no_update on public.factor_verifications
  for update to authenticated
  using (false);

drop policy if exists factor_verifications_no_delete on public.factor_verifications;
create policy factor_verifications_no_delete on public.factor_verifications
  for delete to authenticated
  using (false);

revoke update, delete on public.factor_verifications from authenticated, anon;
grant select, insert on public.factor_verifications to authenticated;
grant select, insert on public.factor_verifications to service_role;

-- State is mutable by design, so it gets the generic org policy.
drop policy if exists factor_verification_state_org on public.factor_verification_state;
create policy factor_verification_state_org on public.factor_verification_state
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create or replace function public.factor_verification_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists factor_verification_state_set_updated_at
  on public.factor_verification_state;
create trigger factor_verification_state_set_updated_at
  before update on public.factor_verification_state
  for each row execute function public.factor_verification_state_touch();

-- The application should also call public.append_audit_event(...) with
-- entity_type 'factor' on each promotion. audit_events stays insert-only via
-- that function; nothing here writes to it directly.
