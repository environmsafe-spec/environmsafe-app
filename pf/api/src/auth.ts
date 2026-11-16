// Sign-in (Better Auth): email + password, then a TOTP code from an authenticator app.
import { betterAuth } from 'better-auth'
import type pg from 'pg'
import { authOptions } from './auth-options.ts'
import type { Claims } from './rest.ts'

export type Env = {
  HYPERDRIVE: Hyperdrive
  ASSETS: Fetcher
  AUTH_SECRET: string
  APP_URL: string
}

export function createAuth(env: Env, pool: pg.Pool) {
  return betterAuth(authOptions({ secret: env.AUTH_SECRET, baseURL: env.APP_URL, database: pool, trustedOrigins: [env.APP_URL] }))
}
export type Auth = ReturnType<typeof createAuth>

/** The claims the database expects, from the signed-in session. aal2 = the user has two-step sign-in on
 *  (with it on, Better Auth only issues a session after the TOTP code). */
export async function claimsFor(auth: Auth, headers: Headers): Promise<Claims> {
  const s = await auth.api.getSession({ headers })
  if (!s) return { role: 'anon' }
  const u = s.user as typeof s.user & { twoFactorEnabled?: boolean | null }
  return { role: 'authenticated', sub: u.id, email: u.email, aal: u.twoFactorEnabled ? 'aal2' : 'aal1' }
}

/** Owner-side user management (there is no public sign-up). */
export async function createUser(auth: Auth, email: string, name: string, password: string) {
  const ctx = await auth.$context
  const normalized = email.trim().toLowerCase()
  if (await ctx.internalAdapter.findUserByEmail(normalized)) throw Object.assign(new Error('A user with this email already exists'), { status: 409 })
  if (password.length < 10) throw Object.assign(new Error('The password needs at least 10 characters'), { status: 400 })
  const hash = await ctx.password.hash(password)
  const user = await ctx.internalAdapter.createUser({ email: normalized, name: name.trim() || normalized, emailVerified: true }, { method: 'email-password' } as never)
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash })
  return user
}

export async function setPassword(auth: Auth, pool: pg.Pool, userId: string, password: string) {
  const ctx = await auth.$context
  if (password.length < 10) throw Object.assign(new Error('The password needs at least 10 characters'), { status: 400 })
  await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password))
  await pool.query('delete from public.auth_session where "userId" = $1', [userId])   // sign out everywhere
}

/** Turn two-step sign-in off for a user who lost their phone (they set it up again at next sign-in). */
export async function resetTwoFactor(pool: pg.Pool, userId: string) {
  await pool.query('delete from public.auth_two_factor where "userId" = $1', [userId])
  await pool.query('update public.auth_user set "twoFactorEnabled" = false where id = $1', [userId])
  await pool.query('delete from public.auth_session where "userId" = $1', [userId])
}
