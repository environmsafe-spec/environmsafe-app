# Phase 6: Migration plan (decisions recorded 13 Nov 2026)

Source: old app, Supabase project `mcgjrsfsppdcnvolqsgs`, table `es_records`, company `dee3dc12-…`.
I only **read** it (summary queries, no copies of your records in this repository). Nothing in it was changed.

## 1. What is there (7 Nov 2026)

| Collection | Rows | Deleted | Empty tombstones | Live with data |
|---|---|---|---|---|
| transactions | 1,240 | 488 | 445 | **752** (+43 deleted with data) |
| projects | 164 | 78 | 70 | 86 |
| suppliers | 121 | 62 | 59 | 59 |
| employees | 105 | 47 | 38 | 58 |
| customers | 88 | 25 | 22 | 63 |
| accounts | 67 | 41 | 41 | 26 |
| categories | 53 | 33 | 33 | 20 |
| items | 40 | 1 | 0 | 39 |
| assets | 3 | 1 | 0 | 2 |

Live transactions by type and old status:

| Type | Approved/Paid/Closed | Draft | Cancelled |
|---|---|---|---|
| EXPENSE | 223 | 69 | – |
| PAYMENT OUT | 78 | 65 | – |
| SALARY | 25 | 71 | – |
| RECEIPT | 42 | 18 | – |
| INVOICE OUT | 29 | 19 | – |
| EXPENSE CLAIM | 6 | 37 | – |
| OWNER DRAWINGS | 13 | 6 | – |
| TRANSFER IN / OUT | 28 | 2 | 2 |
| ADVANCE TO EMPLOYEE | 5 | 3 | – |
| DEPOSIT PAID | 6 | – | – |
| SALES RETURN, REFUND ×2, **LOAN IN** | – | 5 | – |

**Amount vs debit/credit: no real conflicts.**
- 667 imported records carry the value only in `debit`/`credit` (`amount` empty).
- 79 are consistent; 6 carry only `amount`.
- Rule: **value = `amount`, or else the debit/credit figure.** Nothing needs guessing, so no record is flagged for this.

## 2. Old type → new document

| Old type | New document | Notes |
|---|---|---|
| EXPENSE, company account | Expense (paid now) | Account from the category (table 3), else **6990**; "Bank fee…" lines → **6900**. Employee/supplier kept on the document as information. |
| EXPENSE, employee, **no account** | **Expense claim** of that employee (still owed) | Decision B. Only **5** records: 1 Approved YER 204.00 and 4 Drafts (SAR/USD, 139.14 in total). |
| EXPENSE / PAYMENT OUT from **USD-AKRAM-QUT** or with no account and no employee | Expense claim of the **owner** (Cr 2200 owner current account) | Decision F. |
| PAYMENT OUT against an EXPENSE CLAIM (`againstRef`) | Claim reimbursement, linked to the claim | |
| PAYMENT OUT, salary category | Salary | |
| PAYMENT OUT with supplier **and item** | Supplier bill + its payment (same date) | Keeps item prices and payables right. |
| PAYMENT OUT with supplier, no item | Expense with the supplier | 5900 when it has a project, else 6990. |
| PAYMENT OUT to an employee, no claim linked | Claim reimbursement (unlinked) | Decision B: they had paid personally. Listed for review. |
| SALARY | Salary (paid); no account → salary owed (Cr 2100) | |
| RECEIPT | Customer receipt | Settles the invoice in `againstRef`, else the oldest open invoice of the same customer, currency and amount. |
| INVOICE OUT | Sales invoice → **accounts receivable** | Decision D. Revenue 4100; generator projects **4250**, ADRA maintenance 4200 (decision G). |
| EXPENSE CLAIM | Expense claim (employee, or owner) | |
| OWNER DRAWINGS | Owner drawings (Dr 3200) | From the personal account: listed, no company effect. |
| TRANSFER OUT + TRANSFER IN (paired by `againstRef`) | **One** transfer | Unpaired legs go to the exceptions list. |
| ADVANCE TO EMPLOYEE | Employee advance | |
| DEPOSIT PAID | Supplier payment, purpose deposit (1260) | |
| SALES RETURN, REFUND TO CUSTOMER on the INV account | Credit note against the invoice | All 3 are drafts: they stay drafts. |
| REFUND FROM SUPPLIER | Refund from supplier | |
| **LOAN IN** TRX-UL-0149 (YER 1,000,000, Draft) | **Advance repayment** by the employee, linked to TRX-0283 | Decision E: Yasmeen's bus advance, paid back. Stays a draft (A) until you post it. |

