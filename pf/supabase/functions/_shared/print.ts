// Builds the print description consumed by the PDF service (pf/pdf). Pure functions: no I/O,
// so the same code runs in the Edge Function and in unit tests.

export interface PrintCompany { name_en: string; legal_name?: string | null; settings: Record<string, unknown> }
export interface PrintParty { code: string; name_en: string; name_ar?: string | null; address?: string | null; city?: string | null; country?: string | null; email?: string | null; phone?: string | null; contact_person?: string | null; is_customer?: boolean }
export interface PrintLine { line_no: number; line_kind: 'item' | 'charge' | 'discount' | 'tax'; description: string | null; detail: string | null; qty: number; unit: string | null; unit_price: number | null; amount: number; percent: number | null; percent_base: 'items' | 'untaxed' | null; item_code?: string | null; item_name?: string | null }
export interface PrintDoc {
  kind: string; number_type: string; status: string; number: string | null; temp_number: string; revision: number; doc_date: string
  due_date: string | null; valid_until: string | null; currency: string; amount: number; fee_amount: number
  party_reference: string | null; reference_no: string | null; attention: string | null; terms: string | null
  description: string | null; verify_token: string; money_account_name?: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dateLong = (iso: string | null | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}
const DEC: Record<string, number> = { USD: 2, SAR: 2, YER: 0 }
export const money = (n: number, ccy: string) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: DEC[ccy] ?? 2, maximumFractionDigits: DEC[ccy] ?? 2 })
const round2 = (n: number) => Math.round(n * 100) / 100
const pct = (n: number) => String(Number(n)).replace(/\.0+$/, '')

/** "Label: text" lines -> [{label, text}] (a line without a colon is plain text). */
export function parseTerms(src: string | null | undefined) {
  return (src ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':')
    return i > 0 && i < 40 ? { label: l.slice(0, i).trim(), text: l.slice(i + 1).trim() } : { label: '', text: l }
  })
}

const PRINT_KIND: Record<string, string> = { payment: 'payment', receipt: 'receipt', transfer: 'payment', expense_claim: 'payment', journal: 'payment' }

