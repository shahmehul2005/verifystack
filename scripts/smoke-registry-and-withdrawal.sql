-- Smoke test for migrations 0024 (withdraw_fact) and 0025 (registry key and period columns).
--
-- Run each numbered block on its own in the Supabase SQL editor, against a DEVELOPMENT project.
-- Blocks 2 and 3 end by raising an exception on purpose, so everything they do is rolled back and
-- nothing is kept. The red error message IS the report: read the lines in it.
--
-- Not for production. Block 2 needs at least one accepted fact in an engagement that is not yet in
-- sign-off; block 3 needs at least one extracted value.


-- 1. Which migrations are applied? Every column should say true before you go on.
select
  to_regclass('public.desk_resolutions')      is not null as m0019_desk_resolutions,
  to_regclass('public.desk_reading_history')  is not null as m0021_desk_reading_history,
  to_regclass('public.fact_withdrawals')      is not null as m0022_fact_withdrawals,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'desk_readings' and column_name = 'value_text') as m0023_desk_reading_text,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'withdraw_fact') as m0024_withdraw_fn,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'facts' and column_name = 'canonical_key') as m0025_registry_columns;


-- 2. Withdrawal: atomic, service-role only, history kept, ledger still append-only.
--    Expected report, all five lines "ok" and the first two true / 1:
--      fact removed from ledger: true
--      withdrawal rows holding the full copy: 1
--      purge permission after: off
--      ok: direct DELETE refused / ok: anon refused / ok: wrong organization refused / ok: history is append-only
do $$
declare
  f public.facts%rowtype;
  uid uuid;
  wid uuid;
  gone boolean;
  kept int;
  purge text;
  direct text;
  anon_try text;
  wrong_org text;
  hist text;
begin
  select f2.* into f
    from public.facts f2
    join public.engagements e on e.id = f2.engagement_id
   where e.status::text not in ('signoff', 'submitted')
   order by f2.accepted_at desc
   limit 1;
  if not found then
    raise exception 'SMOKE: there is no fact in an open engagement to test with. Accept one value first.';
  end if;
  uid := coalesce(f.accepted_by, (select id from auth.users limit 1));

  -- The ledger still refuses a direct delete.
  begin
    delete from public.facts where id = f.id;
    direct := 'FAIL: a direct DELETE was allowed';
  exception when insufficient_privilege then
    direct := 'ok: direct DELETE refused';
  end;

  -- The anonymous role cannot run the function.
  begin
    set local role anon;
    perform public.withdraw_fact(f.organization_id, f.engagement_id, f.id, 'smoke test as anon', uid);
    anon_try := 'FAIL: anon could run withdraw_fact';
  exception when insufficient_privilege then
    anon_try := 'ok: anon refused';
  end;
  reset role;

  -- Another organization's id finds nothing.
  begin
    perform public.withdraw_fact(gen_random_uuid(), f.engagement_id, f.id, 'smoke test wrong org', uid);
    wrong_org := 'FAIL: a wrong organization was accepted';
  exception when no_data_found then
    wrong_org := 'ok: wrong organization refused';
  end;

  -- The real withdrawal.
  wid := public.withdraw_fact(f.organization_id, f.engagement_id, f.id, 'smoke test withdrawal', uid);
  select count(*) = 0 into gone from public.facts where id = f.id;
  select count(*) into kept
    from public.fact_withdrawals
   where id = wid and fact_id = f.id and value_json = f.value_json and field_path = f.field_path;
  purge := coalesce(nullif(current_setting('verifystack.allow_purge', true), ''), 'off');

  -- The history cannot be edited afterwards.
  begin
    update public.fact_withdrawals set reason = 'tampered with after the fact' where id = wid;
    hist := 'FAIL: the withdrawal history could be edited';
  exception when insufficient_privilege then
    hist := 'ok: history is append-only';
  end;

  raise exception E'SMOKE RESULT (rolled back, nothing kept)\n  fact removed from ledger: %\n  withdrawal rows holding the full copy: %\n  purge permission after: %\n  %\n  %\n  %\n  %',
    gone, kept, purge, direct, anon_try, wrong_org, hist;
end
$$;


-- 3. Registry columns: the period and key rules the database enforces.
--    Every line should read "as expected".
create or replace function pg_temp.try_field(p_status text, p_start date, p_end date, p_key text, p_version text)
returns text
language plpgsql
as $$
begin
  insert into public.extracted_fields (
    organization_id, extraction_job_id, document_id, engagement_id, field_path, value_json, unit,
    confidence, page, bbox, source_text, provenance_type, provenance, triage_action,
    canonical_key, period_status, period_start, period_end, registry_version
  )
  select organization_id, extraction_job_id, document_id, engagement_id, field_path, value_json, unit,
         confidence, page, bbox, source_text, provenance_type, provenance, triage_action,
         p_key, p_status, p_start, p_end, p_version
    from public.extracted_fields
   limit 1;
  if not found then return 'no extracted value to copy from'; end if;
  return 'accepted';
exception when check_violation then
  return 'refused';
end
$$;

do $$
declare
  lines text := '';
  got text;
  rec record;
begin
  for rec in
    select * from (values
      (1, 'known, dates in order, key with version',  'known',   date '2023-11-01', date '2023-11-30', 'grid_electricity_import', '0.1.0-provisional', 'accepted'),
      (2, 'known but ends before it starts',          'known',   date '2023-11-30', date '2023-11-01', 'grid_electricity_import', '0.1.0-provisional', 'refused'),
      (3, 'known with no end date',                   'known',   date '2023-11-01', null::date,        'grid_electricity_import', '0.1.0-provisional', 'refused'),
      (4, 'unknown but carrying dates',               'unknown', date '2023-11-01', date '2023-11-30', 'grid_electricity_import', '0.1.0-provisional', 'refused'),
      (5, 'unknown with no dates',                    'unknown', null::date,        null::date,        'grid_electricity_import', '0.1.0-provisional', 'accepted'),
      (6, 'dates but no status',                      null,      date '2023-11-01', date '2023-11-30', 'grid_electricity_import', '0.1.0-provisional', 'refused'),
      (7, 'a key with no registry version',           null,      null::date,        null::date,        'grid_electricity_import', null,                 'refused'),
      (8, 'nothing set (an unmapped value)',          null,      null::date,        null::date,        null,                      null,                 'accepted')
    ) as t(n, what, st, s, e, k, v, want)
  loop
    got := pg_temp.try_field(rec.st, rec.s, rec.e, rec.k, rec.v);
    lines := lines || E'\n  ' || rec.n || '. ' || rec.what || ': ' || got ||
             case when got = rec.want then ' (as expected)' else ' (UNEXPECTED, wanted ' || rec.want || ')' end;
  end loop;
  raise exception E'SMOKE RESULT (rolled back, nothing kept)%', lines;
end
$$;


-- 4. After you have extracted, accepted and withdrawn a value through the app, look at what was stored.
--    Replace the engagement id. Rows accepted before migration 0025 show nulls, by design.
-- select field_path, canonical_key, period_status, period_start, period_end, period_note, registry_version, state
--   from public.extracted_fields where engagement_id = '00000000-0000-0000-0000-000000000000' order by created_at desc;
-- select field_path, canonical_key, period_status, period_start, period_end, registry_version
--   from public.facts where engagement_id = '00000000-0000-0000-0000-000000000000' order by accepted_at desc;
-- select field_path, canonical_key, period_status, reason, withdrawn_at
--   from public.fact_withdrawals where engagement_id = '00000000-0000-0000-0000-000000000000' order by withdrawn_at desc;
