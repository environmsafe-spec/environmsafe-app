// Sign-in calls to the API (/api/auth, Better Auth). The session is an HttpOnly cookie set by the API.

export interface SessionUser { id: string; email: string; name: string; twoFactorEnabled?: boolean | null }
export interface Session { user: SessionUser; session: { expiresAt: string } }

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { message?: string }).message ?? res.statusText)
  return data as T
}

export const authClient = {
  getSession: async (): Promise<Session | null> => {
    const res = await fetch('/api/auth/get-session', { credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as Session | null
  },
  /** Returns 'code' when the account has two-step sign-in and the 6-digit code is needed next. */
  signIn: async (email: string, password: string): Promise<'signedIn' | 'code'> => {
    const r = await post<{ twoFactorRedirect?: boolean }>('sign-in/email', { email, password })
    return r.twoFactorRedirect ? 'code' : 'signedIn'
  },
  verifyCode: (code: string) => post('two-factor/verify-totp', { code }),
  verifyBackupCode: (code: string) => post('two-factor/verify-backup-code', { code }),
  /** Start two-step sign-in: returns the authenticator link (for the QR code) and one-time backup codes. */
  enableTwoFactor: (password: string) => post<{ totpURI: string; backupCodes: string[] }>('two-factor/enable', { password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post('change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
  signOut: () => post('sign-out'),
}