export function buildPrintDocument(input: {
  doc: PrintDoc; lines: PrintLine[]; party: PrintParty | null; company: PrintCompany; appUrl: string
}) {
  const { doc, lines, party, company } = input
  const ccy = doc.currency
  const trade = ['purchase_order', 'supplier_bill', 'quotation', 'sales_invoice', 'credit_note'].includes(doc.kind)
  const kind = trade ? doc.kind : (PRINT_KIND[doc.number_type] ?? 'payment')
  const number = doc.number ?? doc.temp_number
  const sales = ['quotation', 'sales_invoice', 'credit_note'].includes(doc.kind)
  const settings = company.settings ?? {}

  const toLines = [
    party?.address, [party?.city, party?.country].filter(Boolean).join(', '), party?.email,
    doc.attention ? `Attn: ${doc.attention}` : party?.contact_person ? `Attn: ${party.contact_person}` : null,
    sales && party ? `Customer ID: ${party.code}` : null,
  ].filter((l): l is string => Boolean(l && l.trim()))

  const items = lines.filter((l) => l.line_kind === 'item')
  const itemsTotal = round2(items.reduce((a, l) => a + Number(l.amount), 0))
  const charges = lines.filter((l) => l.line_kind === 'charge' || l.line_kind === 'discount')
  const taxes = lines.filter((l) => l.line_kind === 'tax')
  const untaxed = round2(itemsTotal + charges.reduce((a, l) => a + (l.line_kind === 'discount' ? -1 : 1) * Number(l.amount), 0))

  const totals: { label: string; value: string | number }[] = []
  if (trade) {
    totals.push({ label: doc.kind === 'purchase_order' ? 'Products subtotal' : 'Subtotal', value: itemsTotal })
    for (const c of charges) totals.push({ label: c.description ?? c.line_kind, value: c.line_kind === 'discount' ? `-${money(c.amount, ccy)}` : Number(c.amount) })
    if (sales && !charges.some((c) => c.line_kind === 'discount')) totals.push({ label: 'Discount', value: 0 })
    if (charges.length) totals.push({ label: 'Untaxed amount', value: untaxed })
    for (const t of taxes) {
      if (t.percent != null) totals.push({ label: 'Tax rate', value: `${pct(t.percent)}% on ${money(t.percent_base === 'untaxed' ? untaxed : itemsTotal, ccy)}` })
      totals.push({ label: t.percent != null ? 'Tax' : (t.description ?? 'Tax'), value: Number(t.amount) })
    }
    if (sales && taxes.length === 0) totals.push({ label: 'Tax / VAT', value: 'Not applicable' })
  } else if (Number(doc.fee_amount) > 0) {
    totals.push({ label: 'Amount', value: Number(doc.amount) }, { label: 'Bank / remittance fee', value: Number(doc.fee_amount) })
  }
  const grand = round2(Number(doc.amount) + Number(doc.fee_amount))

  const printLines = trade
    ? items.map((l, i) => ({
        sn: i + 1, description: (l.item_code && l.description && !l.description.includes(l.item_code) ? `[${l.item_code}] ` : '') + (l.description ?? l.item_name ?? ''),
        detail: l.detail, unit: l.unit, qty: Number(l.qty), unit_price: l.unit_price != null ? Number(l.unit_price) : Number(l.amount) / Number(l.qty), amount: Number(l.amount),
      }))
    : (lines.length ? lines : [{ line_no: 1, description: doc.description, amount: doc.amount } as PrintLine]).map((l, i) => ({
        sn: i + 1, description: l.description ?? doc.description ?? '', detail: l.detail ?? null, unit: '', qty: 1, unit_price: null, amount: Number(l.amount),
      }))

  const label = { purchase_order: 'PO #', supplier_bill: 'BILL #', quotation: 'QUOTATION #', sales_invoice: 'INVOICE #', credit_note: 'CREDIT NOTE #' }[doc.kind] ?? 'VOUCHER #'
  const meta: [string, string][] = [[label, number], ['DATE', dateLong(doc.doc_date)]]
  if (doc.kind === 'purchase_order') meta.push(['REFERENCE', doc.party_reference ?? doc.reference_no ?? ''], ['QUOTE VALID TO', dateLong(doc.valid_until)])
  else if (doc.kind === 'quotation') meta.push(['REFERENCE', doc.party_reference ?? doc.reference_no ?? ''], ['VALID UNTIL', dateLong(doc.valid_until)])
  else if (doc.kind === 'sales_invoice') meta.push(['REFERENCE', doc.party_reference ?? doc.reference_no ?? ''], ['TERMS', !doc.due_date || doc.due_date === doc.doc_date ? 'Due on receipt' : `Due ${dateLong(doc.due_date)}`])
  else if (doc.kind === 'supplier_bill') meta.push(['SUPPLIER REF.', doc.party_reference ?? ''], ['DUE', dateLong(doc.due_date)])
  else if (doc.kind === 'credit_note') meta.push(['INVOICE', doc.party_reference ?? ''], ['REASON', doc.description ?? ''])
  else meta.push(['ACCOUNT', doc.money_account_name ?? ''], ['REFERENCE', doc.reference_no ?? ''])

  const termsKey = { purchase_order: 'po_terms', sales_invoice: 'invoice_terms', quotation: 'quotation_terms' }[doc.kind]
  const terms = parseTerms(doc.terms ?? (termsKey ? (settings[termsKey] as string) : ''))

  return {
    kind,
    number,
    revision: doc.revision,
    status: doc.status === 'posted' ? 'posted' : doc.status === 'void' ? 'void' : 'draft',
    date: doc.doc_date,
    currency: ccy,
    company: { legal_name: company.legal_name ?? company.name_en },
    to_label: kind === 'payment' ? 'PAID TO:' : kind === 'receipt' ? 'RECEIVED FROM:' : 'TO:',
    to: { name: party ? party.name_en : (doc.description ?? ''), lines: toLines },
    meta,
    lines: printLines,
    totals,
    total: { label: 'TOTAL', value: `${ccy} ${money(grand, ccy)}` },
    total_amount: grand,
    amount_words: doc.kind === 'sales_invoice' || kind === 'receipt' || kind === 'payment',
    terms,
    signature: doc.kind === 'purchase_order'
      ? { style: 'acceptance', date: doc.doc_date, acceptance: { party: party?.name_en ?? '', name: doc.attention ?? party?.contact_person ?? '' }, signed: doc.status === 'posted' }
      : { style: 'single', date: doc.doc_date, signed: doc.status === 'posted' },
    verify_url: doc.status === 'posted' || doc.status === 'void' ? `${input.appUrl.replace(/\/$/, '')}/verify/${doc.verify_token}` : null,
  }
}
