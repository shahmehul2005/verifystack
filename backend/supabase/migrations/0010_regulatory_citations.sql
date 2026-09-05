-- Regulatory citation assistant (Feature 1).
--
-- Platform reference data, same grant/RLS shape as methodology_packs and
-- adeetie_clusters: readable by any authenticated user, writable only by
-- service_role. Not org-scoped — there is one BEE text, not a copy per firm.
--
-- REQUIRES pgvector. On hosted Supabase enable the `vector` extension
-- (Database → Extensions) before or as this migration runs. Local CLI applies
-- `create extension` below. Retrieval uses cosine distance (`<=>`).
--
-- Embedding model: gemini-embedding-001 with outputDimensionality 1536
-- (see backend/domain/citations/types.ts). Changing the model or dimension
-- requires a new migration and a full re-ingest.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.regulatory_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  scheme text not null check (scheme in ('PAT', 'CCTS', 'ADEETIE')),
  sector_or_cluster text,
  source_url text not null,
  effective_date date,
  ingested_at timestamptz not null default now(),
  raw_file_hash text not null,
  unique (raw_file_hash)
);

create table if not exists public.regulatory_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.regulatory_documents(id) on delete cascade,
  clause_ref text,
  page_number int,
  chunk_text text not null,
  embedding vector(1536) not null
);

create index if not exists regulatory_documents_scheme_sector_idx
  on public.regulatory_documents (scheme, sector_or_cluster);

create index if not exists regulatory_chunks_document_id_idx
  on public.regulatory_chunks (document_id);

-- HNSW needs no training set; IVFFlat would be a poor fit for a small corpus.
create index if not exists regulatory_chunks_embedding_hnsw_idx
  on public.regulatory_chunks
  using hnsw (embedding vector_cosine_ops);

comment on table public.regulatory_documents is
  'BEE / scheme regulatory source documents. Global reference data (no organization_id): readable by any authenticated user, writable only by the service role.';

comment on table public.regulatory_chunks is
  'Verbatim clause-sized slices of regulatory_documents, with gemini-embedding-001 (1536-d) vectors. chunk_text is never paraphrased at ingest.';

comment on column public.regulatory_chunks.embedding is
  'gemini-embedding-001, outputDimensionality 1536, cosine distance.';

comment on column public.regulatory_documents.raw_file_hash is
  'sha256 of the source bytes (or UTF-8 fixture text). Detects a changed source since last ingest.';

-- ---------------------------------------------------------------------------
-- Findings: suggested citation attached at insert, human accept/edit/reject
-- ---------------------------------------------------------------------------

alter table public.findings
  add column if not exists citation_state text;

alter table public.findings
  drop constraint if exists findings_citation_state_check;
alter table public.findings
  add constraint findings_citation_state_check
  check (citation_state is null or citation_state in ('suggested', 'accepted', 'edited', 'rejected', 'none'));

alter table public.findings
  add column if not exists citation_gate text;

alter table public.findings
  drop constraint if exists findings_citation_gate_check;
alter table public.findings
  add constraint findings_citation_gate_check
  check (citation_gate is null or citation_gate in ('grounded', 'rejected', 'no_applicable_clause', 'unavailable'));

alter table public.findings
  add column if not exists citation_clause_ref text;

alter table public.findings
  add column if not exists citation_chunk_text text;

alter table public.findings
  add column if not exists citation_document_title text;

alter table public.findings
  add column if not exists citation_page_number int;

alter table public.findings
  add column if not exists citation_source_url text;

alter table public.findings
  add column if not exists citation_chunk_id uuid references public.regulatory_chunks(id) on delete set null;

alter table public.findings
  add column if not exists citation_explanation text;

comment on column public.findings.citation_state is
  'Human review of the retrieved citation. Arrives suggested. none means the groundedness gate attached nothing.';

comment on column public.findings.citation_gate is
  'Programmatic gate: grounded (attached), rejected (model cited outside the retrieved set), no_applicable_clause, or unavailable (no key / index).';

comment on column public.findings.citation_chunk_text is
  'Verbatim retrieved clause text. Null when the gate attached no citation.';

-- ---------------------------------------------------------------------------
-- Retrieval: filter by pack scheme+sector FIRST, then cosine top-k
-- ---------------------------------------------------------------------------

create or replace function public.match_regulatory_chunks(
  query_embedding vector(1536),
  p_scheme text,
  p_sector text,
  match_count int default 5
) returns table (
  id uuid,
  document_id uuid,
  clause_ref text,
  page_number int,
  chunk_text text,
  title text,
  source_url text,
  scheme text,
  sector_or_cluster text,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      c.id,
      c.document_id,
      c.clause_ref,
      c.page_number,
      c.chunk_text,
      c.embedding,
      d.title,
      d.source_url,
      d.scheme,
      d.sector_or_cluster
    from public.regulatory_chunks c
    inner join public.regulatory_documents d on d.id = c.document_id
    where d.scheme = p_scheme
      and (
        d.sector_or_cluster = p_sector
        or d.sector_or_cluster is null
      )
  )
  select
    f.id,
    f.document_id,
    f.clause_ref,
    f.page_number,
    f.chunk_text,
    f.title,
    f.source_url,
    f.scheme,
    f.sector_or_cluster,
    1 - (f.embedding <=> query_embedding) as similarity
  from filtered f
  order by f.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 5), 3), 5);
$$;

revoke all on function public.match_regulatory_chunks(vector, text, text, int) from public;
grant execute on function public.match_regulatory_chunks(vector, text, text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security — catalogue read, service-role write
-- ---------------------------------------------------------------------------

alter table public.regulatory_documents enable row level security;
alter table public.regulatory_chunks enable row level security;

drop policy if exists regulatory_documents_read on public.regulatory_documents;
create policy regulatory_documents_read on public.regulatory_documents
  for select to authenticated using (true);

drop policy if exists regulatory_chunks_read on public.regulatory_chunks;
create policy regulatory_chunks_read on public.regulatory_chunks
  for select to authenticated using (true);

-- No INSERT/UPDATE/DELETE policy for authenticated, so RLS denies those by
-- default. Grants make it explicit at the privilege level too.
revoke insert, update, delete on public.regulatory_documents from authenticated, anon;
revoke insert, update, delete on public.regulatory_chunks from authenticated, anon;
grant select on public.regulatory_documents to authenticated;
grant select on public.regulatory_chunks to authenticated;
grant select, insert, update, delete on public.regulatory_documents to service_role;
grant select, insert, update, delete on public.regulatory_chunks to service_role;
