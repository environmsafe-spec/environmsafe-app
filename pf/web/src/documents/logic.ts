// Pure helpers for the document form (unit-tested; no React, no network).

export type DocKind =
  | 'expense' | 'supplier_payment' | 'customer_receipt' | 'refund_to_customer' | 'refund_from_supplier'
  | 'transfer' | 'expense_claim' | 'claim_reimbursement' | 'salary' | 'employee_advance'
  | 'advance_repayment' | 'employee_offset' | 'owner_drawings' | 'manual_journal'
  | 'purchase_order' | 'supplier_bill' | 'quotation' | 'sales_invoice' | 'credit_note'

export const TRADE_KINDS: DocKind[] = ['purchase_order', 'supplier_bill', 'quotation', 'sales_invoice', 'credit_note']
export const isTrade = (k: DocKind) => TRADE_KINDS.includes(k)
export const SALES_KINDS: DocKind[] = ['quotation', 'sales_invoice', 'credit_note']

export interface KindInfo {
  kind: DocKind
  number_type: string
  direction: 'out' | 'in' | 'none' | 'transfer'
  has_lines: boolean
  money_account: 'required' | 'optional' | 'none'
  party_role: 'supplier' | 'customer' | 'employee' | 'employee_or_owner' | 'owner' | 'any' | null
  party_required: boolean
  allows_fee: boolean
  approval_applies: boolean
  settles: DocKind[]
  post_permission: string
  creates_journal: boolean
  name_en: string
  name_ar: string
  sort: number
}

/** The Home buttons and which document kinds sit behind each. */
export const ACTION_GROUPS: Record<'pay' | 'receive' | 'transfer' | 'claim', DocKind[]> = {
  pay: ['expense', 'supplier_payment', 'salary', 'employee_advance', 'claim_reimbursement', 'owner_drawings', 'refund_to_customer'],
  receive: ['customer_receipt', 'advance_repayment', 'refund_from_supplier'],
  transfer: ['transfer'],
  claim: ['expense_claim', 'employee_offset'],
}
export const TRADE_GROUP: DocKind[] = ['purchase_order', 'supplier_bill', 'quotation', 'sales_invoice', 'credit_note']

/** Next document in the chain, offered as a button on an issued / posted document. */
export const CONVERSIONS: Partial<Record<DocKind, DocKind>> = {
  purchase_order: 'supplier_bill', quotation: 'sales_invoice', sales_invoice: 'credit_note',
}

export type LineKind = 'item' | 'charge' | 'discount' | 'tax'

export interface LineState {
  key: string
  line_kind: LineKind
  gl_account_id: string | null
  project_id: string | null
  item_id: string | null
  description: string
  detail: string
  qty: number | ''
  unit: string
  unit_price: number | ''
  percent: number | ''
  percent_base: 'items' | 'untaxed'
  amount: number | ''
  side: 'D' | 'C'
}

export interface LinkState { to_document_id: string; amount: number | '' }

export interface DocState {
  doc_date: string
  money_account_id: string | null
  counter_money_account_id: string | null
  party_id: string | null
  amount: number | ''
  counter_amount: number | ''
  fee_amount: number | ''
  rate: number | ''
  counter_rate: number | ''
  purpose: 'payable' | 'deposit'
  currency: string
  due_date: string
  valid_until: string
  attention: string
  party_reference: string
  terms: string
  reference_no: string
  description: string
  notes: string
  no_document_reason: string
  lines: LineState[]
  links: LinkState[]
}

