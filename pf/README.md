# ES-PF v2 — EnvironmSafe Procurement & Finance

One app, one database: procurement, sales, money, accounting and master data.
Plan: [docs/PLAN.md](docs/PLAN.md) · Phase notes: [1](docs/phase-1.md) · [2](docs/phase-2.md) · [3](docs/phase-3.md)

| Folder | What |
|---|---|
| `supabase/migrations/` | The database: tables, rules, permissions (applied in file-name order) |
| `supabase/seed.sql` | Creates the EnvironmSafe company with its defaults (staging/local) |
| `db/tests/` | pgTAP tests (run with `db/scripts/test.sh`) |
| `db/local/supabase_shim.sql` | Local-only stand-in for Supabase Auth roles. **Never run on Supabase.** |
| `web/` | React + TypeScript PWA (EN/AR) |
| `web/e2e/` | Local demo tools (local API stand-in, screenshot script) |
| `pdf/` | Printed documents: ReportLab renderer, HTTP service, Dockerfile, visual test |
| `supabase/functions/` | Edge Functions (`generate-pdf`) and shared code (`_shared/print.ts`) |
| `templates/` | Reference PDFs and signature/stamp for printed documents |

## Run the database tests
```bash
# any Postgres 16+ with pgTAP; the script creates and drops its own database
PGHOST=... PGPORT=... PGUSER=postgres pf/db/scripts/test.sh
```

## Run the web app
```bash
cd pf/web && cp .env.example .env.local   # fill in the Supabase URL + publishable key
npm ci && npm run dev
```

## Deploying to a Supabase project (staging first)
Apply `supabase/migrations/*.sql` in order (Supabase CLI `supabase db push`, or the SQL editor),
then `supabase/seed.sql`. Invite the owner in Auth, then run once in the SQL editor:
`insert into user_roles (company_id, user_id, role_code) values ('dee3dc12-55bb-4acc-9c44-46721b36651b', '<owner auth user id>', 'owner');`
In Auth settings enable **TOTP MFA**.

## Printed documents
```bash
cd pf/pdf && pip install -r requirements-dev.txt
python -m tests.visual                      # compare with templates/sample_*.pdf
PDF_SERVICE_KEY=secret python server.py     # POST /render with header X-PDF-Key
```
Deploy the `pf/pdf` Dockerfile (Cloud Run / Render / Fly), then set Edge Function secrets
`PDF_SERVICE_URL`, `PDF_SERVICE_KEY`, `APP_URL` and deploy `supabase/functions/generate-pdf`.
