/**
 * Staff session cookies, signed with an HMAC so the server can verify them
 * without storing anything. The agent can read company finances and mail, so
 * every function that touches it must call requireSession first.
 */

import crypto from "node:crypto";

const COOKIE_NAME = "es_agent_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  return value;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueCookie(user = "staff") {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${Buffer.from(user).toString("base64url")}.${expires}`;
  const token = `${payload}.${sign(payload)}`;

  return (
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; ` +
    `Path=/; Max-Age=${MAX_AGE_SECONDS}`
  );
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Returns the user name, or null when the request carries no valid session. */
export function readSession(request) {
  const header = request.headers.get("cookie") ?? "";
  const raw = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const [user, expires, signature] = parts;
  const payload = `${user}.${expires}`;

  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  if (Date.now() > Number(expires)) return null;

  return Buffer.from(user, "base64url").toString("utf8");
}

export function requireSession(request) {
  const user = readSession(request);
  if (!user) {
    throw Object.assign(new Error("Not signed in."), { statusCode: 401 });
  }
  return user;
}

/** Constant-time passcode check against the configured staff passcode. */
export function checkPasscode(submitted) {
  const expected = process.env.STAFF_PASSCODE;
  if (!expected) throw new Error("STAFF_PASSCODE is not configured.");

  const a = crypto.createHash("sha256").update(String(submitted ?? "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
