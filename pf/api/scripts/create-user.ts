// Create a sign-in user directly in the database (first owner at go-live, or local testing).
// Usage: NEW_PASSWORD=... PGHOST=... PGDATABASE=... node --experimental-strip-types scripts/create-user.ts <email> "<name>" [--owner <company uuid>]
import pg from 'pg'
import { betterAuth } from 'better-auth'
import { authOptions } from '../src/auth-options.ts'
import { createUser } from '../src/auth.ts'

const [email, name, flag, company] = process.argv.slice(2)
const password = process.env.NEW_PASSWORD
if (!email || !password) { console.error('email and NEW_PASSWORD are required'); process.exit(1) }
const pool = new pg.Pool()
const auth = betterAuth(authOptions({ secret: process.env.AUTH_SECRET ?? 'x'.repeat(32), baseURL: 'http://localhost', database: pool }))
const user = await createUser(auth as never, email, name ?? email, password)
if (flag === '--owner' && company) {
  // As the service role: the first owner of a company has nobody to grant it.
  const c = await pool.connect()
  await c.query('begin')
  await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
  await c.query(`insert into public.user_roles (company_id, user_id, role_code) values ($1, $2, 'owner') on conflict do nothing`, [company, user.id])
  await c.query('commit')
  c.release()
}
console.log(`created ${user.email} (${user.id})${flag === '--owner' ? ' as owner of ' + company : ''}`)
await pool.end()
