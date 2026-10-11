// Builds report models from stored data. Pure functions: no database access,
// so the same code runs in the app and in the document tests.
//
// Wording rules: we write as the inspection team ("we"), neutral and factual,
// state the condition found, never blame a previous contractor, and say when
// the origin of a condition cannot be established from the as-found state.

import {
  analyseThickness, corrosionRate, dueBucket, formatPressure, psvDeviationPct, psvTolerancePa, psvWithinTolerance, remainingLife, yearsBetween,
  type PressureUnit,
} from '../lib/calc';
import type {
  Asset, Certificate, Client, Dpr, EquipmentType, Finding, FindingStatus, FindingUpdate, Inspection, InspectionType, Job, JobItem, Reading,
  RefItem, Site, TemplateSection, TextBlock,
} from '../lib/types';
import { revLabel, type Block, type DocModel, type ImageData } from './model';

export interface Library {
  inspectionTypes: InspectionType[];
  equipmentTypes: EquipmentType[];
  textBlocks: TextBlock[];
  refLists: Record<string, RefItem[]>;
}

export interface Common {
  unit: PressureUnit;
  lib: Library;
  /** Section order / switches and edited text, from the template and the generate screen. */
  sections: TemplateSection[];
  texts: Record<string, string>;
  docNumber: string;
  revision: number;
  date: string;
  preparedBy?: string;
  reviewedBy?: string;
  approvedBy?: string;
  status: string;
}

