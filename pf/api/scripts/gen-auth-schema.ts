// Prints the SQL that creates Better Auth's tables for our settings (run against an empty database).
// Usage: PGHOST=... PGPORT=... PGDATABASE=... node --experimental-strip-types scripts/gen-auth-schema.ts
import pg from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { authOptions } from '../src/auth-options.ts'

const pool = new pg.Pool()
const { compileMigrations } = await getMigrations(authOptions({ secret: 'x'.repeat(32), baseURL: 'http://localhost', database: pool }))
console.log(await compileMigrations())
await pool.end()
