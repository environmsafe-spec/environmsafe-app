import { describe, expect, it } from 'vitest'
import ar from '../locales/ar'
import en from '../locales/en'

function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])
}

describe('translations', () => {
  it('Arabic has every English key', () => expect(keys(ar).sort()).toEqual(keys(en).sort()))
  it('no empty Arabic strings', () => {
    const empty = keys(ar).filter((k) => {
      const v = k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], ar)
      return typeof v === 'string' && v.trim() === ''
    })
    expect(empty).toEqual([])
  })
})
