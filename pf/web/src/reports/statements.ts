// Presentation of the IFRS-for-SMEs statements from account-level rows (pure, unit-tested).

export const IFRS_LABELS: Record<string, { en: string; ar: string }> = {
  revenue: { en: 'Revenue', ar: 'الإيرادات' },
  other_income: { en: 'Other income', ar: 'إيرادات أخرى' },
  cost_of_sales: { en: 'Cost of sales', ar: 'تكلفة المبيعات' },
  administrative_expenses: { en: 'Administrative expenses', ar: 'المصروفات الإدارية' },
  distribution_costs: { en: 'Distribution and marketing costs', ar: 'مصروفات التوزيع والتسويق' },
  depreciation: { en: 'Depreciation', ar: 'الإهلاك' },
  other_gains_losses: { en: 'Other gains and losses (FX)', ar: 'أرباح وخسائر أخرى (فروق عملة)' },
  finance_costs: { en: 'Finance costs', ar: 'تكاليف التمويل' },
  cash_and_cash_equivalents: { en: 'Cash and cash equivalents', ar: 'النقد وما في حكمه' },
  trade_receivables: { en: 'Trade receivables', ar: 'ذمم مدينة تجارية' },
  other_receivables: { en: 'Other receivables', ar: 'ذمم مدينة أخرى' },
  prepayments: { en: 'Prepayments and deposits', ar: 'مدفوعات مقدمة وتأمينات' },
  inventories: { en: 'Inventories', ar: 'المخزون' },
  property_plant_equipment: { en: 'Property, plant and equipment', ar: 'الممتلكات والمعدات' },
  trade_payables: { en: 'Trade payables', ar: 'ذمم دائنة تجارية' },
  other_payables: { en: 'Other payables and accruals', ar: 'ذمم دائنة أخرى ومستحقات' },
  contract_liabilities: { en: 'Customer advances', ar: 'دفعات مقدمة من العملاء' },
  related_party_payables: { en: 'Owner current account', ar: 'جاري المالك' },
  tax_payables: { en: 'Tax payable', ar: 'ضرائب مستحقة' },
  share_capital: { en: 'Share capital', ar: 'رأس المال' },
  retained_earnings: { en: 'Retained earnings', ar: 'الأرباح المحتجزة' },
  drawings: { en: 'Owner drawings', ar: 'مسحوبات المالك' },
  profit_for_period: { en: 'Profit for the year to date', ar: 'ربح السنة حتى تاريخه' },
}
export const ifrsLabel = (k: string, lang: string) => (IFRS_LABELS[k] ? (lang === 'ar' ? IFRS_LABELS[k].ar : IFRS_LABELS[k].en) : k)

export interface PlRow { code: string; name_en: string; name_ar: string | null; account_type: string; ifrs_line: string; amount: number; cmp_amount: number }
interface Section { key: 'revenue' | 'cost_of_sales' | 'operating' | 'other'; lines: string[]; rows: PlRow[]; amount: number; cmp: number }

const SECTIONS: { key: Section['key']; lines: string[] }[] = [
  { key: 'revenue', lines: ['revenue', 'other_income'] },
  { key: 'cost_of_sales', lines: ['cost_of_sales'] },
  { key: 'operating', lines: ['administrative_expenses', 'distribution_costs', 'depreciation'] },
  { key: 'other', lines: ['other_gains_losses', 'finance_costs'] },
]
const r2 = (n: number) => Math.round(n * 100) / 100

/** Group P&L rows (income +, expense −) into sections with gross / operating / net profit. */
export function groupStatement(rows: PlRow[]) {
  const sections: Section[] = SECTIONS.map((s) => {
    const rs = rows.filter((r) => s.lines.includes(r.ifrs_line))
    return { ...s, rows: rs, amount: r2(rs.reduce((a, r) => a + Number(r.amount), 0)), cmp: r2(rs.reduce((a, r) => a + Number(r.cmp_amount), 0)) }
  }).filter((s) => s.rows.length)
  // Anything on an unexpected line still counts, under "other".
  const known = SECTIONS.flatMap((s) => s.lines)
  const extra = rows.filter((r) => !known.includes(r.ifrs_line))
  if (extra.length) {
    const other = sections.find((s) => s.key === 'other')
    const add = { amount: r2(extra.reduce((a, r) => a + Number(r.amount), 0)), cmp: r2(extra.reduce((a, r) => a + Number(r.cmp_amount), 0)) }
    if (other) { other.rows.push(...extra); other.amount = r2(other.amount + add.amount); other.cmp = r2(other.cmp + add.cmp) }
    else sections.push({ key: 'other', lines: [], rows: extra, ...add })
  }
  const sum = (keys: Section['key'][]) => ({
    amount: r2(sections.filter((s) => keys.includes(s.key)).reduce((a, s) => a + s.amount, 0)),
    cmp: r2(sections.filter((s) => keys.includes(s.key)).reduce((a, s) => a + s.cmp, 0)),
  })
  return { sections, gross: sum(['revenue', 'cost_of_sales']), operating: sum(['revenue', 'cost_of_sales', 'operating']), profit: sum(['revenue', 'cost_of_sales', 'operating', 'other']) }
}
