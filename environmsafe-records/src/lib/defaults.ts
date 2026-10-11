// Column defaults, the same as in the database. A row created on the device
// gets these at once, so screens work before the row has been synced.
import type { SyncTable } from './db';

const H = { deleted_at: null, field_ts: {}, is_demo: false };

export const DEFAULTS: Partial<Record<SyncTable, Record<string, unknown>>> = {
  clients: { ...H, contacts: [], address: '', notes: '', logo_path: null, status: 'active' },
  sites: { ...H, area: '', location: '', lat: null, lng: null, notes: '' },
  assets: {
    ...H, site_id: null, parent_id: null, equipment_type_id: null, description: '', manufacturer: '', model: '', serial_no: '', year_built: null, design: {},
    service: '', location: '', status: 'in_service', criticality: 'medium', custom: {}, intervals: {}, notes: '',
  },
  jobs: { ...H, site_id: null, title: '', scope: '', start_date: null, end_date: null, team: '', status: 'in_progress', notes: '' },
  job_items: { ...H, ref_no: '', description: '', closed_date: null, status: 'open', raised_by_name: '' },
  inspections: {
    ...H, job_id: null, standard: '', code_edition: '', inspector_id: null, inspector_name: '', witness: '', status: 'draft', is_historical: false, contractor: '',
    summary: '', checklist: {}, results: {}, conclusion: 'not_assessed', conclusion_text: '', limitations: '', recommendations: '', interval_months: null,
    next_due: null, report_no: null, revision: 0, supersedes_id: null, signature: {}, submitted_at: null, issued_at: null, issued_by: null,
  },
  readings: { ...H, inspection_id: null, kind: 'ut', point: '', location: '', nominal: null, measured: null, previous: null, retirement: null, unit: 'mm', data: {}, sort: 0 },
  findings: {
    ...H, inspection_id: null, number: null, ref: null, description: '', location: '', severity: 'medium', priority: 'P2', category: '', damage_mechanism: '', code_ref: '',
    recommendation: '', status: 'open', due_date: null, owner: '', closed_date: null, justification: '',
  },
  finding_updates: { ...H, inspection_id: null, note: '', photo_doc_id: null, by_name: '' },
  dprs: {
    ...H, number: null, seq: null, manpower: [], hours_worked: null, toolbox_talks: '', hse: {}, activities: [], progress_planned: null, progress_actual: null,
    observations: '', planned_next: '', issues: '', status: 'draft', revision: 0, supersedes_id: null, issued_at: null,
  },
  certificates: { ...H, inspection_id: null, job_id: null, number: null, data: {}, status: 'draft', revision: 0, supersedes_id: null, issued_at: null, issued_by: null, issued_by_name: '', issued_by_cert: '', signature: {} },
  documents: { ...H, asset_id: null, inspection_id: null, finding_id: null, job_id: null, dpr_id: null, report_id: null, kind: 'photo', title: '', caption: '', mime: 'application/octet-stream', size_bytes: 0, taken_at: null, lat: null, lng: null, figure_no: null, sort: 0 },
  reports: { ...H, job_id: null, number: null, title: '', revision: 0, status: 'draft', config: {}, supersedes_id: null, docx_path: null, pdf_path: null, issued_at: null, issued_by: null },
  equipment_types: { ...H, category: '', custom_fields: [], default_intervals: [], checklists: {}, active: true, sort: 0 },
  inspection_types: { ...H, category: '', standards: [], checklist: [], active: true, sort: 0 },
  standards: { ...H, edition: '', category: '', active: true },
  text_blocks: { ...H, active: true },
  report_templates: { ...H, config: {} },
};

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date columns that default to "today" in the database. */
export const DATE_DEFAULTS: Partial<Record<SyncTable, string[]>> = {
  inspections: ['inspection_date'], readings: ['reading_date'], findings: ['raised_date'], finding_updates: ['update_date'], dprs: ['report_date'], job_items: ['raised_date'],
};
