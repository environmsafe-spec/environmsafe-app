// LOCAL DEMO: procurement and sales flows on the real screens (needs local-api.mjs + vite preview).
// Usage: NODE_PATH=$(npm root -g) node e2e/phase3-flow.mjs <outDir>
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:4173'
const OUT = process.argv[2] ?? 'screenshots'
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)

function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.local`
}
function session(userId, email, aal) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: fakeJwt({ sub: userId, role: 'authenticated', aal, exp, email }), refresh_token: 'local', token_type: 'bearer',
    expires_in: 3600, expires_at: exp,
    user: { id: userId, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript((s) => { localStorage.setItem('espf.lang', 'en'); localStorage.setItem('sb-127-auth-token', JSON.stringify(s)) },
  session('00000000-0000-0000-0000-0000000000a1', 'akram@demo.test', 'aal2'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function pick(locator, text) {
  const input = locator.first()
  await input.click()
  await input.fill(text)
  await page.getByRole('option', { name: new RegExp(esc(text)) }).first().click()
}
async function press(name) {
  const b = page.getByRole('button', { name, exact: true }).first()
  await b.waitFor()
  await page.waitForTimeout(350)
  await b.click({ timeout: 4000 }).catch(() => {})
}
async function badge(text) {
  // The status badge (upper-case) — not a toast that says the same word.
  try { await page.locator('.mantine-Badge-root', { hasText: new RegExp(`^${esc(text)}`, 'i') }).first().waitFor({ timeout: 10000 }) }
  catch (e) { await page.screenshot({ path: `${OUT}/zz-failure.png`, fullPage: true }); throw e }
}

// 1. Purchase order from Home -> "Bill / Invoice", with an item created on the spot, tax 5%
await page.goto(`${BASE}/`)
await page.getByText('Bill / Invoice', { exact: true }).click()
await page.getByRole('menuitem', { name: 'Purchase order' }).click()
await page.getByText('Purchase order').first().waitFor()
await pick(page.getByLabel('Supplier'), 'Gulf Calibration')
await page.getByLabel('Their reference').fill('GCS-Q-2026-118')
await page.getByLabel('Attn (contact person)').fill('Mr. Faisal, Sales')
await page.getByPlaceholder('Item (product / service)').first().click()
await page.getByRole('option', { name: '+ New item' }).click()
await page.getByRole('dialog').getByLabel('Name (English)').fill('Pressure gauge 0-10 bar, 4"')
await page.getByRole('dialog').getByText('Goods').click()
await page.getByRole('dialog').getByLabel('Unit').fill('pc')
await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
await page.getByRole('dialog').waitFor({ state: 'hidden' })
await page.getByPlaceholder('Detail (2nd line, optional)').first().fill('Glycerine filled, 1/2" NPT bottom, with calibration certificate')
await page.getByPlaceholder('Qty').first().fill('10')
await page.getByPlaceholder('Unit price USD').first().fill('38.5')
await page.getByRole('button', { name: 'Tax' }).click()
await page.screenshot({ path: `${OUT}/30-po-form.png`, fullPage: true })
const totalText = await page.getByRole('cell', { name: /^404\.25/ }).count()
check('PO total computed on screen (10 x 38.50 + 5% = 404.25)', totalText > 0)
await press('Save & issue')
await badge('Issued')
const poNumber = (await page.getByText(/^\d{10}$/).first().textContent())?.trim()
check('PO issued with number YYYYMMDDNN', /^\d{10}$/.test(poNumber ?? ''), poNumber)
await page.screenshot({ path: `${OUT}/31-po-issued.png`, fullPage: true })

// 2. Supplier bill from the PO, posted to an account and project
await press('Create supplier bill')
await page.getByText('Supplier bill').first().waitFor()
await page.getByText('Draft').first().waitFor()
await pick(page.getByLabel('Account').or(page.getByPlaceholder('Account (from item)')), '5200')
await pick(page.getByPlaceholder('Project'), 'PJ-0005')
await page.getByLabel('Their reference').fill('GCS-INV-5521')
await press('Save & post')
await badge('Posted')
await page.getByText('Accounting entry').waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/32-bill-posted.png`, fullPage: true })
check('bill posted with BILL number', await page.getByText(/^BILL-\d{4}-0001$/).count() > 0)

