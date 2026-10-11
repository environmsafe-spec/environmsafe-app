import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PhotoCapture, PhotoGrid } from '../components/Photos';
import { PressureInput } from '../components/PressureInput';
import { SignaturePad } from '../components/SignaturePad';
import {
  Badge, Button, Card, Empty, LinkButton, Modal, PageHeader, priorityTone, Segmented, SelectInput, statusTone, TextArea, TextInput, useToast,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import {
  addMonths, corrosionRate, formatPressure, psvDeviationPct, psvTolerancePa, psvWithinTolerance, remainingLife, yearsBetween,
} from '../lib/calc';
import { db } from '../lib/db';
import {
  CARRY_OVER_CHOICES, CONCLUSION, DOC_STATUS, FINDING_STATUS, fmtDate, inspTypeName, isOpen, live, notDeleted, proposeNextDue, today,
  useClients, useLibrary, usePressureUnit, useRefList, useSites,
} from '../lib/domain';
import { queueFile, create, newId, save, update } from '../lib/sync';
import { supabase } from '../lib/supabase';
import type {
  Asset, ChecklistItem, Conclusion, EquipmentType, Finding, FindingStatus, Inspection, InspectionType, Job, PressureTestResults, PsvResults, Reading,
  TextBlock,
} from '../lib/types';

type CarryOver = Record<string, { status?: FindingStatus; note?: string }>;

const STEPS = [
  { key: 'checklist', label: 'Checklist' },
  { key: 'readings', label: 'Readings' },
  { key: 'photos', label: 'Photos' },
  { key: 'previous', label: 'Previous findings' },
  { key: 'findings', label: 'New findings' },
  { key: 'finish', label: 'Conclusion & sign' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

// ---------------------------------------------------------------------------
// Step 0: choose the asset and type
// ---------------------------------------------------------------------------
function StartForm() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const clients = useClients();
  const { inspectionTypes, equipmentTypes } = useLibrary();
  const preAsset = live(async () => (params.get('asset') ? ((await db.assets.get(params.get('asset')!)) as Asset | undefined) : undefined), [params.get('asset')]);
  const [clientId, setClientId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [date, setDate] = useState(today());
  const [jobId, setJobId] = useState(params.get('job') ?? '');
  useEffect(() => {
    if (preAsset) {
      setClientId(preAsset.client_id);
      setSiteId(preAsset.site_id ?? '');
      setAssetId(preAsset.id);
    }
  }, [preAsset]);
  const sites = useSites(clientId);
  const assets = live(async () => (clientId ? ((await db.assets.where('client_id').equals(clientId).toArray()) as Asset[]).filter(notDeleted) : []), [clientId], []) ?? [];
  const jobs = live(async () => (clientId ? ((await db.jobs.where('client_id').equals(clientId).toArray()) as Job[]).filter(notDeleted).filter((j) => j.status !== 'closed') : []), [clientId], []) ?? [];
  const asset = assets.find((a) => a.id === assetId);
  const eq = equipmentTypes.find((e) => e.id === asset?.equipment_type_id);
  const suggested = eq?.default_intervals.map((d) => d.type) ?? [];
  useEffect(() => {
    if (asset && !type && suggested.length) setType(suggested[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);
  const filtered = assets
    .filter((a) => !siteId || a.site_id === siteId)
    .filter((a) => !q || `${a.tag} ${a.description}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(q.toLowerCase().replace(/[^a-z0-9 ]/g, '')))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const typeOpts = [...inspectionTypes].filter((t) => t.code !== 'HIST').sort((a, b) => Number(suggested.includes(b.code)) - Number(suggested.includes(a.code)));
  return (
    <div className="max-w-2xl">
      <PageHeader title="New inspection" back />
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault();
        if (!asset || !type) return;
        const it = inspectionTypes.find((t) => t.code === type);
        const id = await create('inspections', {
          client_id: asset.client_id, asset_id: asset.id, job_id: jobId || null, type_code: type, standard: it?.standards?.[0] ?? '',
          inspection_date: date, inspector_id: profile?.id ?? null, inspector_name: profile?.full_name ?? '', status: 'draft',
        });
        nav(`/inspections/${id}?step=checklist`, { replace: true });
      }}>
        <SelectInput label="Client" value={clientId} placeholder="Choose client" options={clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => { setClientId(e.target.value); setSiteId(''); setAssetId(''); }} />
        {clientId && sites.length > 0 && (
          <SelectInput label="Site" value={siteId} placeholder="All sites" options={sites.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setSiteId(e.target.value)} />
        )}
        {clientId && !asset && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input className="input" placeholder="Type part of the tag" aria-label="Find tag" value={q} onChange={(e) => setQ(e.target.value)} />
              <LinkButton tone="secondary" icon="qr" to="/scan?next=inspect">Scan</LinkButton>
            </div>
            <div className="surface max-h-80 overflow-y-auto rounded-xl border border-line px-2">
              {filtered.length === 0 && <p className="text-muted p-3">No assets. <Link className="underline" to={`/assets/new?client=${clientId}`}>Add one</Link></p>}
              {filtered.map((a) => (
                <button key={a.id} type="button" onClick={() => setAssetId(a.id)} className="flex min-h-12 w-full flex-col items-start border-b border-line px-1 py-2 text-start last:border-0">
                  <span className="font-semibold">{a.tag}</span>
                  <span className="text-muted text-sm">{a.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {asset && (
          <div className="flex items-center justify-between rounded-xl border-2 border-navy p-3 dark:border-accent">
            <div><div className="font-bold">{asset.tag}</div><div className="text-muted text-sm">{asset.description}</div></div>
            <Button size="sm" tone="ghost" onClick={() => setAssetId('')}>Change</Button>
          </div>
        )}
        {asset && (
          <>
            <SelectInput label="Inspection / test type" required value={type} placeholder="Choose type" options={typeOpts.map((t) => ({ value: t.code, label: `${t.name}${suggested.includes(t.code) ? ' ★' : ''}` }))} onChange={(e) => setType(e.target.value)} hint="★ = usual for this equipment type" />
            <TextInput label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            {jobs.length > 0 && <SelectInput label="Job (optional)" value={jobId} placeholder="— none —" options={jobs.map((j) => ({ value: j.id, label: `${j.number} – ${j.title}` }))} onChange={(e) => setJobId(e.target.value)} />}
            <Button type="submit" size="lg" tone="accent" disabled={!type}>Start inspection</Button>
          </>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------
function ChecklistStep({ insp, items, editable }: { insp: Inspection; items: ChecklistItem[]; editable: boolean }) {
  const set = (id: string, patch: { answer?: string; note?: string }) =>
    update<Inspection & Record<string, unknown>>('inspections', insp.id, (row) => ({ checklist: { ...(row.checklist ?? {}), [id]: { ...(row.checklist?.[id] ?? {}), ...patch } } }));
  if (!items.length) return <Empty title="No checklist for this inspection type" icon="clipboard">An Admin can add one in Library → Inspection types.</Empty>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((it, n) => {
        const a = insp.checklist?.[it.id] ?? {};
        return (
          <li key={it.id} className="rounded-xl border border-line p-3">
            <div className="mb-2 font-semibold">{n + 1}. {it.text}</div>
            {it.kind === 'ync' ? (
              <Segmented label={it.text} value={(a.answer ?? '') as string} onChange={(v) => editable && set(it.id, { answer: v })}
                options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }]} />
            ) : (
              <input className="input" disabled={!editable} inputMode={it.kind === 'number' ? 'decimal' : 'text'} aria-label={it.text} defaultValue={a.answer ?? ''} onBlur={(e) => e.target.value !== (a.answer ?? '') && set(it.id, { answer: e.target.value })} />
            )}
            {(it.kind === 'ync' && a.answer === 'no') || a.note ? (
              <input className="input mt-2" placeholder="Note" aria-label={`Note for ${it.text}`} disabled={!editable} defaultValue={a.note ?? ''} onBlur={(e) => e.target.value !== (a.note ?? '') && set(it.id, { note: e.target.value })} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function UtTable({ insp, asset, readings, editable }: { insp: Inspection; asset: Asset; readings: Reading[]; editable: boolean }) {
  const mine = readings.filter((r) => r.inspection_id === insp.id && r.kind === 'ut');
  const earlier = readings.filter((r) => r.inspection_id !== insp.id && r.kind === 'ut' && r.reading_date <= insp.inspection_date);
  const points = useMemo(() => {
    const m = new Map<string, { point: string; location: string; nominal: number | null; retirement: number | null; prev: Reading | null; mine: Reading | null; sort: number }>();
    for (const r of [...earlier].sort((a, b) => a.reading_date.localeCompare(b.reading_date))) {
      m.set(r.point, { point: r.point, location: r.location, nominal: r.nominal, retirement: r.retirement, prev: r, mine: null, sort: r.sort });
    }
    for (const r of mine) {
      const e = m.get(r.point);
      m.set(r.point, { point: r.point, location: r.location || e?.location || '', nominal: r.nominal ?? e?.nominal ?? null, retirement: r.retirement ?? e?.retirement ?? null, prev: e?.prev ?? null, mine: r, sort: r.sort });
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort || a.point.localeCompare(b.point, undefined, { numeric: true }));
  }, [mine, earlier]);
  const [newPoint, setNewPoint] = useState('');
  const setMeasured = async (p: (typeof points)[number], field: 'measured' | 'retirement' | 'nominal', raw: string) => {
    const val = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    if (p.mine) await save('readings', p.mine.id, { [field]: val });
    else await create('readings', {
      inspection_id: insp.id, asset_id: asset.id, client_id: asset.client_id, kind: 'ut', point: p.point, location: p.location,
      nominal: p.nominal, retirement: p.retirement, previous: p.prev?.measured ?? null, reading_date: insp.inspection_date, sort: p.sort,
      [field]: val,
    });
  };
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-navy text-white">
            <tr>{['Point', 'Location', 'Nominal', 't-min', 'Previous', 'Measured (mm)', 'Rate mm/y', 'Rem. life'].map((h) => <th key={h} className="px-2 py-2 text-start">{h}</th>)}</tr>
          </thead>
          <tbody>
            {points.map((p) => {
              const m = p.mine?.measured;
              const rate = p.prev && m != null ? corrosionRate(Number(p.prev.measured), Number(m), yearsBetween(p.prev.reading_date, insp.inspection_date)) : null;
              const rl = rate != null && p.retirement != null && m != null ? remainingLife(Number(m), Number(p.retirement), rate) : null;
              return (
                <tr key={p.point} className="border-b border-line">
                  <td className="px-2 py-1.5 font-semibold">{p.point}</td>
                  <td className="px-2 py-1.5">{p.location}</td>
                  <td className="px-2 py-1.5">{p.nominal ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    <input className="input !min-h-10 !w-20 !py-1" inputMode="decimal" aria-label={`t-min ${p.point}`} disabled={!editable} defaultValue={p.retirement ?? ''} onBlur={(e) => String(p.retirement ?? '') !== e.target.value && setMeasured(p, 'retirement', e.target.value)} />
                  </td>
                  <td className="px-2 py-1.5">{p.prev ? `${p.prev.measured} (${p.prev.reading_date.slice(0, 4)})` : '—'}</td>
                  <td className="px-2 py-1.5">
                    <input className="input !min-h-10 !w-24 !py-1 font-bold" inputMode="decimal" aria-label={`Measured ${p.point}`} disabled={!editable} defaultValue={m ?? ''} onBlur={(e) => String(m ?? '') !== e.target.value && setMeasured(p, 'measured', e.target.value)} />
                  </td>
                  <td className="px-2 py-1.5">{rate != null ? rate.toFixed(3) : '—'}</td>
                  <td className={`px-2 py-1.5 font-semibold ${rl != null && rl < 4 ? 'text-red-700 dark:text-red-400' : ''}`}>{rl == null ? '—' : Number.isFinite(rl) ? `${rl.toFixed(1)} y` : 'No loss'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <form className="mt-3 flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!newPoint.trim()) return;
          await create('readings', { inspection_id: insp.id, asset_id: asset.id, client_id: asset.client_id, kind: 'ut', point: newPoint.trim(), reading_date: insp.inspection_date, sort: points.length + 1 });
          setNewPoint('');
        }}>
          <input className="input" placeholder="New point, e.g. CML-06" aria-label="New measuring point" value={newPoint} onChange={(e) => setNewPoint(e.target.value)} />
          <Button type="submit" tone="secondary" icon="plus">Add point</Button>
        </form>
      )}
    </div>
  );
}

function PsvForm({ insp, asset, editable }: { insp: Inspection; asset: Asset; editable: boolean }) {
  const r: PsvResults = insp.results?.psv ?? {};
  const unit = usePressureUnit();
  const setPsv = (patch: Partial<PsvResults>) =>
    update<Inspection & Record<string, unknown>>('inspections', insp.id, (row) => ({ results: { ...(row.results ?? {}), psv: { ...(row.results?.psv ?? {}), ...patch } } }));
  const setP = r.set_pressure_pa ?? (asset.custom?.set_pressure as number | undefined) ?? (asset.design?.set_pressure_pa as number | undefined) ?? null;
  const code = r.code ?? 'ASME VIII';
  const tol = setP ? psvTolerancePa(setP, code) : null;
  const check = (pa: number | null | undefined) => {
    if (!setP || pa == null) return null;
    const ok = psvWithinTolerance(setP, pa, code);
    return <Badge tone={ok ? 'green' : 'red'}>{ok ? 'Within' : 'Outside'} tolerance ({psvDeviationPct(setP, pa).toFixed(1)}%)</Badge>;
  };
  const parts = r.parts ?? ['Body', 'Nozzle', 'Disc', 'Seat', 'Spring', 'Guide', 'Spindle', 'Bellows'].map((p) => ({ part: p, condition: '', action: '' }));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PressureInput label="Set pressure" valuePa={setP} onChange={(pa) => setPsv({ set_pressure_pa: pa })} disabled={!editable} />
        <PressureInput label="Cold differential test pressure" valuePa={r.cdtp_pa} onChange={(pa) => setPsv({ cdtp_pa: pa })} disabled={!editable} />
        <SelectInput label="Tolerance rule" value={code} disabled={!editable} onChange={(e) => setPsv({ code: e.target.value as PsvResults['code'] })} options={[{ value: 'ASME VIII', label: 'ASME VIII (±2 psi ≤ 70 psi, ±3 %)' }, { value: 'ASME I', label: 'ASME I (boilers)' }]} hint={tol ? `Allowed: ± ${formatPressure(tol, unit)}` : undefined} />
        <TextInput label="Test medium" value={r.test_medium ?? ''} disabled={!editable} onChange={(e) => setPsv({ test_medium: e.target.value })} placeholder="Air / nitrogen / water" />
        <div><PressureInput label="As-found pop pressure" valuePa={r.as_found_pa} onChange={(pa) => setPsv({ as_found_pa: pa })} disabled={!editable} /><div className="mt-1">{check(r.as_found_pa)}</div></div>
        <div><PressureInput label="As-left set pressure" valuePa={r.as_left_pa} onChange={(pa) => setPsv({ as_left_pa: pa })} disabled={!editable} /><div className="mt-1">{check(r.as_left_pa)}</div></div>
        <PressureInput label="Reseat pressure" valuePa={r.reseat_pa} onChange={(pa) => setPsv({ reseat_pa: pa })} disabled={!editable} />
        <SelectInput label="Seat tightness (API 527)" value={r.seat_tightness ?? ''} disabled={!editable} placeholder="—" onChange={(e) => setPsv({ seat_tightness: e.target.value as PsvResults['seat_tightness'] })} options={[{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }]} />
        <TextInput label="Test bench" value={r.bench ?? ''} disabled={!editable} onChange={(e) => setPsv({ bench: e.target.value })} />
        <TextInput label="Test gauge (no. / calibration due)" value={r.gauge ?? ''} disabled={!editable} onChange={(e) => setPsv({ gauge: e.target.value })} />
      </div>
      <div>
        <h3 className="mb-2 font-bold">Parts condition</h3>
        <div className="flex flex-col gap-2">
          {parts.map((p, i) => (
            <div key={p.part} className="grid grid-cols-3 gap-2">
              <span className="self-center font-semibold">{p.part}</span>
              <input className="input !min-h-10" aria-label={`${p.part} condition`} placeholder="Condition" disabled={!editable} defaultValue={p.condition}
                onBlur={(e) => setPsv({ parts: parts.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) })} />
              <input className="input !min-h-10" aria-label={`${p.part} action`} placeholder="Action" disabled={!editable} defaultValue={p.action}
                onBlur={(e) => setPsv({ parts: parts.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
      </div>
      <SelectInput label="Final result" value={r.result ?? ''} placeholder="—" disabled={!editable} onChange={(e) => setPsv({ result: e.target.value as PsvResults['result'] })} options={[{ value: 'pass', label: 'Accepted – valve set and sealed' }, { value: 'fail', label: 'Rejected – replace or repair' }]} />
    </div>
  );
}

function PressureTestForm({ insp, asset, editable }: { insp: Inspection; asset: Asset; editable: boolean }) {
  const r: PressureTestResults = insp.results?.pressure ?? {};
  const setR = (patch: Partial<PressureTestResults>) =>
    update<Inspection & Record<string, unknown>>('inspections', insp.id, (row) => ({ results: { ...(row.results ?? {}), pressure: { ...(row.results?.pressure ?? {}), ...patch } } }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <PressureInput label="Design pressure" valuePa={r.design_pressure_pa ?? (asset.design?.design_pressure_pa as number | null)} onChange={(pa) => setR({ design_pressure_pa: pa })} disabled={!editable} />
      <PressureInput label="Test pressure" valuePa={r.test_pressure_pa ?? (asset.design?.test_pressure_pa as number | null)} onChange={(pa) => setR({ test_pressure_pa: pa })} disabled={!editable} />
      <TextInput label="Hold time (minutes)" type="number" value={r.hold_minutes ?? ''} disabled={!editable} onChange={(e) => setR({ hold_minutes: e.target.value ? Number(e.target.value) : null })} />
      <TextInput label="Test medium" value={r.test_medium ?? ''} disabled={!editable} onChange={(e) => setR({ test_medium: e.target.value })} placeholder="Water" />
      <TextInput label="Water temperature (°C)" type="number" value={r.water_temp_c ?? ''} disabled={!editable} onChange={(e) => setR({ water_temp_c: e.target.value ? Number(e.target.value) : null })} />
      <TextInput label="Gauges used (no. / calibration)" value={r.gauges ?? ''} disabled={!editable} onChange={(e) => setR({ gauges: e.target.value })} />
      <TextInput label="Start time" type="time" value={r.start_time ?? ''} disabled={!editable} onChange={(e) => setR({ start_time: e.target.value })} />
      <TextInput label="End time" type="time" value={r.end_time ?? ''} disabled={!editable} onChange={(e) => setR({ end_time: e.target.value })} />
      <PressureInput label="Pressure drop during hold" valuePa={r.pressure_drop_pa} onChange={(pa) => setR({ pressure_drop_pa: pa })} disabled={!editable} />
      <SelectInput label="Result" value={r.result ?? ''} placeholder="—" disabled={!editable} onChange={(e) => setR({ result: e.target.value as PressureTestResults['result'] })} options={[{ value: 'pass', label: 'Pass – no leaks or deformation' }, { value: 'fail', label: 'Fail' }]} />
    </div>
  );
}

function FindingForm({ insp, asset, finding, onDone }: { insp: Inspection; asset: Asset; finding: Partial<Finding> | null; onDone: () => void }) {
  const categories = useRefList('finding_category');
  const mechanisms = useRefList('damage_mechanism');
  const [v, setV] = useState<Partial<Finding>>(finding ?? { severity: 'medium', priority: 'P2' });
  const set = (p: Partial<Finding>) => {
    const next = { ...v, ...p };
    if (p.priority && !v.due_date) {
      next.due_date = p.priority === 'P1' ? addMonths(insp.inspection_date, 6) : p.priority === 'P2' ? addMonths(insp.inspection_date, 12) : null;
    }
    setV(next);
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const patch = {
        title: v.title?.trim(), description: v.description ?? '', location: v.location ?? '', severity: v.severity, priority: v.priority, category: v.category ?? '',
        damage_mechanism: v.damage_mechanism ?? '', code_ref: v.code_ref ?? '', recommendation: v.recommendation ?? '', due_date: v.due_date ?? null, owner: v.owner ?? '',
      };
      if (finding?.id) await save('findings', finding.id, patch);
      else await create('findings', { ...patch, client_id: asset.client_id, asset_id: asset.id, inspection_id: insp.id, status: 'open', raised_date: insp.inspection_date });
      onDone();
    }}>
      <TextInput label="Finding" required maxLength={300} value={v.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="Short title, e.g. External corrosion at bottom head" />
      <TextArea label="Description (condition found)" value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      <TextInput label="Location on equipment" value={v.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <SelectInput label="Severity" value={v.severity ?? 'medium'} onChange={(e) => set({ severity: e.target.value as Finding['severity'] })} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']].map(([a, b]) => ({ value: a, label: b }))} />
        <SelectInput label="Priority" value={v.priority ?? 'P2'} onChange={(e) => set({ priority: e.target.value as Finding['priority'] })} options={[{ value: 'P1', label: 'P1 – within 6 months' }, { value: 'P2', label: 'P2 – next shutdown' }, { value: 'P3', label: 'P3 – routine' }]} />
        <SelectInput label="Category" value={v.category ?? ''} placeholder="—" onChange={(e) => set({ category: e.target.value })} options={categories.map((c) => ({ value: c.code, label: c.label }))} />
        <SelectInput label="Damage mechanism" value={v.damage_mechanism ?? ''} placeholder="—" onChange={(e) => set({ damage_mechanism: e.target.value })} options={mechanisms.map((c) => ({ value: c.code, label: c.label }))} />
        <TextInput label="Code reference" value={v.code_ref ?? ''} onChange={(e) => set({ code_ref: e.target.value })} />
        <TextInput label="Due date" type="date" value={v.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} />
      </div>
      <TextArea label="Recommendation" value={v.recommendation ?? ''} onChange={(e) => set({ recommendation: e.target.value })} />
      <TextInput label="Action owner" value={v.owner ?? ''} onChange={(e) => set({ owner: e.target.value })} />
      <Button type="submit">Save finding</Button>
    </form>
  );
}

function SignStep({ insp, onSigned }: { insp: Inspection; onSigned: () => void }) {
  const { profile } = useAuth();
  const [draw, setDraw] = useState(false);
  const sign = async (path: string | null) => {
    await save('inspections', insp.id, {
      signature: { name: profile?.full_name ?? '', title: profile?.title ?? '', cert_no: profile?.cert_number ?? '', image_path: path ?? undefined, signed_at: new Date().toISOString() },
    });
    onSigned();
  };
  if (insp.signature?.signed_at) {
    return <p className="font-semibold text-green-700 dark:text-green-400">Signed by {insp.signature.name} on {new Date(insp.signature.signed_at).toLocaleString()}</p>;
  }
  if (draw) {
    return (
      <SignaturePad onCancel={() => setDraw(false)} onSave={async (png) => {
        const path = `signatures/${profile!.id}/${newId()}.png`;
        await queueFile(path, png);
        await db.profiles.update(profile!.id, { signature_path: path });
        if (navigator.onLine) await supabase.from('profiles').update({ signature_path: path }).eq('id', profile!.id);
        await sign(path);
      }} />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {profile?.signature_path && <Button icon="pen" onClick={() => sign(profile.signature_path)}>Sign with my saved signature</Button>}
      <Button tone={profile?.signature_path ? 'secondary' : 'primary'} icon="pen" onClick={() => setDraw(true)}>Draw signature</Button>
    </div>
  );
}

function Wizard({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can, profile } = useAuth();
  const { inspectionTypes, equipmentTypes } = useLibrary();
  const conclusions = useRefList('conclusion');
  const d = live(async () => {
    const insp = (await db.inspections.get(id)) as Inspection | undefined;
    if (!insp) return null;
    const asset = (await db.assets.get(insp.asset_id)) as Asset;
    const [allInsp, findings, readings, textBlocks] = await Promise.all([
      db.inspections.where('asset_id').equals(insp.asset_id).toArray() as Promise<Inspection[]>,
      db.findings.where('asset_id').equals(insp.asset_id).toArray() as Promise<Finding[]>,
      db.readings.where('asset_id').equals(insp.asset_id).toArray() as Promise<Reading[]>,
      db.text_blocks.toArray() as Promise<TextBlock[]>,
    ]);
    const previous = allInsp.filter(notDeleted).filter((i) => i.id !== insp.id && i.inspection_date <= insp.inspection_date && i.status !== 'draft').sort((a, b) => b.inspection_date.localeCompare(a.inspection_date))[0];
    return { insp, asset, previous, findings: findings.filter(notDeleted), readings: readings.filter(notDeleted), textBlocks: textBlocks.filter(notDeleted) };
  }, [id]);
  const [findingEdit, setFindingEdit] = useState<Partial<Finding> | null>(null);
  const [busy, setBusy] = useState(false);
  if (d === undefined) return null;
  if (!d) return <Empty title="Inspection not found" />;
  const { insp, asset, previous, findings, readings, textBlocks } = d;
  const itype = inspectionTypes.find((t) => t.code === insp.type_code) as InspectionType | undefined;
  const eq = equipmentTypes.find((e) => e.id === asset.equipment_type_id) as EquipmentType | undefined;
  const checklist = eq?.checklists?.[insp.type_code]?.length ? eq.checklists[insp.type_code] : itype?.checklist ?? [];
  const mine = insp.created_by === profile?.id || !insp.created_by;
  const editable = insp.status === 'draft' ? can.office || (can.field && mine) : (insp.status === 'submitted' || insp.status === 'reviewed') && can.office;
  const step = (params.get('step') as StepKey | null) ?? (insp.status === 'draft' ? 'checklist' : 'finish');
  const goto = (s: StepKey) => setParams({ step: s }, { replace: true });
  const carry: CarryOver = (insp.results?.carry as CarryOver) ?? {};
  const previousFindings = findings.filter((f) => f.inspection_id !== insp.id && f.raised_date <= insp.inspection_date && (isOpen(f) || carry[f.id]));
  const newFindings = findings.filter((f) => f.inspection_id === insp.id);
  const missingCarry = previousFindings.filter((f) => !carry[f.id]?.status || (carry[f.id]?.status === 'deferred' && !carry[f.id]?.note));
  const proposal = proposeNextDue(asset, eq, insp.type_code, insp.inspection_date, readings.filter((r) => r.reading_date <= insp.inspection_date));
  const isPsv = insp.type_code === 'PSV';
  const isPressure = insp.type_code === 'HYDRO' || insp.type_code === 'LEAK' || insp.type_code === 'GAS';
  const setCarry = (fid: string, patch: { status?: FindingStatus; note?: string }) =>
    update<Inspection & Record<string, unknown>>('inspections', insp.id, (row) => {
      const c = ((row.results?.carry as CarryOver) ?? {});
      return { results: { ...(row.results ?? {}), carry: { ...c, [fid]: { ...(c[fid] ?? {}), ...patch } } } };
    });
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const submit = async (alsoIssue: boolean) => {
    if (missingCarry.length) {
      goto('previous');
      return toast(`Update all ${missingCarry.length} previous finding(s) first (deferred ones need a justification).`, 'error');
    }
    if (!insp.signature?.signed_at) return toast('Sign the inspection first.', 'error');
    setBusy(true);
    for (const f of previousFindings) {
      const c = carry[f.id];
      if (!c?.status) continue;
      await create('finding_updates', { finding_id: f.id, client_id: insp.client_id, inspection_id: insp.id, update_date: insp.inspection_date, status: c.status, note: c.note ?? '', by_name: profile?.full_name ?? '' });
    }
    const patch: Partial<Inspection> = {
      status: 'submitted', submitted_at: new Date().toISOString(),
      next_due: insp.next_due ?? proposal.next_due, interval_months: insp.interval_months ?? proposal.months,
    };
    await save('inspections', insp.id, patch);
    if (alsoIssue) await save('inspections', insp.id, { status: 'issued' });
    setBusy(false);
    toast(alsoIssue ? 'Inspection issued' : 'Inspection submitted for review');
    nav(`/inspections/${insp.id}?step=finish`, { replace: true });
  };

  const readOnlyBanner = !editable && (
    <div className="rounded-xl bg-black/5 p-3 text-sm font-semibold dark:bg-white/10">
      {insp.status === 'issued' ? 'Issued and locked. To change it, create a revision.' : insp.status === 'revised' ? 'This version was replaced by a revision.' : insp.status === 'draft' ? 'Draft by another inspector – view only.' : 'Submitted – Office can review and issue.'}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={`/assets/${asset.id}?tab=inspections`} title={`${asset.tag} – ${itype?.name ?? insp.type_code}`}
        sub={<span className="flex flex-wrap items-center gap-2">{fmtDate(insp.inspection_date)}<Badge tone={statusTone(insp.status)}>{DOC_STATUS[insp.status]}</Badge>{insp.report_no && <span>{insp.report_no}</span>}{insp.revision > 0 && <span>Rev. {String(insp.revision).padStart(2, '0')}</span>}</span>} />

      <details className="surface rounded-2xl border border-line p-3" open={step === 'checklist' && insp.status === 'draft'}>
        <summary className="cursor-pointer font-bold">Asset data and previous inspection</summary>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-muted">Description:</span> {asset.description}</div>
          <div><span className="text-muted">Design:</span> {[asset.design?.code, asset.design?.material, asset.design?.capacity].filter(Boolean).join(' · ')}</div>
          <div className="sm:col-span-2"><span className="text-muted">Previous:</span> {previous ? `${fmtDate(previous.inspection_date)} – ${inspTypeName(inspectionTypes, previous.type_code)} – ${CONCLUSION[previous.conclusion]}. ${previous.summary}` : 'No previous inspection recorded.'}</div>
          <div className="sm:col-span-2"><span className="text-muted">Open findings from earlier inspections:</span> <b>{previousFindings.length}</b></div>
        </div>
      </details>

      {readOnlyBanner}

      <nav aria-label="Steps" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const warn = s.key === 'previous' && missingCarry.length > 0;
          return (
            <button key={s.key} type="button" onClick={() => goto(s.key)} aria-current={step === s.key}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold ${step === s.key ? 'bg-navy text-white dark:bg-accent dark:text-navy' : 'surface border border-line'}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${warn ? 'bg-red-700 text-white' : 'bg-black/10 dark:bg-white/20'}`}>{warn ? '!' : i + 1}</span>
              {s.label}
            </button>
          );
        })}
      </nav>

      {step === 'checklist' && (
        <Card title="Checklist">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <TextInput label="Standard / code" disabled={!editable} defaultValue={insp.standard} onBlur={(e) => e.target.value !== insp.standard && save('inspections', insp.id, { standard: e.target.value })} list="standards-list" />
            <TextInput label="Code edition" disabled={!editable} defaultValue={insp.code_edition} placeholder="e.g. 2022" onBlur={(e) => e.target.value !== insp.code_edition && save('inspections', insp.id, { code_edition: e.target.value })} />
            <TextInput label="Witness" disabled={!editable} defaultValue={insp.witness} onBlur={(e) => e.target.value !== insp.witness && save('inspections', insp.id, { witness: e.target.value })} />
          </div>
          <StandardsList />
          <ChecklistStep insp={insp} items={checklist} editable={editable} />
        </Card>
      )}

      {step === 'readings' && (
        <div className="flex flex-col gap-4">
          {isPsv && <Card title="Safety valve test"><PsvForm insp={insp} asset={asset} editable={editable} /></Card>}
          {isPressure && <Card title="Pressure test"><PressureTestForm insp={insp} asset={asset} editable={editable} /></Card>}
          <Card title="Thickness readings (UT)">
            <UtTable insp={insp} asset={asset} readings={readings} editable={editable} />
          </Card>
        </div>
      )}

      {step === 'photos' && (
        <Card title="Photos" actions={editable && <PhotoCapture links={{ client_id: insp.client_id, asset_id: asset.id, inspection_id: insp.id }} />}>
          <p className="text-muted mb-3 text-sm">Photos are compressed on the phone and numbered as figures in the report annex. Add a caption to each.</p>
          <PhotoGrid where={{ inspection_id: insp.id }} editable={editable} />
        </Card>
      )}

      {step === 'previous' && (
        <Card title={`Previous findings (${previousFindings.length})`}>
          {previousFindings.length === 0 ? <Empty title="No open findings from earlier inspections" icon="check" /> : (
            <ul className="flex flex-col gap-4">
              {previousFindings.map((f) => {
                const c = carry[f.id] ?? {};
                return (
                  <li key={f.id} className={`rounded-xl border-2 p-3 ${c.status ? 'border-line' : 'border-red-600'}`} data-testid="carry-item">
                    <div className="flex flex-wrap items-center gap-2 font-bold">
                      {f.ref} {f.title}
                      <Badge tone={priorityTone(f.priority)}>{f.priority}</Badge>
                      <Badge tone={statusTone(f.status)}>{FINDING_STATUS[f.status]}</Badge>
                    </div>
                    <div className="text-muted text-sm">Raised {fmtDate(f.raised_date)}{f.location ? ` · ${f.location}` : ''}</div>
                    {f.description && <p className="mt-1 text-sm">{f.description}</p>}
                    <div className="mt-3">
                      <Segmented label={`Status of ${f.ref}`} value={(c.status ?? '') as FindingStatus} onChange={(v) => editable && setCarry(f.id, { status: v })} options={CARRY_OVER_CHOICES} />
                    </div>
                    <input className="input mt-2" placeholder={c.status === 'deferred' ? 'Justification (required)' : 'Our note'} aria-label={`Note for ${f.ref}`} disabled={!editable} defaultValue={c.note ?? ''}
                      onBlur={(e) => e.target.value !== (c.note ?? '') && setCarry(f.id, { note: e.target.value })} />
                    {editable && (
                      <div className="mt-2">
                        <PhotoCapture label="Photo" links={{ client_id: insp.client_id, asset_id: asset.id, inspection_id: insp.id, finding_id: f.id }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {step === 'findings' && (
        <Card title={`New findings (${newFindings.length})`} actions={editable && <Button icon="plus" onClick={() => setFindingEdit({})}>Add finding</Button>}>
          {newFindings.length === 0 ? <Empty title="No new findings" icon="check" /> : newFindings.map((f) => (
            <div key={f.id} className="border-b border-line py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2 font-bold">{f.ref ?? 'F-new'} {f.title}<Badge tone={priorityTone(f.priority)}>{f.priority}</Badge></div>
              <div className="text-muted text-sm">{[f.location, f.due_date && `due ${fmtDate(f.due_date)}`].filter(Boolean).join(' · ')}</div>
              {editable && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" tone="secondary" onClick={() => setFindingEdit(f)}>Edit</Button>
                  <PhotoCapture label="Photo" links={{ client_id: insp.client_id, asset_id: asset.id, inspection_id: insp.id, finding_id: f.id }} />
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {step === 'finish' && (
        <div className="flex flex-col gap-4">
          <Card title="Conclusion">
            <div className="flex flex-col gap-3">
              <SelectInput label="Conclusion" disabled={!editable} value={insp.conclusion} onChange={(e) => {
                const c = e.target.value as Conclusion;
                const wording = conclusions.find((x) => x.code === c)?.desc ?? '';
                void save('inspections', insp.id, { conclusion: c, ...(insp.conclusion_text ? {} : { conclusion_text: wording }) });
              }} options={Object.entries(CONCLUSION).map(([k, l]) => ({ value: k, label: l }))} />
              <TextArea label="Conclusion wording" disabled={!editable} defaultValue={insp.conclusion_text} key={`c-${insp.conclusion}`} onBlur={(e) => e.target.value !== insp.conclusion_text && save('inspections', insp.id, { conclusion_text: e.target.value })} />
              <TextArea label="Summary of inspection" disabled={!editable} defaultValue={insp.summary} onBlur={(e) => e.target.value !== insp.summary && save('inspections', insp.id, { summary: e.target.value })} hint="Written as 'we': state conditions found; where the origin cannot be established, say so." />
              <TextArea label="Recommendations" disabled={!editable} defaultValue={insp.recommendations} onBlur={(e) => e.target.value !== insp.recommendations && save('inspections', insp.id, { recommendations: e.target.value })} />
              <div>
                <TextArea label="Limitations" disabled={!editable} defaultValue={insp.limitations} key={`l-${insp.limitations.length}`} onBlur={(e) => e.target.value !== insp.limitations && save('inspections', insp.id, { limitations: e.target.value })} />
                {editable && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {textBlocks.filter((b) => b.category === 'limitations').map((b) => (
                      <Button key={b.id} size="sm" tone="secondary" onClick={() => save('inspections', insp.id, { limitations: [insp.limitations, b.body].filter(Boolean).join('\n\n') })}>+ {b.title}</Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
          <Card title="Next inspection">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Interval (months)" type="number" min={0} max={240} disabled={!editable} value={insp.interval_months ?? proposal.months ?? ''}
                onChange={(e) => {
                  const m = e.target.value ? Number(e.target.value) : null;
                  void save('inspections', insp.id, { interval_months: m, next_due: m != null ? addMonths(insp.inspection_date, m) : null });
                }} hint={`Proposed: ${proposal.months ?? '—'} months (${proposal.basis}). Default only – confirm against code edition, client requirement and local regulation.`} />
              <TextInput label="Next due date" type="date" disabled={!editable} value={insp.next_due ?? proposal.next_due ?? ''} onChange={(e) => save('inspections', insp.id, { next_due: e.target.value || null })} />
            </div>
          </Card>
          <Card title="Sign-off">
            {editable && insp.status === 'draft' ? <SignStep insp={insp} onSigned={() => toast('Signed')} /> : insp.signature?.signed_at ? (
              <p>Signed by <b>{insp.signature.name}</b>{insp.signature.cert_no ? ` (cert. ${insp.signature.cert_no})` : ''} on {new Date(insp.signature.signed_at).toLocaleString()}</p>
            ) : <p className="text-muted">Not signed</p>}
            {insp.status === 'draft' && editable && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="lg" tone="accent" busy={busy} onClick={() => submit(false)}>Submit</Button>
                {can.office && <Button size="lg" tone="secondary" busy={busy} onClick={() => submit(true)}>Submit and issue</Button>}
              </div>
            )}
          </Card>
          <InspectionActions insp={insp} asset={asset} />
        </div>
      )}

      {editable && stepIndex >= 0 && stepIndex < STEPS.length - 1 && (
        <Button size="lg" onClick={() => goto(STEPS[stepIndex + 1].key)}>Next: {STEPS[stepIndex + 1].label}</Button>
      )}

      <Modal open={findingEdit !== null} onClose={() => setFindingEdit(null)} title={findingEdit?.id ? 'Edit finding' : 'New finding'} wide>
        {findingEdit && <FindingForm insp={insp} asset={asset} finding={findingEdit} onDone={() => setFindingEdit(null)} />}
      </Modal>
    </div>
  );
}

function StandardsList() {
  const standards = live(async () => (await db.standards.toArray()).filter(notDeleted), [], []) ?? [];
  return (
    <datalist id="standards-list">
      {standards.map((s) => <option key={s.id} value={s.code}>{s.title}</option>)}
    </datalist>
  );
}

function InspectionActions({ insp, asset }: { insp: Inspection; asset: Asset }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  if (insp.status === 'draft') return null;
  return (
    <Card title="Actions">
      <div className="flex flex-wrap gap-2">
        {can.office && (insp.status === 'submitted' || insp.status === 'reviewed') && (
          <>
            {insp.status === 'submitted' && <Button tone="secondary" onClick={() => save('inspections', insp.id, { status: 'reviewed' })}>Mark reviewed</Button>}
            <Button tone="accent" onClick={async () => {
              if (!confirm('Issue this inspection? It will be locked and given a report number.')) return;
              await save('inspections', insp.id, { status: 'issued' });
              toast('Issued');
            }}>Issue</Button>
          </>
        )}
        <LinkButton tone="secondary" icon="fileText" to={`/reports/new?template=inspection&inspection=${insp.id}`}>Inspection report (Word / PDF)</LinkButton>
        {can.field && (
          <LinkButton tone="secondary" icon="file" to={`/certificates/new?inspection=${insp.id}&kind=${insp.type_code === 'PSV' ? 'psv' : insp.type_code === 'HYDRO' ? 'hydro' : insp.type_code === 'UT' ? 'ut' : insp.type_code === 'CAL' ? 'calibration' : insp.type_code === 'LIFT' ? 'lifting' : 'general'}`}>Create certificate</LinkButton>
        )}
        {can.office && insp.status === 'issued' && (
          <Button tone="secondary" icon="copy" onClick={async () => {
            if (!confirm('Create a new revision? The issued version is kept unchanged and marked as superseded.')) return;
            const { id: _old, created_at: _c, created_by: _cb, updated_at: _u, updated_by: _ub, field_ts: _f, issued_at: _ia, issued_by: _ib, submitted_at: _s, ...rest } = insp as Inspection & Record<string, unknown>;
            void _old; void _c; void _cb; void _u; void _ub; void _f; void _ia; void _ib; void _s;
            const clean = Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('_')));
            const nid = await create('inspections', { ...clean, status: 'draft', revision: insp.revision + 1, supersedes_id: insp.id, signature: {} });
            await save('inspections', insp.id, { status: 'revised' });
            nav(`/inspections/${nid}?step=checklist`);
          }}>Create revision</Button>
        )}
        <LinkButton tone="ghost" to={`/assets/${asset.id}`}>Open asset</LinkButton>
      </div>
    </Card>
  );
}

export default function InspectionWizard() {
  const { id } = useParams();
  if (!id) return <StartForm />;
  return <Wizard id={id} />;
}
