// LOCAL DEMO: open every report on demo-activity.sql data, check the built-in tie-outs, screenshot.
// Usage: NODE_PATH=$(npm root -g) node e2e/phase4-reports.mjs <outDir>
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:4173'
const OUT = process.argv[2] ?? 'screenshots'
const results = []
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 3600
const sess = { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: '00000000-0000-0000-0000-0000000000a1', role: 'authenticated', aal: 'aal2', exp })}.x`,
  refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: exp,
  user: { id: '00000000-0000-0000-0000-0000000000a1', email: 'akram@demo.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript((s) => { localStorage.setItem('espf.lang', 'en'); localStorage.setItem('sb-127-auth-token', JSON.stringify(s)) }, sess)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.url().includes(':8787') && r.status() >= 400 && !r.url().includes('/auth/') && !r.url().includes('/storage/')) errors.push(`${r.status()} ${r.url()}`) })

async function setFrom(v) { await page.getByLabel('From').first().fill(v) }
async function shot(path, file, wait, before) {
  await page.goto(BASE + path)
  if (before) await before()
  await page.getByText(wait).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true })
}

await shot('/reports/pl', '40-profit-loss', 'Profit for the period', () => setFrom('2026-01-01'))
check('P&L shows the year profit 28,279.30', await page.getByRole('cell', { name: '28,279.30' }).count() > 0)
await page.getByText('By month').click(); await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/41-profit-loss-monthly.png`, fullPage: true })
await shot('/reports/bs', '42-balance-sheet', 'Total liabilities and equity')
check('balance sheet balances', await page.getByText('Balanced: assets = liabilities + equity').count() > 0)
await shot('/reports/cf', '43-cash-flow', 'Cash at the end', () => setFrom('2026-01-01'))
check('cash flow ties to bank and cash balances', await page.getByText('Ties to the bank and cash balances').count() > 0)
await shot('/reports/equity', '44-changes-in-equity', 'Retained earnings', () => setFrom('2026-01-01'))
await shot('/reports/tb', '45-trial-balance', 'Debits = credits', () => setFrom('2026-01-01'))
check('trial balance balances', await page.getByText('Debits = credits').count() > 0)
await page.getByRole('cell', { name: /^1000-001/ }).click()
await page.getByRole('cell', { name: 'Capital paid in' }).first().waitFor()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/46-general-ledger-drilldown.png`, fullPage: true })
check('trial balance drills down to the ledger', page.url().includes('/reports/gl?account='))
await shot('/reports/projects', '47-project-pl', 'YCSR PSV inspection', () => setFrom('2026-01-01'))
check('project P&L: YCSR margin 11,400 - 4,200 - 240 = 6,960', await page.getByRole('cell', { name: '6,960.00' }).count() > 0)
await shot('/reports/balances', '48-employee-owner-balances', 'Field Engineer')
await shot('/reports/assets', '49-fixed-assets', 'Dead-weight tester')
check('asset register: 7 months of depreciation (700) on the bench', await page.getByRole('cell', { name: '700.00' }).count() > 0)
await page.goto(BASE + '/reports/bank')
await page.getByRole('combobox', { name: 'Paid from / into' }).click(); await page.getByRole('option', { name: /Kuraimi USD/ }).click()
await page.getByRole('cell', { name: 'Opening balance' }).first().waitFor()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/50-bank-book.png`, fullPage: true })
await shot('/reports/audit', '51-audit-pack', 'Build ZIP')
const dl = page.waitForEvent('download')
await page.getByRole('button', { name: 'Build ZIP' }).click()
const file = await dl
await file.saveAs(`${OUT}/audit-pack-demo.zip`)
check('audit pack ZIP downloads', true, file.suggestedFilename())
await browser.close()
console.log(results.join('\n'))
console.log(errors.length ? `PAGE ERRORS:\n${[...new Set(errors)].join('\n')}` : 'no page errors')
