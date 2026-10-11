import { useEffect, useState } from 'react';
import { Badge, Button, Card, Modal, PageHeader, Row, SelectInput, TextInput, useToast } from '../components/ui';
import { PASSWORD_RULES, passwordProblem, useAuth } from '../lib/auth';
import { db } from '../lib/db';
import { useClients } from '../lib/domain';
import { supabase } from '../lib/supabase';
import type { Profile, Role } from '../lib/types';

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', office: 'Office', inspector: 'Inspector', viewer: 'Viewer (read only)' };

export function randomPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789'];
  const all = sets.join('');
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = [...bytes].map((b, i) => (i < 3 ? sets[i][b % sets[i].length] : all[b % all.length]));
  return chars.sort(() => (crypto.getRandomValues(new Uint8Array(1))[0] > 127 ? 1 : -1)).join('');
}

async function call(body: Record<string, unknown>): Promise<string | null> {
  if (!navigator.onLine) return 'Managing users needs internet.';
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try {
      const j = ctx ? await ctx.json() : null;
      return j?.error ?? error.message;
    } catch {
      return error.message;
    }
  }
  return (data as { error?: string })?.error ?? null;
}

function UserForm({ user, onDone }: { user: Partial<Profile> | null; onDone: () => void }) {
  const toast = useToast();
  const clients = useClients();
  const [v, setV] = useState<Partial<Profile> & { password?: string }>(user?.id ? user : { role: 'inspector', password: randomPassword() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!user) return null;
  const isNew = !user.id;
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setErr(null);
      if (isNew) {
        const p = passwordProblem(v.password ?? '', v.email);
        if (p) return setErr(p);
      }
      setBusy(true);
      const msg = isNew
        ? await call({ action: 'create', email: v.email, password: v.password, full_name: v.full_name, role: v.role, title: v.title, cert_number: v.cert_number, client_id: v.client_id })
        : await call({ action: 'update', user_id: user.id, full_name: v.full_name, role: v.role, title: v.title, cert_number: v.cert_number, client_id: v.client_id ?? null });
      setBusy(false);
      if (msg) return setErr(msg);
      toast(isNew ? `User created. Give them the password: ${v.password}` : 'User updated');
      onDone();
    }}>
      <TextInput label="Full name" required value={v.full_name ?? ''} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
      <TextInput label="E-mail (used to sign in)" type="email" required disabled={!isNew} value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <SelectInput label="Role" value={v.role ?? 'inspector'} onChange={(e) => setV({ ...v, role: e.target.value as Role })} options={Object.entries(ROLE_LABEL).map(([k, l]) => ({ value: k, label: l }))} />
      {v.role === 'viewer' && (
        <SelectInput label="Limit to one client (optional)" value={v.client_id ?? ''} placeholder="All clients" onChange={(e) => setV({ ...v, client_id: e.target.value || null })} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
      )}
      <TextInput label="Job title" value={v.title ?? ''} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <TextInput label="Inspector certificate number" value={v.cert_number ?? ''} onChange={(e) => setV({ ...v, cert_number: e.target.value })} hint="Printed with the signature on reports and certificates." />
      {isNew && (
        <TextInput label="First password" value={v.password ?? ''} onChange={(e) => setV({ ...v, password: e.target.value })} hint={`${PASSWORD_RULES} They must change it at first sign-in.`} />
      )}
      {err && <p className="font-semibold text-red-700" role="alert">{err}</p>}
      <Button type="submit" busy={busy}>{isNew ? 'Create user' : 'Save'}</Button>
    </form>
  );
}

export default function Users() {
  const toast = useToast();
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [edit, setEdit] = useState<Partial<Profile> | null>(null);
  const [pw, setPw] = useState<{ user: Profile; password: string } | null>(null);
  const load = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name');
    if (error) toast(error.message, 'error');
    else {
      setUsers(data as Profile[]);
      await db.profiles.bulkPut(data);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Users and roles" actions={<>
        <Button icon="plus" onClick={() => setEdit({})}>Add user</Button>
        <Button tone="secondary" icon="logout" onClick={async () => {
          if (!confirm('Sign every other user out of all devices now? They will need to sign in again.')) return;
          const { error } = await supabase.rpc('admin_sign_out', { p_user: null });
          toast(error ? error.message : 'Everyone else has been signed out', error ? 'error' : 'ok');
        }}>Sign out all devices</Button>
      </>} />
      <Card>
        {users.map((u) => (
          <div key={u.id} className="border-b border-line py-2 last:border-0">
            <Row title={<span className="flex flex-wrap items-center gap-2">{u.full_name || u.email}<Badge tone={u.role === 'admin' ? 'navy' : 'gray'}>{ROLE_LABEL[u.role]}</Badge>{!u.active && <Badge tone="red">Blocked</Badge>}{u.must_change_password && <Badge tone="amber">Temporary password</Badge>}</span>}
              sub={`${u.email}${u.title ? ` · ${u.title}` : ''}`} onClick={() => setEdit(u)} />
            <div className="flex flex-wrap gap-2 ps-1">
              <Button size="sm" tone="secondary" onClick={() => setPw({ user: u, password: randomPassword() })}>Set password</Button>
              {u.id !== me?.id && (
                <Button size="sm" tone="secondary" onClick={async () => {
                  const m = await call({ action: 'update', user_id: u.id, active: !u.active });
                  toast(m ?? (u.active ? 'User blocked' : 'User unblocked'), m ? 'error' : 'ok');
                  void load();
                }}>{u.active ? 'Block' : 'Unblock'}</Button>
              )}
              <Button size="sm" tone="ghost" onClick={async () => {
                if (!confirm(`Reset two-step sign-in for ${u.email}? They will set it up again next time.`)) return;
                const m = await call({ action: 'reset_mfa', user_id: u.id });
                toast(m ?? 'Two-step sign-in reset', m ? 'error' : 'ok');
              }}>Reset two-step</Button>
              {u.id !== me?.id && (
                <Button size="sm" tone="ghost" onClick={async () => {
                  const { error } = await supabase.rpc('admin_sign_out', { p_user: u.id });
                  toast(error ? error.message : 'Signed out of all devices', error ? 'error' : 'ok');
                }}>Sign out</Button>
              )}
            </div>
          </div>
        ))}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit user' : 'Add user'}>
        <UserForm user={edit} onDone={() => { setEdit(null); void load(); }} />
      </Modal>
      <Modal open={!!pw} onClose={() => setPw(null)} title={`New password for ${pw?.user.full_name || pw?.user.email}`}>
        {pw && (
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault();
            const m = await call({ action: 'set_password', user_id: pw.user.id, password: pw.password });
            if (m) return toast(m, 'error');
            toast(`Password set. Tell the user: ${pw.password}`);
            setPw(null);
            void load();
          }}>
            <TextInput label="Temporary password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} hint={`${PASSWORD_RULES} The user must change it at next sign-in.`} />
            <Button type="submit">Set password</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
