// Offline-first sync.
//
// Every change is written to the device first (IndexedDB) and queued in the
// outbox. When the device is online the queue is sent to the database's
// sync_apply function, which merges per field (last edit wins) and records any
// conflicting edit in the conflict list. Nothing in the queue is ever dropped
// silently: a change the server refuses stays visible with its error until a
// person retries or discards it.

import { db, getMeta, INCREMENTAL, setMeta, SYNC_TABLES, TABLE_KEY, tableOf, type SyncTable } from './db';
import { DATE_DEFAULTS, DEFAULTS, today } from './defaults';
import { BUCKET, configured, supabase } from './supabase';

type Listener = () => void;
const listeners = new Set<Listener>();

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  pendingFiles: number;
  lastSync: string | null;
  lastError: string | null;
}

export const syncState: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  failed: 0,
  pendingFiles: 0,
  lastSync: null,
  lastError: null,
};

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export async function refreshCounts(): Promise<void> {
  syncState.pending = await db.outbox.where('status').anyOf('pending', 'sending').count();
  syncState.failed = await db.outbox.where('status').equals('failed').count();
  syncState.pendingFiles = await db.blobs.filter((b) => b.pending).count();
  syncState.lastSync = await getMeta<string | null>('lastSync', null);
  emit();
}

export function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Writing data
// ---------------------------------------------------------------------------

/**
 * Saves a change locally and queues it for the server. `patch` holds only the
 * fields that changed (for a new row: all the fields the user filled in).
 */
