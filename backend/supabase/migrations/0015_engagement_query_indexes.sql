-- Indexes for hot engagement-scoped reads. No schema or RLS changes.
-- These tables were filtered by engagement_id without a supporting index.

create index if not exists facts_engagement_idx
  on public.facts (engagement_id);

create index if not exists findings_engagement_idx
  on public.findings (engagement_id);

create index if not exists signoffs_engagement_idx
  on public.signoffs (engagement_id);

create index if not exists declared_values_engagement_idx
  on public.declared_values (engagement_id);

create index if not exists bulk_accept_batches_engagement_idx
  on public.bulk_accept_batches (engagement_id);

create index if not exists verification_plans_engagement_idx
  on public.verification_plans (engagement_id, created_at desc);

create index if not exists site_visits_engagement_idx
  on public.site_visits (engagement_id);

create index if not exists savings_dpr_runs_engagement_idx
  on public.savings_dpr_runs (engagement_id, created_at desc);

create index if not exists issue_responses_engagement_idx
  on public.issue_responses (engagement_id);
