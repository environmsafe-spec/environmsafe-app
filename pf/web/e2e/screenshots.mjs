// LOCAL DEMO: signs in as a demo user (by planting a session) and screenshots the main screens.
// Usage: node e2e/screenshots.mjs <outDir>   (needs local-api.mjs + vite preview running)
import { createRequire } from 'node:module'
// Uses the machine's preinstalled Playwright (not a project dependency).
const { chromium } = createRequire(import.meta.url)('playwright')

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:4173'
const OUT = process.argv[2] ?? 'screenshots'

function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.local`
}

function session(userId, email, aal) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: fakeJwt({ sub: userId, role: 'authenticated', aal, exp, email }),
    refresh_token: 'local', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: userId, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}

const browser = await chromium.launch()
const errors = []

async function shoot(ctx, path, file, waitText) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`))
  page.on('response', (r) => { if (r.url().includes('8787') && r.status() >= 400 && !r.url().includes('/auth/')) errors.push(`${path}: ${r.status()} ${r.url()}`) })
  await page.goto(BASE + path)
  if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true })
  await page.close()
}

async function context({ lang, user, mobile }) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(([lang, s]) => {
    localStorage.setItem('espf.lang', lang)
    if (s) localStorage.setItem('sb-127-auth-token', JSON.stringify(s))
  }, [lang, user ? session(...user) : null])
  return ctx
}

const owner = ['00000000-0000-0000-0000-0000000000a1', 'akram@demo.test', 'aal2']
const ownerNoMfa = ['00000000-0000-0000-0000-0000000000a1', 'akram@demo.test', 'aal1']
const entry = ['00000000-0000-0000-0000-0000000000a2', 'entry@demo.test', 'aal1']

let ctx = await context({ lang: 'en' })
await shoot(ctx, '/', '01-login-en', 'Sign in')
ctx = await context({ lang: 'ar' })
await shoot(ctx, '/', '02-login-ar', 'تسجيل الدخول')

ctx = await context({ lang: 'en', user: owner })
await shoot(ctx, '/', '03-home-owner', 'Upload voucher')
await shoot(ctx, '/projects', '04-projects', 'UNHCR generator maintenance 2026')
await shoot(ctx, '/procurement/suppliers', '05-suppliers', 'Gulf Calibration Services')
await shoot(ctx, '/procurement/items', '06-items', 'Oil filter')
await shoot(ctx, '/settings/accounts', '07-money-accounts', 'Kuraimi USD')
await shoot(ctx, '/settings/coa', '08-chart-of-accounts', 'Accounts receivable')
await shoot(ctx, '/settings/periods', '09-periods', 'January')
await shoot(ctx, '/settings/users', '10-users', 'Akram (demo owner)')
await shoot(ctx, '/settings/audit', '11-audit-log', 'INSERT')

// Edit form
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/projects')
  await page.getByText('YCSR PSV inspection and calibration').click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/12-project-edit.png` })
  await page.close()
}

ctx = await context({ lang: 'en', user: ownerNoMfa })
await shoot(ctx, '/', '13-owner-needs-mfa', 'Two-step verification')

ctx = await context({ lang: 'ar', user: entry, mobile: true })
await shoot(ctx, '/', '14-mobile-ar-data-entry-home', 'رفع سند')
await shoot(ctx, '/procurement/suppliers', '15-mobile-ar-suppliers', 'القطيبي للصرافة')

await browser.close()
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors')
