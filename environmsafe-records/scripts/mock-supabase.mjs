// A small stand-in for the parts of the Supabase API the app uses (Auth,
// PostgREST, RPC, Storage, the admin-users function), backed by a real
// PostgreSQL database with the real migrations and Row Level Security.
// For local end-to-end testing only — never deployed.
//
//   DB_URL=postgres://postgres@127.0.0.1:54329/es_e2e PORT=54321 node scripts/mock-supabase.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.PORT || 54321);
const SECRET = 'mock-jwt-secret-for-local-tests-only';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = path.join(root, 'test-results/mock-storage');
fs.mkdirSync(store, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DB_URL || 'postgres://postgres@127.0.0.1:54329/es_e2e', max: 8 });
let offline = false; // toggled by tests through /__mock/offline

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!s) return null;
  const ok = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') === s;
  if (!ok) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (c.exp && c.exp < Date.now() / 1000) return null;
  return c;
}
const hash = (pw) => crypto.createHash('sha256').update(`es:${pw}`).digest('hex');

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? headers['Content-Type'] || 'application/octet-stream' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Range',
    ...headers,
  });
  res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${claims ? 'authenticated' : 'anon'}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: 'anon' })]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function userJson(id) {
  const r = await pool.query(`select id, email, created_at from auth.users where id = $1`, [id]);
  const u = r.rows[0];
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, created_at: u.created_at, app_metadata: {}, user_metadata: {}, factors: [] };
}

async function issue(userId) {
  const p = await pool.query(`select role from public.profiles where id = $1`, [userId]);
  const now = Math.floor(Date.now() / 1000);
  // Admins get a two-step (aal2) session straight away in this stand-in.
  const aal = p.rows[0]?.role === 'admin' ? 'aal2' : 'aal1';
  const claims = { sub: userId, role: 'authenticated', aud: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }], iat: now, exp: now + 3600, session_id: crypto.randomUUID() };
  const refresh = sign({ sub: userId, typ: 'refresh', iat: now, exp: now + 86400 * 30 });
  return { access_token: sign(claims), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: await userJson(userId) };
}

// --- PostgREST subset -------------------------------------------------------
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
function where(params, values) {
  const parts = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error('bad column');
    const m = v.match(/^(eq|neq|gt|gte|lt|lte|is|in)\.(.*)$/s);
    if (!m) throw new Error('bad filter');
    if (m[1] === 'is') parts.push(`"${k}" is ${m[2] === 'null' ? 'null' : m[2] === 'true' ? 'true' : 'false'}`);
    else if (m[1] === 'in') {
      const items = m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      values.push(items);
      parts.push(`"${k}"::text = any($${values.length})`);
    } else {
      values.push(m[2]);
      parts.push(`"${k}" ${OPS[m[1]]} $${values.length}`);
    }
  }
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}

