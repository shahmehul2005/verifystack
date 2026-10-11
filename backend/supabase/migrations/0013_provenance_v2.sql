-- Provenance v2 and the tabular store (DFD v3.1: provenance model, D10)
--
-- A fact used to mean "a rectangle on a page of a document". Spreadsheets,
-- SCADA exports and site visits produce evidence that has no page, so the same
-- guarantee ("no value without a traceable source") now has four shapes:
--
--   document_page      document + page + bbox + source text (the original shape)
--   spreadsheet_cell   document + sheet + cell reference + value
--   time_series_range  document + tag + time window + aggregation + row count
--   site_observation   observer + timestamp + optional location + evidence files
--
-- The guarantee itself does not weaken. A CHECK constraint requires every row
-- to carry the complete evidence for its own type, and rows written before this
-- migration are all `document_page`, which they already satisfy. Page evidence
-- keeps its original columns; the other three types use the `provenance` jsonb.
--
-- Also adds the D10 tabular store: one summary row per parsed sheet or
-- time-series tag set. The original upload stays in Storage and is the source
-- of truth; the summary is re-derivable from it.

-- ---------------------------------------------------------------------------
-- 1. facts
-- ---------------------------------------------------------------------------

alter table public.facts
  add column if not exists provenance_type text not null default 'document_page',
  add column if not exists provenance jsonb;

alter table public.facts alter column document_id drop not null;
alter table public.facts alter column page drop not null;
alter table public.facts alter column bbox drop not null;
alter table public.facts alter column source_text drop not null;

alter table public.facts drop constraint if exists facts_page_check;
alter table public.facts drop constraint if exists facts_source_text_check;
alter table public.facts drop constraint if exists facts_provenance_type_check;
alter table public.facts drop constraint if exists facts_provenance_complete;

alter table public.facts
  add constraint facts_provenance_type_check
  check (provenance_type in ('document_page', 'spreadsheet_cell', 'time_series_range', 'site_observation'));

alter table public.facts
  add constraint facts_provenance_complete
  check (
    (provenance_type = 'document_page'
      and document_id is not null
      and page is not null and page > 0
      and bbox is not null
      and source_text is not null and char_length(source_text) > 0)
    or (provenance_type in ('spreadsheet_cell', 'time_series_range')
      and document_id is not null
      and provenance is not null)
    or (provenance_type = 'site_observation'
      and provenance is not null)
  );

-- ---------------------------------------------------------------------------
-- 2. extracted_fields (the proposal a human accepts into a fact)
-- ---------------------------------------------------------------------------

alter table public.extracted_fields
  add column if not exists provenance_type text not null default 'document_page',
  add column if not exists provenance jsonb;

alter table public.extracted_fields alter column page drop not null;
alter table public.extracted_fields alter column bbox drop not null;
alter table public.extracted_fields alter column source_text drop not null;

alter table public.extracted_fields drop constraint if exists extracted_fields_provenance_type_check;
alter table public.extracted_fields drop constraint if exists extracted_fields_provenance_complete;

alter table public.extracted_fields
  add constraint extracted_fields_provenance_type_check
  check (provenance_type in ('document_page', 'spreadsheet_cell', 'time_series_range', 'site_observation'));

alter table public.extracted_fields
  add constraint extracted_fields_provenance_complete
  check (
    (provenance_type = 'document_page'
      and page is not null and page > 0
      and bbox is not null
      and source_text is not null and char_length(source_text) > 0)
    or (provenance_type in ('spreadsheet_cell', 'time_series_range', 'site_observation')
      and provenance is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. D10 tabular store
-- ---------------------------------------------------------------------------

create table if not exists public.tabular_datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  kind text not null check (kind in ('spreadsheet', 'time_series')),
  /** Sheet name for spreadsheets; the file name for time series. */
  name text not null,
  columns jsonb not null default '[]'::jsonb,
  row_count int not null default 0 check (row_count >= 0),
  /**
   * spreadsheet: a bounded preview of the cells used for mapping.
   * time_series: per-tag count, min, max, mean, sum, first and last timestamp,
   * plus gap and out-of-range counts from normalisation.
   */
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, name)
);

create index if not exists tabular_datasets_engagement_idx
  on public.tabular_datasets (engagement_id);

alter table public.tabular_datasets enable row level security;

drop policy if exists tabular_datasets_member_read on public.tabular_datasets;
create policy tabular_datasets_member_read on public.tabular_datasets
  for select to authenticated using (public.is_org_member(organization_id));

revoke insert, update, delete, truncate on public.tabular_datasets from authenticated, anon;
