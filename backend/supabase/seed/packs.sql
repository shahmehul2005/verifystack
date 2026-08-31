-- Catalogue seed for methodology packs. Safe to re-run.
-- Source of truth for pack contents is backend/domain/packs; this table is
-- the FK target for engagements.pack_id.

insert into public.methodology_packs (
  pack_id, scheme, sector_or_cluster, status, version,
  calculation_method, document_taxonomy, field_schemas,
  emission_or_energy_factors, reconciliation_rules, clause_citations, report_template, notes
) values
(
  'CCTS-CEMENT-v1', 'CCTS', 'Cement', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/cement.ts.'
),
(
  'CCTS-IRON-AND-STEEL-v1', 'CCTS', 'Iron & Steel', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ironsteel.ts.'
),
(
  'CCTS-ALUMINIUM-v1', 'CCTS', 'Aluminium', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/aluminium.ts.'
),
(
  'CCTS-CHLOR-ALKALI-v1', 'CCTS', 'Chlor-Alkali', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ccts/remaining.ts.'
),
(
  'CCTS-PULP-AND-PAPER-v1', 'CCTS', 'Pulp & Paper', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ccts/remaining.ts.'
),
(
  'CCTS-FERTILIZER-v1', 'CCTS', 'Fertilizer', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ccts/remaining.ts.'
),
(
  'CCTS-PETROCHEMICALS-v1', 'CCTS', 'Petrochemicals', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ccts/remaining.ts.'
),
(
  'CCTS-PETROLEUM-REFINING-v1', 'CCTS', 'Petroleum Refining', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ccts/remaining.ts.'
),
(
  'CCTS-TEXTILES-v1', 'CCTS', 'Textiles', 'runnable', '1.0.0',
  'GEI', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'ccts-gei-form-ab-v1',
  'Runnable. Pack contents live in backend/domain/packs/ccts/remaining.ts.'
),
(
  'ADEETIE-FOUNDRY-v1', 'ADEETIE', 'Foundry', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-BRASS-v1', 'ADEETIE', 'Brass', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-BRICKS-v1', 'ADEETIE', 'Bricks', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-CERAMICS-v1', 'ADEETIE', 'Ceramics', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-CHEMICALS-v1', 'ADEETIE', 'Chemicals', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-FISHERIES-v1', 'ADEETIE', 'Fisheries', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-FOOD-PROCESSING-v1', 'ADEETIE', 'Food Processing', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-FORGING-v1', 'ADEETIE', 'Forging', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-GLASS-AND-REFRACTORY-v1', 'ADEETIE', 'Glass & Refractory', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-LEATHER-v1', 'ADEETIE', 'Leather', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-PAPER-v1', 'ADEETIE', 'Paper', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-PHARMA-v1', 'ADEETIE', 'Pharma', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-STEEL-RE-ROLLING-v1', 'ADEETIE', 'Steel Re-rolling', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
),
(
  'ADEETIE-TEXTILES-v1', 'ADEETIE', 'Textiles', 'runnable', '1.0.0',
  'SEC', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'adeetie-dpr-v1',
  'Runnable. Pack contents live in backend/domain/packs/adeetie/index.ts.'
)
on conflict (pack_id) do update set
  status = excluded.status,
  version = excluded.version,
  calculation_method = excluded.calculation_method,
  report_template = excluded.report_template,
  notes = excluded.notes;
