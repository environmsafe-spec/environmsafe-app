// "Export everything": every table as JSON and CSV, plus (optionally) every
// stored file, in one ZIP. Admin only; needs internet.

import JSZip from 'jszip';
import { SYNC_TABLES } from './db';
import { BUCKET, supabase } from './supabase';

const EXTRA = ['audit_log', 'sync_conflicts', 'allowed_signups', 'issued_numbers', 'number_counters'];

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function exportEverything(includeFiles: boolean, progress: (msg: string) => void): Promise<Blob> {
  const zip = new JSZip();
  const manifest: Record<string, unknown> = { exported_at: new Date().toISOString(), app: 'EnvironmSafe Records', tables: {}, files: [] };
  for (const t of [...SYNC_TABLES, ...EXTRA]) {
    progress(`Reading ${t}…`);
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await fetchAll(t);
    } catch (e) {
      (manifest.tables as Record<string, unknown>)[t] = { error: (e as Error).message };
      continue;
    }
    (manifest.tables as Record<string, unknown>)[t] = { rows: rows.length };
    zip.file(`data/${t}.json`, JSON.stringify(rows, null, 1));
    zip.file(`csv/${t}.csv`, toCsv(rows));
  }
  const docs = (await fetchAll('documents')) as { file_path: string; size_bytes: number; deleted_at: string | null }[];
  const paths = [...new Set(docs.map((d) => d.file_path))];
  (manifest.files as unknown[]).push(...docs.map((d) => ({ path: d.file_path, size: d.size_bytes, deleted: !!d.deleted_at })));
  if (includeFiles) {
    let n = 0;
    for (let i = 0; i < paths.length; i += 50) {
      const batch = paths.slice(i, i + 50);
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(batch, 600);
      for (const s of data ?? []) {
        if (!s.signedUrl || !s.path) continue;
        const res = await fetch(s.signedUrl);
        if (res.ok) zip.file(`files/${s.path}`, await res.blob());
        n += 1;
        progress(`Files ${n} of ${paths.length}…`);
      }
    }
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt', 'EnvironmSafe Records export.\r\n\r\ndata/  – every table as JSON (use scripts/restore.mjs to load into a new database)\r\ncsv/   – the same tables for Excel\r\nfiles/ – photos and documents, in the same folders as in storage\r\nmanifest.json – row counts and the file list\r\n');
  progress('Packing ZIP…');
  await supabase.rpc('log_event', { p_action: 'export_everything', p_details: { files: includeFiles, count: paths.length } });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
