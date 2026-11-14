import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { backendConfigured, supabase } from '../lib/supabase'

export interface CompanyAccess {
  company_id: string
  name_en: string
  name_ar: string | null
  roles: string[]
  mfa_required: boolean
}

type Status = 'loading' | 'signedOut' | 'needsMfa' | 'noCompany' | 'ready'

interface AuthState {
  status: Status
  session: Session | null
  company: CompanyAccess | null
  companies: CompanyAccess[]
  permissions: Set<string>
  can: (perm: string) => boolean
  selectCompany: (id: string) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)
const COMPANY_KEY = 'espf.company'
const IDLE_MINUTES = 30

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [companies, setCompanies] = useState<CompanyAccess[]>([])
  const [companyId, setCompanyId] = useState<string | null>(() => {
    try { return localStorage.getItem(COMPANY_KEY) } catch { return null }
  })
  const [permissions, setPermissions] = useState<Set<string>>(new Set())

  const load = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s) { setStatus('signedOut'); setCompanies([]); setPermissions(new Set()); return }
    const { data, error } = await supabase.rpc('my_companies')
    if (error) { setStatus('signedOut'); return }
    const list = (data ?? []) as CompanyAccess[]
    setCompanies(list)
    if (list.length === 0) { setStatus('noCompany'); return }
    const current = list.find((c) => c.company_id === companyId) ?? list[0]
    setCompanyId(current.company_id)
    if (current.mfa_required) { setStatus('needsMfa'); return }
    const perms = await supabase.rpc('my_permissions', { p_company: current.company_id })
    setPermissions(new Set(((perms.data ?? []) as { permission_code: string }[]).map((p) => p.permission_code)))
    setStatus('ready')
  }, [companyId])

  useEffect(() => {
    if (!backendConfigured) { setStatus('signedOut'); return }
    void supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED') void load(s)
      else setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  // Sign out after IDLE_MINUTES without any interaction (spec section 8.9).
  useEffect(() => {
    if (!session) return
    let timer = window.setTimeout(() => void supabase.auth.signOut(), IDLE_MINUTES * 60_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void supabase.auth.signOut(), IDLE_MINUTES * 60_000)
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)) }
  }, [session])

  const value = useMemo<AuthState>(() => ({
    status,
    session,
    companies,
    company: companies.find((c) => c.company_id === companyId) ?? null,
    permissions,
    can: (perm) => permissions.has(perm),
    selectCompany: (id) => {
      try { localStorage.setItem(COMPANY_KEY, id) } catch { /* ignore */ }
      setCompanyId(id)
    },
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session) },
    signOut: async () => { await supabase.auth.signOut() },
  }), [status, session, companies, companyId, permissions, load])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
