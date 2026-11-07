// Turns what the AI read from a voucher into a draft document: picks the document kind, matches the
// party, bank account, items and the open bill / invoice it settles. Pure functions (unit-tested in
// pf/web/src/ai/voucher.test.ts); the Edge Function supplies the data and writes the draft.

export type VoucherKind = 'payment_out' | 'money_received' | 'transfer' | 'supplier_invoice' | 'expense_receipt' | 'other'

export interface Extraction {
  document_kind: VoucherKind
  date: string | null
  currency: 'USD' | 'SAR' | 'YER' | null
  amount: number | null
  fee: number | null
  reference: string | null
  counterparty_name: string | null      // who we paid / who paid us / who issued the invoice
  bank_or_company: string | null        // bank or exchange company on the slip
  account_number: string | null
  invoice_number: string | null
  description: string | null            // short English summary
  lines: { description: string; quantity: number | null; unit: string | null; unit_price: number | null; amount: number | null }[]
  confidence: 'high' | 'medium' | 'low'
}

export interface MatchContext {
  today: string
  parties: { id: string; name_en: string; name_ar: string | null; is_customer: boolean; is_supplier: boolean; is_employee: boolean; is_active: boolean }[]
  moneyAccounts: { id: string; name_en: string; name_ar: string | null; currency: string; bank_name: string | null; account_no: string | null; is_active: boolean }[]
  items: { id: string; name_en: string; name_ar: string | null; is_active: boolean }[]
  openDocs: { id: string; kind: 'supplier_bill' | 'sales_invoice'; party_id: string; number: string; currency: string; open_amount: number }[]
}

export interface DraftPlan {
  kind: 'expense' | 'supplier_payment' | 'customer_receipt' | 'transfer' | 'supplier_bill'
  doc: {
    doc_date: string; money_account_id: string | null; party_id: string | null; amount: number; fee_amount: number
    currency: string | null; reference_no: string | null; party_reference: string | null; description: string | null
  }
  lines: { line_kind: 'item'; item_id: string | null; description: string; qty: number; unit: string | null; unit_price: number | null; amount: number }[]
  links: { to_document_id: string; amount: number }[]
  warnings: string[]
}

// ---------------------------------------------------------------------------------------------
// Name matching (English and Arabic)
// ---------------------------------------------------------------------------------------------
const STOP = new Set(['company', 'co', 'ltd', 'llc', 'est', 'establishment', 'the', 'for', 'and', 'of', 'trading', 'group',
  'services', 'service', 'شركة', 'مؤسسة', 'و', 'للتجارة', 'التجارية', 'المحدودة', 'مجموعة'])

export function normalizeName(s: string | null | undefined): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')     // Arabic diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .map((t) => t.replace(/^(al|el)-?/, '').replace(/^ال/, ''))
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/** 0..1 similarity between two names (token overlap, with a bonus when one contains the other). */
export function nameScore(a: string | null | undefined, b: string | null | undefined): number {
  const x = new Set(normalizeName(a)), y = new Set(normalizeName(b))
  if (!x.size || !y.size) return 0
  const inter = [...x].filter((t) => y.has(t)).length
  const jaccard = inter / new Set([...x, ...y]).size
  const contained = inter === Math.min(x.size, y.size) ? 0.25 : 0
  return Math.min(1, jaccard + contained)
}

