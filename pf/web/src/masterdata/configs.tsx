import { Badge } from '@mantine/core'
import { formatMoney, localName } from '../lib/format'
import type { Column, Field, MasterConfig, Row } from './types'

const nameCol: Column = { key: 'name', label: 'common.name', render: (r, { lang }) => localName(r as never, lang) }
const codeCol: Column = { key: 'code', label: 'common.code', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{String(r.code)}</span> }
const legacyCol: Column = { key: 'legacy_id', label: 'common.legacyId' }
const enumCol = (key: string, label: string): Column => ({ key, label, render: (r, { t }) => t(`enum.${String(r[key])}`) })

const names: Field[] = [
  { key: 'name_en', label: 'common.nameEn', type: 'text', required: true },
  { key: 'name_ar', label: 'common.nameAr', type: 'text', dir: 'rtl' },
]
const contact: Field[] = [
  { key: 'phone', label: 'md.phone', type: 'text' },
  { key: 'email', label: 'md.email', type: 'text' },
  { key: 'address', label: 'md.address', type: 'text' },
  { key: 'city', label: 'md.city', type: 'text' },
  { key: 'country', label: 'md.country', type: 'text' },
]
const postable = { is_postable: true, is_active: true }

export const projectsConfig: MasterConfig = {
  id: 'projects', table: 'projects', title: 'md.projects', managePerms: ['projects.manage'], autoCode: true,
  orderBy: 'code', searchKeys: ['code', 'name_en', 'name_ar', 'legacy_id'],
  defaults: { kind: 'contract', status: 'active' },
  columns: [codeCol, nameCol,
    { key: 'customer_id', label: 'md.customer', render: (r, { refName }) => refName('parties', r.customer_id) },
    enumCol('kind', 'md.kind'),
    { key: 'status', label: 'md.status', render: (r, { t }) => (
      <Badge color={r.status === 'active' ? 'green' : r.status === 'closed' ? 'gray' : 'yellow'} variant="light">{t(`enum.${String(r.status)}`)}</Badge>) },
    { key: 'budget_amount', label: 'md.budget', render: (r) => <bdi>{formatMoney(r.budget_amount as number, String(r.budget_currency ?? 'USD'))}</bdi> },
    legacyCol],
  fields: [...names,
    { key: 'customer_id', label: 'md.customer', type: 'ref', ref: { table: 'parties', filter: { is_customer: true } } },
    { key: 'kind', label: 'md.kind', type: 'select', options: ['contract', 'internal'], required: true },
    { key: 'status', label: 'md.status', type: 'select', options: ['active', 'on_hold', 'closed'], required: true },
    { key: 'budget_amount', label: 'md.budget', type: 'number' },
    { key: 'budget_currency', label: 'md.budgetCurrency', type: 'currency' },
    { key: 'start_date', label: 'md.startDate', type: 'date' },
    { key: 'end_date', label: 'md.endDate', type: 'date' },
    { key: 'drive_folder_url', label: 'md.driveFolder', type: 'text', dir: 'ltr' },
    { key: 'description', label: 'md.description', type: 'textarea' }],
}

const partyBase = (kind: 'customer' | 'supplier' | 'employee'): Pick<MasterConfig, 'table' | 'autoCode' | 'orderBy' | 'searchKeys' | 'hasActiveFlag'> & { baseFilter: Record<string, unknown> } => ({
  table: 'parties', autoCode: true, orderBy: 'code', hasActiveFlag: true,
  searchKeys: ['code', 'name_en', 'name_ar', 'legacy_id', 'phone', 'email'],
  baseFilter: { [`is_${kind}`]: true },
})

export const customersConfig: MasterConfig = {
  id: 'customers', ...partyBase('customer'), title: 'md.customers',
  managePerms: ['customers.manage'], createPerms: ['customers.manage', 'masterdata.create'],
  defaults: { primary_kind: 'customer' },
  columns: [codeCol, nameCol, { key: 'phone', label: 'md.phone' }, { key: 'email', label: 'md.email' }, legacyCol],
  fields: [...names, { key: 'contact_person', label: 'md.contact', type: 'text' }, ...contact,
    { key: 'tax_no', label: 'md.taxNo', type: 'text' },
    { key: 'default_currency', label: 'md.currency', type: 'currency' },
    { key: 'default_project_id', label: 'md.defaultProject', type: 'ref', ref: { table: 'projects' } },
    { key: 'is_supplier', label: 'md.alsoSupplier', type: 'checkbox' },
    { key: 'notes', label: 'common.notes', type: 'textarea' }],
}

