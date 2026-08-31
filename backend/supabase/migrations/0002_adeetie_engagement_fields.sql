-- ADEETIE engagement fields
-- Extends D1 engagements so an ADEETIE (BEE) engagement can be bound without a
-- parallel table. CCTS and ADEETIE share intake, documents, facts, findings and
-- sign-off; only the scheme-specific header data differs, so these are added as
-- nullable columns rather than a second engagement entity.
--
-- Every column is nullable: existing CCTS rows must stay valid, and an ADEETIE
-- row is populated progressively across the IGEA -> DPR -> M&V phases (loan and
-- project cost are unknown until DPR). Presence is therefore enforced by the
-- rules engine per phase, not by NOT NULL here.
--
-- `scheme` already exists on public.engagements (0001, public.pack_scheme enum
-- 'CCTS' | 'ADEETIE'), so it is deliberately not re-added.

alter table public.engagements
  add column if not exists adeetie_cluster text,
  add column if not exists adeetie_state text,
  add column if not exists enterprise_category text,
  add column if not exists udyam_registration_no text,
  add column if not exists loan_amount_inr numeric,
  add column if not exists project_cost_inr numeric,
  add column if not exists sanctioned_interest_rate_pct numeric,
  add column if not exists adeetie_phase text;

-- Constraint values mirror backend/domain/packs/adeetie/scheme.ts
-- (ENTERPRISE_CATEGORIES) and .../phases.ts (ADEETIE_PHASES). Kept as text +
-- CHECK rather than new enum types because the ADEETIE scheme parameters are
-- still marked TO VERIFY in the domain layer, and a CHECK is cheaper to revise
-- than an enum.
alter table public.engagements
  drop constraint if exists engagements_enterprise_category_check;
alter table public.engagements
  add constraint engagements_enterprise_category_check
  check (enterprise_category is null
         or enterprise_category in ('Micro', 'Small', 'Medium'));

alter table public.engagements
  drop constraint if exists engagements_adeetie_phase_check;
alter table public.engagements
  add constraint engagements_adeetie_phase_check
  check (adeetie_phase is null
         or adeetie_phase in ('IGEA', 'DPR', 'MV'));

-- Money is held in rupees (never lakh/crore) to match LOAN_MIN_INR /
-- LOAN_MAX_INR in domain/packs/adeetie/scheme.ts. Only sign is enforced here;
-- the eligibility window itself is a reviewable rule, not a hard DB constraint,
-- because an out-of-range value must be recordable in order to be found.
alter table public.engagements
  drop constraint if exists engagements_adeetie_amounts_nonneg_check;
alter table public.engagements
  add constraint engagements_adeetie_amounts_nonneg_check
  check ((loan_amount_inr is null or loan_amount_inr >= 0)
         and (project_cost_inr is null or project_cost_inr >= 0)
         and (sanctioned_interest_rate_pct is null or sanctioned_interest_rate_pct >= 0));

create index if not exists engagements_adeetie_cluster_idx
  on public.engagements (adeetie_cluster)
  where adeetie_cluster is not null;

comment on column public.engagements.adeetie_cluster is
  'Notified ADEETIE cluster name. Should match public.adeetie_clusters.cluster; not a FK because a 200 km proximity claim is a reviewable exception, so a non-notified value must be recordable.';

comment on column public.engagements.adeetie_phase is
  'IGEA | DPR | MV. Orthogonal to engagement_status: each phase runs the full setup -> signoff cycle.';

-- RLS: public.engagements already has the engagements_org policy from 0001
-- (using/with check public.is_org_member(organization_id)). Columns added to an
-- existing table inherit it, so no policy change is required or wanted here.
