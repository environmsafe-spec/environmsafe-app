// Print a document in the browser: gather its data, build the print description (the same builder the
// former PDF service used), render it with pdf-lib, open it, and keep a copy with the document once it
// is posted (issued copies are part of the record).
import { buildPrintDocument, type PrintLine } from '../../../supabase/functions/_shared/print.ts'
import { supabase } from '../lib/supabase'

async function bytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url)
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
}

async function sha256(data: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function printDocument(documentId: string): Promise<{ url: string; stored: boolean }> {
  const { data: doc, error } = await supabase.from('documents').select('*').eq('id', documentId).single()
  if (error || !doc) throw new Error('Document not found')
  const [kind, lines, party, company, account, items] = await Promise.all([
    supabase.from('doc_kinds').select('number_type').eq('kind', doc.kind).single(),
    supabase.from('document_lines').select('*').eq('document_id', doc.id).order('line_no'),
    doc.party_id ? supabase.from('parties').select('*').eq('id', doc.party_id).single() : Promise.resolve({ data: null }),
    supabase.from('companies').select('name_en, legal_name, settings').eq('id', doc.company_id).single(),
    doc.money_account_id ? supabase.from('money_accounts').select('name_en').eq('id', doc.money_account_id).single() : Promise.resolve({ data: null }),
    supabase.from('items').select('id, code, name_en').eq('company_id', doc.company_id),
  ])
  if (lines.error) throw lines.error
  const itemById = new Map(((items.data ?? []) as { id: string; code: string; name_en: string }[]).map((i) => [i.id, i]))
  const printDoc = buildPrintDocument({
    doc: { ...doc, number_type: kind.data?.number_type ?? 'payment', money_account_name: account.data?.name_en ?? null },
    lines: ((lines.data ?? []) as (PrintLine & { item_id: string | null })[]).map((l) => ({
      ...l, item_code: l.item_id ? itemById.get(l.item_id)?.code ?? null : null, item_name: l.item_id ? itemById.get(l.item_id)?.name_en ?? null : null,
    })),
    party: party.data,
    company: company.data!,
    appUrl: window.location.origin,
  })

  const { renderDocument, needsArabic } = await import('./pdf')
  const arabic = needsArabic(printDoc as never)
  const [logo, signature, arabicRegular, arabicBold] = await Promise.all([
    bytes('/print/es_logo.jpg'), bytes('/print/signature_stamp.png'),
    arabic ? bytes('/print/NotoNaskhArabic-Regular.ttf') : null, arabic ? bytes('/print/NotoNaskhArabic-Bold.ttf') : null,
  ])
  const pdf = await renderDocument(printDoc as never, { logo, signature, arabicRegular, arabicBold })
  const url = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }))

  let stored = false
  if (doc.status === 'posted') {
    const fileName = `${String(doc.number ?? doc.temp_number).replace(/[^\w.-]+/g, '_')}${doc.revision ? `-Rev${doc.revision}` : ''}.pdf`
    const path = `${doc.company_id}/${doc.id}/print/${Date.now()}-${fileName}`
    const up = await supabase.storage.from('documents').upload(path, new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    if (!up.error) {
      const ins = await supabase.from('attachments').insert({
        company_id: doc.company_id, document_id: doc.id, storage_path: path, file_name: fileName,
        mime_type: 'application/pdf', size_bytes: pdf.byteLength, sha256: await sha256(pdf), kind: 'generated_pdf',
      })
      stored = !ins.error
    }
  }
  return { url, stored }
}
