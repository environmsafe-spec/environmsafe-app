// Read an uploaded voucher (photo or PDF; Arabic or English) with Claude and open a pre-filled DRAFT.
// Nothing is ever posted from here. Same behaviour as the former Supabase Edge Function:
//   POST /api/functions/extract-voucher { company_id, storage_path, file_name }
//   1. the user must have docs.create in the company and the file must be in the company's folder;
//   2. the file goes to Claude (structured JSON output, validated with zod);
//   3. party, bank account, items and the open bill / invoice are matched (shared/voucher.ts);
//   4. the draft, its lines and links, the attachment and the extraction log are written AS THE USER (RLS).
// The Claude key is a Worker secret (ANTHROPIC_API_KEY), never in the browser.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type pg from 'pg'
import { z } from 'zod'
import { planDraft, type Extraction, type MatchContext } from '../../supabase/functions/_shared/voucher.ts'
import { asUser, HttpError, type Claims } from './rest.ts'

const MODEL = 'claude-sonnet-5-5'            // spec: latest Claude Sonnet
const MAX_BYTES = 10 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

const ExtractionSchema = z.object({
  document_kind: z.enum(['payment_out', 'money_received', 'transfer', 'supplier_invoice', 'expense_receipt', 'other']),
  date: z.string().nullable().describe('Document date as YYYY-MM-DD, or null if unreadable'),
  currency: z.enum(['USD', 'SAR', 'YER']).nullable(),
  amount: z.number().nullable().describe('Total paid or received, excluding any fee'),
  fee: z.number().nullable().describe('Bank / remittance / transfer fee, if shown'),
  reference: z.string().nullable().describe('Slip, transfer or receipt number'),
  counterparty_name: z.string().nullable().describe('The other party: who EnvironmSafe paid, who paid EnvironmSafe, or who issued the invoice. Original spelling.'),
  bank_or_company: z.string().nullable().describe('Bank or exchange company that issued the slip'),
  account_number: z.string().nullable().describe("EnvironmSafe's account number if printed"),
  invoice_number: z.string().nullable().describe("The supplier's invoice number, or the invoice being paid"),
  description: z.string().nullable().describe('One short English line saying what this was for'),
  lines: z.array(z.object({
    description: z.string(), quantity: z.number().nullable(), unit: z.string().nullable(),
    unit_price: z.number().nullable(), amount: z.number().nullable(),
  })).describe('Invoice lines; empty for slips and receipts'),
  confidence: z.enum(['high', 'medium', 'low']),
})

