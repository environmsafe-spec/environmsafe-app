// Database connections for one request. Production: Neon's serverless driver straight to Neon over a
// WebSocket (DATABASE_URL secret; no Hyperdrive needed). Local development: node-postgres through
// wrangler's local Hyperdrive to a local Postgres. Both expose the pg Client / Pool interface.
import { Client as NeonClient, Pool as NeonPool } from '@neondatabase/serverless'
import pg from 'pg'

export function connect(env: { DATABASE_URL?: string; HYPERDRIVE?: Hyperdrive }): { pool: pg.Pool; client: pg.Client } {
  if (env.DATABASE_URL) {
    const pool = new NeonPool({ connectionString: env.DATABASE_URL, max: 2 })
    const client = new NeonClient({ connectionString: env.DATABASE_URL })
    // A socket closing after the response is normal here; without a listener it would be thrown.
    pool.on('error', () => {})
    client.on('error', () => {})
    return { pool: pool as unknown as pg.Pool, client: client as unknown as pg.Client }
  }
  if (!env.HYPERDRIVE) throw new Error('No database configured')
  return {
    pool: new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 2 }),
    client: new pg.Client({ connectionString: env.HYPERDRIVE.connectionString }),
  }
}
