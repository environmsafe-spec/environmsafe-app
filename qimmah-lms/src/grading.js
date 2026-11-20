// Automatic grading. Short answers are compared after normalising Arabic text
// and digits, and numerically when both sides are numbers or simple fractions.

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalize(input) {
  let s = String(input ?? '').trim();
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s
    .replace(/[ً-ْـ]/g, '') // tashkeel + tatweel
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة(?=\s|$)/g, 'ه')
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/[،,٬]/g, '') // thousands separators
    .replace(/[‎‏]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return s;
}

function toNumber(s) {
  if (/^[-+]?\d*\.?\d+$/.test(s)) return parseFloat(s);
  const frac = s.match(/^([-+]?\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  const pct = s.match(/^([-+]?\d*\.?\d+)%$/);
  if (pct) return parseFloat(pct[1]);
  return null;
}

export function shortAnswerCorrect(given, accepted) {
  const g = normalize(given);
  if (!g) return false;
  const gn = toNumber(g);
  for (const a of accepted) {
    const n = normalize(a);
    if (n === g) return true;
    const an = toNumber(n);
    if (gn !== null && an !== null && Math.abs(gn - an) < 1e-9) return true;
  }
  return false;
}

export function gradeQuestion(q, given) {
  const answer = JSON.parse(q.answer);
  let correct = false;
  if (q.kind === 'mcq') correct = given !== null && given !== undefined && Number(given) === Number(answer);
  else if (q.kind === 'tf') correct = typeof given === 'boolean' && given === answer;
  else if (q.kind === 'short') correct = shortAnswerCorrect(given, Array.isArray(answer) ? answer : [answer]);
  return { correct, answer };
}
