# EnvironmSafe Records

Inspection and testing database and field app for EnvironmSafe for Engineering,
Trading & Services Ltd. One code base: website (installable PWA) and Android app.

- Field inspections on a phone, also with no internet; sync when back online.
- Clients, sites, assets (free-text tags, child assets), inspections, readings,
  findings carried over between inspections, jobs, daily progress reports,
  certificates, documents and photos.
- Branded Word and PDF reports and certificates, generated in the app.
- Due board, dashboard, Excel import, audit log, backups.

## Folders
| Path | What |
|---|---|
| `src/` | The app (React + TypeScript). `src/lib/sync.ts` offline sync, `src/reports/` report engine |
| `supabase/migrations/` | Database: tables, Row Level Security, triggers, library, demo data |
| `supabase/functions/admin-users/` | Server function for user management (uses the service key) |
| `android/` | Android project (Capacitor). Signing key only encrypted |
| `tests/` | Unit, document, database and browser tests; `tests/smoke/` live-site checks |
| `scripts/` | Test helpers, backup/restore test, release helpers |
| `.github/workflows/` | Tests, Release (website + APK), Nightly backup, Keep-alive |
| `docs/` | User Guide, Admin Guide, Runbook, Decisions, Security, Test report |

## Develop and test
```bash
npm ci
npx vitest run                 # unit + generated documents
node scripts/db-test.mjs       # database + RLS (needs a PostgreSQL, see script header)
./scripts/e2e-local.sh         # browser tests, desktop and phone sizes
```
Configuration for the live project is in `.env.production` (public values only).
