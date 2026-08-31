-- D5 calculation_runs generalised to carry SEC runs alongside GEI runs
--
-- DECISION: generalise public.calculation_runs rather than add a parallel
-- public.sec_runs table.
--
-- Reasons:
--   1. public.findings.calculation_run_id already references
--      public.calculation_runs(id). A parallel table would force either a second
--      nullable FK on findings plus a "which one" discriminator, or an untyped
--      polymorphic reference. Both are worse than one column here.
--   2. The run chain (input_hash / previous_run_hash / chain_hash) is per
--      engagement, not per method. Splitting the table splits the chain and
--      makes "the latest run for this engagement" a UNION.
--   3. Every column of 0001's calculation_runs applies unchanged to an SEC run:
--      backend/domain/calc/secRun.ts already produces packId, packVersion,
--      factorSetVersion, inputHash, previousRunHash, chainHash, draftMode.
--      Only the *result* projection differs, and that is what is added below.
--   4. RLS, indexes and the audit trail are then defined once.
--
-- Cost of the choice: the SEC columns are nullable for GEI rows and vice versa.
-- That is paid for with a per-method CHECK constraint at the bottom of this
-- file, so a half-populated SEC row cannot be written.

alter table public.calculation_runs
  add column if not exists method text not null default 'GEI',
  add column if not exists chain_hash text,
  add column if not exists sec_engine_version text,
  add column if not exists period_label text,
  add column if not exists sec_phase text,
  add column if not exists total_energy_mj numeric,
  add column if not exists total_energy numeric,
  add column if not exists reporting_energy_unit text,
  add column if not exists sec numeric,
  add column if not exists sec_unit_label text,
  add column if not exists production numeric,
  add column if not exists product_unit_label text;

-- Existing rows predate the column and are all GEI runs; the default backfills
-- them. The default is kept so a GEI insert written against 0001 still works.
alter table public.calculation_runs
  drop constraint if exists calculation_runs_method_check;
alter table public.calculation_runs
  add constraint calculation_runs_method_check
  check (method in ('GEI', 'SEC'));

-- Values mirror SecPhase in backend/domain/calc/sec.ts.
alter table public.calculation_runs
  drop constraint if exists calculation_runs_sec_phase_check;
alter table public.calculation_runs
  add constraint calculation_runs_sec_phase_check
  check (sec_phase is null or sec_phase in ('baseline', 'post_implementation'));

-- Reporting unit is the ReportingEnergyUnit union in domain/calc/sec.ts.
alter table public.calculation_runs
  drop constraint if exists calculation_runs_reporting_energy_unit_check;
alter table public.calculation_runs
  add constraint calculation_runs_reporting_energy_unit_check
  check (reporting_energy_unit is null
         or reporting_energy_unit in ('GJ', 'toe', 'MJ', 'kWh'));

-- chain_hash was not in 0001 but the application already records it
-- (domain/calc/run.ts chainHash, domain/calc/secRun.ts secChainHash). It is
-- nullable so rows written before this migration remain valid.
comment on column public.calculation_runs.chain_hash is
  'sha256(previous_run_hash | method-tag | input_hash). Nullable only for rows written before 0003.';

-- The SEC projection. `result` still holds the full SecResult jsonb; these are
-- the scalars a report, a savings comparison or a findings rule reads without
-- digging into jsonb, so they are promoted to columns.
comment on column public.calculation_runs.total_energy_mj is
  'SEC runs only. Canonical energy total in MJ, independent of reporting_energy_unit.';
comment on column public.calculation_runs.total_energy is
  'SEC runs only. Same total expressed in reporting_energy_unit.';
comment on column public.calculation_runs.sec is
  'SEC runs only. total_energy / production, labelled by sec_unit_label.';

-- A SEC run must be complete. Nothing is asserted about GEI rows beyond the
-- 0001 shape, so existing rows (method defaulted to GEI) still satisfy this.
alter table public.calculation_runs
  drop constraint if exists calculation_runs_sec_fields_present_check;
alter table public.calculation_runs
  add constraint calculation_runs_sec_fields_present_check
  check (
    method <> 'SEC'
    or (
      sec_engine_version is not null
      and period_label is not null
      and sec_phase is not null
      and total_energy_mj is not null
      and total_energy is not null
      and reporting_energy_unit is not null
      and sec is not null
      and sec_unit_label is not null
      and production is not null
      and product_unit_label is not null
    )
  );

-- SEC is an intensity: a zero denominator is a calculation error, not data.
alter table public.calculation_runs
  drop constraint if exists calculation_runs_sec_positive_check;
alter table public.calculation_runs
  add constraint calculation_runs_sec_positive_check
  check ((production is null or production > 0)
         and (total_energy_mj is null or total_energy_mj > 0));

create index if not exists calculation_runs_method_phase_idx
  on public.calculation_runs (engagement_id, method, sec_phase, created_at desc);

create index if not exists calculation_runs_chain_hash_idx
  on public.calculation_runs (chain_hash)
  where chain_hash is not null;

comment on table public.calculation_runs is
  'D5. One row per executed run, GEI (CCTS) or SEC (ADEETIE), discriminated by method. Immutable by convention: no UPDATE path in the application.';

-- RLS: calculation_runs_org from 0001 already isolates by organization_id and
-- covers the new columns. Not redefined here.
