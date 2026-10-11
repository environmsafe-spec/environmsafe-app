import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PressureInput } from '../components/PressureInput';
import { Badge, Button, Empty, LinkButton, PageHeader, Row, SelectInput, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { nearDuplicateTags } from '../lib/calc';
import { db } from '../lib/db';
import { ASSET_STATUS, live, notDeleted, useClients, useLibrary, useSites } from '../lib/domain';
import { create, save } from '../lib/sync';
import type { Asset, CustomField } from '../lib/types';

function AssetList() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const clients = useClients();
  const { equipmentTypes } = useLibrary();
  const assets = live(async () => ((await db.assets.toArray()) as Asset[]).filter(notDeleted), [], []) ?? [];
  const q = params.get('q') ?? '';
  const client = params.get('client') ?? '';
  const type = params.get('type') ?? '';
  const status = params.get('status') ?? '';
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return assets
      .filter((a) => !client || a.client_id === client)
      .filter((a) => !type || a.equipment_type_id === type)
      .filter((a) => !status || a.status === status)
      .filter((a) => {
        const hay = `${a.tag} ${a.description} ${a.serial_no} ${a.service} ${a.location}`.toLowerCase();
        return terms.every((t) => hay.includes(t) || squash(hay).includes(squash(t)));
      })
      .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  }, [assets, q, client, type, status]);
  const cName = (id: string) => clients.find((c) => c.id === id)?.code ?? '';
  const tName = (id: string | null) => equipmentTypes.find((t) => t.id === id)?.name ?? '';
  return (
    <div>
      <PageHeader title="Assets" sub={`${list.length} of ${assets.length}`} actions={<>
        <LinkButton to="/scan" tone="secondary" icon="qr">Scan</LinkButton>
        {can.office && <LinkButton to={`/assets/new${client ? `?client=${client}` : ''}`} icon="plus">New asset</LinkButton>}
      </>} />
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <input className="input sm:col-span-4" type="search" placeholder="Find a tag, description or serial number" aria-label="Find asset" value={q} onChange={(e) => setParam('q', e.target.value)} />
        <select className="input" aria-label="Client" value={client} onChange={(e) => setParam('client', e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" aria-label="Equipment type" value={type} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">All types</option>
          {equipmentTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input" aria-label="Status" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Any status</option>
          {Object.entries(ASSET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="surface rounded-2xl border border-line px-3">
        {list.length === 0 && <Empty title="No assets match" />}
        {list.slice(0, 300).map((a) => (
          <Row key={a.id} to={`/assets/${a.id}`} title={a.tag} sub={`${cName(a.client_id)} · ${a.description || tName(a.equipment_type_id)}`} right={a.status !== 'in_service' ? <Badge>{ASSET_STATUS[a.status]}</Badge> : undefined} />
        ))}
      </div>
    </div>
  );
}

function CustomFieldInput({ f, value, onChange }: { f: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === 'pressure') return <PressureInput label={f.label} valuePa={value as number | null} onChange={onChange} />;
  if (f.type === 'select') return <SelectInput label={f.label} value={(value as string) ?? ''} placeholder="—" options={(f.options ?? []).map((o) => ({ value: o, label: o }))} onChange={(e) => onChange(e.target.value)} />;
  return (
    <TextInput label={f.label + (f.unit ? ` (${f.unit})` : '')} type={f.type === 'number' || f.type === 'temperature' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any"
      value={(value as string | number) ?? ''} onChange={(e) => onChange(f.type === 'number' || f.type === 'temperature' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />
  );
}

function AssetForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const clients = useClients();
  const { equipmentTypes, inspectionTypes } = useLibrary();
  const existing = live(async () => (id ? ((await db.assets.get(id)) as Asset | undefined) : undefined), [id]);
  const [form, setForm] = useState<Partial<Asset> | null>(null);
  const v: Partial<Asset> = form ?? existing ?? {
    client_id: params.get('client') ?? '', site_id: null, parent_id: params.get('parent') ?? null, tag: '', description: '', manufacturer: '', model: '',
    serial_no: '', year_built: null, design: {}, service: '', location: '', status: 'in_service', criticality: 'medium', custom: {}, intervals: {}, notes: '',
    equipment_type_id: null,
  };
  const set = (p: Partial<Asset>) => setForm({ ...v, ...p });
  const sites = useSites(v.client_id);
  const sameClient = live(async () => (v.client_id ? ((await db.assets.where('client_id').equals(v.client_id).toArray()) as Asset[]).filter(notDeleted) : []), [v.client_id], []) ?? [];
  const dupes = v.tag ? nearDuplicateTags(v.tag, sameClient.filter((a) => a.id !== id).map((a) => a.tag)) : [];
  const exact = sameClient.some((a) => a.id !== id && a.tag.trim().toLowerCase() === (v.tag ?? '').trim().toLowerCase());
  const eq = equipmentTypes.find((t) => t.id === v.equipment_type_id);
  const design = v.design ?? {};
  const setDesign = (k: string, val: unknown) => set({ design: { ...design, [k]: val } });
  if (id && !existing) return null;
  return (
    <div className="max-w-3xl">
      <PageHeader title={id ? `Edit ${existing?.tag}` : 'New asset'} back />
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault();
        if (!v.client_id) return toast('Choose the client', 'error');
        if (exact) return toast('This tag already exists for this client.', 'error');
        const patch = { ...v, tag: (v.tag ?? '').trim() };
        delete (patch as Record<string, unknown>).tag_norm;
        if (id) {
          const changed = Object.fromEntries(Object.entries(patch).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify((existing as unknown as Record<string, unknown>)[k])));
          await save('assets', id, changed);
        }
        const nid = id ?? (await create('assets', patch));
        toast('Asset saved');
        nav(`/assets/${nid}`, { replace: true });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput label="Client" required value={v.client_id ?? ''} placeholder="Choose client" options={clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set({ client_id: e.target.value, site_id: null, parent_id: null })} disabled={!!id} />
          <SelectInput label="Site / plant / area" value={v.site_id ?? ''} placeholder="—" options={sites.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => set({ site_id: e.target.value || null })} />
          <TextInput label="Tag number" required value={v.tag ?? ''} onChange={(e) => set({ tag: e.target.value })}
            hint={id ? 'Changing the tag keeps the old tag in the history.' : 'Type it exactly as on the plant, e.g. PSV-201A or 21-PSV-003-2.'}
            error={exact ? 'This tag already exists for this client.' : dupes.length ? `Looks similar to: ${dupes.join(', ')}. Check it is not the same item.` : null} />
          <SelectInput label="Equipment type" value={v.equipment_type_id ?? ''} placeholder="Choose type" options={equipmentTypes.map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => set({ equipment_type_id: e.target.value || null })} />
          <TextInput className="sm:col-span-2" label="Description" value={v.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
          <SelectInput label="Part of (parent asset)" value={v.parent_id ?? ''} placeholder="— none —" options={sameClient.filter((a) => a.id !== id).map((a) => ({ value: a.id, label: `${a.tag} ${a.description ? `– ${a.description}` : ''}` }))} onChange={(e) => set({ parent_id: e.target.value || null })} hint="For example a PSV fitted on a boiler." />
          <TextInput label="Service" value={v.service ?? ''} onChange={(e) => set({ service: e.target.value })} />
          <TextInput label="Location" value={v.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
          <TextInput label="Manufacturer" value={v.manufacturer ?? ''} onChange={(e) => set({ manufacturer: e.target.value })} />
          <TextInput label="Model" value={v.model ?? ''} onChange={(e) => set({ model: e.target.value })} />
          <TextInput label="Serial number" value={v.serial_no ?? ''} onChange={(e) => set({ serial_no: e.target.value })} />
          <TextInput label="Year built" type="number" min={1850} max={2200} value={v.year_built ?? ''} onChange={(e) => set({ year_built: e.target.value ? Number(e.target.value) : null })} />
          <SelectInput label="Status" value={v.status ?? 'in_service'} options={Object.entries(ASSET_STATUS).map(([k, l]) => ({ value: k, label: l }))} onChange={(e) => set({ status: e.target.value as Asset['status'] })} />
          <SelectInput label="Criticality" value={v.criticality ?? 'medium'} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} onChange={(e) => set({ criticality: e.target.value as Asset['criticality'] })} />
        </div>
        <fieldset className="grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 font-bold">Design data</legend>
          <PressureInput label="Design pressure" valuePa={design.design_pressure_pa as number | null} onChange={(pa) => setDesign('design_pressure_pa', pa)} />
          <PressureInput label="MAWP" valuePa={design.mawp_pa as number | null} onChange={(pa) => setDesign('mawp_pa', pa)} />
          <TextInput label="Design temperature (°C)" type="number" step="any" value={(design.design_temp_c as number | null) ?? ''} onChange={(e) => setDesign('design_temp_c', e.target.value === '' ? null : Number(e.target.value))} />
          <PressureInput label="Test pressure" valuePa={design.test_pressure_pa as number | null} onChange={(pa) => setDesign('test_pressure_pa', pa)} />
          <TextInput label="Capacity" value={(design.capacity as string) ?? ''} onChange={(e) => setDesign('capacity', e.target.value)} />
          <TextInput label="Material" value={(design.material as string) ?? ''} onChange={(e) => setDesign('material', e.target.value)} />
          <TextInput label="Code of construction" value={(design.code as string) ?? ''} onChange={(e) => setDesign('code', e.target.value)} />
        </fieldset>
        {eq && eq.custom_fields.length > 0 && (
          <fieldset className="grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-2">
            <legend className="px-1 font-bold">{eq.name} details</legend>
            {eq.custom_fields.map((f) => (
              <CustomFieldInput key={f.key} f={f} value={(v.custom ?? {})[f.key]} onChange={(val) => set({ custom: { ...(v.custom ?? {}), [f.key]: val } })} />
            ))}
          </fieldset>
        )}
        <fieldset className="rounded-2xl border border-line p-3">
          <legend className="px-1 font-bold">Inspection intervals for this asset</legend>
          <p className="text-muted mb-2 text-sm">Leave blank to use the library default. Defaults must be confirmed against the current code edition, the client requirement and local regulation.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(eq?.default_intervals ?? []).map((d) => (
              <TextInput key={d.type} type="number" min={0} max={240} label={`${inspectionTypes.find((t) => t.code === d.type)?.name ?? d.type} (months)`}
                placeholder={`Default ${d.months}`} hint={d.note} value={(v.intervals ?? {})[d.type] ?? ''}
                onChange={(e) => {
                  const iv = { ...(v.intervals ?? {}) };
                  if (e.target.value === '') delete iv[d.type];
                  else iv[d.type] = Number(e.target.value);
                  set({ intervals: iv });
                }} />
            ))}
            {!eq && <p className="text-muted text-sm">Choose an equipment type first.</p>}
          </div>
        </fieldset>
        <TextArea label="Notes" value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        <Button type="submit" size="lg">Save asset</Button>
      </form>
    </div>
  );
}

export default function Assets({ mode }: { mode?: 'new' | 'edit' }) {
  return mode ? <AssetForm /> : <AssetList />;
}
