import { useState } from 'react';
import { Badge, Empty, LinkButton, PageHeader, Row, statusTone } from '../components/ui';
import { useAuth } from '../lib/auth';
import { db } from '../lib/db';
import { DOC_STATUS, fmtDate, inspTypeName, live, notDeleted, useClients, useLibrary } from '../lib/domain';
import type { Asset, Inspection } from '../lib/types';

export default function Inspections() {
  const { can } = useAuth();
  const clients = useClients();
  const { inspectionTypes } = useLibrary();
  const [status, setStatus] = useState('');
  const [client, setClient] = useState('');
  const d = live(async () => ({
    insp: ((await db.inspections.toArray()) as Inspection[]).filter(notDeleted).sort((a, b) => b.inspection_date.localeCompare(a.inspection_date)),
    assets: (await db.assets.toArray()) as Asset[],
  }), []);
  if (!d) return null;
  const list = d.insp.filter((i) => (!status || i.status === status) && (!client || i.client_id === client));
  const tag = (id: string) => d.assets.find((a) => a.id === id)?.tag ?? '?';
  return (
    <div>
      <PageHeader title="Inspections" sub={`${list.length} shown`} actions={can.field && <LinkButton to="/inspections/new" icon="plus" tone="accent">New inspection</LinkButton>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(DOC_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input" aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="surface rounded-2xl border border-line px-3">
        {list.length === 0 && <Empty title="No inspections" icon="clipboard" />}
        {list.slice(0, 400).map((i) => (
          <Row key={i.id} to={`/inspections/${i.id}`} title={`${tag(i.asset_id)} – ${inspTypeName(inspectionTypes, i.type_code)}`}
            sub={[fmtDate(i.inspection_date), i.report_no, i.inspector_name || i.contractor].filter(Boolean).join(' · ')}
            right={<span className="flex gap-1">{i.is_historical && <Badge>Historical</Badge>}<Badge tone={statusTone(i.status)}>{DOC_STATUS[i.status]}</Badge></span>} />
        ))}
      </div>
    </div>
  );
}
