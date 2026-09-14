/**
 * Reads the finance and procurement ledger (Daily_Transactions) and derives a
 * receivables position from it.
 *
 * Two things about the real workbook shape this module:
 *
 * 1. It is a genuine .xlsx, kept in Excel format on purpose so its formulas,
 *    validations and print layouts survive. The Sheets API cannot read it, so
 *    the file is downloaded and parsed here.
 *
 * 2. The workbook ships pre-formatted with ~15,000 blank rows and carries the
 *    currency inside the bank/cash account name rather than in its own column.
 *    Both are handled below — blank rows are discarded, and balances are kept
 *    separate per currency, because adding USD to YER produces a number that
 *    looks like money and is not.
 */

import * as XLSX from "xlsx";
import { driveDownload } from "./google.js";

const SHEET = "Daily_Transactions";

/** Currencies appear as a prefix on the account name, e.g. "USD-Kur", "YER". */
const CURRENCIES = ["USD", "SAR", "YER", "EUR", "AED"];

export async function loadLedger(fileId) {
  const { meta, buffer } = await driveDownload(fileId);
  const book = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheetName = book.SheetNames.includes(SHEET)
    ? SHEET
    : book.SheetNames.find((n) => /transaction/i.test(n));

  if (!sheetName) {
    throw new Error(
      `No transactions sheet in "${meta.name}". Looked for "${SHEET}"; ` +
        `the workbook contains: ${book.SheetNames.join(", ")}.`,
    );
  }

  const grid = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: "",
  });

  const headerIndex = grid.findIndex((row) =>
    row.some((cell) => String(cell).trim() === "Transaction ID"),
  );
  if (headerIndex === -1) {
    throw new Error(
      `Could not find the header row in "${sheetName}" — expected a cell reading "Transaction ID".`,
    );
  }

  const headers = grid[headerIndex].map((h) => String(h).trim());
  const rows = grid.slice(headerIndex + 1).map((cells) => {
    const row = {};
    headers.forEach((h, i) => {
      if (h) row[h] = cells[i] ?? "";
    });
    return row;
  });

  return { name: meta.name, sheetName, headers, rows };
}

/* ---------------------------------------------------------------- values -- */

const text = (value) => String(value ?? "").trim();

/** Blank template rows carry "0" or empty in the reference fields. */
const isPlaceholder = (value) => {
  const v = text(value);
  return v === "" || v === "0" || v === "-";
};

