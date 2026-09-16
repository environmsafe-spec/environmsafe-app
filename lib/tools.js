/**
 * Tool definitions and dispatch for the EnvironmSafe agent.
 *
 * A tool result may return `extraContent` — content blocks (PDF pages, images)
 * appended to the same user turn so Claude can actually look at the document.
 */

import {
  driveSearch, driveRead, driveUpload,
  driveListChildren, driveDescendantFolderIds, driveFindOrCreateFolder,
  sheetRead, sheetAppend,
  gmailSearch, gmailRead, gmailDraft,
} from "./google.js";
import { renderDocument } from "./documents.js";
import { loadLedger, analyseReceivables, formatReceivables } from "./ledger.js";
import {
  WORKFLOW_FOLDERS, customersRootId, ledgerFileId, company,
} from "./knowledge.js";

/**
 * A deal folder is named "<number> <customer>" — "161 YCII Food Oil Refinery".
 * The number is the company's own deal sequence and is how staff refer to a job,
 * so it is worth pulling out rather than leaving the caller to parse titles.
 */
function describeDeal(folder) {
  const match = /^(\d{2,4})\s+(.*)$/.exec(folder.name.trim());
  return {
    id: folder.id,
    name: folder.name,
    number: match ? match[1] : null,
    customer: match ? match[2] : folder.name,
    modifiedTime: folder.modifiedTime,
    webViewLink: folder.webViewLink,
  };
}

/** Resolves where a generated document should be filed. */
async function resolveDestination(input) {
  if (input.folder_id) return { id: input.folder_id, label: "the folder you named" };

  if (!input.deal_folder_id || !input.workflow_folder) {
    throw new Error(
      "Say where to file this: either folder_id, or deal_folder_id together with " +
        "workflow_folder (one of the standard names, e.g. '04 Quotations Out').",
    );
  }

  // Find-or-create, because the older deals predate the ten-folder convention
  // and filing a quotation should not fail on a folder that was never made.
  const folder = await driveFindOrCreateFolder({
    name: input.workflow_folder,
    parentId: input.deal_folder_id,
  });
  return {
    id: folder.id,
    label: `"${folder.name}"${folder.created ? " (created just now)" : ""}`,
  };
}

