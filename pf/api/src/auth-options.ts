// Better Auth settings shared by the Worker and the schema generator (no Worker-only imports here).
import type { BetterAuthOptions } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'

// Sign-in tables live in public with an auth_ prefix; the database revokes every grant on them from the
// API roles (anon / authenticated), so the data API can never read them.
export function authOptions(o: { secret: string; baseURL: string; database: unknown; trustedOrigins?: string[] }): BetterAuthOptions {
  return {
    appName: 'EnvironmSafe PF',
    secret: o.secret,
    baseURL: o.baseURL,
    basePath: '/api/auth',
    database: o.database as BetterAuthOptions['database'],
    trustedOrigins: o.trustedOrigins,
    telemetry: { enabled: false },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
    session: { modelName: 'auth_session', expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },  // 12 h; the app also signs out after 30 min idle
    user: { modelName: 'auth_user' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    advanced: {
      database: { generateId: 'uuid' },                          // ids are uuids, mirrored into auth.users
      cookiePrefix: 'espf',
      useSecureCookies: o.baseURL.startsWith('https://'),
      // Cloudflare puts the visitor's address in CF-Connecting-IP: limits then apply per visitor,
      // not to everyone at once.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    // Sign-in, codes and password changes: 30 a minute per address. The session check runs on every
    // page load and tab, and an office shares one address, so it gets a wider limit.
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/get-session': { window: 60, max: 600 } } },
    plugins: [twoFactor({ issuer: 'EnvironmSafe PF', twoFactorTable: 'auth_two_factor' })],
  }
}
