// Shared lookups, labels and business rules used across screens.

import { useLiveQuery } from 'dexie-react-hooks';
import { addMonths, analyseThickness, dueBucket, halfLifeIntervalMonths, type DueBucket, type PressureUnit } from './calc';
import { db } from './db';
import type {
  Asset, Client, EquipmentType, Finding, FindingStatus, Inspection, InspectionType, Reading, RefItem, Settings, Site,
} from './types';

export const live = <T>(fn: () => Promise<T> | T, deps: unknown[] = [], fallback?: T): T | undefined =>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLiveQuery(fn, deps, fallback);

export const notDeleted = <T extends { deleted_at?: string | null }>(r: T) => !r.deleted_at;

export const FINDING_STATUS: Record<FindingStatus, string> = {
  open: 'Open',
  open_deteriorated: 'Open – deteriorated',
  open_improved: 'Open – improved',
  open_unchanged: 'Open – unchanged',
  closed: 'Closed',
  superseded: 'Superseded',
  deferred: 'Deferred',
};

export const OPEN_STATUSES: FindingStatus[] = ['open', 'open_deteriorated', 'open_improved', 'open_unchanged', 'deferred'];
export const isOpen = (f: Pick<Finding, 'status'>) => OPEN_STATUSES.includes(f.status);

/** Choices offered when updating a previous finding during a new inspection. */
export const CARRY_OVER_CHOICES: { value: FindingStatus; label: string }[] = [
  { value: 'closed', label: 'Closed' },
  { value: 'open_unchanged', label: 'Unchanged' },
  { value: 'open_deteriorated', label: 'Deteriorated' },
  { value: 'open_improved', label: 'Improved' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'deferred', label: 'Deferred (justify)' },
];

export const SEVERITY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const CONCLUSION: Record<string, string> = {
  fit: 'Fit for continued service',
  fit_conditions: 'Fit with conditions',
  not_fit: 'Not fit',
  not_assessed: 'Not assessed',
};
export const ASSET_STATUS: Record<string, string> = {
  in_service: 'In service',
  out_of_service: 'Out of service',
  decommissioned: 'Decommissioned',
};
export const DOC_STATUS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  issued: 'Issued',
  revised: 'Superseded by revision',
};
export const DOC_KINDS: Record<string, string> = {
  photo: 'Photo',
  nameplate: 'Nameplate photo',
  manual: 'Manual',
  drawing: 'Drawing',
  datasheet: 'Data sheet',
  previous_report: 'Previous report',
  certificate: 'Certificate',
  report_output: 'Generated report',
  other: 'Other',
};
export const CERT_KINDS: Record<string, string> = {
  psv: 'PSV test and overhaul certificate',
  hydro: 'Hydrostatic test certificate',
  ut: 'UT thickness record',
  calibration: 'Calibration certificate',
  lifting: 'Thorough examination certificate',
  general: 'Inspection certificate',
};

export function useSettings(): Settings | undefined {
  return live(() => db.settings.get(1) as Promise<Settings | undefined>, []);
}

export function usePressureUnit(): PressureUnit {
  const s = useSettings();
  const local = (typeof localStorage !== 'undefined' && localStorage.getItem('es-pressure-unit')) as PressureUnit | null;
  return (local || (s?.options?.default_pressure_unit as PressureUnit) || 'bar') as PressureUnit;
}

export function useRefList(key: string): RefItem[] {
  return live(async () => ((await db.ref_lists.get(key))?.items as RefItem[]) ?? [], [key], []) ?? [];
}

export function useLibrary() {
  const equipmentTypes = live(async () => ((await db.equipment_types.toArray()) as EquipmentType[]).filter(notDeleted).sort((a, b) => a.sort - b.sort), [], []) ?? [];
  const inspectionTypes = live(async () => ((await db.inspection_types.toArray()) as InspectionType[]).filter(notDeleted).sort((a, b) => a.sort - b.sort), [], []) ?? [];
  return { equipmentTypes, inspectionTypes };
}

