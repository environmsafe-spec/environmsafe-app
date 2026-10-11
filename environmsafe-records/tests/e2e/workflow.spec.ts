// The complete office-and-field cycle from section 5 of the brief, run at
// desktop and phone sizes: client → site → asset → inspection with readings,
// photos and findings → a second inspection a year later with carry-over →
// certificate → job and daily report → final, custom and register reports →
// due board → import → search → users → backup export.
import { expect, test, type Page } from '@playwright/test';
import { drawSignature, fixture, login, sfx, step, waitSynced, yearAgo } from './helpers';

test.describe.configure({ mode: 'serial' });

let page: Page;
let S = 'D';
const client = () => `E2E Refinery ${S}`;
const code = () => `E2E${S}`;
const tag = () => `V-${S}01`;

test.beforeAll(async ({ browser }, info) => {
  S = sfx(info);
  const ctx = await browser.newContext({ ...info.project.use, acceptDownloads: true, baseURL: info.project.use.baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('[sync]')) && console.log(`[console] ${new Date().toISOString().slice(14, 23)} ${m.text()}`));
});

test.afterAll(async () => {
  await page.context().close();
});

test('admin signs in and sees the dashboard', async () => {
  await login(page, 'admin');
  await expect(page.getByText('Jobs in progress').first()).toBeVisible();
  await page.screenshot({ path: `test-results/screens/${S}-dashboard.png`, fullPage: true });
});

