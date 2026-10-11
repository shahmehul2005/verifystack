# Supabase setup

VerifyStack keeps Postgres, Auth and evidence Storage in one Supabase project.

## 1. Database

1. Enable the `vector` extension (Database → Extensions). Migration `0010` needs it.
2. Apply every file in `backend/supabase/migrations/` in order, `0001` → `0012`. Do not skip
   `0012`: until it is applied, any signed-in member can write to their firm's tables directly
   with the public anon key and bypass sign-off and status checks.
3. Apply `backend/supabase/seed/packs.sql`. It is safe to re-run. Pack contents live in
   `backend/domain/packs/`; this table is only the foreign-key target for `engagements.pack_id`.

`ecm_library` is left empty on purpose. Load it only from a reviewed BEE sector ECM guide —
see [`auditor-onboarding.md`](auditor-onboarding.md).

## 2. Auth

Dashboard → Authentication → URL configuration:

- Site URL: `http://localhost:3000` (or the production domain)
- Redirect URLs: `http://localhost:3000/auth/callback` and `https://YOUR-DOMAIN/auth/callback`

Password reset and signup confirmation need working email delivery (Supabase SMTP or Resend).

## 3. Environment

Copy `.env.example` to `frontend/.env.local` and set at least:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE` (server only)

Check the connection without printing keys:

```bash
npm run supabase:probe
```

## 4. First firm

Sign up at `/signup`. A self-serve signup creates a new firm and makes that user its
`firm_admin`. Everyone else joins through an invite link from **Team**.

## 5. Optional: citation corpus

```bash
npm run citations:ingest
```

This loads the **synthetic** Foundry and Cement corpus only (`backend/domain/citations/corpus.ts`).
Delete those rows before showing citations to a client:

```sql
delete from public.regulatory_documents
where title ilike '%[SYNTHETIC]%'
   or source_url like '%example.invalid%';
```

## Sample data

`backend/fixtures/seed.ts` holds the Aravalli Cement Works sample plant (Beawar Line 2,
FY2025-26). It is synthetic and used by tests and `/api/demo`. Do not treat its figures as a
real plant.
