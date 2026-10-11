// Direct calls to the backend for test setup and checks (works against the
// local stand-in and against a real Supabase project).
import { totp, USERS } from './helpers';

export const API = process.env.E2E_API_URL || 'http://localhost:54321';
const KEY = process.env.E2E_ANON_KEY || 'local-anon-key';

export async function token(who: keyof typeof USERS): Promise<string> {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USERS[who].email, password: USERS[who].password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login failed for ${who}: ${JSON.stringify(j)}`);
  const code = who === 'admin' ? totp() : null;
  if (!code) return j.access_token;
  // Real Supabase: raise the Admin's session to two-step (aal2).
  const h = { apikey: KEY, Authorization: `Bearer ${j.access_token}`, 'Content-Type': 'application/json' };
  const factors = await (await fetch(`${API}/auth/v1/user`, { headers: h })).json();
  const f = (factors.factors ?? []).find((x: { factor_type: string; status: string }) => x.factor_type === 'totp' && x.status === 'verified');
  const ch = await (await fetch(`${API}/auth/v1/factors/${f.id}/challenge`, { method: 'POST', headers: h, body: '{}' })).json();
  const v = await (await fetch(`${API}/auth/v1/factors/${f.id}/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challenge_id: ch.id, code }) })).json();
  return v.access_token;
}

export async function rpc<T = unknown>(tok: string, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${fn}: ${r.status} ${text}`), { status: r.status });
  return (text ? JSON.parse(text) : null) as T;
}

export async function select<T = Record<string, unknown>>(tok: string | null, query: string): Promise<{ status: number; rows: T[] }> {
  const r = await fetch(`${API}/rest/v1/${query}`, { headers: { apikey: KEY, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  const text = await r.text();
  let rows: T[] = [];
  try {
    rows = JSON.parse(text);
  } catch {
    rows = [];
  }
  return { status: r.status, rows: Array.isArray(rows) ? rows : [] };
}

export async function insert(tok: string | null, table: string, row: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const r = await fetch(`${API}/rest/v1/${table}`, { method: 'POST', headers: { apikey: KEY, ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) });
  return { status: r.status, body: await r.text() };
}
