import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PhotoCapture, PhotoGrid } from '../components/Photos';
import { ThicknessChart } from '../components/ThicknessChart';
import {
  Badge, Button, Card, Empty, LinkButton, Modal, PageHeader, priorityTone, Row, SelectInput, statusTone, Tabs, TextArea, TextInput, useToast,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { analyseThickness, dueBucket, formatPressure } from '../lib/calc';
import { db } from '../lib/db';
import {
  ASSET_STATUS, CARRY_OVER_CHOICES, CONCLUSION, DOC_KINDS, DOC_STATUS, FINDING_STATUS, fmtDate, inspTypeName, isOpen, live, notDeleted,
  today, useLibrary, usePressureUnit,
} from '../lib/domain';
import { addDocument, formatBytes, openFile } from '../lib/files';
import { PUBLIC_URL } from '../lib/native';
import { create } from '../lib/sync';
import type {
  Asset, AssetTagHistory, Certificate, Client, DocKind, DocumentRow, Finding, FindingUpdate, Inspection, Reading, Site,
} from '../lib/types';

export function assetUrl(id: string): string {
  return `${PUBLIC_URL || window.location.origin}/a/${id}`;
}

function QrBlock({ asset }: { asset: Asset }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(assetUrl(asset.id), { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [asset.id]);
  return src ? <img src={src} alt={`QR code for ${asset.tag}`} className="h-32 w-32 rounded-lg bg-white p-1" /> : null;
}

function DocumentUpload({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocKind>('previous_report');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <SelectInput label="Type of document" value={kind} onChange={(e) => setKind(e.target.value as DocKind)} options={Object.entries(DOC_KINDS).filter(([k]) => k !== 'report_output' && k !== 'photo').map(([k, l]) => ({ value: k, label: l }))} />
      <TextInput label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input ref={ref} type="file" className="input" data-testid="document-input" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png" />
      <Button busy={busy} onClick={async () => {
        const f = ref.current?.files?.[0];
        if (!f) return toast('Choose a file', 'error');
        setBusy(true);
        try {
          await addDocument({ file: f, name: f.name, kind, client_id: asset.client_id, asset_id: asset.id, title: title || f.name.replace(/\.[^.]+$/, ''), compress: kind === 'nameplate' });
          toast('Document saved');
          onDone();
        } catch (e) {
          toast((e as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}>Upload</Button>
    </div>
  );
}

interface HistFinding { title: string; priority: 'P1' | 'P2' | 'P3'; status: Finding['status']; note: string }

function HistoricalForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const { can, profile } = useAuth();
  const { inspectionTypes } = useLibrary();
  const toast = useToast();
  const [v, setV] = useState({ date: '', type: 'EXT', by: '', contractor: '', report_no: '', summary: '', conclusion: 'not_assessed', next_due: '' });
  const [items, setItems] = useState<HistFinding[]>([]);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const inspId = await create('inspections', {
        client_id: asset.client_id, asset_id: asset.id, type_code: v.type, inspection_date: v.date, inspector_name: v.by, contractor: v.contractor,
        report_no: v.report_no || null, summary: v.summary, conclusion: v.conclusion, next_due: v.next_due || null, is_historical: true,
        status: can.office ? 'issued' : 'submitted', inspector_id: null,
      });
      for (const it of items.filter((x) => x.title.trim())) {
        const fid = await create('findings', { client_id: asset.client_id, asset_id: asset.id, inspection_id: inspId, title: it.title, priority: it.priority, status: 'open', raised_date: v.date });
        if (it.status !== 'open' || it.note) {
          await create('finding_updates', { finding_id: fid, client_id: asset.client_id, inspection_id: inspId, update_date: v.date, status: it.status, note: it.note, by_name: profile?.full_name ?? '' });
        }
      }
      toast('Historical inspection saved');
      onDone();
    }}>
      <p className="text-sm">Record an earlier inspection (ours or another contractor's) without a full checklist. Upload the old report under Documents.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Date" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        <SelectInput label="Inspection type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} options={inspectionTypes.map((t) => ({ value: t.code, label: t.name }))} />
        <TextInput label="Inspector" value={v.by} onChange={(e) => setV({ ...v, by: e.target.value })} />
        <TextInput label="Contractor (if not EnvironmSafe)" value={v.contractor} onChange={(e) => setV({ ...v, contractor: e.target.value })} />
        <TextInput label="Report number" value={v.report_no} onChange={(e) => setV({ ...v, report_no: e.target.value })} />
        <TextInput label="Next due date" type="date" value={v.next_due} onChange={(e) => setV({ ...v, next_due: e.target.value })} />
        <SelectInput label="Conclusion" value={v.conclusion} onChange={(e) => setV({ ...v, conclusion: e.target.value })} options={Object.entries(CONCLUSION).map(([k, l]) => ({ value: k, label: l }))} />
      </div>
      <TextArea label="Summary" value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">Findings from that inspection</legend>
        {items.map((it, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-line p-2 sm:grid-cols-2">
            <TextInput className="sm:col-span-2" label="Finding" value={it.title} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <SelectInput label="Priority" value={it.priority} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, priority: e.target.value as HistFinding['priority'] } : x)))} options={['P1', 'P2', 'P3'].map((p) => ({ value: p, label: p }))} />
            <SelectInput label="Status now" value={it.status} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, status: e.target.value as Finding['status'] } : x)))} options={Object.entries(FINDING_STATUS).map(([k, l]) => ({ value: k, label: l }))} />
            <TextInput className="sm:col-span-2" label="Our note" value={it.note} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
          </div>
        ))}
        <Button tone="secondary" icon="plus" onClick={() => setItems([...items, { title: '', priority: 'P2', status: 'open', note: '' }])}>Add finding</Button>
      </fieldset>
      <Button type="submit">Save historical inspection</Button>
    </form>
  );
}

