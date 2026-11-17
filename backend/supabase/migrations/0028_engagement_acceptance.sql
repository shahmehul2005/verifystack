-- Engagement acceptance and impartiality (CCTS).
-- Before verifying an entity the agency records that it is impartial towards it (ACVA accreditation procedure
-- 5.5.8-5.5.10), holds a contract in its own name and reviewed it (6.6.2, 6.6.3), and is accredited for the sector
-- (3.5). Each declaration is a new version. Rows are immutable, like verification_plans. The sign-off route reads the
-- latest version for CCTS engagements and stops while it is missing or blocked. Nothing here feeds a calculation.
create table if not exists public.engagement_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  version int not null check (version > 0),
  content jsonb not null,
  content_hash text not null,
  outcome text not null check (outcome in ('cleared', 'blocked')),
  declared_by uuid not null references auth.users(id),
  declared_name text not null,
  created_at timestamptz not null default now(),
  unique (engagement_id, version)
);
create index if not exists engagement_acceptances_eng_idx
  on public.engagement_acceptances (engagement_id, version desc);
alter table public.engagement_acceptances enable row level security;
drop policy if exists engagement_acceptances_member_read on public.engagement_acceptances;
create policy engagement_acceptances_member_read on public.engagement_acceptances
  for select to authenticated using (public.is_org_member(organization_id));
revoke insert, update, delete, truncate on public.engagement_acceptances from authenticated, anon;
drop trigger if exists engagement_acceptances_append_only on public.engagement_acceptances;
create trigger engagement_acceptances_append_only
  before update or delete on public.engagement_acceptances
  for each row execute function public.forbid_mutation();
comment on table public.engagement_acceptances is
  'Versioned, immutable impartiality, contract-review and accredited-scope declaration per engagement. Read by the sign-off gate for CCTS.';