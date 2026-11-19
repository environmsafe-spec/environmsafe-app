# ES-PF v2: Plan for approval

Status: **waiting for owner OK before Phase 1.**
Source spec: `ES_App_Rebuild_Prompt.md` (owner, 2 Nov 2026).

---

## 1. My understanding (short)

- One app, one database, five modules (Procurement, Sales, Money, Accounting, Master data). Separation comes from roles, not from separate systems.
- USD is the functional currency. Every line keeps its original currency, rate and USD amount.
- Users pick a business action (Pay, Receive, Transfer, Claim, Bill/Invoice, Upload voucher). The database turns each posted document into a balanced journal. Posted means locked: you correct it by reversing it.
- The old app's data (`es_records` in project `mcgjrsfsppdcnvolqsgs`) is read-only for me. It gets migrated in full, deleted rows included, with a reconciliation proof.
- Printed documents follow the attached PO and Invoice: gold stripe, navy footer, signature + stamp, supplier acceptance block on POs. Other documents (payment voucher, receipt, quotation, credit note, statements) use the same frame.

---

## 2. Key decisions (my recommendations)

| Topic | Decision | Why |
|---|---|---|
| Where the code lives | New folder `pf/` in this repo. Moving it to its own repo later is a single copy. | This session can only reach this repo. The website and agent in `public/` and `functions/` are not touched. |
| Staging database | A **new Supabase project "ES-PF Staging"** | Rule 3: never build on live data. |
| Frontend | React + TypeScript + Vite PWA, **Mantine** UI (good RTL support), i18next EN/AR, TanStack Query | Follows the spec. Mantine handles Arabic RTL better than shadcn. |
| Business logic | Postgres functions + triggers (posting, numbering, balance checks, locks, audit) | Spec section 2. No client can bypass them. |
| PDFs | **Python ReportLab** in a small container service (Cloud Run or Render), called by an Edge Function | Your existing templates are ReportLab. Porting them would risk visual drift. ReportLab also does Arabic with an embedded font (Noto Naskh/Amiri + arabic-reshaper + python-bidi). |
| AI extraction | Edge Function → Claude API, latest Sonnet, JSON schema output | The key stays server-side. Results are always saved as Drafts. |
| Hosting | **Cloudflare Pages** (already hosts environmsafe.com) at `app.environmsafe.com` | You already use it, and its DNS is there. The spec suggested Netlify/Vercel, but Cloudflare does the same job at no extra cost. |
| Tests | Vitest, pgTAP (posting rules, RLS per role), Playwright E2E, PDF visual diff. GitHub Actions on every PR. | Spec section 2. |

---

## 3. Phases (one PR each, sometimes two)

| # | Phase | Main output | Acceptance |
|---|---|---|---|
| 1 | Foundation | Staging DB, schema core, Auth + MFA, roles/permissions, RLS, audit log, master data screens (projects, parties, items, money accounts, CoA, rates), numbering, periods, app shell EN/AR, CI | RLS tests pass for all 6 roles. Every change shows up in the audit log. |
| 2 | Money + posting engine | Pay, Receive, Transfer, Expense, Claim, Reimbursement, Advance, Salary, Owner; fee line; split lines; attachments with hash; journal generation; reversal; void; duplicate guard; drafts inbox | Every type posts a balanced entry. Posted documents can't be edited. TB balances. |
| 3 | Procurement + Sales | PO (Rev.N), supplier bill, sales invoice, credit note, quotation, settlement links, inline item creation, FX gain/loss on settlement, PDFs + QR verification page | PDFs match the samples (visual test). Payments settle bill lines. Aging is correct. |
| 4 | Reports | GL, TB, P&L, balance sheet, cash flow (direct), equity, AR/AP aging + statements, project P&L, bank book, employee/owner balances, asset register, audit pack ZIP; PDF + Excel export | Statements tie to the TB. Cash flow ties to bank balances. |
| 5 | AI + speed | Upload voucher (side-by-side review), batch mode, recurring templates, camera capture | 20 real vouchers pre-fill correctly. Nothing posts automatically. |
| 6 | Migration | Read-only extractor, category→GL and account mapping (for your approval), exceptions list, staging run, reconciliation report, delta cut-over, one month parallel run | Zero unexplained differences. |
| 7 | Hardening | Security advisors clean, backups + restore test, Drive weekly export, idle timeout/lockout, performance, user guide EN/AR | Advisors clean. Restore tested. |

