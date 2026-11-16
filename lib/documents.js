/**
 * Renders quotations, proforma invoices, invoices and purchase orders in the
 * EnvironmSafe house layout, as self-contained printable HTML. Saved to Drive,
 * opened in the browser, printed to PDF — no binary document library needed in
 * the function.
 */

import {
  company, DEFAULT_QUOTE_TERMS, DEFAULT_PROFORMA_TERMS, DEFAULT_INVOICE_TERMS, DEFAULT_PO_TERMS,
} from "./knowledge.js";

/**
 * All arithmetic runs in whole cents. A customer checks an invoice by adding
 * the printed line amounts, so the printed lines must sum to the printed total
 * exactly — summing unrounded floats and rounding at the end breaks that by a
 * cent or two and costs a phone call.
 */
const toCents = (value) => Math.round(Number(value || 0) * 100);
const money = (cents) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Brand colours, the same tokens as the website (public/css/styles.css). */
const NAVY = "#1B2A4A";
const AMBER = "#E3A038";

/**
 * Everything that differs between document kinds. A purchase order is the one
 * we send to a supplier, so its counterparty is a supplier rather than a
 * customer, and it carries a delivery address instead of bank details.
 */
const KINDS = {
  QUOTATION: { party: "Quotation for", terms: DEFAULT_QUOTE_TERMS, banks: false, accept: "Accepted by" },
  "PROFORMA INVOICE": { party: "Bill to", terms: DEFAULT_PROFORMA_TERMS, banks: true, accept: "Acknowledged by" },
  INVOICE: { party: "Bill to", terms: DEFAULT_INVOICE_TERMS, banks: true, accept: "Received by" },
  "PURCHASE ORDER": { party: "Supplier", terms: DEFAULT_PO_TERMS, banks: false, accept: "Accepted by supplier" },
};

/**
 * @param {object} doc
 * @param {"QUOTATION"|"PROFORMA INVOICE"|"INVOICE"|"PURCHASE ORDER"} doc.kind
 * @param {string} doc.number      e.g. "Q-2026091301"
 * @param {string} doc.date        ISO date
 * @param {object} doc.billTo      the counterparty: { name, contact, address, customerId }
 *                                 (the supplier, on a purchase order)
 * @param {Array}  doc.items       [{ description, unit, qty, unitPrice }]
 * @param {object} [doc.charges]   { discount, insurance, shipping, vatRate }
 * @param {string[]} [doc.terms]
 * @param {string} [doc.reference]     customer PO no. on an invoice, supplier quotation no. on a PO
 * @param {string} [doc.dueDate]       invoices
 * @param {string} [doc.deliveryDate]  purchase orders
 * @param {string} [doc.paymentTerms]  shown in the header, e.g. "100% advance"
 * @param {string} [doc.deliverTo]     purchase orders; defaults to the company office
 */
