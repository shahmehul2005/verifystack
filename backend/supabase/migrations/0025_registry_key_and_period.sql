-- Registry: a canonical key and a reporting period on extracted values and facts (nullable, additive).
--
-- Requires 0022 (fact_withdrawals). Replaces withdraw_fact from 0024 so a withdrawal keeps the new columns.
--
-- What this adds, and what it does not:
--  - Five nullable columns plus the registry version on extracted_fields, facts and fact_withdrawals:
--      canonical_key   the registry key the value is a reading of (null = not mapped)
--      period_start,
--      period_end      the reporting period it covers, inclusive dates
--      period_status   'known' or 'unknown' (null = no period was assessed for this value)
--      period_note     why a period is unknown, or what was assumed to place it
--      registry_version the registry version that produced the key
--  - Existing rows are untouched and stay null. Nothing is backfilled: a fact accepted before this
--    migration reads as "not mapped", never as a guessed key or period.
--  - The facts ledger stays append-only. Only ADD COLUMN and constraints change; no row is updated.
--  - Nothing here feeds a calculation. The columns are read by the comparison view only.

alter table public.extracted_fields
  add column if not exists canonical_key text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists period_status text,
  add column if not exists period_note text,
  add column if not exists registry_version text;

alter table public.facts
  add column if not exists canonical_key text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists period_status text,
  add column if not exists period_note text,
  add column if not exists registry_version text;

alter table public.fact_withdrawals
  add column if not exists canonical_key text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists period_status text,
  add column if not exists period_note text,
  add column if not exists registry_version text;

-- A period is either known (both dates, in order), unknown (no dates), or not assessed (nothing).
do $$
declare
  t text;
begin
  foreach t in array array['extracted_fields', 'facts', 'fact_withdrawals'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_period_check');
    execute format(
      'alter table public.%I add constraint %I check (
         (period_status is null and period_start is null and period_end is null)
         or (period_status = ''unknown'' and period_start is null and period_end is null)
         or (period_status = ''known'' and period_start is not null and period_end is not null and period_start <= period_end)
       )',
      t,
      t || '_period_check'
    );
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_key_has_version_check');
    execute format(
      'alter table public.%I add constraint %I check (canonical_key is null or registry_version is not null)',
      t,
      t || '_key_has_version_check'
    );
  end loop;
end
$$;

create index if not exists extracted_fields_engagement_key_idx
  on public.extracted_fields (engagement_id, canonical_key) where canonical_key is not null;
create index if not exists facts_engagement_key_idx
  on public.facts (engagement_id, canonical_key) where canonical_key is not null;

comment on column public.facts.canonical_key is
  'Registry key this fact is a reading of. Null for facts accepted before the registry or from a source with no mapping. Never used by a calculation.';
comment on column public.facts.period_status is
  'known, unknown, or null (not assessed). An unknown period is a recorded state with a reason in period_note, not a default.';

create or replace function public.withdraw_fact(
  p_organization_id uuid,
  p_engagement_id uuid,
  p_fact_id uuid,
  p_reason text,
  p_withdrawn_by uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eng_status text;
  f public.facts%rowtype;
  withdrawal_id uuid;
  removed int;
begin
  if p_organization_id is null or p_engagement_id is null or p_fact_id is null or p_withdrawn_by is null then
    raise exception 'withdraw_fact: organization, engagement, fact and user are all required'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'withdraw_fact: a reason of at least 8 characters is required'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The engagement must be this organization's. The lock keeps sign-off from starting while the
  -- withdrawal runs.
  select e.status::text into eng_status
    from public.engagements e
   where e.id = p_engagement_id
     and e.organization_id = p_organization_id
     for update;
  if eng_status is null then
    raise exception 'withdraw_fact: engagement not found' using errcode = 'no_data_found';
  end if;
  if eng_status in ('signoff', 'submitted') then
    raise exception 'withdraw_fact: sign-off has started, so the facts ledger can no longer change'
      using errcode = 'check_violation';
  end if;

  select * into f
    from public.facts
   where id = p_fact_id
     and engagement_id = p_engagement_id
     and organization_id = p_organization_id
     for update;
  if not found then
    raise exception 'withdraw_fact: fact not found in this engagement' using errcode = 'no_data_found';
  end if;

  -- History first. If this fails nothing has been removed.
  insert into public.fact_withdrawals (
    organization_id, engagement_id, fact_id, extracted_field_id, document_id, field_path,
    value_json, unit, page, bbox, source_text, provenance_type, provenance,
    accept_mode, accepted_by, accepted_at, reason, withdrawn_by,
    canonical_key, period_start, period_end, period_status, period_note, registry_version
  ) values (
    f.organization_id, f.engagement_id, f.id, f.extracted_field_id, f.document_id, f.field_path,
    f.value_json, f.unit, f.page, f.bbox, f.source_text, f.provenance_type, f.provenance,
    f.accept_mode, f.accepted_by, f.accepted_at, btrim(p_reason), p_withdrawn_by,
    f.canonical_key, f.period_start, f.period_end, f.period_status, f.period_note, f.registry_version
  ) returning id into withdrawal_id;

  -- The purge permission is on for this DELETE and off again straight after, so nothing else in a
  -- larger transaction can use it. A failure rolls the whole transaction back, setting included.
  perform set_config('verifystack.allow_purge', 'on', true);
  delete from public.facts where id = f.id;
  get diagnostics removed = row_count;
  perform set_config('verifystack.allow_purge', '', true);
  if removed <> 1 then
    raise exception 'withdraw_fact: expected to remove one fact, removed %', removed;
  end if;

  if f.extracted_field_id is not null then
    update public.extracted_fields
       set state = 'rejected', reviewed_by = p_withdrawn_by, reviewed_at = now()
     where id = f.extracted_field_id
       and organization_id = p_organization_id
       and state in ('accepted', 'corrected');
  end if;

  perform public.append_audit_event_as(
    p_withdrawn_by,
    p_organization_id,
    'fact.withdrawn',
    'fact',
    f.id::text,
    jsonb_build_object(
      'field_path', f.field_path,
      'value', f.value_json,
      'unit', f.unit,
      'reason', btrim(p_reason),
      'withdrawal_id', withdrawal_id
    )
  );

  return withdrawal_id;
end;
$$;

-- Supabase grants execute on new functions to anon and authenticated by default, so name them.
revoke all on function public.withdraw_fact(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_fact(uuid, uuid, uuid, text, uuid) to service_role;
