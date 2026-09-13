/**
 * Tool definitions and dispatch for the EnvironmSafe agent.
 *
 * A tool result may return `extraContent` — content blocks (PDF pages, images)
 * appended to the same user turn so Claude can actually look at the document.
 */

import {
  driveSearch, driveRead, driveUpload,
  sheetRead, sheetAppend,
  gmailSearch, gmailRead, gmailDraft,
} from "./google.js";
import { renderDocument } from "./documents.js";
import { FOLDER_NAMES, folderId } from "./knowledge.js";

const folderNames = FOLDER_NAMES;

export const TOOLS = [
  {
    name: "drive_search",
    description:
      "Search the company Google Drive for documents by name or full-text content. " +
      "Use `folder` to restrict the search to one stage of the procurement workflow — " +
      "that is almost always what you want, and it is much faster than searching everything.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for in the file name or contents. Omit to list a whole folder." },
        folder: { type: "string", enum: folderNames, description: "Restrict to this workflow folder." },
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
        folder: { type: "string", enum: folderNames },
        content: { type: "string" },
        mime_type: { type: "string", description: "Defaults to text/html." },
      },
      required: ["name", "folder", "content"],
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
        folder: { type: "string", enum: folderNames, description: "Where to file it. Quotations OUT → '04 Quotations Out'; invoices OUT → '06 Invoices Out'." },
      },
      required: ["kind", "number", "date", "bill_to", "items", "folder"],
      additionalProperties: false,
    },
  },
  {
    name: "sheet_read",
    description:
      "Read a range from a Google Sheet — the finance and procurement ledger lives in one. " +
      "Use A1 notation, e.g. 'Transactions!A1:M200'.",
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
    case "drive_search": {
      const files = await driveSearch({
        query: input.query,
        folderId: input.folder ? folderId(input.folder) : undefined,
        limit: input.limit ?? 20,
      });
      if (!files.length) return { text: "No matching files." };
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
      const saved = await driveUpload({
        name: input.name,
        folderId: folderId(input.folder),
        mimeType: input.mime_type ?? "text/html",
        content: input.content,
      });
      return { text: `Saved to "${input.folder}".\nLink: ${saved.webViewLink}` };
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
      const saved = await driveUpload({
        name: `${input.number} ${input.bill_to.name}.html`,
        folderId: folderId(input.folder),
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
          `${input.kind} ${input.number} created and filed in "${input.folder}".\n` +
          `Line-item subtotal: $${(subtotalCents / 100).toFixed(2)} across ${input.items.length} item(s).\n` +
          `Open and print to PDF: ${saved.webViewLink}`,
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