export const TOOLS = [
  {
    name: "list_deals",
    description:
      "List the deal folders. Each deal — one customer job — has its own folder named " +
      "\"<number> <customer>\", and all of that job's paperwork lives inside it. Start here " +
      "when the user names a customer or a deal number, then use open_deal on the match.",
    input_schema: {
      type: "object",
      properties: {
        match: {
          type: "string",
          description:
            "Filter by deal number or part of the customer name, case-insensitive. " +
            "Omit to list every deal.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "open_deal",
    description:
      "Show what is inside one deal folder: its subfolders and what each holds. This is how " +
      "you work out which stage a deal has reached — an RFQ in with no quotation out means " +
      "the quotation has not been sent. Most deals use the standard subfolders, but older " +
      "ones have their own names, so read what is actually there rather than assuming.",
    input_schema: {
      type: "object",
      properties: {
        deal_folder_id: { type: "string", description: "From list_deals." },
      },
      required: ["deal_folder_id"],
      additionalProperties: false,
    },
  },
  {
    name: "drive_list",
    description:
      "List what is directly inside any Drive folder. Use it to go a level deeper than " +
      "open_deal, or to check a folder before choosing the next document number.",
    input_schema: {
      type: "object",
      properties: {
        folder_id: { type: "string" },
        limit: { type: "integer", description: "Maximum entries (default 100)." },
      },
      required: ["folder_id"],
      additionalProperties: false,
    },
  },
  {
    name: "drive_search",
    description:
      "Search Drive for documents by name or full-text content. Scope it whenever you can: " +
      "`deal_folder_id` searches one deal and everything filed under it, `folder_id` searches " +
      "a single folder. Unscoped searches cover the whole company Drive and are slower and " +
      "noisier. Note that scanned documents hold no searchable text — if a search finds " +
      "nothing, list the folder and read the files.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for in the file name or contents." },
        deal_folder_id: { type: "string", description: "Search this deal and its subfolders." },
        folder_id: { type: "string", description: "Search only this one folder." },
        limit: { type: "integer", description: "Maximum files to return (default 20)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drive_read",
    description:
      "Read one Drive file by its ID. Google Docs and Sheets come back as text, PDFs and " +
      "images come back as the document itself so you can read them directly. Always read " +
      "the source document before quoting a figure from it.",
    input_schema: {
      type: "object",
      properties: { file_id: { type: "string" } },
      required: ["file_id"],
      additionalProperties: false,
    },
  },
  {
    name: "drive_save",
    description:
      "Save a text or HTML file to a Drive folder. Use this to file a generated quotation " +
      "or invoice in the correct workflow folder.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name including extension." },
        deal_folder_id: { type: "string", description: "The deal to file it under." },
        workflow_folder: {
          type: "string",
          enum: WORKFLOW_FOLDERS,
          description: "Which subfolder of that deal. Created if the deal does not have it yet.",
        },
        folder_id: { type: "string", description: "File straight into this folder instead." },
        content: { type: "string" },
        mime_type: { type: "string", description: "Defaults to text/html." },
      },
      required: ["name", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "create_document",
    description:
      "Build a quotation, proforma invoice or invoice in the EnvironmSafe house layout and " +
      "file it in Drive. Every figure must come from a source you have actually read — never " +
      "estimate a price or a quantity. Returns a link the user can open and print to PDF.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["QUOTATION", "PROFORMA INVOICE", "INVOICE"] },
        number: { type: "string", description: "Q-YYYYMMDDNN or INV-YYYYMMDDNN. Check the folder first for the next free sequence." },
        date: { type: "string", description: "YYYY-MM-DD." },
        bill_to: {
          type: "object",
          properties: {
            name: { type: "string" },
            contact: { type: "string" },
            address: { type: "string" },
            customerId: { type: "string" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              unit: { type: "string", description: "PC, SET, LOT, LTR..." },
              qty: { type: "number" },
              unitPrice: { type: "number" },
            },
            required: ["description", "qty", "unitPrice"],
            additionalProperties: false,
          },
        },
        charges: {
          type: "object",
          properties: {
            discount: { type: "number" },
            insurance: { type: "number" },
            shipping: { type: "number" },
            vatRate: { type: "number", description: "0.05 for 5%. Use 0 when VAT does not apply." },
          },
          additionalProperties: false,
        },
        terms: { type: "array", items: { type: "string" }, description: "Overrides the standard terms." },
        note: { type: "string" },
        deal_folder_id: { type: "string", description: "The deal this belongs to, from list_deals." },
        workflow_folder: {
          type: "string",
          enum: WORKFLOW_FOLDERS,
          description: "Where to file it inside that deal. Quotations you issue → '04 Quotations Out'; invoices you issue → '06 Invoices Out'.",
        },
        folder_id: { type: "string", description: "File straight into this folder instead of resolving one." },
      },
      required: ["kind", "number", "date", "bill_to", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "receivables_report",
    description:
      "Work out the receivables position from the finance ledger: which recorded invoices are " +
      "still open and how old they are, and each customer's balance per currency. " +
      "The report ends with a DATA QUALITY section naming the limits of the underlying data — " +
      "you must repeat those limits whenever you quote a figure from it, and you must never " +
      "present a balance as 'the amount owed' if the report says invoices are under-recorded.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Restrict to one customer. Omit for all." },
        file_id: { type: "string", description: "Override the configured ledger workbook." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "sheet_read",
    description:
      "Read a range from a native Google Sheet, using A1 notation (e.g. 'Sheet1!A1:M200'). " +
      "This does NOT work on the finance ledger, which is a real .xlsx file — use " +
      "receivables_report for that, or drive_read to inspect other spreadsheets.",
    input_schema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string" },
      },
      required: ["spreadsheet_id", "range"],
      additionalProperties: false,
    },
  },
  {
    name: "sheet_append",
    description:
      "Append rows to a Google Sheet, for example logging a new procurement or a received " +
      "payment. Read the header row first so your columns line up.",
    input_schema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "Sheet name or range marking where to append." },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
      },
      required: ["spreadsheet_id", "range", "rows"],
      additionalProperties: false,
    },
  },
  {
    name: "gmail_search",
    description:
      "Search the company mailbox using Gmail search syntax " +
      "(e.g. 'from:example.org newer_than:30d', 'subject:RFQ has:attachment').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "gmail_read",
    description: "Read one email in full, including its body and the list of attachments.",
    input_schema: {
      type: "object",
      properties: { message_id: { type: "string" } },
      required: ["message_id"],
      additionalProperties: false,
    },
  },
  {
    name: "gmail_draft",
    description:
      "Prepare an email draft in the company mailbox for a person to review and send. " +
      "This never sends anything. Use it for supplier RFQs, customer quotations, payment " +
      "reminders and new-customer outreach alike.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        cc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        thread_id: { type: "string", description: "Set when replying, to keep the draft in the same thread." },
        in_reply_to: { type: "string", description: "Message-ID header of the email being replied to." },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
];

