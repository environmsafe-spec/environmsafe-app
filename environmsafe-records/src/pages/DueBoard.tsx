import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Empty, LinkButton, PageHeader, Row, Tabs } from '../components/ui';
import { type DueBucket } from '../lib/calc';
import { computeDue, fmtDate, inspTypeName, live, useClients, useLibrary } from '../lib/domain';
import { shareOrDownload } from '../lib/native';

const BUCKETS: { key: DueBucket | 'all'; label: string }[] = [
  { key: 'overdue', label: 'Overdue' }, { key: 'd30', label: '≤ 30 days' }, { key: 'd60', label: '31–60 days' }, { key: 'd90', label: '61–90 days' },
  { key: 'later', label: 'Later' }, { key: 'none', label: 'No record' }, { key: 'all', label: 'All' },
];

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function DueBoard() {
  const [params, setParams] = useSearchParams();
  const clients = useClients();
  const { inspectionTypes } = useLibrary();
  const items = live(() => computeDue(), [], []) ?? [];
  const bucket = (params.get('bucket') ?? 'overdue') as DueBucket | 'all';
  const client = params.get('client') ?? '';
  const type = params.get('type') ?? '';
  const view = params.get('view') ?? 'list';
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const setP = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const scoped = items.filter((i) => (!client || i.client?.id === client) && (!type || i.typeCode === type));
  const list = scoped.filter((i) => bucket === 'all' || i.bucket === bucket);
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, b.key === 'all' ? scoped.length : scoped.filter((i) => i.bucket === b.key).length]));
  const types = [...new Set(items.map((i) => i.typeCode))];

  const exportCsv = () => {
    const rows = [['Client', 'Tag', 'Description', 'Inspection', 'Last done', 'Next due', 'Status']];
    for (const i of list) rows.push([i.client?.name ?? '', i.asset.tag, i.asset.description, inspTypeName(inspectionTypes, i.typeCode), i.lastDate ?? '', i.nextDue ?? '', BUCKETS.find((b) => b.key === i.bucket)?.label ?? '']);
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    void shareOrDownload(new Blob(['﻿' + csv], { type: 'text/csv' }), `due-list-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const calendar = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7;
    const cells: { day: number | null; items: typeof scoped }[] = [];
    for (let i = 0; i < offset; i++) cells.push({ day: null, items: [] });
    for (let d = 1; d <= days; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, items: scoped.filter((x) => x.nextDue === iso) });
    }
    return cells;
  }, [month, scoped]);

  return (
    <div>
      <PageHeader title="Due board" sub="Next inspections by client and type" actions={<>
        <Button tone="secondary" icon="download" onClick={exportCsv}>Export list (Excel/CSV)</Button>
        {client && <LinkButton tone="secondary" icon="fileText" to={`/reports/new?template=due_register&client=${client}`}>Client schedule (PDF)</LinkButton>}
      </>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <select className="input" aria-label="Client" value={client} onChange={(e) => setP('client', e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" aria-label="Inspection type" value={type} onChange={(e) => setP('type', e.target.value)}>
          <option value="">All inspection types</option>
          {types.map((t) => <option key={t} value={t}>{inspTypeName(inspectionTypes, t)}</option>)}
        </select>
        <select className="input" aria-label="View" value={view} onChange={(e) => setP('view', e.target.value)}>
          <option value="list">List</option>
          <option value="calendar">Calendar</option>
        </select>
      </div>
      {view === 'list' ? (
        <>
          <Tabs value={bucket} onChange={(k) => setP('bucket', k)} tabs={BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts[b.key] }))} />
          <div className="surface rounded-2xl border border-line px-3" data-testid="due-list">
            {list.length === 0 && <Empty title="Nothing here" icon="check" />}
            {list.map((i) => (
              <Row key={`${i.asset.id}-${i.typeCode}`} to={`/assets/${i.asset.id}`} title={`${i.asset.tag} – ${inspTypeName(inspectionTypes, i.typeCode)}`}
                sub={`${i.client?.code ?? ''} · last ${fmtDate(i.lastDate) || '—'} · due ${fmtDate(i.nextDue) || '—'}`}
                right={i.bucket === 'overdue' ? <Badge tone="red">Overdue</Badge> : i.bucket === 'd30' ? <Badge tone="amber">≤ 30 d</Badge> : undefined} />
            ))}
          </div>
        </>
      ) : (
        <div className="surface rounded-2xl border border-line p-3">
          <div className="mb-3 flex items-center justify-between">
            <Button size="sm" tone="ghost" icon="chevronLeft" onClick={() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); setMonth(d.toISOString().slice(0, 7)); }} aria-label="Previous month" />
            <div className="font-bold">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
            <Button size="sm" tone="ghost" icon="chevronRight" onClick={() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); setMonth(d.toISOString().slice(0, 7)); }} aria-label="Next month" />
          </div>
          <div className="grid grid-cols-7 gap-1 text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-muted py-1 text-center font-bold">{d}</div>)}
            {calendar.map((c, i) => (
              <div key={i} className={`min-h-20 rounded-lg border border-line p-1 ${c.day ? '' : 'opacity-0'}`}>
                <div className="font-bold">{c.day}</div>
                {c.items.slice(0, 3).map((x) => (
                  <Link key={x.asset.id + x.typeCode} to={`/assets/${x.asset.id}`} className={`mt-0.5 block truncate rounded px-1 ${x.bucket === 'overdue' ? 'bg-red-700 text-white' : 'bg-accent text-navy'}`}>{x.asset.tag}</Link>
                ))}
                {c.items.length > 3 && <div className="text-muted">+{c.items.length - 3}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-muted mt-3 text-sm">Reminders are shown in the app (the banner on Home). Export the list each week to share it by e-mail.</p>
    </div>
  );
}
