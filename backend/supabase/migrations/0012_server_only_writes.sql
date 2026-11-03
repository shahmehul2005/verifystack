-- Server-only writes and append-only records
--
-- Signed-in users can reach PostgREST directly with the public anon key and
-- their own session JWT. Until now every tenant table carried a member policy
-- `for all`, so any member of a firm could insert, update or delete any row in
-- that firm without going through the API: forge a sign-off, close a block
-- finding, move an engagement to `submitted`, rewrite a calculation run, insert
-- a fact without provenance, or mark a factor verified without being a steward.
-- The capability map, maker–checker and steward checks only exist in the route
-- handlers, so those handlers must be the only write path.
--
-- Every application write already goes through a server route handler using
-- the service role (which bypasses RLS). This migration therefore leaves
-- signed-in users with read access to their own organisation and nothing else,
-- makes the records the product promises are immutable actually immutable, and
-- records who performed each audited action.
--
-- Operational purge (tenant offboarding, DPDP erasure) must set
--   set local verifystack.allow_purge = 'on';
-- inside a transaction before deleting, or the append-only triggers refuse.

-- ---------------------------------------------------------------------------
-- 1. Tenant tables: members may read their organisation's rows; no writes
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'engagements',
    'documents',
    'document_pages',
    'extraction_jobs',
    'extracted_fields',
    'facts',
    'calculation_runs',
    'findings',
    'signoffs',
    'ai_action_logs',
    'adeetie_measures',
    'factor_verification_state'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))',
      t || '_member_read',
      t
    );
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end
$$;

-- Factor verification log: written by the steward route through the service role.
drop policy if exists factor_verifications_insert on public.factor_verifications;
revoke insert, update, delete, truncate on public.factor_verifications from authenticated, anon;

-- Org-level factor overrides: no client writes.
drop policy if exists factor_records_write on public.factor_records;
revoke insert, update, delete, truncate on public.factor_records from authenticated, anon;

-- Memberships: role changes and invites go through /api/team and /api/auth/signup,
-- which enforce the last-admin rule and the one-firm-per-user rule.
drop policy if exists memberships_admin_write on public.memberships;
revoke insert, update, delete, truncate on public.memberships from authenticated, anon;

revoke insert, update, delete, truncate on public.organizations from authenticated, anon;
revoke insert, update, delete, truncate on public.audit_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Audit events: service role only, with the acting user recorded
-- ---------------------------------------------------------------------------

-- The app calls this with the service role, where auth.uid() is null, so the
-- original function stored no actor at all.
create or replace function public.append_audit_event_as(
  p_actor_user_id uuid,
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
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, payload
  ) values (
    p_organization_id,
    coalesce(auth.uid(), p_actor_user_id),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_payload, '{}'::jsonb)
  ) returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.append_audit_event_as(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_audit_event_as(uuid, uuid, text, text, text, jsonb) to service_role;

-- A member could otherwise write arbitrary events (for example a fake
-- "engagement.signed") into their own firm's audit log.
revoke execute on function public.append_audit_event(uuid, text, text, text, jsonb) from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Append-only records, enforced for every role including the service role
-- ---------------------------------------------------------------------------

create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('verifystack.allow_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'audit_events',
    'calculation_runs',
    'signoffs',
    'facts',
    'factor_verifications'
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

comment on function public.forbid_mutation() is
  'Refuses UPDATE/DELETE on append-only records unless verifystack.allow_purge is set to on for the transaction.';
