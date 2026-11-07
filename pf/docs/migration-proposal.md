# Phase 6: Migration proposal (for your approval before anything runs)

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

## 2. Old type → new document (posting rules from Phase 2/3)

| Old type | New document | Notes |
|---|---|---|
| EXPENSE | Expense (paid now) | Account from the category (table 3), else **6990 Other operating expenses**, listed for review. Fee rows stay separate expenses (your rule). |
| PAYMENT OUT | Supplier payment | With an item: a supplier bill + its payment (same date), so the item catalogue and AP stay right. With an employee and no supplier: salary or advance, see question B. |
| SALARY | Salary (paid from the account) | No account: salary owed (Cr 2100). |
| RECEIPT | Customer receipt | Settles the customer's INVOICE OUT where amount and customer match; otherwise on account. |
| INVOICE OUT | Sales invoice | Revenue account by service line: 4100 Inspection by default; I'll propose per project if you prefer. |
| EXPENSE CLAIM | Expense claim (employee or owner) | Reimbursed later by the matching PAYMENT OUT / SALARY when linked; otherwise left open in employee payables. |
| OWNER DRAWINGS | Owner drawings | Dr 3200. |
| TRANSFER OUT + TRANSFER IN (paired by `againstRef`) | **One** transfer | Unpaired legs go to the exceptions list. |
| ADVANCE TO EMPLOYEE | Employee advance | |
| DEPOSIT PAID | Supplier payment, purpose "deposit / guarantee" (1260) | |
| SALES RETURN | Credit note against the invoice in `againstRef` | |
| REFUND TO CUSTOMER / FROM SUPPLIER | Refund documents | |
| **LOAN IN** (1 record, 1,000,000 YER, Draft) | Manual journal Dr bank, Cr **new account 2500 Loans payable** | Question E. |

Every migrated document keeps the old ID (`TRX-0001`, `TRX-UL-0174`) in **Old ID**, its date, references, project and attachments, and is marked *migrated*. Deleted records with data (43) come in as **void** with "Deleted in old app". The 445 empty tombstones are only listed in the migration log.

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

## 4. Old bank / cash accounts → new money accounts (26 live)

All old opening balances are **0 or empty** (question C).

| Old | Name | Ccy | Bank in old app | Txns | → New account |
|---|---|---|---|---|---|
| ACC-0003 | USD-Kur | USD | Al Kuraimi | 274 | Kuraimi USD (bank) |
| ACC-0007 | SAR-Kur | SAR | Al Kuraimi | 78 | Kuraimi SAR (bank) |
| ACC-0008 | YER-KUR | YER | Al Kuraimi | 40 | Kuraimi YER (bank) |
| ACC-0009 | USD-Qut | USD | Al Qutaibi | 77 | Qutaibi USD (exchange) |
| ACC-0011 | SAR-QUT | SAR | Al Qutaibi | 81 | Qutaibi SAR (exchange) |
| ACC-0006 | YER-QUT | YER | Al Qutaibi | 73 | Qutaibi YER (exchange) |
| ACC-0004 | USD-INV | USD | "INV (unconfirmed)" | 36 | **? question D** |
| ACC-0012 | SAR-INV | SAR | "INV (unconfirmed)" | 11 | **?** |
| ACC-0024 | YER-INV | YER | "INV (unconfirmed)" | 1 | **?** |
| ACC-0001 / 0002 / 0005 | USD/SAR/YER-Rok | | "ROK (unconfirmed)" | 2 / 4 / 3 | Rokn USD / SAR / YER (exchange) |
| ACC-0020 / 0025 | USD/SAR-Akram-TAD | | Tadhamon | 8 / 1 | **? question F** |
| ACC-0022 | USD-AKRAM-QUT | USD | Al Qutaibi | 2 | **? question F** |
| ACC-UL-0006 | USD-Tamkeen | USD | Other | 7 | Tamkeen USD (exchange) |
| ACC-0015 / 0016 / 0019 | H VISA C QUT, H VISA C KUR, A VISA C QUT | USD | – | 3 / 9 / 9 | three Visa cards (card) |
| ACC-0018 / 0021 / 0023 | SAR/YER/USD-YAS-PEDDY | | – | 1 / 2 / 3 | petty cash held by Yasser (cash), one per currency |
| ACC-0010 / 0017 | USD-GEN / SAR-GEN | | General | 1 / 1 | **merge into a "General / unknown" suspense?** |
| ACC-0013 / 0014 | YER / SAR | | – | 6 / 1 | |

18 live transactions have **no account** (expenses, payments, salaries, invoices). Invoices don't need one. The others go to the exceptions list. The default proposal for those: post them as **owner paid for the company** (Cr 2200 owner current account), the same way you handled Alibaba fees paid by card. Tell me if that's wrong.

## 5. Questions I need answered (the migration does not run until you approve)

**A. Old "Draft" records (297 of 752).** Choose one:
1. **Recommended:** post every complete draft dated **before 1 Oct 2026**; keep October–November drafts and incomplete ones (no amount / no account) as drafts for you to review in the new app.
2. Keep all old drafts as drafts.
3. Post all.

**B. Employee on expenses and payments.** 149 EXPENSE records carry an employee, often together with a supplier. Is the employee:
1. **Recommended:** the person who handled or paid it from company money (recorded as information only), or
2. the person who paid personally, so it is really a claim to reimburse?

**C. Opening balances.** The old app has 0 everywhere. For the bank book to match the real banks, I need the **real balance of each account on 25 Jan 2025** (or the earliest date you know). Without them, balances start at zero and every account's balance will differ from the bank by its true opening amount.

**D. "INV" accounts (USD/SAR/YER-INV).** Which bank or company is "INV"?

**E. LOAN IN (1,000,000 YER, Draft, linked to TRX-0283).** Who lent it, and is it a loan to repay (liability 2500) or capital you put in (3000)?

**F. The "Akram" accounts (Tadhamon USD/SAR, Qutaibi USD).** Company accounts held in your name (bank accounts in the new app), or your personal accounts? If personal, payments from them become **owner paid for company** (Cr 2200) instead of bank movements.

**G. Invoice revenue account.** Default 4100 Inspection and certification. Should generator maintenance projects (UNHCR, FAO) go to 4200 Maintenance? I can set it per project.

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

Estimated work after your answers: one focused session for the migration job and its tests, plus the reconciliation report.