**Statuses (decision A):**
- Approved / Paid / Closed → posted.
- Draft → stays a draft, with nothing changed. Some are new records since 7 Nov.
- Cancelled → void.
- Deleted with data → void, "Deleted in the old app".
- The 445 empty records are only listed.

A record that cannot be posted (for example, the amount is missing) stays a draft, and the reason is listed.

Every migrated document keeps:
- the old ID (`TRX-0001`) and the date;
- references, the project and the attachments;
- a note with the old type and status, `againstRef`, case number and phase.

Overheads without a project go to the internal project **General**.

## 3. Old categories → GL accounts (20 live)

| Old | Name | Used by | → New account |
|---|---|---|---|
| CAT-0001 | Direct Cost | 1 claim | 5900 Other direct costs |
| CAT-0002 | Salary | 3 payments, 9 salaries | 6100 Salaries and wages |
| CAT-0003 | Marketing | – | 6700 Marketing |
| CAT-0004 | Transport | – | 6200 Transport and fuel |
| CAT-0005 | Utilities | – | 6350 Utilities and communications |
| CAT-0006 | Office Supplies | – | 6800 Office and supplies |
| CAT-0007 | Government Fees | 2 claims | 6400 Government fees and licences |
| CAT-0008 | Professional Services | – | 6500 Professional fees |
| CAT-0009 | Travel | – | 6600 Travel and accommodation |
| CAT-0010 | Other OPEX | 73 expenses (mostly bank and remittance fees) | **6900 Bank charges** when the description starts with "Bank fee"; else 6990 Other operating expenses. "Zakat" lines go to 6990 (tell me if you want a Zakat account). |
| CAT-0011 | INTERNAL TRANSFER | – | (no P&L; transfers) |
| CAT-0012 | Debit | – | 1150 Other receivables |
| CAT-0013 | Motivation | – | 6100 Salaries and wages (staff incentives) |
| CAT-0014 | Customer Order | 1 expense, 1 payment | 5200 Materials (cost of a customer order) |
| CAT-0015 | EnvironmSafe Procurement | – | 5200 Materials and spare parts |
| CAT-0016 | OWNER DRAWINGS | 2 | 3200 Owner drawings |
| CAT-0017 | Work & expenses | 1 expense, 1 salary | 6990 Other operating expenses |
| CAT-0018 | Expense claims | 22 claims | by the claim's own nature → 6990 unless the description says otherwise (listed for review) |
| CAT-0019 | Debit (owed back) | – | 1150 Other receivables |
| CAT-0020 | Guarantee | – | 1260 Deposits and guarantees paid |

Only ~110 of 752 transactions have a category, so for the rest **the type decides the account**:
- expense → 6990; salary → 6100; invoice → 4100; and so on.
- Every expense that lands on 6990 or 5900 without a category goes on a **"review account" list** you can fix in the new app after migration (by void + corrected copy, or one reclassification journal).

## 4. Old bank / cash accounts → new money accounts

**Opening balances: 0 (decision C).** The old records are taken as closed.

