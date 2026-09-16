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

/**
 * The workflow folders that appear *inside a deal folder*.
 *
 * These are names, not locations. The filing system is one folder per deal —
 * "161 YCII Food Oil Refinery", "166 Block 52 OMV" — and the deal folder is
 * what carries these ten subfolders. There is no single global "04 Quotations
 * Out"; there is one per deal, so a folder is only ever resolved relative to a
 * deal. Older deals predate the convention and use their own names instead,
 * which is why nothing here may be assumed to exist: look, then act.
 */
export const WORKFLOW_FOLDERS = [
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
  drive: {
    rootId: "",
    customersRootId: "",
    templatesId: "",
  },
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
      drive: { ...DEFAULT_PROFILE.drive, ...(loaded.drive ?? {}) },
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

/** Drive folder holding one subfolder per deal. The agent's main entry point. */
export function customersRootId() {
  const id = profile().drive?.customersRootId;
  if (!id) {
    throw new Error(
      "No customers folder configured. Add ES_PROFILE.drive.customersRootId (the Drive " +
        "folder ID of CUSTOMERS, which holds one folder per deal) — see AGENT_SETUP.md.",
    );
  }
  return id;
}

/** Top of the company Drive, for searches that are not tied to one deal. */
export function driveRootId() {
  return profile().drive?.rootId || "";
}

/** Folder of blank house-format documents, if one is configured. */
export function templatesId() {
  return profile().drive?.templatesId || "";
}