function best<T>(list: T[], score: (t: T) => number, min = 0.5): T | null {
  let top: T | null = null, s = min
  for (const t of list) { const v = score(t); if (v >= s) { s = v; top = t } }
  return top
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function matchMoneyAccount(ctx: MatchContext, e: Extraction) {
  const active = ctx.moneyAccounts.filter((m) => m.is_active && (!e.currency || m.currency === e.currency))
  const acct = digits(e.account_number)
  if (acct.length >= 4) {
    const byNo = active.find((m) => digits(m.account_no).endsWith(acct.slice(-4)))
    if (byNo) return byNo
  }
  return best(active, (m) => Math.max(nameScore(e.bank_or_company, m.bank_name), nameScore(e.bank_or_company, m.name_en), nameScore(e.bank_or_company, m.name_ar)), 0.34)
}

// ---------------------------------------------------------------------------------------------
export function planDraft(e: Extraction, ctx: MatchContext): DraftPlan {
  const warnings: string[] = []
  const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') ? e.date! : ctx.today
  if (date !== e.date) warnings.push('Date not readable: set to today')
  const role = e.document_kind === 'money_received' ? 'customer' : e.document_kind === 'transfer' ? null : 'supplier'
  const candidates = ctx.parties.filter((p) => p.is_active && (!role || (role === 'customer' ? p.is_customer : p.is_supplier || p.is_employee)))
  const party = e.counterparty_name ? best(candidates, (p) => Math.max(nameScore(e.counterparty_name, p.name_en), nameScore(e.counterparty_name, p.name_ar))) : null
  if (e.counterparty_name && !party) warnings.push(`No ${role ?? 'party'} matches "${e.counterparty_name}": choose or add one`)
  const account = e.document_kind === 'supplier_invoice' ? null : matchMoneyAccount(ctx, e)
  if (e.document_kind !== 'supplier_invoice' && !account) warnings.push(`Bank / cash account not recognised${e.bank_or_company ? ` ("${e.bank_or_company}")` : ''}: choose it`)
  if (account && e.currency && account.currency !== e.currency) warnings.push(`The slip is in ${e.currency} but the account is ${account.currency}`)
  const amount = Math.max(0, Number(e.amount ?? 0))
  if (!amount) warnings.push('Amount not readable: enter it')
  if (e.confidence === 'low') warnings.push('The AI was not sure about this voucher: check every field')

  const base = {
    doc_date: date, money_account_id: account?.id ?? null, party_id: party?.id ?? null, amount,
    fee_amount: Math.max(0, Number(e.fee ?? 0)), currency: e.currency, reference_no: e.reference,
    party_reference: e.invoice_number, description: e.description,
  }

  // Settle an open bill / invoice of the same party, currency and amount.
  const settle = (kind: 'supplier_bill' | 'sales_invoice') => {
    if (!party || !amount) return []
    const open = ctx.openDocs.filter((d) => d.kind === kind && d.party_id === party.id && (!e.currency || d.currency === e.currency))
    const exact = open.find((d) => Math.abs(d.open_amount - amount) < 0.005)
      ?? (e.invoice_number ? open.find((d) => d.number === e.invoice_number || digits(d.number).endsWith(digits(e.invoice_number))) : undefined)
    if (exact) return [{ to_document_id: exact.id, amount: Math.min(exact.open_amount, amount) }]
    if (open.length) warnings.push(`${open.length} open ${kind === 'supplier_bill' ? 'bill(s)' : 'invoice(s)'} for this party: tick what this settles`)
    return []
  }

  if (e.document_kind === 'supplier_invoice') {
    const lines = (e.lines.length ? e.lines : [{ description: e.description ?? 'Invoice', quantity: 1, unit: null, unit_price: amount, amount }])
      .map((l) => {
        const item = best(ctx.items.filter((i) => i.is_active), (i) => Math.max(nameScore(l.description, i.name_en), nameScore(l.description, i.name_ar)), 0.6)
        if (!item) warnings.push(`No item matches "${l.description}": pick one or add it`)
        const qty = Number(l.quantity ?? 1) || 1
        const amt = Number(l.amount ?? (l.unit_price != null ? qty * l.unit_price : 0))
        return { line_kind: 'item' as const, item_id: item?.id ?? null, description: l.description, qty, unit: l.unit, unit_price: l.unit_price ?? (qty ? amt / qty : null), amount: Math.round(amt * 100) / 100 }
      })
    return { kind: 'supplier_bill', doc: { ...base, money_account_id: null, amount: 0 }, lines, links: [], warnings }
  }
  if (e.document_kind === 'money_received' && party) {
    return { kind: 'customer_receipt', doc: base, lines: [], links: settle('sales_invoice'), warnings }
  }
  if (e.document_kind === 'payment_out' && party && ctx.parties.find((p) => p.id === party.id)?.is_supplier) {
    return { kind: 'supplier_payment', doc: base, lines: [], links: settle('supplier_bill'), warnings }
  }
  if (e.document_kind === 'transfer') {
    warnings.push('Choose the account the money went to')
    return { kind: 'transfer', doc: { ...base, party_id: null }, lines: [], links: [], warnings }
  }
  // Expense receipts, unknown vouchers, payments to someone who is not a supplier: an expense to complete.
  warnings.push('Choose what it was for (account) and the project')
  return {
    kind: 'expense', doc: { ...base, amount: 0 }, links: [], warnings,
    lines: [{ line_kind: 'item', item_id: null, description: e.description ?? e.counterparty_name ?? 'Expense', qty: 1, unit: null, unit_price: null, amount }],
  }
}
