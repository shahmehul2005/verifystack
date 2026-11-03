-- Desk review: the verifier's decision on each failed or waiting check.
-- One row per engagement and check. No row means the check is unresolved.
-- A decision that blocks sign-off lives on the linked finding; this table records which of the
-- five resolution states the verifier chose, why, and who. Writes are server-only (service role),
-- like facts and desk_reviews. Nothing here feeds a calculation.

create table if not exists public.desk_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  /** The desk-review check id, for example form1_direct. The finding's rule_id is DESK-<rule_id>. */
  rule_id text not null check (length(rule_id) between 1 and 120),
  resolution_state text not null check (
    resolution_state in (
      'resolved',
      'accepted_with_explanation',
      'unresolved_immaterial',
      'unresolved_material',
      'scope_limitation'
    )
  ),
  reason text not null default '',
  finding_id uuid references public.findings(id) on delete set null,
  decided_by uuid references auth.users(id),
  decided_at timestamptz not null default now(),
  unique (engagement_id, rule_id)
);

create index if not exists desk_resolutions_engagement_idx on public.desk_resolutions (engagement_id);

alter table public.desk_resolutions enable row level security;

drop policy if exists desk_resolutions_member_read on public.desk_resolutions;
create policy desk_resolutions_member_read on public.desk_resolutions
  for select to authenticated using (public.is_org_member(organization_id));

revoke insert, update, delete, truncate on public.desk_resolutions from authenticated, anon;
