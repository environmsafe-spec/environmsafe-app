import Dexie, { type Table } from 'dexie';

// Local copy of the data on this device, so the app works with no internet.

export const SYNC_TABLES = [
  'settings', 'ref_lists', 'numbering_schemes', 'profiles',
  'standards', 'inspection_types', 'equipment_types', 'text_blocks', 'report_templates',
  'clients', 'sites', 'assets', 'asset_tag_history', 'jobs', 'job_items', 'inspections', 'readings',
  'findings', 'finding_updates', 'dprs', 'certificates', 'documents', 'reports',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Tables whose primary key is not "id". */
export const TABLE_KEY: Partial<Record<SyncTable, string>> = {
  ref_lists: 'key',
  numbering_schemes: 'doc_type',
};

/** Tables that have an updated_at column we can pull incrementally on. */
export const INCREMENTAL: SyncTable[] = [
  'standards', 'inspection_types', 'equipment_types', 'text_blocks', 'report_templates',
  'clients', 'sites', 'assets', 'jobs', 'job_items', 'inspections', 'readings',
  'findings', 'finding_updates', 'dprs', 'certificates', 'documents', 'reports',
];

export interface OutboxOp {
  seq?: number;
  table: SyncTable;
  row_id: string;
  fields: Record<string, unknown>;
  ts: Record<string, string>;
  base: string | null;
  status: 'pending' | 'sending' | 'failed';
  error?: string;
  attempts: number;
  created_at: string;
}

export interface BlobEntry {
  path: string;
  blob: Blob;
  mime: string;
  size: number;
  pending: boolean; // true = still to be uploaded
  cached_at: string;
  error?: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export class LocalDB extends Dexie {
  settings!: Table<AnyRow, number>;
  ref_lists!: Table<AnyRow, string>;
  numbering_schemes!: Table<AnyRow, string>;
  profiles!: Table<AnyRow, string>;
  standards!: Table<AnyRow, string>;
  inspection_types!: Table<AnyRow, string>;
  equipment_types!: Table<AnyRow, string>;
  text_blocks!: Table<AnyRow, string>;
  report_templates!: Table<AnyRow, string>;
  clients!: Table<AnyRow, string>;
  sites!: Table<AnyRow, string>;
  assets!: Table<AnyRow, string>;
  asset_tag_history!: Table<AnyRow, string>;
  jobs!: Table<AnyRow, string>;
  job_items!: Table<AnyRow, string>;
  inspections!: Table<AnyRow, string>;
  readings!: Table<AnyRow, string>;
  findings!: Table<AnyRow, string>;
  finding_updates!: Table<AnyRow, string>;
  dprs!: Table<AnyRow, string>;
  certificates!: Table<AnyRow, string>;
  documents!: Table<AnyRow, string>;
  reports!: Table<AnyRow, string>;
  outbox!: Table<OutboxOp, number>;
  blobs!: Table<BlobEntry, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('es-records');
    this.version(1).stores({
      settings: 'id',
      ref_lists: 'key',
      numbering_schemes: 'doc_type',
      profiles: 'id, email',
      standards: 'id, code',
      inspection_types: 'id, code',
      equipment_types: 'id, code',
      text_blocks: 'id, key, category',
      report_templates: 'id, code',
      clients: 'id, code, name',
      sites: 'id, client_id',
      assets: 'id, client_id, site_id, parent_id, tag, equipment_type_id',
      asset_tag_history: 'id, asset_id',
      jobs: 'id, client_id, number',
      job_items: 'id, job_id',
      inspections: 'id, asset_id, job_id, client_id, inspection_date, status',
      readings: 'id, asset_id, inspection_id, point',
      findings: 'id, asset_id, client_id, inspection_id, status, priority',
      finding_updates: 'id, finding_id, inspection_id',
      dprs: 'id, job_id, report_date',
      certificates: 'id, asset_id, inspection_id, job_id, client_id',
      documents: 'id, client_id, asset_id, inspection_id, finding_id, job_id, dpr_id, report_id',
      reports: 'id, client_id, job_id',
      outbox: '++seq, table, row_id, status',
      blobs: 'path',
      meta: 'key',
    });
    this.version(2).stores({
      readings: 'id, asset_id, inspection_id, point, client_id',
    });
  }
}

export const db = new LocalDB();

export function tableOf(name: SyncTable): Table<AnyRow, string> {
  return (db as unknown as Record<string, Table<AnyRow, string>>)[name];
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const m = await db.meta.get(key);
  return (m?.value as T) ?? fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Removes every trace of local data (used at sign-out). */
export async function wipeLocal(): Promise<void> {
  await db.delete();
  await db.open();
}
