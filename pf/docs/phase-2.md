# Phase 2: Money and the posting engine (demo note)

## What was built
**Every money action posts its own accounting entry.** You choose what happened, and the database writes the debits and credits.

| You choose | What the database posts |
|---|---|
| Pay → Expense (paid now) | Dr expense account per line (each line with its own project) · Cr bank |
| Pay → Supplier payment | Dr Accounts payable (supplier) — or 1260 Deposits if "Deposit / guarantee" · Cr bank |
| Pay → Salary | Dr 6100 Salaries / project · Cr bank, or Cr 2100 Employee payable if not paid yet |
| Pay → Advance to employee | Dr 1200 Employee advances (or 3200 Drawings if the person is tagged "withdrawals are owner drawings") · Cr bank |
| Pay → Claim reimbursement | Dr 2100 Employee payable (2200 for the owner) · Cr bank; ticks off the claims it pays |
| Pay → Owner drawings | Dr 3200 Drawings · Cr bank |
| Pay → Refund to customer | Dr Accounts receivable · Cr bank |
| Receive → Customer receipt | Dr bank (net of fee) · Dr fee · Cr Accounts receivable |
| Receive → Advance repayment | Dr bank · Cr 1200 Employee advances; ticks off the advances repaid |
| Receive → Refund from supplier | Dr bank · Cr Accounts payable |
| Transfer | Dr destination bank · Cr source bank, one document. If the currencies differ, the difference against the book rate posts to 7000 FX. |
| Claim → Expense claim | Dr expense / project · Cr 2100 Employee payable. If the claimant is the **owner**, Cr 2200 Owner current account. |
| Claim → Offset claims against advance | Dr 2100 · Cr 1200: an employee's claims are paid out of their advance. |
| Manual journal (Accountant / Owner only) | Your own debit/credit lines; must balance. |

Rules that apply to every document:
- **Fee field.** Every payment, receipt and transfer has one, posted to 6900 Bank charges inside the same entry.
- **Split lines.** One voucher, one attachment, several project lines.
- **Evidence.** A document that moves cash needs a file *or* a written reason before it can post. Each file is stored with its SHA-256 fingerprint. Files can be added later, even after posting, but never removed from a posted document.
- **Approval.** Payments over **USD 1,000** wait for the Owner. You can change the limit in the company settings.
- **Immutable once posted.** You correct a posted document by **voiding** it. That writes an exact opposite entry and keeps the number, so the series has no gaps. Then "Make corrected copy" gives you a new draft.
- **Realised FX.** When a claim or advance is settled at a different rate, the difference posts to 7000 automatically.
- **Closed periods** refuse posting, and numbers are only taken when posting succeeds.
- **Duplicate warning.** You're warned when the same bank reference, or the same party + amount + date, already exists.
- **Drafts inbox** on Home shows what each draft still needs. The cash position per account appears next to it.
- **Last used account** is remembered. Choosing a party fills in its usual project and account.

## How it was tested
- **188 database tests** (86 new):
  - one per posting rule, checking the exact debit/credit lines;
  - permissions, immutability, the evidence rule, approval, void/reversal, closed periods, duplicates;
  - settlement limits and currency mismatch;
  - the trial balance balances after every scenario.
- **32 unit tests** (web).
- **Browser run of the real screens** against the real database rules (`web/e2e/phase2-flow.mjs`), all 9 checks passed with no page errors:
  - expense split over two projects with a fee;
  - a USD 1,500 payment held for Owner approval, then approved;
  - a USD→YER transfer with an FX difference;
  - an employee claim reimbursed later;
  - a void with a reversal entry;
  - a data-entry user on an Arabic phone screen who can save drafts but not post.
  Screenshots are in [screenshots/phase2](screenshots/phase2).

## Bugs found and fixed while testing
- Data-entry users could not create drafts: a permission was missing on the draft-number function.
- An offset was refused with "enter the amount" before its amount had been worked out from the claims and advances it links.
- Salary lines were refused when no account was chosen, instead of defaulting to 6100.
- Clicking the already-selected bank account in a required list cleared it.
- In Arabic, amounts showed as "YER 31,120" instead of "31,120 YER".

## What you need to check
1. `21-expense-posted-journal`, `23-transfer-fx`: is the accounting entry readable for you?
2. `22-payment-waiting-approval`: is **USD 1,000 → Owner approval** the right rule? Should transfers between your own accounts be exempt?
3. Transfers use the **book rate** (rate table). The difference from the rate the exchange actually gave you is booked as FX gain/loss. This is standard practice, but tell me if you prefer otherwise.

## Not done yet / known limits
- Cash balances start from zero. Opening balances arrive with the migration (Phase 6), which posts them as opening entries.
- Bank reconciliation and the "Reconciled" status are planned for Phase 4, next to the bank book report.
- File upload needs the Supabase storage bucket, so it was not exercised locally. The browser run used "no document" reasons instead.
- Supplier bills and sales invoices, and paying or receiving against them, come in Phase 3. Until then, payments and receipts post to the supplier/customer account "on account".
