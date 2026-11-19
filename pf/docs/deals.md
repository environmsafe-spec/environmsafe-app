# Deals: from the customer's request to the payment

A **deal** follows one customer enquiry through every step. It is the same idea as Odoo's
"Sales order → Purchase (make to order / drop-ship)", SAP Business One's "Sales quotation → Sales order →
Purchase order (base document / copy to)", and NetSuite's "Special order / drop-ship PO".

```
Customer request ─► RFQs to suppliers ─► Supplier offers ─► (compare) ─► Quotation (+ margin)
       │                                                                  │
       └──────────────────────► Customer order (their PO) ◄───────────────┘
                                     │
          ┌──────────────────────────┼─────────────────────────┐
          ▼                          ▼                         ▼
   Purchase order(s)          Delivery note(s)           Sales invoice(s) ─► Customer receipt
   (one or many suppliers)          │                          ▲
          │                         └──────────────────────────┘
          ▼
   Goods receipt(s) ─► Supplier bill(s) ─► Supplier payment(s)
   + costs on the deal: freight, customs, clearing, subcontractors (Expense with the deal's project)
```

**Every step is optional.** For example:
- A service job can go straight from a quotation to an invoice.
- An urgent order can start with the customer's PO.
- A small purchase can skip the RFQ.

## How to use it
1. **Deals → New deal**: choose the customer and say what they need. The deal is a project (`PJ-…`), so every cost and
   revenue lands on it, and the Project P&L report shows its profit.
2. **Customer request**: type what the customer asked for (an item from the catalogue, or just a description), then
   **Save & issue** (`REQ-2026-0001`).
3. On any issued document, click **Next step** and choose what to make:
   - **Make RFQ**: choose the supplier. Make one RFQ per supplier; each gets every line in full.
   - **Enter supplier offer** (from the RFQ): type the supplier's prices, in their currency.
   - **Make quotation**: on the deal page, *Offers compared* lists each line's offers, cheapest first in USD.
     - Choose one offer per line (lines may come from different suppliers).
     - Enter the margin and click *Make quotation from the chosen offers*.
     - Each quoted line shows its cost and margin.
   - **Customer order**: when the customer sends their PO (enter it under *Their reference*).
   - **Make purchase order** (from the customer order): choose the lines and the supplier.
     - The price comes from that supplier's offer, in that supplier's currency.
     - To **split an order**, make one PO per supplier. A line can be split too: change the quantity on the first PO,
       and the next PO takes only what is still open.
   - **Receive goods** (from a PO): change the quantities for a partial receipt.
   - **Make supplier bill** (from the receipt or the PO).
     - The bill warns when it does not match the PO and the receipt: billed more than received or ordered, or a different price.
   - **Make delivery note** and **Make invoice**: partial deliveries and invoices work the same way.
     - Nothing can be received, delivered, invoiced or billed twice.
4. **Advances**:
   - Pay a supplier (or receive from a customer) before the bill / invoice exists, as usual.
   - When the bill / invoice is posted, open the payment and click **Apply** next to it.
5. **Costs of the deal** (freight, customs, clearing, inspection, subcontractor):
   - On the deal page, choose *Other document → Cost*.
   - The lines are charged to the deal.
6. **Close the deal**:
   - **Won**: when everything is invoiced, received and paid. Otherwise it lists what is still open; you can still close
     with a note.
   - **Lost / Cancelled**: with the reason, so wins and losses can be analysed later.
   - A closed deal can be reopened.

## What the deal page shows
- **Stage**: Request → RFQs sent → Offers in → Quoted → Ordered → Purchasing → Received → Delivered → Invoiced → Paid.
- **Money**:
  - ordered, invoiced, still to receive;
  - supplier bills, still to pay;
  - revenue, costs (incl. freight and customs), profit and profit %.
- **Documents**: every document of the deal in the order it happened, including payments and costs.
- **Offers compared** (when there are offers).
- **Progress of each ordered line**: bought / received / delivered / invoiced / billed.
  - green = done, orange = part, red = not yet.

## Not in this version (can be added)
- A supplier credit note / return to supplier. For now: a supplier refund, or a corrected bill.
- Applying an advance to a bill at a *different* exchange rate. For now the accountant records the FX difference.
  USD deals are not affected.
- Revisions of a customer order. Revisions work for quotations and POs.
- Stock / warehouse: goods are bought for the deal and go straight to the customer (back-to-back), so no inventory is kept.

## Tests
- Database:
  - `db/tests/15_deals.sql`: scenarios A/B, split order across 3 suppliers in USD/SAR.
  - `db/tests/16_deal_scenarios.sql`: C advance + landed costs, D partial + customer advance, E service, F lost, G return + mismatched bill.
- Browser (local copy, never live data): `web/e2e/deal-flow.mjs` drives scenario B through the real screens.
