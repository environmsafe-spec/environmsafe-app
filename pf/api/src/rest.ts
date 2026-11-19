// The data API: the subset of the PostgREST protocol the web app uses (it talks to it with postgrest-js).
// Every request runs in one transaction as role `authenticated` (or `anon` without a session) with the
// caller's claims in request.jwt.claims, so the database's own permissions and Row Level Security decide
// what is allowed, exactly as before.
import type pg from 'pg'

export type Claims = { role: 'anon' } | { role: 'authenticated'; sub: string; email: string; aal: 'aal1' | 'aal2' }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new HttpError(400, `bad identifier ${s}`)
  return `"${s}"`
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])

function whereClause(params: URLSearchParams, values: unknown[]) {
  const parts: string[] = []
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue
    const m = /^(not\.)?(eq|neq|in|is|gte|lte|gt|lt|ilike|like)\.(.*)$/s.exec(raw)
    if (!m) throw new HttpError(400, `unsupported filter ${key}=${raw}`)
    const [, not, op, v] = m
    const col = ident(key)
    let part: string
    if (op === 'is') part = `${col} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : v === 'false' ? 'false' : 'null'}`
    else if (op === 'in') {
      const items = v.replace(/^\(|\)$/g, '').split(',').filter((x) => x !== '').map((x) => x.replace(/^"|"$/g, ''))
      values.push(items); part = `${col}::text = any($${values.length}::text[])`
    } else {
      const sqlOp = { eq: '=', neq: '<>', gte: '>=', lte: '<=', gt: '>', lt: '<', ilike: 'ilike', like: 'like' }[op]!
      values.push(op.endsWith('like') ? v.replace(/\*/g, '%') : v)
      part = `${col}${op.endsWith('like') ? '::text' : ''} ${sqlOp} $${values.length}`
    }
    parts.push(not ? `not (${part})` : part)
  }
  return parts.length ? ` where ${parts.join(' and ')}` : ''
}

export async function asUser<T extends pg.QueryResultRow = pg.QueryResultRow>(client: pg.Client, claims: Claims, sql: string, values: unknown[] = []) {
  await client.query('begin')
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await client.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`)
    const r = await client.query<T>(sql, values)
    await client.query('commit')
    return r
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 || body === null ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  })

export async function handleRest(req: Request, path: string, client: pg.Client, claims: Claims): Promise<Response> {
  const url = new URL(req.url)
  const params = url.searchParams
  const values: unknown[] = []
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text()
  const single = (req.headers.get('accept') ?? '').includes('application/vnd.pgrst.object')
  const wantRows = (req.headers.get('prefer') ?? '').includes('return=representation')

  if (path.startsWith('rpc/')) {
    const name = path.slice(4)
    const fn = ident(name)
    const args = body ? JSON.parse(body) as Record<string, unknown> : Object.fromEntries(params)
    const list = Object.entries(args).map(([k, v]) => { values.push(v); return `${ident(k)} := $${values.length}` })
    const meta = await client.query<{ proretset: boolean }>(
      `select p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1 limit 1`, [name])
    if (!meta.rows[0]) throw new HttpError(404, `function ${name} not found`)
    const r = await asUser(client, claims, `select * from public.${fn}(${list.join(', ')})`, values)
    if (meta.rows[0].proretset) return json(200, single ? r.rows[0] ?? null : r.rows)
    // Same shapes as PostgREST: scalar -> the value, composite -> the row.
    const row = r.rows[0] ?? null
    const keys = row ? Object.keys(row) : []
    return json(200, keys.length === 1 && keys[0] === name ? row![keys[0]] : row)
  }

  const table = ident(path)
  const returning = (cols: string | null) => {
    if (!cols) return ' returning *'
    return ` returning ${cols.split(',').map((s) => s.trim()).map((s) => (s === '*' ? '*' : ident(s))).join(', ')}`
  }
  const respond = (rows: unknown[], status: number) =>
    single ? json(status, rows[0] ?? null) : json(status, rows)

  if (req.method === 'GET' || req.method === 'HEAD') {
    const cols = (params.get('select') ?? '*').split(',').map((s) => s.trim()).map((s) => (s === '*' ? '*' : ident(s))).join(', ')
    let sql = `select coalesce(jsonb_agg(to_jsonb(q)), '[]') as j from (select ${cols} from public.${table}${whereClause(params, values)}`
    const orders = params.getAll('order').flatMap((o) => o.split(',')).map((o) => {
      const [col, dir, nulls] = o.split('.')
      return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`
    })
    if (orders.length) sql += ` order by ${orders.join(', ')}`
    if (params.get('limit')) sql += ` limit ${Math.max(0, Number(params.get('limit')) | 0)}`
    if (params.get('offset')) sql += ` offset ${Math.max(0, Number(params.get('offset')) | 0)}`
    sql += ') q'
    const r = await asUser<{ j: unknown[] }>(client, claims, sql, values)
    if (single && r.rows[0].j.length !== 1) return json(406, { message: 'expected exactly one row', code: 'PGRST116' })
    return respond(r.rows[0].j, 200)
  }
  if (req.method === 'POST') {
    const rows = ([] as Record<string, unknown>[]).concat(JSON.parse(body || '[]'))
    if (!rows.length) return json(201, [])
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    const tuples = rows.map((r) => `(${keys.map((k) => { values.push(r[k] ?? null); return `$${values.length}` }).join(', ')})`)
    const r = await asUser(client, claims,
      `insert into public.${table} (${keys.map(ident).join(', ')}) values ${tuples.join(', ')}${wantRows ? returning(params.get('select')) : ''}`, values)
    return wantRows ? respond(r.rows, 201) : json(201, null)
  }
  if (req.method === 'PATCH') {
    const row = JSON.parse(body || '{}') as Record<string, unknown>
    const sets = Object.entries(row).map(([k, v]) => { values.push(v); return `${ident(k)} = $${values.length}` })
    if (!sets.length) throw new HttpError(400, 'nothing to update')
    const r = await asUser(client, claims,
      `update public.${table} set ${sets.join(', ')}${whereClause(params, values)}${wantRows ? returning(params.get('select')) : ''}`, values)
    return wantRows ? respond(r.rows, 200) : json(204, null)
  }
  if (req.method === 'DELETE') {
    const where = whereClause(params, values)
    if (!where) throw new HttpError(400, 'delete needs a filter')
    const r = await asUser(client, claims, `delete from public.${table}${where}${wantRows ? returning(params.get('select')) : ''}`, values)
    return wantRows ? respond(r.rows, 200) : json(204, null)
  }
  throw new HttpError(405, 'method not supported')
}

/** Postgres errors in the shape postgrest-js expects. */
export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; code?: string; message?: string; detail?: string; hint?: string }
  const status = err.status ?? (err.code === '42501' ? 403 : err.code === '23505' ? 409 : 400)
  return json(status, { message: err.message ?? 'error', code: err.code ?? 'PGRST', details: err.detail ?? null, hint: err.hint ?? null })
}
