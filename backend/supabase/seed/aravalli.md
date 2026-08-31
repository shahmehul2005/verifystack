# Aravalli Cement demo seed

After Auth + an organisation membership exist:

1. Apply `supabase/migrations/0001_init.sql` and `supabase/seed/packs.sql`.
2. Create a firm (`organizations`) and a `memberships` row for your user.
3. Create an engagement bound to `CCTS-CEMENT-v1`:

- client: Aravalli Cement Works Ltd.
- plant: Beawar Line 2 (synthetic demo plant)
- compliance year: FY2025-26
- pack: CCTS-CEMENT-v1 / 1.0.0
- GEI target: 0.82
- draft_mode: true

Numeric evidence for the public demo lives in `backend/demo/seed.ts` and is shown at `/workbench` without Supabase. Do not treat those figures as a real plant.