export interface Photo {
  image: ImageData;
  caption: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function d(s: string | null | undefined): string {
  if (!s) return '—';
  const [y, m, day] = s.slice(0, 10).split('-');
  return `${String(Number(day)).padStart(2, '0')} ${MONTHS[Number(m) - 1]} ${y}`;
}

const STATUS: Record<FindingStatus, string> = {
  open: 'Open', open_deteriorated: 'Open – deteriorated', open_improved: 'Open – improved', open_unchanged: 'Open – unchanged',
  closed: 'Closed', superseded: 'Superseded', deferred: 'Deferred',
};
const SEV: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const CONC: Record<string, string> = { fit: 'Fit for continued service', fit_conditions: 'Fit for continued service with conditions', not_fit: 'Not fit for continued service', not_assessed: 'Not assessed' };

function typeName(lib: Library, code: string): string {
  return lib.inspectionTypes.find((t) => t.code === code)?.name ?? code;
}

function block(lib: Library, key: string | undefined): string {
  if (!key) return '';
  return lib.textBlocks.find((b) => b.key === key && b.active !== false)?.body ?? '';
}

function sectionText(c: Common, key: string, fallback: string): string {
  if (c.texts[key] != null && c.texts[key] !== '') return c.texts[key];
  const s = c.sections.find((x) => x.key === key);
  return s?.text || block(c.lib, s?.text_block) || fallback;
}

function enabled(c: Common): TemplateSection[] {
  return c.sections.filter((s) => s.enabled);
}

function priorityNote(lib: Library): string {
  const p = lib.refLists.priority ?? [];
  return p.map((x) => `${x.code}: ${x.desc}`).join('   ');
}

function designRows(asset: Asset, eq: EquipmentType | undefined, unit: PressureUnit, site?: Site): [string, string][] {
  const ds = asset.design ?? {};
  const rows: [string, string][] = [
    ['Tag number', asset.tag], ['Description', asset.description], ['Equipment type', eq?.name ?? ''], ['Site / location', [site?.name, asset.location].filter(Boolean).join(' – ')],
    ['Manufacturer', asset.manufacturer], ['Model', asset.model], ['Serial number', asset.serial_no], ['Year built', asset.year_built ? String(asset.year_built) : ''],
    ['Service', asset.service], ['Code of construction', String(ds.code ?? '')], ['Material', String(ds.material ?? '')], ['Capacity', String(ds.capacity ?? '')],
    ['Design pressure', formatPressure(ds.design_pressure_pa as number, unit)], ['MAWP', formatPressure(ds.mawp_pa as number, unit)],
    ['Design temperature', ds.design_temp_c != null ? `${ds.design_temp_c} °C` : ''], ['Test pressure', formatPressure(ds.test_pressure_pa as number, unit)],
  ];
  for (const f of eq?.custom_fields ?? []) {
    const v = asset.custom?.[f.key];
    if (v == null || v === '') continue;
    rows.push([f.label, f.type === 'pressure' ? formatPressure(v as number, unit) : String(v)]);
  }
  return rows.filter(([, v]) => v && v !== '—');
}

function docControl(c: Common, history: { rev: number; date: string; text: string }[]): Block[] {
  const rows = history.length ? history : [{ rev: c.revision, date: c.date, text: c.revision === 0 ? 'First issue' : 'Revised' }];
  return [
    { t: 'table', head: ['Rev.', 'Date', 'Description', 'Prepared', 'Reviewed', 'Approved'], widths: [0.6, 1.1, 2.4, 1.3, 1.3, 1.3],
      rows: rows.map((h) => [String(h.rev).padStart(2, '0'), d(h.date), h.text, c.preparedBy ?? '', c.reviewedBy ?? '', c.approvedBy ?? '']) },
  ];
}

function photoBlock(photos: Photo[], start = 1): Block {
  return { t: 'photos', items: photos.map((p, i) => ({ image: p.image, caption: p.caption, figure: start + i })) };
}

function utRows(readings: Reading[], inspId: string | null, until: string) {
  const ut = readings.filter((r) => r.kind === 'ut' && r.measured != null && r.reading_date <= until);
  const current = inspId ? ut.filter((r) => r.inspection_id === inspId) : [];
  const analysis = analyseThickness(ut.map((r) => ({ point: r.point, date: r.reading_date, measured: Number(r.measured), nominal: r.nominal, retirement: r.retirement })));
  return analysis
    .filter((a) => !inspId || current.some((r) => r.point === a.point))
    .map((a) => {
      const cur = current.find((r) => r.point === a.point);
      const loc = cur?.location || ut.find((r) => r.point === a.point && r.location)?.location || '';
      const prev = a.readings.length >= 2 ? a.readings[a.readings.length - 2] : null;
      const rate = prev ? corrosionRate(prev.measured, a.latest.measured, yearsBetween(prev.date, a.latest.date)) : null;
      const rl = a.retirement != null && a.governingRate != null ? remainingLife(a.latest.measured, Number(a.retirement), a.governingRate) : null;
      return [
        a.point, loc, a.readings[0].nominal != null ? String(a.readings[0].nominal) : (cur?.nominal != null ? String(cur.nominal) : '—'),
        a.retirement != null ? String(a.retirement) : '—', prev ? `${prev.measured} (${prev.date.slice(0, 4)})` : '—', String(a.latest.measured),
        rate != null ? rate.toFixed(3) : '—', a.longTermRate != null ? a.longTermRate.toFixed(3) : '—',
        rl == null ? '—' : Number.isFinite(rl) ? rl.toFixed(1) : 'No loss',
      ];
    });
}
const UT_HEAD = ['Point', 'Location', 'Nominal (mm)', 't-min (mm)', 'Previous (mm)', 'Measured (mm)', 'ST rate (mm/y)', 'LT rate (mm/y)', 'Rem. life (y)'];
const UT_W = [0.8, 1.6, 0.9, 0.9, 1.1, 1, 0.9, 0.9, 0.9];

// ---------------------------------------------------------------------------
// Inspection report
// ---------------------------------------------------------------------------
export interface InspectionBundle {
  insp: Inspection;
  asset: Asset;
  eqType?: EquipmentType;
  client: Client;
  site?: Site;
  job?: Job;
  previous: { finding: Finding; update?: FindingUpdate; before: FindingStatus }[];
  newFindings: Finding[];
  readings: Reading[];
  photos: Photo[];
  certificates: Certificate[];
  history: { rev: number; date: string; text: string }[];
  inspectorSignature?: ImageData | null;
  checklist: { id: string; text: string; kind: string }[];
}

export function buildInspectionReport(b: InspectionBundle, c: Common): DocModel {
  const { insp, asset, client, site } = b;
  const tName = typeName(c.lib, insp.type_code);
  const blocks: Block[] = [];
  const figStart = 1;
  for (const s of enabled(c)) {
    switch (s.key) {
      case 'document_control':
        blocks.push({ t: 'heading', text: s.title }, ...docControl(c, b.history));
        break;
      case 'contents':
        blocks.push({ t: 'contents' });
        break;
      case 'scope':
        blocks.push({ t: 'heading', text: s.title },
          { t: 'p', text: sectionText(c, 'scope', '') },
          { t: 'p', text: `This report records the ${tName.toLowerCase()} of ${asset.tag}${asset.description ? ` (${asset.description})` : ''}${site ? ` at ${site.name}` : ''}, which we carried out on ${d(insp.inspection_date)}${insp.standard ? ` with reference to ${insp.standard}${insp.code_edition ? ` (${insp.code_edition} edition)` : ''}` : ''}.${insp.witness ? ` The inspection was witnessed by ${insp.witness}.` : ''}` });
        break;
      case 'equipment':
        blocks.push({ t: 'heading', text: s.title }, { t: 'kv', cols: 2, rows: designRows(asset, b.eqType, c.unit, site) });
        break;
      case 'method': {
        const key = insp.type_code === 'UT' ? 'method_ut' : insp.type_code === 'PSV' ? 'method_psv' : insp.type_code === 'HYDRO' ? 'method_hydro' : 'method_visual';
        blocks.push({ t: 'heading', text: s.title }, { t: 'p', text: sectionText(c, 'method', block(c.lib, key)) });
        const answered = b.checklist.filter((it) => insp.checklist?.[it.id]?.answer);
        if (answered.length) {
          blocks.push({ t: 'heading', text: 'Checklist', level: 2 }, {
            t: 'table', head: ['No.', 'Item', 'Result', 'Note'], widths: [0.5, 4, 1, 2.5],
            rows: answered.map((it, i) => {
              const a = insp.checklist[it.id];
              return [String(i + 1), it.text, a.answer === 'yes' ? 'Yes' : a.answer === 'no' ? 'No' : a.answer === 'na' ? 'N/A' : String(a.answer ?? ''), a.note ?? ''];
            }),
          });
        }
        break;
      }
      case 'results': {
        blocks.push({ t: 'heading', text: s.title });
        blocks.push({ t: 'p', text: sectionText(c, 'results', insp.summary || 'We recorded the conditions found in the sections below.') });
        const psv = insp.results?.psv;
        if (psv && (psv.set_pressure_pa || psv.as_found_pa)) {
          const set = psv.set_pressure_pa ?? null;
          const tol = set ? psvTolerancePa(set, psv.code) : null;
          const res = (pa?: number | null) => (set && pa ? `${psvWithinTolerance(set, pa, psv.code) ? 'Within' : 'Outside'} tolerance (${psvDeviationPct(set, pa).toFixed(1)} %)` : '');
          blocks.push({ t: 'heading', text: 'Safety valve test', level: 2 }, {
            t: 'kv', cols: 2, rows: [
              ['Set pressure', formatPressure(set, c.unit)], ['Tolerance', tol ? `± ${formatPressure(tol, c.unit)} (${psv.code ?? 'ASME VIII'})` : ''],
              ['CDTP', formatPressure(psv.cdtp_pa, c.unit)], ['Test medium', psv.test_medium ?? ''],
              ['As-found pop pressure', formatPressure(psv.as_found_pa, c.unit)], ['As-found result', res(psv.as_found_pa)],
              ['As-left set pressure', formatPressure(psv.as_left_pa, c.unit)], ['As-left result', res(psv.as_left_pa)],
              ['Reseat pressure', formatPressure(psv.reseat_pa, c.unit)], ['Seat tightness (API 527)', psv.seat_tightness === 'pass' ? 'Pass' : psv.seat_tightness === 'fail' ? 'Fail' : ''],
              ['Test bench', psv.bench ?? ''], ['Test gauge', psv.gauge ?? ''],
            ],
          });
          const parts = (psv.parts ?? []).filter((p) => p.condition || p.action);
          if (parts.length) blocks.push({ t: 'table', head: ['Part', 'Condition found', 'Action taken'], widths: [1, 2, 2], rows: parts.map((p) => [p.part, p.condition, p.action]) });
        }
        const pt = insp.results?.pressure;
        if (pt && (pt.test_pressure_pa || pt.result)) {
          blocks.push({ t: 'heading', text: 'Pressure test', level: 2 }, {
            t: 'kv', cols: 2, rows: [
              ['Design pressure', formatPressure(pt.design_pressure_pa, c.unit)], ['Test pressure', formatPressure(pt.test_pressure_pa, c.unit)],
              ['Test medium', pt.test_medium ?? ''], ['Water temperature', pt.water_temp_c != null ? `${pt.water_temp_c} °C` : ''],
              ['Hold time', pt.hold_minutes != null ? `${pt.hold_minutes} min` : ''], ['Pressure drop', formatPressure(pt.pressure_drop_pa, c.unit) || 'None recorded'],
              ['Gauges', pt.gauges ?? ''], ['Result', pt.result === 'pass' ? 'Pass – no leaks or permanent deformation observed' : pt.result === 'fail' ? 'Fail' : ''],
            ],
          });
        }
        break;
      }
      case 'readings': {
        const rows = utRows(b.readings, insp.id, insp.inspection_date);
        if (rows.length) {
          blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: UT_HEAD, widths: UT_W, rows, fontSize: 8 },
            { t: 'p', size: 8, italic: true, text: 'ST = short-term rate (last two readings); LT = long-term rate (first and last readings). Remaining life uses the higher of the two rates.' });
        }
        break;
      }
      case 'previous_findings':
        if (b.previous.length) {
          blocks.push({ t: 'heading', text: s.title }, {
            t: 'table', head: ['Ref.', 'Finding', 'Raised', 'Previous status', 'Status now', 'Our note'], widths: [0.7, 2.6, 1, 1.2, 1.2, 2.6],
            rows: b.previous.map(({ finding: f, update: u, before }) => [f.ref ?? '', f.title, d(f.raised_date), STATUS[before], u ? STATUS[u.status] : STATUS[f.status], u?.note ?? '']),
          });
        }
        break;
      case 'findings':
        blocks.push({ t: 'heading', text: s.title });
        if (b.newFindings.length) {
          blocks.push({
            t: 'table', head: ['Ref.', 'Finding and location', 'Severity', 'Priority', 'Recommendation', 'Due'], widths: [0.7, 3, 0.9, 0.8, 3, 1],
            rows: b.newFindings.map((f) => [f.ref ?? '', `${f.title}${f.location ? ` – ${f.location}` : ''}${f.description ? `\n${f.description}` : ''}`, SEV[f.severity], f.priority, f.recommendation, d(f.due_date)]),
          }, { t: 'p', size: 8, italic: true, text: priorityNote(c.lib) });
        } else {
          blocks.push({ t: 'p', text: 'We recorded no new findings during this inspection.' });
        }
        break;
      case 'recommendations': {
        const text = sectionText(c, 'recommendations', insp.recommendations);
        const recs = b.newFindings.filter((f) => f.recommendation).map((f) => `${f.ref ?? ''} (${f.priority}): ${f.recommendation}`);
        if (text || recs.length) {
          blocks.push({ t: 'heading', text: s.title });
          if (text) blocks.push({ t: 'p', text });
          if (recs.length) blocks.push({ t: 'bullets', items: recs });
        }
        break;
      }
      case 'conclusion':
        blocks.push({ t: 'heading', text: s.title },
          { t: 'statement', text: CONC[insp.conclusion] ?? '' },
          { t: 'p', text: sectionText(c, 'conclusion', insp.conclusion_text || (c.lib.refLists.conclusion ?? []).find((x) => x.code === insp.conclusion)?.desc || '') },
          { t: 'kv', rows: [['Next inspection due', d(insp.next_due)], ['Interval', insp.interval_months != null ? `${insp.interval_months} months` : '—']] });
        break;
      case 'limitations':
        blocks.push({ t: 'heading', text: s.title }, { t: 'p', text: [insp.limitations, sectionText(c, 'limitations', '')].filter(Boolean).join('\n\n') || 'None.' });
        break;
      case 'certificates':
        if (b.certificates.length) {
          blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Certificate', 'Type', 'Issued', 'Issued by'], widths: [1.5, 2.5, 1, 2],
            rows: b.certificates.map((x) => [x.number ?? '—', x.kind.toUpperCase(), d(x.issued_at), x.issued_by_name]) });
        }
        break;
      case 'signatures':
        blocks.push({ t: 'heading', text: s.title }, {
          t: 'signatures', items: [
            { role: 'Inspected by', name: insp.signature?.name || insp.inspector_name, title: insp.signature?.title, cert: insp.signature?.cert_no, date: d(insp.signature?.signed_at ?? insp.inspection_date), image: b.inspectorSignature ?? null },
            { role: 'Reviewed and issued by', name: c.reviewedBy ?? '', date: insp.issued_at ? d(insp.issued_at) : '' },
          ],
        });
        break;
      case 'photos':
        if (b.photos.length) blocks.push({ t: 'pagebreak' }, { t: 'heading', text: s.title }, photoBlock(b.photos, figStart));
        break;
    }
  }
  return {
    title: 'INSPECTION REPORT',
    headerLine: `${client.name} · ${asset.tag} · ${c.docNumber}`,
    docNumber: c.docNumber,
    revision: c.revision,
    clientName: client.name,
    cover: {
      title: 'Inspection Report',
      subtitle: `${tName} – ${asset.tag}${asset.description ? ` ${asset.description}` : ''}`,
      client: client.name,
      site: site?.name,
      control: [['Document number', c.docNumber], ['Revision', revLabel(c.revision)], ['Date', d(c.date)], ['Status', c.status],
        ['Inspection date', d(insp.inspection_date)], ['Prepared by', c.preparedBy ?? insp.inspector_name], ['Reviewed by', c.reviewedBy ?? ''], ['Approved by', c.approvedBy ?? '']],
    },
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Daily progress report
// ---------------------------------------------------------------------------
export interface DprBundle {
  dpr: Dpr;
  job: Job;
  client: Client;
  site?: Site;
  holds: JobItem[];
  photos: Photo[];
  dayNumber: number;
}

export function buildDpr(b: DprBundle, c: Common): DocModel {
  const { dpr, job, client } = b;
  const blocks: Block[] = [];
  for (const s of enabled(c)) {
    switch (s.key) {
      case 'dpr_header':
        blocks.push({ t: 'kv', cols: 2, rows: [['Client', client.name], ['Contract / PO', job.number], ['Project', job.title], ['Site', b.site?.name ?? ''],
          ['Report number', c.docNumber], ['Date', d(dpr.report_date)], ['Day', String(b.dayNumber)], ['Hours worked', dpr.hours_worked != null ? String(dpr.hours_worked) : '']] });
        break;
      case 'manpower':
        blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Role', 'Number'], widths: [4, 1], rows: [...(dpr.manpower ?? []).map((m) => [m.role, String(m.count)]), ['Total', String((dpr.manpower ?? []).reduce((a, m) => a + (Number(m.count) || 0), 0))]] });
        if (dpr.toolbox_talks) blocks.push({ t: 'p', text: `Toolbox talk: ${dpr.toolbox_talks}` });
        break;
      case 'hse':
        blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Lost time injuries', 'First aid cases', 'Near misses'], rows: [[String(dpr.hse?.lti ?? 0), String(dpr.hse?.first_aid ?? 0), String(dpr.hse?.near_miss ?? 0)]] });
        break;
      case 'activities':
        blocks.push({ t: 'heading', text: s.title });
        blocks.push((dpr.activities ?? []).length ? { t: 'table', head: ['No.', 'Discipline', 'Activity completed'], widths: [0.5, 1.5, 6], rows: dpr.activities.map((a, i) => [String(i + 1), a.discipline, a.description]) } : { t: 'p', text: 'No activities recorded.' });
        break;
      case 'progress':
        blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Planned (%)', 'Actual (%)', 'Variance (%)'], rows: [[String(dpr.progress_planned ?? '—'), String(dpr.progress_actual ?? '—'), dpr.progress_planned != null && dpr.progress_actual != null ? String(dpr.progress_actual - dpr.progress_planned) : '—']] });
        break;
      case 'holds': {
        const open = b.holds.filter((h) => h.status === 'open' || h.raised_date === dpr.report_date || h.closed_date === dpr.report_date);
        blocks.push({ t: 'heading', text: s.title });
        if (open.length) blocks.push({ t: 'table', head: ['Ref.', 'Type', 'Description', 'Raised', 'Status'], widths: [0.7, 1, 4, 1, 1], rows: open.map((h) => [h.ref_no, h.kind === 'hold' ? 'Hold' : 'Observation', h.title + (h.description ? ` – ${h.description}` : ''), d(h.raised_date), h.status === 'open' ? 'Open' : `Closed ${d(h.closed_date)}`]) });
        if (dpr.observations) blocks.push({ t: 'p', text: dpr.observations });
        if (!open.length && !dpr.observations) blocks.push({ t: 'p', text: 'None.' });
        break;
      }
      case 'planned':
        blocks.push({ t: 'heading', text: s.title }, dpr.planned_next ? { t: 'bullets', items: dpr.planned_next.split('\n').map((x) => x.replace(/^[-•]\s*/, '')).filter(Boolean) } : { t: 'p', text: '—' });
        break;
      case 'issues':
        blocks.push({ t: 'heading', text: s.title }, { t: 'p', text: dpr.issues || 'None.' });
        break;
      case 'photos':
        if (b.photos.length) blocks.push({ t: 'heading', text: s.title }, photoBlock(b.photos));
        break;
    }
  }
  blocks.push({ t: 'signatures', items: [{ role: 'Prepared by', name: c.preparedBy ?? '', date: d(dpr.report_date) }, { role: 'Client representative', name: '' }] });
  return { title: 'DAILY PROGRESS REPORT', headerLine: `${client.name} · ${job.number} · ${c.docNumber}`, docNumber: c.docNumber, revision: c.revision, clientName: client.name, blocks };
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------
export interface CertBundle {
  cert: Certificate;
  asset: Asset;
  eqType?: EquipmentType;
  client: Client;
  site?: Site;
  insp?: Inspection;
  findings: Finding[];
  readings: Reading[];
  inspectorSignature?: ImageData | null;
}

const CERT_TITLE: Record<string, string> = {
  psv: 'PSV TEST AND OVERHAUL CERTIFICATE', hydro: 'HYDROSTATIC TEST CERTIFICATE', ut: 'ULTRASONIC THICKNESS RECORD',
  calibration: 'CALIBRATION CERTIFICATE', lifting: 'CERTIFICATE OF THOROUGH EXAMINATION', general: 'INSPECTION CERTIFICATE',
};

export function buildCertificate(b: CertBundle, c: Common): DocModel {
  const { cert, asset, client, insp } = b;
  const data = cert.data ?? {};
  const blocks: Block[] = [];
  blocks.push({ t: 'kv', cols: 2, rows: [['Certificate number', c.docNumber], ['Revision', revLabel(c.revision)], ['Client', client.name], ['Site', b.site?.name ?? ''],
    ['Tag number', asset.tag], ['Description', asset.description], ['Manufacturer', asset.manufacturer], ['Model', asset.model], ['Serial number', asset.serial_no], ['Date of test', d(insp?.inspection_date)]] });

  if (cert.kind === 'psv') {
    const p = insp?.results?.psv ?? {};
    const set = p.set_pressure_pa ?? (asset.custom?.set_pressure as number | undefined) ?? null;
    const tol = set ? psvTolerancePa(set, p.code) : null;
    const res = (pa?: number | null) => (set && pa ? (psvWithinTolerance(set, pa, p.code) ? 'Within tolerance' : 'Outside tolerance') : '—');
    blocks.push({ t: 'heading', text: 'Valve data' }, { t: 'kv', cols: 2, rows: [
      ['Valve type', String(asset.custom?.valve_type ?? '')], ['Protected equipment', String(asset.custom?.protected_item ?? '')],
      ['Inlet size', String(asset.custom?.inlet_size ?? '')], ['Outlet size', String(asset.custom?.outlet_size ?? '')],
      ['Orifice', String(asset.custom?.orifice ?? '')], ['Service', asset.service],
    ] });
    blocks.push({ t: 'heading', text: 'Test results' }, { t: 'table', head: ['Parameter', 'Value', 'Result'], widths: [2, 2, 2], rows: [
      ['Set pressure', formatPressure(set, c.unit), ''],
      ['Tolerance', tol ? `± ${formatPressure(tol, c.unit)}` : '—', p.code ?? 'ASME VIII'],
      ['Cold differential test pressure', formatPressure(p.cdtp_pa, c.unit) || '—', ''],
      ['As-found pop pressure', formatPressure(p.as_found_pa, c.unit) || '—', res(p.as_found_pa)],
      ['As-left set pressure', formatPressure(p.as_left_pa, c.unit) || '—', res(p.as_left_pa)],
      ['Reseat pressure', formatPressure(p.reseat_pa, c.unit) || '—', ''],
      ['Seat tightness (API 527)', '', p.seat_tightness === 'pass' ? 'Pass' : p.seat_tightness === 'fail' ? 'Fail' : '—'],
      ['Test medium', p.test_medium ?? '—', ''], ['Test bench / gauge', [p.bench, p.gauge].filter(Boolean).join(' / ') || '—', ''],
    ] });
    const parts = (p.parts ?? []).filter((x) => x.condition || x.action);
    if (parts.length) blocks.push({ t: 'heading', text: 'Parts condition' }, { t: 'table', head: ['Part', 'Condition found', 'Action taken'], widths: [1, 2, 2], rows: parts.map((x) => [x.part, x.condition, x.action]) });
    if (b.findings.length) blocks.push({ t: 'heading', text: 'Findings' }, { t: 'table', head: ['Ref.', 'Finding', 'Priority', 'Recommendation'], widths: [0.7, 3, 0.8, 3], rows: b.findings.map((f) => [f.ref ?? '', f.title, f.priority, f.recommendation]) });
    blocks.push({ t: 'statement', text: p.result === 'pass'
      ? `Final result: ACCEPTED. We certify that the valve was tested and set at ${formatPressure(p.as_left_pa ?? set, c.unit)}, found within the required tolerance, and sealed.`
      : p.result === 'fail' ? 'Final result: REJECTED. The valve did not meet the test requirements and shall not be returned to service until repaired or replaced and re-tested.'
      : 'Final result: not recorded.' });
  } else if (cert.kind === 'hydro') {
    const p = insp?.results?.pressure ?? {};
    blocks.push({ t: 'heading', text: 'Test data' }, { t: 'kv', cols: 2, rows: [
      ['Design pressure', formatPressure(p.design_pressure_pa ?? (asset.design?.design_pressure_pa as number), c.unit)], ['Test pressure', formatPressure(p.test_pressure_pa ?? (asset.design?.test_pressure_pa as number), c.unit)],
      ['Test medium', p.test_medium ?? ''], ['Water temperature', p.water_temp_c != null ? `${p.water_temp_c} °C` : ''],
      ['Hold time', p.hold_minutes != null ? `${p.hold_minutes} minutes` : ''], ['Start / end', [p.start_time, p.end_time].filter(Boolean).join(' – ')],
      ['Pressure drop', formatPressure(p.pressure_drop_pa, c.unit) || 'None recorded'], ['Gauges', p.gauges ?? ''],
    ] });
    blocks.push({ t: 'statement', text: p.result === 'pass'
      ? `We certify that the item described above was hydrostatically tested at ${formatPressure(p.test_pressure_pa, c.unit)} and held for ${p.hold_minutes ?? '—'} minutes with no leaks or permanent deformation observed.`
      : p.result === 'fail' ? 'The item did not pass the hydrostatic test. See the findings in the inspection report.' : 'Result not recorded.' });
  } else if (cert.kind === 'ut') {
    blocks.push({ t: 'heading', text: 'Thickness readings' }, { t: 'table', head: UT_HEAD, widths: UT_W, rows: utRows(b.readings, insp?.id ?? null, insp?.inspection_date ?? '9999'), fontSize: 8 });
  } else if (cert.kind === 'calibration') {
    const pts = String(data.points ?? '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => x.split('=').map((y) => y.trim()));
    blocks.push({ t: 'heading', text: 'Instrument' }, { t: 'kv', cols: 2, rows: [['Instrument', String(data.instrument ?? '')], ['Range', String(data.range ?? '')], ['Reference standard', String(data.reference ?? '')], ['Calibration date', d(insp?.inspection_date)]] });
    if (pts.length) blocks.push({ t: 'heading', text: 'Results' }, { t: 'table', head: ['Applied (reference)', 'Reading', 'Error'], rows: pts.map(([a, r]) => [a, r ?? '', a && r && !Number.isNaN(Number(a)) && !Number.isNaN(Number(r)) ? (Number(r) - Number(a)).toFixed(3) : '']) });
  } else {
    blocks.push({ t: 'heading', text: 'Result' }, { t: 'statement', text: insp ? CONC[insp.conclusion] : '' }, { t: 'p', text: insp?.conclusion_text ?? '' });
  }
  if (data.remarks) blocks.push({ t: 'heading', text: 'Remarks' }, { t: 'p', text: String(data.remarks) });
  blocks.push({ t: 'kv', rows: [['Valid until / next test due', d((data.valid_until as string) ?? insp?.next_due)]] });
  blocks.push({ t: 'signatures', items: [
    { role: 'Tested / examined by', name: insp?.signature?.name || insp?.inspector_name || '', title: insp?.signature?.title, cert: insp?.signature?.cert_no, date: d(insp?.inspection_date), image: b.inspectorSignature ?? null },
    { role: 'Witnessed by', name: String(data.witness ?? insp?.witness ?? '') },
    { role: 'Issued by', name: cert.issued_by_name, cert: cert.issued_by_cert, date: cert.issued_at ? d(cert.issued_at) : '' },
  ] });
  return { title: CERT_TITLE[cert.kind] ?? 'CERTIFICATE', headerLine: `${client.name} · ${asset.tag} · ${c.docNumber}`, docNumber: c.docNumber, revision: c.revision, clientName: client.name, blocks };
}

// ---------------------------------------------------------------------------
// Register-style reports: findings follow-up, due register, final, custom
// ---------------------------------------------------------------------------
export interface RegisterBundle {
  client: Client;
  job?: Job;
  site?: Site;
  assets: Asset[];
  inspections: Inspection[];
  findings: Finding[];
  updates: FindingUpdate[];
  readings: Reading[];
  dprs: Dpr[];
  holds: JobItem[];
  certificates: Certificate[];
  photos: Photo[];
  due: { asset: Asset; typeCode: string; lastDate: string | null; nextDue: string | null }[];
  from?: string;
  to?: string;
  today: string;
}

function findingsTable(r: RegisterBundle, list: Finding[]): Block {
  const tag = (id: string) => r.assets.find((a) => a.id === id)?.tag ?? '';
  return {
    t: 'table', head: ['Asset', 'Ref.', 'Finding', 'Pri.', 'Raised', 'Status', 'Latest note', 'Due'], widths: [1.1, 0.6, 2.6, 0.5, 0.9, 1.1, 2.4, 0.9], fontSize: 8,
    rows: list.map((f) => {
      const last = r.updates.filter((u) => u.finding_id === f.id).sort((a, b) => a.update_date.localeCompare(b.update_date)).pop();
      return [tag(f.asset_id), f.ref ?? '', f.title, f.priority, d(f.raised_date), STATUS[f.status], last ? `${d(last.update_date)}: ${last.note}` : '', d(f.due_date)];
    }),
  };
}

function dueTable(r: RegisterBundle, lib: Library): Block {
  const label = (n: string | null) => {
    const b = dueBucket(n, r.today);
    return b === 'overdue' ? 'OVERDUE' : b === 'd30' ? 'Due ≤ 30 days' : b === 'd60' ? 'Due ≤ 60 days' : b === 'd90' ? 'Due ≤ 90 days' : b === 'none' ? 'No date' : 'Scheduled';
  };
  return {
    t: 'table', head: ['Tag', 'Description', 'Inspection', 'Last done', 'Next due', 'Status'], widths: [1.2, 2.4, 2, 1, 1, 1.2], fontSize: 8,
    rows: r.due.map((x) => [x.asset.tag, x.asset.description, typeName(lib, x.typeCode), d(x.lastDate), d(x.nextDue), label(x.nextDue)]),
  };
}

export function buildRegisterReport(template: string, r: RegisterBundle, c: Common): DocModel {
  const blocks: Block[] = [];
  const open = r.findings.filter((f) => !['closed', 'superseded'].includes(f.status));
  const tag = (id: string) => r.assets.find((a) => a.id === id)?.tag ?? '';
  const titles: Record<string, string> = { followup: 'FINDINGS FOLLOW-UP REPORT', due_register: 'INSPECTION DUE REGISTER', final: 'FINAL REPORT', custom: 'INSPECTION REPORT' };
  for (const s of enabled(c)) {
    switch (s.key) {
      case 'document_control':
        blocks.push({ t: 'heading', text: s.title }, ...docControl(c, []));
        break;
      case 'contents':
        blocks.push({ t: 'contents' });
        break;
      case 'summary': {
        const closed = r.findings.filter((f) => f.status === 'closed').length;
        blocks.push({ t: 'heading', text: s.title }, { t: 'p', text: sectionText(c, 'summary',
          `We carried out ${r.inspections.length} inspection${r.inspections.length === 1 ? '' : 's'} on ${new Set(r.inspections.map((i) => i.asset_id)).size} item${r.assets.length === 1 ? '' : 's'}${r.job ? ` under ${r.job.number}` : ''}${r.from ? ` between ${d(r.from)} and ${d(r.to)}` : ''}. ` +
          `${open.length} finding${open.length === 1 ? ' remains' : 's remain'} open (${open.filter((f) => f.priority === 'P1').length} at priority P1) and ${closed} ${closed === 1 ? 'was' : 'were'} closed. ` +
          `${r.certificates.filter((x) => x.status === 'issued').length} certificate(s) were issued.`) });
        break;
      }
      case 'scope':
        blocks.push({ t: 'heading', text: s.title }, { t: 'p', text: sectionText(c, 'scope', '') });
        if (r.job?.scope) blocks.push({ t: 'p', text: r.job.scope });
        break;
      case 'equipment_register':
        blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Tag', 'Description', 'Service', 'Location', 'Status'], widths: [1.2, 3, 1.5, 1.5, 1], fontSize: 8,
          rows: r.assets.map((a) => [a.tag, a.description, a.service, a.location, a.status === 'in_service' ? 'In service' : a.status === 'out_of_service' ? 'Out of service' : 'Decommissioned']) });
        break;
      case 'inspections':
        blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Tag', 'Inspection', 'Date', 'Report no.', 'Conclusion', 'Next due'], widths: [1.1, 2, 1, 1.6, 2, 1], fontSize: 8,
          rows: r.inspections.map((i) => [tag(i.asset_id), typeName(c.lib, i.type_code), d(i.inspection_date), i.report_no ?? '—', CONC[i.conclusion], d(i.next_due)]) });
        for (const i of r.inspections.filter((x) => x.summary)) {
          blocks.push({ t: 'heading', level: 2, text: `${tag(i.asset_id)} – ${typeName(c.lib, i.type_code)} (${d(i.inspection_date)})` }, { t: 'p', text: i.summary });
          const rows = utRows(r.readings.filter((x) => x.asset_id === i.asset_id), i.id, i.inspection_date);
          if (rows.length) blocks.push({ t: 'table', head: UT_HEAD, widths: UT_W, rows, fontSize: 7.5 });
        }
        break;
      case 'findings':
        blocks.push({ t: 'heading', text: s.title });
        blocks.push(r.findings.length ? findingsTable(r, r.findings) : { t: 'p', text: 'No findings were recorded.' });
        blocks.push({ t: 'p', size: 8, italic: true, text: priorityNote(c.lib) });
        break;
      case 'followup_table': {
        blocks.push({ t: 'heading', text: s.title });
        if (!r.findings.length) blocks.push({ t: 'p', text: 'There are no findings on record for the selected items.' });
        const byAsset = new Map<string, Finding[]>();
        for (const f of r.findings) byAsset.set(f.asset_id, [...(byAsset.get(f.asset_id) ?? []), f]);
        for (const [aid, list] of byAsset) {
          const a = r.assets.find((x) => x.id === aid);
          blocks.push({ t: 'heading', level: 2, text: `${a?.tag ?? ''} – ${a?.description ?? ''}` });
          blocks.push({
            t: 'table', head: ['Ref.', 'Finding', 'Pri.', 'Raised', 'History (date – status – our note)', 'Status now'], widths: [0.6, 2.2, 0.5, 0.9, 3.6, 1.1], fontSize: 8,
            rows: list.map((f) => [f.ref ?? '', f.title, f.priority, d(f.raised_date),
              r.updates.filter((u) => u.finding_id === f.id).sort((x, y) => x.update_date.localeCompare(y.update_date)).map((u) => `${d(u.update_date)} – ${STATUS[u.status]}${u.note ? ` – ${u.note}` : ''}`).join('\n') || '—',
              STATUS[f.status]]),
          });
        }
        break;
      }
      case 'dpr_summary':
        if (r.dprs.length) blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Report', 'Date', 'Staff', 'Hours', 'Actual %', 'Main activities'], widths: [1.6, 1, 0.6, 0.6, 0.8, 3.7], fontSize: 8,
          rows: r.dprs.map((x) => [x.number ?? '—', d(x.report_date), String((x.manpower ?? []).reduce((a, m) => a + (Number(m.count) || 0), 0)), String(x.hours_worked ?? ''), String(x.progress_actual ?? ''), (x.activities ?? []).map((a) => a.description).join('; ')]) });
        break;
      case 'holds':
        if (r.holds.length) blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Ref.', 'Type', 'Description', 'Raised', 'Closed'], widths: [0.7, 1, 4, 1, 1], fontSize: 8,
          rows: r.holds.map((h) => [h.ref_no, h.kind === 'hold' ? 'Hold' : 'Observation', h.title, d(h.raised_date), h.closed_date ? d(h.closed_date) : 'Open']) });
        break;
      case 'certificates':
        if (r.certificates.length) blocks.push({ t: 'heading', text: s.title }, { t: 'table', head: ['Certificate', 'Tag', 'Type', 'Issued', 'Issued by'], widths: [1.5, 1.2, 1, 1, 1.8],
          rows: r.certificates.map((x) => [x.number ?? '—', tag(x.asset_id), x.kind.toUpperCase(), d(x.issued_at), x.issued_by_name]) });
        break;
      case 'due_table':
        blocks.push({ t: 'heading', text: s.title }, dueTable(r, c.lib), { t: 'p', size: 8, italic: true, text: 'Intervals are defaults unless set for the asset; they must be confirmed against the current code edition, the client requirement and local regulation.' });
        break;
      case 'limitations':
        blocks.push({ t: 'heading', text: s.title }, { t: 'p', text: sectionText(c, 'limitations', '') });
        break;
      case 'signatures':
        blocks.push({ t: 'heading', text: s.title }, { t: 'signatures', items: [{ role: 'Prepared by', name: c.preparedBy ?? '', date: d(c.date) }, { role: 'Reviewed by', name: c.reviewedBy ?? '' }, { role: 'Approved by', name: c.approvedBy ?? '' }] });
        break;
      case 'photos':
        if (r.photos.length) blocks.push({ t: 'pagebreak' }, { t: 'heading', text: s.title }, photoBlock(r.photos));
        break;
    }
  }
  const title = titles[template] ?? 'REPORT';
  const hasCover = template !== 'due_register';
  const name = title.charAt(0) + title.slice(1).toLowerCase();
  return {
    title,
    headerLine: `${r.client.name}${r.job ? ` · ${r.job.number}` : ''} · ${c.docNumber}`,
    docNumber: c.docNumber,
    revision: c.revision,
    clientName: r.client.name,
    cover: hasCover ? {
      title: name.replace(/\bpsv\b/i, 'PSV'),
      subtitle: r.job ? `${r.job.number} – ${r.job.title}` : r.from ? `${d(r.from)} to ${d(r.to)}` : undefined,
      client: r.client.name,
      site: r.site?.name,
      control: [['Document number', c.docNumber], ['Revision', revLabel(c.revision)], ['Date', d(c.date)], ['Status', c.status], ['Prepared by', c.preparedBy ?? ''], ['Reviewed by', c.reviewedBy ?? ''], ['Approved by', c.approvedBy ?? '']],
    } : undefined,
    blocks,
  };
}