export function renderDocument(doc) {
  const CO = company();
  const spec = KINDS[doc.kind] ?? KINDS.QUOTATION;
  const items = doc.items ?? [];
  const charges = doc.charges ?? {};
  const site = (CO.website || "https://www.environmsafe.com").replace(/\/$/, "");
  const logo = CO.logoUrl || `${site}/img/logo.png`;

  // Round each line to cents first, then sum those rounded lines.
  const lineTotals = items.map((it) =>
    Math.round(Number(it.qty || 0) * toCents(it.unitPrice)),
  );
  const subtotal = lineTotals.reduce((sum, cents) => sum + cents, 0);

  const discount = toCents(charges.discount);
  const insurance = toCents(charges.insurance);
  const shipping = toCents(charges.shipping);
  const vatRate = charges.vatRate == null ? 0 : Number(charges.vatRate);
  const taxable = subtotal - discount + insurance + shipping;
  const vat = Math.round(taxable * vatRate);
  const total = taxable + vat;

  const terms = doc.terms?.length ? doc.terms : spec.terms;

  const rows = items
    .map(
      (it, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(it.description ?? "")}</td>
        <td class="mid">${escapeHtml(it.unit ?? "PC")}</td>
        <td class="num">${escapeHtml(String(it.qty ?? ""))}</td>
        <td class="amt">${money(toCents(it.unitPrice))}</td>
        <td class="amt">${money(lineTotals[i])}</td>
      </tr>`,
    )
    .join("");

  const chargeRow = (label, value, always = false) =>
    value || always
      ? `<tr><td class="label">${label}</td><td class="amt">${money(value)}</td></tr>`
      : "";

  const metaRow = (label, value) =>
    value ? `<tr><td>${label}</td><td>${escapeHtml(value)}</td></tr>` : "";

  // Bank details: CO.banks entries may be plain strings or
  // { bank, accountName, accountNumber, iban, swift, currency } objects.
  const banks = spec.banks ? (CO.banks ?? []) : [];
  const bankBlock = banks.length
    ? `<section class="banks">
    <h3>Bank details for payment</h3>
    ${banks.map((b) => `<div class="bank">${
      typeof b === "string"
        ? escapeHtml(b)
        : [
            b.bank && `<strong>${escapeHtml(b.bank)}</strong>${b.currency ? ` (${escapeHtml(b.currency)})` : ""}`,
            b.accountName && `Account name: ${escapeHtml(b.accountName)}`,
            b.accountNumber && `Account no.: ${escapeHtml(b.accountNumber)}`,
            b.iban && `IBAN: ${escapeHtml(b.iban)}`,
            b.swift && `SWIFT: ${escapeHtml(b.swift)}`,
          ].filter(Boolean).join("<br>")
    }</div>`).join("")}
    <p class="ref-hint">Please quote ${escapeHtml(doc.number)} as the payment reference.</p>
  </section>`
    : "";

  const isPO = doc.kind === "PURCHASE ORDER";
  const deliverTo = isPO ? (doc.deliverTo || CO.offices?.[0] || "") : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.kind)} ${escapeHtml(doc.number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; padding: 24px; background: #fff; font-size: 13px; }
  .sheet { max-width: 820px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 3px solid ${AMBER}; padding-bottom: 14px; }
  .brand { display: flex; gap: 14px; align-items: center; }
  .brand img { height: 78px; width: auto; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: .4px; color: ${NAVY}; }
  .brand p { margin: 2px 0 0; font-size: 11px; color: #475569; line-height: 1.5; }
  .doc-meta { text-align: right; white-space: nowrap; }
  .doc-meta .kind { font-size: 18px; font-weight: 700; color: ${NAVY}; letter-spacing: 1px; }
  .doc-meta table { margin-top: 8px; margin-left: auto; font-size: 12px; border-collapse: collapse; }
  .doc-meta td { padding: 2px 0 2px 14px; text-align: right; }
  .doc-meta td:first-child { color: #64748b; padding-left: 0; text-align: left; }
  .parties { display: flex; gap: 40px; margin: 20px 0 16px; }
  .parties h2 { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; margin: 0 0 5px; }
  .parties div { line-height: 1.6; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items thead th { background: ${NAVY}; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; padding: 8px 10px; text-align: left; }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  table.items tbody tr:nth-child(even) { background: #f8fafc; }
  .num, .mid { text-align: center; width: 56px; }
  .amt { text-align: right; white-space: nowrap; width: 110px; }
  .totals { margin-left: auto; margin-top: 14px; border-collapse: collapse; min-width: 290px; }
  .totals td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  .totals .label { color: #475569; }
  .totals tr.grand td { border-top: 2px solid ${AMBER}; border-bottom: none; font-weight: 700; font-size: 15px; color: ${NAVY}; padding-top: 10px; }
  .banks { margin-top: 22px; padding: 12px 14px; border: 1px solid #e2e8f0; border-left: 3px solid ${NAVY}; page-break-inside: avoid; }
  .banks h3, .terms h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; margin: 0 0 7px; }
  .bank { margin-bottom: 8px; line-height: 1.6; font-size: 12px; }
  .ref-hint { margin: 4px 0 0; font-size: 11px; color: #475569; }
  .terms { margin-top: 24px; page-break-inside: avoid; }
  .terms ol { margin: 0; padding-left: 18px; color: #475569; line-height: 1.75; font-size: 12px; }
  .sign { margin-top: 40px; display: flex; justify-content: space-between; page-break-inside: avoid; }
  .sign div { width: 45%; border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 11px; color: #475569; }
  .note { margin-top: 18px; padding: 9px 12px; background: #fdf6ea; border-left: 3px solid ${AMBER}; font-size: 12px; }
  footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @media print { body { padding: 0; } .sheet { max-width: none; } }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div class="brand">
      <img src="${escapeHtml(logo)}" alt="${escapeHtml(CO.tradingName || "Logo")}">
      <div>
        <h1>${escapeHtml(CO.legalName || CO.tradingName)}</h1>
        <p>
          ${CO.offices.map(escapeHtml).join(" &middot; ")}<br>
          ${CO.phones.map(escapeHtml).join(" &middot; ")}<br>
          ${escapeHtml(CO.email)}${CO.website ? ` &middot; ${escapeHtml(CO.website.replace(/^https?:\/\//, ""))}` : ""}
        </p>
      </div>
    </div>
    <div class="doc-meta">
      <div class="kind">${escapeHtml(doc.kind)}</div>
      <table>
        <tr><td>No.</td><td><strong>${escapeHtml(doc.number)}</strong></td></tr>
        <tr><td>Date</td><td>${escapeHtml(doc.date)}</td></tr>
        ${metaRow(isPO ? "Supplier ID" : "Customer ID", doc.billTo?.customerId)}
        ${metaRow(isPO ? "Your quotation" : "Your PO no.", doc.reference)}
        ${metaRow("Due date", doc.dueDate)}
        ${metaRow("Delivery by", doc.deliveryDate)}
        ${metaRow("Payment", doc.paymentTerms || doc.terms_label)}
      </table>
    </div>
  </header>

  <section class="parties">
    <div>
      <h2>${spec.party}</h2>
      <div>
        <strong>${escapeHtml(doc.billTo?.name ?? "")}</strong><br>
        ${doc.billTo?.contact ? `${escapeHtml(doc.billTo.contact)}<br>` : ""}
        ${doc.billTo?.address ? escapeHtml(doc.billTo.address) : ""}
      </div>
    </div>
    ${deliverTo ? `<div>
      <h2>Deliver to</h2>
      <div><strong>${escapeHtml(CO.tradingName || CO.legalName)}</strong><br>${escapeHtml(deliverTo)}</div>
    </div>` : ""}
  </section>

  <table class="items">
    <thead>
      <tr>
        <th class="num">SN</th>
        <th>Description</th>
        <th class="mid">Unit</th>
        <th class="num">Qty</th>
        <th class="amt">Unit price</th>
        <th class="amt">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    ${chargeRow("Subtotal", subtotal, true)}
    ${chargeRow("Discount", discount)}
    ${chargeRow("Insurance", insurance)}
    ${chargeRow("Shipping", shipping)}
    ${vatRate ? chargeRow(`VAT @ ${(vatRate * 100).toFixed(0)}%`, vat, true) : ""}
    <tr class="grand"><td class="label">Total (${escapeHtml(CO.currency)})</td><td class="amt">${money(total)}</td></tr>
  </table>

  ${doc.note ? `<div class="note">${escapeHtml(doc.note)}</div>` : ""}

  ${bankBlock}

  <section class="terms">
    <h3>Terms &amp; conditions</h3>
    <ol>${terms.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ol>
  </section>

  <section class="sign">
    <div>For ${escapeHtml(CO.legalName || CO.tradingName)}<br>Name &nbsp;/&nbsp; Date &nbsp;/&nbsp; Signature &amp; stamp</div>
    <div>${spec.accept} ${escapeHtml(doc.billTo?.name ?? "")}<br>Name &nbsp;/&nbsp; Date &nbsp;/&nbsp; Signature &amp; stamp</div>
  </section>

  <footer>${escapeHtml(doc.kind)} ${escapeHtml(doc.number)} &middot; ${escapeHtml(CO.legalName || CO.tradingName)}</footer>
</div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
