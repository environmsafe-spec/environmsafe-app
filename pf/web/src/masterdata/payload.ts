import type { Field } from './types'

/**
 * Turn form values into a row for the database:
 * empty strings become null, numbers are parsed, unknown keys are dropped,
 * and create-only fields are dropped when editing.
 */
export function buildPayload(fields: Field[], values: Record<string, unknown>, mode: 'create' | 'edit'): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (mode === 'edit' && f.createOnly) continue
    if (f.visibleWhen && !f.visibleWhen(values)) {
      if (f.type === 'checkbox') out[f.key] = false
      else out[f.key] = null
      continue
    }
    const v = values[f.key]
    if (f.type === 'checkbox') { out[f.key] = Boolean(v); continue }
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) { out[f.key] = null; continue }
    if (f.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
      if (!Number.isFinite(n)) throw new Error(`${f.key}: not a number`)
      out[f.key] = n
      continue
    }
    out[f.key] = typeof v === 'string' ? v.trim() : v
  }
  return out
}

/** Which required fields are still empty? Returns their keys. */
export function missingRequired(fields: Field[], values: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required && (!f.visibleWhen || f.visibleWhen(values)))
    .filter((f) => {
      const v = values[f.key]
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
    })
    .map((f) => f.key)
}

/** Case-insensitive search across the given keys (code, names, legacy id). */
export function matchesSearch(row: Record<string, unknown>, keys: string[], q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return keys.some((k) => String(row[k] ?? '').toLowerCase().includes(needle))
}
