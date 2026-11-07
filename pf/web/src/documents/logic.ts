// Pure helpers for the document form (unit-tested; no React, no network).

export type DocKind =
  | 'expense' | 'supplier_payment' | 'customer_receipt' | 'refund_to_customer' | 'refund_from_supplier'
  | 'transfer' | 'expense_claim' | 'claim_reimbursement' | 'salary' | 'employee_advance'
  | 'advance_repayment' | 'employee_offset' | 'owner_drawings' | 'manual_journal'

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

export interface LineState {
  key: string
  gl_account_id: string | null
  project_id: string | null
  item_id: string | null
  description: string
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
  reference_no: string
  description: string
  notes: string
  no_document_reason: string
  lines: LineState[]
  links: LinkState[]
}

const num = (v: number | '' | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const round2 = (n: number) => Math.round(n * 100) / 100

export function newLine(side: 'D' | 'C' = 'D'): LineState {
  return { key: Math.random().toString(36).slice(2), gl_account_id: null, project_id: null, item_id: null, description: '', amount: '', side }
}

export function emptyDoc(today: string): DocState {
  return {
    doc_date: today, money_account_id: null, counter_money_account_id: null, party_id: null,
    amount: '', counter_amount: '', fee_amount: '', rate: '', counter_rate: '', purpose: 'payable', currency: 'USD',
    reference_no: '', description: '', notes: '', no_document_reason: '', lines: [newLine()], links: [],
  }
}

/** Total of a document as the user will see it (lines for line kinds; links for offsets). */
export function documentTotal(k: KindInfo, s: DocState): number {
  if (k.kind === 'manual_journal') return round2(s.lines.filter((l) => l.side === 'D').reduce((a, l) => a + num(l.amount), 0))
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
  if (k.has_lines) {
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
  return s.lines
    .filter((l) => num(l.amount) > 0)
    .map((l, i) => ({
      company_id: companyId, document_id: documentId, line_no: i + 1,
      gl_account_id: l.gl_account_id, project_id: l.project_id, item_id: l.item_id,
      description: l.description.trim() || null, amount: num(l.amount),
      side: k.kind === 'manual_journal' ? l.side : 'D',
    }))
}

/** USD equivalent shown under the amount (rate = units per USD). */
export function usdEquivalent(amount: number, rate: number): number | null {
  return rate > 0 ? round2(amount / rate) : null
}
