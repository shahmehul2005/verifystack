-- Evidence checklist slot on each document (verification-first intake).
--
-- A slot is a label the auditor assigns by hand (for example "grid_electricity").
-- Several documents may share one slot. The valid slot ids come from the
-- methodology pack, so the database does not constrain the value; the app
-- refuses ids the pack does not define (see /api/documents/[id]/slot).
--
-- No row is rewritten. Existing documents have slot null, which means
-- "not assigned yet".

alter table public.documents
  add column if not exists slot text;

create index if not exists documents_engagement_slot_idx
  on public.documents (engagement_id, slot);

comment on column public.documents.slot is
  'Evidence checklist slot id from the methodology pack, or null when unassigned. Assigned by a person; never inferred from a filename.';
