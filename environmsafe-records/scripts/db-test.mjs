// Database tests: migrations apply from empty, and Row Level Security lets each
// role do what it should and nothing more. Runs against a throw-away PostgreSQL
// database with a small Supabase stand-in (tests/db/supabase_shim.sql).
//
//   DB_TEST_URL=postgres://postgres@127.0.0.1:54329/postgres node scripts/db-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const baseUrl = process.env.DB_TEST_URL || 'postgres://postgres@127.0.0.1:54329/postgres';
const dbName = 'es_rls_test';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  -> ${detail}` : ''}`);
}

const admin = new pg.Client({ connectionString: baseUrl });
await admin.connect();
await admin.query(`drop database if exists ${dbName}`);
await admin.query(`create database ${dbName}`);
await admin.end();

const url = new URL(baseUrl);
url.pathname = '/' + dbName;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
await db.query(`set client_min_messages = warning`);

// 1. Migrations from empty, then a second time (they must be re-runnable).
const shim = fs.readFileSync(path.join(root, 'tests/db/supabase_shim.sql'), 'utf8');
await db.query(shim);
const migDir = path.join(root, 'supabase/migrations');
const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
for (const pass of [1, 2]) {
  let ok = true;
  let detail = '';
  for (const f of migrations) {
    try {
      await db.query(fs.readFileSync(path.join(migDir, f), 'utf8'));
    } catch (e) {
      ok = false;
      detail = `${f}: ${e.message}`;
      break;
    }
  }
  record(`migrations apply cleanly (pass ${pass})`, ok, detail);
  if (!ok) process.exit(1);
}

// 2. Users.
const users = {
  admin: { email: 'admin@test.local', role: 'admin' },
  office: { email: 'office@test.local', role: 'office' },
  insp: { email: 'insp@test.local', role: 'inspector' },
  insp2: { email: 'insp2@test.local', role: 'inspector' },
  viewer: { email: 'viewer@test.local', role: 'viewer' },
  viewerDemo: { email: 'viewer.demo@test.local', role: 'viewer' },
};
for (const [key, u] of Object.entries(users)) {
  await db.query(`insert into public.allowed_signups (email, full_name, role) values ($1, $2, $3)`, [u.email, key, u.role]);
  const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [u.email]);
  u.id = r.rows[0].id;
}
const prof = await db.query(`select count(*)::int n from public.profiles`);
record('approved sign-ups create profiles with the approved role', prof.rows[0].n === 6);

try {
  await db.query(`insert into auth.users (email) values ('stranger@evil.test')`);
  record('public sign-up is refused', false, 'insert succeeded');
} catch (e) {
  record('public sign-up is refused', /Sign-up is closed/.test(e.message), e.message);
}

await db.query(`select public.load_demo_data()`);
const DEMO = '00000000-0000-4000-8000-00000000d001';
const V201 = '00000000-0000-4000-8000-00000000d020';
const F1 = '00000000-0000-4000-8000-00000000d060';
const OTHER = '11111111-1111-4111-8111-111111111111';
const OTHER_ASSET = '11111111-1111-4111-8111-111111111112';
await db.query(`insert into public.clients (id, name, code) values ($1, 'Other Client', 'OTH')`, [OTHER]);
await db.query(`insert into public.assets (id, client_id, tag) values ($1, $2, 'OTH-PSV-1')`, [OTHER_ASSET, OTHER]);
await db.query(`update public.profiles set client_id = $1 where id = $2`, [DEMO, users.viewerDemo.id]);
await db.query(`insert into storage.objects (bucket_id, name) values ('files', $1), ('files', $2)`, [
  `${DEMO}/photo1.jpg`, `${OTHER}/secret.pdf`,
]);

