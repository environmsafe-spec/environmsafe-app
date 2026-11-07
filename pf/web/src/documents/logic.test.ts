import { describe, expect, it } from 'vitest'
import { documentTotal, emptyDoc, journalDifference, missingForPosting, newLine, toDocumentRow, toLineRows, usdEquivalent, type KindInfo } from './logic'

const base: Omit<KindInfo, 'kind'> = {
  number_type: 'payment', direction: 'out', has_lines: false, money_account: 'required', party_role: null,
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
