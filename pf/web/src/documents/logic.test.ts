import { describe, expect, it } from 'vitest'
import { computeTradeLines, documentTotal, emptyDoc, journalDifference, missingForPosting, newLine, toDocumentRow, toLineRows, tradeTotals, usdEquivalent, type KindInfo } from './logic'

const base: Omit<KindInfo, 'kind'> = {
  number_type: 'payment', direction: 'out', has_lines: false, money_account: 'required', party_role: null, creates_journal: true,
  party_required: false, allows_fee: true, approval_applies: true, settles: [], post_permission: 'docs.post_money',
  name_en: '', name_ar: '', sort: 1,
}
const expense: KindInfo = { ...base, kind: 'expense', has_lines: true, party_role: 'any' }
const payment: KindInfo = { ...base, kind: 'supplier_payment', party_role: 'supplier', party_required: true }
const receipt: KindInfo = { ...base, kind: 'customer_receipt', direction: 'in', party_role: 'customer', party_required: true }
const journal: KindInfo = { ...base, kind: 'manual_journal', has_lines: true, money_account: 'none', allows_fee: false }
const noProject = () => false

describe('documentTotal', () => {
  it('sums lines for an expense', () => {
    const s = emptyDoc('2026-11-08')
    s.lines = [{ ...newLine(), amount: 60 }, { ...newLine(), amount: 40.5 }]
    expect(documentTotal(expense, s)).toBe(100.5)
  })
  it('uses the header amount for a payment', () => expect(documentTotal(payment, { ...emptyDoc('x'), amount: 250 })).toBe(250))
  it('counts only debits for a manual journal', () => {
    const s = emptyDoc('x')
    s.lines = [{ ...newLine('D'), amount: 100 }, { ...newLine('C'), amount: 100 }]
    expect(documentTotal(journal, s)).toBe(100)
    expect(journalDifference(s)).toBe(0)
  })
})

describe('missingForPosting', () => {
  it('lists what a blank payment needs', () => {
    expect(missingForPosting(payment, emptyDoc('2026-11-08'), { hasAttachment: false, accountNeedsProject: noProject }))
      .toEqual(['account', 'party', 'amount', 'evidence'])
  })
  it('accepts a reason instead of a file', () => {
    const s = { ...emptyDoc('2026-11-08'), money_account_id: 'a', party_id: 'p', amount: 10 as const, no_document_reason: 'Cash, no receipt' }
    expect(missingForPosting(payment, s, { hasAttachment: false, accountNeedsProject: noProject })).toEqual([])
  })
  it('requires a project on P&L lines', () => {
    const s = { ...emptyDoc('2026-11-08'), money_account_id: 'a', lines: [{ ...newLine(), amount: 5, gl_account_id: 'fuel' }] }
    expect(missingForPosting(expense, s, { hasAttachment: true, accountNeedsProject: (id) => id === 'fuel' })).toEqual(['line1.project'])
  })
  it('rejects a fee bigger than the amount received', () => {
    const s = { ...emptyDoc('x'), money_account_id: 'a', party_id: 'c', amount: 5 as const, fee_amount: 5 as const }
    expect(missingForPosting(receipt, s, { hasAttachment: true, accountNeedsProject: noProject })).toContain('fee')
  })
  it('flags an unbalanced journal', () => {
    const s = { ...emptyDoc('x'), lines: [{ ...newLine('D'), amount: 10, gl_account_id: 'a' }, { ...newLine('C'), amount: 9, gl_account_id: 'b' }] }
    expect(missingForPosting(journal, s, { hasAttachment: false, accountNeedsProject: noProject })).toEqual(['balance'])
  })
})

describe('row builders', () => {
  it('never sends the amount for line kinds (the database sums the lines)', () => {
    const s = { ...emptyDoc('2026-11-08'), amount: 999 as const, money_account_id: 'a' }
    expect(toDocumentRow(expense, s).amount).toBe(0)
  })
  it('drops empty lines and forces debit side outside journals', () => {
    const s = { ...emptyDoc('x'), lines: [{ ...newLine('C'), amount: 10 }, { ...newLine(), amount: '' as const }] }
    const rows = toLineRows(expense, s, 'doc', 'co')
    expect(rows).toHaveLength(1)
    expect(rows[0].side).toBe('D')
  })
  it('converts to USD', () => expect(usdEquivalent(15560, 1556)).toBe(10))
})

describe('trade documents', () => {
  const po: KindInfo = { ...base, kind: 'purchase_order', has_lines: true, money_account: 'none', party_role: 'supplier', party_required: true, allows_fee: false, approval_applies: false, creates_journal: false, post_permission: 'docs.post' }
  const sample = () => {
    const s = { ...emptyDoc('2026-11-01'), party_id: 'sup' }
    s.lines = [
      { ...newLine(), item_id: 'nalco', description: 'TRAC102.11R', qty: 25, unit_price: 12.19 },
      { ...newLine('D', 'charge'), description: 'Surcharge 12%', percent: 12 },
      { ...newLine('D', 'tax'), description: 'Tax', percent: 5, percent_base: 'items' as const },
    ]
    return s
  }
  it('computes the sample PO like the database (304.75 + 36.57 + 15.24 = 356.56)', () => {
    expect(computeTradeLines(sample().lines).map((l) => l.amount)).toEqual([304.75, 36.57, 15.24])
    expect(tradeTotals(sample().lines)).toMatchObject({ items: 304.75, untaxed: 341.32, tax: 15.24, total: 356.56 })
    expect(documentTotal(po, sample())).toBe(356.56)
  })
  it('tax on the untaxed amount and a discount', () => {
    const lines = [{ ...newLine(), item_id: 'x', qty: 2, unit_price: 50 }, { ...newLine('D', 'discount'), description: 'Discount', percent: 10 }, { ...newLine('D', 'tax'), description: 'VAT', percent: 5, percent_base: 'untaxed' as const }]
    expect(tradeTotals(lines)).toMatchObject({ items: 100, discounts: 10, untaxed: 90, tax: 4.5, total: 94.5 })
  })
  it('every product line needs an item; other lines a description', () => {
    const s = sample()
    s.lines[0].item_id = null
    s.lines[1].description = ''
    expect(missingForPosting(po, s, { hasAttachment: false, accountNeedsProject: () => false })).toEqual(['line1.item', 'line2.description'])
  })
  it('sends quantities, prices and percentages to the database', () => {
    const rows = toLineRows(po, sample(), 'doc', 'co')
    expect(rows.map((r) => [r.line_kind, r.amount, r.percent ?? null])).toEqual([['item', 304.75, null], ['charge', 36.57, 12], ['tax', 15.24, 5]])
    expect(rows[0]).toMatchObject({ qty: 25, unit_price: 12.19 })
  })
})
