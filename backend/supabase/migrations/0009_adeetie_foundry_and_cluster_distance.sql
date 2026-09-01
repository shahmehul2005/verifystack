-- ADEETIE-FOUNDRY-v1 was defined in backend/domain/packs/adeetie/index.ts and
-- listed in seed/packs.sql, but 0007 promoted only the other 13 sectors. On a
-- database built from migrations alone the row is absent, and because
-- engagements.pack_id is a foreign key into methodology_packs, creating a
-- Foundry engagement fails. Foundry is the sector the ADEETIE demo uses.

insert into public.methodology_packs (
  pack_id, scheme, sector_or_cluster, status, version,
  calculation_method, report_template, notes
) values (
  'ADEETIE-FOUNDRY-v1', 'ADEETIE', 'Foundry', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1',
  'Runnable. See backend/domain/packs/adeetie/index.ts.'
)
on conflict (pack_id) do update set
  status = excluded.status,
  version = excluded.version,
  calculation_method = excluded.calculation_method,
  report_template = excluded.report_template,
  notes = excluded.notes;

-- The engagement wizard asks how far the plant is from the nearest notified
-- cluster when the unit is not inside one, because the scheme allows a 200 km
-- proximity claim. That answer was written only to the audit event, so rule
-- AD-ELG002 never saw it and the proximity branch could not fire on a real run.
-- Persisting it on the engagement puts the claim in front of the rule.
alter table public.engagements
  add column if not exists claimed_distance_to_cluster_km numeric;

alter table public.engagements
  drop constraint if exists engagements_claimed_distance_check;
alter table public.engagements
  add constraint engagements_claimed_distance_check
  check (claimed_distance_to_cluster_km is null
         or claimed_distance_to_cluster_km >= 0);

comment on column public.engagements.claimed_distance_to_cluster_km is
  'Road distance to the nearest notified cluster, as claimed at setup, for units outside a notified cluster. Read by AD-ELG002 against the 200 km scheme limit. A claim, not a measurement — the reviewer must see the supporting evidence.';