export async function save<T extends Record<string, unknown>>(table: SyncTable, id: string, patch: Partial<T>): Promise<void> {
  const t = tableOf(table);
  const ts = nowIso();
  const fields = { ...patch } as Record<string, unknown>;
  delete fields.id;
  const fieldTs: Record<string, string> = {};
  for (const k of Object.keys(fields)) fieldTs[k] = ts;

  await db.transaction('rw', t, db.outbox, async () => {
    const existing = await t.get(id);
    const base = existing ?? {
      ...(DEFAULTS[table] ?? {}),
      ...Object.fromEntries((DATE_DEFAULTS[table] ?? []).map((k) => [k, today()])),
      id,
      created_at: ts,
      created_by: localStorage.getItem('es-last-user'),
    };
    const merged = {
      ...base,
      ...fields,
      id,
      updated_at: ts,
      _local: true,
      field_ts: { ...(existing?.field_ts ?? {}), ...fieldTs },
    };
    await t.put(merged);

    // Fold into the queued change for the same row only when it is the last one
    // in the queue, so changes never jump ahead of records they depend on.
    const last = await db.outbox.orderBy('seq').last();
    const queued = last && last.row_id === id && last.table === table && last.status === 'pending' ? last : undefined;
    if (queued) {
      await db.outbox.update(queued.seq!, {
        fields: { ...queued.fields, ...fields },
        ts: { ...queued.ts, ...fieldTs },
      });
    } else {
      await db.outbox.add({
        table,
        row_id: id,
        fields,
        ts: fieldTs,
        base: (existing?._server_updated_at as string | undefined) ?? null,
        status: 'pending',
        attempts: 0,
        created_at: ts,
      });
    }
  });
  void refreshCounts();
  scheduleSync();
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Changes part of a row based on its latest stored value (for JSON fields such
 * as checklist answers). Calls run one after another, so quick taps never
 * overwrite each other.
 */
export function update<T extends Record<string, unknown>>(table: SyncTable, id: string, fn: (row: T) => Partial<T>): Promise<void> {
  const next = chain.then(async () => {
    const row = ((await tableOf(table).get(id)) ?? {}) as T;
    await save(table, id, fn(row));
  });
  chain = next.catch(() => undefined);
  return next;
}

/** Creates a new row and returns its id. */
export async function create<T extends Record<string, unknown>>(table: SyncTable, values: Partial<T>): Promise<string> {
  const id = (values.id as string) || newId();
  await save(table, id, values);
  return id;
}

export async function softDelete(table: SyncTable, id: string): Promise<void> {
  await save(table, id, { deleted_at: nowIso() });
}

export async function restore(table: SyncTable, id: string): Promise<void> {
  await save(table, id, { deleted_at: null });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Keeps a file on the device and queues it for upload. */
export async function queueFile(path: string, blob: Blob): Promise<void> {
  await db.blobs.put({ path, blob, mime: blob.type || 'application/octet-stream', size: blob.size, pending: true, cached_at: nowIso() });
  void refreshCounts();
  scheduleSync();
}

async function uploadPendingFiles(): Promise<boolean> {
  const pending = await db.blobs.filter((b) => b.pending).toArray();
  for (const f of pending) {
    const { error } = await supabase.storage.from(BUCKET).upload(f.path, f.blob, {
      upsert: true,
      contentType: f.mime,
    });
    if (error && !/already exists|Duplicate/i.test(error.message)) {
      await db.blobs.update(f.path, { error: error.message });
      syncState.lastError = `Photo/file upload: ${error.message}`;
      return false;
    }
    await db.blobs.update(f.path, { pending: false, error: undefined });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Push and pull
// ---------------------------------------------------------------------------
async function push(): Promise<void> {
  const ops = await db.outbox.where('status').equals('pending').sortBy('seq');
  dbg('push ops', ops.length, ops.map((o) => `${o.seq}:${o.table}`).join(','));
  for (let i = 0; i < ops.length; i += 100) {
    const batch = ops.slice(i, i + 100);
    await db.outbox.bulkUpdate(batch.map((o) => ({ key: o.seq!, changes: { status: 'sending' as const } })));
    const payload = batch.map((o) => ({ op_id: String(o.seq), table: o.table, id: o.row_id, fields: o.fields, ts: o.ts, base: o.base }));
    const { data, error } = await supabase.rpc('sync_apply', { ops: payload });
    dbg('rpc', error?.message, JSON.stringify(data)?.slice(0, 300));
    if (error) {
      // Network or session problem: put the batch back and try later.
      await db.outbox.bulkUpdate(batch.map((o) => ({ key: o.seq!, changes: { status: 'pending' as const } })));
      throw error;
    }
    for (const res of data as { op_id: string; ok: boolean; row?: Record<string, unknown>; error?: string }[]) {
      const op = batch.find((o) => String(o.seq) === res.op_id);
      if (!op) continue;
      if (res.ok && res.row) {
        await db.outbox.delete(op.seq!);
        await mergeServerRow(op.table, res.row);
      } else {
        await db.outbox.update(op.seq!, { status: 'failed', error: res.error, attempts: op.attempts + 1 });
      }
    }
  }
}

/** Puts a row from the server into the local copy, keeping any local edits still queued. */
async function mergeServerRow(table: SyncTable, row: Record<string, unknown>): Promise<void> {
  const key = TABLE_KEY[table] ?? 'id';
  const id = row[key] as string;
  const t = tableOf(table);
  const queued = key === 'id'
    ? await db.outbox.where('row_id').equals(id).filter((o) => o.table === table && o.status !== 'failed').toArray()
    : [];
  const localFields = Object.assign({}, ...queued.map((q) => q.fields));
  await t.put({ ...row, ...localFields, _server_updated_at: row.updated_at, _local: queued.length > 0 });
}

const PAGE = 1000;

async function pullTable(table: SyncTable): Promise<void> {
  const sinceKey = `since:${table}`;
  const since = await getMeta<string | null>(sinceKey, null);
  let from = 0;
  let maxSeen = since;
  for (;;) {
    let q = supabase.from(table).select('*');
    if (INCREMENTAL.includes(table) && since) {
      // Re-read a short overlap so a change committed a moment late is not missed.
      const overlap = new Date(new Date(since).getTime() - 5 * 60_000).toISOString();
      q = q.gt('updated_at', overlap);
    }
    q = q.order(INCREMENTAL.includes(table) ? 'updated_at' : (TABLE_KEY[table] ?? 'id'), { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    await db.transaction('rw', tableOf(table), db.outbox, async () => {
      for (const r of rows) {
        await mergeServerRow(table, r);
        const u = (r as Record<string, unknown>).updated_at as string | undefined;
        if (u && (!maxSeen || u > maxSeen)) maxSeen = u;
      }
    });
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  if (INCREMENTAL.includes(table) && maxSeen) await setMeta(sinceKey, maxSeen);
}

async function pull(): Promise<void> {
  for (const t of SYNC_TABLES) {
    dbg('pull', t);
    await pullTable(t);
  }
}

let running: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(delayMs = 800): void {
  dbg('schedule', delayMs, !!running);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delayMs);
}

let runningSince = 0;
const dbg = (...a: unknown[]) => { if (import.meta.env.MODE === 'e2e') console.log('[sync]', ...a); };

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
}

export async function syncNow(): Promise<void> {
  if (!configured) return;
  // A sync that has been running for more than 5 minutes is treated as lost.
  if (running && Date.now() - runningSince < 300_000) return running;
  runningSince = Date.now();
  running = (async () => {
    const { data } = await withTimeout(supabase.auth.getSession(), 20_000, 'Session check');
    if (!data.session || !navigator.onLine) {
      dbg('skip', !!data.session, navigator.onLine);
      syncState.online = navigator.onLine;
      emit();
      return;
    }
    syncState.syncing = true;
    syncState.lastError = null;
    emit();
    try {
      dbg('start');
      const filesOk = await uploadPendingFiles();
      dbg('files done', filesOk);
      if (filesOk) await push();
      dbg('push done');
      await pull();
      dbg('pull done');
      await setMeta('lastSync', nowIso());
      syncState.online = true;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      syncState.lastError = msg;
      if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) syncState.online = false;
    } finally {
      syncState.syncing = false;
      await refreshCounts();
    }
  })();
  const mine = running;
  try {
    await mine;
  } finally {
    if (running === mine) running = null;
  }
}

export async function retryFailed(): Promise<void> {
  const failed = await db.outbox.where('status').equals('failed').toArray();
  await db.outbox.bulkUpdate(failed.map((o) => ({ key: o.seq!, changes: { status: 'pending' as const, error: undefined } })));
  await refreshCounts();
  scheduleSync(10);
}

/** Discards one refused change and reloads the server copy of that row. */
export async function discardOp(seq: number): Promise<void> {
  const op = await db.outbox.get(seq);
  if (!op) return;
  await db.outbox.delete(seq);
  if (configured && navigator.onLine) {
    const { data } = await supabase.from(op.table).select('*').eq('id', op.row_id).maybeSingle();
    if (data) await mergeServerRow(op.table, data);
    else await tableOf(op.table).delete(op.row_id);
  }
  await refreshCounts();
}

if (import.meta.env.MODE === 'e2e') {
  (window as unknown as Record<string, unknown>).__es = { syncState, supabase, db, syncNow };
}

let started = false;
export function startSyncLoop(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    syncState.online = true;
    emit();
    scheduleSync(100);
  });
  window.addEventListener('offline', () => {
    syncState.online = false;
    emit();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(100);
  });
  setInterval(() => scheduleSync(0), 60_000);
  // Changes that were being sent when the app was closed go back in the queue.
  // Sending them again is safe: every record has a fixed id.
  void db.outbox.where('status').equals('sending').modify({ status: 'pending' }).then(() => refreshCounts());
  scheduleSync(50);
}

export async function unsyncedCount(): Promise<number> {
  const ops = await db.outbox.count();
  const files = await db.blobs.filter((b) => b.pending).count();
  return ops + files;
}
