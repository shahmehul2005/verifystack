-- CCTS baseline year. The CEA grid emission factor is frozen at the entity's baseline year (Detailed Procedure
-- 5.10(vi); the monitoring plan template records "Baseline Year (as approved by BEE)"). Reconciliation rule EF001
-- compares the factor vintage with this year. Nullable: existing engagements have none, and EF001 stays silent
-- for them rather than guessing.
alter table public.engagements add column if not exists baseline_year text
  check (baseline_year is null or baseline_year ~ '^FY[0-9]{4}-[0-9]{2}$');
comment on column public.engagements.baseline_year is
  'CCTS baseline year approved by BEE, as a financial-year label. The grid factor vintage is checked against it.';