import { useMemo, useState } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { PhotoCapture, PhotoGrid } from '../components/Photos';
import { Badge, Button, Card, Empty, LinkButton, Modal, PageHeader, priorityTone, Row, SelectInput, statusTone, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { db } from '../lib/db';
import { FINDING_STATUS, fmtDate, isOpen, live, notDeleted, SEVERITY, today, useClients, useRefList } from '../lib/domain';
import { save } from '../lib/sync';
import type { Asset, Finding, FindingUpdate, Inspection } from '../lib/types';
import { FindingNoteForm } from './AssetDetail';

function Register() {
  const [params, setParams] = useSearchParams();
  const clients = useClients();
  const d = live(async () => ({
    findings: ((await db.findings.toArray()) as Finding[]).filter(notDeleted),
    assets: (await db.assets.toArray()) as Asset[],
  }), []);
  const get = (k: string, def = '') => params.get(k) ?? def;
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const state = get('state', 'open');
  const list = useMemo(() => {
    if (!d) return [];
    const today0 = today();
    return d.findings
      .filter((f) => (state === 'open' ? isOpen(f) : state === 'closed' ? !isOpen(f) : state === 'overdue' ? isOpen(f) && !!f.due_date && f.due_date < today0 : true))
      .filter((f) => !get('priority') || f.priority === get('priority'))
      .filter((f) => !get('client') || f.client_id === get('client'))
      .filter((f) => !get('asset') || f.asset_id === get('asset'))
      .sort((a, b) => a.priority.localeCompare(b.priority) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, params]);
  if (!d) return null;
  const tag = (id: string) => d.assets.find((a) => a.id === id)?.tag ?? '';
  const cCode = (id: string) => clients.find((c) => c.id === id)?.code ?? '';
  return (
    <div>
      <PageHeader title="Findings register" sub={`${list.length} shown`} actions={<LinkButton tone="secondary" icon="fileText" to={`/reports/new?template=followup${get('client') ? `&client=${get('client')}` : ''}`}>Follow-up report</LinkButton>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <select className="input" aria-label="State" value={state} onChange={(e) => set('state', e.target.value)}>
          <option value="open">Open</option>
          <option value="overdue">Open and overdue</option>
          <option value="closed">Closed / superseded</option>
          <option value="all">All</option>
        </select>
        <select className="input" aria-label="Priority" value={get('priority')} onChange={(e) => set('priority', e.target.value)}>
          <option value="">All priorities</option>
          <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
        </select>
        <select className="input" aria-label="Client" value={get('client')} onChange={(e) => set('client', e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="surface rounded-2xl border border-line px-3">
        {list.length === 0 && <Empty title="No findings match" icon="check" />}
        {list.map((f) => (
          <Row key={f.id} to={`/findings/${f.id}`} title={`${tag(f.asset_id)} ${f.ref ?? 'F-new'} – ${f.title}`}
            sub={[cCode(f.client_id), FINDING_STATUS[f.status], f.due_date && `due ${fmtDate(f.due_date)}`].filter(Boolean).join(' · ')}
            right={<Badge tone={priorityTone(f.priority)}>{f.priority}</Badge>} />
        ))}
      </div>
    </div>
  );
}

function EditFinding({ f, onDone }: { f: Finding; onDone: () => void }) {
  const [v, setV] = useState<Finding>(f);
  const categories = useRefList('finding_category');
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const changed = Object.fromEntries(Object.entries(v).filter(([k, val]) => val !== (f as unknown as Record<string, unknown>)[k] && !k.startsWith('_')));
      await save('findings', f.id, changed);
      onDone();
    }}>
      <TextInput label="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <TextArea label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <TextInput label="Location" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <SelectInput label="Priority" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as Finding['priority'] })} options={['P1', 'P2', 'P3'].map((p) => ({ value: p, label: p }))} />
        <SelectInput label="Severity" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value as Finding['severity'] })} options={Object.entries(SEVERITY).map(([a, b]) => ({ value: a, label: b }))} />
        <SelectInput label="Category" value={v.category} placeholder="—" onChange={(e) => setV({ ...v, category: e.target.value })} options={categories.map((c) => ({ value: c.code, label: c.label }))} />
        <TextInput label="Due date" type="date" value={v.due_date ?? ''} onChange={(e) => setV({ ...v, due_date: e.target.value || null })} />
      </div>
      <TextArea label="Recommendation" value={v.recommendation} onChange={(e) => setV({ ...v, recommendation: e.target.value })} />
      <TextInput label="Owner" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} />
      <Button type="submit">Save</Button>
    </form>
  );
}

