// Staging helpers for the Phase 6 migration. The OLD project is only ever read.
//
//   node staging.mjs load    copy es_records of the company from the old project into legacy.es_records (staging)
//   node staging.mjs files   copy the attached files from the old bucket into the new "documents" bucket,
//                            fill in size and SHA-256, and list files in the old bucket no record points to
//
// Environment (never commit these):
//   OLD_URL, OLD_KEY        old project URL and a key that can READ es_records and the es-attachments bucket
//   NEW_URL, NEW_SERVICE_KEY staging project URL and its service-role key
//   COMPANY_ID              dee3dc12-55bb-4acc-9c44-46721b36651b
// Run migration.run(...) in SQL between "load" and "files".
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`) })()
const company = env('COMPANY_ID')
const oldDb = createClient(env('OLD_URL'), env('OLD_KEY'), { auth: { persistSession: false } })
const newDb = createClient(env('NEW_URL'), env('NEW_SERVICE_KEY'), { auth: { persistSession: false }, db: { schema: 'public' } })
const OLD_BUCKET = 'es-attachments'

async function load() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await oldDb.from('es_records').select('company_id, collection, record_id, data, deleted, updated_at, updated_by')
      .eq('company_id', company).order('collection').order('record_id').range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) break
  }
  const legacy = createClient(env('NEW_URL'), env('NEW_SERVICE_KEY'), { auth: { persistSession: false }, db: { schema: 'legacy' } })
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await legacy.from('es_records').upsert(rows.slice(i, i + 500))
    if (error) throw error
  }
  const by = rows.reduce((a, r) => ({ ...a, [r.collection]: (a[r.collection] ?? 0) + 1 }), {})
  console.log(`Copied ${rows.length} records`, by)
}

async function listOld(prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await oldDb.storage.from(OLD_BUCKET).list(prefix, { limit: 1000, offset })
    if (error) throw error
    for (const f of data) {
      const path = prefix ? `${prefix}/${f.name}` : f.name
      if (f.id === null) out.push(...await listOld(path))   // folder
      else out.push(path)
    }
    if (data.length < 1000) break
  }
  return out
}

async function files() {
  // <company>/legacy/<old path>, or <company>/legacy-copy/<document>/<old path> for a file shared by two records.
  const { data: rows, error } = await newDb.from('attachments').select('id, storage_path').like('storage_path', `${company}/legacy%`)
  if (error) throw error
  const wanted = new Set()
  let copied = 0, missing = 0
  for (const a of rows) {
    const oldPath = a.storage_path.replace(/^[^/]+\/legacy\//, '').replace(/^[^/]+\/legacy-copy\/[^/]+\//, '')
    wanted.add(oldPath)
    const dl = await oldDb.storage.from(OLD_BUCKET).download(oldPath)
    if (dl.error) { missing++; console.log(`MISSING in old bucket: ${oldPath}`); continue }
    const bytes = Buffer.from(await dl.data.arrayBuffer())
    const up = await newDb.storage.from('documents').upload(a.storage_path, bytes, { contentType: dl.data.type, upsert: true })
    if (up.error) throw up.error
    const sha = createHash('sha256').update(bytes).digest('hex')
    const upd = await newDb.from('attachments').update({ sha256: sha, size_bytes: bytes.length }).eq('id', a.id)
    if (upd.error) throw upd.error
    copied++
  }
  const orphans = (await listOld()).filter((p) => !wanted.has(p))
  console.log(`Files copied: ${copied}; missing in old bucket: ${missing}; orphan files (no record): ${orphans.length}`)
  for (const p of orphans) console.log(`ORPHAN: ${p}`)
}

const cmd = process.argv[2]
if (cmd === 'load') await load()
else if (cmd === 'files') await files()
else console.log('Usage: node staging.mjs load | files')
