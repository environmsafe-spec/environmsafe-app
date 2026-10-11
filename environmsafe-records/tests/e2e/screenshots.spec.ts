// Not a test: captures the screenshots used in docs/ (run with --grep @shots).
import { test } from '@playwright/test';
import { rpc, token } from './api';
import { login, step } from './helpers';

const V201 = '00000000-0000-4000-8000-00000000d020';
const B101 = '00000000-0000-4000-8000-00000000d010';
const JOB = '00000000-0000-4000-8000-00000000d050';

test('@shots key screens', async ({ page }, info) => {
  test.setTimeout(180_000);
  const dir = `docs/screenshots/${info.project.name}`;
  await rpc(await token('admin'), 'load_demo_data').catch(() => undefined);
  await login(page, 'inspector');
  const shot = async (name: string) => { await page.waitForTimeout(600); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false }); };
  await shot('01-home');
  await page.goto(`/assets/${V201}`); await shot('02-asset');
  await page.goto(`/assets/${V201}?tab=readings`); await shot('03-thickness-trend');
  await page.goto(`/inspections/new?asset=${V201}`);
  await page.getByLabel('Inspection / test type').selectOption('EXT');
  await shot('04-new-inspection');
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await page.waitForURL(/inspections\/[0-9a-f-]{36}/);
  await shot('05-checklist');
  await step(page, 'Previous findings'); await shot('06-previous-findings');
  await step(page, 'Photos'); await shot('07-photos');
  await page.goto(`/assets/${B101}`); await shot('08-boiler-with-psvs');
  await page.goto(`/jobs/${JOB}`); await shot('09-job');
  await page.goto('/due?bucket=all'); await shot('10-due-board');
  await page.goto('/findings'); await shot('11-findings');
  await page.goto('/sync'); await shot('12-sync');
});