| Old | → New |
|---|---|
| Kuraimi USD / SAR / YER (ACC-0003, 0007, 0008) | bank accounts |
| Qutaibi USD / SAR / YER (ACC-0009, 0011, 0006), Rokn, Tamkeen | exchange-company accounts (the company's own Qutaibi accounts) |
| **USD/SAR-Akram-TAD** (ACC-0020, 0025) | **company bank accounts** at Tadhamon (decision F) |
| **USD-AKRAM-QUT** (ACC-0022) | **not a company account**: your personal account. Payments from it = paid by you for the company (Cr 2200). Its 2 records are migrated that way. |
| **USD/SAR/YER-INV** (ACC-0004, 0012, 0024) | **not migrated as accounts** (decision D, below) |
| Visa cards (ACC-0015, 0016, 0019) | card accounts |
| Yasser petty cash (ACC-0018, 0021, 0023) | cash accounts |
| USD-GEN / SAR-GEN, YER, SAR (ACC-0010, 0017, 0013, 0014) | bank accounts with their old names. Rename or merge them in the new app if you know what they are. |

**D. How the "INV" accounts are handled now.** In the Excel days, an invoice was entered into the INV account as "invoiced, not received yet". In the new app that is exactly **accounts receivable (1100)**:
- every posted invoice raises what the customer owes;
- every customer receipt reduces it and settles the invoice;
- the **Aging** report and the **customer statement** show what is still open.

So there is no INV account. The invoices are migrated as sales invoices, and the receipts settle them.

Usage of the old INV accounts:
- ACC-0004: 46 USD invoices, 95,593.71.
- ACC-0012: 8 SAR invoices (86,174), plus 1 refund and 2 sales returns (all drafts).
- ACC-0024: 1 YER invoice, 100,000.

## 5. Decisions (answered 13 Nov 2026)

- **A.** Old drafts stay drafts as they are.
- **B.** Employees mostly paid personally and the company paid them back. Expenses with a company account are company expenses. The 5 without an account are open employee claims.
- **C.** Opening balances are 0.
- **D.** INV = receivable placeholder → accounts receivable.
- **E.** LOAN IN = the employee repaying the advance.
- **F.** Tadhamon = company bank. Al Qutaibi USD-AKRAM = personal. The company's own Qutaibi accounts stay.
- **G.** New account **4250 Generator maintenance services** for UNHCR-GEN-001, UNHCR-GEN-002 and FAO-GEN-001.

## 6. How the migration will run (after your approval)
1. **Staging:**
   - Copy `es_records` (and the file list of bucket `es-attachments`) into the staging project. Your dashboard backup or a one-off export does it; I prepare the script.
   - Run the migration there: one SQL job, re-runnable from scratch, writing every source row to a `migration_map` (old ID → new document, status, notes).
2. **Exceptions list:** everything that could not be mapped (unpaired transfers, missing accounts, unmatched receipts). Nothing is silently dropped.
3. **Reconciliation proof** (your acceptance test):
   - for every account, project, party and type, **old totals = new totals per currency**;
   - record counts match;
   - every attachment path exists and has its SHA-256;
   - orphan files (in the bucket, not on any record) are listed.
4. You review in the new app. Then the cut-over delta (records changed after the staging copy), and one month in parallel.

## 7. The job (built, tested on look-alike data)
- `pf/db/migration/legacy_migration.sql`:
  - the job: `select migration.run(company, owner_user)`;
  - its settings tables: category → account, account rules, project → revenue account;
  - the views `migration.recon_counts`, `recon_money`, `recon_money_open_items`, `recon_projects` and `recon_attachments`.
- `pf/db/migration/staging.mjs`:
  - `load` copies the old records into `legacy.es_records` on staging (the old project is only read; the `legacy` schema must be exposed to the API for the copy, or load the dashboard CSV export instead);
  - `files` copies the attached files, fills in their SHA-256, and lists missing and orphan files.
- `pf/db/tests/13_legacy_migration.sql`: 29 checks on synthetic records with the same shape and quirks as yours. Examples:
  - the value read from debit/credit;
  - the tombstones;
  - the INV and personal accounts;
  - transfer pairing;
  - the advance repayment;
  - bills from payments;
  - the bank books matching the old app;
  - the old table unchanged.

Next: a staging project to run it on your real records (see the hosting question), then your review in the app.
