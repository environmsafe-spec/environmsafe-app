// The app's connection to its own API (one Cloudflare Worker, same origin, session cookie).
// `supabase` keeps the calls the screens already use: from() / rpc() for data (PostgREST protocol),
// storage.from('documents') for files and functions.invoke() for the AI upload and printed PDFs.
import { PostgrestClient } from '@supabase/postgrest-js'

const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin

/** The API is always on the same origin now; kept for the login page's "no backend" notice. */
export const backendConfigured = true

const rest = new PostgrestClient(`${base}/api/rest/v1`, {
  fetch: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }),
})

type Result<T> = { data: T; error: null } | { data: null; error: Error }

async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(`${base}${path}`, { credentials: 'same-origin', ...init })
    const ct = res.headers.get('content-type') ?? ''
    const body = ct.includes('application/json') ? await res.json() : res.status === 204 ? null : await res.blob()
    if (!res.ok) return { data: null, error: new Error((body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error ?? res.statusText) }
    return { data: body as T, error: null }
  } catch (e) {
    return { data: null, error: e as Error }
  }
}

const fileUrl = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`

function bucket(_name: 'documents') {
  return {
    upload: (path: string, file: Blob, opts?: { contentType?: string; upsert?: boolean }) =>
      call<{ path: string }>(fileUrl(path), {
        method: 'PUT', body: file,
        headers: { 'content-type': opts?.contentType || file.type || 'application/octet-stream', ...(opts?.upsert ? { 'x-upsert': 'true' } : {}) },
      }),
    /** Files are served by the API after a permission check on every request, so the link is just the path. */
    createSignedUrl: async (path: string, _seconds: number): Promise<Result<{ signedUrl: string }>> => ({ data: { signedUrl: fileUrl(path) }, error: null }),
    download: (path: string) => call<Blob>(fileUrl(path), { method: 'GET' }),
  }
}

export const supabase = {
  from: rest.from.bind(rest),
  rpc: rest.rpc.bind(rest),
  storage: { from: bucket },
  functions: {
    invoke: <T = Record<string, unknown>>(name: string, opts: { body: unknown }) =>
      call<T>(`/api/functions/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) }),
  },
}