const SYSTEM = `You read financial documents for EnvironmSafe For Engineering, Trading, and Services Ltd
(Aden / Sanaa, Yemen; Arabic name انفيرومسيف). Documents are bank slips, remittance receipts (Al Kuraimi,
Al Qutaibi, Tamkeen, Tadhamon...), payment vouchers, shop receipts and supplier invoices, in Arabic or English.

Classify from EnvironmSafe's point of view:
- payment_out: EnvironmSafe paid someone (transfer or cash out to a supplier, person or authority).
- money_received: someone paid EnvironmSafe.
- transfer: money moved between two EnvironmSafe accounts, or currency exchanged for EnvironmSafe.
- supplier_invoice: an invoice or quotation-invoice issued TO EnvironmSafe, with lines.
- expense_receipt: a shop / fuel / office receipt for something EnvironmSafe bought and paid on the spot.
- other: anything else.

Rules: copy numbers exactly as printed (use Western digits; convert Arabic-Indic digits). Amounts are numbers
without thousands separators. Never invent a value: use null when a field is missing or unreadable, and say
confidence "low" if the image is unclear. Currency: USD for dollars ($), SAR for Saudi riyals (ر.س),
YER for Yemeni rials (ر.ي / ريال يمني).`

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function sha256(bytes: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function extractVoucher(req: Request, env: { FILES: R2Bucket; ANTHROPIC_API_KEY?: string; ANTHROPIC_BASE_URL?: string },
                                     client: pg.Client, claims: Claims): Promise<Response> {
  if (claims.role !== 'authenticated') throw new HttpError(401, 'Sign in first')
  const body = await req.json().catch(() => ({})) as { company_id?: string; storage_path?: string; file_name?: string }
  const { company_id: companyId, storage_path: path, file_name: fileName } = body
  if (!companyId || !path) throw new HttpError(400, 'company_id and storage_path are required')
  if (!path.startsWith(`${companyId}/`) || path.includes('..')) throw new HttpError(400, "File is not in this company's folder")

  const q = <T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) => asUser<T>(client, claims, sql, values).then((r) => r.rows)
  const perms = await q<{ permission_code: string }>('select permission_code from public.my_permissions($1)', [companyId])
  if (!perms.some((p) => p.permission_code === 'docs.create')) throw new HttpError(403, 'You cannot create documents in this company')
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'The AI reader is not set up yet (Claude API key missing). Enter the voucher by hand.')

  const obj = await env.FILES.get(path)
  if (!obj) throw new HttpError(404, 'File not found')
  const buf = await obj.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new HttpError(413, 'File is larger than 10 MB')
  const mime = obj.httpMetadata?.contentType || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
  const isPdf = mime === 'application/pdf'
  if (!isPdf && !(IMAGE_TYPES as readonly string[]).includes(mime)) {
    throw new HttpError(415, `Unsupported file type ${mime}. Use a photo (JPEG/PNG) or a PDF.`)
  }

  const log = (row: { status: string; result?: unknown; warnings?: string[]; error?: string; document_id?: string }) =>
    q(`insert into public.ai_extractions (company_id, storage_path, file_name, model, status, result, warnings, error, document_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [companyId, path, fileName ?? null, MODEL, row.status, row.result ?? null, row.warnings ?? [], row.error ?? null, row.document_id ?? null])

  // Ask Claude.
  // ANTHROPIC_BASE_URL is only set in local tests (a stand-in that returns a fixed reading).
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) })
  const data = base64(new Uint8Array(buf))
  const fileBlock: Anthropic.ContentBlockParam = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime as (typeof IMAGE_TYPES)[number], data } }

  let extraction: Extraction
  try {
    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: 'Read this document and return the fields.' }] }],
      output_config: { effort: 'medium', format: zodOutputFormat(ExtractionSchema) },
    })
    if (response.stop_reason === 'refusal') {
      await log({ status: 'refused', error: response.stop_details?.explanation ?? 'refused' })
      return json(422, { error: 'The AI could not process this file. Enter it by hand.' })
    }
    if (!response.parsed_output) {
      await log({ status: 'failed', error: `stop_reason ${response.stop_reason}` })
      return json(422, { error: 'The AI could not read this file. Enter it by hand.' })
    }
    extraction = response.parsed_output
  } catch (e) {
    const msg = e instanceof Anthropic.RateLimitError ? 'The AI service is busy, try again in a minute'
      : e instanceof Anthropic.APIError ? `AI service error ${e.status}` : 'AI service unreachable'
    await log({ status: 'failed', error: msg })
    return json(502, { error: msg })
  }

  // Match against the company's data (read as the user: RLS applies).
  const [parties, moneyAccounts, items, openDocs] = await Promise.all([
    q<MatchContext['parties'][number]>('select id, name_en, name_ar, is_customer, is_supplier, is_employee, is_active from public.parties where company_id = $1', [companyId]),
    q<MatchContext['moneyAccounts'][number]>('select id, name_en, name_ar, currency, bank_name, account_no, is_active from public.money_accounts where company_id = $1', [companyId]),
    q<MatchContext['items'][number]>('select id, name_en, name_ar, is_active from public.items where company_id = $1', [companyId]),
    q<MatchContext['openDocs'][number]>(`select b.id, b.kind::text as kind, b.party_id, d.number, b.currency, b.open_amount::float8 as open_amount
       from public.v_document_balances b join public.documents d on d.id = b.id
      where b.company_id = $1 and b.kind in ('supplier_bill', 'sales_invoice') and b.open_amount > 0`, [companyId]),
  ])
  const plan = planDraft(extraction, { today: new Date().toISOString().slice(0, 10), parties, moneyAccounts, items, openDocs })

  // Write the draft as the user, all in one transaction.
  const d = plan.doc
  const docId = crypto.randomUUID()
  await client.query('begin')
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await client.query('set local role authenticated')
    await client.query(
      `insert into public.documents (id, company_id, kind, source, doc_date, money_account_id, party_id, amount, fee_amount,
                                     reference_no, party_reference, description, notes, currency)
       values ($1, $2, $3, 'ai', $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, 'USD'))`,
      [docId, companyId, plan.kind, d.doc_date, d.money_account_id, d.party_id, d.amount, d.fee_amount, d.reference_no,
       d.party_reference, d.description, `Read by AI from ${fileName ?? 'uploaded file'}. Check before posting.`,
       d.money_account_id ? null : d.currency])
    for (const [i, l] of plan.lines.entries()) {
      await client.query(
        `insert into public.document_lines (company_id, document_id, line_no, line_kind, item_id, description, qty, unit, unit_price, amount)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [companyId, docId, i + 1, l.line_kind, l.item_id, l.description, l.qty, l.unit, l.unit_price, l.amount])
    }
    for (const l of plan.links) {
      await client.query('insert into public.document_links (company_id, from_document_id, to_document_id, amount) values ($1, $2, $3, $4)',
        [companyId, docId, l.to_document_id, l.amount])
    }
    await client.query(
      `insert into public.attachments (company_id, document_id, storage_path, file_name, mime_type, size_bytes, sha256)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [companyId, docId, path, fileName ?? path.split('/').pop(), mime, buf.byteLength, await sha256(buf)])
    await client.query(
      `insert into public.ai_extractions (company_id, storage_path, file_name, model, status, result, warnings, document_id)
       values ($1, $2, $3, $4, 'done', $5, $6, $7)`,
      [companyId, path, fileName ?? null, MODEL, extraction, plan.warnings, docId])
    await client.query('commit')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    await log({ status: 'failed', result: extraction, error: (e as Error).message })
    return json(400, { error: (e as Error).message, extraction })
  }
  return json(200, { document_id: docId, kind: plan.kind, warnings: plan.warnings, extraction })
}