export function FindingNoteForm({ finding, onDone }: { finding: Finding; onDone: () => void }) {
  const { profile } = useAuth();
  const [status, setStatus] = useState<Finding['status']>(finding.status);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      await create('finding_updates', { finding_id: finding.id, client_id: finding.client_id, inspection_id: null, update_date: date, status, note, by_name: profile?.full_name ?? '' });
      onDone();
    }}>
      <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value as Finding['status'])} options={[{ value: 'open', label: 'Open' }, ...CARRY_OVER_CHOICES]} />
      <TextInput label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <TextArea label="Our note" required value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit">Add note</Button>
    </form>
  );
}

function ReadingForm({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const [v, setV] = useState({ point: '', location: '', nominal: '', measured: '', retirement: '', date: today() });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      await create('readings', {
        asset_id: asset.id, client_id: asset.client_id, inspection_id: null, kind: 'ut', point: v.point, location: v.location, reading_date: v.date,
        nominal: v.nominal ? Number(v.nominal) : null, measured: v.measured ? Number(v.measured) : null, retirement: v.retirement ? Number(v.retirement) : null,
      });
      onDone();
    }}>
      <TextInput label="Point (CML)" required value={v.point} onChange={(e) => setV({ ...v, point: e.target.value })} />
      <TextInput label="Location" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      <TextInput label="Date" type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
      <TextInput label="Nominal (mm)" inputMode="decimal" value={v.nominal} onChange={(e) => setV({ ...v, nominal: e.target.value })} />
      <TextInput label="Measured (mm)" inputMode="decimal" required value={v.measured} onChange={(e) => setV({ ...v, measured: e.target.value })} />
      <TextInput label="Retirement / t-min (mm)" inputMode="decimal" value={v.retirement} onChange={(e) => setV({ ...v, retirement: e.target.value })} />
      <Button type="submit" className="sm:col-span-2">Save reading</Button>
    </form>
  );
}

