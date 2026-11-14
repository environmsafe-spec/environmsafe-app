import type { ReactNode } from 'react'

export type Row = Record<string, unknown> & { id: string }

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select' | 'ref' | 'currency'

export interface RefSource {
  table: 'parties' | 'projects' | 'gl_accounts' | 'items'
  /** Extra equality filters, e.g. { is_customer: true } */
  filter?: Record<string, unknown>
}

export interface Field {
  key: string
  label: string                         // i18n key
  type: FieldType
  required?: boolean
  options?: string[]                    // for 'select': enum values, labelled via enum.<value>
  ref?: RefSource
  dir?: 'rtl' | 'ltr'                   // force direction (e.g. Arabic name)
  /** Only editable when creating (immutable afterwards in the database). */
  createOnly?: boolean
  /** Hidden unless this predicate on the current form values is true. */
  visibleWhen?: (values: Record<string, unknown>) => boolean
}

export interface Column {
  key: string
  label: string                         // i18n key
  render?: (row: Row, ctx: { lang: string; t: (k: string) => string; refName: (table: string, id: unknown) => string }) => ReactNode
}

export interface MasterConfig {
  id: string
  table: 'projects' | 'parties' | 'items' | 'money_accounts' | 'gl_accounts' | 'fx_rates'
  title: string                         // i18n key
  /** Any of these permissions allows editing existing rows. */
  managePerms: string[]
  /** Any of these permissions allows creating rows (defaults to managePerms). */
  createPerms?: string[]
  /** The database assigns the code (PJ-0001 ...). */
  autoCode?: boolean
  baseFilter?: Record<string, unknown>
  defaults?: Record<string, unknown>
  orderBy: string
  searchKeys: string[]
  columns: Column[]
  fields: Field[]
  hasActiveFlag?: boolean
}
