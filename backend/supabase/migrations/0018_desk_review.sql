-- Desk review: figures an auditor reads off PDFs (the backend has no PDF reader and a model must
-- not produce a number a check depends on), and the saved results of each desk review run.
-- Neither table feeds a calculation. Writes are server-only (service role), like facts.

create table if not exists public.desk_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  /** Reading key, for example mpr.clinker_t or dpr.clinker@2023-11-03. */
  key text not null check (length(key) between 1 and 120),
  value numeric not null,
  unit text,
  /** The document the figure was read from, and the page, so the reading can be checked. */
  document_id uuid references public.documents(id) on delete set null,
  page int check (page is null or page > 0),
  note text,
  entered_by uuid references auth.users(id),
  entered_at timestamptz not null default now(),
  unique (engagement_id, key)
);

create table if not exists public.desk_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  pack_id text not null,
  /** DeskOutcome[] as computed. */
  results jsonb not null,
  /** Every reading the rules saw, workbook-derived and entered, so the run can be replayed. */
  readings jsonb not null,
  notes jsonb not null default '[]'::jsonb,
  run_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists desk_readings_engagement_idx on public.desk_readings (engagement_id);
create index if not exists desk_reviews_engagement_idx on public.desk_reviews (engagement_id, created_at desc);

alter table public.desk_readings enable row level security;
alter table public.desk_reviews enable row level security;

drop policy if exists desk_readings_member_read on public.desk_readings;
create policy desk_readings_member_read on public.desk_readings
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists desk_reviews_member_read on public.desk_reviews;
create policy desk_reviews_member_read on public.desk_reviews
  for select to authenticated using (public.is_org_member(organization_id));

revoke insert, update, delete, truncate on public.desk_readings from authenticated, anon;
revoke insert, update, delete, truncate on public.desk_reviews from authenticated, anon;
