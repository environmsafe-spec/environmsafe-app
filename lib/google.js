import { requireEnv } from "./runtime.js";

/**
 * Google Workspace access for the agent, using the company account's OAuth
 * refresh token. Credentials live in the Cloudflare environment and never
 * reach the browser.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Access tokens last an hour; cache across warm invocations. */
let cached = { token: null, expiresAt: 0 };

export async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const body = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Google token refresh failed (${res.status}). The refresh token may have been revoked — re-run the authorisation step. ${detail}`,
    );
  }

  const json = await res.json();
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

async function call(url, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google API ${res.status} on ${new URL(url).pathname}: ${detail.slice(0, 500)}`);
  }
  return res;
}

/* ---------------------------------------------------------------- Drive -- */

export async function driveSearch({ query, folderId, folderIds, limit = 20 }) {
  const clauses = ["trashed = false"];
  const parents = folderIds?.length ? folderIds : folderId ? [folderId] : [];
  if (parents.length) {
    clauses.push(`(${parents.map((id) => `'${id}' in parents`).join(" or ")})`);
  }
  if (query) {
    const safe = query.replace(/'/g, "\\'");
    clauses.push(`(name contains '${safe}' or fullText contains '${safe}')`);
  }

  const url = new URL(`${DRIVE}/files`);
  url.searchParams.set("q", clauses.join(" and "));
  url.searchParams.set("pageSize", String(Math.min(limit, 100)));
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
  );

  const res = await call(url.toString());
  const { files = [] } = await res.json();
  return files;
}

/**
 * Files directly inside one folder.
 *
 * Separate from driveSearch because listing is what this filing system mostly
 * needs: the deals live one folder deep, their paperwork one folder deeper, and
 * walking that is more reliable than guessing search terms for a scanned RFQ.
 */
export async function driveListChildren(parentId, { foldersOnly = false, limit = 200 } = {}) {
  const clauses = ["trashed = false", `'${parentId}' in parents`];
  if (foldersOnly) clauses.push("mimeType = 'application/vnd.google-apps.folder'");

  const files = [];
  let pageToken = "";
  do {
    const url = new URL(`${DRIVE}/files`);
    url.searchParams.set("q", clauses.join(" and "));
    url.searchParams.set("pageSize", String(Math.min(limit - files.length, 100)));
    url.searchParams.set("orderBy", "folder,name");
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await call(url.toString());
    const page = await res.json();
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && files.length < limit);

  return files;
}

/**
 * Every folder at or under `rootId`, down to `depth` levels.
 *
 * Drive's query language has no "anywhere under this folder" operator — only
 * "directly in these parents" — so a subtree search means collecting the
 * subtree's folder IDs first and asking about all of them at once.
 */
export async function driveDescendantFolderIds(rootId, depth = 2) {
  const seen = [rootId];
  let frontier = [rootId];

  for (let level = 0; level < depth && frontier.length; level += 1) {
    const found = await Promise.all(
      frontier.map((id) => driveListChildren(id, { foldersOnly: true })),
    );
    frontier = found.flat().map((f) => f.id).filter((id) => !seen.includes(id));
    seen.push(...frontier);
  }

  return seen;
}

