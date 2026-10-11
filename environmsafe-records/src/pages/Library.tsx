import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Empty, Modal, PageHeader, Row, SelectInput, Tabs, TextArea, TextInput, useToast } from '../components/ui';
import { db } from '../lib/db';
import { live, notDeleted, useLibrary } from '../lib/domain';
import { supabase } from '../lib/supabase';
import { create, save } from '../lib/sync';
import type { ChecklistItem, CustomField, DefaultInterval, EquipmentType, InspectionType, RefItem, RefList, ReportTemplate, Standard, TemplateSection, TextBlock } from '../lib/types';
import { DEFAULT_TEMPLATES } from '../reports/defaults';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

function EquipmentForm({ value, onDone }: { value: Partial<EquipmentType>; onDone: () => void }) {
  const { inspectionTypes } = useLibrary();
  const [v, setV] = useState<Partial<EquipmentType>>({ custom_fields: [], default_intervals: [], checklists: {}, active: true, sort: 500, category: '', ...value });
  const fields = v.custom_fields ?? [];
  const ints = v.default_intervals ?? [];
  const setF = (i: number, p: Partial<CustomField>) => setV({ ...v, custom_fields: fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const setI = (i: number, p: Partial<DefaultInterval>) => setV({ ...v, default_intervals: ints.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const patch = { code: v.code?.trim().toUpperCase(), name: v.name, category: v.category, custom_fields: fields.filter((f) => f.label), default_intervals: ints.filter((x) => x.type), active: v.active, sort: v.sort, checklists: v.checklists };
      if (value.id) await save('equipment_types', value.id, patch);
      else await create('equipment_types', patch);
      onDone();
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label="Code" required value={v.code ?? ''} onChange={(e) => setV({ ...v, code: e.target.value })} />
        <TextInput className="sm:col-span-2" label="Name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <TextInput label="Category" value={v.category ?? ''} onChange={(e) => setV({ ...v, category: e.target.value })} />
        <TextInput label="Sort order" type="number" value={v.sort ?? 0} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} />
        <Checkbox label="In use" checked={v.active !== false} onChange={(x) => setV({ ...v, active: x })} />
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 font-bold">Extra fields for this type</legend>
        {fields.map((f, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]">
            <input className="input" placeholder="Label" aria-label="Field label" value={f.label} onChange={(e) => setF(i, { label: e.target.value, key: f.key || slug(e.target.value) })} />
            <select className="input" aria-label="Field type" value={f.type} onChange={(e) => setF(i, { type: e.target.value as CustomField['type'] })}>
              {['text', 'number', 'date', 'select', 'pressure', 'temperature'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="input" placeholder="Unit" aria-label="Unit" value={f.unit ?? ''} onChange={(e) => setF(i, { unit: e.target.value })} />
            <input className="input" placeholder="Choices (comma separated)" aria-label="Choices" value={(f.options ?? []).join(', ')} onChange={(e) => setF(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <Button tone="ghost" icon="x" aria-label="Remove field" onClick={() => setV({ ...v, custom_fields: fields.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button size="sm" tone="secondary" icon="plus" onClick={() => setV({ ...v, custom_fields: [...fields, { key: '', label: '', type: 'text' }] })}>Add field</Button>
      </fieldset>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 font-bold">Default inspection intervals</legend>
        <p className="text-muted mb-2 text-sm">Defaults only – confirm against the current code edition, client requirement and local regulation.</p>
        {ints.map((x, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[2fr_1fr_1.4fr_2fr_auto]">
            <select className="input" aria-label="Inspection type" value={x.type} onChange={(e) => setI(i, { type: e.target.value })}>
              <option value="">Choose</option>
              {inspectionTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
            <input className="input" type="number" aria-label="Months" placeholder="Months" value={x.months} onChange={(e) => setI(i, { months: Number(e.target.value) })} />
            <select className="input" aria-label="Basis" value={x.basis ?? 'calendar'} onChange={(e) => setI(i, { basis: e.target.value as DefaultInterval['basis'] })}>
              <option value="calendar">Fixed interval</option>
              <option value="half_life">Half remaining life (max = months)</option>
            </select>
            <input className="input" placeholder="Note" aria-label="Note" value={x.note ?? ''} onChange={(e) => setI(i, { note: e.target.value })} />
            <Button tone="ghost" icon="x" aria-label="Remove interval" onClick={() => setV({ ...v, default_intervals: ints.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button size="sm" tone="secondary" icon="plus" onClick={() => setV({ ...v, default_intervals: [...ints, { type: '', months: 12, basis: 'calendar' }] })}>Add interval</Button>
      </fieldset>
      <Button type="submit">Save</Button>
    </form>
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (x: ChecklistItem[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={it.id} className="grid grid-cols-[1fr_8rem_auto_auto_auto] gap-2">
          <input className="input" aria-label="Checklist item" value={it.text} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <select className="input" aria-label="Answer type" value={it.kind} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, kind: e.target.value as ChecklistItem['kind'] } : x)))}>
            <option value="ync">Yes / No / N.A.</option><option value="text">Text</option><option value="number">Number</option>
          </select>
          <Button tone="ghost" icon="chevronUp" aria-label="Up" onClick={() => i > 0 && onChange(items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)))} />
          <Button tone="ghost" icon="chevronDown" aria-label="Down" onClick={() => i < items.length - 1 && onChange(items.map((x, j) => (j === i + 1 ? items[i] : j === i ? items[i + 1] : x)))} />
          <Button tone="ghost" icon="x" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button size="sm" tone="secondary" icon="plus" onClick={() => onChange([...items, { id: `c${Date.now().toString(36)}`, text: '', kind: 'ync' }])}>Add item</Button>
    </div>
  );
}

function InspTypeForm({ value, onDone }: { value: Partial<InspectionType>; onDone: () => void }) {
  const [v, setV] = useState<Partial<InspectionType>>({ checklist: [], standards: [], active: true, sort: 500, category: '', ...value });
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const patch = { code: v.code?.trim().toUpperCase(), name: v.name, category: v.category, standards: v.standards, checklist: (v.checklist ?? []).filter((c) => c.text), active: v.active, sort: v.sort };
      if (value.id) await save('inspection_types', value.id, patch);
      else await create('inspection_types', patch);
      onDone();
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label="Code" required value={v.code ?? ''} onChange={(e) => setV({ ...v, code: e.target.value })} disabled={!!value.id} />
        <TextInput className="sm:col-span-2" label="Name" required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <TextInput label="Category" value={v.category ?? ''} onChange={(e) => setV({ ...v, category: e.target.value })} />
        <TextInput className="sm:col-span-2" label="Standards (comma separated)" value={(v.standards ?? []).join(', ')} onChange={(e) => setV({ ...v, standards: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <Checkbox label="In use" checked={v.active !== false} onChange={(x) => setV({ ...v, active: x })} />
      </div>
      <h3 className="font-bold">Checklist</h3>
      <ChecklistEditor items={v.checklist ?? []} onChange={(c) => setV({ ...v, checklist: c })} />
      <Button type="submit">Save</Button>
    </form>
  );
}

function StandardForm({ value, onDone }: { value: Partial<Standard>; onDone: () => void }) {
  const [v, setV] = useState<Partial<Standard>>({ active: true, edition: '', category: '', ...value });
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const patch = { code: v.code, title: v.title, edition: v.edition, category: v.category, active: v.active };
      if (value.id) await save('standards', value.id, patch);
      else await create('standards', patch);
      onDone();
    }}>
      <TextInput label="Code" required value={v.code ?? ''} onChange={(e) => setV({ ...v, code: e.target.value })} />
      <TextInput label="Title" required value={v.title ?? ''} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <TextInput label="Edition in use" value={v.edition ?? ''} onChange={(e) => setV({ ...v, edition: e.target.value })} />
      <TextInput label="Category" value={v.category ?? ''} onChange={(e) => setV({ ...v, category: e.target.value })} />
      <Checkbox label="In use" checked={v.active !== false} onChange={(x) => setV({ ...v, active: x })} />
      <Button type="submit">Save</Button>
    </form>
  );
}

function TextBlockForm({ value, onDone }: { value: Partial<TextBlock>; onDone: () => void }) {
  const [v, setV] = useState<Partial<TextBlock>>({ active: true, category: 'other', ...value });
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      const patch = { key: v.key || slug(v.title ?? ''), category: v.category, title: v.title, body: v.body, active: v.active };
      if (value.id) await save('text_blocks', value.id, patch);
      else await create('text_blocks', patch);
      onDone();
    }}>
      <TextInput label="Title" required value={v.title ?? ''} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <SelectInput label="Category" value={v.category ?? 'other'} onChange={(e) => setV({ ...v, category: e.target.value })} options={['methodology', 'limitations', 'recommendation', 'scope', 'other'].map((c) => ({ value: c, label: c }))} />
      <TextArea label="Wording" required rows={8} value={v.body ?? ''} onChange={(e) => setV({ ...v, body: e.target.value })} hint="Write as 'we', neutral and factual." />
      <Checkbox label="In use" checked={v.active !== false} onChange={(x) => setV({ ...v, active: x })} />
      <Button type="submit">Save</Button>
    </form>
  );
}

function TemplateEditor() {
  const toast = useToast();
  const templates = live(async () => ((await db.report_templates.toArray()) as ReportTemplate[]).filter(notDeleted), [], []) ?? [];
  const blocks = live(async () => ((await db.text_blocks.toArray()) as TextBlock[]).filter(notDeleted), [], []) ?? [];
  const [code, setCode] = useState('inspection');
  const t = templates.find((x) => x.code === code);
  const [draft, setDraft] = useState<TemplateSection[] | null>(null);
  const sections = draft ?? t?.config?.sections ?? DEFAULT_TEMPLATES[code]?.sections ?? [];
  const setS = (i: number, p: Partial<TemplateSection>) => setDraft(sections.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    const n = [...sections];
    [n[i], n[j]] = [n[j], n[i]];
    setDraft(n);
  };
  return (
    <Card title="Report templates">
      <SelectInput label="Template" value={code} onChange={(e) => { setCode(e.target.value); setDraft(null); }} options={Object.entries(DEFAULT_TEMPLATES).map(([k, x]) => ({ value: k, label: x.name }))} />
      <ul className="mt-3 flex flex-col gap-2">
        {sections.map((s, i) => (
          <li key={s.key} className="rounded-xl border border-line p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox label="" checked={s.enabled} onChange={(x) => setS(i, { enabled: x })} />
              <input className="input !min-h-10 flex-1" aria-label="Section title" value={s.title} onChange={(e) => setS(i, { title: e.target.value })} />
              <Button size="sm" tone="ghost" icon="chevronUp" aria-label="Move up" onClick={() => move(i, -1)} />
              <Button size="sm" tone="ghost" icon="chevronDown" aria-label="Move down" onClick={() => move(i, 1)} />
            </div>
            {['scope', 'limitations', 'method', 'summary'].includes(s.key) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <select className="input" aria-label="Standard wording" value={s.text_block ?? ''} onChange={(e) => setS(i, { text_block: e.target.value || undefined })}>
                  <option value="">— standard wording block —</option>
                  {blocks.map((b) => <option key={b.key} value={b.key}>{b.title}</option>)}
                </select>
                <input className="input" placeholder="Or fixed wording for this section" aria-label="Fixed wording" value={s.text ?? ''} onChange={(e) => setS(i, { text: e.target.value })} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button className="mt-3" disabled={!draft} onClick={async () => {
        const config = { ...(t?.config ?? { cover: DEFAULT_TEMPLATES[code].cover }), sections };
        if (t) await save('report_templates', t.id, { config });
        else await create('report_templates', { code, name: DEFAULT_TEMPLATES[code].name, config });
        setDraft(null);
        toast('Template saved');
      }}>Save template</Button>
      <p className="text-muted mt-2 text-sm">Logo and company details are changed in Settings → Company.</p>
    </Card>
  );
}

function RefListsEditor() {
  const toast = useToast();
  const lists = live(async () => (await db.ref_lists.toArray()) as RefList[], [], []) ?? [];
  const [key, setKey] = useState('finding_category');
  const l = lists.find((x) => x.key === key);
  const [items, setItems] = useState<RefItem[] | null>(null);
  const cur = items ?? l?.items ?? [];
  return (
    <Card title="Reference lists">
      <SelectInput label="List" value={key} onChange={(e) => { setKey(e.target.value); setItems(null); }} options={lists.map((x) => ({ value: x.key, label: x.title }))} />
      <div className="mt-3 flex flex-col gap-2">
        {cur.map((it, i) => (
          <div key={i} className="grid grid-cols-[7rem_1fr_2fr_auto] gap-2">
            <input className="input" aria-label="Code" value={it.code} onChange={(e) => setItems(cur.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
            <input className="input" aria-label="Label" value={it.label} onChange={(e) => setItems(cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input" aria-label="Description" value={it.desc ?? ''} onChange={(e) => setItems(cur.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} />
            <Button tone="ghost" icon="x" aria-label="Remove" onClick={() => setItems(cur.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" tone="secondary" icon="plus" onClick={() => setItems([...cur, { code: '', label: '' }])}>Add</Button>
      </div>
      <Button className="mt-3" disabled={!items} onClick={async () => {
        const { error } = await supabase.from('ref_lists').update({ items: cur }).eq('key', key);
        if (error) return toast(navigator.onLine ? error.message : 'Changing lists needs internet.', 'error');
        await db.ref_lists.put({ ...(l as RefList), items: cur });
        setItems(null);
        toast('List saved');
      }}>Save list</Button>
    </Card>
  );
}

export default function Library() {
  const [tab, setTab] = useState('equipment');
  const [edit, setEdit] = useState<{ kind: string; value: Record<string, unknown> } | null>(null);
  const equipment = live(async () => ((await db.equipment_types.toArray()) as EquipmentType[]).filter(notDeleted).sort((a, b) => a.sort - b.sort), [], []) ?? [];
  const types = live(async () => ((await db.inspection_types.toArray()) as InspectionType[]).filter(notDeleted).sort((a, b) => a.sort - b.sort), [], []) ?? [];
  const standards = live(async () => ((await db.standards.toArray()) as Standard[]).filter(notDeleted).sort((a, b) => a.code.localeCompare(b.code)), [], []) ?? [];
  const blocks = live(async () => ((await db.text_blocks.toArray()) as TextBlock[]).filter(notDeleted), [], []) ?? [];
  const close = () => setEdit(null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Library" sub="Equipment types, checklists, standards and wording. Changes apply to everyone." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'equipment', label: 'Equipment types', count: equipment.length }, { key: 'types', label: 'Inspection types & checklists', count: types.length },
        { key: 'standards', label: 'Standards', count: standards.length }, { key: 'blocks', label: 'Text blocks', count: blocks.length },
        { key: 'templates', label: 'Report templates' }, { key: 'lists', label: 'Lists' },
      ]} />
      {tab === 'equipment' && (
        <Card actions={<Button size="sm" icon="plus" onClick={() => setEdit({ kind: 'equipment', value: {} })}>New type</Button>}>
          {equipment.map((e) => <Row key={e.id} title={e.name} sub={`${e.code} · ${e.custom_fields.length} fields · ${e.default_intervals.map((d) => `${d.type} ${d.months} m`).join(', ')}`} right={!e.active ? <Badge>Not in use</Badge> : undefined} onClick={() => setEdit({ kind: 'equipment', value: e as unknown as Record<string, unknown> })} />)}
        </Card>
      )}
      {tab === 'types' && (
        <Card actions={<Button size="sm" icon="plus" onClick={() => setEdit({ kind: 'types', value: {} })}>New inspection type</Button>}>
          {types.map((e) => <Row key={e.id} title={e.name} sub={`${e.code} · ${e.checklist.length} checklist items`} onClick={() => setEdit({ kind: 'types', value: e as unknown as Record<string, unknown> })} />)}
        </Card>
      )}
      {tab === 'standards' && (
        <Card actions={<Button size="sm" icon="plus" onClick={() => setEdit({ kind: 'standards', value: {} })}>New standard</Button>}>
          {standards.length === 0 ? <Empty title="None" /> : standards.map((e) => <Row key={e.id} title={e.code} sub={`${e.title}${e.edition ? ` · ${e.edition}` : ''}`} onClick={() => setEdit({ kind: 'standards', value: e as unknown as Record<string, unknown> })} />)}
        </Card>
      )}
      {tab === 'blocks' && (
        <Card actions={<Button size="sm" icon="plus" onClick={() => setEdit({ kind: 'blocks', value: {} })}>New text block</Button>}>
          {blocks.map((e) => <Row key={e.id} title={e.title} sub={`${e.category} · ${e.body.slice(0, 80)}…`} onClick={() => setEdit({ kind: 'blocks', value: e as unknown as Record<string, unknown> })} />)}
        </Card>
      )}
      {tab === 'templates' && <TemplateEditor />}
      {tab === 'lists' && <RefListsEditor />}
      <Modal open={!!edit} onClose={close} title="Edit" wide>
        {edit?.kind === 'equipment' && <EquipmentForm value={edit.value as Partial<EquipmentType>} onDone={close} />}
        {edit?.kind === 'types' && <InspTypeForm value={edit.value as Partial<InspectionType>} onDone={close} />}
        {edit?.kind === 'standards' && <StandardForm value={edit.value as Partial<Standard>} onDone={close} />}
        {edit?.kind === 'blocks' && <TextBlockForm value={edit.value as Partial<TextBlock>} onDone={close} />}
      </Modal>
    </div>
  );
}
