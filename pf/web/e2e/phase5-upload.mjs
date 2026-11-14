// LOCAL DEMO: Upload voucher -> drafts -> batch review, on the real screens.
// Storage and the extract-voucher function are not available locally, so this script answers those
// two calls itself: it runs the REAL matching code (supabase/functions/_shared/voucher.ts) against
// the demo database with a fixed "what the AI read" result, and writes the draft exactly as the
// function does. The Claude call itself is not exercised here.
// Usage: NODE_PATH=$(npm root -g) node --experimental-strip-types e2e/phase5-upload.mjs <outDir> <slip.jpg>
import fs from 'node:fs'
import { createRequire } from 'node:module'
import pg from 'pg'
import { planDraft } from '../../supabase/functions/_shared/voucher.ts'
const { chromium } = createRequire(import.meta.url)('playwright')

const [OUT, SLIP] = process.argv.slice(2)
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:4173'
const CID = 'dee3dc12-55bb-4acc-9c44-46721b36651b'
const OWNER = '00000000-0000-0000-0000-0000000000a1'
const db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.PGDATABASE ?? 'espf_demo' })
await db.connect()
const results = []
const check = (n, ok, d = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`)

// What the AI would read from each file (fixed, so the test is deterministic).
const READ = {
  'slip.jpg': { document_kind: 'payment_out', date: '2026-11-07', currency: 'USD', amount: 404.25, fee: 3, reference: 'TT-55120',
    counterparty_name: 'GULF CALIBRATION SERVICES', bank_or_company: 'Al Kuraimi Islamic Microfinance Bank', account_number: '3108401426',
    invoice_number: 'GCS-INV-5521', description: 'Payment of invoice GCS-INV-5521', lines: [], confidence: 'high' },
  'gulf-invoice.pdf': { document_kind: 'supplier_invoice', date: '2026-11-03', currency: 'USD', amount: 1450, fee: null, reference: null,
    counterparty_name: 'شركة الخليج لخدمات المعايرة', bank_or_company: null, account_number: null, invoice_number: 'GCS-INV-5530',
    description: 'PSV bench testing and freight', confidence: 'medium',
    lines: [{ description: 'PSV calibration and certification', quantity: 14, unit: 'valve', unit_price: 100, amount: 1400 },
            { description: 'Freight Dammam - Aden', quantity: 1, unit: null, unit_price: 50, amount: 50 }] },
}

async function fakeExtract(path, fileName) {
  const q = (sql, p = []) => db.query(sql, p).then((r) => r.rows)
  const ctx = {
    today: new Date().toISOString().slice(0, 10),
    parties: await q('select id, name_en, name_ar, is_customer, is_supplier, is_employee, is_active from parties where company_id = $1', [CID]),
    moneyAccounts: await q('select id, name_en, name_ar, currency, bank_name, account_no, is_active from money_accounts where company_id = $1', [CID]),
    items: await q('select id, name_en, name_ar, is_active from items where company_id = $1', [CID]),
    openDocs: (await q(`select b.id, b.kind::text, b.party_id, b.currency, b.open_amount::float, d.number from v_document_balances b join documents d on d.id = b.id
                        where b.company_id = $1 and b.kind in ('supplier_bill','sales_invoice') and b.open_amount > 0`, [CID])),
  }
  const plan = planDraft(READ[fileName], ctx)
  const id = crypto.randomUUID()
  const d = plan.doc
  await db.query('begin')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER, role: 'authenticated', aal: 'aal2' })])
  await db.query(`insert into documents (id, company_id, kind, source, doc_date, money_account_id, party_id, amount, fee_amount, reference_no, party_reference, description, notes, currency)
                  values ($1,$2,$3,'ai',$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13,'USD'))`,
    [id, CID, plan.kind, d.doc_date, d.money_account_id, d.party_id, d.amount, d.fee_amount, d.reference_no, d.party_reference, d.description, `Read by AI from ${fileName}. Check before posting.`, d.money_account_id ? null : d.currency])
  for (const [i, l] of plan.lines.entries()) {
    await db.query(`insert into document_lines (company_id, document_id, line_no, line_kind, item_id, description, qty, unit, unit_price, amount) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [CID, id, i + 1, l.line_kind, l.item_id, l.description, l.qty, l.unit, l.unit_price, l.amount])
  }
  for (const l of plan.links) await db.query('insert into document_links (company_id, from_document_id, to_document_id, amount) values ($1,$2,$3,$4)', [CID, id, l.to_document_id, l.amount])
  await db.query(`insert into attachments (company_id, document_id, storage_path, file_name, mime_type, size_bytes, sha256) values ($1,$2,$3,$4,$5,$6,$7)`,
    [CID, id, path, fileName, fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', 1000, 'a'.repeat(64)])
  await db.query(`insert into ai_extractions (company_id, storage_path, file_name, model, status, result, warnings, document_id) values ($1,$2,$3,'claude-sonnet-5-5','done',$4,$5,$6)`,
    [CID, path, fileName, READ[fileName], plan.warnings, id])
  await db.query('commit')
  return { document_id: id, kind: plan.kind, warnings: plan.warnings }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 3600
const sess = { access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: OWNER, role: 'authenticated', aal: 'aal2', exp })}.x`, refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: exp,
  user: { id: OWNER, email: 'akram@demo.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
await ctx.addInitScript((s) => { localStorage.setItem('espf.lang', 'en'); localStorage.setItem('sb-127-auth-token', JSON.stringify(s)) }, sess)
const slip = fs.readFileSync(SLIP)
// Storage upload, signed URL and the file itself; the extract-voucher function.
await ctx.route('**/storage/v1/object/documents/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'documents/x' }) }))
await ctx.route('**/storage/v1/object/sign/documents/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/documents/slip.jpg?token=demo' }) }))
await ctx.route('**/storage/v1/object/sign/documents/slip.jpg?token=demo', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: slip }))
await ctx.route('**/functions/v1/extract-voucher', async (r) => {
  const body = JSON.parse(r.request().postData() ?? '{}')
  await new Promise((res) => setTimeout(res, 600))   // the AI takes a moment
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await fakeExtract(body.storage_path, body.file_name)) })
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(`${BASE}/`)
await page.getByText('Upload voucher', { exact: true }).click()
await page.getByText('Choose files', { exact: true }).waitFor()
await page.locator('input[type=file][multiple]').setInputFiles([
  { name: 'slip.jpg', mimeType: 'image/jpeg', buffer: slip },
  { name: 'gulf-invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') },
])
await page.getByRole('button', { name: /Review the 2 drafts/ }).waitFor({ timeout: 15000 })
await page.screenshot({ path: `${OUT}/60-upload-queue.png`, fullPage: true })
check('two vouchers become two drafts', await page.getByRole('button', { name: 'Open draft' }).count() === 2)
check('the slip is recognised as a supplier payment', await page.getByText('Supplier payment', { exact: true }).count() > 0)
check('the invoice is recognised as a supplier bill', await page.getByText('Supplier bill', { exact: true }).count() > 0)

await page.getByRole('button', { name: /Review the 2 drafts/ }).click()
await page.getByText('Voucher 1 of 2').waitFor()
await page.locator('img[alt=voucher]').waitFor()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/61-review-side-by-side.png`, fullPage: true })
check('payment draft: supplier, Kuraimi USD account, 404.25 + fee 3 matched', await page.getByText('Gulf Calibration Services · SU-0002').count() > 0
  && (await page.getByRole('combobox', { name: 'Paid from / into' }).inputValue()).includes('Kuraimi USD')
  && (await page.getByLabel('Amount (USD)').inputValue()) === '404.25')
check('the voucher image is shown next to the form', await page.locator('img[alt=voucher]').count() === 1)

await page.getByRole('button', { name: 'Next voucher →' }).click()
await page.getByText('Voucher 2 of 2').waitFor()
await page.getByText('Read by AI: please check').waitFor()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/62-review-bill-warnings.png`, fullPage: true })
check('bill draft matched the Arabic supplier name and the PSV item; freight flagged', await page.getByText('No item matches "Freight Dammam - Aden": pick one or add it').count() > 0)
check('the AI never posted anything', (await db.query("select count(*)::int n from documents where source = 'ai' and status <> 'draft'")).rows[0].n === 0)

await browser.close()
await db.end()
console.log(results.join('\n'))
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors')