/** Find a folder by exact name inside a parent, or create it. */
export async function driveFindOrCreateFolder({ name, parentId }) {
  const existing = await driveListChildren(parentId, { foldersOnly: true });
  const match = existing.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (match) return { ...match, created: false };

  const res = await call(`${DRIVE}/files?fields=id,name,mimeType,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  return { ...(await res.json()), created: true };
}

/** Native Google files export as text; everything else comes back as bytes. */
export async function driveRead(fileId) {
  const metaRes = await call(
    `${DRIVE}/files/${fileId}?fields=id,name,mimeType,size,webViewLink`,
  );
  const meta = await metaRes.json();

  if (meta.mimeType.startsWith("application/vnd.google-apps.")) {
    const exportType = meta.mimeType.includes("spreadsheet") ? "text/csv" : "text/plain";
    const res = await call(
      `${DRIVE}/files/${fileId}/export?mimeType=${encodeURIComponent(exportType)}`,
    );
    return { meta, kind: "text", text: await res.text() };
  }

  const res = await call(`${DRIVE}/files/${fileId}?alt=media`);
  const buffer = Buffer.from(await res.arrayBuffer());

  if (meta.mimeType === "application/pdf") {
    return { meta, kind: "pdf", base64: buffer.toString("base64") };
  }
  if (meta.mimeType.startsWith("image/")) {
    return { meta, kind: "image", base64: buffer.toString("base64") };
  }
  if (meta.mimeType.startsWith("text/") || meta.mimeType.includes("json")) {
    return { meta, kind: "text", text: buffer.toString("utf8") };
  }
  return {
    meta,
    kind: "unsupported",
    text:
      `This file is ${meta.mimeType}, which cannot be read directly. ` +
      `Ask the user to save it as PDF or Google Sheets, or open it at ${meta.webViewLink}.`,
  };
}

/**
 * Downloads a file's raw bytes. Needed for spreadsheets: the Sheets API only
 * reads native Google Sheets, and the finance ledger is a real .xlsx that is
 * deliberately kept in Excel format to preserve its formulas and validations.
 */
export async function driveDownload(fileId) {
  const metaRes = await call(`${DRIVE}/files/${fileId}?fields=id,name,mimeType,size`);
  const meta = await metaRes.json();
  const res = await call(`${DRIVE}/files/${fileId}?alt=media`);
  return { meta, buffer: Buffer.from(await res.arrayBuffer()) };
}

export async function driveUpload({ name, folderId, mimeType, content }) {
  const boundary = `es${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, parents: folderId ? [folderId] : undefined });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    Buffer.from(content, "utf8"),
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await call(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  return res.json();
}

/* --------------------------------------------------------------- Sheets -- */

export async function sheetRead({ spreadsheetId, range }) {
  const res = await call(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
  );
  const { values = [] } = await res.json();
  return values;
}

export async function sheetAppend({ spreadsheetId, range, rows }) {
  const res = await call(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );
  return res.json();
}

/* ---------------------------------------------------------------- Gmail -- */

export async function gmailSearch({ query, limit = 10 }) {
  const url = new URL(`${GMAIL}/messages`);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(limit, 25)));

  const res = await call(url.toString());
  const { messages = [] } = await res.json();

  return Promise.all(
    messages.map(async ({ id }) => {
      const detail = await call(
        `${GMAIL}/messages/${id}?format=metadata` +
          `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      const msg = await detail.json();
      return {
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet,
        ...headersToObject(msg.payload?.headers ?? []),
      };
    }),
  );
}

export async function gmailRead(messageId) {
  const res = await call(`${GMAIL}/messages/${messageId}?format=full`);
  const msg = await res.json();
  return {
    id: msg.id,
    threadId: msg.threadId,
    ...headersToObject(msg.payload?.headers ?? []),
    body: extractPlainText(msg.payload) || msg.snippet,
    attachments: listAttachments(msg.payload),
  };
}

/**
 * Creates a draft. There is deliberately no send function in this module —
 * a person sends every outgoing message.
 */
export async function gmailDraft({ to, subject, body, cc, threadId, inReplyTo }) {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeader(subject)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
    "Content-Type: text/plain; charset=UTF-8",
  ].filter(Boolean);

  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await call(`${GMAIL}/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw, threadId } }),
  });
  return res.json();
}

/* -------------------------------------------------------------- helpers -- */

function headersToObject(headers) {
  const pick = (name) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  return {
    from: pick("from"),
    to: pick("to"),
    subject: pick("subject"),
    date: pick("date"),
  };
}

/** Non-ASCII subjects need RFC 2047 encoding — Arabic subjects are common here. */
function encodeHeader(value) {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function extractPlainText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) return found;
  }
  return "";
}

function listAttachments(part, found = []) {
  if (!part) return found;
  if (part.filename) found.push({ filename: part.filename, mimeType: part.mimeType });
  for (const child of part.parts ?? []) listAttachments(child, found);
  return found;
}
