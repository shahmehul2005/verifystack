-- Desk review: a figure an auditor types from a PDF can carry the region of the page it was read from.
-- `typed` is a figure keyed in against a document and page, as before. `snip` is a figure keyed in after the
-- auditor drew a box on the page, so the box and what is printed in it are kept with the value. The box is
-- normalised to the page (0 to 1, origin top-left), the same form extraction uses. Neither kind is ever a
-- model output, and neither feeds a calculation.

alter table public.desk_readings
  add column if not exists bbox jsonb,
  add column if not exists source_text text,
  add column if not exists source_kind text not null default 'typed';

alter table public.desk_readings drop constraint if exists desk_readings_source_kind_check;
alter table public.desk_readings
  add constraint desk_readings_source_kind_check check (source_kind in ('typed', 'snip'));

-- A snip is a box on a page with the text printed in it. The document may later be removed
-- (document_id is set null), so the check does not ask for it.
alter table public.desk_readings drop constraint if exists desk_readings_snip_complete;
alter table public.desk_readings
  add constraint desk_readings_snip_complete check (
    source_kind = 'typed'
    or (
      bbox is not null
      and jsonb_typeof(bbox) = 'object'
      and bbox ? 'x' and bbox ? 'y' and bbox ? 'width' and bbox ? 'height'
      and page is not null
      and source_text is not null
      and length(btrim(source_text)) > 0
    )
  );
