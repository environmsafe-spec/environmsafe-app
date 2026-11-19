import { describe, expect, it } from 'vitest'
import { nameScore, normalizeName, planDraft, type Extraction, type MatchContext } from '../../../supabase/functions/_shared/voucher.ts'

const ctx: MatchContext = {
  today: '2026-11-08',
  parties: [
    { id: 'gulf', name_en: 'Gulf Calibration Services', name_ar: 'الخليج لخدمات المعايرة', is_customer: false, is_supplier: true, is_employee: false, is_active: true },
    { id: 'qut', name_en: 'Al Qutaibi Exchange', name_ar: 'القطيبي للصرافة', is_customer: false, is_supplier: true, is_employee: false, is_active: true },
    { id: 'unhcr', name_en: 'UNHCR Aden', name_ar: 'المفوضية السامية للاجئين - عدن', is_customer: true, is_supplier: false, is_employee: false, is_active: true },
  ],
  moneyAccounts: [
    { id: 'kusd', name_en: 'Kuraimi USD', name_ar: 'الكريمي دولار', currency: 'USD', bank_name: 'Al Kuraimi', account_no: '3108401426', is_active: true },
    { id: 'kyer', name_en: 'Kuraimi YER', name_ar: 'الكريمي ريال', currency: 'YER', bank_name: 'Al Kuraimi', account_no: '3108401999', is_active: true },
    { id: 'qsar', name_en: 'Qutaibi SAR', name_ar: null, currency: 'SAR', bank_name: 'Al Qutaibi', account_no: null, is_active: true },
  ],
  items: [{ id: 'gauge', name_en: 'Pressure gauge 0-10 bar', name_ar: 'مقياس ضغط', is_active: true }],
  openDocs: [
    { id: 'bill1', kind: 'supplier_bill', party_id: 'gulf', number: 'BILL-2026-0004', currency: 'USD', open_amount: 404.25 },
    { id: 'inv1', kind: 'sales_invoice', party_id: 'unhcr', number: 'INV-2026102501', currency: 'USD', open_amount: 3800 },
  ],
}
const ex = (o: Partial<Extraction>): Extraction => ({
  document_kind: 'payment_out', date: '2026-11-07', currency: 'USD', amount: null, fee: null, reference: null, counterparty_name: null,
  bank_or_company: null, account_number: null, invoice_number: null, description: null, lines: [], confidence: 'high', ...o,
})

describe('name matching', () => {
  it('normalises Arabic spelling variants', () => expect(normalizeName('المُفوَّضية السامية')).toEqual(normalizeName('المفوضيه السامية')))
  it('ignores "Al", company words and case', () => expect(nameScore('AL-QUTAIBI EXCHANGE CO.', 'Al Qutaibi Exchange')).toBe(1))
  it('matches Arabic to Arabic', () => expect(nameScore('شركة الخليج لخدمات المعايرة', 'الخليج لخدمات المعايرة')).toBeGreaterThan(0.7))
  it('does not confuse different names', () => expect(nameScore('Kuraimi Bank', 'Gulf Calibration Services')).toBe(0))
})

describe('planDraft', () => {
  it('bank transfer to a supplier becomes a supplier payment that settles the matching bill', () => {
    const p = planDraft(ex({ amount: 404.25, fee: 3, counterparty_name: 'GULF CALIBRATION SERVICES', account_number: '...1426', reference: 'TT-55120' }), ctx)
    expect(p.kind).toBe('supplier_payment')
    expect(p.doc).toMatchObject({ party_id: 'gulf', money_account_id: 'kusd', amount: 404.25, fee_amount: 3, reference_no: 'TT-55120' })
    expect(p.links).toEqual([{ to_document_id: 'bill1', amount: 404.25 }])
    expect(p.warnings).toEqual([])
  })
  it('money received from UNHCR (Arabic slip) becomes a receipt against the open invoice', () => {
    const p = planDraft(ex({ document_kind: 'money_received', amount: 3800, counterparty_name: 'المفوضية السامية للاجئين', bank_or_company: 'الكريمي' }), ctx)
    expect(p.kind).toBe('customer_receipt')
    expect(p.doc.party_id).toBe('unhcr')
    expect(p.doc.money_account_id).toBe('kusd')
    expect(p.links[0].to_document_id).toBe('inv1')
  })
  it('the currency picks the right account at the same bank', () => {
    expect(planDraft(ex({ currency: 'YER', amount: 50000, bank_or_company: 'Kuraimi' }), ctx).doc.money_account_id).toBe('kyer')
  })
  it('a supplier invoice becomes a bill with item lines; unknown items are flagged', () => {
    const p = planDraft(ex({ document_kind: 'supplier_invoice', counterparty_name: 'Gulf Calibration', invoice_number: 'GCS-INV-9',
      lines: [{ description: 'Pressure gauge 0-10 bar', quantity: 4, unit: 'pc', unit_price: 38.5, amount: 154 }, { description: 'Freight', quantity: 1, unit: null, unit_price: 20, amount: 20 }] }), ctx)
    expect(p.kind).toBe('supplier_bill')
    expect(p.lines.map((l) => [l.item_id, l.amount])).toEqual([['gauge', 154], [null, 20]])
    expect(p.doc.party_reference).toBe('GCS-INV-9')
    expect(p.warnings).toContain('No item matches "Freight": pick one or add it')
  })
  it('a shop receipt becomes an expense to complete, and nothing unreadable is guessed', () => {
    const p = planDraft(ex({ document_kind: 'expense_receipt', date: null, amount: 12.5, description: 'Printer paper', bank_or_company: 'Unknown Bank', confidence: 'low' }), ctx)
    expect(p.kind).toBe('expense')
    expect(p.doc.doc_date).toBe('2026-11-08')
    expect(p.doc.money_account_id).toBeNull()
    expect(p.warnings).toEqual(expect.arrayContaining(['Date not readable: set to today', 'Choose what it was for (account) and the project', 'The AI was not sure about this voucher: check every field']))
  })
})
