# Phase 4: Reports (demo note)

## What was built
Under **Reports**, each with dates / filters, **Excel/CSV** export (Arabic-safe), **Print / PDF**, and click-through to the document:

| Report | Notes |
|---|---|
| Profit or loss | IFRS sections: revenue, cost of sales, **gross profit**, operating expenses, **operating profit**, FX, **profit**. Comparative last year, **by month** (12 columns), filter by project. |
| Balance sheet | As at any date, grouped by statement line. Earlier years' profit and this year's profit shown separately (no year-end closing entry needed). A "balanced" check is built in. |
| Cash flow (direct) | Every bank/cash movement by purpose: operating, investing, financing. **Payments of supplier bills are split by what the bill bought**, so equipment bought on credit shows as investing. Ties to the bank balances (built-in check). |
| Changes in equity | Share capital, retained earnings (opening + profit), owner drawings. |
| Trial balance | Opening / debit / credit / closing. Click an account to open its ledger. |
| General ledger | By account, project or party; opening and running balance; original currency shown next to USD. |
| AR / AP aging, statements | From Phase 3. |
| Project P&L | Revenue, cost of sales, other costs, margin %, **budget used** bar (budget converted to USD). |
| Bank & cash book | Per account in its own currency, running balance. **Reconciliation:** enter the statement date and balance, tick the lines on the statement, finish when the difference is zero. |
| Employee & owner balances | Advances, unpaid claims and salaries, owner current account, per currency. |
| Fixed assets | Register (cost, monthly charge, accumulated, net book value). Assets are **created automatically** when a bill or expense line for an asset item is posted. **Run depreciation** for a month posts one journal (Dr 7100, Cr 1590); a month cannot be run twice. |
| Audit pack | One ZIP: trial balance, general ledger, list of every posted/void document, file manifest with SHA-256, and the files themselves. |

## How it was tested
- **263 database tests** (29 new tie-out tests on a small year of activity, every figure worked out by hand):
  - trial balance balances; profit 2,390; comparative year 1,000;
  - balance sheet balances, including profit of earlier years;
  - cash flow = change in cash = bank balance, with equipment on credit under investing;
  - equity 3,390; project margin 60%;
  - depreciation 100/month, never twice;
  - bank reconciliation closes only when the difference is zero.
- **49 unit tests** (web): statement grouping and CSV export added.
- **Browser run of every report** on a demo year posted through the real engine (58 documents: UNHCR maintenance, YCSR PSV job, rent, salaries, a calibration bench bought as an asset, a USD→YER transfer, a claim, drawings). 8 checks passed, no page errors:
  - profit **28,279.30** matches the hand calculation to the cent;
  - balance sheet balanced; cash flow ties; trial balance balanced and drills down;
  - YCSR margin 6,960; 7 months of depreciation; audit pack downloaded.
- Screenshots in [screenshots/phase4](screenshots/phase4), plus the demo audit-pack ZIP.

## Bugs found and fixed while testing
- The cash flow dropped the bank-fee line of supplier payments (a NULL comparison in SQL). The tie-out test caught it.
- Equipment bought on credit was counted as an ordinary supplier payment. Bill payments are now looked through to what the bill bought.
- Depreciation run: a variable name clashed with a table name.

## Notes / limits
- Statements are in USD (functional currency). Original currencies show in the ledger, bank book, aging and statements.
- A supplier with a *debit* balance (paid before the bill) currently stays inside "trade payables" on the balance sheet. Showing it under prepayments is a later refinement.
- Period-end revaluation of foreign-currency bank balances is a later phase, as the spec says.
- "Print / PDF" uses the browser's print to PDF with a print layout. Excel export is CSV, which Excel opens directly.
