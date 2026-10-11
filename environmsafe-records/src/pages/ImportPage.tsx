import { useState } from 'react';
import { Badge, Button, Card, PageHeader, SelectInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { normaliseTag, toPa, type PressureUnit } from '../lib/calc';
import { db } from '../lib/db';
import { notDeleted, useClients, useLibrary } from '../lib/domain';
import { create } from '../lib/sync';
import type { Asset, FindingStatus } from '../lib/types';

type Kind = 'assets' | 'inspections' | 'findings';

interface Target { key: string; label: string; required?: boolean; aliases: string[] }

const TARGETS: Record<Kind, Target[]> = {
  assets: [
    { key: 'tag', label: 'Tag number', required: true, aliases: ['tag', 'tag no', 'tag number', 'item', 'equipment tag', 'psv tag', 'valve tag'] },
    { key: 'description', label: 'Description', aliases: ['description', 'desc', 'equipment', 'name', 'service description'] },
    { key: 'type', label: 'Equipment type (code or name)', aliases: ['type', 'equipment type', 'category'] },
    { key: 'site', label: 'Site / area', aliases: ['site', 'area', 'plant', 'unit'] },
    { key: 'location', label: 'Location', aliases: ['location', 'position'] },
    { key: 'service', label: 'Service', aliases: ['service', 'fluid', 'medium'] },
    { key: 'manufacturer', label: 'Manufacturer', aliases: ['manufacturer', 'make', 'mfr'] },
    { key: 'model', label: 'Model', aliases: ['model', 'type/model'] },
    { key: 'serial_no', label: 'Serial number', aliases: ['serial', 'serial no', 'serial number', 's/n'] },
    { key: 'year_built', label: 'Year built', aliases: ['year', 'year built', 'yom'] },
    { key: 'set_pressure', label: 'Set pressure (PSV)', aliases: ['set pressure', 'set press', 'sp'] },
    { key: 'design_pressure', label: 'Design pressure', aliases: ['design pressure', 'dp', 'design press'] },
    { key: 'inlet_size', label: 'Inlet size', aliases: ['inlet', 'inlet size', 'size'] },
    { key: 'parent', label: 'Parent tag (fitted on)', aliases: ['parent', 'protected equipment', 'fitted on', 'equipment protected'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'remarks', 'comment'] },
  ],
  inspections: [
    { key: 'tag', label: 'Tag number', required: true, aliases: ['tag', 'tag no', 'tag number', 'item'] },
    { key: 'date', label: 'Inspection date', required: true, aliases: ['date', 'inspection date', 'last inspection', 'test date'] },
    { key: 'type', label: 'Inspection type (code or name)', aliases: ['type', 'inspection type', 'activity'] },
    { key: 'inspector', label: 'Inspector', aliases: ['inspector', 'inspected by'] },
    { key: 'contractor', label: 'Contractor', aliases: ['contractor', 'company', 'by'] },
    { key: 'report_no', label: 'Report / certificate number', aliases: ['report', 'report no', 'certificate', 'cert no'] },
    { key: 'summary', label: 'Summary', aliases: ['summary', 'result', 'remarks', 'findings'] },
    { key: 'next_due', label: 'Next due date', aliases: ['next due', 'next inspection', 'due date', 'next test'] },
  ],
  findings: [
    { key: 'tag', label: 'Tag number', required: true, aliases: ['tag', 'tag no', 'tag number', 'equipment', 'item'] },
    { key: 'title', label: 'Finding', required: true, aliases: ['finding', 'observation', 'description', 'defect', 'title'] },
    { key: 'raised', label: 'Date raised', aliases: ['date', 'raised', 'date raised', 'inspection date'] },
    { key: 'priority', label: 'Priority (P1/P2/P3)', aliases: ['priority', 'pri', 'rank'] },
    { key: 'location', label: 'Location', aliases: ['location', 'position'] },
    { key: 'recommendation', label: 'Recommendation', aliases: ['recommendation', 'action', 'corrective action'] },
    { key: 'status', label: 'Status', aliases: ['status', 'state'] },
    { key: 'note', label: 'Our note', aliases: ['note', 'our note', 'comment', 'remarks', 'es note'] },
    { key: 'due', label: 'Due date', aliases: ['due', 'due date', 'target date'] },
  ],
};

function toDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // day first (Yemen / UK style)
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toStatus(v: unknown): FindingStatus {
  const s = String(v ?? '').toLowerCase();
  if (/clos|done|complet/.test(s)) return 'closed';
  if (/defer/.test(s)) return 'deferred';
  if (/supersed/.test(s)) return 'superseded';
  if (/deterior|worse/.test(s)) return 'open_deteriorated';
  if (/improv/.test(s)) return 'open_improved';
  if (/unchang|same/.test(s)) return 'open_unchanged';
  return 'open';
}

function toPressure(v: unknown, unit: PressureUnit): number | null {
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase();
  const n = parseFloat(s.replace(',', '.'));
  if (Number.isNaN(n)) return null;
  const u: PressureUnit = /psi/.test(s) ? 'psi' : /kg/.test(s) ? 'kgcm2' : /mpa/.test(s) ? 'mpa' : /kpa/.test(s) ? 'kpa' : /bar/.test(s) ? 'bar' : unit;
  return toPa(n, u);
}

export default function ImportPage() {
  const toast = useToast();
  const { profile } = useAuth();
  const clients = useClients();
  const { equipmentTypes, inspectionTypes } = useLibrary();
  const [kind, setKind] = useState<Kind>('assets');
  const [clientId, setClientId] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<PressureUnit>('bar');
  const [defaultType, setDefaultType] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = async (f: File) => {
    setDone(null);
    let data: Record<string, unknown>[] = [];
    if (/\.csv$/i.test(f.name)) {
      const Papa = (await import('papaparse')).default;
      const r = Papa.parse<Record<string, unknown>>(await f.text(), { header: true, skipEmptyLines: true });
      data = r.data;
    } else {
      const { readSheet } = await import('read-excel-file/browser');
      const sheet = (await readSheet(f)) as unknown[][];
      // The header row is the first row with at least two text cells.
      const hi = sheet.findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 2);
      const head = (sheet[hi] ?? []).map((c, i) => String(c ?? `Column ${i + 1}`).trim());
      data = sheet.slice(hi + 1).filter((r) => r.some((c) => c != null && c !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
    }
    const hs = [...new Set(data.flatMap((r) => Object.keys(r)))];
    setRows(data);
    setHeaders(hs);
    const auto: Record<string, string> = {};
    for (const t of TARGETS[kind]) {
      const h = hs.find((x) => t.aliases.includes(x.toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()));
      if (h) auto[t.key] = h;
    }
    setMap(auto);
  };

  const val = (r: Record<string, unknown>, k: string) => (map[k] ? r[map[k]] : undefined);
  const str = (r: Record<string, unknown>, k: string) => {
    const v = val(r, k);
    return v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
  };
  const findType = (s: string) => {
    const q = s.toLowerCase();
    return equipmentTypes.find((e) => e.code.toLowerCase() === q || e.name.toLowerCase() === q) ?? equipmentTypes.find((e) => q && e.name.toLowerCase().includes(q));
  };
  const findInspType = (s: string) => {
    const q = s.toLowerCase();
    return inspectionTypes.find((e) => e.code.toLowerCase() === q || e.name.toLowerCase() === q)?.code ?? inspectionTypes.find((e) => q && e.name.toLowerCase().includes(q))?.code;
  };
  const problems = (r: Record<string, unknown>): string[] => {
    const p: string[] = [];
    for (const t of TARGETS[kind]) if (t.required && !str(r, t.key)) p.push(`${t.label} missing`);
    if (kind === 'inspections' && str(r, 'date') && !toDate(val(r, 'date'))) p.push('date not understood');
    return p;
  };
  const valid = rows.filter((r) => problems(r).length === 0);

  const run = async () => {
    if (!clientId) return toast('Choose the client', 'error');
    setBusy(true);
    const assets = ((await db.assets.where('client_id').equals(clientId).toArray()) as Asset[]).filter(notDeleted);
    const byTag = new Map(assets.map((a) => [normaliseTag(a.tag), a]));
    const sites = await db.sites.where('client_id').equals(clientId).toArray();
    let made = 0;
    let skipped = 0;
    const missing: string[] = [];
    try {
      if (kind === 'assets') {
        const parents: [string, string][] = [];
        for (const r of valid) {
          const tag = str(r, 'tag');
          if (byTag.has(normaliseTag(tag))) { skipped++; continue; }
          let siteId: string | null = null;
          const siteName = str(r, 'site');
          if (siteName) {
            let s = sites.find((x) => x.name.toLowerCase() === siteName.toLowerCase());
            if (!s) {
              const id = await create('sites', { client_id: clientId, name: siteName });
              s = { id, name: siteName };
              sites.push(s);
            }
            siteId = s.id;
          }
          const et = findType(str(r, 'type')) ?? equipmentTypes.find((e) => e.id === defaultType);
          const sp = toPressure(val(r, 'set_pressure'), unit);
          const dp = toPressure(val(r, 'design_pressure'), unit);
          const year = parseInt(str(r, 'year_built'), 10);
          const id = await create('assets', {
            client_id: clientId, site_id: siteId, tag, description: str(r, 'description'), equipment_type_id: et?.id ?? null, location: str(r, 'location'),
            service: str(r, 'service'), manufacturer: str(r, 'manufacturer'), model: str(r, 'model'), serial_no: str(r, 'serial_no'),
            year_built: year > 1850 && year < 2200 ? year : null, notes: str(r, 'notes'),
            design: dp != null ? { design_pressure_pa: dp } : {},
            custom: { ...(sp != null ? { set_pressure: sp } : {}), ...(str(r, 'inlet_size') ? { inlet_size: str(r, 'inlet_size') } : {}) },
            status: 'in_service', criticality: 'medium', intervals: {},
          });
          byTag.set(normaliseTag(tag), { id, tag } as Asset);
          if (str(r, 'parent')) parents.push([id, str(r, 'parent')]);
          made++;
        }
        const { save } = await import('../lib/sync');
        for (const [id, ptag] of parents) {
          const p = byTag.get(normaliseTag(ptag));
          if (p) await save('assets', id, { parent_id: p.id });
        }
      } else {
        for (const r of valid) {
          const a = byTag.get(normaliseTag(str(r, 'tag')));
          if (!a) { missing.push(str(r, 'tag')); continue; }
          if (kind === 'inspections') {
            await create('inspections', {
              client_id: clientId, asset_id: a.id, type_code: findInspType(str(r, 'type')) ?? 'HIST', inspection_date: toDate(val(r, 'date')), inspector_name: str(r, 'inspector'),
              contractor: str(r, 'contractor'), report_no: str(r, 'report_no') || null, summary: str(r, 'summary'), next_due: toDate(val(r, 'next_due')), is_historical: true, status: 'issued',
            });
          } else {
            const raised = toDate(val(r, 'raised')) ?? new Date().toISOString().slice(0, 10);
            const pri = (str(r, 'priority').toUpperCase().match(/P?([123])/)?.[1] ?? '2') as '1' | '2' | '3';
            const fid = await create('findings', {
              client_id: clientId, asset_id: a.id, title: str(r, 'title').slice(0, 300), location: str(r, 'location'), recommendation: str(r, 'recommendation'),
              priority: `P${pri}`, raised_date: raised, due_date: toDate(val(r, 'due')), status: 'open',
            });
            const st = toStatus(val(r, 'status'));
            if (st !== 'open' || str(r, 'note')) {
              await create('finding_updates', { finding_id: fid, client_id: clientId, update_date: raised, status: st, note: str(r, 'note'), by_name: profile?.full_name ?? '' });
            }
          }
          made++;
        }
      }
      setDone(`${made} imported${skipped ? `, ${skipped} skipped (tag already exists)` : ''}${missing.length ? `, ${missing.length} skipped – tag not found: ${[...new Set(missing)].slice(0, 10).join(', ')}` : ''}. They sync when online.`);
      setRows([]);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader back title="Import from Excel or CSV" sub="Bulk assets, historical inspections and previous findings" />
      <Card title="1. What and for whom">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectInput label="Import" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setRows([]); setMap({}); }} options={[{ value: 'assets', label: 'Assets (equipment register)' }, { value: 'inspections', label: 'Historical inspections' }, { value: 'findings', label: 'Previous findings' }]} />
          <SelectInput label="Client" value={clientId} placeholder="Choose client" onChange={(e) => setClientId(e.target.value)} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
          {kind === 'assets' && <SelectInput label="Pressure unit in the file" value={unit} onChange={(e) => setUnit(e.target.value as PressureUnit)} options={[{ value: 'bar', label: 'bar' }, { value: 'kgcm2', label: 'kg/cm²' }, { value: 'psi', label: 'psi' }, { value: 'mpa', label: 'MPa' }]} />}
          {kind === 'assets' && <SelectInput label="Equipment type when the file has none" value={defaultType} placeholder="—" onChange={(e) => setDefaultType(e.target.value)} options={equipmentTypes.map((t) => ({ value: t.id, label: t.name }))} />}
        </div>
        <label className="mt-3 block">
          <span className="text-sm font-semibold">File (.xlsx or .csv)</span>
          <input type="file" data-testid="import-file" accept=".xlsx,.csv" className="input mt-1" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      </Card>
      {rows.length > 0 && (
        <>
          <Card title="2. Match the columns">
            <div className="grid gap-2 sm:grid-cols-2">
              {TARGETS[kind].map((t) => (
                <SelectInput key={t.key} label={`${t.label}${t.required ? ' *' : ''}`} value={map[t.key] ?? ''} placeholder="— not in file —" onChange={(e) => setMap({ ...map, [t.key]: e.target.value })} options={headers.map((h) => ({ value: h, label: h }))} />
              ))}
            </div>
          </Card>
          <Card title={`3. Preview (${valid.length} of ${rows.length} rows ready)`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-navy text-white"><tr>{TARGETS[kind].filter((t) => map[t.key]).map((t) => <th key={t.key} className="px-2 py-1.5 text-start">{t.label}</th>)}<th className="px-2 py-1.5">Check</th></tr></thead>
                <tbody>
                  {rows.slice(0, 15).map((r, i) => {
                    const p = problems(r);
                    return (
                      <tr key={i} className="border-b border-line">
                        {TARGETS[kind].filter((t) => map[t.key]).map((t) => <td key={t.key} className="px-2 py-1">{str(r, t.key)}</td>)}
                        <td className="px-2 py-1">{p.length ? <Badge tone="red">{p.join(', ')}</Badge> : <Badge tone="green">OK</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button size="lg" className="mt-3" busy={busy} disabled={!clientId || !valid.length} onClick={run}>Import {valid.length} rows</Button>
          </Card>
        </>
      )}
      {done && <div className="rounded-xl bg-green-100 p-3 font-semibold text-green-900" role="status">{done}</div>}
    </div>
  );
}
