// LOCAL DEMO: drives the real screens through the Phase 2 money flows and screenshots them.
// Needs local-api.mjs (against a database built from the migrations + demo-data.sql) and vite preview.
// Usage: NODE_PATH=$(npm root -g) node e2e/phase2-flow.mjs <outDir>
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:4173'
const OUT = process.argv[2] ?? 'screenshots'
const results = []
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.local`
}
function session(userId, email, aal) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: fakeJwt({ sub: userId, role: 'authenticated', aal, exp, email }), refresh_token: 'local',
    token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: userId, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
}
const browser = await chromium.launch()
async function context(lang, user, mobile = false) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(([l, s]) => { localStorage.setItem('espf.lang', l); localStorage.setItem('sb-127-auth-token', JSON.stringify(s)) }, [lang, session(...user)])
  return ctx
}
const owner = ['00000000-0000-0000-0000-0000000000a1', 'akram@demo.test', 'aal2']
const entry = ['00000000-0000-0000-0000-0000000000a2', 'entry@demo.test', 'aal1']

async function pick(page, locator, text) {
  const input = locator.first()
  await input.click()
  await input.fill(text)
  await page.getByRole('option', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
}
// The button turns to "loading" the moment it is pressed; don't let Playwright retry the click.
async function press(page, name) {
  const b = page.getByRole('button', { name, exact: true }).first()
  await b.waitFor()
  await page.waitForTimeout(350)   // let the "More" panel finish animating
  await b.click({ timeout: 4000 }).catch(() => {})
}
async function statusBadge(page, text) {
  try {
    await page.getByText(text, { exact: true }).first().waitFor({ timeout: 10000 })
  } catch (e) {
    await page.screenshot({ path: `${OUT}/zz-failure.png`, fullPage: true })
    throw e
  }
}

const ctx = await context('en', owner)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// 1. Expense split across two projects, with a fee and a reason instead of a file
await page.goto(`${BASE}/entries/new/expense`)
await page.getByText('Expense (paid now)').first().waitFor()
await pick(page, page.getByLabel('Paid from / into'), 'Kuraimi USD')
await page.getByLabel('Description', { exact: true }).first().fill('Fuel and printer paper')
await pick(page, page.getByPlaceholder('For (account)').nth(0), '6200')
await pick(page, page.getByPlaceholder('Project').nth(0), 'PJ-0004')
await page.getByPlaceholder('Amount USD').nth(0).fill('60')
await page.getByRole('button', { name: 'Split / add line' }).click()
await pick(page, page.getByPlaceholder('For (account)').nth(1), '6800')
await pick(page, page.getByPlaceholder('Project').nth(1), 'PJ-0005')
await page.getByPlaceholder('Amount USD').nth(1).fill('40')
await page.getByRole('button', { name: 'More' }).click()
await page.getByLabel('Bank / remittance fee (USD)').fill('2')
await page.getByLabel('No document? Say why').fill('Cash purchase, receipt lost')
await page.screenshot({ path: `${OUT}/20-expense-form.png`, fullPage: true })
await press(page, 'Save & post')
await statusBadge(page, 'Posted')
await page.getByText('Accounting entry').waitFor()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/21-expense-posted-journal.png`, fullPage: true })
const pv = await page.getByText(/^PV-\d{4}-\d{4}$/).first().textContent()
check('expense posts with a PV number', /^PV-\d{4}-0001$/.test(pv ?? ''), pv)
check('journal shows bank credit 102.00', await page.getByRole('cell', { name: '102.00' }).count() > 0)

// 2. Supplier payment over USD 1,000 goes to approval, owner approves
await page.goto(`${BASE}/entries/new/supplier_payment`)
await page.getByText('Supplier payment').first().waitFor()
await pick(page, page.getByLabel('Paid from / into'), 'Kuraimi USD')
await pick(page, page.getByLabel('Supplier'), 'Gulf Calibration')
await page.getByLabel('Amount (USD)').fill('1500')
await page.getByLabel('Description', { exact: true }).first().fill('Calibration equipment advance')
await page.getByRole('button', { name: 'More' }).click()
await page.getByLabel('No document? Say why').fill('Bank slip to follow')
await press(page, 'Save & post')
await statusBadge(page, 'Waiting for approval')
await page.screenshot({ path: `${OUT}/22-payment-waiting-approval.png`, fullPage: true })
check('payment over USD 1,000 waits for approval', true)
await press(page, 'Approve & post')
await statusBadge(page, 'Posted')
check('owner approval posts the payment', true)

