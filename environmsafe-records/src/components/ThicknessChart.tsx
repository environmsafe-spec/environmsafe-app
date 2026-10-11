import type { PointAnalysis } from '../lib/calc';

const COLORS = ['#1B1B3A', '#E39B22', '#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#be185d'];

/** Thickness over time for each measuring point, with the retirement line. */
export function ThicknessChart({ points, height = 260 }: { points: PointAnalysis[]; height?: number }) {
  const withHistory = points.filter((p) => p.readings.length > 0);
  if (!withHistory.length) return null;
  const all = withHistory.flatMap((p) => p.readings);
  const dates = all.map((r) => new Date(r.date).getTime());
  const vals = [...all.map((r) => r.measured), ...withHistory.map((p) => p.retirement ?? Infinity).filter(Number.isFinite)];
  let tMin = Math.min(...dates);
  let tMax = Math.max(...dates);
  if (tMin === tMax) {
    tMin -= 180 * 86400000;
    tMax += 180 * 86400000;
  }
  const vMin = Math.floor(Math.min(...vals) - 0.5);
  const vMax = Math.ceil(Math.max(...vals) + 0.5);
  const W = 640;
  const H = height;
  const L = 54;
  const R = 12;
  const T = 12;
  const B = 32;
  const x = (t: number) => L + ((t - tMin) / (tMax - tMin)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - vMin) / (vMax - vMin)) * (H - T - B);
  const yTicks = Array.from({ length: 5 }, (_, i) => vMin + ((vMax - vMin) * i) / 4);
  const years = new Set(all.map((r) => r.date.slice(0, 4)));
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Thickness trend chart">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" opacity="0.12" />
            <text x={L - 6} y={y(v) + 4} fontSize="15" textAnchor="end" fill="currentColor">{v.toFixed(1)}</text>
          </g>
        ))}
        {[...years].map((yr) => {
          const t = new Date(`${yr}-07-01`).getTime();
          if (t < tMin || t > tMax) return null;
          return <text key={yr} x={x(t)} y={H - 10} fontSize="15" textAnchor="middle" fill="currentColor">{yr}</text>;
        })}
        {withHistory.map((p, i) => {
          const c = COLORS[i % COLORS.length];
          const pts = p.readings.map((r) => `${x(new Date(r.date).getTime())},${y(r.measured)}`).join(' ');
          return (
            <g key={p.point}>
              {p.retirement != null && (
                <line x1={L} x2={W - R} y1={y(p.retirement)} y2={y(p.retirement)} stroke={c} strokeDasharray="5 4" opacity="0.6" />
              )}
              <polyline points={pts} fill="none" stroke={c} strokeWidth="2.5" />
              {p.readings.map((r) => (
                <circle key={r.date} cx={x(new Date(r.date).getTime())} cy={y(r.measured)} r="4" fill={c} />
              ))}
            </g>
          );
        })}
        <text x={12} y={T + 4} fontSize="15" fill="currentColor" transform={`rotate(-90 12 ${T + 4})`} textAnchor="end">mm</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {withHistory.map((p, i) => (
          <span key={p.point} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            {p.point}
          </span>
        ))}
        <span className="text-muted">Dashed line = retirement thickness</span>
      </figcaption>
    </figure>
  );
}