Heavy steps I'll warn you about first: the migration runs (Phase 6), full E2E/visual test runs, and the cut-over.

---

## 4. Database schema (key tables and columns)

Every table has `id uuid`, `company_id`, `created_at/by`, `updated_at/by`. Every table has RLS.

**Security & system**
- `companies` (name_en/ar, functional_currency='USD', fiscal_year_start_month=1, settings jsonb: bank lines, approval thresholds)
- `user_profiles` (user_id → auth.users, full_name, locale, default_money_account_id, is_active)
- `roles` (code: owner, accountant, procurement, data_entry, auditor, viewer) · `permissions` (code e.g. `doc.post`, `period.close`) · `role_permissions` · `user_roles` (user, role, company)
- `audit_log` (id bigserial, at, user_id, table_name, record_id, action, before jsonb, after jsonb, ip, user_agent). Insert-only: no UPDATE/DELETE grant for anyone, plus a trigger that blocks both.
- `number_sequences` (doc_type, year, last_no). Numbers are taken inside the posting transaction with a row lock, so there are no gaps.
- `fiscal_periods` (year, month, status open/closed, closed_by/at, reopen log)
- `approvals` (document_id, rule, requested_by, decided_by, decision, at)

**Master data** (each has `code` serial, `legacy_id`, `name_en`, `name_ar`, `is_active`)
- `projects` (customer_id, kind contract/internal, status, budget_amount, budget_currency, start/end dates)
- `parties` (kind customer/supplier/employee/owner, possibly several roles at once, phone, email, address, tax_no, default_gl_account_id, default_project_id, treat_withdrawals_as_drawings bool, opening balances)
- `items` (kind goods/service, unit, default_expense_account_id, default_revenue_account_id, last_cost, last_sale_price, currency, is_asset, life_years)
- `gl_accounts` (code, name_en/ar, type asset/liability/equity/income/expense, subtype, parent_id, ifrs_line, requires_project bool, is_control (AR/AP/etc.), is_postable)
- `money_accounts` (kind bank/cash/card/exchange, currency, bank_name, account_no, gl_account_id, holder_party_id, usual_fee, opening_balance, opening_date)
- `fx_rates` (date, currency, rate_per_usd)
- `categories_map` (legacy category → gl_account, used for migration and for defaults)

**Documents**
- `documents` (doc_type, status draft/submitted/posted/reconciled/void, number, temp_number, revision, date, due_date, party_id, money_account_id, counter_money_account_id (transfers), currency, rate, total, fee_amount, fee_currency, reference_no, notes, terms, no_document_reason, against_document_id, source (manual/ai/import/migration), migrated bool, legacy_id, posted_by/at, voided_by/at/reason, reversal_of_id, reversed_by_id)
- `document_lines` (line_no, item_id, description, qty, unit, unit_price, discount, amount, currency, project_id, gl_account_id, employee_id, is_asset, tax fields kept for later)
- `document_links` (from_document_id, to_document_id, kind settles/credits/repays/revises, amount, currency, functional_amount): bill↔payment, invoice↔receipt, advance↔repayment, claim↔reimbursement
- `attachments` (document_id, storage_path, file_name, mime, size, sha256, md5, kind upload/generated_pdf, uploaded_by/at). Can't be deleted while the document is posted.
- `recurring_templates` (name, doc_type, payload jsonb, schedule, next_run)
- `ai_extractions` (attachment_id, model, raw_json, confidence, created_document_id)

