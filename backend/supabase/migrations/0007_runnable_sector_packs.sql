-- Promote remaining CCTS and ADEETIE packs from scaffold v0 rows to runnable v1.
-- Engagement pack_id is immutable, so any engagement already bound to a v0 id
-- keeps that FK row. New work uses the v1 ids seeded here.

insert into public.methodology_packs (
  pack_id, scheme, sector_or_cluster, status, version,
  calculation_method, report_template, notes
) values
  ('CCTS-CHLOR-ALKALI-v1', 'CCTS', 'Chlor-Alkali', 'runnable', '1.0.0', 'GEI', 'ccts-gei-form-ab-v1', 'Runnable. See backend/domain/packs/ccts/remaining.ts.'),
  ('CCTS-PULP-AND-PAPER-v1', 'CCTS', 'Pulp & Paper', 'runnable', '1.0.0', 'GEI', 'ccts-gei-form-ab-v1', 'Runnable. See backend/domain/packs/ccts/remaining.ts.'),
  ('CCTS-FERTILIZER-v1', 'CCTS', 'Fertilizer', 'runnable', '1.0.0', 'GEI', 'ccts-gei-form-ab-v1', 'Runnable. See backend/domain/packs/ccts/remaining.ts.'),
  ('CCTS-PETROCHEMICALS-v1', 'CCTS', 'Petrochemicals', 'runnable', '1.0.0', 'GEI', 'ccts-gei-form-ab-v1', 'Runnable. See backend/domain/packs/ccts/remaining.ts.'),
  ('CCTS-PETROLEUM-REFINING-v1', 'CCTS', 'Petroleum Refining', 'runnable', '1.0.0', 'GEI', 'ccts-gei-form-ab-v1', 'Runnable. See backend/domain/packs/ccts/remaining.ts.'),
  ('CCTS-TEXTILES-v1', 'CCTS', 'Textiles', 'runnable', '1.0.0', 'GEI', 'ccts-gei-form-ab-v1', 'Runnable. See backend/domain/packs/ccts/remaining.ts.'),
  ('ADEETIE-BRASS-v1', 'ADEETIE', 'Brass', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-BRICKS-v1', 'ADEETIE', 'Bricks', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-CERAMICS-v1', 'ADEETIE', 'Ceramics', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-CHEMICALS-v1', 'ADEETIE', 'Chemicals', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-FISHERIES-v1', 'ADEETIE', 'Fisheries', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-FOOD-PROCESSING-v1', 'ADEETIE', 'Food Processing', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-FORGING-v1', 'ADEETIE', 'Forging', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-GLASS-AND-REFRACTORY-v1', 'ADEETIE', 'Glass & Refractory', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-LEATHER-v1', 'ADEETIE', 'Leather', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-PAPER-v1', 'ADEETIE', 'Paper', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-PHARMA-v1', 'ADEETIE', 'Pharma', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-STEEL-RE-ROLLING-v1', 'ADEETIE', 'Steel Re-rolling', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.'),
  ('ADEETIE-TEXTILES-v1', 'ADEETIE', 'Textiles', 'runnable', '1.0.0', 'SEC', 'adeetie-dpr-v1', 'Runnable. See backend/domain/packs/adeetie/index.ts.')
on conflict (pack_id) do update set
  status = excluded.status,
  version = excluded.version,
  calculation_method = excluded.calculation_method,
  report_template = excluded.report_template,
  notes = excluded.notes;

update public.methodology_packs
set notes = coalesce(notes, '') || ' Superseded by the matching *-v1 runnable pack. New engagements must bind the v1 id.'
where pack_id like '%-v0'
  and status = 'scaffold'
  and notes not like '%Superseded by the matching%';
