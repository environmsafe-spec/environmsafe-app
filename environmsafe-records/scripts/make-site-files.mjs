// Release step: writes the Cloudflare Pages files that sit next to the app –
// security headers (with the database address in the CSP), SPA routing, and,
// when an APK is given, version.json and the download page with a QR code.
//
//   node scripts/make-site-files.mjs [path/to/app-release.apk]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { csp } from './csp.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const env = Object.fromEntries(
  fs.existsSync(path.join(root, '.env.production'))
    ? fs.readFileSync(path.join(root, '.env.production'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    : [],
);
const supa = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const site = (process.env.VITE_PUBLIC_URL || env.VITE_PUBLIC_URL || 'https://records.environmsafe.com').replace(/\/$/, '');

const policy = csp(supa);

fs.writeFileSync(path.join(dist, '_headers'), `/*
  Content-Security-Policy: ${policy}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  X-Robots-Tag: noindex, nofollow

/sw.js
  Cache-Control: no-cache

/version.json
  Cache-Control: no-cache
  Access-Control-Allow-Origin: *

/download/*
  Cache-Control: no-cache

/download/EnvironmSafe-Records.apk
  Content-Type: application/vnd.android.package-archive
  Content-Disposition: attachment; filename="EnvironmSafe-Records.apk"

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`);

// Single-page app: every unknown path opens the app.
fs.writeFileSync(path.join(dist, '_redirects'), '/download /download/ 301\n/* /index.html 200\n');

const apk = process.argv[2];
if (apk) {
  const [a, b, c] = pkg.version.split('.').map(Number);
  const versionCode = a * 10000 + b * 100 + c;
  const bytes = fs.readFileSync(apk);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const dl = path.join(dist, 'download');
  fs.mkdirSync(dl, { recursive: true });
  fs.copyFileSync(apk, path.join(dl, 'EnvironmSafe-Records.apk'));
  const apkUrl = `${site}/download/EnvironmSafe-Records.apk`;
  const info = { version: pkg.version, versionCode, apk: apkUrl, sha256, size: bytes.length, released: new Date().toISOString(), notes: process.env.RELEASE_NOTES || '' };
  fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify(info, null, 2));
  const qr = await QRCode.toDataURL(`${site}/download/`, { margin: 1, width: 260 });
  const qrApp = await QRCode.toDataURL(site, { margin: 1, width: 260 });
  fs.writeFileSync(path.join(dl, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download EnvironmSafe Records</title><meta name="robots" content="noindex">
<style>
:root{--navy:#1B1B3A;--accent:#E39B22}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f5f9;color:#15152b}
header{background:var(--navy);color:#fff;padding:18px 16px;display:flex;align-items:center;gap:12px}
header img{height:48px;background:#fff;border-radius:8px;padding:2px}main{max-width:720px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid #d4d7e2;border-radius:16px;padding:18px;margin-bottom:14px}
a.btn{display:block;text-align:center;background:var(--accent);color:var(--navy);font-weight:bold;font-size:20px;padding:16px;border-radius:14px;text-decoration:none}
code{word-break:break-all;font-size:12px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px}dt{color:#4b5066}
.qr{display:flex;gap:16px;flex-wrap:wrap}.qr figure{margin:0;text-align:center;font-size:14px}ol li{margin-bottom:8px}
</style></head><body>
<header><img src="/icons/icon-192.png" alt=""><div><b>EnvironmSafe Records</b><br><span style="color:var(--accent)">Android app</span></div></header>
<main>
<div class="card"><a class="btn" href="EnvironmSafe-Records.apk" download>Download the app (APK)</a>
<dl style="margin-top:14px"><dt>Version</dt><dd>${pkg.version}</dd><dt>Size</dt><dd>${(bytes.length / 1024 / 1024).toFixed(1)} MB</dd><dt>Released</dt><dd>${info.released.slice(0, 10)}</dd><dt>SHA-256</dt><dd><code>${sha256}</code></dd></dl></div>
<div class="card"><h2>Install on Android (8 or newer)</h2><ol>
<li>Tap <b>Download the app</b>. If Chrome warns about the file, tap <b>Download anyway</b>.</li>
<li>Open the downloaded file. When Android asks, tap <b>Settings</b> and turn on <b>Allow from this source</b> for Chrome (or your file manager), then go back.</li>
<li>Tap <b>Install</b>, then <b>Open</b>, and sign in with your e-mail and password.</li></ol>
<p>Updates: the app tells you when a new version is available and links back to this page.</p></div>
<div class="card qr"><figure><img src="${qr}" width="180" height="180" alt="QR code for this page"><figcaption>This download page</figcaption></figure>
<figure><img src="${qrApp}" width="180" height="180" alt="QR code for the website"><figcaption>Website: ${site.replace('https://', '')}</figcaption></figure></div>
</main></body></html>`);
  console.log(JSON.stringify(info));
}
console.log('site files written');
