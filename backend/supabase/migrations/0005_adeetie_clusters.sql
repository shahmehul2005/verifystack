-- ADEETIE notified clusters — global reference data
--
-- ADEETIE eligibility is geographic, so this is an eligibility control, not
-- decoration: it carries a source note and a verification flag like any other
-- reference datum.
--
-- NOT org-scoped. There is one notified list published by BEE; an ACVA does not
-- own a copy of it. So, following the public.methodology_packs pattern in 0001,
-- there is no organization_id: RLS grants SELECT to any authenticated user and
-- no write policy at all, which leaves writes to the service role (which
-- bypasses RLS) and therefore to migrations and server-side seeds.
--
-- Rows mirror NOTIFIED_CLUSTERS in backend/domain/packs/adeetie/clusters.ts
-- exactly, including rows that name several towns in one notified cluster
-- (e.g. "Batala, Jalandhar & Ludhiana"), which are one row there and one row
-- here so the count matches the published total of 60.

create table if not exists public.adeetie_clusters (
  id uuid primary key default gen_random_uuid(),
  sector text not null,
  state text not null,
  cluster text not null,
  -- False until the row has been read back against the official BEE list.
  -- Mirrors CLUSTERS_VERIFIED in clusters.ts, which is currently false.
  verified boolean not null default false,
  source_note text,
  created_at timestamptz not null default now(),
  -- (sector, cluster) is the natural key: the same town appears under several
  -- sectors (Ludhiana under Food Processing, Forging and Textiles), and state
  -- is an attribute of the cluster rather than part of its identity.
  constraint adeetie_clusters_sector_cluster_unique unique (sector, cluster)
);

create index if not exists adeetie_clusters_sector_idx
  on public.adeetie_clusters (sector);
create index if not exists adeetie_clusters_state_idx
  on public.adeetie_clusters (state);

comment on table public.adeetie_clusters is
  'BEE ADEETIE notified clusters. Global reference data (no organization_id): readable by any authenticated user, writable only by the service role.';

comment on column public.adeetie_clusters.verified is
  'False until the row has been checked against the official BEE list. An eligibility determination must not rely on an unverified row.';

-- ---------------------------------------------------------------------------
-- Row Level Security — catalogue read, service-role write
-- ---------------------------------------------------------------------------

alter table public.adeetie_clusters enable row level security;

drop policy if exists adeetie_clusters_read on public.adeetie_clusters;
create policy adeetie_clusters_read on public.adeetie_clusters
  for select to authenticated using (true);

-- No INSERT/UPDATE/DELETE policy is defined for authenticated, so RLS denies
-- those by default. The grants below make that explicit at the privilege level
-- too, in the manner of the audit_events grants in 0001.
revoke insert, update, delete on public.adeetie_clusters from authenticated, anon;
grant select on public.adeetie_clusters to authenticated;
grant select, insert, update, delete on public.adeetie_clusters to service_role;

-- ---------------------------------------------------------------------------
-- Seed: the 60 notified clusters. Safe to re-run.
-- ---------------------------------------------------------------------------

insert into public.adeetie_clusters (sector, state, cluster, verified, source_note)
select
  v.sector,
  v.state,
  v.cluster,
  false,
  'BEE ADEETIE notified cluster list, https://adeetie.beeindia.gov.in/list-of-eligible-clusters-under-adeetie-scheme — TO VERIFY. The official page returned HTTP 500 at the time of compilation; some rows are from a secondary source and no row has been read back against the gazette.'
