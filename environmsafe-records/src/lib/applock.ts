// App lock: a PIN (and fingerprint on Android) protects the data kept on the
// device. The PIN is stored only as a salted PBKDF2 hash.

const KEY = 'es-records-pin';
const ITER = 150_000;

interface PinRecord {
  salt: string;
  hash: string;
  iter: number;
  bio?: boolean;
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return b64(bits);
}

function read(): PinRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PinRecord) : null;
  } catch {
    return null;
  }
}

export function hasPin(): boolean {
  return read() !== null;
}

export function biometricEnabled(): boolean {
  return Boolean(read()?.bio);
}

export async function setPin(pin: string, bio = false): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('The PIN must be 4 to 8 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITER);
  localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), hash, iter: ITER, bio }));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const rec = read();
  if (!rec) return false;
  const hash = await derive(pin, unb64(rec.salt), rec.iter);
  return hash === rec.hash;
}

export function clearPin(): void {
  localStorage.removeItem(KEY);
}
