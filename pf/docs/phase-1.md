# Phase 1 — Foundation (demo note)

## What was built
**Database** (`supabase/migrations/`, 7 files)
- Companies, user profiles, 6 roles × 24 permissions (table-driven, so a role can be adjusted without code).
- **MFA enforced in the database**: Owner and Accountant see *no data* until the session passed TOTP (`aal2`).
- **Row Level Security on every table**, filtered by company and permission. Not-signed-in users get nothing.
- **Audit log**, append-only: who, when, table, record, before/after, changed fields, IP, browser. Update/delete/truncate is
  blocked by triggers for everyone, including the database owner.
- **Chart of accounts** (54 accounts, IFRS for SMEs lines) — see [chart-of-accounts.md](chart-of-accounts.md). System accounts
  cannot be deleted or have their type changed. Only the Owner edits the chart.
- **Master data**: parties (one table; a party can be customer *and* supplier), projects, items, bank/cash accounts. Every
  bank/cash account automatically gets its own GL account `1000-NNN`. Old IDs are kept in `legacy_id` and are searchable.
- **Gapless numbering**: PO `2026110701`, invoice `INV-2026110701`, and `PV-2026-0001` style for the rest. A cancelled
  transaction gives its number back. Master codes: `PJ-` projects, `CU-` customers, `SU-` suppliers, `EM-` employees,
  `OW-` owner, `IT-` items, `MA-` money accounts (new prefixes so they never clash with old `PRJ-/SUP-/CUS-` IDs).
- **Periods**: monthly, 2025 onwards. Accountant closes; only Owner reopens, with a reason; both logged. A posting guard
  (`app.assert_period_open`) is ready for Phase 2.
- **FX rates**: per date, units per USD; defaults SAR 3.79, YER 1,556.

**Web app** (`web/`): sign-in, first-time TOTP setup with QR code, 30-minute idle sign-out, 7-item menu (items you
cannot use are hidden), EN/AR with right-to-left layout, phone layout, installable PWA. Screens: projects, customers,
suppliers, employees, items, bank & cash accounts, chart of accounts, FX rates, periods (close/reopen), users & roles,
audit log. The 6 Home buttons are placeholders until Phase 2.

## How it was tested
- **102 database tests** (`db/tests/`): every table has RLS; anon has no access; a role matrix (owner, accountant,
  procurement, data entry, auditor, viewer, outsider from another company, user without role); MFA gate; audit log
  content and immutability; numbering formats and no gaps; period close/reopen; master-data rules.
- **21 unit tests** (web): money formatting, form handling, search, Arabic translation completeness.
- Typecheck + production build. CI runs all of it on every PR (`.github/workflows/pf-ci.yml`).
- **Screens checked against the real database rules** using a local stand-in for the Supabase API: screenshots in
  [screenshots/phase1](screenshots/phase1). Demo data is fictional sample data, not your records.

## What you need to check (screenshots)
1. `04-projects`, `12-project-edit` — is the project form right (fields, order)?
2. `07-money-accounts`, `08-chart-of-accounts` — **please approve or correct the chart of accounts** (list in chart-of-accounts.md).
3. `14/15-mobile-ar-*` — Arabic on a phone. Note the data-entry user sees master data read-only but can *add* a missing supplier/item.
4. `13-owner-needs-mfa` — Owner/Accountant must use an authenticator app.

## Not done yet / known limits
- No hosted staging yet (Supabase free plan has no slot) — so you cannot click it yet. Everything is ready to deploy
  as soon as a project exists (README → "Deploying").
- Users are invited from the Supabase dashboard for now; a proper "Invite" button needs an Edge Function (Phase 7).
- Login rate-limiting/lockout is Supabase Auth's built-in protection; we configure it at go-live.
- End-to-end browser tests against real Supabase Auth start once staging exists.
