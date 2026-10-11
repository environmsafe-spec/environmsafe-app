import { useEffect, useState } from 'react';
import { Button, Card, Empty, PageHeader, Row, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { db, type OutboxOp } from '../lib/db';
import { fmtDate, live } from '../lib/domain';
import { formatBytes } from '../lib/files';
import { supabase } from '../lib/supabase';
import { discardOp, retryFailed, subscribeSync, syncNow, syncState } from '../lib/sync';
import type { SyncConflict } from '../lib/types';

const TABLE_LABEL: Record<string, string> = {
  inspections: 'Inspection', findings: 'Finding', finding_updates: 'Finding update', documents: 'Photo / document',
  readings: 'Reading', dprs: 'Daily report', assets: 'Asset', clients: 'Client', sites: 'Site', jobs: 'Job',
  job_items: 'Hold / observation', certificates: 'Certificate', reports: 'Report',
};

function describe(op: OutboxOp): string {
  const f = op.fields as Record<string, unknown>;
  const name = (f.tag ?? f.title ?? f.name ?? f.number ?? f.caption ?? '') as string;
  return `${TABLE_LABEL[op.table] ?? op.table}${name ? `: ${name}` : ''}`;
}

export function ConflictList() {
  const toast = useToast();
  const [items, setItems] = useState<SyncConflict[] | null>(null);
  const load = async () => {
    const { data, error } = await supabase.from('sync_conflicts').select('*').eq('resolved', false).order('created_at', { ascending: false }).limit(200);
    if (error) toast(error.message, 'error');
    setItems((data as SyncConflict[]) ?? []);
  };
  useEffect(() => {
    if (navigator.onLine) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!navigator.onLine) return <p className="text-muted">The conflict list is available when online.</p>;
  if (!items) return <p className="text-muted">Loading…</p>;
  if (!items.length) return <Empty title="No conflicts" icon="check">When two people change the same field while one is offline, it is listed here.</Empty>;
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  return (
    <ul className="flex flex-col gap-3" data-testid="conflict-list">
      {items.map((c) => (
        <li key={c.id} className="rounded-xl border border-line p-3 text-sm">
          <div className="font-bold">{TABLE_LABEL[c.table_name] ?? c.table_name} · field “{c.field}” · {fmtDate(c.created_at)}</div>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div className={`rounded-lg p-2 ${c.kept === 'server' ? 'bg-green-100 dark:bg-green-900/40' : 'bg-black/5 dark:bg-white/5'}`}>
              <div className="text-xs font-bold">Already on server {c.kept === 'server' && '(kept – newer)'}</div>
              <div className="break-words">{show(c.server_value)}</div>
            </div>
            <div className={`rounded-lg p-2 ${c.kept === 'client' ? 'bg-green-100 dark:bg-green-900/40' : 'bg-black/5 dark:bg-white/5'}`}>
              <div className="text-xs font-bold">From the device {c.kept === 'client' && '(kept – newer)'}</div>
              <div className="break-words">{show(c.client_value)}</div>
            </div>
          </div>
          <Button size="sm" tone="secondary" className="mt-2" onClick={async () => {
            const { error } = await supabase.rpc('resolve_conflict', { p_id: c.id });
            if (error) toast(error.message, 'error');
            else void load();
          }}>Mark as checked</Button>
        </li>
      ))}
    </ul>
  );
}

export default function SyncPage() {
  const { can } = useAuth();
  const [, force] = useState(0);
  useEffect(() => subscribeSync(() => force((n) => n + 1)), []);
  const ops = live(() => db.outbox.toArray(), [], []) ?? [];
  const files = live(async () => (await db.blobs.toArray()).filter((b) => b.pending), [], []) ?? [];
  const failed = ops.filter((o) => o.status === 'failed');
  const pending = ops.filter((o) => o.status !== 'failed');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sync" sub={syncState.lastSync ? `Last synced ${new Date(syncState.lastSync).toLocaleString()}` : 'Not synced yet'}
        actions={<Button icon="sync" busy={syncState.syncing} onClick={() => syncNow()}>Sync now</Button>} />
      {syncState.lastError && <div className="rounded-xl bg-amber-200 p-3 font-semibold text-amber-950">Last attempt: {syncState.lastError}</div>}
      <Card title={`Changes refused by the server (${failed.length})`}>
        {failed.length === 0 ? <Empty title="None" icon="check" /> : (
          <>
            <p className="mb-2 text-sm">These changes are kept on this device. Retry them, or discard one to go back to the server copy.</p>
            {failed.map((o) => (
              <div key={o.seq} className="border-b border-line py-2 last:border-0">
                <div className="font-semibold">{describe(o)}</div>
                <div className="text-sm text-red-700 dark:text-red-400">{o.error}</div>
                <Button size="sm" tone="ghost" className="mt-1" onClick={() => confirm('Discard this change for good?') && discardOp(o.seq!)}>Discard</Button>
              </div>
            ))}
            <Button className="mt-2" onClick={retryFailed}>Retry all</Button>
          </>
        )}
      </Card>
      <Card title={`Waiting to sync (${pending.length + files.length})`}>
        {pending.length + files.length === 0 ? <Empty title="Everything is synced" icon="check" /> : (
          <div>
            {files.map((f) => <Row key={f.path} title="File upload" sub={`${formatBytes(f.size)}${f.error ? ` · ${f.error}` : ''}`} />)}
            {pending.map((o) => <Row key={o.seq} title={describe(o)} sub={new Date(o.created_at).toLocaleString()} />)}
          </div>
        )}
      </Card>
      {can.admin && (
        <Card title="Conflicts (Admin)">
          <ConflictList />
        </Card>
      )}
    </div>
  );
}
