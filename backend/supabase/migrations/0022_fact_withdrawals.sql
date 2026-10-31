-- Facts ledger: a wrong fact can be withdrawn, and is kept.
-- A run refuses an input with more than one fact, and nothing could remove one. A withdrawal copies the
-- fact here with who withdrew it, when and why, then the server removes it from public.facts, so the
-- ledger a run reads holds only the facts that stand. This table is append-only and holds the full
-- record: value, unit, document, page, region, source text and provenance, as it was accepted.
-- Writes are server-only (service role), like facts. Nothing here feeds a calculation.

create table if not exists public.fact_withdrawals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  /** The id the fact had in public.facts. No foreign key: that row is gone. */
  fact_id uuid not null,
  extracted_field_id uuid,
  document_id uuid references public.documents(id) on delete set null,
  field_path text not null,
  value_json jsonb not null,
  unit text,
  page int,
  bbox jsonb,
  source_text text,
  provenance_type text,
  provenance jsonb,
  accept_mode text,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  reason text not null check (length(btrim(reason)) >= 8),
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz not null default now()
);

create index if not exists fact_withdrawals_engagement_idx
  on public.fact_withdrawals (engagement_id, withdrawn_at desc);

alter table public.fact_withdrawals enable row level security;

drop policy if exists fact_withdrawals_member_read on public.fact_withdrawals;
create policy fact_withdrawals_member_read on public.fact_withdrawals
  for select to authenticated using (public.is_org_member(organization_id));

revoke insert, update, delete, truncate on public.fact_withdrawals from authenticated, anon;
