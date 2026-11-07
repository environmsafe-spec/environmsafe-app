// LOCAL DEMO: print documents straight from the database through the same builder the Edge Function
// uses, rendered by the local PDF service (pf/pdf/server.py on PDF_URL with PDF_SERVICE_KEY).
// Usage: node --experimental-strip-types e2e/print-demo.mjs <outDir> <document number>...
import fs from 'node:fs'
import pg from 'pg'
import { buildPrintDocument } from '../../supabase/functions/_shared/print.ts'

const [outDir, ...numbers] = process.argv.slice(2)
const db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.PGDATABASE ?? 'espf_demo' })
await db.connect()
for (const num of numbers) {
  const { rows: [doc] } = await db.query(`select d.*, k.number_type, m.name_en as money_account_name from documents d join doc_kinds k on k.kind = d.kind
    left join money_accounts m on m.id = d.money_account_id where d.number = $1 order by d.revision desc limit 1`, [num])
  const { rows: lines } = await db.query(`select l.*, i.code as item_code, i.name_en as item_name from document_lines l left join items i on i.id = l.item_id where l.document_id = $1 order by line_no`, [doc.id])
  const { rows: [party] } = await db.query('select * from parties where id = $1', [doc.party_id])
  const { rows: [company] } = await db.query('select name_en, legal_name, settings from companies where id = $1', [doc.company_id])
  const norm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : (typeof v === 'string' && /^-?\d+\.\d+$/.test(v) ? Number(v) : v)]))
  const printDoc = buildPrintDocument({ doc: norm(doc), lines: lines.map(norm), party: party ? norm(party) : null, company, appUrl: 'https://app.environmsafe.com' })
  const res = await fetch(`${process.env.PDF_URL ?? 'http://127.0.0.1:8099'}/render`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PDF-Key': process.env.PDF_SERVICE_KEY ?? 'test-key' }, body: JSON.stringify(printDoc),
  })
  if (!res.ok) throw new Error(await res.text())
  const file = `${outDir}/${num}.pdf`
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  console.log('printed', file)
}
await db.end()
