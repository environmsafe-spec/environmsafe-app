// Offline field work: switch the network off, create an inspection with a
// photo, close and reopen the app, switch the network back on and check that
// everything reached the server – including a deliberate edit conflict.
import { expect, test } from '@playwright/test';
import { rpc, select, token } from './api';
import { fixture, login, sfx, step, waitSynced } from './helpers';

test.use({ serviceWorkers: 'allow' });

const V201 = '00000000-0000-4000-8000-00000000d020';

test('offline inspection with photo survives a restart and syncs, conflict listed', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const S = sfx(info);
  const admin = await token('admin');
  await rpc(admin, 'load_demo_data');

  await login(page, 'inspector');
  // Let the service worker install so the app opens with no network.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await waitSynced(page);

  // A draft that both the inspector (offline) and the office (online) will change.
  await page.goto(`/inspections/new?asset=${V201}`);
  await page.getByLabel('Inspection / test type').selectOption('UT');
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await page.waitForURL(/\/inspections\/[0-9a-f-]{36}/);
  const sharedId = new URL(page.url()).pathname.split('/').pop()!;
  await waitSynced(page);

  // ---- Network off ----------------------------------------------------------------
  await context.setOffline(true);
  await expect(page.getByText(/No internet/)).toBeVisible();
  await step(page, 'Conclusion & sign');
  await page.getByLabel('Summary of inspection').fill(`Inspector offline note ${S}`);
  await page.getByLabel('Summary of inspection').blur();
  await step(page, 'Checklist');
  await page.getByLabel('Witness').fill(`Witness ${S}`);
  await page.getByLabel('Witness').blur();

  // New inspection with a photo, created entirely offline.
  await page.goto(`/inspections/new?asset=${V201}`).catch(() => undefined);
  await page.getByLabel('Inspection / test type').selectOption('EXT');
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await page.waitForURL(/\/inspections\/[0-9a-f-]{36}/);
  const offlineId = new URL(page.url()).pathname.split('/').pop()!;
  await step(page, 'Photos');
  await page.getByTestId('photo-camera-input').setInputFiles(fixture('photo2.jpg'));
  await expect(page.getByText('Figure 1')).toBeVisible();
  await page.getByLabel('Caption for figure 1').fill(`Offline photo ${S}`);
  await page.getByLabel('Caption for figure 1').blur();
  await expect(page.getByTestId('sync-indicator')).toHaveText(/Offline · \d+ to sync/);

  // Close and reopen the app with no network.
  await page.reload();
  await expect(page.getByText(/No internet/)).toBeVisible();
  await page.goto(`/inspections/${offlineId}?step=photos`);
  await expect(page.getByText('Figure 1')).toBeVisible();
  await expect(page.getByLabel('Caption for figure 1')).toHaveValue(`Offline photo ${S}`);

  // Meanwhile the office changes the same draft's summary, later than the inspector did.
  const office = await token('office');
  const later = new Date(Date.now() + 1000).toISOString();
  const res = await rpc<{ ok: boolean }[]>(office, 'sync_apply', { ops: [{ op_id: 'o1', table: 'inspections', id: sharedId, fields: { summary: `Office summary ${S}` }, ts: { summary: later } }] });
  expect(res[0].ok).toBe(true);

  // ---- Network back on -----------------------------------------------------------
  await context.setOffline(false);
  await waitSynced(page, 60_000);

  const insp = await select<{ id: string; summary: string; witness: string }>(admin, `inspections?select=*&id=in.(${sharedId},${offlineId})`);
  const shared = insp.rows.find((r) => r.id === sharedId)!;
  expect(insp.rows.map((r) => r.id).sort()).toEqual([sharedId, offlineId].sort());
  expect(shared.summary).toBe(`Office summary ${S}`); // newer edit kept
  expect(shared.witness).toBe(`Witness ${S}`); // other field from the device merged
  const docs = await select<{ caption: string; file_path: string }>(admin, `documents?select=*&inspection_id=eq.${offlineId}`);
  expect(docs.rows[0]?.caption).toBe(`Offline photo ${S}`);
  const conflicts = await select<{ field: string; kept: string }>(admin, `sync_conflicts?select=*&row_id=eq.${sharedId}`);
  expect(conflicts.rows.some((c) => c.field === 'summary' && c.kept === 'server')).toBe(true);

  // The admin sees the conflict in the app.
  await page.context().clearCookies();
  const adminPage = await context.browser()!.newPage({ ...info.project.use });
  await login(adminPage, 'admin');
  await adminPage.goto('/sync');
  await expect(adminPage.getByTestId('conflict-list')).toContainText(`Inspector offline note ${S}`);
  await adminPage.screenshot({ path: `test-results/screens/${S}-conflict-list.png`, fullPage: true });
  await adminPage.close();
});
