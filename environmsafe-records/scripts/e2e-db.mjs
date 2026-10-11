// Creates a fresh database for the local end-to-end tests: shim, migrations,
// and four users (Admin, Office, Inspector, Viewer).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const base = process.env.DB_BASE || 'postgres://postgres@127.0.0.1:54329/postgres';
const name = process.env.DB_NAME || 'es_e2e';
const hash = (pw) => crypto.createHash('sha256').update(`es:${pw}`).digest('hex');

export const USERS = {
  admin: { email: 'admin@e2e.test', password: 'AdminPass123', role: 'admin', full_name: 'Amal Admin' },
  office: { email: 'office@e2e.test', password: 'OfficePass123', role: 'office', full_name: 'Omar Office' },
  inspector: { email: 'inspector@e2e.test', password: 'InspectPass123', role: 'inspector', full_name: 'Ibrahim Inspector' },
  viewer: { email: 'viewer@e2e.test', password: 'ViewerPass123', role: 'viewer', full_name: 'Vera Viewer' },
};

const a = new pg.Client({ connectionString: base });
await a.connect();
await a.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
await a.query(`drop database if exists ${name}`);
await a.query(`create database ${name}`);
await a.end();
const u = new URL(base);
u.pathname = `/${name}`;
const db = new pg.Client({ connectionString: u.toString() });
await db.connect();
await db.query('set client_min_messages = warning');
await db.query(fs.readFileSync(path.join(root, 'tests/db/supabase_shim.sql'), 'utf8'));
for (const f of fs.readdirSync(path.join(root, 'supabase/migrations')).sort()) {
  await db.query(fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'));
}
for (const x of Object.values(USERS)) {
  await db.query(`insert into public.allowed_signups (email, full_name, role, title, cert_number) values ($1, $2, $3, $4, $5)`, [x.email, x.full_name, x.role, x.role === 'inspector' ? 'Senior Inspector' : '', x.role === 'inspector' ? 'API 510 #12345' : '']);
  await db.query(`insert into auth.users (email, encrypted_password) values ($1, $2)`, [x.email, hash(x.password)]);
}
await db.query(`update public.profiles set must_change_password = false`);
await db.end();
console.log(`database ${name} ready`);
