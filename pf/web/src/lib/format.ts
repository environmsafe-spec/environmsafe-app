/** Decimal places used when showing an amount in a currency. */
export const currencyDecimals: Record<string, number> = { USD: 2, SAR: 2, YER: 0 }

/** Format an amount for display, e.g. formatMoney(1234.5, 'USD') -> "1,234.50 USD". */
export function formatMoney(amount: number | string | null | undefined, currency: string, locale = 'en'): string {
  if (amount === null || amount === undefined || amount === '') return ''
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return ''
  const d = currencyDecimals[currency] ?? 2
  const s = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n)
  return `${s} ${currency}`
}

/** Convert an amount in a currency to USD with a rate expressed per USD (SAR 3.79 -> 1 USD). */
export function toUsd(amount: number, ratePerUsd: number): number {
  if (!(ratePerUsd > 0)) throw new Error('Rate must be greater than zero')
  return Math.round((amount / ratePerUsd) * 100) / 100
}

/** Show the name in the user's language, falling back to English. */
export function localName(row: { name_en?: string | null; name_ar?: string | null }, lang: string): string {
  return (lang === 'ar' && row.name_ar) || row.name_en || ''
}