export const suppliersConfig: MasterConfig = {
  id: 'suppliers', ...partyBase('supplier'), title: 'md.suppliers',
  managePerms: ['suppliers.manage'], createPerms: ['suppliers.manage', 'masterdata.create'],
  defaults: { primary_kind: 'supplier' },
  columns: [codeCol, nameCol, { key: 'phone', label: 'md.phone' }, { key: 'city', label: 'md.city' }, legacyCol],
  fields: [...names, { key: 'contact_person', label: 'md.contact', type: 'text' }, ...contact,
    { key: 'tax_no', label: 'md.taxNo', type: 'text' },
    { key: 'default_currency', label: 'md.currency', type: 'currency' },
    { key: 'default_gl_account_id', label: 'md.defaultAccount', type: 'ref', ref: { table: 'gl_accounts', filter: postable } },
    { key: 'is_customer', label: 'md.alsoCustomer', type: 'checkbox' },
    { key: 'notes', label: 'common.notes', type: 'textarea' }],
}

export const employeesConfig: MasterConfig = {
  id: 'employees', ...partyBase('employee'), title: 'md.employees',
  managePerms: ['employees.manage'], createPerms: ['employees.manage', 'masterdata.create'],
  defaults: { primary_kind: 'employee' },
  columns: [codeCol, nameCol, { key: 'job_title', label: 'md.jobTitle' }, { key: 'phone', label: 'md.phone' }, legacyCol],
  fields: [...names, { key: 'job_title', label: 'md.jobTitle', type: 'text' },
    { key: 'phone', label: 'md.phone', type: 'text' }, { key: 'email', label: 'md.email', type: 'text' },
    { key: 'default_project_id', label: 'md.defaultProject', type: 'ref', ref: { table: 'projects' } },
    { key: 'treat_withdrawals_as_drawings', label: 'md.drawings', type: 'checkbox' },
    { key: 'notes', label: 'common.notes', type: 'textarea' }],
}

export const itemsConfig: MasterConfig = {
  id: 'items', table: 'items', title: 'md.items', managePerms: ['items.manage'],
  createPerms: ['items.manage', 'masterdata.create'], autoCode: true, hasActiveFlag: true,
  orderBy: 'code', searchKeys: ['code', 'name_en', 'name_ar', 'legacy_id'], defaults: { kind: 'service', unit: 'ea' },
  columns: [codeCol, nameCol, enumCol('kind', 'md.kind'), { key: 'unit', label: 'md.unit' },
    { key: 'last_cost', label: 'md.lastCost', render: (r) => <bdi>{formatMoney(r.last_cost as number, String(r.last_cost_currency ?? 'USD'))}</bdi> },
    { key: 'last_sale_price', label: 'md.lastPrice', render: (r) => <bdi>{formatMoney(r.last_sale_price as number, String(r.last_sale_currency ?? 'USD'))}</bdi> },
    legacyCol],
  fields: [...names,
    { key: 'kind', label: 'md.kind', type: 'select', options: ['goods', 'service'], required: true },
    { key: 'unit', label: 'md.unit', type: 'text', required: true },
    { key: 'default_expense_account_id', label: 'md.expenseAccount', type: 'ref', ref: { table: 'gl_accounts', filter: { ...postable, account_type: 'expense' } } },
    { key: 'default_revenue_account_id', label: 'md.revenueAccount', type: 'ref', ref: { table: 'gl_accounts', filter: { ...postable, account_type: 'income' } } },
    { key: 'is_asset', label: 'md.isAsset', type: 'checkbox' },
    { key: 'life_years', label: 'md.lifeYears', type: 'number', required: true, visibleWhen: (v) => Boolean(v.is_asset) }],
}

