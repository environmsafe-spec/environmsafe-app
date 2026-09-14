import { env } from "./runtime.js";

/**
 * Company profile, loaded from the environment rather than committed.
 *
 * Drive folder IDs, the customer and supplier lists and the letterhead details
 * are operational data, not code — they belong in the hosting environment so the
 * repository stays free of anything specific to one company's filing system.
 *
 * Set ES_PROFILE to a JSON object shaped like DEFAULT_PROFILE below. See
 * AGENT_SETUP.md for the template.
 */

/** Workflow folder names. Generic labels — the IDs behind them are the private part. */
export const FOLDER_NAMES = [
  "01 RFQ In",
  "02 RFQ Out",
  "03 Quotations In",
  "04 Quotations Out",
  "05 Invoices In",
  "06 Invoices Out",
  "07 PO-Contracts In",
  "08 PO-Contracts Out",
  "09 Examples",
  "10 Others",
];

const DEFAULT_PROFILE = {
  company: {
    legalName: "",
    tradingName: "",
    offices: [],
    phones: [],
    email: "",
    website: "",
    currency: "USD",
    vatRate: 0.05,
    banks: [],
  },
  folders: {},
  ledgerFileId: "",
  customers: [],
  suppliers: [],
};

let parsed = null;

export function profile() {
  if (parsed) return parsed;

  const raw = env("ES_PROFILE");
  if (!raw) {
    parsed = DEFAULT_PROFILE;
    return parsed;
  }

  try {
    const loaded = JSON.parse(raw);
    parsed = {
      ...DEFAULT_PROFILE,
      ...loaded,
      company: { ...DEFAULT_PROFILE.company, ...(loaded.company ?? {}) },
    };
  } catch (error) {
    throw new Error(
      `ES_PROFILE is not valid JSON (${error.message}). Check the value in the Cloudflare Pages environment variables.`,
    );
  }
  return parsed;
}

/** Drive file ID of the finance & procurement ledger workbook. */
export function ledgerFileId() {
  const id = profile().ledgerFileId;
  if (!id) {
    throw new Error(
      "No ledger configured. Add ES_PROFILE.ledgerFileId (the Drive file ID of the " +
        "finance workbook) — see AGENT_SETUP.md.",
    );
  }
  return id;
}

/** Resolves a workflow folder name to its Drive ID. */
export function folderId(name) {
  const id = profile().folders?.[name];
  if (!id) {
    throw new Error(
      `No Drive folder ID configured for "${name}". Add it to ES_PROFILE.folders — see AGENT_SETUP.md.`,
    );
  }
  return id;
}