// 3. Pay the bill: the open bill is offered for settlement
await page.goto(`${BASE}/entries/new/supplier_payment`)
await page.getByText('Supplier payment').first().waitFor()
await pick(page.getByLabel('Paid from / into'), 'Kuraimi USD')
await pick(page.getByLabel('Supplier'), 'Gulf Calibration')
await page.getByText(/^BILL-\d{4}-0001/).waitFor()
await page.getByRole('checkbox').first().check()
await page.getByRole('button', { name: 'More' }).click()
await page.getByLabel('No document? Say why').fill('Bank slip to follow')
await page.screenshot({ path: `${OUT}/33-payment-settles-bill.png`, fullPage: true })
await press('Save & post')
await badge('Posted')
check('payment settles the bill', true)
await page.goto(`${BASE}/reports/ap`)
await page.getByText('AP aging (suppliers)').first().waitFor()
await page.waitForTimeout(500)
check('paid bill no longer in AP aging', await page.getByText('Nothing open.').count() > 0)

// 4. Quotation -> invoice -> part payment -> AR aging
await page.goto(`${BASE}/entries/new/quotation`)
await page.getByText('Quotation').first().waitFor()
await pick(page.getByLabel('Customer'), 'YCSR')
await pick(page.getByPlaceholder('Item (product / service)'), 'PSV calibration')
await page.getByPlaceholder('Qty').first().fill('12')
await page.getByPlaceholder('Unit price USD').first().fill('95')
await press('Save & issue')
await badge('Issued')
check('quotation issued', await page.getByText(/^QT-\d{4}-0001$/).count() > 0)
await press('Create invoice')
await page.getByText('Sales invoice').first().waitFor()
await page.getByText('Draft').first().waitFor()
await pick(page.getByPlaceholder('Account (from item)'), '4100')
await pick(page.getByPlaceholder('Project'), 'PJ-0005')
await press('Save & post')
await badge('Posted')
await page.getByText('Accounting entry').waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/34-invoice-posted.png`, fullPage: true })
const inv = await page.getByText(/^INV-\d{10}$/).first().textContent()
check('invoice numbered INV-YYYYMMDDNN', /^INV-\d{10}$/.test(inv ?? ''), inv)

await page.goto(`${BASE}/entries/new/customer_receipt`)
await page.getByText('Customer receipt').first().waitFor()
await pick(page.getByLabel('Paid from / into'), 'Kuraimi USD')
await pick(page.getByLabel('Customer'), 'YCSR')
await page.getByText(/^INV-\d{10}/).waitFor()
await page.getByRole('checkbox').first().check()
await page.getByRole('textbox', { name: 'Amount (USD)' }).fill('600')
await page.getByLabel(/^Settles INV-/).fill('600')
await page.getByRole('button', { name: 'More' }).click()
await page.getByLabel('No document? Say why').fill('Cheque deposited')
await press('Save & post')
await badge('Posted')
await page.goto(`${BASE}/reports/ar`)
await page.getByText('AR aging (customers)').first().waitFor()
await page.getByText(/^INV-\d{10}$/).first().waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/35-ar-aging.png`, fullPage: true })
check('invoice open for 540.00 in AR aging', await page.getByRole('cell', { name: '540.00 USD' }).count() > 0)

// 5. Sales list
await page.goto(`${BASE}/sales/invoices`)
await page.getByText(/^INV-\d{10}$/).first().waitFor()
await page.screenshot({ path: `${OUT}/36-sales-invoices.png`, fullPage: true })

await browser.close()
console.log(results.join('\n'))
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
