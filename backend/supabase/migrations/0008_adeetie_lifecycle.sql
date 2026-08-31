-- ADEETIE lifecycle: per-phase evidence, per-pass sign-off, and DPR measures.
-- IGEA → DPR → M&V each run the full setup → submitted cycle. Evidence and
-- attestations must not leak across passes; measures are the DPR work product.

alter table public.documents
  add column if not exists adeetie_phase text;

alter table public.documents
  drop constraint if exists documents_adeetie_phase_check;
alter table public.documents
  add constraint documents_adeetie_phase_check
  check (adeetie_phase is null or adeetie_phase in ('IGEA', 'DPR', 'MV'));

comment on column public.documents.adeetie_phase is
  'ADEETIE pass this evidence was taken in. Null on CCTS documents and on ADEETIE rows uploaded before 0008. Baseline SEC reads IGEA (and null); post-implementation SEC reads MV.';

create index if not exists documents_engagement_phase_idx
  on public.documents (engagement_id, adeetie_phase);

alter table public.signoffs
  add column if not exists adeetie_phase text;

alter table public.signoffs
  drop constraint if exists signoffs_adeetie_phase_check;
alter table public.signoffs
  add constraint signoffs_adeetie_phase_check
  check (adeetie_phase is null or adeetie_phase in ('IGEA', 'DPR', 'MV'));

comment on column public.signoffs.adeetie_phase is
  'ADEETIE pass this attestation belongs to. Null on CCTS. Maker-checker is evaluated per pass, not across the whole engagement.';

create table if not exists public.adeetie_measures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  description text not null,
  projected_annual_saving numeric not null check (projected_annual_saving >= 0),
  saving_unit text not null,
  capital_cost_inr numeric not null check (capital_cost_inr >= 0),
  basis text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists adeetie_measures_engagement_idx
  on public.adeetie_measures (engagement_id);

alter table public.adeetie_measures enable row level security;

drop policy if exists adeetie_measures_org on public.adeetie_measures;
create policy adeetie_measures_org on public.adeetie_measures
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

comment on table public.adeetie_measures is
  'Energy conservation measures identified at IGEA and costed in the DPR. The scheme 10% gate is decided on measured M&V SEC, not on these projections.';