from (values
  -- Brass (5)
  ('Brass', 'Haryana', 'Jagadhri'),
  ('Brass', 'Gujarat', 'Jamnagar'),
  ('Brass', 'Uttar Pradesh', 'Moradabad'),
  ('Brass', 'Tamil Nadu', 'Salem'),
  ('Brass', 'Karnataka', 'Bangalore'),
  -- Bricks (4)
  ('Bricks', 'Bihar', 'Begusarai'),
  ('Bricks', 'Madhya Pradesh', 'Indore'),
  ('Bricks', 'Maharashtra', 'Nagpur'),
  ('Bricks', 'Tripura', 'Tripura'),
  -- Ceramics (4)
  ('Ceramics', 'Gujarat', 'Morbi Region'),
  ('Ceramics', 'Gujarat', 'Thangadh'),
  ('Ceramics', 'Gujarat', 'Vapi'),
  ('Ceramics', 'Uttar Pradesh', 'Khurja'),
  -- Chemicals (4)
  ('Chemicals', 'Gujarat', 'Ankleshwar & Panoli'),
  ('Chemicals', 'Jharkhand', 'Jamshedpur'),
  ('Chemicals', 'Haryana', 'Karnal'),
  ('Chemicals', 'Maharashtra', 'Thane'),
  -- Fisheries (3)
  ('Fisheries', 'Kerala', 'Kochi'),
  ('Fisheries', 'Odisha', 'Bhubaneswar'),
  ('Fisheries', 'Andhra Pradesh', 'West Godavari'),
  -- Food Processing (4)
  ('Food Processing', 'Punjab', 'Ludhiana'),
  ('Food Processing', 'Maharashtra', 'Pune'),
  ('Food Processing', 'Odisha', 'Ganjam & Nayagarh (Rice)'),
  ('Food Processing', 'Haryana', 'Kaithal (Rice)'),
  -- Forging (5)
  ('Forging', 'Karnataka', 'Bangalore'),
  ('Forging', 'Maharashtra', 'Pune'),
  ('Forging', 'Delhi', 'Delhi-NCR'),
  ('Forging', 'Tamil Nadu', 'Chennai'),
  ('Forging', 'Punjab', 'Ludhiana'),
  -- Foundry (5)
  ('Foundry', 'Punjab', 'Batala, Jalandhar & Ludhiana'),
  ('Foundry', 'West Bengal', 'Howrah'),
  ('Foundry', 'Gujarat', 'Rajkot'),
  ('Foundry', 'Karnataka', 'Belgaum'),
  ('Foundry', 'Tamil Nadu', 'Coimbatore'),
  -- Glass & Refractory (4)
  ('Glass & Refractory', 'Haryana', 'Ambala'),
  ('Glass & Refractory', 'Jharkhand', 'Chirkunda'),
  ('Glass & Refractory', 'Andhra Pradesh', 'East & West Godavari'),
  ('Glass & Refractory', 'Uttar Pradesh', 'Firozabad'),
  -- Leather (4)
  ('Leather', 'Uttar Pradesh', 'Kanpur'),
  ('Leather', 'West Bengal', 'Kolkata'),
  ('Leather', 'Tamil Nadu', 'Pallavaram'),
  ('Leather', 'Punjab', 'Jalandhar'),
  -- Paper (4)
  ('Paper', 'Uttar Pradesh', 'Muzaffarnagar & Saharanpur'),
  ('Paper', 'Uttarakhand', 'Kashipur'),
  ('Paper', 'Gujarat', 'Vapi'),
  ('Paper', 'Tamil Nadu', 'Coimbatore & Erode'),
  -- Pharma (5)
  ('Pharma', 'Gujarat', 'Ahmedabad'),
  ('Pharma', 'Himachal Pradesh', 'Baddi'),
  ('Pharma', 'Telangana', 'Medak Region'),
  ('Pharma', 'Goa', 'Margao'),
  ('Pharma', 'Karnataka', 'Bidar'),
  -- Steel Re-rolling (4)
  ('Steel Re-rolling', 'Punjab', 'Mandi Gobindgarh & Ludhiana'),
  ('Steel Re-rolling', 'Rajasthan', 'Jaipur'),
  ('Steel Re-rolling', 'Maharashtra', 'Jalna'),
  ('Steel Re-rolling', 'Chhattisgarh', 'Raipur'),
  -- Textiles (5)
  ('Textiles', 'Punjab', 'Ludhiana'),
  ('Textiles', 'Gujarat', 'Surat'),
  ('Textiles', 'Tamil Nadu', 'Tirupur'),
  ('Textiles', 'Maharashtra', 'Solapur'),
  ('Textiles', 'Haryana', 'Panipat')
) as v(sector, state, cluster)
on conflict (sector, cluster) do nothing;