test('create client and site', async () => {
  await page.goto('/clients/new');
  await page.getByLabel('Client name').fill(client());
  await page.getByLabel('Short code').fill(code());
  await page.getByRole('button', { name: 'Add contact' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Plant Engineer');
  await page.getByRole('button', { name: 'Save client' }).click();
  await expect(page.getByRole('heading', { name: client() })).toBeVisible();
  await page.getByRole('tab', { name: /Sites/ }).click();
  await page.getByRole('button', { name: 'New site' }).click();
  await page.getByLabel('Site / plant name').fill('Main Refinery');
  await page.getByLabel('Area / unit').fill('Utilities');
  await page.getByRole('button', { name: 'Save site' }).click();
  await expect(page.getByText('Main Refinery')).toBeVisible();
});

test('create asset with a free-text tag and get a near-duplicate warning', async () => {
  await page.getByRole('tab', { name: /Assets/ }).click();
  await page.getByRole('link', { name: 'New asset' }).click();
  await page.getByLabel('Site / plant / area').selectOption({ label: 'Main Refinery' });
  await page.getByLabel('Tag number').fill(tag());
  await page.getByLabel('Equipment type').selectOption({ label: 'Pressure vessel' });
  await page.getByLabel('Description').fill('Instrument air receiver');
  await page.getByLabel('Design pressure', { exact: true }).fill('12');
  await page.getByLabel('Design temperature (°C)').fill('80');
  await page.getByLabel('Material').fill('SA-516 Gr 70');
  await page.getByLabel('Orientation').selectOption('Vertical');
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page.getByRole('heading', { name: tag() })).toBeVisible();
  // Second asset with a tag that only differs in punctuation: warned, not blocked.
  await page.goto('/assets/new');
  await page.getByLabel('Client').selectOption({ label: client() });
  await page.getByLabel('Tag number').fill(`V ${S}01`);
  await expect(page.getByText(/Looks similar to/)).toBeVisible();
  await page.getByLabel('Tag number').fill(`21-PSV-003-${S}`);
  await page.getByLabel('Equipment type').selectOption({ label: 'Pressure safety valve (PSV / PRV / SRV)' });
  await page.getByLabel('Part of (parent asset)').selectOption({ index: 1 });
  await page.getByLabel('Set pressure', { exact: true }).fill('13');
  await page.getByRole('button', { name: 'Save asset' }).click();
  await expect(page.getByRole('heading', { name: `21-PSV-003-${S}` })).toBeVisible();
  await waitSynced(page);
});

async function startInspection(date: string) {
  await page.goto('/assets');
  await page.getByLabel('Find asset').fill(tag());
  await page.getByRole('link', { name: new RegExp(tag()) }).first().click();
  await page.getByRole('link', { name: 'New inspection' }).click();
  await page.getByLabel('Inspection / test type').selectOption('EXT');
  await page.getByLabel('Date').fill(date);
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible();
}

test('first inspection: checklist, readings, photo, finding, signature, issue', async () => {
  await startInspection(yearAgo());
  const radios = page.getByRole('radiogroup');
  await radios.nth(0).getByRole('radio', { name: 'Yes' }).click();
  await radios.nth(1).getByRole('radio', { name: 'No' }).click();
  await page.getByLabel(/^Note for Shell/).fill('Corrosion at bottom head');
  await page.getByLabel(/^Note for Shell/).blur();
  await step(page, 'Readings');
  for (const [p, m] of [['CML-01', '11.6'], ['CML-02', '10.8']]) {
    await page.getByLabel('New measuring point').fill(p);
    await page.getByRole('button', { name: 'Add point' }).click();
    await page.getByLabel(`Measured ${p}`).fill(m);
    await page.getByLabel(`Measured ${p}`).blur();
    await page.getByLabel(`t-min ${p}`).fill('8.2');
    await page.getByLabel(`t-min ${p}`).blur();
  }
  await step(page, 'Photos');
  await page.getByTestId('photo-camera-input').setInputFiles(fixture('photo1.jpg'));
  await expect(page.getByText('Figure 1')).toBeVisible();
  await page.getByLabel('Caption for figure 1').fill('Bottom head corrosion');
  await page.getByLabel('Caption for figure 1').blur();
  await step(page, 'New findings');
  await page.getByRole('button', { name: 'Add finding' }).click();
  await page.getByLabel('Finding', { exact: true }).fill('External corrosion at bottom head');
  await page.getByLabel('Priority').selectOption('P1');
  await page.getByLabel('Recommendation').fill('Clean, measure and restore coating.');
  await page.getByRole('button', { name: 'Save finding' }).click();
  await expect(page.getByText('External corrosion at bottom head')).toBeVisible();
  await step(page, 'Conclusion & sign');
  await page.getByLabel('Conclusion', { exact: true }).selectOption('fit_conditions');
  await page.getByLabel('Summary of inspection').fill('We carried out an external visual inspection and UT survey.');
  await page.getByLabel('Summary of inspection').blur();
  await page.getByRole('button', { name: 'Draw signature' }).click();
  await drawSignature(page);
  await expect(page.getByText(/Signed by/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit and issue' }).click();
  await expect(page.getByText('Issued', { exact: true }).first()).toBeVisible();
  await waitSynced(page);
  await expect(page.getByText(new RegExp(`ES/${code()}-EXT-\\d{4}-\\d{3}`))).toBeVisible({ timeout: 30_000 });
});

test('second inspection a year later carries over the previous finding', async () => {
  await startInspection(new Date().toISOString().slice(0, 10));
  await step(page, 'Readings');
  await page.getByLabel('Measured CML-01').fill('11.4');
  await page.getByLabel('Measured CML-01').blur();
  await page.getByLabel('Measured CML-02').fill('10.2');
  await page.getByLabel('Measured CML-02').blur();
  await expect(page.getByRole('cell', { name: /^0\.(59|60)/ }).first()).toBeVisible(); // corrosion rate CML-02
  await step(page, 'Conclusion & sign');
  await page.getByRole('button', { name: 'Draw signature' }).click();
  await drawSignature(page);
  await page.getByRole('button', { name: 'Submit and issue' }).click();
  // Blocked: the previous finding has not been updated.
  await expect(page.getByText(/Update all 1 previous finding/)).toBeVisible();
  const item = page.getByTestId('carry-item');
  await expect(item).toContainText('External corrosion at bottom head');
  await item.getByRole('radio', { name: 'Deteriorated' }).click();
  await item.getByLabel(/Note for F-001/).fill('Pitting deeper than last year');
  await item.getByLabel(/Note for F-001/).blur();
  await step(page, 'Conclusion & sign');
  await page.getByRole('button', { name: 'Submit and issue' }).click();
  await expect(page.getByText('Issued', { exact: true }).first()).toBeVisible();
  await waitSynced(page);
  await page.goto('/findings');
  await expect(page.getByText(new RegExp(`${tag()} F-001 – External corrosion at bottom head`))).toBeVisible();
  await expect(page.getByText(/Open – deteriorated/).first()).toBeVisible();
});

test('inspection report generated as Word and PDF with the previous findings table', async () => {
  await page.goto('/inspections');
  await page.getByRole('link', { name: new RegExp(`${tag()} – External visual`) }).first().click();
  await page.getByRole('link', { name: /Inspection report/ }).click();
  await page.getByRole('button', { name: 'Generate Word and PDF' }).click();
  await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible({ timeout: 60_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  const file = await dl;
  await file.saveAs(`test-results/e2e-downloads/${S}-inspection-report.pdf`);
  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Word', exact: true }).click();
  await (await dl2).saveAs(`test-results/e2e-downloads/${S}-inspection-report.docx`);
});

test('certificate created from the inspection and issued with a number', async () => {
  await page.goto('/inspections');
  await page.getByRole('link', { name: new RegExp(`${tag()} – External visual`) }).first().click();
  await page.getByRole('link', { name: 'Create certificate' }).click();
  await page.getByLabel('Witnessed by').fill('Client engineer');
  await page.getByLabel('Witnessed by').blur();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Issue certificate' }).click();
  await waitSynced(page);
  await expect(page.getByText(/ES-G-\d{4}-\d{3}/).first()).toBeVisible({ timeout: 30_000 });
});

test('job with holds and a daily progress report generated in one tap', async () => {
  await page.goto('/jobs/new');
  await page.getByLabel('Client').selectOption({ label: client() });
  await page.getByLabel('Contract / PO number').fill(`PC0${S}51`);
  await page.getByLabel('Title').fill('Shutdown inspection');
  await page.getByRole('button', { name: 'Save job' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`PC0${S}51`) })).toBeVisible();
  await page.getByRole('tab', { name: /Holds/ }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Reference').fill('H-01');
  await page.getByLabel('Title').fill('Gas-free certificate before entry');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'New daily report' }).click();
  await expect(page.getByRole('heading', { name: 'Daily progress report' })).toBeVisible();
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByLabel('Discipline').fill('Mechanical');
  await page.getByLabel('Activity', { exact: true }).fill('External inspection of V-01');
  await page.getByLabel('Activity', { exact: true }).blur();
  await page.getByLabel('Planned activities for the next day').fill('UT survey');
  await page.getByLabel('Planned activities for the next day').blur();
  await waitSynced(page);
  await page.getByRole('button', { name: 'PDF + Word' }).click();
  await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible({ timeout: 60_000 });
});

test('final report for the job and a custom report', async () => {
  await page.goto('/jobs');
  await page.getByRole('link', { name: new RegExp(`PC0${S}51`) }).click();
  await page.getByRole('link', { name: 'Final report' }).click();
  await page.getByRole('button', { name: 'Generate Word and PDF' }).click();
  await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible({ timeout: 60_000 });
  await page.goto('/reports/new?template=custom');
  await page.getByLabel('Client').selectOption({ label: client() });
  await page.getByLabel('Which findings').selectOption('open');
  await page.getByRole('button', { name: 'Generate Word and PDF' }).click();
  await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `test-results/screens/${S}-report-ready.png` });
});

