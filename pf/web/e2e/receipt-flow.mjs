// LOCAL SIMULATION (brief v2 A3/A4): receive YER from a customer against a USD invoice through the real form,
// then a receipt with no invoice (customer advance) applied afterwards. Local copy only, never live data.
// Usage: node e2e/receipt-flow.mjs <outDir>   (after e2e/deal-flow.mjs has enrolled the sim user: <outDir>/totp.txt)
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const OUT = process.argv[2]
const BASE = process.env.APP_URL ?? 'http://localhost:8788'
const results = []
const check = (n, ok, d = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); console.log(results.at(-1)) }
function totp(secret) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''
  for (const c of secret.toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0')
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
let shot = 30
const snap = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${++shot}-${name}.png`, fullPage: true }) }
async function pick(input, text) {
  await input.focus(); await input.fill(text)
  await page.getByRole('option', { name: new RegExp(text, 'i') }).first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(250); await input.press('ArrowDown'); await input.press('Enter'); await page.waitForTimeout(300)
}

await page.goto(BASE)
await page.getByLabel('Email').fill('sim.owner@es.test')
await page.getByRole('textbox', { name: 'Password' }).fill('Sim-pass-2026!')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.locator('input[inputmode="numeric"]').first().click()
await page.keyboard.type(totp(readFileSync(`${OUT}/totp.txt`, 'utf8').trim()))
await page.getByRole('link', { name: 'Deals' }).waitFor({ timeout: 15000 })

// ---- A4: a YER receipt settles a USD invoice ----------------------------------------------------------
await page.goto(`${BASE}/entries/new/customer_receipt`); await page.waitForTimeout(1500)
await pick(page.getByRole('combobox', { name: /^Paid from/ }), 'T Kuraimi YER')
await pick(page.getByRole('combobox', { name: /^Customer/ }), 'T Customer')
await page.getByText('INV-2026112004').waitFor({ timeout: 10000 })
await page.getByRole('checkbox', { name: 'INV-2026112004' }).check()
await page.waitForTimeout(500)
const yer = await page.getByRole('textbox', { name: /paid in YER INV-2026112004/ }).inputValue()
check('ticking a USD invoice proposes the YER amount at today\'s rate', yer.replace(/,/g, '') === '3890000', yer)
const proj = await page.getByRole('combobox', { name: /^Project/ }).inputValue()
check('the project comes from the invoice', proj.includes('E: boiler inspection'), proj)
await page.getByRole('button', { name: /More/ }).click()
await page.getByRole('textbox', { name: 'No document? Say why' }).fill('simulation')
await snap('receipt-yer-for-usd-invoice')
await page.getByRole('button', { name: 'Save & post' }).click()
await page.getByText(/^Posted$/).first().waitFor({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1500)
const body = await page.locator('body').innerText()
check('the YER receipt posts', /Posted|Waiting for approval/.test(body))
await snap('receipt-posted')

// ---- A3: a receipt with no invoice is a customer advance, applied afterwards ---------------------------
await page.goto(`${BASE}/entries/new/customer_receipt`); await page.waitForTimeout(1500)
await pick(page.getByRole('combobox', { name: /^Paid from/ }), 'T Kuraimi USD')
await pick(page.getByRole('combobox', { name: /^Customer/ }), 'T Customer')
await page.getByRole('textbox', { name: /^Amount/ }).fill('300')
await pick(page.getByRole('combobox', { name: /^Project/ }), 'G: valves')
await page.waitForTimeout(500)
check('the form says the money is held as a customer advance', (await page.locator('body').innerText()).includes('held as a customer advance'))
await page.getByRole('button', { name: /More/ }).click()
await page.getByRole('textbox', { name: 'No document? Say why' }).fill('simulation')
await page.getByRole('button', { name: 'Save & post' }).click()
await page.getByText('not yet applied to a bill / invoice').waitFor({ timeout: 15000 })
await snap('advance-to-apply')
await page.getByRole('button', { name: 'Apply' }).first().click()
await page.getByText('Applied afterwards').waitFor({ timeout: 10000 }).catch(() => {})
await page.waitForTimeout(1000)
check('the advance is applied to an open invoice and can be undone', (await page.locator('body').innerText()).includes('Undo'))
await snap('advance-applied')

await browser.close()
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
console.log(results.join('\n'))
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0)
