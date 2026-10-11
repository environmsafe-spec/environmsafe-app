// Admin user management: create users, set passwords, change roles, block,
// reset two-step sign-in. Runs on Supabase Edge Functions with the service key,
// which never leaves the server. Only an active Admin who has passed two-step
// sign-in in the current session may call it.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://records.environmsafe.com,https://app.environmsafe.com,https://environmsafe-records.pages.dev,https://localhost,capacitor://localhost,http://localhost:5173,http://localhost:4173')
  .split(',').map((s) => s.trim());

function cors(origin: string | null) {
  const allowed = origin && (ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.environmsafe-records\.pages\.dev$/.test(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const ROLES = ['admin', 'office', 'inspector', 'viewer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function passwordProblem(pw: string, email?: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'The password is too long.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use upper-case and lower-case letters and at least one number.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && pw.toLowerCase().includes(local)) return 'Do not use the e-mail name in the password.';
  return null;
}

function claims(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: caller, error: callerErr } = await service.auth.getUser(jwt);
  if (callerErr || !caller.user) return reply(401, { error: 'Not signed in' });
  const { data: me } = await service.from('profiles').select('role, active, email').eq('id', caller.user.id).maybeSingle();
  if (!me || me.role !== 'admin' || !me.active) return reply(403, { error: 'Only an Admin can manage users' });
  if (claims(jwt).aal !== 'aal2') return reply(403, { error: 'Two-step sign-in is required for this action' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Bad request' });
  }
  const audit = (action: string, details: Record<string, unknown>) =>
    service.from('audit_log').insert({ user_id: caller.user!.id, user_email: me.email, action: `users:${action}`, table_name: 'profiles', details });

  try {
    switch (body.action) {
      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const role = String(body.role ?? 'inspector');
        const password = String(body.password ?? '');
        if (!EMAIL.test(email)) return reply(400, { error: 'Enter a valid e-mail address.' });
        if (!ROLES.includes(role)) return reply(400, { error: 'Unknown role.' });
        const p = passwordProblem(password, email);
        if (p) return reply(400, { error: p });
        await service.from('allowed_signups').upsert({
          email, role, full_name: String(body.full_name ?? '').slice(0, 120), title: String(body.title ?? '').slice(0, 120),
          cert_number: String(body.cert_number ?? '').slice(0, 60), client_id: body.client_id || null,
        });
        const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) {
          await service.from('allowed_signups').delete().eq('email', email);
          return reply(400, { error: error.message });
        }
        await audit('create', { email, role });
        return reply(200, { id: data.user?.id });
      }
      case 'set_password': {
        const id = String(body.user_id ?? '');
        const { data: target } = await service.from('profiles').select('email').eq('id', id).maybeSingle();
        if (!target) return reply(404, { error: 'User not found' });
        const p = passwordProblem(String(body.password ?? ''), target.email);
        if (p) return reply(400, { error: p });
        const { error } = await service.auth.admin.updateUserById(id, { password: String(body.password) });
        if (error) return reply(400, { error: error.message });
        await service.from('profiles').update({ must_change_password: true, revoked_before: new Date().toISOString() }).eq('id', id);
        await audit('set_password', { user: id });
        return reply(200, { ok: true });
      }
      case 'update': {
        const id = String(body.user_id ?? '');
        const patch: Record<string, unknown> = {};
        if (body.role !== undefined) {
          if (!ROLES.includes(String(body.role))) return reply(400, { error: 'Unknown role.' });
          if (id === caller.user.id && body.role !== 'admin') return reply(400, { error: 'You cannot remove your own Admin role.' });
          patch.role = body.role;
        }
        for (const k of ['full_name', 'title', 'cert_number', 'phone']) if (body[k] !== undefined) patch[k] = String(body[k]).slice(0, 120);
        if (body.client_id !== undefined) patch.client_id = body.client_id || null;
        if (body.active !== undefined) {
          if (id === caller.user.id && !body.active) return reply(400, { error: 'You cannot block yourself.' });
          patch.active = !!body.active;
          if (!body.active) patch.revoked_before = new Date().toISOString();
          await service.auth.admin.updateUserById(id, { ban_duration: body.active ? 'none' : '876000h' });
        }
        const { error } = await service.from('profiles').update(patch).eq('id', id);
        if (error) return reply(400, { error: error.message });
        await audit('update', { user: id, ...patch });
        return reply(200, { ok: true });
      }
      case 'reset_mfa': {
        const id = String(body.user_id ?? '');
        const { data } = await service.auth.admin.mfa.listFactors({ userId: id });
        for (const f of data?.factors ?? []) await service.auth.admin.mfa.deleteFactor({ userId: id, id: f.id });
        await service.from('profiles').update({ revoked_before: new Date().toISOString() }).eq('id', id);
        await audit('reset_mfa', { user: id });
        return reply(200, { ok: true });
      }
      default:
        return reply(400, { error: 'Unknown action' });
    }
  } catch (e) {
    return reply(500, { error: (e as Error).message });
  }
});
