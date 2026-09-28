// Language routing for the root URL (/) only. Visitors whose browser lists Arabic get a
// 302 to /ar/. The decision uses only the language cookie and Accept-Language, never the
// user agent. Crawlers don't send Arabic in Accept-Language, so they index / (English) and /ar/ (Arabic).
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
function readLangCookie(request) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)es-lang=(en|ar)\b/);
  return m ? m[1] : null;
}
function acceptsArabic(request) {
  const header = (request.headers.get("Accept-Language") || "").toLowerCase();
  return header.split(",").some((part) => {
    const [tag, ...params] = part.trim().split(";");
    if (!(tag === "ar" || tag.startsWith("ar-"))) return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || parseFloat(q.slice(2)) > 0;
  });
}
function withVary(response, extra = {}) {
  const res = new Response(response.body, response);
  res.headers.append("Vary", "Accept-Language, Cookie");
  for (const [k, v] of Object.entries(extra)) res.headers.append(k, v);
  return res;
}
function redirectToArabic(url) {
  return new Response(null, { status: 302, headers: {
    Location: new URL("/ar/", url).toString(),
    Vary: "Accept-Language, Cookie", "Cache-Control": "private, no-store" } });
}
export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("lang") === "en") {
    return withVary(await context.next(), {
      "Set-Cookie": `es-lang=en; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure` });
  }
  const saved = readLangCookie(request);
  if (saved === "en") return withVary(await context.next());
  if (saved === "ar" || acceptsArabic(request)) return redirectToArabic(url);
  return withVary(await context.next());
}
