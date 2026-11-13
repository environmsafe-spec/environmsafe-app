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
