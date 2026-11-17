-- Extractor flags and locators for canonical evidence values (industrial-extractor, Requirements 11.6, 12.5).
-- Apply before deploying the web app that writes reading_meta.
alter table public.canonical_evidence_values
  add column if not exists reading_meta jsonb not null default '{}'::jsonb;

comment on column public.canonical_evidence_values.reading_meta is
  'Extractor flags and locators: verified, needsReview, derived, unitAssumed, locator {sheet, cellRef}, rawId, model, inputHash.';
