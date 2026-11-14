import { describe, expect, it } from 'vitest'
import { buildPayload, matchesSearch, missingRequired } from './payload'
import type { Field } from './types'

const fields: Field[] = [
  { key: 'name_en', label: '', type: 'text', required: true },
  { key: 'name_ar', label: '', type: 'text' },
  { key: 'budget_amount', label: '', type: 'number' },
  { key: 'is_asset', label: '', type: 'checkbox' },
  { key: 'life_years', label: '', type: 'number', visibleWhen: (v) => Boolean(v.is_asset) },
  { key: 'kind', label: '', type: 'select', createOnly: true },
]

describe('buildPayload', () => {
  it('trims text, nulls empties, parses numbers', () => {
    expect(buildPayload(fields, { name_en: '  PSV test ', name_ar: '', budget_amount: '1,250.5', is_asset: false, kind: 'goods' }, 'create'))
      .toEqual({ name_en: 'PSV test', name_ar: null, budget_amount: 1250.5, is_asset: false, life_years: null, kind: 'goods' })
  })
  it('drops create-only fields on edit', () => {
    expect(buildPayload(fields, { name_en: 'A', kind: 'service' }, 'edit')).not.toHaveProperty('kind')
  })
  it('keeps conditional fields when visible', () => {
    expect(buildPayload(fields, { name_en: 'Crane', is_asset: true, life_years: 5 }, 'create').life_years).toBe(5)
  })
  it('rejects text in a number field', () => {
    expect(() => buildPayload(fields, { name_en: 'A', budget_amount: 'abc' }, 'create')).toThrow()
  })
})

describe('missingRequired', () => {
  it('lists empty required fields', () => expect(missingRequired(fields, { name_en: ' ' })).toEqual(['name_en']))
  it('passes when filled', () => expect(missingRequired(fields, { name_en: 'X' })).toEqual([]))
})

describe('matchesSearch', () => {
  const row = { code: 'SU-0004', name_en: 'Al Qutaibi Exchange', legacy_id: 'SUP-UL-0012' }
  it('finds by legacy id', () => expect(matchesSearch(row, ['code', 'name_en', 'legacy_id'], 'sup-ul-0012')).toBe(true))
  it('finds by partial name', () => expect(matchesSearch(row, ['code', 'name_en'], 'qutaibi')).toBe(true))
  it('rejects non-matches', () => expect(matchesSearch(row, ['code', 'name_en'], 'kuraimi')).toBe(false))
})