// Run a statement as a given user inside a rolled-back transaction.
async function as(who, sql, params = [], { aal = 'aal2', iat } = {}) {
  await db.query('begin');
  try {
    if (who === 'anon') {
      await db.query(`set local role anon`);
      await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      const sub = who === 'nobody' ? '99999999-9999-4999-8999-999999999999' : users[who].id;
      const claims = { sub, role: 'authenticated', aal, iat: iat ?? Math.floor(Date.now() / 1000) };
      await db.query(`set local role authenticated`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    }
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await db.query('rollback');
  }
}
// Same, but keeps the change (for multi-step scenarios).
async function asCommit(who, sql, params = [], opts = {}) {
  const sub = users[who].id;
  const claims = { sub, role: 'authenticated', aal: opts.aal || 'aal2', iat: Math.floor(Date.now() / 1000) };
  await db.query('begin');
  try {
    await db.query(`set local role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const r = await db.query(sql, params);
    await db.query('commit');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await db.query('rollback');
    return { ok: false, error: e.message };
  }
}
const sync = (who, ops, opts) =>
  asCommit(who, `select public.sync_apply($1::jsonb) r`, [JSON.stringify(ops)], opts).then((r) => {
    if (!r.ok) return { ok: false, error: r.error };
    const out = r.rows[0].r;
    return { ok: out.every((o) => o.ok), out, error: out.find((o) => !o.ok)?.error };
  });
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// --- Anonymous and unknown users -------------------------------------------
let r = await as('anon', `select * from public.clients`);
record('anonymous visitor cannot read clients', !r.ok, r.error);
r = await as('anon', `select * from storage.objects`);
record('anonymous visitor cannot list files', !r.ok || r.rows.length === 0, r.error);
r = await as('nobody', `select * from public.clients`);
record('signed-in user without a profile sees no clients', r.ok && r.rows.length === 0);
r = await as('nobody', `select public.sync_apply('[]'::jsonb)`);
record('signed-in user without a profile cannot sync', !r.ok);

// --- Viewer ------------------------------------------------------------------
r = await as('viewer', `select id from public.clients`);
record('viewer reads all clients', r.ok && r.rows.length === 2);
r = await as('viewerDemo', `select id from public.clients`);
record('client-restricted viewer sees only their client', r.ok && r.rows.length === 1 && r.rows[0].id === DEMO);
r = await as('viewerDemo', `select id from public.assets where client_id = $1`, [OTHER]);
record("client-restricted viewer cannot read another client's assets", r.ok && r.rows.length === 0);
r = await as('viewerDemo', `select name from storage.objects`);
record("client-restricted viewer cannot read another client's files",
  r.ok && r.rows.length === 1 && r.rows[0].name.startsWith(DEMO));
r = await as('viewer', `insert into public.clients (name, code) values ('X', 'X1')`);
record('viewer cannot create clients', !r.ok);
r = await as('viewer', `update public.assets set description = 'hacked' where id = $1`, [V201]);
record('viewer cannot edit assets', r.ok && r.count === 0);
r = await as('viewer', `select public.sync_apply($1::jsonb)`, [JSON.stringify([{ op_id: '1', table: 'inspections', id: uuid(), fields: { client_id: DEMO, asset_id: V201, type_code: 'EXT' } }])]);
record('viewer cannot sync changes', !r.ok);
r = await as('viewer', `insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${DEMO}/x.jpg`]);
record('viewer cannot upload files', !r.ok);
r = await as('viewer', `select * from public.audit_log`);
record('viewer cannot read the audit log', r.ok && r.rows.length === 0);

// --- Inspector -----------------------------------------------------------------
r = await as('insp', `insert into public.clients (name, code) values ('X', 'X2')`);
record('inspector cannot create clients', !r.ok);
r = await as('insp', `select count(*)::int n from public.assets`);
record('inspector reads all assets', r.ok && r.rows[0].n >= 8);

const inspId = uuid();
r = await sync('insp', [{ op_id: 'a', table: 'inspections', id: inspId, fields: { client_id: DEMO, asset_id: V201, type_code: 'EXT', summary: 'first' }, ts: { summary: now() } }]);
record('inspector creates a draft inspection (offline sync)', r.ok, r.error);
r = await sync('insp', [{ op_id: 'b', table: 'inspections', id: inspId, fields: { summary: 'edited' }, ts: { summary: now() } }]);
record('inspector edits own draft', r.ok && r.out[0].row.summary === 'edited', r.error);
r = await sync('insp2', [{ op_id: 'c', table: 'inspections', id: inspId, fields: { summary: 'not mine' }, ts: { summary: now() } }]);
record("inspector cannot edit another inspector's draft", !r.ok, r.error);
r = await sync('insp', [{ op_id: 'd', table: 'inspections', id: uuid(), fields: { client_id: DEMO, asset_id: V201, type_code: 'EXT', status: 'issued' } }]);
record('inspector cannot create an issued inspection', !r.ok);
r = await sync('insp', [{ op_id: 'e', table: 'inspections', id: inspId, fields: { status: 'issued' }, ts: { status: now() } }]);
record('inspector cannot issue', !r.ok);
r = await sync('insp', [{ op_id: 'f', table: 'inspections', id: inspId, fields: { deleted_at: now() }, ts: { deleted_at: now() } }]);
record('inspector cannot delete', !r.ok);
r = await sync('insp', [{ op_id: 'g', table: 'inspections', id: inspId, fields: { status: 'submitted' }, ts: { status: now() } }]);
record('inspector submits own inspection', r.ok, r.error);
r = await sync('insp', [{ op_id: 'h', table: 'inspections', id: inspId, fields: { summary: 'after submit' }, ts: { summary: now() } }]);
record('inspector cannot edit after submitting', !r.ok);

// Previous finding carried over and updated by an inspector.
r = await sync('insp', [{ op_id: 'i', table: 'finding_updates', id: uuid(), fields: { finding_id: F1, client_id: DEMO, inspection_id: inspId, status: 'open_deteriorated', note: 'Pitting deeper' } }]);
const fs1 = await db.query(`select status from public.findings where id = $1`, [F1]);
record('inspector updates a previous finding; finding status follows', r.ok && fs1.rows[0].status === 'open_deteriorated', r.error);
const nf = uuid();
r = await sync('insp', [{ op_id: 'j', table: 'findings', id: nf, fields: { client_id: DEMO, asset_id: V201, inspection_id: inspId, title: 'New finding', priority: 'P1' } }]);
record('new finding gets the next number per asset (F-004)', r.ok && r.out[0].row.ref === 'F-004', r.error || JSON.stringify(r.out?.[0]?.row?.ref));
r = await as('insp', `insert into storage.objects (bucket_id, name) values ('files', $1)`, [`${DEMO}/new.jpg`]);
record('inspector uploads a photo to a client folder', r.ok, r.error);
r = await as('insp', `delete from storage.objects where name like $1`, [`${DEMO}/%`]);
record('inspector cannot delete files', r.ok && r.count === 0);
r = await as('insp', `update public.profiles set role = 'admin' where id = $1`, [users.insp.id]);
record('inspector cannot make themself admin', !r.ok);
r = await as('insp', `update public.profiles set full_name = 'Inspector One' where id = $1`, [users.insp.id]);
record('inspector can edit own name', r.ok && r.count === 1, r.error);
r = await as('insp', `update public.profiles set full_name = 'x' where id = $1`, [users.office.id]);
record("inspector cannot edit someone else's profile", r.ok && r.count === 0);
r = await as('insp', `insert into public.equipment_types (code, name) values ('HACK', 'Hack')`);
record('inspector cannot edit the library', !r.ok);

// --- Office ------------------------------------------------------------------
r = await as('office', `insert into public.clients (name, code) values ('New Client', 'NEW') returning id`);
record('office creates clients', r.ok, r.error);
r = await as('office', `insert into public.equipment_types (code, name) values ('X', 'X')`);
record('office cannot edit the library', !r.ok);
r = await as('office', `select * from public.audit_log`);
record('office cannot read the audit log', r.ok && r.rows.length === 0);
r = await as('office', `update public.profiles set role = 'admin' where id = $1`, [users.office.id]);
record('office cannot make themself admin', !r.ok);
r = await as('office', `delete from public.assets where id = $1`, [OTHER_ASSET]);
record('office cannot purge records', r.ok && r.count === 0);
r = await sync('office', [{ op_id: 'k', table: 'inspections', id: inspId, fields: { status: 'issued' }, ts: { status: now() } }]);
const issued = r.ok ? r.out[0].row : null;
record('office issues an inspection; report number allocated',
  r.ok && issued.status === 'issued' && /^ES\/DEMO-EXT-\d{4}-\d{3}$/.test(issued.report_no), r.error || issued?.report_no);
r = await sync('office', [{ op_id: 'l', table: 'inspections', id: inspId, fields: { summary: 'changed after issue' }, ts: { summary: now() } }]);
record('issued inspection is locked (office)', !r.ok);
r = await sync('admin', [{ op_id: 'm', table: 'inspections', id: inspId, fields: { summary: 'changed after issue' }, ts: { summary: now() } }]);
record('issued inspection is locked (admin)', !r.ok);
r = await sync('office', [{ op_id: 'n', table: 'inspections', id: inspId, fields: { status: 'revised' }, ts: { status: now() } }]);
record('issued inspection can be marked revised (new revision)', r.ok, r.error);

// --- Admin and two-factor ----------------------------------------------------
r = await as('admin', `insert into public.equipment_types (code, name) values ('NEWTYPE', 'New type')`);
record('admin with two-factor edits the library', r.ok, r.error);
r = await as('admin', `insert into public.equipment_types (code, name) values ('NEWTYPE2', 'New type')`, [], { aal: 'aal1' });
record('admin without two-factor cannot edit the library', !r.ok);
r = await as('admin', `select count(*)::int n from public.audit_log`);
record('admin reads the audit log', r.ok && r.rows[0].n > 0);
r = await as('admin', `delete from public.audit_log`);
record('nobody can delete the audit log (admin)', !r.ok);
r = await as('admin', `update public.audit_log set action = 'x'`);
record('nobody can edit the audit log (admin)', !r.ok);
r = await as('admin', `insert into public.audit_log (action) values ('fake')`);
record('nobody can write fake audit entries', !r.ok);
r = await as('admin', `delete from public.assets where id = $1`, [OTHER_ASSET]);
record('admin can purge records', r.ok && r.count === 1, r.error);

// --- Numbering ---------------------------------------------------------------
r = await as('office', `select public.allocate_number('certificate_psv', $1) a, public.allocate_number('certificate_psv', $1) b`, [DEMO]);
record('certificate numbers follow ES-R-12-NNN and never repeat',
  r.ok && /^ES-R-12-\d{3}$/.test(r.rows[0].a) && r.rows[0].a !== r.rows[0].b, r.error || JSON.stringify(r.rows));
await db.query(`insert into public.issued_numbers (number, doc_type) values ('ES-R-12-900', 'manual')`);
await db.query(`insert into public.number_counters (key, last_value) values ('ES-R-12-#', 899) on conflict (key) do update set last_value = 899`);
r = await as('office', `select public.allocate_number('certificate_psv', $1) a`, [DEMO]);
record('a number already used by hand is skipped', r.ok && r.rows[0].a === 'ES-R-12-901', r.error || r.rows?.[0]?.a);
r = await as('viewer', `select public.allocate_number('certificate_psv', $1) a`, [DEMO]);
record('viewer cannot take document numbers', !r.ok);

// --- Offline conflict: last edit wins per field, conflicts are listed ----------
const conflictId = uuid();
await sync('insp', [{ op_id: 'o', table: 'inspections', id: conflictId, fields: { client_id: DEMO, asset_id: V201, type_code: 'UT', summary: 'base', witness: 'w0' } }]);
const base = new Date(Date.now() - 120000).toISOString();
await new Promise((res) => setTimeout(res, 20));
const t1 = new Date().toISOString(); // inspector's offline edit time
await new Promise((res) => setTimeout(res, 20));
const t2 = new Date().toISOString(); // office edit, made later while online
await sync('office', [{ op_id: 'p', table: 'inspections', id: conflictId, fields: { summary: 'office edit (newer)' }, ts: { summary: t2 }, base }]);
r = await sync('insp', [{ op_id: 'q', table: 'inspections', id: conflictId, fields: { summary: 'inspector edit (older, offline)', witness: 'w1' }, ts: { summary: t1, witness: t1 }, base }]);
const row = r.out?.[0]?.row;
const conf = await db.query(`select field, kept from public.sync_conflicts where row_id = $1`, [conflictId]);
record('offline conflict: newer edit kept per field, other field still merged',
  r.ok && row.summary === 'office edit (newer)' && row.witness === 'w1', JSON.stringify(row));
record('offline conflict is listed for the Admin, nothing lost',
  conf.rows.some((c) => c.field === 'summary' && c.kept === 'server'));

// --- Injection attempts ------------------------------------------------------
r = await sync('admin', [{ op_id: 'r', table: 'clients; drop table public.clients; --', id: uuid(), fields: {} }]);
record('sync rejects table-name injection', !r.ok);
r = await sync('admin', [{ op_id: 's', table: 'clients', id: DEMO, fields: { 'name" = \'x\'; --': 'x' } }]);
record('sync rejects column-name injection', !r.ok);
const still = await db.query(`select count(*)::int n from public.clients`);
record('tables intact after injection attempts', still.rows[0].n >= 2);
r = await sync('admin', [{ op_id: 't', table: 'clients', id: DEMO, fields: { notes: '<script>alert(1)</script>' }, ts: { notes: now() } }]);
record('script text is stored as plain text (escaped when shown)', r.ok && r.out[0].row.notes === '<script>alert(1)</script>');

// --- Sign out all devices ----------------------------------------------------
const oldIat = Math.floor(Date.now() / 1000) - 60;
r = await asCommit('admin', `select public.admin_sign_out($1)`, [users.insp2.id]);
record('admin signs a user out of all devices', r.ok, r.error);
r = await as('insp2', `select count(*)::int n from public.clients`, [], { iat: oldIat });
record('old session stops working immediately', r.ok && r.rows[0].n === 0);
r = await as('insp', `select public.admin_sign_out(null)`);
record('non-admin cannot sign others out', !r.ok);

// --- Demo removal ----------------------------------------------------------------
r = await as('office', `select public.remove_demo_data()`);
record('office cannot remove demo data', !r.ok);
r = await asCommit('admin', `select public.remove_demo_data() r`);
const left = await db.query(`select count(*)::int n from public.clients where is_demo`);
record('admin removes demo data in one step', r.ok && left.rows[0].n === 0, r.error);

await db.end();
const failed = results.filter((x) => !x.ok);
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(root, 'test-results/db-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} database tests passed`);
process.exit(failed.length ? 1 : 0);
