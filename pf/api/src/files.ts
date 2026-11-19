// Files (voucher photos, invoices, printed PDFs) in the private R2 bucket. Paths start with the company id:
//   <company id>/<...>. Same rules as before on Supabase Storage: reading needs docs.view in that company,
//   uploading needs docs.create. Files are never overwritten unless the caller asks (x-upsert) and may
//   upload into that company; nothing is ever deleted through the API.
import type pg from 'pg'
import { asUser, HttpError, type Claims } from './rest.ts'

const MAX_BYTES = 15 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function can(client: pg.Client, claims: Claims, company: string, perm: string) {
  if (claims.role !== 'authenticated') return false
  const r = await asUser<{ permission_code: string }>(client, claims, 'select permission_code from public.my_permissions($1)', [company])
  return r.rows.some((p) => p.permission_code === perm)
}

export function filePath(pathname: string) {
  const path = decodeURIComponent(pathname.slice('/api/files/'.length))
  const company = path.split('/')[0]
  if (!UUID.test(company) || path.includes('..') || path.includes('//') || path.endsWith('/')) throw new HttpError(400, 'Bad file path')
  return { path, company }
}

export async function handleFiles(req: Request, bucket: R2Bucket, client: pg.Client, claims: Claims): Promise<Response> {
  const { path, company } = filePath(new URL(req.url).pathname)

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!(await can(client, claims, company, 'docs.view'))) throw new HttpError(404, 'File not found')
    const obj = await bucket.get(path)
    if (!obj) throw new HttpError(404, 'File not found')
    const name = path.split('/').pop() ?? 'file'
    return new Response(req.method === 'HEAD' ? null : obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'content-length': String(obj.size),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        // A file is shown as itself, never as a page of the app.
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    })
  }

  if (req.method === 'PUT') {
    if (!(await can(client, claims, company, 'docs.create'))) throw new HttpError(403, 'You cannot upload files in this company')
    const size = Number(req.headers.get('content-length') ?? 0)
    if (size > MAX_BYTES) throw new HttpError(413, 'File is larger than 15 MB')
    if (req.headers.get('x-upsert') !== 'true' && (await bucket.head(path))) throw new HttpError(409, 'A file with this name already exists')
    const body = await req.arrayBuffer()
    if (body.byteLength > MAX_BYTES) throw new HttpError(413, 'File is larger than 15 MB')
    await bucket.put(path, body, { httpMetadata: { contentType: req.headers.get('content-type') ?? 'application/octet-stream' } })
    return new Response(JSON.stringify({ path }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new HttpError(405, 'method not supported')
}