export function useClients(): Client[] {
  return live(async () => ((await db.clients.toArray()) as Client[]).filter(notDeleted).sort((a, b) => a.name.localeCompare(b.name)), [], []) ?? [];
}

export function useSites(clientId?: string | null): Site[] {
  return live(async () => (clientId ? ((await db.sites.where('client_id').equals(clientId).toArray()) as Site[]).filter(notDeleted) : []), [clientId], []) ?? [];
}

export function inspTypeName(types: InspectionType[], code: string): string {
  return types.find((t) => t.code === code)?.name ?? code;
}

// ---------------------------------------------------------------------------
// Next due date
// ---------------------------------------------------------------------------
export interface DueProposal {
  months: number | null;
  next_due: string | null;
  basis: string;
}

/** Proposes the interval and next due date for an inspection (editable by the user). */
export function proposeNextDue(
  asset: Asset,
  eqType: EquipmentType | undefined,
  typeCode: string,
  inspectionDate: string,
  readings: Reading[],
): DueProposal {
  const override = asset.intervals?.[typeCode];
  const def = eqType?.default_intervals?.find((d) => d.type === typeCode);
  let months = override ?? def?.months ?? null;
  let basis = override != null ? 'asset interval' : def ? `default for ${eqType?.name}` : 'no default interval';
  if (def?.basis === 'half_life' && override == null) {
    const analysis = analyseThickness(
      readings.filter((r) => r.measured != null).map((r) => ({
        point: r.point, date: r.reading_date, measured: Number(r.measured), retirement: r.retirement,
      })),
    );
    const lives = analysis.map((a) => a.remainingLife).filter((x): x is number => x != null);
    if (lives.length) {
      const minLife = Math.min(...lives);
      const hl = halfLifeIntervalMonths(minLife, def.months);
      if (hl < (months ?? Infinity)) {
        months = hl;
        basis = `half remaining life (${Number.isFinite(minLife) ? minLife.toFixed(1) : '∞'} y)`;
      }
    }
  }
  return { months, next_due: months != null ? addMonths(inspectionDate, months) : null, basis };
}

// ---------------------------------------------------------------------------
// Due board
// ---------------------------------------------------------------------------
export interface DueItem {
  asset: Asset;
  client?: Client;
  typeCode: string;
  lastDate: string | null;
  nextDue: string | null;
  bucket: DueBucket;
  inspectionId: string | null;
}

export async function computeDue(today = new Date()): Promise<DueItem[]> {
  const [assets, inspections, clients, eqTypes] = await Promise.all([
    db.assets.toArray() as Promise<Asset[]>,
    db.inspections.toArray() as Promise<Inspection[]>,
    db.clients.toArray() as Promise<Client[]>,
    db.equipment_types.toArray() as Promise<EquipmentType[]>,
  ]);
  const byAsset = new Map<string, Inspection[]>();
  for (const i of inspections) {
    if (i.deleted_at || i.status === 'draft' || i.status === 'revised') continue;
    const list = byAsset.get(i.asset_id) ?? [];
    list.push(i);
    byAsset.set(i.asset_id, list);
  }
  const items: DueItem[] = [];
  for (const a of assets) {
    if (a.deleted_at || a.status === 'decommissioned') continue;
    const client = clients.find((c) => c.id === a.client_id);
    if (!client || client.deleted_at) continue;
    const latestByType = new Map<string, Inspection>();
    for (const i of (byAsset.get(a.id) ?? []).sort((x, y) => x.inspection_date.localeCompare(y.inspection_date))) {
      latestByType.set(i.type_code, i);
    }
    const eq = eqTypes.find((e) => e.id === a.equipment_type_id);
    const types = new Set<string>([...latestByType.keys(), ...(eq?.default_intervals ?? []).map((d) => d.type), ...Object.keys(a.intervals ?? {})]);
    for (const tc of types) {
      if (tc === 'HIST') continue;
      const last = latestByType.get(tc);
      const nextDue = last?.next_due ?? null;
      items.push({
        asset: a, client, typeCode: tc, lastDate: last?.inspection_date ?? null, nextDue,
        bucket: last ? dueBucket(nextDue, today) : 'none', inspectionId: last?.id ?? null,
      });
    }
  }
  return items.sort((x, y) => (x.nextDue ?? '9999').localeCompare(y.nextDue ?? '9999'));
}