// 3. Transfer USD -> YER at the market rate (FX difference)
await page.goto(`${BASE}/entries/new/transfer`)
await page.getByText('Transfer between accounts').first().waitFor()
await pick(page, page.getByLabel('Paid from / into'), 'Kuraimi USD')
await pick(page, page.getByLabel('To account'), 'Kuraimi YER')
await page.getByLabel('Amount (USD)').fill('500')
await page.getByLabel('Amount received (YER)').fill('770000')
await page.getByRole('button', { name: 'More' }).click()
await page.getByLabel('Bank / remittance fee (USD)').fill('3')
await page.getByLabel('No document? Say why').fill('Internal transfer')
await press(page, 'Save & post')
await statusBadge(page, 'Posted')
await page.getByText('Accounting entry').waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/23-transfer-fx.png`, fullPage: true })
check('transfer posts with FX line', await page.getByText('Foreign exchange gain / loss').count() > 0)

// 4. Expense claim by an employee, then reimbursement that settles it
await page.goto(`${BASE}/entries/new/expense_claim`)
await page.getByText('Expense claim').first().waitFor()
await pick(page, page.getByLabel('Employee / owner'), 'Field Engineer')
await pick(page, page.getByPlaceholder('For (account)').nth(0), '6600')
await pick(page, page.getByPlaceholder('Project').nth(0), 'PJ-0005')
await page.getByPlaceholder('Description').nth(0).fill('Hotel, Hodeidah, 2 nights')
await page.getByPlaceholder('Amount USD').nth(0).fill('180')
await press(page, 'Save & post')
await statusBadge(page, 'Posted')
check('claim posts without bank or file', true)

await page.goto(`${BASE}/entries/new/claim_reimbursement`)
await page.getByText('Claim reimbursement').first().waitFor()
await pick(page, page.getByLabel('Paid from / into'), 'Kuraimi USD')
await pick(page, page.getByLabel('Employee / owner'), 'Field Engineer')
await page.getByText(/^CLM-\d{4}-0001/).waitFor()
await page.getByRole('checkbox').first().check()
await page.getByRole('button', { name: 'More' }).click()
await page.getByLabel('No document? Say why').fill('Paid in cash at office')
await page.screenshot({ path: `${OUT}/24-reimbursement-settles-claim.png`, fullPage: true })
await press(page, 'Save & post')
await statusBadge(page, 'Posted')
check('reimbursement settles the claim', true)

// 5. Void a posted document -> reversal entry
await page.goto(`${BASE}/entries`)
await page.getByText('Fuel and printer paper').first().waitFor({ timeout: 5000 }).catch(() => {})
await page.getByRole('cell', { name: pv }).click()
await page.getByRole('button', { name: 'Void' }).click()
await page.getByRole('dialog').getByRole('textbox').fill('Entered twice')
await page.getByRole('dialog').getByRole('button', { name: 'Void' }).click()
await page.getByText('Reversal entry').waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/25-void-reversal.png`, fullPage: true })
check('void creates a reversal entry', true)

// 6. Entries list and home
await page.goto(`${BASE}/entries`)
await page.getByText(/^TRF-/).first().waitFor()
await page.screenshot({ path: `${OUT}/26-entries-list.png`, fullPage: true })
await page.goto(`${BASE}/`)
await page.getByText('Cash position').waitFor()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/27-home-cash-position.png`, fullPage: true })

// 7. Data entry on a phone, Arabic: draft a payment, cannot post
const m = await context('ar', entry, true)
const mp = await m.newPage()
mp.on('pageerror', (e) => errors.push(e.message))
await mp.goto(`${BASE}/`)
await mp.getByText('دفع', { exact: true }).click()
await mp.getByRole('menuitem', { name: 'مصروف (مدفوع الآن)' }).click()
await mp.getByText('البنود', { exact: true }).waitFor()
await pick(mp, mp.getByLabel('من / إلى حساب'), 'الكريمي ريال')
await pick(mp, mp.getByPlaceholder('البند (الحساب)').nth(0), '6400')
await pick(mp, mp.getByPlaceholder('المشروع').nth(0), 'PJ-0004')
await mp.getByPlaceholder('المبلغ YER').nth(0).fill('31120')
await press(mp, 'حفظ كمسودة')
await mp.getByText('مسودة', { exact: true }).first().waitFor()
await mp.waitForTimeout(500)
await mp.screenshot({ path: `${OUT}/28-mobile-ar-draft.png`, fullPage: true })
check('data entry cannot see the post button', await mp.getByRole('button', { name: 'حفظ وترحيل' }).count() === 0)
await mp.goto(`${BASE}/`)
await mp.getByText('المسودات').waitFor()
await mp.waitForTimeout(600)
await mp.screenshot({ path: `${OUT}/29-mobile-ar-home-inbox.png`, fullPage: true })

await browser.close()
console.log(results.join('\n'))
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
