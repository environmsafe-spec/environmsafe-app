// CI only: creates the four test users in a local Supabase stack and sets up
// two-step sign-in for the Admin. Prints the Admin's TOTP secret for the tests.
import { authenticator } from 'otplib';

const URL_ = process.env.API_URL;
const SERVICE = process.env.SERVICE_ROLE_KEY;
const ANON = process.env.ANON_KEY;
const users = [
  ['admin@e2e.test', 'AdminPass123', 'admin', 'Amal Admin'],
  ['office@e2e.test', 'OfficePass123', 'office', 'Omar Office'],
  ['inspector@e2e.test', 'InspectPass123', 'inspector', 'Ibrahim Inspector'],
  ['viewer@e2e.test', 'ViewerPass123', 'viewer', 'Vera Viewer'],
];
const h = (key, tok) => ({ apikey: key, Authorization: `Bearer ${tok ?? key}`, 'Content-Type': 'application/json' });
async function j(r) { const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t}`); return t ? JSON.parse(t) : null; }

for (const [email, password, role, full_name] of users) {
  await j(await fetch(`${URL_}/rest/v1/allowed_signups`, { method: 'POST', headers: { ...h(SERVICE), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ email, role, full_name, title: role === 'inspector' ? 'Senior Inspector' : '', cert_number: role === 'inspector' ? 'API 510 #12345' : '' }) }));
  await j(await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: h(SERVICE), body: JSON.stringify({ email, password, email_confirm: true }) }));
}
await j(await fetch(`${URL_}/rest/v1/profiles?email=neq.none`, { method: 'PATCH', headers: h(SERVICE), body: JSON.stringify({ must_change_password: false }) }));

const s = await j(await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: h(ANON), body: JSON.stringify({ email: 'admin@e2e.test', password: 'AdminPass123' }) }));
const f = await j(await fetch(`${URL_}/auth/v1/factors`, { method: 'POST', headers: h(ANON, s.access_token), body: JSON.stringify({ factor_type: 'totp', friendly_name: 'ci' }) }));
const c = await j(await fetch(`${URL_}/auth/v1/factors/${f.id}/challenge`, { method: 'POST', headers: h(ANON, s.access_token), body: '{}' }));
await j(await fetch(`${URL_}/auth/v1/factors/${f.id}/verify`, { method: 'POST', headers: h(ANON, s.access_token), body: JSON.stringify({ challenge_id: c.id, code: authenticator.generate(f.totp.secret) }) }));
console.log(`E2E_ADMIN_TOTP_SECRET=${f.totp.secret}`);