const num = (v: number | '' | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const round2 = (n: number) => Math.round(n * 100) / 100

export function newLine(side: 'D' | 'C' = 'D', line_kind: LineKind = 'item'): LineState {
  return {
    key: Math.random().toString(36).slice(2), line_kind, gl_account_id: null, project_id: null, item_id: null,
    description: '', detail: '', qty: 1, unit: '', unit_price: '', percent: '', percent_base: 'items', amount: '', side,
  }
}

/**
 * Recompute trade lines exactly as the database does at posting:
 * item = qty x unit price; charge / discount % of the item subtotal; tax % of items or of the untaxed amount.
 */
export function computeTradeLines(lines: LineState[]): LineState[] {
  const withItems = lines.map((l) =>
    l.line_kind === 'item' && typeof l.unit_price === 'number' && typeof l.qty === 'number'
      ? { ...l, amount: round2(l.qty * l.unit_price) } : l)
  const items = withItems.filter((l) => l.line_kind === 'item').reduce((a, l) => a + num(l.amount), 0)
  const withCharges = withItems.map((l) =>
    (l.line_kind === 'charge' || l.line_kind === 'discount') && typeof l.percent === 'number' ? { ...l, amount: round2(items * l.percent / 100) } : l)
  const untaxed = withCharges.reduce((a, l) => a + (l.line_kind === 'item' || l.line_kind === 'charge' ? num(l.amount) : l.line_kind === 'discount' ? -num(l.amount) : 0), 0)
  return withCharges.map((l) =>
    l.line_kind === 'tax' && typeof l.percent === 'number' ? { ...l, amount: round2((l.percent_base === 'untaxed' ? untaxed : items) * l.percent / 100) } : l)
}

export function tradeTotals(lines: LineState[]) {
  const c = computeTradeLines(lines)
  const sum = (k: LineKind) => round2(c.filter((l) => l.line_kind === k).reduce((a, l) => a + num(l.amount), 0))
  const items = sum('item'), charges = sum('charge'), discounts = sum('discount'), tax = sum('tax')
  return { items, charges, discounts, untaxed: round2(items + charges - discounts), tax, total: round2(items + charges - discounts + tax) }
}

export function emptyDoc(today: string): DocState {
  return {
    doc_date: today, money_account_id: null, counter_money_account_id: null, party_id: null,
    amount: '', counter_amount: '', fee_amount: '', rate: '', counter_rate: '', purpose: 'payable', currency: 'USD',
    due_date: '', valid_until: '', attention: '', party_reference: '', terms: '',
    reference_no: '', description: '', notes: '', no_document_reason: '', lines: [newLine()], links: [],
  }
}

/** Total of a document as the user will see it (lines for line kinds; links for offsets). */
export function documentTotal(k: KindInfo, s: DocState): number {
  if (k.kind === 'manual_journal') return round2(s.lines.filter((l) => l.side === 'D').reduce((a, l) => a + num(l.amount), 0))
  if (isTrade(k.kind)) return tradeTotals(s.lines).total
  if (k.has_lines) return round2(s.lines.reduce((a, l) => a + num(l.amount), 0))
  if (k.kind === 'employee_offset') return round2(s.links.reduce((a, l) => a + num(l.amount), 0) / 2)
  return round2(num(s.amount))
}

export function journalDifference(s: DocState): number {
  const d = s.lines.filter((l) => l.side === 'D').reduce((a, l) => a + num(l.amount), 0)
  const c = s.lines.filter((l) => l.side === 'C').reduce((a, l) => a + num(l.amount), 0)
  return round2(d - c)
}

/** Field keys still needed before the document can be posted (the database re-checks everything). */
export function missingForPosting(k: KindInfo, s: DocState, opts: { hasAttachment: boolean; accountNeedsProject: (id: string | null) => boolean }): string[] {
  const m: string[] = []
  if (!s.doc_date) m.push('date')
  if (k.money_account === 'required' && !s.money_account_id) m.push('account')
  if (k.party_required && !s.party_id) m.push('party')
  if (k.kind === 'transfer') {
    if (!s.counter_money_account_id) m.push('to_account')
    if (s.counter_money_account_id && s.counter_money_account_id === s.money_account_id) m.push('same_account')
  }
  if (isTrade(k.kind)) {
    const lines = computeTradeLines(s.lines)
    if (!lines.some((l) => l.line_kind === 'item')) m.push('lines')
    lines.forEach((l, i) => {
      if (l.line_kind === 'item' && !l.item_id) m.push(`line${i + 1}.item`)
      if (l.line_kind !== 'item' && !l.description.trim()) m.push(`line${i + 1}.description`)
      if (!(num(l.amount) > 0)) m.push(`line${i + 1}.amount`)
      if (k.creates_journal && l.gl_account_id && opts.accountNeedsProject(l.gl_account_id) && !l.project_id) m.push(`line${i + 1}.project`)
    })
  } else if (k.has_lines) {
    if (s.lines.length === 0) m.push('lines')
    s.lines.forEach((l, i) => {
      if (!(num(l.amount) > 0)) m.push(`line${i + 1}.amount`)
      if (!l.gl_account_id && !l.item_id && k.kind !== 'salary') m.push(`line${i + 1}.account`)
      if (l.gl_account_id && opts.accountNeedsProject(l.gl_account_id) && !l.project_id) m.push(`line${i + 1}.project`)
    })
    if (k.kind === 'manual_journal' && journalDifference(s) !== 0) m.push('balance')
  } else if (k.kind !== 'employee_offset' && !(num(s.amount) > 0)) {
    m.push('amount')
  }
  const hasMoney = k.money_account === 'required' || (k.money_account === 'optional' && s.money_account_id)
  if (hasMoney && !opts.hasAttachment && !s.no_document_reason.trim()) m.push('evidence')
  if (k.direction === 'in' && num(s.fee_amount) >= num(s.amount) && num(s.fee_amount) > 0) m.push('fee')
  const linked = s.links.reduce((a, l) => a + num(l.amount), 0)
  if ((k.kind === 'claim_reimbursement' || k.kind === 'advance_repayment') && linked > num(s.amount)) m.push('links_exceed')
  return m
}

/** Row for the documents table (only columns the user may write). */
export function toDocumentRow(k: KindInfo, s: DocState) {
  const nul = (v: string) => (v.trim() === '' ? null : v.trim())
  const n = (v: number | '') => (typeof v === 'number' ? v : null)
  return {
    doc_date: s.doc_date,
    money_account_id: k.money_account === 'none' ? null : s.money_account_id,
    counter_money_account_id: k.kind === 'transfer' ? s.counter_money_account_id : null,
    party_id: k.party_role ? s.party_id : null,
    amount: k.has_lines || k.kind === 'employee_offset' ? 0 : num(s.amount),
    counter_amount: k.kind === 'transfer' ? n(s.counter_amount) : null,
    counter_rate: k.kind === 'transfer' ? n(s.counter_rate) : null,
    fee_amount: k.allows_fee ? num(s.fee_amount) : 0,
    ...(typeof s.rate === 'number' ? { rate: s.rate } : {}),
    purpose: k.kind === 'supplier_payment' ? s.purpose : null,
    due_date: ['supplier_bill', 'sales_invoice'].includes(k.kind) && s.due_date ? s.due_date : null,
    valid_until: ['purchase_order', 'quotation'].includes(k.kind) ? nul(s.valid_until) : null,
    attention: nul(s.attention),
    party_reference: nul(s.party_reference),
    terms: nul(s.terms),
    // Without a bank account the user picks the currency (claims, journals, unpaid salary).
    ...(k.money_account === 'none' || !s.money_account_id ? { currency: s.currency } : {}),
    reference_no: nul(s.reference_no),
    description: nul(s.description),
    notes: nul(s.notes),
    no_document_reason: nul(s.no_document_reason),
  }
}

export function toLineRows(k: KindInfo, s: DocState, documentId: string, companyId: string) {
  if (!k.has_lines) return []
  const trade = isTrade(k.kind)
  const lines = trade ? computeTradeLines(s.lines) : s.lines
  return lines
    .filter((l) => num(l.amount) > 0)
    .map((l, i) => ({
      company_id: companyId, document_id: documentId, line_no: i + 1,
      line_kind: trade ? l.line_kind : 'item',
      gl_account_id: l.gl_account_id, project_id: l.project_id, item_id: l.line_kind === 'item' ? l.item_id : null,
      description: l.description.trim() || null, amount: num(l.amount),
      side: k.kind === 'manual_journal' ? l.side : 'D',
      ...(trade ? {
        detail: l.detail.trim() || null, qty: l.line_kind === 'item' ? num(l.qty) || 1 : 1, unit: l.unit.trim() || null,
        unit_price: l.line_kind === 'item' && typeof l.unit_price === 'number' ? l.unit_price : null,
        percent: l.line_kind !== 'item' && typeof l.percent === 'number' ? l.percent : null,
        percent_base: l.line_kind === 'tax' && typeof l.percent === 'number' ? l.percent_base : null,
      } : {}),
    }))
}

/** USD equivalent shown under the amount (rate = units per USD). */
export function usdEquivalent(amount: number, rate: number): number | null {
  return rate > 0 ? round2(amount / rate) : null
}