// ---------------------------------------------------------------------------
// Search (on the device, so it works offline)
// ---------------------------------------------------------------------------
export interface SearchHit {
  kind: 'client' | 'asset' | 'finding' | 'inspection' | 'job' | 'document';
  id: string;
  title: string;
  sub: string;
  href: string;
}

export async function searchAll(query: string, limit = 60): Promise<SearchHit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = (...fields: (string | null | undefined)[]) => {
    const hay = fields.filter(Boolean).join(' ').toLowerCase();
    const hayS = squash(hay);
    return terms.every((t) => hay.includes(t) || (squash(t).length > 1 && hayS.includes(squash(t))));
  };
  const hits: SearchHit[] = [];
  const clients = ((await db.clients.toArray()) as Client[]).filter(notDeleted);
  const cName = (id: string) => clients.find((c) => c.id === id)?.name ?? '';
  for (const c of clients) if (match(c.name, c.code, c.notes)) hits.push({ kind: 'client', id: c.id, title: c.name, sub: c.code, href: `/clients/${c.id}` });
  const assets = ((await db.assets.toArray()) as Asset[]).filter(notDeleted);
  for (const a of assets) {
    if (match(a.tag, a.description, a.serial_no, a.manufacturer, a.model, a.service, a.location, a.notes)) {
      hits.push({ kind: 'asset', id: a.id, title: a.tag, sub: `${a.description} · ${cName(a.client_id)}`, href: `/assets/${a.id}` });
    }
  }
  const tagOf = (id: string) => assets.find((a) => a.id === id)?.tag ?? '';
  for (const f of ((await db.findings.toArray()) as Finding[]).filter(notDeleted)) {
    if (match(f.ref, f.title, f.description, f.location, f.recommendation)) {
      hits.push({ kind: 'finding', id: f.id, title: `${f.ref ?? 'New'} ${f.title}`, sub: `${tagOf(f.asset_id)} · ${FINDING_STATUS[f.status]}`, href: `/findings/${f.id}` });
    }
  }
  for (const i of ((await db.inspections.toArray()) as Inspection[]).filter(notDeleted)) {
    if (match(i.report_no, i.summary, i.conclusion_text, i.recommendations, i.inspector_name, i.contractor)) {
      hits.push({ kind: 'inspection', id: i.id, title: `${tagOf(i.asset_id)} – ${i.type_code} ${i.inspection_date}`, sub: i.report_no ?? i.summary.slice(0, 80), href: `/inspections/${i.id}` });
    }
  }
  for (const j of ((await db.jobs.toArray()) as { id: string; number: string; title: string; scope: string; client_id: string; deleted_at?: string }[]).filter(notDeleted)) {
    if (match(j.number, j.title, j.scope)) hits.push({ kind: 'job', id: j.id, title: j.number, sub: `${j.title} · ${cName(j.client_id)}`, href: `/jobs/${j.id}` });
  }
  for (const d of ((await db.documents.toArray()) as { id: string; title: string; caption: string; asset_id: string | null; deleted_at?: string; kind: string }[]).filter(notDeleted)) {
    if (d.kind !== 'report_output' && match(d.title, d.caption)) {
      hits.push({ kind: 'document', id: d.id, title: d.title || d.caption || 'Document', sub: DOC_KINDS[d.kind] ?? d.kind, href: d.asset_id ? `/assets/${d.asset_id}?tab=documents` : '/' });
    }
  }
  return hits.slice(0, limit);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${months[Number(m) - 1]} ${y}`;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
