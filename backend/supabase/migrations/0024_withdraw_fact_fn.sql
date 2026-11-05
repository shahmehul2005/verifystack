-- Facts ledger: withdraw a wrong fact atomically, through one narrow door.
--
-- 0022 made withdrawal a copy into fact_withdrawals followed by a DELETE from public.facts, but
-- public.facts is append-only (0012, forbid_mutation), so the DELETE was refused every time. The
-- route also had to undo its own copy by hand when the delete failed.
--
-- This function does the whole withdrawal in one transaction, so it either happens completely or
-- not at all:
--   1. locks the engagement row and refuses once sign-off has started (the ledger the lead and the
--      reviewer sign is fixed), or when the engagement is not this organization's;
--   2. locks the fact and refuses unless it belongs to that engagement and organization;
--   3. copies the fact in full into fact_withdrawals, with who, when and why;
--   4. deletes it from public.facts, with verifystack.allow_purge turned on for that one statement
--      only, then turned off again before the function returns;
--   5. marks the extracted value it came from as rejected;
--   6. writes the audit event.
-- Only the service role can run it. fact_withdrawals becomes append-only here too, so the history a
-- withdrawal leaves cannot be edited or removed afterwards.

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
    accept_mode, accepted_by, accepted_at, reason, withdrawn_by
  ) values (
    f.organization_id, f.engagement_id, f.id, f.extracted_field_id, f.document_id, f.field_path,
    f.value_json, f.unit, f.page, f.bbox, f.source_text, f.provenance_type, f.provenance,
    f.accept_mode, f.accepted_by, f.accepted_at, btrim(p_reason), p_withdrawn_by
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

comment on function public.withdraw_fact(uuid, uuid, uuid, text, uuid) is
  'Atomically withdraws a fact: copies it to fact_withdrawals, removes it from the append-only facts ledger (purge permission on for that one DELETE only), rejects its extracted value and audits. Service role only; refused once sign-off has started.';

-- The history a withdrawal leaves is append-only, for every role including the service role.
drop trigger if exists fact_withdrawals_append_only on public.fact_withdrawals;
create trigger fact_withdrawals_append_only
  before update or delete on public.fact_withdrawals
  for each row execute function public.forbid_mutation();
