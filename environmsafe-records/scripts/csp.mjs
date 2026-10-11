// The Content-Security-Policy for the web app, shared by the release step and
// by the local preview server used in tests.
export function csp(supabaseUrl) {
  const host = supabaseUrl ? new URL(supabaseUrl).host : '*.supabase.co';
  const scheme = supabaseUrl?.startsWith('http://') ? 'http' : 'https';
  const ws = scheme === 'http' ? 'ws' : 'wss';
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${scheme}://${host}`,
    "font-src 'self' data:",
    `connect-src 'self' ${scheme}://${host} ${ws}://${host}`,
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(scheme === 'https' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
