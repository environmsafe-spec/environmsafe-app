# Phase 3: Procurement, sales and printed documents (demo note)

## What was built
**Documents**

| Document | Number | What it does |
|---|---|---|
| Purchase order | `2026110701` (+ Rev.N) | Issued to the supplier. A commitment only, so no accounting entry. A revision keeps the number and marks the earlier one "Superseded by Rev.N". |
| Supplier bill | `BILL-2026-0001` | Dr cost/asset per line (with project), Cr Accounts payable. Usually created from the PO with one click. |
| Quotation | `QT-2026-0001` (+ Rev.N) | Issued to the customer, no accounting entry. |
| Sales invoice | `INV-2026110701` | Dr Accounts receivable, Cr revenue per line (with project). Usually created from the quotation with one click. |
| Credit note | `CN-2026-0001` | Created from an invoice and linked to it for the open amount. Dr revenue, Cr receivable. |

- **Line types.** Product/service lines (item, qty × unit price) plus **surcharge, discount and tax lines** given as a percentage. Tax can be on the products or on the untaxed amount, as in your sample PO: 12% surcharge, then 5% tax on the products subtotal. The database recalculates every line at posting, so the screen and the ledger always agree.
- **The item catalogue builds itself.** Every product line names an item. A missing item can be added inside the form (name + goods/service). Issuing or posting updates the item's last cost / last sale price, supplier / customer and document reference. The next document fills the price from it.
- **Payments settle bills and receipts settle invoices.** Tick the open bills or invoices; part payments are fine. They are relieved at the bill's or invoice's own rate, and the rate difference posts to 7000 FX automatically. Example tested: a SAR bill at 3.79 paid at 3.75 shows a USD 5.33 loss.
- **Due dates** = document date + the party's payment terms (new field on customers and suppliers). The due date follows the document date until you type your own.
- **Reports → AR aging and AP aging**, as at any date, with buckets (not due / 1–30 / 31–60 / 61–90 / 90+) per currency. **Party statement**: every movement for any customer, supplier, employee or owner, per currency, with running balance.
- **Procurement** tab: Purchase orders · Supplier bills · Suppliers · Items. **Sales** tab: Invoices · Quotations · Credit notes · Customers. Home's **Bill / Invoice** button opens all five.

**Printed documents** (`pf/pdf/`)
- Renderer in Python ReportLab that reproduces your PO and invoice from positions measured in your sample PDFs. Logo and signature/stamp come from the samples themselves.
  - **Visual regression test against your files:** 0.03% of pixels differ on the PO, 0.22% on the invoice. CI fails above 0.5%.
- Improvements from the spec:
  - Multi-page tables with the header repeated and "Page x of y".
  - QR code linking to a public **verification page** (`/verify/<code>`) showing document, date, total and whether it is valid or void. No login is needed and the code is unguessable.
  - Rev.N mark, DRAFT / VOID watermark.
  - **Arabic** names and descriptions (Noto Naskh Arabic, shaped right-to-left).
  - **Amount in words** (USD / SAR / YER) on invoices and vouchers.
- Any document can be printed: PO, bill, quotation, invoice, credit note, and payment / receipt vouchers.
- Posted documents: the PDF is stored automatically as an attachment with its SHA-256. Drafts print with a DRAFT watermark and are not stored.
- How it runs: a small Python service (`pf/pdf/server.py`, Dockerfile included) is called only by the `generate-pdf` Supabase function. The function reads the document with the user's own permissions.

## How it was tested
- **234 database tests** (46 new). Among them, your sample PO case: 25 Kg × 12.19 + 12% + 5% = **USD 356.56**, computed by the database. Also:
  - Rev.1 keeps the number;
  - bill from PO; payment settles bill; SAR FX loss;
  - quotation → invoice → part receipt → AR aging 852.63 in the 31–60 bucket → credit note → zero;
  - verification works for an anonymous visitor and shows nothing for a wrong code;
  - procurement can issue POs and post bills but cannot pay;
  - trial balance balances.
- **45 unit tests** (web), including the print builder checked against your sample totals block.
- **Visual regression** of both printed samples (above).
- **Browser run of the real screens**: 8 checks passed, no page errors.
  - A PO with an item created on the spot (10 × 38.50 + 5% = 404.25) is issued.
  - It is converted to a bill and posted.
  - The bill is paid, and AP aging is empty.
  - A quotation is converted to an invoice, USD 600 is received, and AR aging shows 540.00 open.
  - The Phase 2 run was repeated afterwards: 9/9 passed, so no regressions.
- Screenshots and real printed PDFs (made from the demo database) are in [screenshots/phase3](screenshots/phase3).

## Fixed while testing
- A bill was flagged as a "possible duplicate" of its own PO. The duplicate check now compares documents of the same type only.
- Surcharge/tax lines on a bill had no project, so the bill could not post. They now take the project of the product line.
- Issuing a PO said "Posted"; it now says "Issued".
- New companies now start with standard printed terms (PO, quotation, invoice with the Kuraimi bank line).

## What you need to check
1. `37-print-2026110701.png`, `37-print-INV-2026110701.png` and the PDFs next to them: are these right for you?
2. Should the **QR code** sit bottom-right (as now), or somewhere else?
3. Standard terms for PO / quotation / invoice are in company settings. Send me your preferred wording.

## Not done yet
- Printing on the hosted app needs the PDF service deployed: Cloud Run, Render or Fly, any of them. A free tier is fine for this volume. Deploying it is part of setting up hosting.
- Applying an earlier "on account" payment to a later bill (allocation without new money) is not available yet. For now, link the bill when you record the payment.
- The fixed-asset register (from bill lines marked "asset") is planned for Phase 4.
