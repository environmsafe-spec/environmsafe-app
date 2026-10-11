import { useState } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, LinkButton, Modal, PageHeader, Row, SelectInput, statusTone, Tabs, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { db } from '../lib/db';
import { DOC_STATUS, fmtDate, inspTypeName, live, notDeleted, today, useClients, useLibrary, useSites } from '../lib/domain';
import { create, save } from '../lib/sync';
import type { Asset, Certificate, Dpr, Inspection, Job, JobItem } from '../lib/types';

const JOB_STATUS: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed', closed: 'Closed' };

function JobList() {
  const { can } = useAuth();
  const clients = useClients();
  const jobs = live(async () => ((await db.jobs.toArray()) as Job[]).filter(notDeleted).sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '')), [], []) ?? [];
  return (
    <div>
      <PageHeader title="Jobs" actions={can.office && <LinkButton to="/jobs/new" icon="plus">New job</LinkButton>} />
      <div className="surface rounded-2xl border border-line px-3">
        {jobs.length === 0 && <Empty title="No jobs yet" icon="layers" />}
        {jobs.map((j) => (
          <Row key={j.id} to={`/jobs/${j.id}`} title={`${j.number} – ${j.title}`} sub={`${clients.find((c) => c.id === j.client_id)?.name ?? ''} · ${fmtDate(j.start_date)}`} right={<Badge tone={j.status === 'in_progress' ? 'accent' : 'gray'}>{JOB_STATUS[j.status]}</Badge>} />
        ))}
      </div>
    </div>
  );
}

function JobForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const clients = useClients();
  const existing = live(async () => (id ? ((await db.jobs.get(id)) as Job | undefined) : undefined), [id]);
  const [form, setForm] = useState<Partial<Job> | null>(null);
  const v: Partial<Job> = form ?? existing ?? { client_id: params.get('client') ?? '', number: '', title: '', scope: '', start_date: today(), end_date: null, team: '', status: 'in_progress', notes: '', site_id: null };
  const set = (p: Partial<Job>) => setForm({ ...v, ...p });
  const sites = useSites(v.client_id);
  if (id && !existing) return null;
  return (
    <div className="max-w-2xl">
      <PageHeader title={id ? 'Edit job' : 'New job'} back />
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const patch = { client_id: v.client_id, site_id: v.site_id ?? null, number: v.number?.trim(), title: v.title, scope: v.scope, start_date: v.start_date || null, end_date: v.end_date || null, team: v.team, status: v.status, notes: v.notes };
        if (id) await save('jobs', id, patch);
        const nid = id ?? (await create('jobs', patch));
        nav(`/jobs/${nid}`, { replace: true });
      }}>
        <SelectInput label="Client" required value={v.client_id ?? ''} placeholder="Choose client" options={clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set({ client_id: e.target.value })} disabled={!!id} />
        <SelectInput label="Site" value={v.site_id ?? ''} placeholder="—" options={sites.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => set({ site_id: e.target.value || null })} />
        <TextInput label="Contract / PO number" required value={v.number ?? ''} onChange={(e) => set({ number: e.target.value })} placeholder="e.g. PC0251" />
        <TextInput label="Title" value={v.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
        <TextArea label="Scope" value={v.scope ?? ''} onChange={(e) => set({ scope: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Start" type="date" value={v.start_date ?? ''} onChange={(e) => set({ start_date: e.target.value })} />
          <TextInput label="End" type="date" value={v.end_date ?? ''} onChange={(e) => set({ end_date: e.target.value })} />
        </div>
        <TextInput label="Team" value={v.team ?? ''} onChange={(e) => set({ team: e.target.value })} />
        <SelectInput label="Status" value={v.status ?? 'in_progress'} options={Object.entries(JOB_STATUS).map(([k, l]) => ({ value: k, label: l }))} onChange={(e) => set({ status: e.target.value as Job['status'] })} />
        <TextArea label="Notes" value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        <Button type="submit" size="lg">Save job</Button>
      </form>
    </div>
  );
}

function ItemForm({ job, item, onDone }: { job: Job; item: Partial<JobItem>; onDone: () => void }) {
  const { profile } = useAuth();
  const [v, setV] = useState<Partial<JobItem>>(item);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const patch = { kind: v.kind, ref_no: v.ref_no ?? '', title: v.title, description: v.description ?? '', raised_date: v.raised_date ?? today(), status: v.status ?? 'open', closed_date: v.status === 'closed' ? v.closed_date ?? today() : null };
      if (item.id) await save('job_items', item.id, patch);
      else await create('job_items', { ...patch, job_id: job.id, client_id: job.client_id, raised_by_name: profile?.full_name ?? '' });
      onDone();
    }}>
      <SelectInput label="Type" value={v.kind ?? 'hold'} onChange={(e) => setV({ ...v, kind: e.target.value as JobItem['kind'] })} options={[{ value: 'hold', label: 'Hold point' }, { value: 'observation', label: 'Observation' }]} />
      <TextInput label="Reference" value={v.ref_no ?? ''} onChange={(e) => setV({ ...v, ref_no: e.target.value })} placeholder="H-01 / O-01" />
      <TextInput label="Title" required value={v.title ?? ''} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <TextArea label="Description" value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <TextInput label="Raised" type="date" value={v.raised_date ?? today()} onChange={(e) => setV({ ...v, raised_date: e.target.value })} />
      <SelectInput label="Status" value={v.status ?? 'open'} onChange={(e) => setV({ ...v, status: e.target.value as JobItem['status'] })} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
      <Button type="submit">Save</Button>
    </form>
  );
}

function JobDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { inspectionTypes } = useLibrary();
  const [tab, setTab] = useState('dprs');
  const [item, setItem] = useState<Partial<JobItem> | null>(null);
  const d = live(async () => {
    const job = (await db.jobs.get(id!)) as Job | undefined;
    if (!job) return null;
    const [dprs, items, insp, certs, assets] = await Promise.all([
      db.dprs.where('job_id').equals(job.id).toArray() as Promise<Dpr[]>,
      db.job_items.where('job_id').equals(job.id).toArray() as Promise<JobItem[]>,
      db.inspections.where('job_id').equals(job.id).toArray() as Promise<Inspection[]>,
      db.certificates.where('job_id').equals(job.id).toArray() as Promise<Certificate[]>,
      db.assets.where('client_id').equals(job.client_id).toArray() as Promise<Asset[]>,
    ]);
    return { job, dprs: dprs.filter(notDeleted).sort((a, b) => b.report_date.localeCompare(a.report_date)), items: items.filter(notDeleted), insp: insp.filter(notDeleted), certs: certs.filter(notDeleted), assets };
  }, [id]);
  if (d === undefined) return null;
  if (!d) return <Empty title="Job not found" />;
  const { job, dprs, items, insp, certs, assets } = d;
  const tag = (aid: string) => assets.find((a) => a.id === aid)?.tag ?? '';
  const psvWithoutCert = insp.filter((i) => i.type_code === 'PSV' && i.status !== 'draft' && i.status !== 'revised' && !certs.some((c) => c.inspection_id === i.id && c.status !== 'revised'));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/jobs" title={`${job.number} – ${job.title}`} sub={`${fmtDate(job.start_date)} → ${fmtDate(job.end_date)} · ${JOB_STATUS[job.status]}`}
        actions={<>
          {can.field && <LinkButton tone="accent" icon="fileText" to={`/dprs/new?job=${job.id}`}>New daily report</LinkButton>}
          {can.field && <LinkButton tone="secondary" icon="clipboard" to={`/inspections/new?job=${job.id}`}>New inspection</LinkButton>}
          <LinkButton tone="secondary" icon="fileText" to={`/reports/new?template=final&job=${job.id}`}>Final report</LinkButton>
          {can.office && <LinkButton tone="ghost" icon="edit" to={`/jobs/${job.id}/edit`}>Edit</LinkButton>}
        </>} />
      {job.scope && <Card><p className="whitespace-pre-wrap">{job.scope}</p></Card>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'dprs', label: 'Daily reports', count: dprs.length },
        { key: 'holds', label: 'Holds & observations', count: items.length },
        { key: 'insp', label: 'Inspections', count: insp.length },
        { key: 'certs', label: 'Certificates', count: certs.length },
      ]} />
      {tab === 'dprs' && (
        <Card>
          {dprs.length === 0 ? <Empty title="No daily reports yet" icon="fileText" /> : dprs.map((r) => (
            <Row key={r.id} to={`/dprs/${r.id}`} title={`${r.number ?? 'Number on sync'} – ${fmtDate(r.report_date)}`} sub={`Progress ${r.progress_actual ?? '—'}% (planned ${r.progress_planned ?? '—'}%)`} right={<Badge tone={statusTone(r.status)}>{DOC_STATUS[r.status]}</Badge>} />
          ))}
        </Card>
      )}
      {tab === 'holds' && (
        <Card actions={can.field && <Button size="sm" icon="plus" onClick={() => setItem({ kind: 'hold', status: 'open' })}>Add</Button>}>
          {items.length === 0 ? <Empty title="No holds or observations" /> : items.sort((a, b) => a.raised_date.localeCompare(b.raised_date)).map((it) => (
            <Row key={it.id} title={`${it.ref_no} ${it.title}`} sub={`${it.kind === 'hold' ? 'Hold' : 'Observation'} · raised ${fmtDate(it.raised_date)}${it.closed_date ? ` · closed ${fmtDate(it.closed_date)}` : ''}`}
              right={<Badge tone={it.status === 'open' ? 'amber' : 'green'}>{it.status === 'open' ? 'Open' : 'Closed'}</Badge>} onClick={can.field ? () => setItem(it) : undefined} />
          ))}
        </Card>
      )}
      {tab === 'insp' && (
        <Card>
          {insp.length === 0 ? <Empty title="No inspections linked to this job" icon="clipboard" /> : insp.map((i) => (
            <Row key={i.id} to={`/inspections/${i.id}`} title={`${tag(i.asset_id)} – ${inspTypeName(inspectionTypes, i.type_code)}`} sub={fmtDate(i.inspection_date)} right={<Badge tone={statusTone(i.status)}>{DOC_STATUS[i.status]}</Badge>} />
          ))}
        </Card>
      )}
      {tab === 'certs' && (
        <Card actions={can.field && psvWithoutCert.length > 0 && (
          <Button size="sm" icon="plus" onClick={async () => {
            for (const i of psvWithoutCert) {
              await create('certificates', { client_id: job.client_id, asset_id: i.asset_id, inspection_id: i.id, job_id: job.id, kind: 'psv', status: 'draft', data: { from_inspection: true } });
            }
            toast(`${psvWithoutCert.length} PSV certificate draft(s) created`);
          }}>Create {psvWithoutCert.length} PSV certificate(s)</Button>
        )}>
          {certs.length === 0 ? <Empty title="No certificates yet" icon="file">A certificate is created from each tested item (for example one per PSV on a boiler).</Empty> : certs.map((c) => (
            <Row key={c.id} to={`/certificates/${c.id}`} title={`${c.number ?? 'Draft'} – ${tag(c.asset_id)}`} sub={c.kind.toUpperCase()} right={<Badge tone={statusTone(c.status)}>{DOC_STATUS[c.status]}</Badge>} />
          ))}
        </Card>
      )}
      <Modal open={!!item} onClose={() => setItem(null)} title={item?.id ? 'Edit item' : 'New hold / observation'}>
        {item && <ItemForm job={job} item={item} onDone={() => setItem(null)} />}
      </Modal>
    </div>
  );
}

export default function Jobs() {
  return (
    <Routes>
      <Route index element={<JobList />} />
      <Route path="new" element={<JobForm />} />
      <Route path=":id" element={<JobDetail />} />
      <Route path=":id/edit" element={<JobForm />} />
    </Routes>
  );
}
