-- memberships_select used is_org_member(), and is_org_member() reads
-- memberships as SECURITY INVOKER. That is a deadlock: the user can never
-- see their own membership, so getSession() always returns no organisation
-- even after bootstrap inserts the row.
--
-- Fix: read memberships as definer, and allow a user to select their own rows.

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
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
security definer
set search_path = public
as $$
  select m.role
  from public.memberships m
  where m.organization_id = org_id
    and m.user_id = auth.uid()
  limit 1;
$$;

drop policy if exists memberships_self_select on public.memberships;
create policy memberships_self_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid());