function FindingDetail() {
  const { id } = useParams();
  const { can, profile } = useAuth();
  const toast = useToast();
  const [modal, setModal] = useState<'note' | 'edit' | null>(null);
  const d = live(async () => {
    const f = (await db.findings.get(id!)) as Finding | undefined;
    if (!f) return null;
    const [asset, updates, insp] = await Promise.all([
      db.assets.get(f.asset_id) as Promise<Asset>,
      db.finding_updates.where('finding_id').equals(f.id).toArray() as Promise<FindingUpdate[]>,
      f.inspection_id ? (db.inspections.get(f.inspection_id) as Promise<Inspection | undefined>) : Promise.resolve(undefined),
    ]);
    return { f, asset, updates: updates.filter(notDeleted).sort((a, b) => a.update_date.localeCompare(b.update_date)), insp };
  }, [id]);
  if (d === undefined) return null;
  if (!d) return <Empty title="Finding not found" />;
  const { f, asset, updates, insp } = d;
  const canEdit = can.office || (can.field && f.created_by === profile?.id);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back title={`${f.ref ?? 'F-new'} – ${f.title}`} sub={<span className="flex flex-wrap items-center gap-2"><Link className="underline" to={`/assets/${asset.id}?tab=findings`}>{asset.tag}</Link><Badge tone={priorityTone(f.priority)}>{f.priority}</Badge><Badge tone={statusTone(f.status)}>{FINDING_STATUS[f.status]}</Badge></span>}
        actions={<>
          {can.field && <Button icon="edit" tone="secondary" onClick={() => setModal('note')}>Add our note</Button>}
          {canEdit && <Button tone="secondary" onClick={() => setModal('edit')}>Edit</Button>}
        </>} />
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ['Description', f.description], ['Location', f.location], ['Severity', SEVERITY[f.severity]], ['Category', f.category], ['Damage mechanism', f.damage_mechanism],
            ['Code reference', f.code_ref], ['Recommendation', f.recommendation], ['Raised', fmtDate(f.raised_date)], ['Due', fmtDate(f.due_date)], ['Owner', f.owner],
            ['Closed', fmtDate(f.closed_date)], ['Justification', f.justification],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt className="text-muted">{k}</dt><dd className="whitespace-pre-wrap font-semibold">{v}</dd></div>
          ))}
          {insp && <div><dt className="text-muted">Raised by inspection</dt><dd><Link className="font-semibold underline" to={`/inspections/${insp.id}`}>{fmtDate(insp.inspection_date)} {insp.type_code}</Link></dd></div>}
        </dl>
      </Card>
      <Card title="History">
        {updates.length === 0 ? <p className="text-muted text-sm">No later updates.</p> : (
          <ol className="flex flex-col gap-2">
            {updates.map((u) => (
              <li key={u.id} className="rounded-xl border border-line p-2 text-sm">
                <div className="font-semibold">{fmtDate(u.update_date)} · <Badge tone={statusTone(u.status)}>{FINDING_STATUS[u.status]}</Badge> {u.by_name && <span className="text-muted">· {u.by_name}</span>}</div>
                {u.note && <div className="mt-1">{u.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title="Photos" actions={can.field && <PhotoCapture label="Add photo" links={{ client_id: f.client_id, asset_id: f.asset_id, finding_id: f.id }} />}>
        <PhotoGrid where={{ finding_id: f.id }} editable={can.field} />
      </Card>
      <Modal open={modal === 'note'} onClose={() => setModal(null)} title="Note on finding">
        <FindingNoteForm finding={f} onDone={() => { setModal(null); toast('Note added'); }} />
      </Modal>
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit finding" wide>
        <EditFinding f={f} onDone={() => setModal(null)} />
      </Modal>
    </div>
  );
}

export default function Findings() {
  return (
    <Routes>
      <Route index element={<Register />} />
      <Route path=":id" element={<FindingDetail />} />
    </Routes>
  );
}