**Ledger**
- `journal_entries` (document_id, date, period_id, number JV-…, kind normal/reversal/fx/depreciation/opening, memo)
- `journal_lines` (account_id, debit, credit (USD), txn_currency, txn_amount, rate, project_id, party_id, item_id, cost_centre, document_line_id, description)
  - A deferred constraint trigger enforces Σdebit = Σcredit per entry.
  - P&L lines must have a project.
  - Posting is rejected if the period is closed.
- `bank_reconciliations` / `bank_statement_lines` (money_account, statement date, matched journal_line)

**Assets**
- `assets` (code, name, item_id, source_document_line_id, cost, currency, acquisition_date, life_months, salvage, method straight-line, location, status, accumulated)
- `depreciation_runs` (period, journal_entry_id)

**Migration**
- `migration_map` (old_collection, old_uid, old_id, new_table, new_id, status, notes) · `migration_exceptions`

**Posting functions:** `post_document(id)`, `reverse_document(id, reason)`, `void_document(id, reason)`, `close_period(y,m)`, `reopen_period(y,m,reason)`, `run_depreciation(y,m)`. All are SECURITY DEFINER with permission checks inside.

**Number prefixes:** PO `YYYYMMDDNN` (Rev.N), INV `INV-YYYYMMDDNN`. New prefixes I propose: `QT-` quotation, `BILL-` supplier bill, `CN-` credit note, `PV-` payment voucher (pay/expense/salary/advance/owner), `RV-` receipt voucher, `TRF-` transfer, `CLM-` claim, `JV-` manual journal. The format is `PFX-YYYY-NNNN`, gapless per year.

---

## 5. Default chart of accounts (outline; full list comes with Phase 1 for your approval)

1000 Cash & bank (one sub-account per money account) · 1100 AR · 1150 Customer advances (liability side 2150) · 1200 Employee advances · 1250 Prepayments & deposits paid · 1300 Inventory (optional) · 1500 PPE / 1590 Acc. depreciation · 2000 AP · 2100 Employee payables · 2200 Owner current account · 2300 VAT/withholding (dormant) · 3000 Share capital · 3100 Retained earnings · 3200 Owner drawings · 4000 Revenue: Inspection, Maintenance, HSE & Training, Trading, Other · 5000 Cost of services (direct) · 6000 Opex: Salaries, Transport, Utilities, Government fees, Professional, Travel, Marketing, Office, Rent, Bank charges, Other · 7000 FX gain/loss · 7100 Depreciation.

---

## 6. Blocking question (only one)

**Supabase plan.** Your organisation is on the **Free plan**, and Free allows only 2 active projects. You already have 2: "ES Operations APP" (the live app) and "environmsafe-spec's Project". So I **cannot create the staging project** without one of these:

- **A. Upgrade the organisation to Pro (recommended).** About USD 25/month, plus about USD 10/month per extra project. This also gives daily backups (spec section 8.8 needs them), no auto-pause after 7 days idle, and higher limits. You need this for production anyway.
- B. Pause "environmsafe-spec's Project", if it isn't used. Tell me what it is first.
- C. Do nothing now. I'd build Phase 1 against a local Postgres in my workspace and create staging later. Tests still run, but you'd have nothing to click on.

Whatever you choose, I'll start Phase 1 with the database schema and tests, which don't need the project yet.

## 7. Questions I will ask later (not blocking now)

Final CoA + category mapping (Phase 1/6), approval thresholds (Phase 2), VAT/withholding (Phase 3), which old drafts to post (Phase 6). Fiscal year = January unless you say otherwise.

## 8. Templates received

- `pf/templates/sample_PO.pdf`
- `pf/templates/sample_Invoice.pdf` (INV-2026110701 YGCI Calibration)
- `pf/templates/akram_signature_stamp.png`

Still missing: the high-resolution logo `es_logo.jpg`. I'll use `public/img/logo.png` from the website unless you send a better one. The ReportLab scripts (`po_template.py`, `invoice_template.py`) are also missing, so I'll rebuild the layout from the two PDFs.
