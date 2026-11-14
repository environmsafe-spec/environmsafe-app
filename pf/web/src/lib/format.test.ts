import { describe, expect, it } from 'vitest'
import { formatMoney, localName, toUsd } from './format'

describe('formatMoney', () => {
  it('formats USD with two decimals', () => expect(formatMoney(1234.5, 'USD')).toBe('1,234.50 USD'))
  it('formats YER without decimals', () => expect(formatMoney(155600, 'YER')).toBe('155,600 YER'))
  it('accepts numeric strings from Postgres', () => expect(formatMoney('99.9', 'SAR')).toBe('99.90 SAR'))
  it('returns empty for null', () => expect(formatMoney(null, 'USD')).toBe(''))
  it('uses Latin digits in Arabic', () => expect(formatMoney(1000, 'USD', 'ar')).toMatch(/1[,٬]000[.٫]00 USD/))
})

describe('toUsd', () => {
  it('converts SAR at 3.79', () => expect(toUsd(379, 3.79)).toBe(100))
  it('converts YER at 1556', () => expect(toUsd(1556, 1556)).toBe(1))
  it('rejects a zero rate', () => expect(() => toUsd(1, 0)).toThrow())
})

describe('localName', () => {
  it('prefers Arabic when available', () => expect(localName({ name_en: 'General', name_ar: 'عام' }, 'ar')).toBe('عام'))
  it('falls back to English', () => expect(localName({ name_en: 'General', name_ar: null }, 'ar')).toBe('General'))
})
