// Row shapes as stored in the database (and mirrored on the device).

export type Role = 'admin' | 'office' | 'inspector' | 'viewer';

export interface Housekeeping {
  id: string;
  created_at?: string;
  created_by?: string | null;
  updated_at?: string;
  updated_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  field_ts?: Record<string, string>;
  is_demo?: boolean;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  title: string;
  phone: string;
  role: Role;
  client_id: string | null;
  cert_number: string;
  signature_path: string | null;
  active: boolean;
  must_change_password: boolean;
}

export interface Contact {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

export interface Client extends Housekeeping {
  name: string;
  code: string;
  contacts: Contact[];
  address: string;
  notes: string;
  logo_path: string | null;
  status: 'active' | 'inactive';
}

export interface Site extends Housekeeping {
  client_id: string;
  name: string;
  area: string;
  location: string;
  lat: number | null;
  lng: number | null;
  notes: string;
}

export interface CustomField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'pressure' | 'temperature';
  unit?: string;
  options?: string[];
  required?: boolean;
}

export interface DefaultInterval {
  type: string;
  months: number;
  basis?: 'calendar' | 'half_life';
  note?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  kind: 'ync' | 'text' | 'number';
}

export interface EquipmentType extends Housekeeping {
  code: string;
  name: string;
  category: string;
  custom_fields: CustomField[];
  default_intervals: DefaultInterval[];
  checklists: Record<string, ChecklistItem[]>;
  active: boolean;
  sort: number;
}

export interface InspectionType extends Housekeeping {
  code: string;
  name: string;
  category: string;
  standards: string[];
  checklist: ChecklistItem[];
  active: boolean;
  sort: number;
}

export interface Standard extends Housekeeping {
  code: string;
  title: string;
  edition: string;
  category: string;
  active: boolean;
}

export interface TextBlock extends Housekeeping {
  key: string;
  category: string;
  title: string;
  body: string;
  active: boolean;
}

export interface TemplateSection {
  key: string;
  title: string;
  enabled: boolean;
  text_block?: string;
  text?: string;
}

export interface ReportTemplate extends Housekeeping {
  code: string;
  name: string;
  config: { cover?: boolean; sections: TemplateSection[]; intro?: string };
}

export interface Design {
  design_pressure_pa?: number | null;
  design_temp_c?: number | null;
  mawp_pa?: number | null;
  test_pressure_pa?: number | null;
  capacity?: string;
  material?: string;
  code?: string;
  [k: string]: unknown;
}

export type AssetStatus = 'in_service' | 'out_of_service' | 'decommissioned';

export interface Asset extends Housekeeping {
  client_id: string;
  site_id: string | null;
  parent_id: string | null;
  tag: string;
  tag_norm?: string;
  equipment_type_id: string | null;
  description: string;
  manufacturer: string;
  model: string;
  serial_no: string;
  year_built: number | null;
  design: Design;
  service: string;
  location: string;
  status: AssetStatus;
  criticality: 'low' | 'medium' | 'high';
  custom: Record<string, unknown>;
  intervals: Record<string, number>;
  notes: string;
}

export interface AssetTagHistory {
  id: string;
  asset_id: string;
  old_tag: string;
  new_tag: string;
  changed_at: string;
  changed_by: string | null;
}

export interface Job extends Housekeeping {
  client_id: string;
  site_id: string | null;
  number: string;
  title: string;
  scope: string;
  start_date: string | null;
  end_date: string | null;
  team: string;
  status: 'planned' | 'in_progress' | 'completed' | 'closed';
  notes: string;
}

export interface JobItem extends Housekeeping {
  job_id: string;
  client_id: string;
  kind: 'hold' | 'observation';
  ref_no: string;
  title: string;
  description: string;
  raised_date: string;
  closed_date: string | null;
  status: 'open' | 'closed';
  raised_by_name: string;
}

export type DocStatus = 'draft' | 'submitted' | 'reviewed' | 'issued' | 'revised';
export type Conclusion = 'fit' | 'fit_conditions' | 'not_fit' | 'not_assessed';

export interface Signature {
  name?: string;
  title?: string;
  cert_no?: string;
  image_path?: string;
  signed_at?: string;
}

export interface PsvResults {
  set_pressure_pa?: number | null;
  cdtp_pa?: number | null;
  as_found_pa?: number | null;
  as_left_pa?: number | null;
  reseat_pa?: number | null;
  seat_tightness?: 'pass' | 'fail' | '';
  test_medium?: string;
  bench?: string;
  gauge?: string;
  gauge_cal_due?: string;
  parts?: { part: string; condition: string; action: string }[];
  result?: 'pass' | 'fail' | '';
  code?: 'ASME VIII' | 'ASME I';
}

export interface PressureTestResults {
  test_pressure_pa?: number | null;
  design_pressure_pa?: number | null;
  hold_minutes?: number | null;
  test_medium?: string;
  water_temp_c?: number | null;
  gauges?: string;
  start_time?: string;
  end_time?: string;
  pressure_drop_pa?: number | null;
  result?: 'pass' | 'fail' | '';
}

