import { env, requireEnv } from "./runtime.js";

/**
 * Google Workspace access for the agent. Credentials live in the Cloudflare
 * environment and never reach the browser.
 *
 * Two ways in, and the difference matters:
 *
 *   A service account (GOOGLE_SERVICE_ACCOUNT) is its own identity. It signs
 *   its own assertion and asks Google directly, so there is no browser, no
 *   consent screen, no refresh token, and nothing to expire. You give it
 *   access the way you give a colleague access: by sharing the folder with
 *   its email address. It cannot read a personal Gmail mailbox.
 *
 *   The OAuth refresh token acts AS the company account, which is what Gmail
 *   requires — but the token is bound to the client that issued it, must be
 *   carried by hand from a browser, and fails opaquely when any of that
 *   drifts apart.
 *
 * So the service account is preferred where it suffices, which is everything
 * except mail, and the refresh token is used when it is the only thing that
 * can do the job.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Access tokens last an hour; cache across warm invocations. */
let cached = { token: null, expiresAt: 0 };

/**
 * These values are pasted by hand into a dashboard field, often from a phone.
 * A trailing space or a newline picked up by the paste is invisible in the UI
 * and makes Google reject the whole grant with a message that says nothing
 * about whitespace, so trim before use rather than after a wasted evening.
 */
function credential(name) {
  return requireEnv(name).trim();
}

/** Which credential is configured. A service account wins where both are. */
export function authMode() {
  if ((env("GOOGLE_SERVICE_ACCOUNT") ?? "").trim()) return "service-account";
  if ((env("GOOGLE_REFRESH_TOKEN") ?? "").trim()) return "oauth";
  throw new Error(
    "No Google credentials are configured. Set GOOGLE_SERVICE_ACCOUNT to the " +
      "service account key file, or the three GOOGLE_CLIENT_ID / _SECRET / " +
      "_REFRESH_TOKEN values — see AGENT_SETUP.md.",
  );
}

export async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const token = authMode() === "service-account"
    ? await serviceAccountToken()
    : await refreshTokenGrant();

  cached = token;
  return token.token;
}

/* ------------------------------------------------- service account -- */

// Drive and Sheets only. Gmail is deliberately absent: a service account
// cannot reach a personal mailbox, and asking for the scope would fail later
// and less clearly than refusing here.
const SA_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const encodeSegment = (value) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * Turn the PEM in the key file into something crypto.subtle will sign with.
 *
 * The key arrives as JSON, so its newlines are real ones — unless the value
 * was pasted somewhere that escaped them, which happens often enough to be
 * worth handling rather than failing on.
 */
