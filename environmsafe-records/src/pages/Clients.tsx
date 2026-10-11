import { useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, LinkButton, Modal, PageHeader, Row, SelectInput, Tabs, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { db } from '../lib/db';
import { ASSET_STATUS, computeDue, FINDING_STATUS, fmtDate, isOpen, live, notDeleted, useClients } from '../lib/domain';
import { create, save, softDelete } from '../lib/sync';
import type { Asset, Client, Contact, Finding, Job, Site } from '../lib/types';
import { priorityTone } from '../components/ui';

function ClientList() {
  const { can } = useAuth();
  const clients = useClients();
  const counts = live(async () => {
    const assets = ((await db.assets.toArray()) as Asset[]).filter(notDeleted);
    const m: Record<string, number> = {};
    for (const a of assets) m[a.client_id] = (m[a.client_id] ?? 0) + 1;
    return m;
  }, [], {}) ?? {};
  const [q, setQ] = useState('');
  const list = clients.filter((c) => !q || `${c.name} ${c.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Clients" actions={can.office && <LinkButton to="/clients/new" icon="plus">New client</LinkButton>} />
      <input className="input mb-3" placeholder="Filter clients" aria-label="Filter clients" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="surface rounded-2xl border border-line px-3">
        {list.length === 0 && <Empty title="No clients yet" icon="briefcase" />}
        {list.map((c) => (
          <Row key={c.id} to={`/clients/${c.id}`} title={c.name} sub={`${c.code} · ${counts[c.id] ?? 0} assets`} right={c.is_demo ? <Badge tone="accent">Demo</Badge> : c.status === 'inactive' ? <Badge>Inactive</Badge> : undefined} />
        ))}
      </div>
    </div>
  );
}

function ClientForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const existing = live(async () => (id ? ((await db.clients.get(id)) as Client | undefined) : undefined), [id]);
  const all = useClients();
  const [form, setForm] = useState<Partial<Client> | null>(null);
  const v: Partial<Client> = form ?? existing ?? { name: '', code: '', address: '', notes: '', contacts: [], status: 'active' };
  const set = (patch: Partial<Client>) => setForm({ ...v, ...patch });
  const [err, setErr] = useState<string | null>(null);
  if (id && !existing) return null;
  const contacts: Contact[] = v.contacts ?? [];
  return (
    <div className="max-w-2xl">
      <PageHeader title={id ? 'Edit client' : 'New client'} back />
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault();
        const code = (v.code ?? '').trim().toUpperCase();
        if (!/^[A-Z0-9-]{1,16}$/.test(code)) return setErr('Short code: up to 16 letters, numbers or dashes (e.g. YCSR).');
        if (all.some((c) => c.code.toUpperCase() === code && c.id !== id)) return setErr('Another client already uses this short code.');
        const patch = { name: v.name?.trim(), code, address: v.address ?? '', notes: v.notes ?? '', contacts, status: v.status ?? 'active' };
        if (id) await save('clients', id, patch);
        const nid = id ?? (await create('clients', patch));
        toast('Client saved');
        nav(`/clients/${nid}`, { replace: true });
      }}>
        <TextInput label="Client name" required maxLength={200} value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        <TextInput label="Short code" required maxLength={16} value={v.code ?? ''} onChange={(e) => set({ code: e.target.value.toUpperCase() })} hint="Used in document numbers, e.g. ES/YCSR-PSV-2026-01" error={err} />
        <TextArea label="Address" value={v.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
        <SelectInput label="Status" value={v.status ?? 'active'} onChange={(e) => set({ status: e.target.value as Client['status'] })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-bold">Contacts</legend>
          {contacts.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2">
              {(['name', 'role', 'phone', 'email'] as const).map((k) => (
                <TextInput key={k} label={k[0].toUpperCase() + k.slice(1)} value={c[k] ?? ''} onChange={(e) => set({ contacts: contacts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
              ))}
              <Button tone="ghost" size="sm" onClick={() => set({ contacts: contacts.filter((_, j) => j !== i) })}>Remove contact</Button>
            </div>
          ))}
          <Button tone="secondary" icon="plus" onClick={() => set({ contacts: [...contacts, { name: '' }] })}>Add contact</Button>
        </fieldset>
        <TextArea label="Notes" value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        <Button type="submit" size="lg">Save client</Button>
      </form>
    </div>
  );
}

function SiteModal({ clientId, site, onClose }: { clientId: string; site: Partial<Site> | null; onClose: () => void }) {
  const [v, setV] = useState<Partial<Site>>(site ?? {});
  if (!site) return null;
  return (
    <Modal open onClose={onClose} title={site.id ? 'Edit site' : 'New site / plant / area'}>
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const patch = { client_id: clientId, name: v.name?.trim() ?? '', area: v.area ?? '', location: v.location ?? '', notes: v.notes ?? '', lat: v.lat ?? null, lng: v.lng ?? null };
        if (site.id) await save('sites', site.id, patch);
        else await create('sites', patch);
        onClose();
      }}>
        <TextInput label="Site / plant name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <TextInput label="Area / unit" value={v.area ?? ''} onChange={(e) => setV({ ...v, area: e.target.value })} />
        <TextInput label="Location" value={v.location ?? ''} onChange={(e) => setV({ ...v, location: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <TextInput label="Latitude" type="number" step="any" value={v.lat ?? ''} onChange={(e) => setV({ ...v, lat: e.target.value === '' ? null : Number(e.target.value) })} />
          <TextInput label="Longitude" type="number" step="any" value={v.lng ?? ''} onChange={(e) => setV({ ...v, lng: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
        <Button tone="secondary" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setV({ ...v, lat: p.coords.latitude, lng: p.coords.longitude }))}>Use my location</Button>
        <TextArea label="Notes" value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        <Button type="submit">Save site</Button>
      </form>
    </Modal>
  );
}

function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('assets');
  const [siteEdit, setSiteEdit] = useState<Partial<Site> | null>(null);
  const d = live(async () => {
    if (!id) return null;
    const client = (await db.clients.get(id)) as Client | undefined;
    if (!client) return null;
    const [sites, assets, jobs, findings, due] = await Promise.all([
      db.sites.where('client_id').equals(id).toArray() as Promise<Site[]>,
      db.assets.where('client_id').equals(id).toArray() as Promise<Asset[]>,
      db.jobs.where('client_id').equals(id).toArray() as Promise<Job[]>,
      db.findings.where('client_id').equals(id).toArray() as Promise<Finding[]>,
      computeDue(),
    ]);
    return {
      client, sites: sites.filter(notDeleted), assets: assets.filter(notDeleted).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })),
      jobs: jobs.filter(notDeleted), findings: findings.filter(notDeleted).filter(isOpen), due: due.filter((x) => x.client?.id === id),
    };
  }, [id]);
  if (d === undefined) return null;
  if (!d) return <Empty title="Client not found" />;
  const { client, sites, assets, jobs, findings, due } = d;
  const overdue = due.filter((x) => x.bucket === 'overdue').length;
  const tagOf = (aid: string) => assets.find((a) => a.id === aid)?.tag ?? '';
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/clients" title={client.name} sub={<span className="flex flex-wrap items-center gap-2">{client.code}{client.is_demo && <Badge tone="accent">Demo data</Badge>}</span>}
        actions={<>
          {can.office && <LinkButton tone="secondary" icon="edit" to={`/clients/${client.id}/edit`}>Edit</LinkButton>}
          <LinkButton tone="secondary" icon="qr" to={`/labels?client=${client.id}`}>QR labels</LinkButton>
          <LinkButton tone="secondary" icon="fileText" to={`/reports/new?client=${client.id}`}>Reports</LinkButton>
        </>} />
      <div className="grid grid-cols-3 gap-3">
        <div className="surface rounded-2xl border border-line p-3 text-center"><div className="text-2xl font-bold">{assets.length}</div><div className="text-muted text-sm">Assets</div></div>
        <div className="surface rounded-2xl border border-line p-3 text-center"><div className="text-2xl font-bold">{findings.length}</div><div className="text-muted text-sm">Open findings</div></div>
        <div className="surface rounded-2xl border border-line p-3 text-center"><div className={`text-2xl font-bold ${overdue ? 'text-red-700' : ''}`}>{overdue}</div><div className="text-muted text-sm">Overdue</div></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'assets', label: 'Assets', count: assets.length },
        { key: 'sites', label: 'Sites', count: sites.length },
        { key: 'jobs', label: 'Jobs', count: jobs.length },
        { key: 'findings', label: 'Open findings', count: findings.length },
        { key: 'info', label: 'Details' },
      ]} />
      {tab === 'assets' && (
        <Card actions={can.office && <LinkButton to={`/assets/new?client=${client.id}`} icon="plus">New asset</LinkButton>}>
          {assets.length === 0 ? <Empty title="No assets yet" /> : assets.map((a) => (
            <Row key={a.id} to={`/assets/${a.id}`} title={a.tag} sub={`${a.description}${a.parent_id ? ` · on ${tagOf(a.parent_id)}` : ''}`} right={a.status !== 'in_service' ? <Badge>{ASSET_STATUS[a.status]}</Badge> : undefined} />
          ))}
        </Card>
      )}
      {tab === 'sites' && (
        <Card actions={can.office && <Button size="sm" icon="plus" onClick={() => setSiteEdit({})}>New site</Button>}>
          {sites.length === 0 ? <Empty title="No sites yet" /> : sites.map((s) => (
            <Row key={s.id} title={s.name} sub={[s.area, s.location].filter(Boolean).join(' · ')} onClick={can.office ? () => setSiteEdit(s) : undefined} />
          ))}
        </Card>
      )}
      {tab === 'jobs' && (
        <Card actions={can.office && <LinkButton to={`/jobs/new?client=${client.id}`} icon="plus">New job</LinkButton>}>
          {jobs.length === 0 ? <Empty title="No jobs yet" /> : jobs.map((j) => <Row key={j.id} to={`/jobs/${j.id}`} title={`${j.number} – ${j.title}`} sub={`${fmtDate(j.start_date)} → ${fmtDate(j.end_date)}`} />)}
        </Card>
      )}
      {tab === 'findings' && (
        <Card>
          {findings.length === 0 ? <Empty title="No open findings" icon="check" /> : findings.map((f) => (
            <Row key={f.id} to={`/findings/${f.id}`} title={`${tagOf(f.asset_id)} ${f.ref ?? ''} – ${f.title}`} sub={FINDING_STATUS[f.status]} right={<Badge tone={priorityTone(f.priority)}>{f.priority}</Badge>} />
          ))}
        </Card>
      )}
      {tab === 'info' && (
        <Card>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-muted text-sm">Address</dt><dd className="whitespace-pre-wrap">{client.address || '—'}</dd></div>
            <div><dt className="text-muted text-sm">Notes</dt><dd className="whitespace-pre-wrap">{client.notes || '—'}</dd></div>
          </dl>
          <h3 className="mt-4 mb-2 font-bold">Contacts</h3>
          {(client.contacts ?? []).length === 0 ? <p className="text-muted">No contacts</p> : client.contacts.map((c, i) => (
            <div key={i} className="border-b border-line py-2 last:border-0">
              <div className="font-semibold">{c.name} {c.role && <span className="text-muted font-normal">· {c.role}</span>}</div>
              <div className="text-sm">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
          {can.office && (
            <Button tone="danger" className="mt-6" onClick={async () => {
              if (!confirm(`Delete client "${client.name}"? It can be restored by an Admin.`)) return;
              await softDelete('clients', client.id);
              toast('Client deleted');
              nav('/clients');
            }}>Delete client</Button>
          )}
        </Card>
      )}
      <SiteModal clientId={client.id} site={siteEdit} onClose={() => setSiteEdit(null)} />
    </div>
  );
}

export default function Clients() {
  return (
    <Routes>
      <Route index element={<ClientList />} />
      <Route path="new" element={<ClientForm />} />
      <Route path=":id" element={<ClientDetail />} />
      <Route path=":id/edit" element={<ClientForm />} />
    </Routes>
  );
}
