# Invoice verification (anti-forgery QR)

Invoices are issued without a wet stamp, so every invoice we generate carries a
QR code. Scanning it opens

    https://www.environmsafe.com/verify?t=<token>

which shows, live from the Procurement & Finance database, the invoice's
number, date, customer, total and status. A forged invoice fails in one of
three ways: no QR, a QR to some other site, or a copied QR whose page shows our
real customer and amount instead of the forged ones.

## Parts

| Part | Where |
|---|---|
| Token table `es_invoice_verify` + `es_verify_invoice()` + `es_invoice_token()` | `schema.sql`, Supabase project `mcgjrsfsppdcnvolqsgs` |
| Public page | `functions/verify.js` (Cloudflare Pages Function, deploys with `main`) |
| QR on the PDF | `es_verify_qr.py` in the project's invoice templates |

## Rules

- The token is random (122 bits), never the invoice number, so pages cannot be
  guessed or listed. One token per invoice number; all lines of a split invoice
  (`refNo` = invoice number, type `INVOICE OUT`) are summed.
- `es_verify_invoice` is the only thing the public key can call. It returns
  number, date, customer name, total, currency and issued/paid. Nothing else.
- Tokens are in their own table, so editing the invoice in the app never drops
  them. Delete or cancel every line of the invoice in the app, or set
  `revoked = true`, and the page says **cancelled**.
- `es_invoice_token(company_id, invoice_no)` is not exposed to the API; run it
  from SQL when an invoice is generated. It returns the existing token if the
  invoice already has one.
- The page is `noindex` and disallowed in `robots.txt`.