async function importPrivateKey(pem) {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function serviceAccountToken() {
  let key;
  try {
    key = JSON.parse(credential("GOOGLE_SERVICE_ACCOUNT"));
  } catch (error) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT is not valid JSON (${error.message}). Paste the ` +
        "whole key file Google gave you, from the opening { to the closing }.",
    );
  }

  if (!key.client_email || !key.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT is missing client_email or private_key, so it is " +
        "not a service account key file. Download the key again from the " +
        "service account's Keys tab and paste the whole file.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    `${encodeSegment({ alg: "RS256", typ: "JWT" })}.` +
    encodeSegment({
      iss: key.client_email,
      scope: SA_SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    });

  let assertion;
  try {
    const privateKey = await importPrivateKey(key.private_key);
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(signingInput),
    );
    assertion = `${signingInput}.${base64url(new Uint8Array(signature))}`;
  } catch (error) {
    throw new Error(
      `Could not sign with the service account key (${error.message}). The ` +
        "private_key in GOOGLE_SERVICE_ACCOUNT looks damaged — paste the key " +
        "file again exactly as downloaded.",
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const hint = detail.includes("invalid_grant")
      ? " Check the Drive API is enabled for the project, and that the clock " +
        "on the key file is not from a deleted account."
      : "";
    throw new Error(
      `Google refused the service account (${res.status}).${hint} ${detail}`,
    );
  }

  const json = await res.json();
  return {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/* ------------------------------------------------------------ oauth -- */

async function refreshTokenGrant() {
  const clientId = credential("GOOGLE_CLIENT_ID");
  const clientSecret = credential("GOOGLE_CLIENT_SECRET");
  const refreshToken = credential("GOOGLE_REFRESH_TOKEN");

  checkShapes({ clientId, clientSecret, refreshToken });

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
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
      `Google token refresh failed (${res.status}). ${describeGrantFailure(detail, refreshToken)} ${detail}`,
    );
  }

  const json = await res.json();
  return {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/**
 * The three credentials have three unmistakable shapes, and the dashboard rows
 * that hold them are named GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
 * GOOGLE_REFRESH_TOKEN — which on a narrow screen all truncate to "GOOGLE".
 * Putting a value in the wrong row is therefore easy and, left to Google,
 * comes back as "The OAuth client was not found", which points nowhere near
 * the actual mistake. Checking the shapes here names the row to fix.
 */
const SHAPES = [
  { key: "GOOGLE_CLIENT_ID", value: "clientId",
    ok: (v) => v.endsWith(".apps.googleusercontent.com"),
    looks: "end in .apps.googleusercontent.com" },
  { key: "GOOGLE_CLIENT_SECRET", value: "clientSecret",
    ok: (v) => v.startsWith("GOCSPX-"),
    looks: "begin GOCSPX-" },
  { key: "GOOGLE_REFRESH_TOKEN", value: "refreshToken",
    ok: (v) => v.startsWith("1//"),
    looks: 'begin "1//"' },
];

function checkShapes(values) {
  const wrong = SHAPES.filter((s) => !s.ok(values[s.value]));
  if (!wrong.length) return;

  const detail = wrong.map((s) => {
    const value = values[s.value];
    // Name what landed there without printing it: the shapes are distinctive
    // enough that a swap is obvious from the first few characters alone.
    const held = SHAPES.find((other) => other !== s && other.ok(value));
    return held
      ? `${s.key} holds what belongs in ${held.key}`
      : `${s.key} should ${s.looks}, but starts "${value.slice(0, 7)}" and is ${value.length} characters`;
  });

  throw new Error(
    `The Google credentials are in the wrong places. ${detail.join("; ")}. ` +
      "Fix them under Settings \u2192 Variables and Secrets, then retry the deployment. " +
      "Zoom out first: the three names truncate to \u201cGOOGLE\u201d on a narrow screen.",
  );
}

/**
 * `invalid_grant` is Google's answer to several different mistakes, and the
 * message never says which. The token's shape is the one clue available here
 * without exposing the secret: a Google refresh token starts "1//" and runs to
 * about a hundred characters, so a short one was truncated on its way into the
 * dashboard — which is easy to do when copying a wrapped line off a phone.
 */
function describeGrantFailure(detail, refreshToken) {
  if (!detail.includes("invalid_grant")) {
    return "Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are the pair from one OAuth client.";
  }

  const length = refreshToken.length;

  if (!refreshToken.startsWith("1//")) {
    return `The stored GOOGLE_REFRESH_TOKEN does not look like one — it should begin "1//" and this begins "${refreshToken.slice(0, 3)}". It is ${length} characters. Re-run the authorisation step and paste the whole value.`;
  }
  if (length < 80) {
    return `The stored GOOGLE_REFRESH_TOKEN is only ${length} characters, where Google's are about a hundred, so it was cut short when it was pasted in. Re-run the authorisation step and copy the whole line.`;
  }

  return (
    `The token looks complete (${length} characters), so Google refused it rather than ` +
    "failed to read it. Either the consent screen is still in Testing — those tokens expire " +
    "after seven days — or access was withdrawn at myaccount.google.com/permissions. " +
    "Publish the app, then re-run the authorisation step."
  );
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

/**
 * A service account has no mailbox of its own and cannot be granted one on a
 * personal Google account — that needs Workspace domain-wide delegation. The
 * failure is worth naming here: from Google it arrives as a 400 about an
 * invalid user, which sounds like a bug in the query.
 */
function requireMailbox() {
  if (authMode() === "service-account") {
    throw new Error(
      "Mail is not available on a service account. The agent reads Drive and " +
        "Sheets through GOOGLE_SERVICE_ACCOUNT, but reading or drafting email " +
        "has to act as the company account itself, which needs the OAuth " +
        "credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, " +
        "GOOGLE_REFRESH_TOKEN) — see AGENT_SETUP.md.",
    );
  }
}

export async function gmailSearch({ query, limit = 10 }) {
  requireMailbox();
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
  requireMailbox();
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
  requireMailbox();
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
