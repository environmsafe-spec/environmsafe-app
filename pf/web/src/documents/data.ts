import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { KindInfo } from './logic'

export interface MoneyAccount { id: string; code: string; name_en: string; name_ar: string | null; currency: string; kind: string; usual_fee: number | null; is_active: boolean }
export interface Party { id: string; code: string; name_en: string; name_ar: string | null; is_customer: boolean; is_supplier: boolean; is_employee: boolean; is_owner: boolean; default_project_id: string | null; default_gl_account_id: string | null; is_active: boolean }
export interface GlAccount { id: string; code: string; name_en: string; name_ar: string | null; account_type: string; is_postable: boolean; requires_project: boolean; control_kind: string | null; is_active: boolean }
export interface Project { id: string; code: string; name_en: string; name_ar: string | null; status: string; kind: string }

function useCompanyTable<T>(table: string, select: string, order = 'code') {
  const { company } = useAuth()
  return useQuery({
    queryKey: ['tbl', table, company?.company_id],
    enabled: Boolean(company),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select(select).eq('company_id', company!.company_id).order(order)
      if (error) throw error
      return (data ?? []) as unknown as T[]
    },
  })
}

export const useMoneyAccounts = () => useCompanyTable<MoneyAccount>('money_accounts', 'id, code, name_en, name_ar, currency, kind, usual_fee, is_active')
export const useParties = () => useCompanyTable<Party>('parties', 'id, code, name_en, name_ar, is_customer, is_supplier, is_employee, is_owner, default_project_id, default_gl_account_id, is_active')
export const useGlAccounts = () => useCompanyTable<GlAccount>('gl_accounts', 'id, code, name_en, name_ar, account_type, is_postable, requires_project, control_kind, is_active')
export const useProjects = () => useCompanyTable<Project>('projects', 'id, code, name_en, name_ar, status, kind')

export function useDocKinds() {
  return useQuery({
    queryKey: ['doc_kinds'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from('doc_kinds').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as KindInfo[]
    },
  })
}

export function partyMatchesRole(p: Party, role: KindInfo['party_role']): boolean {
  switch (role) {
    case 'supplier': return p.is_supplier
    case 'customer': return p.is_customer
    case 'employee': return p.is_employee
    case 'owner': return p.is_owner
    case 'employee_or_owner': return p.is_employee || p.is_owner
    default: return true
  }
}

/** Remember the last bank / cash account used (per browser). */
export const lastAccount = {
  get(): string | null { try { return localStorage.getItem('espf.lastAccount') } catch { return null } },
  set(id: string) { try { localStorage.setItem('espf.lastAccount', id) } catch { /* ignore */ } },
}

/** SHA-256 of a file, hex. Stored with each attachment so auditors can verify it. */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface Item { id: string; code: string; name_en: string; name_ar: string | null; kind: 'goods' | 'service'; unit: string; last_cost: number | null; last_sale_price: number | null; default_expense_account_id: string | null; default_revenue_account_id: string | null; is_active: boolean }
export const useItems = () => useCompanyTable<Item>('items', 'id, code, name_en, name_ar, kind, unit, last_cost, last_sale_price, default_expense_account_id, default_revenue_account_id, is_active')

export function useCompanySettings() {
  const { company } = useAuth()
  return useQuery({
    queryKey: ['company-settings', company?.company_id],
    enabled: Boolean(company),
    staleTime: 300_000,
    queryFn: async () => {
      const { data } = await supabase.from('companies').select('settings').eq('id', company!.company_id)
      return ((data ?? [])[0]?.settings ?? {}) as Record<string, unknown>
    },
  })
}