export const moneyAccountsConfig: MasterConfig = {
  id: 'money_accounts', table: 'money_accounts', title: 'md.moneyAccounts', managePerms: ['money_accounts.manage'],
  autoCode: true, hasActiveFlag: true, orderBy: 'code', searchKeys: ['code', 'name_en', 'name_ar', 'legacy_id', 'bank_name', 'account_no'],
  defaults: { kind: 'bank', currency: 'USD', opening_balance: 0 },
  columns: [codeCol, nameCol, enumCol('kind', 'md.kind'), { key: 'currency', label: 'md.currency' },
    { key: 'bank_name', label: 'md.bankName' },
    { key: 'opening_balance', label: 'md.openingBalance', render: (r: Row) => <bdi>{formatMoney(r.opening_balance as number, String(r.currency))}</bdi> },
    legacyCol],
  fields: [...names,
    { key: 'kind', label: 'md.kind', type: 'select', options: ['bank', 'exchange', 'card', 'cash'], required: true },
    { key: 'currency', label: 'md.currency', type: 'currency', required: true, createOnly: true },
    { key: 'bank_name', label: 'md.bankName', type: 'text' },
    { key: 'account_no', label: 'md.accountNo', type: 'text', dir: 'ltr' },
    { key: 'iban', label: 'md.iban', type: 'text', dir: 'ltr' },
    { key: 'holder_party_id', label: 'md.holder', type: 'ref', ref: { table: 'parties', filter: { is_employee: true } } },
    { key: 'usual_fee', label: 'md.usualFee', type: 'number' },
    { key: 'opening_balance', label: 'md.openingBalance', type: 'number' },
    { key: 'opening_date', label: 'md.openingDate', type: 'date' },
    { key: 'notes', label: 'common.notes', type: 'textarea' }],
}

export const coaConfig: MasterConfig = {
  id: 'gl_accounts', table: 'gl_accounts', title: 'md.coa', managePerms: ['gl.manage'], hasActiveFlag: true,
  orderBy: 'code', searchKeys: ['code', 'name_en', 'name_ar', 'ifrs_line'],
  defaults: { is_postable: true },
  columns: [
    { key: 'code', label: 'common.code', render: (r) => <span style={{ whiteSpace: 'nowrap', fontWeight: r.is_postable ? 400 : 700, paddingInlineStart: r.parent_id ? 16 : 0 }}>{String(r.code)}</span> },
    { key: 'name', label: 'common.name', render: (r, { lang }) => <span style={{ fontWeight: r.is_postable ? 400 : 700 }}>{localName(r as never, lang)}</span> },
    enumCol('account_type', 'md.type'),
    { key: 'ifrs_line', label: 'md.ifrsLine' },
    { key: 'requires_project', label: 'md.requiresProject', render: (r, { t }) => (r.requires_project ? t('common.yes') : '') },
    { key: 'control_kind', label: 'md.control' }],
  fields: [
    { key: 'code', label: 'common.code', type: 'text', required: true, createOnly: true, dir: 'ltr' },
    ...names,
    { key: 'account_type', label: 'md.type', type: 'select', options: ['asset', 'liability', 'equity', 'income', 'expense'], required: true, createOnly: true },
    { key: 'parent_id', label: 'md.parent', type: 'ref', ref: { table: 'gl_accounts', filter: { is_postable: false } }, createOnly: true },
    { key: 'ifrs_line', label: 'md.ifrsLine', type: 'text', required: true, dir: 'ltr' },
    { key: 'requires_project', label: 'md.requiresProject', type: 'checkbox' }],
}

export const ratesConfig: MasterConfig = {
  id: 'fx_rates', table: 'fx_rates', title: 'md.rates', managePerms: ['rates.manage'],
  orderBy: 'rate_date', searchKeys: ['currency', 'rate_date', 'source'],
  columns: [{ key: 'rate_date', label: 'md.date' }, { key: 'currency', label: 'md.currency' },
    { key: 'rate_per_usd', label: 'md.ratePerUsd' }, { key: 'source', label: 'md.source' }],
  fields: [
    { key: 'rate_date', label: 'md.date', type: 'date', required: true },
    { key: 'currency', label: 'md.currency', type: 'currency', required: true },
    { key: 'rate_per_usd', label: 'md.ratePerUsd', type: 'number', required: true },
    { key: 'source', label: 'md.source', type: 'text' }],
}
