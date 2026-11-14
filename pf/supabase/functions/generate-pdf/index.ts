// Supabase Edge Function: render a document as a PDF in the EnvironmSafe house style.
// POST { document_id } with the user's JWT.  Returns { url, stored, sha256 }.
// - Reads the document with the caller's own permissions (RLS), so nobody prints what they cannot see.
// - Posted documents: the PDF is stored in the private bucket and attached to the document with its
//   SHA-256 (spec 9.7). Drafts print with a DRAFT watermark and are not stored.
// Secrets (env): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PDF_SERVICE_URL, PDF_SERVICE_KEY, APP_URL
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { buildPrintDocument, type PrintLine } from '../_shared/print.ts'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sign in first' })

  const url = Deno.env.get('SUPABASE_URL')!
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let documentId: string
  try { ({ document_id: documentId } = await req.json()) } catch { return json(400, { error: 'Body must be JSON' }) }
  if (!documentId) return json(400, { error: 'document_id is required' })

  // Everything below is read as the user: RLS decides what they may print.
  const { data: doc, error } = await user.from('documents').select('*').eq('id', documentId).maybeSingle()
  if (error || !doc) return json(404, { error: 'Document not found' })
  const [kind, lines, party, company, account] = await Promise.all([
    user.from('doc_kinds').select('number_type').eq('kind', doc.kind).single(),
    user.from('document_lines').select('*, items(code, name_en)').eq('document_id', doc.id).order('line_no'),
    doc.party_id ? user.from('parties').select('*').eq('id', doc.party_id).single() : Promise.resolve({ data: null }),
    user.from('companies').select('name_en, legal_name, settings').eq('id', doc.company_id).single(),
    doc.money_account_id ? user.from('money_accounts').select('name_en').eq('id', doc.money_account_id).single() : Promise.resolve({ data: null }),
  ])

  const printDoc = buildPrintDocument({
    doc: { ...doc, number_type: kind.data?.number_type ?? 'payment', money_account_name: account.data?.name_en ?? null },
    lines: (lines.data ?? []).map((l: Record<string, unknown>) => ({
      ...(l as unknown as PrintLine),
      item_code: (l.items as { code?: string } | null)?.code ?? null,
      item_name: (l.items as { name_en?: string } | null)?.name_en ?? null,
    })),
    party: party.data,
    company: company.data!,
    appUrl: Deno.env.get('APP_URL') ?? 'https://app.environmsafe.com',
  })

  const res = await fetch(`${Deno.env.get('PDF_SERVICE_URL')}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PDF-Key': Deno.env.get('PDF_SERVICE_KEY')! },
    body: JSON.stringify(printDoc),
  })
  if (!res.ok) return json(502, { error: `PDF service: ${await res.text()}` })
  const pdf = new Uint8Array(await res.arrayBuffer())
  const hash = await sha256(pdf)
  const fileName = `${(doc.number ?? doc.temp_number).replace(/[^\w.-]+/g, '_')}${doc.revision ? `-Rev${doc.revision}` : ''}.pdf`

  let path = `${doc.company_id}/${doc.id}/print/${Date.now()}-${fileName}`
  let stored = false
  if (doc.status === 'posted') {
    const up = await admin.storage.from('documents').upload(path, pdf, { contentType: 'application/pdf', upsert: false })
    if (up.error) return json(500, { error: up.error.message })
    const ins = await admin.from('attachments').insert({
      company_id: doc.company_id, document_id: doc.id, storage_path: path, file_name: fileName,
      mime_type: 'application/pdf', size_bytes: pdf.byteLength, sha256: hash, kind: 'generated_pdf',
    })
    if (ins.error) return json(500, { error: ins.error.message })
    stored = true
  } else {
    path = `${doc.company_id}/${doc.id}/preview/${crypto.randomUUID()}-${fileName}`
    const up = await admin.storage.from('documents').upload(path, pdf, { contentType: 'application/pdf' })
    if (up.error) return json(500, { error: up.error.message })
  }
  const signed = await admin.storage.from('documents').createSignedUrl(path, 300)
  if (signed.error) return json(500, { error: signed.error.message })
  return json(200, { url: signed.data.signedUrl, stored, sha256: hash, file_name: fileName })
})
