import { describe, expect, it } from 'vitest'
import { toCsv } from './export'
import { groupStatement, IFRS_LABELS } from './statements'

describe('toCsv', () => {
  it('adds a BOM, quotes commas and quotes', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1.5, null]])).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n1.5,')
  })
  it('keeps Arabic text', () => expect(toCsv(['name'], [['عام']])).toContain('عام'))
})

describe('groupStatement', () => {
  const rows = [
    { code: '4100', name_en: 'Inspection', name_ar: null, account_type: 'income', ifrs_line: 'revenue', amount: 5000, cmp_amount: 1000 },
    { code: '5100', name_en: 'Subcontractors', name_ar: null, account_type: 'expense', ifrs_line: 'cost_of_sales', amount: -2000, cmp_amount: 0 },
    { code: '6300', name_en: 'Rent', name_ar: null, account_type: 'expense', ifrs_line: 'administrative_expenses', amount: -500, cmp_amount: 0 },
    { code: '7000', name_en: 'FX', name_ar: null, account_type: 'expense', ifrs_line: 'other_gains_losses', amount: -10, cmp_amount: 0 },
  ]
  it('builds IFRS sections with gross and operating profit', () => {
    const g = groupStatement(rows)
    expect(g.gross).toEqual({ amount: 3000, cmp: 1000 })
    expect(g.operating).toEqual({ amount: 2500, cmp: 1000 })
    expect(g.profit).toEqual({ amount: 2490, cmp: 1000 })
    expect(g.sections.map((s) => s.key)).toEqual(['revenue', 'cost_of_sales', 'operating', 'other'])
  })
  it('has a label for every statement line used by the chart of accounts', () => {
    for (const k of ['revenue', 'cost_of_sales', 'administrative_expenses', 'distribution_costs', 'depreciation', 'other_gains_losses',
      'cash_and_cash_equivalents', 'trade_receivables', 'trade_payables', 'retained_earnings', 'profit_for_period']) expect(IFRS_LABELS[k]).toBeTruthy()
  })
})
