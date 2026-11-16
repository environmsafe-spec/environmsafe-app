// LOCAL TEST: the real web app served by the Cloudflare Worker (wrangler dev) against a local Postgres.
// Signs in with password + authenticator code, opens the main screens, checks a second user's
// two-step setup. Usage: node e2e/worker-signin.mjs <outDir> <totp secret of the owner>
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const [OUT, SECRET] = process.argv.slice(2)
const BASE = process.env.APP_URL ?? 'http://localhost:8788'
const results = []
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0')
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
await ctx.addInitScript(() => localStorage.setItem('espf.lang', 'en'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE)
await page.getByLabel('Email').fill('akram.demo@es.test')
await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password-123')
await page.getByRole('button', { name: 'Sign in' }).click()
check('wrong password refused', await page.getByText('Invalid email or password').waitFor({ timeout: 8000 }).then(() => true, () => false))

await page.getByRole('textbox', { name: 'Password' }).fill('Demo-pass-2026!')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('6-digit code from your authenticator app').waitFor({ timeout: 10000 })
await page.screenshot({ path: `${OUT}/01-code-step.png` })
check('password alone asks for the authenticator code', true)

await page.locator('input[inputmode="numeric"]').first().click()
await page.keyboard.type(totp(SECRET))
await page.getByText('Cash position').waitFor({ timeout: 15000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/02-home.png`, fullPage: true })
check('signed in with the code: home shows the cash position', true)

await page.goto(`${BASE}/reports`)
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/03-reports.png`, fullPage: true })
check('reports open with data', (await page.locator('body').innerText()).length > 200)

await page.reload()
await page.waitForTimeout(2000)
check('session survives a reload (cookie)', !(await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false)))

// The owner adds an accountant (a role that needs two-step sign-in).
await page.goto(`${BASE}/settings/users`)
await page.getByRole('textbox', { name: 'Email' }).fill('new.accountant@es.test')
await page.getByRole('textbox', { name: 'Full name' }).fill('New Accountant')
await page.getByRole('combobox', { name: 'Role' }).click()
await page.getByRole('option', { name: 'Accountant' }).click()
await page.getByRole('button', { name: 'Give role' }).click()
await page.getByText('One-time password').waitFor({ timeout: 10000 })
const oneTime = (await page.locator('code').first().innerText()).trim()
await page.screenshot({ path: `${OUT}/04-user-added.png`, fullPage: true })
check('owner adds a user and gets a one-time password', /^[A-Za-z0-9-]{14,}$/.test(oneTime))

// The new user signs in and is made to set up two-step sign-in.
await page.locator('header button').last().click()
await page.getByRole('button', { name: 'Sign in' }).waitFor()
await page.getByLabel('Email').fill('new.accountant@es.test')
await page.getByRole('textbox', { name: 'Password' }).fill(oneTime)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.getByText('Set up two-step verification').waitFor({ timeout: 10000 })
await page.getByRole('textbox', { name: 'Password' }).fill(oneTime)
await page.getByRole('button', { name: 'Start' }).click()
await page.getByAltText('QR').waitFor({ timeout: 10000 })
await page.screenshot({ path: `${OUT}/05-two-step-setup.png`, fullPage: true })
const newSecret = (await page.locator('p[dir="ltr"]').first().innerText()).trim()
check('QR code and backup codes shown', (await page.getByText('Save these backup codes').count()) === 1)
await page.locator('input[inputmode="numeric"]').first().click()
await page.keyboard.type(totp(newSecret))
await page.getByText('accountant', { exact: true }).waitFor({ timeout: 15000 })
await page.goto(BASE)
await page.getByText('Cash position').waitFor({ timeout: 15000 })
await page.screenshot({ path: `${OUT}/06-accountant-home.png`, fullPage: true })
check('new accountant is in after the first code', true)

// They change the one-time password.
await page.goto(`${BASE}/settings/account`)
await page.getByRole('textbox', { name: 'Current password' }).fill(oneTime)
await page.getByRole('textbox', { name: /New password \(/ }).fill('Accountant-2026-pass')
await page.getByRole('textbox', { name: 'New password again' }).fill('Accountant-2026-pass')
await page.getByRole('button', { name: 'Change password' }).click()
check('password changed', await page.getByText('Password changed').waitFor({ timeout: 10000 }).then(() => true, () => false))
await page.screenshot({ path: `${OUT}/07-password-changed.png`, fullPage: true })
await browser.close()
console.log(results.join('\n'))
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
