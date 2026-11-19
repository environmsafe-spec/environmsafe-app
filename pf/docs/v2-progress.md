# Brief v2 (19 Nov 2026): progress

Order agreed with the owner, 19 Nov 2026:
1. Step 1: A2, A1, A7, A16.
2. Step 2: A3, A4, A5.
3. Step 3: migration re-run on staging with the new export (`es_records_rows_21.csv`).
4. Step 4: A6, A10, A8, A9.
5. Step 5: A11–A14. A15 (Drive) is later.

## Owner's answers (19 Nov 2026)
- Number formats are daily for all deal documents:
  - Q-YYYYMMDDNN, RFQ-YYYYMMDDNN, REQ-, OFR-, SO-, GRN-, DN-;
  - PO keeps YYYYMMDDNN; invoices keep INV-YYYYMMDDNN.
- Zero amounts are refused everywhere except documents without money:
  - customer request, RFQ, goods receipt, delivery note;
  - offer lines the supplier did not price.
- Old Draft records are posted at migration.
- **Remember: old QR tokens.** `es_invoice_verify` and `es_document_token` must be exported from the old Supabase project and migrated, then the website `functions/verify.js` is switched at cut-over (A9). The owner said "later".

## Step 1 (done, on the branch; not yet published)
- **A1**:
  - No "payment in" type.
  - Advance repayment never reaches revenue (`db/tests/17_v2_rules.sql`).
- **A2**:
  - A line amount of 0 or empty is refused by the database for every way in, drafts included (trigger `app.line_amount_guard`).
  - Item amount = qty × price, always.
  - "Next step" asks for a price when none is known.
  - The six statuses are shown: Draft, Submitted, Posted, Reconciled, Void, Cancelled.
    - Cancelled = void and never numbered.
    - Reconciled = `documents.reconciled_at`, set with *Mark as reconciled*.
- **A7**: the number formats above (`20261121000100_v2_rules.sql`).
- **A16**:
  - `robots.txt` disallows everything.
  - `noindex` meta tag.
  - `X-Robots-Tag`, `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every page (`web/public/_headers`) and on the API (Worker).
  - Still to do: lock the old open tables with `lock_old_tables.sql`; this needs the owner's OK because it is the old database.
