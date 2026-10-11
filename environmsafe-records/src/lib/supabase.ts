import { createClient } from '@supabase/supabase-js';

// Only the public (publishable / anon) key is ever shipped to the browser or the
// APK. Everything it can reach is limited by Row Level Security in the database.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);

/**
 * Every request gets a time limit: on poor mobile networks a request can
 * otherwise wait for ever and hold up syncing. File uploads get longer.
 */
const timedFetch: typeof fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const ms = /\/storage\/v1\/object\//.test(url) ? 180_000 : 45_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('The network did not answer in time', 'TimeoutError')), ms);
  if (init.signal) init.signal.addEventListener('abort', () => ctrl.abort(init.signal!.reason), { once: true });
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_KEY || 'missing-key', {
  global: { fetch: timedFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'es-records-auth',
  },
});

export const BUCKET = 'files';