export async function executeTool(name, input) {
  switch (name) {
    case "list_deals": {
      const folders = await driveListChildren(customersRootId(), { foldersOnly: true, limit: 500 });
      const deals = folders.map(describeDeal);

      const needle = (input.match ?? "").trim().toLowerCase();
      const shown = needle
        ? deals.filter(
            (d) => d.name.toLowerCase().includes(needle) || d.number === needle,
          )
        : deals;

      if (!shown.length) {
        return {
          text: needle
            ? `No deal folder matches "${input.match}". There are ${deals.length} deals in total; ` +
              `call list_deals with no filter to see them.`
            : "The customers folder has no deal folders in it.",
        };
      }

      return {
        text:
          `${shown.length} deal folder(s)${needle ? ` matching "${input.match}"` : ""}:\n\n` +
          shown
            .map((d) => `${d.name}\n  deal_folder_id: ${d.id}\n  last change: ${d.modifiedTime}`)
            .join("\n\n"),
      };
    }

    case "open_deal": {
      const entries = await driveListChildren(input.deal_folder_id, { limit: 200 });
      if (!entries.length) return { text: "That deal folder is empty." };

      const folders = entries.filter((e) => e.mimeType.endsWith(".folder"));
      const loose = entries.filter((e) => !e.mimeType.endsWith(".folder"));

      // What each subfolder holds is the whole point — an empty "04 Quotations
      // Out" is the answer to "have we quoted them yet?".
      const contents = await Promise.all(
        folders.map((f) => driveListChildren(f.id, { limit: 50 })),
      );

      const sections = folders.map((f, i) => {
        const kids = contents[i];
        if (!kids.length) return `${f.name}\n  (empty)`;
        return (
          `${f.name}  —  ${kids.length} item(s)\n` +
          kids.map((k) => `  - ${k.name}\n      id: ${k.id}`).join("\n")
        );
      });

      if (loose.length) {
        sections.push(
          "Files sitting directly in the deal folder:\n" +
            loose.map((k) => `  - ${k.name}\n      id: ${k.id}`).join("\n"),
        );
      }

      return { text: sections.join("\n\n") };
    }

    case "drive_list": {
      const entries = await driveListChildren(input.folder_id, { limit: input.limit ?? 100 });
      if (!entries.length) return { text: "That folder is empty." };
      return {
        text: entries
          .map((f) => {
            const kind = f.mimeType.endsWith(".folder") ? "folder" : f.mimeType;
            return `${f.name}\n  id: ${f.id}\n  type: ${kind}\n  modified: ${f.modifiedTime}`;
          })
          .join("\n\n"),
      };
    }

    case "drive_search": {
      let folderIds;
      if (input.deal_folder_id) {
        folderIds = await driveDescendantFolderIds(input.deal_folder_id, 2);
      } else if (input.folder_id) {
        folderIds = [input.folder_id];
      }

      const files = await driveSearch({
        query: input.query,
        folderIds,
        limit: input.limit ?? 20,
      });
      if (!files.length) {
        return {
          text:
            "No matching files. Scanned documents carry no searchable text, so if you " +
            "expected something here, list the folder and read the files instead.",
        };
      }
      return {
        text: files
          .map(
            (f) =>
              `${f.name}\n  id: ${f.id}\n  type: ${f.mimeType}\n  modified: ${f.modifiedTime}\n  link: ${f.webViewLink}`,
          )
          .join("\n\n"),
      };
    }

    case "drive_read": {
      const file = await driveRead(input.file_id);
      const header = `File: ${file.meta.name} (${file.meta.mimeType})\nLink: ${file.meta.webViewLink}`;

      if (file.kind === "pdf") {
        return {
          text: `${header}\n\nThe PDF is attached below.`,
          extraContent: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: file.base64 },
            },
          ],
        };
      }
      if (file.kind === "image") {
        return {
          text: `${header}\n\nThe image is attached below.`,
          extraContent: [
            {
              type: "image",
              source: { type: "base64", media_type: file.meta.mimeType, data: file.base64 },
            },
          ],
        };
      }
      return { text: `${header}\n\n${truncate(file.text, 100_000)}` };
    }

    case "drive_save": {
      const destination = await resolveDestination(input);
      const saved = await driveUpload({
        name: input.name,
        folderId: destination.id,
        mimeType: input.mime_type ?? "text/html",
        content: input.content,
      });
      return { text: `Saved to ${destination.label}.\nLink: ${saved.webViewLink}` };
    }

    case "create_document": {
      const html = renderDocument({
        kind: input.kind,
        number: input.number,
        date: input.date,
        billTo: input.bill_to,
        items: input.items,
        charges: input.charges,
        terms: input.terms,
        note: input.note,
      });
      const destination = await resolveDestination(input);
      const saved = await driveUpload({
        name: `${input.number} ${input.bill_to.name}.html`,
        folderId: destination.id,
        mimeType: "text/html",
        content: html,
      });
      // Mirror the renderer's cents arithmetic so the figure reported back to
      // the user matches the figure printed on the document.
      const subtotalCents = input.items.reduce(
        (sum, it) => sum + Math.round(Number(it.qty || 0) * Math.round(Number(it.unitPrice || 0) * 100)),
        0,
      );
      return {
        text:
          `${input.kind} ${input.number} created and filed in ${destination.label}.\n` +
          `Line-item subtotal: $${(subtotalCents / 100).toFixed(2)} across ${input.items.length} item(s).\n` +
          `Open and print to PDF: ${saved.webViewLink}`,
      };
    }

    case "receivables_report": {
      const ledger = await loadLedger(input.file_id ?? ledgerFileId());
      const co = company();
      const report = analyseReceivables(
        ledger.rows,
        new Date(),
        input.customer ?? null,
        [co.tradingName, co.legalName].filter(Boolean),
      );
      return {
        text: `Source: ${ledger.name} — sheet "${ledger.sheetName}".\n\n${formatReceivables(report)}`,
      };
    }

    case "sheet_read": {
      const values = await sheetRead({
        spreadsheetId: input.spreadsheet_id,
        range: input.range,
      });
      if (!values.length) return { text: "That range is empty." };
      return { text: truncate(values.map((r) => r.join(" | ")).join("\n"), 80_000) };
    }

    case "sheet_append": {
      const result = await sheetAppend({
        spreadsheetId: input.spreadsheet_id,
        range: input.range,
        rows: input.rows,
      });
      return { text: `Appended ${input.rows.length} row(s). Updated range: ${result.updates?.updatedRange ?? "unknown"}.` };
    }

    case "gmail_search": {
      const messages = await gmailSearch({ query: input.query, limit: input.limit ?? 10 });
      if (!messages.length) return { text: "No matching email." };
      return {
        text: messages
          .map(
            (m) =>
              `${m.subject || "(no subject)"}\n  id: ${m.id}\n  from: ${m.from}\n  date: ${m.date}\n  ${m.snippet}`,
          )
          .join("\n\n"),
      };
    }

    case "gmail_read": {
      const mail = await gmailRead(input.message_id);
      const attachments = mail.attachments.length
        ? `\nAttachments: ${mail.attachments.map((a) => a.filename).join(", ")}`
        : "";
      return {
        text:
          `From: ${mail.from}\nTo: ${mail.to}\nDate: ${mail.date}\n` +
          `Subject: ${mail.subject}${attachments}\n\n${truncate(mail.body, 60_000)}`,
      };
    }

    case "gmail_draft": {
      const draft = await gmailDraft({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        body: input.body,
        threadId: input.thread_id,
        inReplyTo: input.in_reply_to,
      });
      return {
        text:
          `Draft saved in Gmail (id ${draft.id}) addressed to ${input.to}. ` +
          `It has NOT been sent — review it in the Drafts folder and send it yourself.`,
      };
    }

    default:
      return { text: `Unknown tool: ${name}`, isError: true };
  }
}

function truncate(text, limit) {
  const str = String(text ?? "");
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}\n\n[...truncated at ${limit} characters. Narrow the range or search to see more.]`;
}
