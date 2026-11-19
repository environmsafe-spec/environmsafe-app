# Hosting on Neon + Cloudflare (plan, 13 Nov 2026)

The app was built on Supabase services: Postgres, Auth with TOTP MFA, Storage, Edge Functions and the auto-generated REST API.
This plan replaces each one with a free Neon or Cloudflare part. **The database code does not change:**
- the 14 migrations and every business rule (posting, RLS, audit, numbering) are plain Postgres;
- they run on Neon as they are, with the small `auth` schema shim already used by the tests;
- the migration job is plain Postgres too.

| Supabase part | Replacement | Free? |
|---|---|---|
| Postgres | **Neon**: project `espf`, branch `staging` first, `main` at go-live | yes (Free: 100 CU-hours/month with scale to zero, about 0.5–1 GB storage, 5 GB transfer) |
| REST API (PostgREST) | **Cloudflare Worker `espf-api`**: the same request format the web app already uses (the local stand-in `web/e2e/local-api.mjs` becomes this Worker). Each request runs in one transaction as `authenticated` with the user's claims, so the existing RLS and permissions apply unchanged. It connects to Neon through Hyperdrive. | yes (Workers Free: 100k requests/day) |
| Auth + TOTP MFA | **Better Auth** (open-source library) inside the same Worker:<br>- users and sessions in Neon;<br>- its two-factor plugin gives TOTP and backup codes;<br>- the Worker issues the `aal2` claim only after the TOTP step, as the database expects. | yes |
| Storage (voucher files, PDFs) | **Cloudflare R2**, bucket `espf-documents`; private, served only through the Worker after a permission check | yes (10 GB) |
| Edge functions `extract-voucher`, `generate-pdf` | Routes in the same Worker. Same code; the Claude key is a Worker secret. | yes |
| PDF renderer (Python, ReportLab) | Option 1: Cloudflare **Containers** (needs Workers Paid, **USD 5/month**). Option 2: Python Worker, if ReportLab runs there (free; must be tested). | 1: no / 2: yes |
| Web app (PWA) | **Cloudflare Pages**, project `environmsafe` (already connected to this repository) | yes |

## Why a Worker API and not Neon Auth / Neon Data API
- Neon's managed auth and Data API also fit, but I could not confirm that the managed auth offers TOTP two-factor sign-in.
- Your spec requires MFA for owner and accountant.
- Better Auth in our own Worker gives MFA for certain.
- Everything stays in one Worker and one database.

## Steps (each one a reviewable PR, tested before the next)
1. **Database on Neon staging.**
   - Create the project and run migrations, seed and the 301 tests against it.
   - Run the migration job on a copy of the real old records, and produce the reconciliation reports for your review.
2. **Worker API + auth**:
   - sign-in, TOTP enrolment and challenge, the idle time-out;
   - REST and RPC routes;
   - the web app switches from supabase-js to a small client with the same calls.
   - Browser tests run against the Worker.
3. **Files and functions**:
   - R2 upload and download;
   - voucher upload with Claude;
   - printed PDFs (pick option 1 or 2 above).
4. **Go-live**:
   - `main` branch database and production Worker;
   - your first sign-in with MFA, inviting users;
   - final delta migration of records changed since the staging copy;
   - one month in parallel with the old app, which is never written to.

## What is needed from you
- A **Neon** account (free) and an API key.
- A **Cloudflare API token** for Workers, R2, Hyperdrive and Pages.
- Both are entered in the secure credential form, never in chat.

## Progress
- **14 Nov 2026, step 1:**
  - Neon project `my-first-project` (`delicate-forest-20988170`, AWS us-east-1, Postgres 18), branch **`staging`**.
  - All migrations load unchanged.
  - **All 301 database tests pass on Neon** (`espf_test`, a throw-away database).
  - Database **`espf`** holds the schema, the company, the chart (55 accounts) and the migration job, ready for the old records.
- This build sandbox can only reach Neon over port 443. `db/scripts/neon-bridge.mjs` tunnels psql / pg_prove over Neon's WebSocket endpoint.
- The tests no longer assume a superuser named `postgres`.
- **16 Nov 2026, step 2 (built and tested locally):**
  - **Worker `espf`** (`pf/api`) serves the web app and `/api` from one origin, so the session cookie is first-party.
  - **Sign-in:** Better Auth (password + TOTP two-step, backup codes; no public sign-up).
  - **Data:** `/api/rest/v1`, the PostgREST protocol the screens already speak (via postgrest-js). Each request runs as `authenticated` with the session's claims, so RLS and permissions are unchanged. `aal2` = the user has two-step sign-in on.
  - **Users:** the owner adds users (one-time password), sets a new password, or resets two-step sign-in. Everyone can change their own password.
  - **Tested:**
    - curl: anonymous access refused; password alone gets no data; sign-in tables unreadable through the API; cross-site POST refused.
    - Browser (`web/e2e/worker-signin.mjs`, against `wrangler dev` + local Postgres): owner signs in with code; owner adds an accountant; the accountant sets up two-step sign-in and changes the one-time password.
  - **Not yet:** files (`/api/files`, R2) and the AI upload / PDF functions are step 3, so the Cloudflare Pages previews cannot sign in any more (they have no API).
- **19 Nov 2026, step 3 (built and tested locally):**
  - **Files:** R2 bucket `espf-documents` was created in the Environmsafe Cloudflare account. `/api/files` checks the user's rights on every read and upload.
  - **AI voucher upload:** `/api/functions/extract-voucher` in the Worker (Claude key = Worker secret `ANTHROPIC_API_KEY`). Tested end to end with a stand-in for the Claude API.
  - **Printed PDFs:** rendered in the browser with pdf-lib (`web/src/print/pdf.ts`), a line-for-line port of the ReportLab renderer. It is free, and the Python PDF service is no longer needed. The visual test against the samples gives the same result as before (PO 0.03 %, invoice 0.22 %) and runs in CI. Arabic is shaped by fontkit (Noto Naskh, loaded only when needed). The posted copy is stored with the document (generated_pdf, SHA-256).
- **19 Nov 2026, go-live run:**
  - Secrets: `CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`, `NEON_DATABASE_URL` are set in the repository.
  - The deploy workflow runs for commits marked with the deploy tag.
  - Live database: Neon `production` branch, database `espf`.
