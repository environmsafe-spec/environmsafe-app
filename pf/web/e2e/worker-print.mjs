// LOCAL TEST: print a posted invoice in the browser (pdf-lib) through the Worker; the copy is stored.
// Usage: node e2e/worker-print.mjs <outDir> <totp secret> <document id>
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [OUT, SECRET, DOC] = process.argv.slice(2)
const BASE = process.env.APP_URL ?? 'http://localhost:8788'
function totp(secret) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(ctr).digest(); const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0')
}
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
await ctx.addInitScript(() => localStorage.setItem('espf.lang', 'en'))
const page = await ctx.newPage()
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE)
await page.getByLabel('Email').fill('akram.demo@es.test')
await page.getByRole('textbox', { name: 'Password' }).fill('Demo-pass-2026!')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.locator('input[inputmode="numeric"]').first().waitFor()
await page.locator('input[inputmode="numeric"]').first().click()
await page.keyboard.type(totp(SECRET))
await page.getByText('Cash position').waitFor({ timeout: 15000 })
await page.goto(`${BASE}/entries/${DOC}`)
await page.waitForTimeout(2500)
const popup = ctx.waitForEvent('page', { timeout: 20000 })
await page.getByRole('button', { name: /Print/ }).first().click()
const tab = await popup
await tab.waitForLoadState().catch(() => {})
await page.waitForTimeout(2500)
console.log('pdf tab url:', tab.url().slice(0, 30))
await page.screenshot({ path: `${OUT}/print-after.png`, fullPage: true })
await browser.close()
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
