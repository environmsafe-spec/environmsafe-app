// Attacks a sceptical tester would try: no login, wrong role, role escalation,
// direct file access, script injection. All must fail.
import { expect, test } from '@playwright/test';
import { API, insert, rpc, select, token } from './api';
import { login } from './helpers';

const KEY = process.env.E2E_ANON_KEY || 'local-anon-key';

test('without signing in nothing can be read or written', async () => {
  const r = await select(null, 'clients?select=*');
  expect(r.rows.length).toBe(0);
  const w = await insert(null, 'clients', { name: 'Hacker', code: 'HAX' });
  expect(w.status).toBeGreaterThanOrEqual(400);
  const s = await fetch(`${API}/rest/v1/rpc/sync_apply`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: [] }) });
  expect(s.status).toBeGreaterThanOrEqual(400);
});

test('files cannot be fetched without a valid signed link', async () => {
  const admin = await token('admin');
  const docs = await select<{ file_path: string }>(admin, 'documents?select=*&limit=1');
  const p = docs.rows[0]?.file_path ?? '00000000-0000-4000-8000-00000000d001/none.jpg';
  for (const url of [`${API}/storage/v1/object/files/${p}`, `${API}/storage/v1/object/public/files/${p}`, `${API}/storage/v1/object/sign/files/${p}?token=forged`]) {
    const r = await fetch(url, { headers: { apikey: KEY } });
    expect(r.status, url).toBeGreaterThanOrEqual(400);
  }
  const signAnon = await fetch(`${API}/storage/v1/object/sign/files/${p}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
  expect(signAnon.status).toBeGreaterThanOrEqual(400);
});

test('a viewer cannot change anything, an inspector cannot escalate their role', async () => {
  const viewer = await token('viewer');
  const w = await insert(viewer, 'clients', { name: 'Viewer client', code: 'VWR' });
  expect(w.status).toBeGreaterThanOrEqual(400);
  await expect(rpc(viewer, 'sync_apply', { ops: [] })).rejects.toThrow();
  const insp = await token('inspector');
  const me = await select<{ id: string }>(insp, 'profiles?select=*&email=eq.inspector@e2e.test');
  const r = await fetch(`${API}/rest/v1/profiles?id=eq.${me.rows[0].id}`, {
    method: 'PATCH', headers: { apikey: KEY, Authorization: `Bearer ${insp}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin' }),
  });
  expect(r.status).toBeGreaterThanOrEqual(400);
  const after = await select<{ role: string }>(insp, `profiles?select=*&id=eq.${me.rows[0].id}`);
  expect(after.rows[0].role).toBe('inspector');
  await expect(rpc(insp, 'admin_sign_out', { p_user: null })).rejects.toThrow();
  const audit = await select(insp, 'audit_log?select=*&limit=5');
  expect(audit.rows.length).toBe(0);
});

test('viewer sees no editing actions in the app', async ({ page }) => {
  await login(page, 'viewer');
  await expect(page.getByRole('link', { name: 'New inspection' })).toHaveCount(0);
  await page.goto('/clients');
  await expect(page.getByRole('link', { name: 'New client' })).toHaveCount(0);
  await page.goto('/users');
  await expect(page).toHaveURL(/\/$/);
});

test('script typed into a field is shown as text, never run', async ({ page }) => {
  const admin = await token('admin');
  const payload = `<img src=x onerror="window.__xss=1"> XSS-${Date.now()}`;
  const res = await rpc<{ ok: boolean; error?: string }[]>(admin, 'sync_apply', { ops: [{ op_id: 'x', table: 'clients', id: crypto.randomUUID(), fields: { name: payload, code: `X${Date.now() % 100000}` } }] });
  expect(res[0].ok, res[0].error).toBe(true);
  await login(page, 'admin');
  await page.goto('/clients');
  await expect(page.getByText(payload)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});