async function rest(req, res, url, claims) {
  const table = url.pathname.replace('/rest/v1/', '');
  if (table.startsWith('rpc/')) {
    const fn = table.slice(4);
    if (!/^[a-z_]+$/.test(fn)) return send(res, 400, { message: 'bad function' });
    const args = JSON.parse((await readBody(req)).toString() || '{}');
    const keys = Object.keys(args);
    const sql = `select to_jsonb(public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})) as r`;
    const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    try {
      const r = await asUser(claims, (c) => c.query(sql, vals));
      const out = r.rows[0]?.r ?? null;
      if (fn === 'sync_apply' && Array.isArray(out)) for (const o of out) if (!o.ok) console.log('[sync refused]', o.error, JSON.stringify(args.ops.find((x) => x.op_id === o.op_id)).slice(0, 400));
      return send(res, 200, out);
    } catch (e) {
      console.log('[rpc error]', fn, e.message);
      return send(res, 400, { message: e.message, code: e.code });
    }
  }
  if (!/^[a-z_]+$/.test(table)) return send(res, 404, { message: 'not found' });
  const values = [];
  try {
    if (req.method === 'GET') {
      let sql = `select to_jsonb(t) as r from public.${table} t${where(url.searchParams, values)}`;
      const order = url.searchParams.get('order');
      if (order) sql += ' order by ' + order.split(',').map((o) => { const [c, d] = o.split('.'); if (!/^[a-z_]+$/.test(c)) throw new Error('bad order'); return `"${c}" ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
      const limit = url.searchParams.get('limit');
      const offset = url.searchParams.get('offset');
      const range = req.headers.range?.match(/(\d+)-(\d+)/);
      if (limit) sql += ` limit ${Number(limit)}`;
      else if (range) sql += ` limit ${Number(range[2]) - Number(range[1]) + 1}`;
      if (offset) sql += ` offset ${Number(offset)}`;
      else if (range) sql += ` offset ${Number(range[1])}`;
      const r = await asUser(claims, (c) => c.query(sql, values));
      const rows = r.rows.map((x) => x.r);
      if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
        if (rows.length !== 1) return send(res, 406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: `The result contains ${rows.length} rows` });
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows);
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse((await readBody(req)).toString());
      const cols = Object.keys(patch);
      if (!cols.every((c) => /^[a-z_]+$/.test(c))) throw new Error('bad column');
      const vals = cols.map((c) => (patch[c] !== null && typeof patch[c] === 'object' ? JSON.stringify(patch[c]) : patch[c]));
      const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
      const w = where(url.searchParams, vals);
      const r = await asUser(claims, (c) => c.query(`update public.${table} t set ${sets}${w} returning to_jsonb(t) as r`, vals));
      return send(res, 200, r.rows.map((x) => x.r));
    }
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      const rows = Array.isArray(body) ? body : [body];
      const out = [];
      await asUser(claims, async (c) => {
        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
          const r = await c.query(`insert into public.${table} (${cols.map((k) => `"${k}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning to_jsonb(${table}) as r`, vals);
          out.push(r.rows[0].r);
        }
      });
      return send(res, 201, out);
    }
    if (req.method === 'DELETE') {
      const r = await asUser(claims, (c) => c.query(`delete from public.${table}${where(url.searchParams, values)}`, values));
      return send(res, 200, { deleted: r.rowCount });
    }
  } catch (e) {
    console.log('[rest error]', req.method, url.pathname + url.search, e.message);
    return send(res, e.code === '42501' ? 403 : 400, { message: e.message, code: e.code });
  }
  return send(res, 405, { message: 'method' });
}

// --- Storage subset -----------------------------------------------------------
function parseMultipart(buf, contentType) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) return { file: buf, type: contentType };
  const parts = buf.toString('latin1').split(`--${boundary}`);
  for (const p of parts) {
    const idx = p.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const head = p.slice(0, idx);
    if (/filename=|name=""/.test(head) || /Content-Type:/i.test(head)) {
      const type = head.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream';
      const body = p.slice(idx + 4, p.length - 2);
      if (!/name="cacheControl"/.test(head)) return { file: Buffer.from(body, 'latin1'), type };
    }
  }
  return { file: buf, type: 'application/octet-stream' };
}

