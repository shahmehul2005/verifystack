-- Spreadsheet range provenance (computed totals).
--
-- A total the server computes from a column range, because the workbook had no total
-- row, is recorded with provenance type 'spreadsheet_range'. Its provenance names the
-- sheet, column and row range. It does not name a cell the entity typed.
--
-- Migrations 0013 and earlier are applied and are not edited. This one re-states the
-- two provenance checks on facts and extracted_fields with the new type added. The
-- rules for every existing type are unchanged.

alter table public.facts drop constraint if exists facts_provenance_type_check;
alter table public.facts drop constraint if exists facts_provenance_complete;

alter table public.facts
  add constraint facts_provenance_type_check
  check (provenance_type in ('document_page', 'spreadsheet_cell', 'spreadsheet_range', 'time_series_range', 'site_observation'));

alter table public.facts
  add constraint facts_provenance_complete
  check (
    (provenance_type = 'document_page'
      and document_id is not null
      and page is not null and page > 0
      and bbox is not null
      and source_text is not null and char_length(source_text) > 0)
    or (provenance_type in ('spreadsheet_cell', 'spreadsheet_range', 'time_series_range')
      and document_id is not null
      and provenance is not null)
    or (provenance_type = 'site_observation'
      and provenance is not null)
  );

alter table public.extracted_fields drop constraint if exists extracted_fields_provenance_type_check;
alter table public.extracted_fields drop constraint if exists extracted_fields_provenance_complete;

alter table public.extracted_fields
  add constraint extracted_fields_provenance_type_check
  check (provenance_type in ('document_page', 'spreadsheet_cell', 'spreadsheet_range', 'time_series_range', 'site_observation'));

alter table public.extracted_fields
  add constraint extracted_fields_provenance_complete
  check (
    (provenance_type = 'document_page'
      and page is not null and page > 0
      and bbox is not null
      and source_text is not null and char_length(source_text) > 0)
    or (provenance_type in ('spreadsheet_cell', 'spreadsheet_range', 'time_series_range', 'site_observation')
      and provenance is not null)
  );
