-- ECM library — global reference data (not tenant data)
--
-- Energy Conservation Measure rows are catalogue data, like methodology_packs:
-- there is one published list, an ACVA does not own a copy of it. RLS grants
-- SELECT to any authenticated user and no write policy at all, which leaves
-- writes to the service role (which bypasses RLS) and therefore to migrations
-- and server-side seeds.
--
-- DO NOT seed this table from an LLM, and DO NOT insert "real" ECM entries in
-- this migration. A wrong row can cause real-world harm (cost, safety, a
-- measure that does not apply). Populating ecm_library is a domain-research
-- task: a published BEE sector ECM guide, reviewed by a domain advisor, then
-- loaded here. Until that happens the feature must run against the SYNTHETIC
-- fixture in backend/domain/ecm/fixture.ts only, and must not be enabled for
-- production decisions.

create table if not exists public.ecm_library (
  id uuid primary key default gen_random_uuid(),
  scheme text,
  sector_or_cluster text not null,
  equipment_tag text not null,
  ecm_name text not null,
  description text not null,
  typical_savings_range text,
  typical_payback_months int,
  source_reference text not null,
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists ecm_library_sector_equipment_idx
  on public.ecm_library (sector_or_cluster, equipment_tag);

comment on table public.ecm_library is
  'Curated Energy Conservation Measures. Global reference data (no organization_id): readable by any authenticated user, writable only by the service role. MUST NOT be seeded by an LLM. Empty in this migration on purpose — production seeding is a domain-research task.';

comment on column public.ecm_library.scheme is
  'Nullable. Some measures are scheme-agnostic; when set, matching may restrict to that scheme.';

comment on column public.ecm_library.equipment_tag is
  'Stable tag matched against facility energy/stream binding streamIds (e.g. coke, grid-electricity, coal-kiln).';

comment on column public.ecm_library.source_reference is
  'Visible citation the auditor can independently verify. Required. Synthetic fixture rows must say they are synthetic.';

-- ---------------------------------------------------------------------------
-- Row Level Security — catalogue read, service-role write
-- ---------------------------------------------------------------------------

alter table public.ecm_library enable row level security;

drop policy if exists ecm_library_read on public.ecm_library;
create policy ecm_library_read on public.ecm_library
  for select to authenticated using (true);

-- No INSERT/UPDATE/DELETE policy for authenticated, so RLS denies those by
-- default. Grants make that explicit at the privilege level too, matching
-- public.adeetie_clusters / public.methodology_packs.

revoke insert, update, delete on public.ecm_library from authenticated, anon;
grant select on public.ecm_library to authenticated;
grant select, insert, update, delete on public.ecm_library to service_role;
