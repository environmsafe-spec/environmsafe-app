// Engineering calculations. Pure functions, unit tested in tests/unit/calc.test.ts.
// Pressures are stored in pascals (SI) and shown in the unit the user chooses.

export type PressureUnit = 'bar' | 'kgcm2' | 'psi' | 'mpa' | 'kpa';

export const PRESSURE_UNITS: Record<PressureUnit, { label: string; pa: number }> = {
  bar: { label: 'bar', pa: 100_000 },
  kgcm2: { label: 'kg/cm²', pa: 98_066.5 },
  psi: { label: 'psi', pa: 6_894.757293168 },
  mpa: { label: 'MPa', pa: 1_000_000 },
  kpa: { label: 'kPa', pa: 1_000 },
};

export function toPa(value: number, unit: PressureUnit): number {
  return value * PRESSURE_UNITS[unit].pa;
}

export function fromPa(pa: number, unit: PressureUnit): number {
  return pa / PRESSURE_UNITS[unit].pa;
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  return fromPa(toPa(value, from), to);
}

/** Rounds for display: 3 significant decimals for small values, fewer for large. */
export function roundSmart(v: number): number {
  const a = Math.abs(v);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export function formatPressure(pa: number | null | undefined, unit: PressureUnit): string {
  if (pa == null || Number.isNaN(pa)) return '';
  return `${roundSmart(fromPa(pa, unit))} ${PRESSURE_UNITS[unit].label}`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
export function parseDate(d: string | Date): Date {
  if (d instanceof Date) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Adds calendar months; 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(date: string | Date, months: number): string {
  const d = parseDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return isoDate(target);
}

export function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function yearsBetween(a: string | Date, b: string | Date): number {
  return daysBetween(a, b) / 365.25;
}

export type DueBucket = 'overdue' | 'd30' | 'd60' | 'd90' | 'later' | 'none';

export function dueBucket(nextDue: string | null | undefined, today: string | Date = new Date()): DueBucket {
  if (!nextDue) return 'none';
  const days = daysBetween(today, nextDue);
  if (days < 0) return 'overdue';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'later';
}

// ---------------------------------------------------------------------------
// Thickness, corrosion rate and remaining life (API 510 / API 570 approach)
// ---------------------------------------------------------------------------

/** Corrosion rate in mm/year between two readings. Negative growth is reported as 0. */
export function corrosionRate(tPrevious: number, tCurrent: number, years: number): number {
  if (!(years > 0)) return 0;
  return Math.max(0, (tPrevious - tCurrent) / years);
}

/** Remaining life in years: (t_actual − t_required) / rate. Infinity when no measurable loss. */
export function remainingLife(tActual: number, tRequired: number, rate: number): number {
  if (tActual <= tRequired) return 0;
  if (!(rate > 0)) return Infinity;
  return (tActual - tRequired) / rate;
}

/**
 * Next inspection interval in months: half the remaining life, capped (10 years
 * by default for API 510 internal / on-stream inspection).
 */
export function halfLifeIntervalMonths(remainingLifeYears: number, capMonths = 120): number {
  if (!Number.isFinite(remainingLifeYears)) return capMonths;
  return Math.max(0, Math.min(capMonths, Math.floor((remainingLifeYears / 2) * 12)));
}

export interface ThicknessReading {
  point: string;
  date: string;
  measured: number;
  nominal?: number | null;
  retirement?: number | null;
}

export interface PointAnalysis {
  point: string;
  readings: ThicknessReading[];
  latest: ThicknessReading;
  shortTermRate: number | null;
  longTermRate: number | null;
  governingRate: number | null;
  remainingLife: number | null;
  retirement: number | null;
}

/** Groups readings by point and works out rates and remaining life for each. */
export function analyseThickness(readings: ThicknessReading[]): PointAnalysis[] {
  const byPoint = new Map<string, ThicknessReading[]>();
  for (const r of readings) {
    if (r.measured == null || Number.isNaN(Number(r.measured))) continue;
    const list = byPoint.get(r.point) ?? [];
    list.push({ ...r, measured: Number(r.measured) });
    byPoint.set(r.point, list);
  }
  const out: PointAnalysis[] = [];
  for (const [point, list] of byPoint) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const latest = list[list.length - 1];
    const retirement = [...list].reverse().find((r) => r.retirement != null)?.retirement ?? null;
    let shortTermRate: number | null = null;
    let longTermRate: number | null = null;
    if (list.length >= 2) {
      const prev = list[list.length - 2];
      shortTermRate = corrosionRate(prev.measured, latest.measured, yearsBetween(prev.date, latest.date));
      const first = list[0];
      longTermRate = corrosionRate(first.measured, latest.measured, yearsBetween(first.date, latest.date));
    }
    const governingRate =
      shortTermRate == null && longTermRate == null ? null : Math.max(shortTermRate ?? 0, longTermRate ?? 0);
    const rl =
      retirement == null || governingRate == null ? null : remainingLife(latest.measured, Number(retirement), governingRate);
    out.push({ point, readings: list, latest, shortTermRate, longTermRate, governingRate, remainingLife: rl, retirement });
  }
  return out.sort((a, b) => a.point.localeCompare(b.point, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------
// Safety valve set pressure tolerance
// ---------------------------------------------------------------------------
export type PsvCode = 'ASME VIII' | 'ASME I';

const PSI = PRESSURE_UNITS.psi.pa;

/** Allowed ± deviation from set pressure, in pascals. */
export function psvTolerancePa(setPa: number, code: PsvCode = 'ASME VIII'): number {
  const psi = setPa / PSI;
  if (code === 'ASME I') {
    if (psi <= 70) return 2 * PSI;
    if (psi <= 300) return setPa * 0.03;
    if (psi <= 1000) return 10 * PSI;
    return setPa * 0.01;
  }
  // ASME VIII Div. 1 (UG-126): ±2 psi up to 70 psi, ±3 % above.
  return psi <= 70 ? 2 * PSI : setPa * 0.03;
}

export function psvWithinTolerance(setPa: number, measuredPa: number, code: PsvCode = 'ASME VIII'): boolean {
  return Math.abs(measuredPa - setPa) <= psvTolerancePa(setPa, code) + 1e-6;
}

/** Deviation as a percentage of set pressure (positive = popped high). */
export function psvDeviationPct(setPa: number, measuredPa: number): number {
  return ((measuredPa - setPa) / setPa) * 100;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------
export function normaliseTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Finds existing tags that look like the new one ("PSV-201A" vs "PSV 201A" or
 * "PSV-201B"). Never blocks: the user decides.
 */
export function nearDuplicateTags(newTag: string, existing: string[]): string[] {
  const n = normaliseTag(newTag);
  if (!n) return [];
  return existing.filter((t) => {
    const e = normaliseTag(t);
    if (!e) return false;
    if (e === n) return true;
    return n.length >= 4 && levenshtein(e, n) <= 1;
  });
}

// ---------------------------------------------------------------------------
// Document numbering (preview only; the database allocates the real number)
// ---------------------------------------------------------------------------
export function formatNumber(
  pattern: string,
  t: { client?: string; type?: string; job?: string; date?: Date; n: number },
): string {
  const d = t.date ?? new Date();
  let s = pattern
    .replaceAll('{CLIENT}', (t.client || 'X').toUpperCase())
    .replaceAll('{TYPE}', (t.type || 'GEN').toUpperCase())
    .replaceAll('{JOB}', (t.job || 'JOB').toUpperCase())
    .replaceAll('{YYYY}', String(d.getUTCFullYear()))
    .replaceAll('{YY}', String(d.getUTCFullYear()).slice(2))
    .replaceAll('{MM}', String(d.getUTCMonth() + 1).padStart(2, '0'));
  const m = s.match(/\{(N+)\}/);
  if (!m) return `${s}-${String(t.n).padStart(3, '0')}`;
  s = s.replace(/\{N+\}/, String(t.n).padStart(m[1].length, '0'));
  return s;
}

export function revisionLabel(rev: number): string {
  return `Rev. ${String(rev).padStart(2, '0')}`;
}
