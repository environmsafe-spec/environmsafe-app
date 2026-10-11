// Makes docs/QUICK_START.pdf: one page with QR codes for the website and the APK.
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import QRCode from 'qrcode';

const site = process.env.SITE || 'https://records.environmsafe.com';
const web = await QRCode.toDataURL(site, { margin: 1, width: 300 });
const apk = await QRCode.toDataURL(`${site}/download/`, { margin: 1, width: 300 });
const logo = `data:image/jpeg;base64,${fs.readFileSync('src/assets/report-logo.jpg').toString('base64')}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:16mm}body{font-family:Arial,'Liberation Sans',sans-serif;color:#333;font-size:11.5pt}
h1{color:#1B1B3A;font-size:22pt;margin:6px 0 2px}.rule{height:3px;width:90px;background:#E39B22;margin:6px 0 14px}
.top{display:flex;align-items:center;gap:16px}.top img{height:80px}
.qr{display:flex;gap:30px;margin:14px 0}.qr figure{margin:0;text-align:center;border:1px solid #ccd;border-radius:10px;padding:10px;flex:1}
.qr img{width:170px}figcaption{font-weight:bold;color:#1B1B3A;margin-top:6px}h2{color:#1B1B3A;font-size:13pt;margin:14px 0 4px;border-bottom:2px solid #E39B22;padding-bottom:2px}
ol{margin:4px 0 4px 18px;padding:0}li{margin:3px 0}.small{font-size:9pt;color:#555;margin-top:14px}
</style></head><body>
<div class="top"><img src="${logo}"><div><h1>EnvironmSafe Records</h1><div>Quick start</div></div></div><div class="rule"></div>
<div class="qr"><figure><img src="${web}"><figcaption>Website</figcaption><div>${site.replace('https://', '')}</div></figure>
<figure><img src="${apk}"><figcaption>Android app (APK)</figcaption><div>${site.replace('https://', '')}/download</div></figure></div>
<h2>Install on Android (8 or newer)</h2><ol><li>Scan the right-hand code and tap <b>Download the app</b>.</li><li>Open the file; allow installing from this source when Android asks.</li><li>Tap <b>Install</b>, open the app and sign in.</li></ol>
<h2>First sign-in</h2><ol><li>Use the e-mail and temporary password from your Admin, then choose your own password.</li><li>Admins: set up two-step sign-in with Google or Microsoft Authenticator.</li><li>Home → <b>Set an app PIN</b> so you can unlock the app without internet.</li></ol>
<h2>Every day</h2><ol><li><b>+ → New inspection</b>: pick the tag (or scan its QR label) and follow the steps; update every previous finding.</li><li><b>+ → New daily report</b> for the job; tap <b>PDF + Word</b>.</li><li>Watch the bar at the top: green = synced, yellow = waiting (keep working), red = tap it.</li></ol>
<div class="small">Help: More → Help in the app · support@environmsafe.com · +967 78 340 2932</div>
</body></html>`;
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(html);
await p.pdf({ path: 'docs/QUICK_START.pdf', format: 'A4', printBackground: true });
await b.close();
console.log('docs/QUICK_START.pdf');