function amount(value) {
  if (typeof value === "number") return value;
  const cleaned = text(value).replace(/[,\s$]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function currencyOf(account) {
  const upper = text(account).toUpperCase();
  return CURRENCIES.find((c) => upper.startsWith(c)) ?? "unspecified";
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/** Case and spacing vary between entries, so group names case-insensitively. */
const normaliseName = (name) => text(name).replace(/\s+/g, " ").toUpperCase();

const daysBetween = (from, to) => Math.floor((to - from) / 86_400_000);

/* ------------------------------------------------------------- analysis -- */

/**
 * @param {object[]} rows      parsed Daily_Transactions rows
 * @param {Date}     asOf      date to age invoices against
 * @param {string}   [only]    restrict to one customer (matched loosely)
 */
export function analyseReceivables(rows, asOf = new Date(), only = null, ownNames = []) {
  const excluded = new Map();
  const isNotACustomer = (name) => {
    const n = normaliseName(name);
    if (/INTERNAL\s*TRANSFER|INTRENAL/.test(n)) return "internal transfer";
    if (ownNames.some((own) => own && n.includes(normaliseName(own)))) return "own company";
    return null;
  };

  const customers = new Map();
  const openInvoices = [];
  let realRows = 0;
  let blankRows = 0;
  let invoiceRows = 0;
  let paymentRows = 0;
  let missingCurrency = 0;
  let invoicesWithoutReference = 0;

  for (const row of rows) {
    const customerRaw = text(row["Customer"]);
    const debit = amount(row["Debit (Money Out)"]);
    const credit = amount(row["Credit (Money In)"]);

    if (isPlaceholder(row["Transaction ID"]) || (isPlaceholder(customerRaw) && !debit && !credit)) {
      blankRows++;
      continue;
    }
    if (isPlaceholder(customerRaw)) {
      blankRows++;
      continue;
    }
    if (!debit && !credit) {
      blankRows++;
      continue;
    }

    realRows++;

    // A receivables report is about customers. Money moved between our own
    // accounts is not a debt anyone owes us, so it is set aside — and counted,
    // so the exclusion is visible rather than silent.
    const excludeReason = isNotACustomer(customerRaw);
    if (excludeReason) {
      excluded.set(customerRaw, excludeReason);
      continue;
    }

    const key = normaliseName(customerRaw);
    if (only && !key.includes(normaliseName(only))) continue;

    const currency = currencyOf(row["Bank / Cash Account"]);
    if (currency === "unspecified") missingCurrency++;

    if (!customers.has(key)) {
      customers.set(key, {
        name: customerRaw,
        aliases: new Set([customerRaw]),
        currencies: {},
        invoices: 0,
        payments: 0,
      });
    }
    const entry = customers.get(key);
    entry.aliases.add(customerRaw);

    const bucket = (entry.currencies[currency] ??= { invoiced: 0, received: 0 });

    const docType = text(row["Document Type"]).toLowerCase();
    const type = text(row["Transaction Type"]).toLowerCase();
    const isCustomerInvoice =
      docType === "customer invoice" || type === "invoice out";

    if (isCustomerInvoice) {
      invoiceRows++;
      entry.invoices++;
      // Invoices are entered as Debit in practice (money owed to us).
      bucket.invoiced += debit || credit;

      const status = text(row["Status"]);
      const settled = /^(paid|closed)$/i.test(status);
      if (!isPlaceholder(row["Reference No"])) {
        // reference present — per-invoice matching is possible
      } else {
        invoicesWithoutReference++;
      }
      if (!settled) {
        const date = parseDate(row["Transaction Date"]);
        openInvoices.push({
          customer: customerRaw,
          reference: text(row["Reference No"]) || text(row["Notes"]) || "(no reference)",
          date: date ? date.toISOString().slice(0, 10) : "(no date)",
          ageDays: date ? daysBetween(date, asOf) : null,
          currency,
          amount: debit || credit,
          status: status || "(blank)",
        });
      }
    } else if (credit) {
      paymentRows++;
      entry.payments++;
      bucket.received += credit;
    } else if (debit) {
      entry.payments++;
      bucket.received -= debit;
    }
  }

  const list = [...customers.values()]
    .map((entry) => ({
      name: entry.name,
      aliases: [...entry.aliases],
      invoices: entry.invoices,
      payments: entry.payments,
      currencies: Object.fromEntries(
        Object.entries(entry.currencies).map(([code, v]) => [
          code,
          { ...v, net: round(v.invoiced - v.received) },
        ]),
      ),
    }))
    .sort((a, b) => b.invoices - a.invoices || b.payments - a.payments);

  openInvoices.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));

  return {
    asOf: asOf.toISOString().slice(0, 10),
    totals: { realRows, blankRows, invoiceRows, paymentRows },
    customers: list,
    openInvoices,
    quality: buildWarnings({
      realRows,
      invoiceRows,
      paymentRows,
      missingCurrency,
      invoicesWithoutReference,
      customers: list,
      excluded,
    }),
  };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * Names the specific reasons the figures cannot be trusted as a receivables
 * ageing. The agent is instructed to repeat these rather than present a total
 * as if it were the amount owed.
 */
function buildWarnings(stats) {
  const warnings = [];

  if (stats.invoiceRows === 0) {
    warnings.push(
      "No customer invoices are recorded in the ledger at all, so nothing can be said about what is owed.",
    );
  } else if (stats.paymentRows > stats.invoiceRows * 3) {
    warnings.push(
      `Only ${stats.invoiceRows} customer invoices are recorded against ${stats.paymentRows} payments. ` +
        "Most invoices issued were never entered, so any net balance below understates what customers owe " +
        "and must not be presented as a receivables figure.",
    );
  }

  if (stats.invoicesWithoutReference > 0) {
    warnings.push(
      `${stats.invoicesWithoutReference} invoice rows carry no Reference No, so payments cannot be matched ` +
        "to the invoices they settle. Per-invoice ageing is not possible until invoice numbers are entered.",
    );
  }

  if (stats.missingCurrency > 0) {
    warnings.push(
      `${stats.missingCurrency} rows have no recognisable currency in the Bank / Cash Account column. ` +
        "Their amounts are grouped under 'unspecified' and are not added to any currency total.",
    );
  }

  if (stats.excluded?.size) {
    warnings.push(
      "Excluded from the customer list as not receivables: " +
        [...stats.excluded.entries()].map(([n, why]) => `${n} (${why})`).join("; ") + ".",
    );
  }

  const variants = stats.customers.filter((c) => c.aliases.length > 1);
  if (variants.length) {
    warnings.push(
      "Customer names are spelled inconsistently and were grouped: " +
        variants.map((c) => c.aliases.join(" / ")).join("; ") + ".",
    );
  }

  warnings.push(
    "Balances are kept separate per currency. Never add USD, SAR and YER figures together.",
  );

  return warnings;
}

/** Renders the analysis as text for the agent to read and quote from. */
export function formatReceivables(report) {
  const lines = [`Receivables position as at ${report.asOf}`, ""];

  lines.push(
    `Ledger rows: ${report.totals.realRows} real ` +
      `(${report.totals.blankRows} blank template rows ignored) — ` +
      `${report.totals.invoiceRows} customer invoices, ${report.totals.paymentRows} payments.`,
    "",
  );

  if (report.openInvoices.length) {
    lines.push("Recorded invoices not marked Paid or Closed:");
    for (const inv of report.openInvoices) {
      lines.push(
        `  ${inv.customer} — ${inv.currency} ${inv.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` +
          ` — ${inv.date}` +
          (inv.ageDays == null ? "" : ` (${inv.ageDays} days old)`) +
          ` — status ${inv.status} — ref ${inv.reference}`,
      );
    }
  } else {
    lines.push("No recorded invoices are outstanding by Status.");
  }
  lines.push("");

  lines.push("Per customer, per currency (invoiced − received):");
  for (const c of report.customers) {
    const parts = Object.entries(c.currencies)
      .map(([code, v]) => `${code} ${v.net.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)
      .join("; ");
    lines.push(`  ${c.name} — ${parts}  [${c.invoices} invoices, ${c.payments} payments]`);
  }
  lines.push("");

  lines.push("DATA QUALITY — state these limits whenever you quote a figure from this report:");
  for (const w of report.quality) lines.push(`  - ${w}`);

  return lines.join("\n");
}