async function storage(req, res, url, claims) {
  const p = url.pathname.replace('/storage/v1/', '');
  try {
    if (req.method === 'POST' && p.startsWith('object/sign/files')) {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const paths = body.paths ?? [decodeURIComponent(p.replace('object/sign/files/', ''))];
      const r = await asUser(claims, (c) => c.query(`select name from storage.objects where bucket_id = 'files' and name = any($1)`, [paths]));
      const visible = new Set(r.rows.map((x) => x.name));
      const out = paths.map((name) => (visible.has(name)
        ? { path: name, signedURL: `/object/sign/files/${encodeURI(name)}?token=${sign({ name, exp: Math.floor(Date.now() / 1000) + (body.expiresIn || 60) })}`, error: null }
        : { path: name, signedURL: null, error: 'Object not found' }));
      if (body.paths) return send(res, 200, out);
      return out[0].signedURL ? send(res, 200, { signedURL: out[0].signedURL }) : send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    }
    if (req.method === 'GET' && p.startsWith('object/sign/files/')) {
      const name = decodeURIComponent(p.replace('object/sign/files/', ''));
      const t = verify(url.searchParams.get('token'));
      if (!t || t.name !== name) return send(res, 400, { message: 'invalid signature' });
      const f = path.join(store, name);
      if (!fs.existsSync(f)) return send(res, 404, { message: 'not found' });
      const meta = await pool.query(`select metadata from storage.objects where name = $1`, [name]);
      return send(res, 200, fs.readFileSync(f), { 'Content-Type': meta.rows[0]?.metadata?.mimetype || 'application/octet-stream' });
    }
    if ((req.method === 'POST' || req.method === 'PUT') && p.startsWith('object/files/')) {
      const name = decodeURIComponent(p.replace('object/files/', ''));
      if (name.includes('..')) return send(res, 400, { message: 'bad path' });
      const raw = await readBody(req);
      const { file, type } = parseMultipart(raw, req.headers['content-type'] || '');
      const upsert = req.headers['x-upsert'] === 'true';
      await asUser(claims, async (c) => {
        const ex = await c.query(`select id from storage.objects where bucket_id='files' and name=$1`, [name]);
        if (ex.rows.length && !upsert) throw Object.assign(new Error('The resource already exists'), { code: '409' });
        if (ex.rows.length) await c.query(`update storage.objects set metadata = $2 where bucket_id='files' and name=$1`, [name, { size: file.length, mimetype: type }]);
        else await c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('files', $1, auth.uid(), $2)`, [name, { size: file.length, mimetype: type }]);
      });
      fs.mkdirSync(path.dirname(path.join(store, name)), { recursive: true });
      fs.writeFileSync(path.join(store, name), file);
      return send(res, 200, { Key: `files/${name}`, Id: crypto.randomUUID() });
    }
  } catch (e) {
    return send(res, e.code === '409' ? 400 : 403, { statusCode: e.code === '409' ? '409' : '403', error: e.code === '409' ? 'Duplicate' : 'Unauthorized', message: e.code === '409' ? 'The resource already exists' : `new row violates row-level security policy (${e.message})` });
  }
  return send(res, 404, { message: 'not found' });
}

// --- admin-users function (mirrors supabase/functions/admin-users) ------------
async function adminUsers(req, res, claims) {
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  const me = await pool.query(`select role, active from public.profiles where id = $1`, [claims?.sub]);
  if (!me.rows[0] || me.rows[0].role !== 'admin' || claims.aal !== 'aal2') return send(res, 403, { error: 'Only an Admin can manage users' });
  try {
    if (body.action === 'create') {
      const email = String(body.email).toLowerCase();
      await pool.query(`insert into public.allowed_signups (email, full_name, role, title, cert_number, client_id) values ($1,$2,$3,$4,$5,$6) on conflict (email) do update set role = excluded.role`, [email, body.full_name ?? '', body.role, body.title ?? '', body.cert_number ?? '', body.client_id || null]);
      const r = await pool.query(`insert into auth.users (email, encrypted_password) values ($1, $2) returning id`, [email, hash(body.password)]);
      return send(res, 200, { id: r.rows[0].id });
    }
    if (body.action === 'set_password') {
      await pool.query(`update auth.users set encrypted_password = $2 where id = $1`, [body.user_id, hash(body.password)]);
      await pool.query(`update public.profiles set must_change_password = true where id = $1`, [body.user_id]);
      return send(res, 200, { ok: true });
    }
    if (body.action === 'update') {
      const patch = {};
      for (const k of ['role', 'full_name', 'title', 'cert_number', 'client_id', 'active']) if (body[k] !== undefined) patch[k] = body[k];
      const cols = Object.keys(patch);
      if (cols.length) await pool.query(`update public.profiles set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [body.user_id, ...cols.map((c) => patch[c])]);
      return send(res, 200, { ok: true });
    }
    if (body.action === 'reset_mfa') return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  return send(res, 400, { error: 'Unknown action' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (process.env.MOCK_TRACE) console.log('[req]', new Date().toISOString().slice(11, 23), req.method, url.pathname);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/__mock/offline') {
    offline = url.searchParams.get('v') === '1';
    return send(res, 200, { offline });
  }
  if (offline) {
    req.socket.destroy();
    return;
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const claims = verify(token);
  const userClaims = claims?.sub && claims.role === 'authenticated' ? claims : null;
  try {
    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (url.searchParams.get('grant_type') === 'password') {
        const r = await pool.query(`select id from auth.users where lower(email) = lower($1) and encrypted_password = $2`, [body.email, hash(body.password)]);
        const prof = r.rows[0] ? await pool.query(`select active from public.profiles where id = $1`, [r.rows[0].id]) : null;
        if (!r.rows[0] || !prof.rows[0]?.active) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, await issue(r.rows[0].id));
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const c = verify(body.refresh_token);
        if (!c || c.typ !== 'refresh') return send(res, 400, { error: 'invalid_grant', msg: 'Invalid Refresh Token' });
        return send(res, 200, await issue(c.sub));
      }
    }
    if (url.pathname === '/auth/v1/user') {
      if (!userClaims) return send(res, 401, { msg: 'invalid JWT' });
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (body.password) await pool.query(`update auth.users set encrypted_password = $2 where id = $1`, [userClaims.sub, hash(body.password)]);
      }
      return send(res, 200, await userJson(userClaims.sub));
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/factors') return send(res, 200, { all: [], totp: [], phone: [] });
    if (url.pathname.startsWith('/rest/v1/')) return rest(req, res, url, userClaims);
    if (url.pathname.startsWith('/storage/v1/')) return storage(req, res, url, userClaims);
    if (url.pathname === '/functions/v1/admin-users') return adminUsers(req, res, userClaims);
    return send(res, 404, { message: `no route ${url.pathname}` });
  } catch (e) {
    return send(res, 500, { message: e.message });
  }
});

server.listen(PORT, () => console.log(`mock supabase on http://localhost:${PORT}`));