export interface Inspection extends Housekeeping {
  client_id: string;
  asset_id: string;
  job_id: string | null;
  type_code: string;
  standard: string;
  code_edition: string;
  inspection_date: string;
  inspector_id: string | null;
  inspector_name: string;
  witness: string;
  status: DocStatus;
  is_historical: boolean;
  contractor: string;
  summary: string;
  checklist: Record<string, { answer?: string; note?: string }>;
  results: { psv?: PsvResults; pressure?: PressureTestResults; calibration?: Record<string, unknown>; [k: string]: unknown };
  conclusion: Conclusion;
  conclusion_text: string;
  limitations: string;
  recommendations: string;
  interval_months: number | null;
  next_due: string | null;
  report_no: string | null;
  revision: number;
  supersedes_id: string | null;
  signature: Signature;
  submitted_at: string | null;
  issued_at: string | null;
  issued_by: string | null;
}

export interface Reading extends Housekeeping {
  inspection_id: string | null;
  asset_id: string;
  client_id: string;
  kind: 'ut' | 'calibration' | 'pressure' | 'other';
  point: string;
  location: string;
  nominal: number | null;
  measured: number | null;
  previous: number | null;
  retirement: number | null;
  unit: string;
  reading_date: string;
  data: Record<string, unknown>;
  sort: number;
}

export type FindingStatus =
  | 'open' | 'open_deteriorated' | 'open_improved' | 'open_unchanged' | 'closed' | 'superseded' | 'deferred';

export interface Finding extends Housekeeping {
  client_id: string;
  asset_id: string;
  inspection_id: string | null;
  number: number | null;
  ref: string | null;
  title: string;
  description: string;
  location: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  priority: 'P1' | 'P2' | 'P3';
  category: string;
  damage_mechanism: string;
  code_ref: string;
  recommendation: string;
  status: FindingStatus;
  due_date: string | null;
  owner: string;
  raised_date: string;
  closed_date: string | null;
  justification: string;
}

export interface FindingUpdate extends Housekeeping {
  finding_id: string;
  client_id: string;
  inspection_id: string | null;
  update_date: string;
  status: FindingStatus;
  note: string;
  photo_doc_id: string | null;
  by_name: string;
}

export interface Dpr extends Housekeeping {
  job_id: string;
  client_id: string;
  number: string | null;
  seq: number | null;
  report_date: string;
  manpower: { role: string; count: number }[];
  hours_worked: number | null;
  toolbox_talks: string;
  hse: { lti?: number; first_aid?: number; near_miss?: number; unsafe_acts?: number; [k: string]: number | undefined };
  activities: { discipline: string; description: string }[];
  progress_planned: number | null;
  progress_actual: number | null;
  observations: string;
  planned_next: string;
  issues: string;
  status: 'draft' | 'submitted' | 'issued' | 'revised';
  revision: number;
  supersedes_id: string | null;
  issued_at: string | null;
}

export type CertKind = 'psv' | 'hydro' | 'ut' | 'calibration' | 'lifting' | 'general';

export interface Certificate extends Housekeeping {
  client_id: string;
  asset_id: string;
  inspection_id: string | null;
  job_id: string | null;
  kind: CertKind;
  number: string | null;
  data: Record<string, unknown>;
  status: 'draft' | 'issued' | 'revised';
  revision: number;
  supersedes_id: string | null;
  issued_at: string | null;
  issued_by: string | null;
  issued_by_name: string;
  issued_by_cert: string;
  signature: Signature;
}

export type DocKind =
  | 'photo' | 'manual' | 'drawing' | 'datasheet' | 'previous_report' | 'certificate' | 'report_output' | 'nameplate' | 'other';

export interface DocumentRow extends Housekeeping {
  client_id: string;
  asset_id: string | null;
  inspection_id: string | null;
  finding_id: string | null;
  job_id: string | null;
  dpr_id: string | null;
  report_id: string | null;
  kind: DocKind;
  title: string;
  caption: string;
  file_path: string;
  mime: string;
  size_bytes: number;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  figure_no: number | null;
  sort: number;
}

export interface Report extends Housekeeping {
  client_id: string;
  job_id: string | null;
  template_code: string;
  number: string | null;
  title: string;
  revision: number;
  status: 'draft' | 'issued' | 'revised';
  config: Record<string, unknown>;
  supersedes_id: string | null;
  docx_path: string | null;
  pdf_path: string | null;
  issued_at: string | null;
  issued_by: string | null;
}

export interface RefItem {
  code: string;
  label: string;
  desc?: string;
  to_si?: number;
}

export interface RefList {
  key: string;
  title: string;
  items: RefItem[];
}

export interface Settings {
  id: 1;
  company: {
    legal_name: string;
    short_name: string;
    tagline: string;
    website: string;
    email: string;
    phone: string;
    address: string;
  };
  branding: { navy: string; accent: string; text: string; logo_path: string | null };
  options: {
    session_timeout_min: number;
    storage_warn_pct: number;
    storage_limit_mb: number;
    db_limit_mb: number;
    default_pressure_unit: string;
  };
}

export interface NumberingScheme {
  doc_type: string;
  label: string;
  pattern: string;
}

export interface SyncConflict {
  id: string;
  created_at: string;
  user_id: string;
  table_name: string;
  row_id: string;
  field: string;
  server_value: unknown;
  client_value: unknown;
  server_ts: string;
  client_ts: string;
  kept: 'server' | 'client';
  resolved: boolean;
}
