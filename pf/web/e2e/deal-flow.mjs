// LOCAL SIMULATION: a back-to-back deal through the real screens (Worker + local Postgres copy, never live data).
// Customer request -> RFQs to 3 suppliers -> offers (one in SAR) -> comparison -> quotation +20% -> customer order
// -> order split across 3 suppliers (valves split 3 + 2) -> partial goods receipt -> supplier bill (match warning)
// -> delivery note -> invoice -> close check.
// Usage: node e2e/deal-flow.mjs <outDir> [totp secret file]
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const [OUT, SECRET_FILE = `${process.argv[2]}/totp.txt`] = process.argv.slice(2)
const BASE = process.env.APP_URL ?? 'http://localhost:8788'
const EMAIL = process.env.SIM_EMAIL ?? 'sim.owner@es.test'
const PASSWORD = process.env.SIM_PASSWORD ?? 'Sim-pass-2026!'
const results = []
const check = (n, ok, d = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); console.log(results.at(-1)) }

function totp(secret) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(ctr).digest(); const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0')
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
await ctx.addInitScript(() => localStorage.setItem('espf.lang', 'en'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.url().includes('/api/rest/') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
let shot = 0
const snap = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`, fullPage: true }) }

/** Mantine Select: open it, type, choose the option. */
async function pick(input, text) {
  await input.focus()
  await input.fill(text)
  await page.getByRole('option', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().waitFor({ timeout: 8000 })
    .catch(async (e) => { await page.screenshot({ path: `${OUT}/pick-fail.png` }); console.log('options:', await page.getByRole('option').allInnerTexts()); throw e })
  await page.waitForTimeout(250)
  await input.press('ArrowDown')
  await input.press('Enter')
  await page.waitForTimeout(200)
}
const issue = async (label = 'Save & issue') => {
  await page.getByRole('button', { name: label }).click()
  await page.getByText(/Issued|Posted/).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
}
const docNumber = async () => (await page.locator('h3 + p, h3 ~ *').first().innerText().catch(() => '')).trim()
const nextStep = async (target, { supplier, uncheck = [], currency } = {}) => {
  const single = page.getByRole('button', { name: target, exact: true })
  if (await single.isVisible().catch(() => false)) await single.click()
  else { await page.getByRole('button', { name: 'Next step' }).click(); await page.getByRole('menuitem', { name: target }).click() }
  const modal = page.getByRole('dialog')
  await modal.waitFor()
  for (const u of uncheck) await modal.getByRole('checkbox', { name: new RegExp(u, 'i') }).uncheck()
  if (supplier) await pick(modal.getByRole('combobox', { name: /^Supplier/ }), supplier)
  if (currency) {
    await modal.getByRole('combobox', { name: /^Currency/ }).click()
    await page.getByRole('option', { name: currency, exact: true }).click()
  }
  await modal.getByRole('button', { name: 'Make the draft' }).click()
  await page.waitForURL(/\/entries\/[0-9a-f-]{36}$/)
  await page.waitForTimeout(1500)
}

// ---- sign in (enrol two-step sign-in the first time) ----------------------------------------------
await page.goto(BASE)
await page.getByLabel('Email').fill(EMAIL)
await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
let secret = existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : ''
const start = page.getByRole('button', { name: 'Start' })
if (await start.waitFor({ timeout: 6000 }).then(() => true, () => false)) {
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await start.click()
  const s = page.locator('p[dir="ltr"]').first()
  await s.waitFor()
  secret = (await s.innerText()).trim()
  writeFileSync(SECRET_FILE, secret)
}
await page.locator('input[inputmode="numeric"]').first().click()
await page.keyboard.type(totp(secret))
await page.getByRole('link', { name: 'Deals' }).waitFor({ timeout: 15000 })
check('signed in with two-step code', true)

// ---- 1. the deal and the customer's request --------------------------------------------------------
await page.goto(`${BASE}/deals`)
await page.getByRole('button', { name: 'New deal' }).click()
await pick(page.getByRole('combobox', { name: /^Customer/ }), 'YCSR')
await page.getByRole('textbox', { name: 'What the customer needs' }).fill('Boiler feed pumps and valves')
await page.getByRole('button', { name: 'Start the deal' }).click()
await page.waitForURL(/\/deals\/[0-9a-f-]{36}$/)
const dealUrl = page.url()
await page.getByText('Boiler feed pumps and valves').first().waitFor()
await snap('deal-new')

await page.getByRole('button', { name: 'Customer request' }).click()
await page.waitForURL(/entries\/new\/customer_request/)
await page.waitForTimeout(1200)
const items = () => page.getByRole('combobox', { name: 'Item (product / service)' })
const qtys = () => page.getByRole('textbox', { name: 'Qty' })
await pick(items().nth(0), 'Centrifugal pump'); await qtys().nth(0).fill('2')
await page.getByRole('button', { name: 'Item line' }).click()
await pick(items().nth(1), 'Gate valve'); await qtys().nth(1).fill('5')
await page.getByRole('button', { name: 'Item line' }).click()
await page.getByPlaceholder('Description').nth(2).fill('Mechanical seal kit (as per drawing BFP-12)')
await qtys().nth(2).fill('10')
await page.getByRole('textbox', { name: 'Their reference' }).fill('YCSR-ENQ-2026-311')
await snap('request-draft')
await issue()
const requestUrl = page.url()
check('customer request issued with a description-only line', (await page.locator('body').innerText()).includes('REQ-'))
await snap('request-issued')

// ---- 2. RFQs to three suppliers ---------------------------------------------------------------------
const suppliers = ['Gulf Pumps Trading', 'Saudi Valve Co.', 'Aden Industrial Supplies']
const rfqUrls = []
for (const s of suppliers) {
  await page.goto(requestUrl); await page.waitForTimeout(1500)
  await nextStep('Make RFQ', { supplier: s })
  await issue()
  rfqUrls.push(page.url())
}
check('three RFQs issued', rfqUrls.length === 3)
await snap('rfq-issued')

// ---- 3. offers (Saudi Valve in SAR) -----------------------------------------------------------------
const prices = [[1000, 150, 20], [3600, 600, 70], [1100, 140, 15]]   // pump, valve, seal kit
for (let i = 0; i < 3; i++) {
  await page.goto(rfqUrls[i]); await page.waitForTimeout(1500)
  await nextStep('Enter supplier offer', { currency: i === 1 ? 'SAR' : undefined })
  for (let j = 0; j < 3; j++) await page.getByRole('textbox', { name: 'Unit price' }).nth(j).fill(String(prices[i][j]))
  if (i === 0) await snap('offer-draft')
  await issue()
}
check('three offers recorded', true)

// ---- 4. comparison -> quotation with 20% ------------------------------------------------------------
await page.goto(dealUrl)
await page.getByText('Offers compared').waitFor({ timeout: 10000 })
await snap('deal-offers-compared')
await page.getByRole('button', { name: 'Make quotation from the chosen offers' }).click()
await page.waitForURL(/\/entries\/[0-9a-f-]{36}$/); await page.waitForTimeout(1500)
const qtBody = await page.locator('body').innerText()
check('quotation prices = cheapest offer + 20%', qtBody.includes('margin 20%'))
check('quotation is in the customer\'s currency (USD) although one chosen offer is in SAR', /Unit price USD/.test(qtBody) || qtBody.includes('USD'))
// the seal kit was requested as text only: the quotation needs a catalogue item
await pick(items().nth(2), 'Mechanical seal kit')
await snap('quotation-draft')
await issue()
await snap('quotation-issued')

// ---- 5. customer order ------------------------------------------------------------------------------
await nextStep('Customer order')
await page.getByRole('textbox', { name: 'Their reference' }).fill('YCSR-PO-8841')
await issue()
const soUrl = page.url()
await snap('customer-order')

// ---- 6. split purchasing ----------------------------------------------------------------------------
await nextStep('Make purchase order', { supplier: 'Gulf Pumps Trading', uncheck: ['Gate valve', 'seal kit'] })
await snap('po-pumps-draft')
await issue()
await page.goto(soUrl); await page.waitForTimeout(1500)
await nextStep('Make purchase order', { supplier: 'Aden Industrial Supplies', uncheck: ['Centrifugal pump'] })
await qtys().nth(0).fill('3')          // 3 of the 5 valves here
await issue()
const poAdenUrl = page.url()
await page.goto(soUrl); await page.waitForTimeout(1500)
await nextStep('Make purchase order', { supplier: 'Saudi Valve Co.', uncheck: ['Centrifugal pump', 'seal kit'], currency: 'SAR' })
const sarQty = await qtys().nth(0).inputValue()
const sarPrice = await page.getByRole('textbox', { name: 'Unit price' }).nth(0).inputValue()
const sarCcy = await page.getByRole('combobox', { name: /^Currency/ }).inputValue()
check('second valve PO takes only the 2 still open, at Saudi Valve\'s SAR price', sarQty === '2' && sarCcy === 'SAR' && sarPrice.startsWith('600'), `${sarQty} @ ${sarPrice} ${sarCcy}`)
await snap('po-valves-sar-draft')
await issue()
await page.goto(dealUrl); await page.getByText('Progress of each ordered line').waitFor({ timeout: 10000 })
await snap('deal-purchasing')

// ---- 7. partial receipt and the supplier bill -------------------------------------------------------
await page.goto(poAdenUrl); await page.waitForTimeout(1500)
await nextStep('Receive goods')
await qtys().nth(1).fill('6')          // 6 of 10 seal kits arrived
await issue()
await snap('goods-receipt')
await page.goto(poAdenUrl); await page.waitForTimeout(1500)
await nextStep('Make supplier bill')
await page.getByRole('textbox', { name: 'Their reference' }).fill('AIS-INV-5521')
await page.waitForTimeout(1500)
const billBody = await page.locator('body').innerText()
check('bill shows the three-way-match warning (billed 10, received 6)', billBody.includes('Billed 10 but received 6'))
await snap('bill-match-warning')

// ---- 8. delivery and invoice ------------------------------------------------------------------------
await page.goto(soUrl); await page.waitForTimeout(1500)
await nextStep('Make delivery note')
await issue()
await snap('delivery-note')
await nextStep('Make invoice')
await page.getByRole('button', { name: 'Save & post' }).click()
await page.getByText('Posted').first().waitFor({ timeout: 15000 })
await snap('invoice-posted')

await page.goto(dealUrl); await page.getByText('Close the deal').first().waitFor()
await snap('deal-invoiced')
const dealBody = await page.locator('body').innerText()
check('deal stage is Invoiced', dealBody.includes('Invoiced'))
check('open items listed before closing', dealBody.includes('not yet received'))

// ---- 9. the deals list and a finished deal (scenarios C-G are loaded by the database scenario file) ----
await page.goto(`${BASE}/deals`); await page.getByText('Boiler feed pumps and valves').waitFor()
await page.getByText('All', { exact: true }).click()
await snap('deals-list')
const won = page.getByText('C: feed pump, imported')
if (await won.isVisible().catch(() => false)) {
  await won.click(); await page.getByText('Documents of this deal').waitFor()
  await snap('deal-c-won')
}
await page.goto(`${BASE}/deals`)
await page.getByRole('button', { name: 'العربية' }).click().catch(() => {})
await page.waitForTimeout(800)
await snap('deals-list-ar')

await browser.close()
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0)
