import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Badge, Card, Empty, Row, Stat, statusTone } from '../components/ui';
import { hasPin } from '../lib/applock';
import { useAuth } from '../lib/auth';
import { db } from '../lib/db';
import { computeDue, DOC_STATUS, fmtDate, isOpen, live, notDeleted, today, useSettings } from '../lib/domain';
import { formatBytes } from '../lib/files';
import { t } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { Asset, Certificate, Client, Dpr, Finding, Inspection, Job, Report } from '../lib/types';

export function StorageMeter({ compact = false }: { compact?: boolean }) {
  const settings = useSettings();
  const [usage, setUsage] = useState<{ files_bytes: number; files_count: number; db_bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!navigator.onLine) return;
    supabase.rpc('storage_usage').then(({ data, error: err }) => {
      if (err) setError(err.message);
      else setUsage(data);
    });
  }, []);
  const limitFiles = (settings?.options?.storage_limit_mb ?? 500) * 1024 * 1024;
  const limitDb = (settings?.options?.db_limit_mb ?? 500) * 1024 * 1024;
  const warn = settings?.options?.storage_warn_pct ?? 70;
  if (error) return <p className="text-muted text-sm">Storage usage unavailable: {error}</p>;
  if (!usage) return <p className="text-muted text-sm">{navigator.onLine ? 'Checking storage…' : 'Storage usage shows when online.'}</p>;
  const bars = [
    { label: 'Files (photos, documents)', used: usage.files_bytes, limit: limitFiles, extra: `${usage.files_count} files` },
    { label: 'Database', used: usage.db_bytes, limit: limitDb, extra: '' },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="storage-meter">
      {bars.map((b) => {
        const pct = Math.min(100, Math.round((b.used / b.limit) * 100));
        const over = pct >= warn;
        return (
          <div key={b.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-semibold">{b.label}</span>
              <span>{formatBytes(b.used)} of {formatBytes(b.limit)} ({pct}%)</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-black/10 dark:bg-white/10" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={b.label}>
              <div className={`h-full ${over ? 'bg-red-700' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
            </div>
            {over && !compact && <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400">Above {warn}% of the free allowance. See the Runbook: "Storage is full".</p>}
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard() {
  const { profile, can } = useAuth();
  const due = live(() => computeDue(), [], []) ?? [];
  const data = live(async () => {
    const [findings, jobs, inspections, reports, certs, dprs, assets, clients] = await Promise.all([
      db.findings.toArray() as Promise<Finding[]>,
      db.jobs.toArray() as Promise<Job[]>,
      db.inspections.toArray() as Promise<Inspection[]>,
      db.reports.toArray() as Promise<Report[]>,
      db.certificates.toArray() as Promise<Certificate[]>,
      db.dprs.toArray() as Promise<Dpr[]>,
      db.assets.toArray() as Promise<Asset[]>,
      db.clients.toArray() as Promise<Client[]>,
    ]);
    return { findings: findings.filter(notDeleted), jobs: jobs.filter(notDeleted), inspections: inspections.filter(notDeleted), reports: reports.filter(notDeleted), certs: certs.filter(notDeleted), dprs: dprs.filter(notDeleted), assets, clients };
  }, []);
  if (!data) return null;
  const overdue = due.filter((d) => d.bucket === 'overdue');
  const d30 = due.filter((d) => d.bucket === 'd30');
  const p1 = data.findings.filter((f) => f.priority === 'P1' && isOpen(f));
  const activeJobs = data.jobs.filter((j) => j.status === 'in_progress');
  const myDrafts = data.inspections.filter((i) => i.status === 'draft' && (i.created_by === profile?.id || !i.created_by));
  const todays = data.dprs.filter((d) => d.report_date === today());
  const tag = (id: string) => data.assets.find((a) => a.id === id)?.tag ?? '';
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? '';
  const recent = [
    ...data.reports.filter((r) => r.status === 'issued').map((r) => ({ id: r.id, title: r.title || r.number || 'Report', sub: r.number ?? '', at: r.issued_at ?? '', href: `/reports/${r.id}` })),
    ...data.certs.filter((c) => c.status === 'issued').map((c) => ({ id: c.id, title: `Certificate ${c.number}`, sub: tag(c.asset_id), at: c.issued_at ?? '', href: `/certificates/${c.id}` })),
    ...data.inspections.filter((i) => i.status === 'issued' && !i.is_historical).map((i) => ({ id: i.id, title: `${tag(i.asset_id)} – ${i.type_code}`, sub: i.report_no ?? '', at: i.issued_at ?? '', href: `/inspections/${i.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  const tiles = [
    { to: '/inspections/new', icon: 'clipboard', label: t('action.new_inspection'), show: can.field },
    { to: '/photo', icon: 'camera', label: t('action.add_photo'), show: can.field },
    { to: '/scan', icon: 'qr', label: t('action.find_tag'), show: true },
    { to: '/dprs/new', icon: 'fileText', label: t('action.new_dpr'), show: can.field },
  ].filter((x) => x.show);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-navy dark:text-white">Hello{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1>
        <p className="text-muted">{fmtDate(today())}</p>
      </div>

      {overdue.length > 0 && (
        <Link to="/due?bucket=overdue" className="flex items-center gap-3 rounded-2xl bg-red-700 p-4 font-bold text-white" data-testid="overdue-banner">
          <Icon name="alert" />
          {overdue.length} inspection{overdue.length === 1 ? ' is' : 's are'} overdue. Open the due board.
        </Link>
      )}
      {!hasPin() && (
        <Link to="/settings?tab=device" className="flex items-center gap-3 rounded-2xl border-2 border-accent bg-accent-50 p-4 font-semibold text-navy">
          <Icon name="lock" /> Set an app PIN so the data on this device is protected and you can unlock offline.
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((x) => (
          <Link key={x.to} to={x.to} className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-navy p-3 text-center font-bold text-white shadow hover:bg-navy-700">
            <Icon name={x.icon} size={32} className="text-accent" />
            {x.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : 'green'} to="/due?bucket=overdue" />
        <Stat label="Due in 30 days" value={d30.length} tone={d30.length ? 'amber' : 'navy'} to="/due?bucket=d30" />
        <Stat label="Open P1 findings" value={p1.length} tone={p1.length ? 'red' : 'green'} to="/findings?priority=P1" />
        <Stat label="Jobs in progress" value={activeJobs.length} to="/jobs" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today's work">
          {myDrafts.length === 0 && todays.length === 0 ? (
            <Empty title="Nothing in progress" icon="check" />
          ) : (
            <div>
              {myDrafts.map((i) => (
                <Row key={i.id} to={`/inspections/${i.id}`} title={`${tag(i.asset_id)} – ${i.type_code}`} sub={`Draft · ${fmtDate(i.inspection_date)}`} right={<Badge tone="gray">Draft</Badge>} />
              ))}
              {todays.map((d) => (
                <Row key={d.id} to={`/dprs/${d.id}`} title={`Daily report ${d.number ?? '(number on sync)'}`} sub={clientName(d.client_id)} right={<Badge tone={statusTone(d.status)}>{DOC_STATUS[d.status]}</Badge>} />
              ))}
            </div>
          )}
        </Card>
        <Card title="Jobs in progress" actions={can.office ? <Link className="font-semibold text-accent-600 dark:text-accent" to="/jobs/new">New job</Link> : undefined}>
          {activeJobs.length === 0 ? <Empty title="No active jobs" icon="layers" /> : activeJobs.map((j) => (
            <Row key={j.id} to={`/jobs/${j.id}`} title={`${j.number} – ${j.title}`} sub={clientName(j.client_id)} />
          ))}
        </Card>
        <Card title="Open P1 findings">
          {p1.length === 0 ? <Empty title="No open P1 findings" icon="check" /> : p1.slice(0, 8).map((f) => (
            <Row key={f.id} to={`/findings/${f.id}`} title={`${tag(f.asset_id)} ${f.ref ?? ''} – ${f.title}`} sub={f.due_date ? `Due ${fmtDate(f.due_date)}` : clientName(f.client_id)} right={<Badge tone="red">P1</Badge>} />
          ))}
        </Card>
        <Card title="Recently issued">
          {recent.length === 0 ? <Empty title="Nothing issued yet" icon="fileText" /> : recent.map((r) => (
            <Row key={r.id} to={r.href} title={r.title} sub={`${r.sub} · ${fmtDate(r.at)}`} />
          ))}
        </Card>
        {can.office && (
          <Card title="Storage">
            <StorageMeter compact />
          </Card>
        )}
      </div>
    </div>
  );
}
