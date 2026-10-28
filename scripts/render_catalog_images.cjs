// Render the square WhatsApp catalog images from docs/whatsapp/items.json into
// public/img/catalog/. Needs Playwright with Chromium:  node scripts/render_catalog_images.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/img/catalog');
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'public/img/logo.png')).toString('base64');
const { services } = JSON.parse(fs.readFileSync(path.join(root, 'docs/whatsapp/items.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// kicker: the parent service, shown above the title on sub-item images only.
const page = ({ en, ar, subEn, subAr, kicker }) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
body{width:1080px;height:1080px;font-family:'DejaVu Sans',sans-serif;background:#1B2A4A;color:#fff;position:relative;overflow:hidden}
.band{position:absolute;inset:0 0 auto 0;height:300px;background:#fff;display:flex;align-items:center;justify-content:center}
.band img{height:250px}
.bar{position:absolute;top:300px;left:0;right:0;height:14px;background:#E3A038}
.body{position:absolute;top:350px;left:80px;right:80px;bottom:160px;display:flex;flex-direction:column;justify-content:center;gap:24px}
.kicker{align-self:flex-start;background:#E3A038;color:#1B2A4A;font-size:28px;font-weight:bold;padding:8px 20px;border-radius:6px}
.en{font-size:${en.length > 34 ? 52 : 64}px;font-weight:bold;line-height:1.12}
.subEn{font-size:30px;color:#cbd5e1}
.rule{height:2px;background:#2A3F6E}
.ar{font-size:${ar.length > 30 ? 52 : 60}px;font-weight:bold;direction:rtl;text-align:right;line-height:1.3}
.subAr{font-size:30px;color:#cbd5e1;direction:rtl;text-align:right}
.cta{position:absolute;left:0;right:0;bottom:0;height:130px;background:#E3A038;color:#1B2A4A;display:flex;align-items:center;justify-content:center;gap:40px;font-size:40px;font-weight:bold}
.cta span:last-child{direction:rtl}
</style></head><body>
<div class="band"><img src="${logo}"></div><div class="bar"></div>
<div class="body">${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
<div class="en">${esc(en)}</div>${subEn ? `<div class="subEn">${esc(subEn)}</div>` : ''}<div class="rule"></div>
<div class="ar">${esc(ar)}</div>${subAr ? `<div class="subAr">${esc(subAr)}</div>` : ''}</div>
<div class="cta"><span>Request a quote</span><span>·</span><span>اطلب عرض سعر</span></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  let n = 0;
  for (const s of services) {
    // The nine service images were rendered earlier with their own taglines; keep them.
    for (const it of s.items) {
      await p.setContent(page({ en: it.name_en, ar: it.name_ar, kicker: s.kicker }));
      await p.screenshot({ path: path.join(out, `${it.code.toLowerCase()}.png`) });
      n++;
    }
  }
  await browser.close();
  console.log(`${n} images`);
})();