test('due board lists the next inspection and exports the list', async () => {
  await page.goto('/due?bucket=all');
  await expect(page.getByTestId('due-list')).toContainText(tag());
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export list/ }).click();
  expect((await dl).suggestedFilename()).toMatch(/due-list-.*\.csv/);
  await page.screenshot({ path: `test-results/screens/${S}-due-board.png`, fullPage: true });
});

test('import assets and previous findings from Excel', async () => {
  await page.goto('/import');
  await page.getByLabel('Client').selectOption({ label: client() });
  await page.getByTestId('import-file').setInputFiles(fixture('import-assets.xlsx'));
  await expect(page.getByText(/4 of 4 rows ready/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 4 rows' }).click();
  await expect(page.getByRole('status').filter({ hasText: '4 imported' })).toBeVisible();
  await page.getByLabel('Import', { exact: true }).selectOption('findings');
  await page.getByTestId('import-file').setInputFiles(fixture('import-findings.xlsx'));
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 imported' })).toBeVisible();
  await waitSynced(page);
});

test('search finds a tag in any format', async () => {
  await page.goto('/search');
  await page.getByRole('searchbox', { name: 'Search' }).fill('psv 18111');
  await expect(page.getByText('PSV 18 111-1').first()).toBeVisible();
});

test('admin creates a user', async () => {
  await page.goto('/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByLabel('Full name').fill(`New Inspector ${S}`);
  await page.getByLabel('E-mail (used to sign in)').fill(`new.${S.toLowerCase()}@e2e.test`);
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText(`New Inspector ${S}`)).toBeVisible();
});

test('export everything downloads a ZIP backup', async () => {
  await page.goto('/settings?tab=backup');
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export everything' }).click();
  const f = await dl;
  expect(f.suggestedFilename()).toMatch(/environmsafe-records-export-.*\.zip/);
  await f.saveAs(`test-results/e2e-downloads/${S}-export.zip`);
});
