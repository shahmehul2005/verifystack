-- =============================================================================
-- Migration 0027: Stream-Calendar Architecture & Facts Ledger
--
-- PURPOSE
-- -------
-- Grounded in the Bureau of Energy Efficiency (BEE) PAT-2 / CCTS Cement Sector
-- Proforma. Replaces flat, conflicting fact dumps with a 12-Month Calendar Grid
-- per Cement Stream (Apr to Mar).
--
-- Supports three distinct, non-colliding source layers per cell:
--   1. 'sourcing'      - Primary third-party evidence (bills, invoices, weighbridge)
--   2. 'corroboration' - Internal plant operational records (ERP, SCADA, lab logbooks)
--   3. 'proforma'      - Declared figures in the statutory pro forma return
--
-- Deterministic annual roll-up sums monthly quantities and computes weighted
-- average GCVs to provide single, unambiguous inputs to calculation runs.
--
-- REQUIRES: 0026
-- =============================================================================

-- 1. Index on canonical_key prefix and period for fast calendar matrix queries
create index if not exists cev_calendar_stream_idx
  on public.canonical_evidence_values (engagement_id, period_start, period_end)
  where state not in ('rejected', 'withdrawn');

-- 2. Audit comment documenting canonical_key composite format: <stream_key>#<source_type>
comment on column public.canonical_evidence_values.canonical_key is
  'Cement stream key, optionally formatted as <stream_key>#<source_type> (e.g. coal_quantity#sourcing, clinker_production#corroboration, equivalent_product#proforma) to support multi-layer calendar cross-checks.';

