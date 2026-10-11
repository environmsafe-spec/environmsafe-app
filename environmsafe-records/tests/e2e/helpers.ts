import { expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
import { authenticator } from 'otplib';

/** Two-step sign-in code for the Admin (real Supabase only; the local stand-in skips it). */
export function totp(): string | null {
  const secret = process.env.E2E_ADMIN_TOTP_SECRET;
  return secret ? authenticator.generate(secret) : null;
}

export const USERS = {
  admin: { email: process.env.E2E_ADMIN_EMAIL || 'admin@e2e.test', password: process.env.E2E_ADMIN_PASSWORD || 'AdminPass123' },
  office: { email: 'office@e2e.test', password: 'OfficePass123' },
  inspector: { email: 'inspector@e2e.test', password: 'InspectPass123' },
  viewer: { email: 'viewer@e2e.test', password: 'ViewerPass123' },
};

export const fixture = (n: string) => path.resolve(process.cwd(), 'tests/fixtures', n);

/** A short suffix so the desktop and phone runs create separate data. */
export function sfx(info: TestInfo): string {
  return info.project.name === 'phone' ? 'P' : 'D';
}

export function isPhone(info: TestInfo): boolean {
  return info.project.name === 'phone';
}

export async function login(page: Page, who: keyof typeof USERS) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(USERS[who].email);
  await page.getByLabel('Password').fill(USERS[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const hello = page.getByRole('heading', { name: /^Hello/ });
  const mfa = page.getByRole('heading', { name: 'Two-step sign-in' });
  await expect(hello.or(mfa)).toBeVisible();
  if (await mfa.isVisible()) {
    await page.getByLabel('6-digit code').fill(totp() ?? '');
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(hello).toBeVisible();
  await waitSynced(page);
}

export async function waitSynced(page: Page, timeout = 45_000) {
  try {
    await expect(page.getByTestId('sync-indicator')).toHaveText(/Synced/, { timeout });
  } catch (e) {
    // Show why: the sync screen lists refused changes with the server's reason.
    await page.goto('/sync');
    console.log('[sync page]', (await page.locator('main').innerText()).slice(0, 1500));
    throw e;
  }
}

/** Opens a page through the menu like a user would (bottom "More" on phones). */
export async function go(page: Page, pathName: string) {
  await page.goto(pathName);
}

export async function drawSignature(page: Page) {
  const pad = page.getByTestId('signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + box.height / 2 + (i % 2 ? -25 : 25));
  await page.mouse.up();
  await page.getByRole('button', { name: 'Use this signature' }).click();
}

export async function step(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name }).click();
}

export function yearAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
