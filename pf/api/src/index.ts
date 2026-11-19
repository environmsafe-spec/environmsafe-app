// ES-PF on Cloudflare: one Worker serves the web app (static assets) and its API under /api.
//   /api/auth/*        sign-in, two-step (TOTP) sign-in, sign-out, change password (Better Auth)
//   /api/rest/v1/*     data API (tables and functions; the database's permissions and RLS decide)
//   /api/files/*       files in the private R2 bucket (company folder; permissions checked each time)
//   /api/functions/extract-voucher   AI voucher reader (Claude) -> draft
//   /api/admin/users   owner: create a user, set a new password, reset two-step sign-in
// The database is Neon, reached through Hyperdrive.
import pg from 'pg'
import { claimsFor, createAuth, createUser, resetTwoFactor, setPassword, type Env } from './auth.ts'
import { extractVoucher } from './extract-voucher.ts'
import { handleFiles } from './files.ts'
import { asUser, errorResponse, handleRest, HttpError, type Claims } from './rest.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Requests that change something must come from our own pages (the session cookie is SameSite=Lax too). */
function sameOrigin(req: Request, env: Env) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const origin = req.headers.get('origin')
  return !origin || origin === new URL(env.APP_URL).origin
}

async function admin(req: Request, auth: ReturnType<typeof createAuth>, pool: pg.Pool, client: pg.Client, claims: Claims) {
  if (claims.role !== 'authenticated') throw new HttpError(401, 'Sign in first')
  if (claims.aal !== 'aal2') throw new HttpError(403, 'Turn on two-step sign-in first')
  const body = await req.json() as { action: string; company_id: string; email?: string; name?: string; password?: string; user_id?: string }
  const perms = await asUser<{ permission_code: string }>(client, claims, 'select permission_code from public.my_permissions($1)', [body.company_id])
  if (!perms.rows.some((p) => p.permission_code === 'users.manage')) throw new HttpError(403, 'You cannot manage users in this company')
  const member = async (userId: string) => {
    const r = await pool.query('select 1 from public.user_roles where company_id = $1 and user_id = $2', [body.company_id, userId])
    if (!r.rowCount) throw new HttpError(404, 'This user is not in your company')
  }
  switch (body.action) {
    case 'create': {
      const u = await createUser(auth, body.email ?? '', body.name ?? '', body.password ?? '')
      return json(201, { user_id: u.id, email: u.email })
    }
    case 'set_password':
      await member(body.user_id!)
      await setPassword(auth, pool, body.user_id!, body.password ?? '')
      return json(200, { ok: true })
    case 'reset_two_factor':
      await member(body.user_id!)
      await resetTwoFactor(pool, body.user_id!)
      return json(200, { ok: true })
    default:
      throw new HttpError(400, 'Unknown action')
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
    if (!sameOrigin(req, env)) return json(403, { message: 'Cross-site request refused' })

    const pool = new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 2 })
    const auth = createAuth(env, pool)
    const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString })
    let connected = false
    try {
      if (url.pathname.startsWith('/api/auth/')) return await auth.handler(req)

      const claims = await claimsFor(auth, req.headers)
      await client.connect(); connected = true
      if (url.pathname.startsWith('/api/rest/v1/')) {
        return await handleRest(req, url.pathname.slice('/api/rest/v1/'.length), client, claims)
      }
      if (url.pathname.startsWith('/api/files/')) return await handleFiles(req, env.FILES, client, claims)
      if (url.pathname === '/api/functions/extract-voucher' && req.method === 'POST') return await extractVoucher(req, env, client, claims)
      if (url.pathname === '/api/admin/users' && req.method === 'POST') return await admin(req, auth, pool, client, claims)
      return json(404, { message: 'Not found' })
    } catch (e) {
      return errorResponse(e)
    } finally {
      ctx.waitUntil((async () => { if (connected) await client.end().catch(() => {}); await pool.end().catch(() => {}) })())
    }
  },
} satisfies ExportedHandler<Env>
