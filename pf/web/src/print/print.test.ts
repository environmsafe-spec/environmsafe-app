import { describe, expect, it } from 'vitest'
import { buildPrintDocument, dateLong, parseTerms, type PrintDoc, type PrintLine } from '../../../supabase/functions/_shared/print.ts'

const company = { name_en: 'EnvironmSafe', legal_name: 'EnvironmSafe For Engineering, Trading, and Services Ltd', settings: { invoice_terms: 'Payment: As agreed\nBank: Al Kuraimi Bank, account no. 3108401426' } }
const base: PrintDoc = {
  kind: 'purchase_order', number_type: 'purchase_order', status: 'posted', number: '2026110101', temp_number: 'DRAFT-1', revision: 0,
  doc_date: '2026-11-01', due_date: null, valid_until: '2026-12-01', currency: 'USD', amount: 356.56, fee_amount: 0,
  party_reference: 'SO/SEC/2026/01212', reference_no: null, attention: 'Mr. Abubakr Mohammed, Sales', terms: 'Reference: Quotation\nPayment: As agreed',
  description: null, verify_token: '11111111-2222-4333-8444-555555555555',
}
const line = (o: Partial<PrintLine>): PrintLine => ({ line_no: 1, line_kind: 'item', description: null, detail: null, qty: 1, unit: null, unit_price: null, amount: 0, percent: null, percent_base: null, ...o })
const poLines = [
  line({ line_no: 1, description: 'TRAC102.11R (Nalco)', detail: 'Water treatment chemical | 25 Kg / Can', qty: 25, unit: 'Kg', unit_price: 12.19, amount: 304.75, item_code: '006153' }),
  line({ line_no: 2, line_kind: 'charge', description: 'Nalco temp. surcharge 12%', amount: 36.57, percent: 12 }),
  line({ line_no: 3, line_kind: 'tax', description: 'Tax', amount: 15.24, percent: 5, percent_base: 'items' }),
]
const supplier = { code: 'SU-0001', name_en: 'Soham Engineering', address: 'Abyan Coast, in front of Crown Hotel', city: 'Khor Maksar, Aden', country: 'Yemen', email: 'commercial@soham-engineering.com' }

describe('buildPrintDocument — purchase order (sample PO)', () => {
  const p = buildPrintDocument({ doc: base, lines: poLines, party: supplier, company, appUrl: 'https://app.environmsafe.com/' })
  it('reproduces the sample totals block', () => {
    expect(p.totals).toEqual([
      { label: 'Products subtotal', value: 304.75 }, { label: 'Nalco temp. surcharge 12%', value: 36.57 },
      { label: 'Untaxed amount', value: 341.32 }, { label: 'Tax rate', value: '5% on 304.75' }, { label: 'Tax', value: 15.24 },
    ])
    expect(p.total).toEqual({ label: 'TOTAL', value: 'USD 356.56' })
  })
  it('fills the meta box like the sample', () => {
    expect(p.meta).toEqual([['PO #', '2026110101'], ['DATE', '01-Nov-2026'], ['REFERENCE', 'SO/SEC/2026/01212'], ['QUOTE VALID TO', '01-Dec-2026']])
  })
  it('prefixes the item code and keeps the detail line', () => {
    expect(p.lines[0]).toMatchObject({ description: '[006153] TRAC102.11R (Nalco)', detail: 'Water treatment chemical | 25 Kg / Can', qty: 25, unit_price: 12.19 })
  })
  it('adds the supplier acceptance block and a verification link', () => {
    expect(p.signature).toMatchObject({ style: 'acceptance', acceptance: { party: 'Soham Engineering', name: 'Mr. Abubakr Mohammed, Sales' }, signed: true })
    expect(p.verify_url).toBe('https://app.environmsafe.com/verify/11111111-2222-4333-8444-555555555555')
    expect(p.to.lines).toContain('Attn: Mr. Abubakr Mohammed, Sales')
  })
})

describe('buildPrintDocument — invoice (sample invoice)', () => {
  const doc: PrintDoc = { ...base, kind: 'sales_invoice', number_type: 'sales_invoice', number: 'INV-2026110701', doc_date: '2026-11-07', due_date: '2026-11-07', amount: 1852.63, terms: null, party_reference: 'Quotation 2026091301 V1', attention: 'Mr. Abdulaleem' }
  const p = buildPrintDocument({
    doc, company, appUrl: 'https://app.environmsafe.com',
    lines: [line({ description: 'Calibration of Temperature Calibrator', amount: 926.32, unit_price: 926.32, unit: 'PC' }), line({ line_no: 2, description: 'Calibration of Digital Pressure Calibrator', amount: 926.31, unit_price: 926.31, unit: 'PC' })],
    party: { code: 'CU-0123', name_en: 'YGCI', city: 'Taiz', country: 'Republic of Yemen', is_customer: true },
  })
  it('shows discount and "Not applicable" tax like the sample', () => {
    expect(p.totals).toEqual([{ label: 'Subtotal', value: 1852.63 }, { label: 'Discount', value: 0 }, { label: 'Tax / VAT', value: 'Not applicable' }])
    expect(p.total.value).toBe('USD 1,852.63')
  })
  it('uses the company invoice terms and asks for the amount in words', () => {
    expect(p.terms.map((t) => t.label)).toEqual(['Payment', 'Bank'])
    expect(p.amount_words).toBe(true)
    expect(p.meta[3]).toEqual(['TERMS', 'Due on receipt'])
  })
  it('a draft prints unsigned, watermarked and without a QR code', () => {
    const d = buildPrintDocument({ doc: { ...doc, status: 'draft', number: null }, lines: [], party: null, company, appUrl: 'x' })
    expect(d.status).toBe('draft')
    expect(d.verify_url).toBeNull()
    expect(d.signature).toMatchObject({ signed: false })
    expect(d.number).toBe('DRAFT-1')
  })
})

describe('helpers', () => {
  it('formats dates like the samples', () => expect(dateLong('2026-11-07')).toBe('07-Nov-2026'))
  it('parses terms lines', () => expect(parseTerms('Payment: 100% advance\nThank you')).toEqual([{ label: 'Payment', text: '100% advance' }, { label: '', text: 'Thank you' }]))
})
