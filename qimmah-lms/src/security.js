// Password hashing, sessions, rate limiting and HTTP helpers.
// PBKDF2-SHA256 via WebCrypto (native in Workers). Format:
//   pbkdf2$<iterations>$<salt b64>$<hash b64>

const enc = new TextEncoder();

export function b64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return b64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomDigits(n) {
  const a = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(a, (x) => String(x % 10)).join('');
}
export function randomPassword(len = 10) {
  // no ambiguous characters (0/O, 1/l/I)
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(a, (x) => alphabet[x % alphabet.length]).join('');
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password, iterations = 20000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Unknown usernames still run one hash so they cost the same time as known ones.
export async function verifyPassword(password, stored, dummyIterations = 20000) {
  const dummy = 'pbkdf2$' + dummyIterations + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const parts = String(stored || dummy).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Math.min(Math.max(parseInt(parts[1], 10) || 0, 1000), 100000);
  const salt = unb64(parts[2]);
  const expected = unb64(parts[3]);
  const got = await pbkdf2(password, salt, iterations);
  return stored ? timingSafeEqual(got, expected) : false;
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64(d);
}

// ---------- HTTP helpers ----------

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
};

export function withSecurityHeaders(resp, isHttps) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  if (isHttps) r.headers.set('strict-transport-security', 'max-age=31536000');
  return r;
}

// ---------- cookies & sessions ----------

export function cookieName(isHttps) {
  return isHttps ? '__Host-qs' : 'qs';
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(isHttps, token, maxAgeSec) {
  const attrs = [`${cookieName(isHttps)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isHttps) attrs.push('Secure');
  return attrs.join('; ');
}

export const SESSION_DAYS = { student: 30, teacher: 14, principal: 7 };

// ---------- login rate limiting ----------
// Per username: 5 failures in 15 minutes -> locked 15 minutes.
// Per IP: 30 failures in 15 minutes -> locked 15 minutes.
const WINDOW = 15 * 60 * 1000;
const LIMITS = { u: 5, ip: 30 };

export async function checkLocked(db, keys, now) {
  for (const k of keys) {
    const row = await db.prepare('SELECT locked_until FROM login_attempts WHERE k = ?').bind(k).first();
    if (row && row.locked_until > now) return Math.ceil((row.locked_until - now) / 60000);
  }
  return 0;
}

export async function recordFailure(db, keys, now) {
  for (const k of keys) {
    const limit = LIMITS[k.split(':')[0]] || 5;
    const row = await db.prepare('SELECT fails, window_start FROM login_attempts WHERE k = ?').bind(k).first();
    let fails = 1;
    let start = now;
    if (row && now - row.window_start < WINDOW) {
      fails = row.fails + 1;
      start = row.window_start;
    }
    const locked = fails >= limit ? now + WINDOW : 0;
    await db
      .prepare(
        'INSERT INTO login_attempts (k, fails, window_start, locked_until) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(k) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start, locked_until = excluded.locked_until'
      )
      .bind(k, locked ? 0 : fails, locked ? now : start, locked)
      .run();
  }
}

export async function clearFailures(db, key) {
  await db.prepare('DELETE FROM login_attempts WHERE k = ?').bind(key).run();
}
