// Renders the PDF fixtures with the browser renderer (src/print/pdf.ts) for the visual test.
// Usage: node --experimental-strip-types e2e/render-fixtures.mjs <outDir>
import fs from 'node:fs'
import path from 'node:path'
import { renderDocument } from '../src/print/pdf.ts'

const out = process.argv[2]
const fx = new URL('../../pdf/tests/fixtures/', import.meta.url)
const assets = {
  logo: fs.readFileSync(new URL('../public/print/es_logo.jpg', import.meta.url)),
  signature: fs.readFileSync(new URL('../public/print/signature_stamp.png', import.meta.url)),
}
fs.mkdirSync(out, { recursive: true })
for (const f of fs.readdirSync(fx).filter((n) => n.endsWith('.json'))) {
  const pdf = await renderDocument(JSON.parse(fs.readFileSync(new URL(f, fx), 'utf8')), assets)
  fs.writeFileSync(path.join(out, f.replace('.json', '.pdf')), pdf)
  console.log('rendered', f)
}