export default function AssetDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const unit = usePressureUnit();
  const { equipmentTypes, inspectionTypes } = useLibrary();
  const toast = useToast();
  const tab = params.get('tab') ?? 'overview';
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });
  const [modal, setModal] = useState<null | 'hist' | 'doc' | 'reading' | { finding: Finding }>(null);
  const d = live(async () => {
    if (!id) return null;
    const asset = (await db.assets.get(id)) as Asset | undefined;
    if (!asset) return null;
    const [client, site, parent, children, inspections, findings, updates, readings, docs, certs, tags] = await Promise.all([
      db.clients.get(asset.client_id) as Promise<Client | undefined>,
      asset.site_id ? (db.sites.get(asset.site_id) as Promise<Site | undefined>) : Promise.resolve(undefined),
      asset.parent_id ? (db.assets.get(asset.parent_id) as Promise<Asset | undefined>) : Promise.resolve(undefined),
      db.assets.where('parent_id').equals(asset.id).toArray() as Promise<Asset[]>,
      db.inspections.where('asset_id').equals(asset.id).toArray() as Promise<Inspection[]>,
      db.findings.where('asset_id').equals(asset.id).toArray() as Promise<Finding[]>,
      db.finding_updates.toArray() as Promise<FindingUpdate[]>,
      db.readings.where('asset_id').equals(asset.id).toArray() as Promise<Reading[]>,
      db.documents.where('asset_id').equals(asset.id).toArray() as Promise<DocumentRow[]>,
      db.certificates.where('asset_id').equals(asset.id).toArray() as Promise<Certificate[]>,
      db.asset_tag_history.where('asset_id').equals(asset.id).toArray() as Promise<AssetTagHistory[]>,
    ]);
    const fids = new Set(findings.map((f) => f.id));
    return {
      asset, client, site, parent, children: children.filter(notDeleted),
      inspections: inspections.filter(notDeleted).sort((a, b) => b.inspection_date.localeCompare(a.inspection_date)),
      findings: findings.filter(notDeleted).sort((a, b) => (a.number ?? 999) - (b.number ?? 999)),
      updates: updates.filter((u) => fids.has(u.finding_id) && !u.deleted_at),
      readings: readings.filter(notDeleted), docs: docs.filter(notDeleted), certs: certs.filter(notDeleted), tags,
    };
  }, [id]);
  if (d === undefined) return null;
  if (!d) return <Empty title="Asset not found" />;
  const { asset, client, site, parent, children, inspections, findings, updates, readings, docs, certs, tags } = d;
  const eq = equipmentTypes.find((t) => t.id === asset.equipment_type_id);
  const openF = findings.filter(isOpen);
  const analysis = analyseThickness(readings.filter((r) => r.kind === 'ut' && r.measured != null).map((r) => ({ point: r.point, date: r.reading_date, measured: Number(r.measured), nominal: r.nominal, retirement: r.retirement })));
  const latestByType = new Map<string, Inspection>();
  for (const i of [...inspections].reverse()) if (i.status !== 'draft' && i.status !== 'revised') latestByType.set(i.type_code, i);
  const fileDocs = docs.filter((x) => x.kind !== 'photo' && x.kind !== 'nameplate');
  const design = asset.design ?? {};

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back title={asset.tag}
        sub={<span className="flex flex-wrap items-center gap-2">{asset.description}<Link className="underline" to={`/clients/${asset.client_id}`}>{client?.name}</Link>{asset.status !== 'in_service' && <Badge>{ASSET_STATUS[asset.status]}</Badge>}{asset.is_demo && <Badge tone="accent">Demo</Badge>}</span>}
        actions={<>
          {can.field && <LinkButton to={`/inspections/new?asset=${asset.id}`} icon="clipboard" tone="accent">New inspection</LinkButton>}
          {can.office && <LinkButton tone="secondary" icon="edit" to={`/assets/${asset.id}/edit`}>Edit</LinkButton>}
        </>} />

      {openF.length > 0 && (
        <button type="button" onClick={() => setTab('findings')} className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-start font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          {openF.length} open finding{openF.length > 1 ? 's' : ''} ({openF.filter((f) => f.priority === 'P1').length} × P1)
        </button>
      )}

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'inspections', label: 'Inspections', count: inspections.length },
        { key: 'findings', label: 'Findings', count: findings.length },
        { key: 'documents', label: 'Documents', count: fileDocs.length + certs.length },
        { key: 'photos', label: 'Photos' },
        { key: 'readings', label: 'Readings', count: readings.length },
        { key: 'history', label: 'History' },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              {[
                ['Type', eq?.name], ['Site', site?.name], ['Location', asset.location], ['Service', asset.service],
                ['Manufacturer', asset.manufacturer], ['Model', asset.model], ['Serial no.', asset.serial_no], ['Year built', asset.year_built],
                ['Design pressure', formatPressure(design.design_pressure_pa as number, unit)], ['MAWP', formatPressure(design.mawp_pa as number, unit)],
                ['Design temp.', design.design_temp_c != null ? `${design.design_temp_c} °C` : ''], ['Test pressure', formatPressure(design.test_pressure_pa as number, unit)],
                ['Capacity', design.capacity], ['Material', design.material], ['Code', design.code], ['Criticality', asset.criticality],
                ...(eq?.custom_fields ?? []).map((f) => [f.label, f.type === 'pressure' ? formatPressure(asset.custom?.[f.key] as number, unit) : (asset.custom?.[f.key] as string)]),
              ].filter(([, val]) => val !== undefined && val !== null && val !== '').map(([k, val]) => (
                <div key={String(k)}><dt className="text-muted">{k}</dt><dd className="font-semibold break-words">{String(val)}</dd></div>
              ))}
            </dl>
            {asset.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{asset.notes}</p>}
          </Card>
          <Card title="Label">
            <div className="flex flex-col items-center gap-2">
              <QrBlock asset={asset} />
              <span className="text-muted text-xs">Scan to open this asset</span>
            </div>
          </Card>
          <Card className="lg:col-span-2" title="Next inspections">
            {latestByType.size === 0 && (eq?.default_intervals ?? []).length === 0 ? <Empty title="No inspections recorded" icon="calendar" /> : (
              <div>
                {[...new Set([...latestByType.keys(), ...(eq?.default_intervals ?? []).map((x) => x.type)])].filter((t) => t !== 'HIST').map((tc) => {
                  const last = latestByType.get(tc);
                  const b = dueBucket(last?.next_due);
                  return (
                    <Row key={tc} title={inspTypeName(inspectionTypes, tc)} sub={last ? `Last ${fmtDate(last.inspection_date)} · next ${fmtDate(last.next_due) || 'not set'}` : 'No record yet'}
                      right={b === 'overdue' ? <Badge tone="red">Overdue</Badge> : b === 'd30' ? <Badge tone="amber">≤ 30 days</Badge> : b === 'none' ? <Badge>No date</Badge> : undefined} />
                  );
                })}
              </div>
            )}
          </Card>
          <Card title="Connected items">
            {parent && <Row to={`/assets/${parent.id}`} title={`Part of ${parent.tag}`} sub={parent.description} />}
            {children.map((c) => <Row key={c.id} to={`/assets/${c.id}`} title={c.tag} sub={c.description} />)}
            {!parent && children.length === 0 && <p className="text-muted text-sm">None</p>}
            {can.office && <LinkButton tone="secondary" icon="plus" className="mt-2 w-full" to={`/assets/new?client=${asset.client_id}&parent=${asset.id}`}>Add item on this asset</LinkButton>}
          </Card>
        </div>
      )}

      {tab === 'inspections' && (
        <Card actions={can.field && <Button size="sm" tone="secondary" icon="history" onClick={() => setModal('hist')}>Add historical</Button>}>
          {inspections.length === 0 ? <Empty title="No inspections yet" icon="clipboard" /> : (
            <ol className="relative ms-3 border-s-2 border-line">
              {inspections.map((i) => (
                <li key={i.id} className="ms-4 pb-4">
                  <span className="absolute -start-[9px] mt-1.5 h-4 w-4 rounded-full border-2 border-white bg-accent dark:border-navy" />
                  <Link to={`/inspections/${i.id}`} className="block rounded-xl p-2 hover:bg-black/5 dark:hover:bg-white/5">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {fmtDate(i.inspection_date)} · {inspTypeName(inspectionTypes, i.type_code)}
                      <Badge tone={statusTone(i.status)}>{DOC_STATUS[i.status]}</Badge>
                      {i.is_historical && <Badge>Historical</Badge>}
                    </div>
                    <div className="text-muted text-sm">{[i.report_no, i.inspector_name || i.contractor, CONCLUSION[i.conclusion]].filter(Boolean).join(' · ')}</div>
                    {i.summary && <div className="mt-1 line-clamp-2 text-sm">{i.summary}</div>}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === 'findings' && (
        <Card>
          {findings.length === 0 ? <Empty title="No findings" icon="check" /> : findings.map((f) => {
            const hist = updates.filter((u) => u.finding_id === f.id).sort((a, b) => a.update_date.localeCompare(b.update_date));
            return (
              <div key={f.id} className="border-b border-line py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/findings/${f.id}`} className="font-bold underline-offset-2 hover:underline">{f.ref ?? 'F-new'} {f.title}</Link>
                  <Badge tone={priorityTone(f.priority)}>{f.priority}</Badge>
                  <Badge tone={statusTone(f.status)}>{FINDING_STATUS[f.status]}</Badge>
                </div>
                <div className="text-muted text-sm">Raised {fmtDate(f.raised_date)}{f.due_date ? ` · due ${fmtDate(f.due_date)}` : ''}</div>
                {hist.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {hist.map((h) => <li key={h.id}>• {fmtDate(h.update_date)} – {FINDING_STATUS[h.status]}{h.note ? `: ${h.note}` : ''}</li>)}
                  </ul>
                )}
                {can.field && <Button size="sm" tone="ghost" className="mt-1" onClick={() => setModal({ finding: f })}>Add our note</Button>}
              </div>
            );
          })}
        </Card>
      )}

      {tab === 'documents' && (
        <Card actions={can.field && <Button size="sm" icon="upload" onClick={() => setModal('doc')}>Upload</Button>}>
          {fileDocs.length + certs.length === 0 && <Empty title="No documents yet" icon="file">Upload manuals, drawings, data sheets, previous reports and certificates.</Empty>}
          {certs.map((c) => (
            <Row key={c.id} to={`/certificates/${c.id}`} title={`Certificate ${c.number ?? '(draft)'}`} sub={`${c.kind.toUpperCase()} · ${DOC_STATUS[c.status]}`} />
          ))}
          {fileDocs.map((x) => (
            <Row key={x.id} title={x.title || x.file_path.split('/').pop()} sub={`${DOC_KINDS[x.kind]} · ${formatBytes(x.size_bytes)} · ${fmtDate(x.created_at)}`}
              onClick={() => openFile(x.file_path, `${x.title || 'document'}.${x.file_path.split('.').pop()}`).catch((e) => toast(e.message, 'error'))} />
          ))}
        </Card>
      )}

      {tab === 'photos' && (
        <Card actions={can.field && <PhotoCapture links={{ client_id: asset.client_id, asset_id: asset.id }} label="Add photo" />}>
          <PhotoGrid where={{ asset_id: asset.id }} editable={can.field} />
        </Card>
      )}

      {tab === 'readings' && (
        <Card title="Thickness history" actions={can.field && <Button size="sm" tone="secondary" icon="plus" onClick={() => setModal('reading')}>Add reading</Button>}>
          {analysis.length === 0 ? <Empty title="No thickness readings" icon="chart" /> : (
            <>
              <ThicknessChart points={analysis} />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-navy text-white">
                    <tr>{['Point', 'Readings', 'Latest (mm)', 't-min (mm)', 'Short-term rate', 'Long-term rate', 'Remaining life'].map((h) => <th key={h} className="px-2 py-2 text-start">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {analysis.map((p) => (
                      <tr key={p.point} className="border-b border-line">
                        <td className="px-2 py-2 font-semibold">{p.point}</td>
                        <td className="px-2 py-2">{p.readings.map((r) => `${r.measured} (${r.date.slice(0, 4)})`).join(' → ')}</td>
                        <td className="px-2 py-2">{p.latest.measured}</td>
                        <td className="px-2 py-2">{p.retirement ?? '—'}</td>
                        <td className="px-2 py-2">{p.shortTermRate != null ? `${p.shortTermRate.toFixed(3)} mm/y` : '—'}</td>
                        <td className="px-2 py-2">{p.longTermRate != null ? `${p.longTermRate.toFixed(3)} mm/y` : '—'}</td>
                        <td className={`px-2 py-2 font-semibold ${p.remainingLife != null && p.remainingLife < 4 ? 'text-red-700 dark:text-red-400' : ''}`}>
                          {p.remainingLife == null ? '—' : Number.isFinite(p.remainingLife) ? `${p.remainingLife.toFixed(1)} y` : 'No loss'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Record history">
          {tags.length === 0 ? <p className="text-muted text-sm">The tag has not been changed.</p> : tags.sort((a, b) => a.changed_at.localeCompare(b.changed_at)).map((h) => (
            <Row key={h.id} title={`Tag changed: ${h.old_tag} → ${h.new_tag}`} sub={fmtDate(h.changed_at)} />
          ))}
          <Row title="Record created" sub={fmtDate(asset.created_at)} />
          {asset.updated_at && <Row title="Last changed" sub={new Date(asset.updated_at).toLocaleString()} />}
        </Card>
      )}

      <Modal open={modal === 'hist'} onClose={() => setModal(null)} title="Historical inspection" wide>
        <HistoricalForm asset={asset} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={modal === 'doc'} onClose={() => setModal(null)} title="Upload document">
        <DocumentUpload asset={asset} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={modal === 'reading'} onClose={() => setModal(null)} title="Thickness reading">
        <ReadingForm asset={asset} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={typeof modal === 'object' && modal !== null} onClose={() => setModal(null)} title="Note on finding">
        {typeof modal === 'object' && modal !== null && <FindingNoteForm finding={modal.finding} onDone={() => setModal(null)} />}
      </Modal>
    </div>
  );
}
