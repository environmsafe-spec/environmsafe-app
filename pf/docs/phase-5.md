# Phase 5: Upload voucher (AI), batch mode, recurring templates (demo note)

## What was built
**Upload voucher** (Home → Upload voucher, or the camera on a phone)
- Take a photo or pick several files: bank slips, remittance receipts, supplier invoices, shop receipts, in Arabic or English, JPEG/PNG/PDF up to 10 MB.
- Each file is stored in the private bucket, then the `extract-voucher` Supabase function sends it to **Claude Sonnet** (`claude-sonnet-5-5`, the latest Sonnet, per the spec). The API key is only on the server.
- The answer comes back in a fixed JSON shape, validated: kind, date, currency, amount, fee, reference, counterparty, bank, account number, invoice number, lines, confidence.
- The app then **matches** it to your data (`supabase/functions/_shared/voucher.ts`):
  - **Party** by name, English or Arabic (أ/ا, ة/ه, ى/ي, "Al-", "شركة", "Co." are ignored).
  - **Bank account** by the last 4 digits of the account number, or by bank name plus currency.
  - **Open bill or invoice** with the same amount or invoice number, linked so the payment settles it.
  - **Items** on supplier-invoice lines.
- The result is a **draft**:
  - payment to a supplier → supplier payment; money in → customer receipt; supplier invoice → bill with lines;
  - transfer → transfer; anything else → expense to complete.
- **The file is attached automatically** (with SHA-256), and the extraction is logged.
- **Nothing is ever posted automatically.** The draft shows the voucher **side by side** with the form, plus a yellow box listing what still needs a human (e.g. "No item matches 'Freight': pick one or add it").
- **Batch mode:** upload a stack, then "Review the N drafts one by one", with Previous / Next voucher.

**Recurring templates**
- On any posted payment, salary, expense, etc.: **Make monthly** (name + day of month).
- Settings → Recurring documents: list, change the day, pause or delete, and **Create drafts for this month**. Each active template gets one draft copy (lines included, dated on its day, marked "recurring"). Running it twice in a month creates nothing new. Drafts are never posted automatically.

## How it was tested
- **272 database tests** (9 new): recurring drafts are created once per month, belong to the person who created them, copy the lines, and land on the right day; extraction log rules; company isolation.
- **58 unit tests** (web), including 9 for voucher matching:
  - a payment slip settles the matching open bill;
  - an Arabic UNHCR receipt matches the open invoice;
  - currency picks the right Kuraimi account (USD vs YER);
  - a supplier invoice becomes bill lines, with unknown items flagged;
  - unreadable values are never guessed.
- **Both Supabase functions typecheck** against the real Anthropic SDK and Supabase client types.
- **Browser run** (7 checks passed, no page errors): two vouchers uploaded (a bank-transfer slip image and a supplier invoice) → two drafts. The slip matched supplier, Kuraimi USD, 404.25 + 3 fee, and is shown next to the form. The invoice matched the supplier from its **Arabic name** and the PSV item, and the freight line was flagged. Nothing was posted.
  - *Local limit:* there is no storage, function runtime or Claude key in this workspace, so the test answers those two calls itself. It runs the **real matching code** against the demo database with a fixed "what the AI read" answer. The Claude call itself is exercised only once the hosted project exists (next section).

## To switch it on (hosting step)
1. Deploy `supabase/functions/extract-voucher` and `generate-pdf`.
2. Set the secret `ANTHROPIC_API_KEY` (your Anthropic Console key) on the Edge Functions.
3. Spec acceptance test: try 20 real vouchers and note what was right or wrong. I'll adjust the instructions to the AI from that.

Cost estimate: one voucher is roughly 1–2 thousand input tokens for a photo plus a short answer. At Sonnet prices that is well under 1 US cent per voucher.
