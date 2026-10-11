// Live site checks: the app loads over HTTPS with the security headers, the
// APK download matches version.json, anonymous access to data is refused, and
// (when Admin test credentials are configured) an Admin can sign in.
import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authenticator } from 'otplib';

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), '.env.production'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

test('app loads with security headers', async ({ page, baseURL }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(baseURL!.startsWith('https://')).toBe(true);
  await page.screenshot({ path: `test-results/smoke/${test.info().project.name}-login.png` });
});

test('APK download matches version.json', async ({ request }, info) => {
  test.skip(info.project.name !== 'desktop', 'once is enough');
  const v = await (await request.get('/version.json')).json();
  expect(v.version).toMatch(/^\d+\.\d+\.\d+$/);
  const apk = await request.get('/download/EnvironmSafe-Records.apk');
  expect(apk.status()).toBe(200);
  const body = await apk.body();
  expect(body.length).toBe(v.size);
  expect(crypto.createHash('sha256').update(body).digest('hex')).toBe(v.sha256);
  const page = await request.get('/download/');
  expect(await page.text()).toContain(v.sha256);
});

test('anonymous access to data and files is refused', async ({ request }, info) => {
  test.skip(info.project.name !== 'desktop', 'once is enough');
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  const rows = await request.get(`${url}/rest/v1/clients?select=*`, { headers: { apikey: key } });
  expect(rows.status() >= 400 || (await rows.json()).length === 0).toBe(true);
  const write = await request.post(`${url}/rest/v1/clients`, { headers: { apikey: key, 'Content-Type': 'application/json' }, data: { name: 'x', code: 'X' } });
  expect(write.status()).toBeGreaterThanOrEqual(400);
  const signup = await request.post(`${url}/auth/v1/signup`, { headers: { apikey: key }, data: { email: `probe${Date.now()}@example.com`, password: 'Probe-Password-123' } });
  expect(signup.status()).toBeGreaterThanOrEqual(400);
  const file = await request.get(`${url}/storage/v1/object/public/files/branding/logo.png`, { headers: { apikey: key } });
  expect(file.status()).toBeGreaterThanOrEqual(400);
  const keep = await request.post(`${url}/rest/v1/rpc/keepalive`, { headers: { apikey: key, 'Content-Type': 'application/json' }, data: {} });
  expect(keep.status()).toBe(200);
});

test('Admin can sign in (when test credentials are configured)', async ({ page }, info) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL || info.project.name !== 'phone', 'no live test account configured');
  await page.goto('/');
  await page.getByLabel('E-mail').fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('6-digit code').fill(authenticator.generate(process.env.E2E_ADMIN_TOTP_SECRET!));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /^Hello/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/smoke/live-dashboard.png', fullPage: true });
});
