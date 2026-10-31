-- Desk review: every change to a figure an auditor read off a document is kept.
-- desk_readings holds only the latest value for a key. This table is append-only and holds each
-- entry, edit and withdrawal with who made it, when, and why. An edit replaces the current figure
-- but the earlier one stays here; a withdrawal removes the current figure but not its record.
-- Writes are server-only (service role), like desk_readings. Nothing here feeds a calculation.

create table if not exists public.desk_reading_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  key text not null check (length(key) between 1 and 120),
  action text not null check (action in ('entered', 'edited', 'withdrawn')),
  /** The figure after the change. Null for a withdrawal. */
  value numeric,
  unit text,
  document_id uuid references public.documents(id) on delete set null,
  page int check (page is null or page > 0),
  bbox jsonb,
  source_text text,
  source_kind text check (source_kind is null or source_kind in ('typed', 'snip')),
  /** The figure it replaced or removed, as it stood: value, document, page, region. Null for a first entry. */
  previous jsonb,
  /** Why. Required for an edit and a withdrawal, empty for a first entry. */
  reason text not null default '',
  acted_by uuid references auth.users(id),
  acted_at timestamptz not null default now(),
  constraint desk_reading_history_reason_required check (
    action = 'entered' or length(btrim(reason)) >= 8
  )
);

create index if not exists desk_reading_history_engagement_idx
  on public.desk_reading_history (engagement_id, acted_at desc);
create index if not exists desk_reading_history_key_idx
  on public.desk_reading_history (engagement_id, key, acted_at desc);

alter table public.desk_reading_history enable row level security;

drop policy if exists desk_reading_history_member_read on public.desk_reading_history;
create policy desk_reading_history_member_read on public.desk_reading_history
  for select to authenticated using (public.is_org_member(organization_id));

revoke insert, update, delete, truncate on public.desk_reading_history from authenticated, anon;
