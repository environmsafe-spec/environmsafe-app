// LOCAL DEMO / TEST ONLY. A tiny stand-in for the Supabase REST API (PostgREST) so the web
// app can run against a local Postgres built from our migrations. Every request runs as
// role `authenticated` with the caller's JWT claims, so Row Level Security applies exactly
// as on Supabase. The JWT signature is NOT verified: never expose this beyond localhost.
//
// Supports only what the app uses: GET with eq/in filters, order, limit; POST insert;
// PATCH / DELETE with eq filters; POST /rpc/<function>.
import http from 'node:http'
import pg from 'pg'

const PORT = Number(process.env.API_PORT ?? 8787)
const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'espf_demo',
})

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 })
  return `"${s}"`
}

function claimsFrom(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (payload.role === 'authenticated' && payload.sub) return payload
  } catch { /* anon */ }
  return { role: 'anon' }
}

function whereClause(params, values) {
  const parts = []
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue
    const m = /^(eq|neq|in|is)\.(.*)$/s.exec(raw)
    if (!m) throw Object.assign(new Error(`unsupported filter ${key}=${raw}`), { status: 400 })
    const [, op, v] = m
    if (op === 'eq') { values.push(v); parts.push(`${ident(key)} = $${values.length}`) }
    if (op === 'neq') { values.push(v); parts.push(`${ident(key)} <> $${values.length}`) }
    if (op === 'is') parts.push(`${ident(key)} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : 'false'}`)
    if (op === 'in') {
      const items = v.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))
      values.push(items); parts.push(`${ident(key)}::text = any($${values.length}::text[])`)
    }
  }
  return parts.length ? ` where ${parts.join(' and ')}` : ''
}

async function asUser(claims, sql, values) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await c.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`)
    const r = await c.query(sql, values)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

async function handle(req, res, body) {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname.replace(/^\/rest\/v1\//, '')
  const params = [...url.searchParams.entries()]
  const claims = claimsFrom(req)
  const values = []

  if (path.startsWith('rpc/')) {
    const fn = ident(path.slice(4))
    const args = body ? JSON.parse(body) : {}
    const list = Object.entries(args).map(([k, v], i) => { values.push(v); return `${ident(k)} := $${i + 1}` })
    // Same shapes as PostgREST: set-returning -> array of rows, scalar -> value, composite -> object.
    const r = await asUser(claims, `select * from public.${fn}(${list.join(', ')})`, values)
    const meta = await pool.query(
      `select p.proretset, (select count(*) from unnest(coalesce(p.proargmodes, '{}')) m where m in ('o','t')) as outs
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`,
      [path.slice(4)])
    const { proretset } = meta.rows[0] ?? {}
    if (proretset) return send(res, 200, r.rows)
    const row = r.rows[0] ?? null
    const keys = row ? Object.keys(row) : []
    return send(res, 200, keys.length === 1 && keys[0] === path.slice(4) ? row[keys[0]] : row)
  }

  const table = ident(path)
  if (req.method === 'GET') {
    const cols = (url.searchParams.get('select') ?? '*').split(',').map((s) => s.trim()).map((s) => (s === '*' ? '*' : ident(s))).join(', ')
    let sql = `select coalesce(jsonb_agg(to_jsonb(q)), '[]') as j from (select ${cols} from public.${table}${whereClause(params, values)}`
    for (const o of url.searchParams.getAll('order')) {
      const [col, dir] = o.split('.')
      sql += ` order by ${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`
    }
    if (url.searchParams.get('limit')) sql += ` limit ${Number(url.searchParams.get('limit'))}`
    sql += ') q'
    const r = await asUser(claims, sql, values)
    return send(res, 200, r.rows[0].j)
  }
  if (req.method === 'POST') {
    const rows = [JSON.parse(body)].flat()
    for (const row of rows) {
      const keys = Object.keys(row)
      const vals = keys.map((k) => row[k])
      await asUser(claims, `insert into public.${table} (${keys.map(ident).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, vals)
    }
    return send(res, 201, null)
  }
  if (req.method === 'PATCH') {
    const row = JSON.parse(body)
    const keys = Object.keys(row)
    keys.forEach((k) => values.push(row[k]))
    const sets = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(', ')
    await asUser(claims, `update public.${table} set ${sets}${whereClause(params, values)}`, values)
    return send(res, 204, null)
  }
  if (req.method === 'DELETE') {
    await asUser(claims, `delete from public.${table}${whereClause(params, values)}`, values)
    return send(res, 204, null)
  }
  return send(res, 405, { message: 'method not supported' })
}

function send(res, status, json) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(json === null || status === 204 ? '' : JSON.stringify(json))
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': '*',
    })
    return res.end()
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    handle(req, res, body).catch((e) => {
      const status = e.status ?? (e.code === '42501' ? 403 : 400)
      send(res, status, { message: e.message, code: e.code ?? 'PGRST', details: e.detail ?? null, hint: e.hint ?? null })
    })
  })
}).listen(PORT, '127.0.0.1', () => console.log(`local API on http://127.0.0.1:${PORT}`))
