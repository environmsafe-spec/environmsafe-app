import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, wipeLocal } from './db';
import { clearPin } from './applock';
import { configured, supabase } from './supabase';
import { startSyncLoop, syncNow, unsyncedCount } from './sync';
import type { Profile, Role } from './types';

export type AuthStatus = 'loading' | 'signed_out' | 'mfa_verify' | 'mfa_enroll' | 'change_password' | 'ready';

interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  can: Capabilities;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: (force?: boolean) => Promise<string | null>;
  refresh: () => Promise<void>;
}

export interface Capabilities {
  field: boolean; // create inspections, findings, DPRs, photos
  office: boolean; // edit all drafts, issue, manage clients and assets
  admin: boolean; // users, library, settings, purge, backup
  viewOnly: boolean;
}

export function capabilitiesFor(role: Role | null): Capabilities {
  return {
    field: role === 'admin' || role === 'office' || role === 'inspector',
    office: role === 'admin' || role === 'office',
    admin: role === 'admin',
    viewOnly: role === 'viewer' || role === null,
  };
}

const Ctx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  if (navigator.onLine) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (!error && data) {
      await db.profiles.put(data);
      return data as Profile;
    }
  }
  return ((await db.profiles.get(userId)) as Profile | undefined) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const evaluate = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      // Offline with an expired token: keep working on the device's data with
      // the last signed-in user; syncing resumes once back online.
      const last = localStorage.getItem('es-last-user');
      const cached = last && !navigator.onLine ? ((await db.profiles.get(last)) as Profile | undefined) : undefined;
      if (cached?.active) {
        setProfile(cached);
        setStatus('ready');
        startSyncLoop();
        return;
      }
      setProfile(null);
      setStatus('signed_out');
      return;
    }
    const p = await loadProfile(s.user.id);
    setProfile(p);
    if (!p || !p.active) {
      setStatus('signed_out');
      if (navigator.onLine) await supabase.auth.signOut();
      return;
    }
    if (navigator.onLine) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        setStatus('mfa_verify');
        return;
      }
      if (p.role === 'admin' && aal?.currentLevel !== 'aal2') {
        setStatus('mfa_enroll');
        return;
      }
      if (p.must_change_password) {
        setStatus('change_password');
        return;
      }
    }
    localStorage.setItem('es-last-user', p.id);
    setStatus('ready');
    startSyncLoop();
  }, []);

  useEffect(() => {
    if (!configured) {
      setStatus('signed_out');
      return;
    }
    supabase.auth.getSession().then(({ data }) => evaluate(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' && navigator.onLine) {
        localStorage.removeItem('es-last-user');
        void evaluate(null);
      }
      if (event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED') setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!navigator.onLine) return 'You are offline. Signing in for the first time needs internet.';
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) return error.message === 'Invalid login credentials' ? 'Wrong e-mail or password.' : error.message;
    await supabase.rpc('log_event', { p_action: 'login', p_details: { ua: navigator.userAgent.slice(0, 120) } });
    await evaluate(data.session);
    return null;
  }, [evaluate]);

  const signOut = useCallback(async (force = false) => {
    if (!force) {
      if (navigator.onLine) await syncNow();
      const n = await unsyncedCount();
      if (n > 0) return `${n} change(s) on this phone are not synced yet. Connect to the internet and sync before signing out.`;
    }
    if (navigator.onLine) {
      await supabase.rpc('log_event', { p_action: 'logout', p_details: {} });
    }
    await supabase.auth.signOut({ scope: 'local' });
    await wipeLocal();
    clearPin();
    localStorage.removeItem('es-last-user');
    sessionStorage.clear();
    setStatus('signed_out');
    setSession(null);
    setProfile(null);
    return null;
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await evaluate(data.session);
  }, [evaluate]);

  const role = (profile?.role ?? null) as Role | null;
  const value = useMemo<AuthValue>(
    () => ({ status, session, profile, role, can: capabilitiesFor(role), signIn, signOut, refresh }),
    [status, session, profile, role, signIn, signOut, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const PASSWORD_RULES = 'At least 10 characters, with upper-case and lower-case letters and a number.';

export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use upper-case and lower-case letters and at least one number.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && pw.toLowerCase().includes(local)) return 'Do not use your e-mail name in the password.';
  if (/^(password|environmsafe|qwerty|123456)/i.test(pw)) return 'This password is too easy to guess.';
  return null;
}
