// /verify?t=<token> — public invoice check, opened by the QR code printed on
// every invoice EnvironmSafe issues. The token is random (not the invoice
// number), so pages cannot be guessed or listed. The answer comes live from the
// Procurement & Finance database through es_verify_invoice(), which returns
// only number, date, customer, total, currency and status. See
// docs/invoice-verify/README.md.
//
// The publishable key below is meant to sit in public code: it can call that
// one function and read nothing else without a signed-in user.
const SUPABASE_URL = "https://mcgjrsfsppdcnvolqsgs.supabase.co";
const SUPABASE_KEY = "sb_publishable_R_5WX_WMMXZCkGnwfp6ZTw_dtUaq1qx";
const TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return esc(iso);
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2] - 1];
  return `${m[3]} ${mon} ${m[1]}`;
}
function fmtMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

export async function lookup(token, fetchImpl = fetch) {
  if (!TOKEN_RE.test(token || "")) return { result: "unknown" };
  try {
    const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/es_verify_invoice`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) return { result: "error" };
    const data = await res.json();
    return data && typeof data === "object" && data.result ? data : { result: "error" };
  } catch {
    return { result: "error" };
  }
}

export function render(r) {
  let tone, en, ar, body = "";
  if (r.result === "valid") {
    tone = "ok";
    en = "Genuine invoice"; ar = "فاتورة صحيحة";
    const rows = [
      ["Invoice no.", "رقم الفاتورة", esc(r.invoice_no)],
      ["Date", "التاريخ", fmtDate(r.date)],
      ["Customer", "العميل", esc(r.customer)],
      ["Total", "الإجمالي", `<span dir="ltr">${esc(r.currency)} ${fmtMoney(r.total)}</span>`],
      ["Status", "الحالة", r.status === "paid" ? "Paid · مدفوعة" : "Issued · صادرة"],
    ];
    body = `<table>${rows.map(([e, a, v]) =>
      `<tr><th><span>${e}</span><span lang="ar" dir="rtl">${a}</span></th><td>${v}</td></tr>`).join("")}</table>
      <p class="hint">Compare every line with the invoice you hold. If the customer, total or date differ, the paper is not ours.
      <span lang="ar" dir="rtl">قارن كل سطر بالفاتورة التي بين يديك. إذا اختلف العميل أو المبلغ أو التاريخ فالفاتورة ليست صادرة منا.</span></p>`;
  } else if (r.result === "cancelled") {
    tone = "bad";
    en = "This invoice has been cancelled"; ar = "هذه الفاتورة ملغاة";
    body = `<p>Invoice <b dir="ltr">${esc(r.invoice_no)}</b> was issued by EnvironmSafe but is no longer valid. Do not pay it.
      <span lang="ar" dir="rtl">الفاتورة <b dir="ltr">${esc(r.invoice_no)}</b> صدرت من EnvironmSafe لكنها لم تعد سارية. لا تقم بسدادها.</span></p>`;
  } else if (r.result === "error") {
    tone = "warn";
    en = "We could not check this right now"; ar = "تعذّر التحقق الآن";
    body = `<p>Please try again in a few minutes, or contact us.
      <span lang="ar" dir="rtl">يرجى المحاولة بعد دقائق أو التواصل معنا.</span></p>`;
  } else {
    tone = "bad";
    en = "Not an EnvironmSafe invoice"; ar = "ليست فاتورة صادرة من EnvironmSafe";
    body = `<p>This code does not match any invoice we issued. Do not pay it, and please tell us where you received it.
      <span lang="ar" dir="rtl">هذا الرمز لا يطابق أي فاتورة صادرة منا. لا تقم بالسداد، ونرجو إبلاغنا بمصدر الفاتورة.</span></p>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Invoice verification | EnvironmSafe</title>
<style>
  :root { --navy:#14294a; --gold:#d9a21b; --grey:#555; --line:#c9d3df; --ok:#1e7a46; --bad:#b3261e; --warn:#9a6700; }
  * { box-sizing:border-box; }
  body { margin:0; background:#f3f5f8; color:var(--navy); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif; }
  header { background:var(--navy); color:#fff; padding:14px 16px; border-bottom:4px solid var(--gold); }
  header b { font-size:18px; } header small { display:block; opacity:.8; }
  main { max-width:560px; margin:24px auto; padding:0 16px; }
  .card { background:#fff; border-radius:10px; padding:20px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .badge { display:flex; gap:12px; align-items:center; padding:14px; border-radius:8px; margin-bottom:16px; color:#fff; }
  .badge.ok { background:var(--ok); } .badge.bad { background:var(--bad); } .badge.warn { background:var(--warn); }
  .badge svg { flex:none; } .badge h1 { font-size:19px; margin:0; } .badge div span { display:block; font-size:17px; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:9px 4px; border-bottom:1px solid var(--line); vertical-align:top; text-align:start; }
  th { color:var(--grey); font-weight:600; width:42%; } th span { display:block; } th span[lang=ar] { font-weight:400; font-size:14px; }
  td { font-weight:600; overflow-wrap:anywhere; }
  p { color:var(--grey); } p span[lang=ar] { display:block; margin-top:6px; text-align:right; } .hint { font-size:14px; margin-top:16px; }
  footer { text-align:center; color:var(--grey); font-size:13px; margin:20px 16px 32px; }
  footer a { color:var(--navy); }
</style>
</head>
<body>
<header><b>EnvironmSafe</b><small>Invoice verification · التحقق من الفاتورة</small></header>
<main>
  <div class="card">
    <div class="badge ${tone}">
      ${tone === "ok"
        ? '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>'
        : '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>'}
      <div><h1>${en}</h1><span lang="ar" dir="rtl">${ar}</span></div>
    </div>
    ${body}
  </div>
  <footer>EnvironmSafe For Engineering, Trading, and Services Ltd · Aden<br>
    <a href="tel:+967783402932"><span dir="ltr">+967 783 402 932</span></a> ·
    <a href="mailto:support@environmsafe.com">support@environmsafe.com</a> ·
    <a href="https://www.environmsafe.com/">www.environmsafe.com</a></footer>
</main>
</body>
</html>`;
}

export async function onRequestGet({ request }) {
  const token = new URL(request.url).searchParams.get("t") || "";
  const r = await lookup(token);
  return new Response(render(r), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
  });
}
