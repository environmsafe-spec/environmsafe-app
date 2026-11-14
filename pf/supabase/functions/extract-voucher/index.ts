// Supabase Edge Function: read an uploaded voucher (photo or PDF; Arabic or English) with Claude and
// open a pre-filled DRAFT. Nothing is ever posted from here.
//
// POST { company_id, storage_path, file_name }  (Authorization: the user's JWT)
//   1. checks the user may create documents in that company and the file is in the company's folder;
//   2. sends the file to Claude (structured JSON output, validated with zod);
//   3. matches party, bank account, items and the open bill / invoice (../_shared/voucher.ts);
//   4. creates the draft, its lines and settlement links, attaches the file, logs the extraction.
// Returns { document_id, kind, warnings, extraction }.
//
// Secrets (env): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, APP_URL.
// The Claude API key lives only here, never in the browser.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.6.0/helpers/zod'
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { z } from 'npm:zod@4.6.7'
import { planDraft, type Extraction, type MatchContext } from '../_shared/voucher.ts'

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

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })

  let body: { company_id?: string; storage_path?: string; file_name?: string }
  try { body = await req.json() } catch { return json(400, { error: 'Body must be JSON' }) }
  const { company_id: companyId, storage_path: path, file_name: fileName } = body
  if (!companyId || !path) return json(400, { error: 'company_id and storage_path are required' })
  if (!path.startsWith(`${companyId}/`) || path.includes('..')) return json(400, { error: 'File is not in this company\'s folder' })

  const url = Deno.env.get('SUPABASE_URL')!
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const perms = await user.rpc('my_permissions', { p_company: companyId })
  if (perms.error || !(perms.data ?? []).some((p: { permission_code: string }) => p.permission_code === 'docs.create')) {
    return json(403, { error: 'You cannot create documents in this company' })
  }

  // The file: read with the service role (the user uploaded it into the company folder, checked above).
  const dl = await admin.storage.from('documents').download(path)
  if (dl.error || !dl.data) return json(404, { error: 'File not found' })
  const bytes = new Uint8Array(await dl.data.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) return json(413, { error: 'File is larger than 10 MB' })
  const mime = dl.data.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
  const isPdf = mime === 'application/pdf'
  if (!isPdf && !(IMAGE_TYPES as readonly string[]).includes(mime)) {
    return json(415, { error: `Unsupported file type ${mime}. Use a photo (JPEG/PNG) or a PDF.` })
  }

  const log = (row: Record<string, unknown>) =>
    user.from('ai_extractions').insert({ company_id: companyId, storage_path: path, file_name: fileName ?? null, model: MODEL, ...row })

  // Ask Claude.
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  const data = base64(bytes)
  const fileBlock: Anthropic.ContentBlockParam = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime as (typeof IMAGE_TYPES)[number], data } }

  let extraction: Extraction
  try {
    const response = await client.messages.parse({
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
  const [parties, accounts, items, open] = await Promise.all([
    user.from('parties').select('id, name_en, name_ar, is_customer, is_supplier, is_employee, is_active').eq('company_id', companyId),
    user.from('money_accounts').select('id, name_en, name_ar, currency, bank_name, account_no, is_active').eq('company_id', companyId),
    user.from('items').select('id, name_en, name_ar, is_active').eq('company_id', companyId),
    user.from('v_document_balances').select('id, kind, party_id, open_amount, currency').eq('company_id', companyId).in('kind', ['supplier_bill', 'sales_invoice']).gt('open_amount', 0),
  ])
  const numbers = open.data?.length
    ? (await user.from('documents').select('id, number').in('id', open.data.map((d) => d.id))).data ?? []
    : []
  const ctx: MatchContext = {
    today: new Date().toISOString().slice(0, 10),
    parties: parties.data ?? [], moneyAccounts: accounts.data ?? [], items: items.data ?? [],
    openDocs: (open.data ?? []).map((d) => ({ ...d, open_amount: Number(d.open_amount), number: numbers.find((n) => n.id === d.id)?.number ?? '' })),
  }
  const plan = planDraft(extraction, ctx)

  // Create the draft as the user.
  const docId = crypto.randomUUID()
  const { currency, ...doc } = plan.doc
  const ins = await user.from('documents').insert({
    id: docId, company_id: companyId, kind: plan.kind, source: 'ai', ...doc,
    ...(plan.doc.money_account_id ? {} : { currency: currency ?? 'USD' }),
    notes: `Read by AI from ${fileName ?? 'uploaded file'}. Check before posting.`,
  })
  if (ins.error) {
    await log({ status: 'failed', result: extraction, error: ins.error.message })
    return json(400, { error: ins.error.message, extraction })
  }
  if (plan.lines.length) {
    await user.from('document_lines').insert(plan.lines.map((l, i) => ({ ...l, company_id: companyId, document_id: docId, line_no: i + 1 })))
  }
  if (plan.links.length) {
    await user.from('document_links').insert(plan.links.map((l) => ({ ...l, company_id: companyId, from_document_id: docId })))
  }
  await user.from('attachments').insert({
    company_id: companyId, document_id: docId, storage_path: path, file_name: fileName ?? path.split('/').pop(),
    mime_type: mime, size_bytes: bytes.byteLength, sha256: await sha256(bytes),
  })
  await log({ status: 'done', result: extraction, warnings: plan.warnings, document_id: docId })

  return json(200, { document_id: docId, kind: plan.kind, warnings: plan.warnings, extraction })
})
