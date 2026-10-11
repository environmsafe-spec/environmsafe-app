import { describe, expect, it } from 'vitest';
import {
  addMonths, analyseThickness, convertPressure, corrosionRate, dueBucket, formatNumber, formatPressure,
  fromPa, halfLifeIntervalMonths, nearDuplicateTags, normaliseTag, psvTolerancePa, psvWithinTolerance,
  remainingLife, revisionLabel, toPa, yearsBetween,
} from '../../src/lib/calc';

describe('pressure units', () => {
  it('1 bar = 1.0197 kg/cm²', () => {
    expect(convertPressure(1, 'bar', 'kgcm2')).toBeCloseTo(1.0197, 4);
  });
  it('1 kg/cm² = 14.223 psi', () => {
    expect(convertPressure(1, 'kgcm2', 'psi')).toBeCloseTo(14.223, 3);
  });
  it('1 MPa = 10 bar and round-trips through SI', () => {
    expect(convertPressure(1, 'mpa', 'bar')).toBeCloseTo(10, 9);
    expect(fromPa(toPa(42.5, 'psi'), 'psi')).toBeCloseTo(42.5, 9);
  });
  it('formats in the chosen unit', () => {
    expect(formatPressure(4_300_000, 'bar')).toBe('43 bar');
    expect(formatPressure(4_300_000, 'psi')).toBe('623.7 psi');
    expect(formatPressure(null, 'bar')).toBe('');
  });
});

describe('corrosion rate and remaining life', () => {
  it('computes mm/year', () => {
    expect(corrosionRate(12, 11, 4)).toBeCloseTo(0.25, 9);
  });
  it('never reports negative corrosion', () => {
    expect(corrosionRate(10, 10.2, 2)).toBe(0);
    expect(corrosionRate(10, 9, 0)).toBe(0);
  });
  it('remaining life = (t_actual − t_min) / rate', () => {
    expect(remainingLife(10.6, 8.2, 0.6)).toBeCloseTo(4, 9);
    expect(remainingLife(8, 8.2, 0.6)).toBe(0);
    expect(remainingLife(10, 8, 0)).toBe(Infinity);
  });
  it('next interval is half the remaining life, capped at 10 years', () => {
    expect(halfLifeIntervalMonths(4)).toBe(24);
    expect(halfLifeIntervalMonths(30)).toBe(120);
    expect(halfLifeIntervalMonths(Infinity)).toBe(120);
    expect(halfLifeIntervalMonths(0.5)).toBe(3);
  });
  it('analyses a thickness history per point', () => {
    const res = analyseThickness([
      { point: 'CML-04', date: '2021-10-01', measured: 11.2, retirement: 8.2 },
      { point: 'CML-04', date: '2025-10-01', measured: 10.6, retirement: 8.2 },
      { point: 'CML-04', date: '2026-10-01', measured: 10.2, retirement: 8.2 },
      { point: 'CML-01', date: '2026-10-01', measured: 11.6 },
    ]);
    expect(res.map((r) => r.point)).toEqual(['CML-01', 'CML-04']);
    const p4 = res[1];
    expect(p4.shortTermRate).toBeCloseTo(0.4 / yearsBetween('2025-10-01', '2026-10-01'), 6);
    expect(p4.longTermRate).toBeCloseTo(1.0 / yearsBetween('2021-10-01', '2026-10-01'), 6);
    expect(p4.governingRate).toBeCloseTo(p4.shortTermRate!, 9);
    expect(p4.remainingLife).toBeCloseTo((10.2 - 8.2) / p4.governingRate!, 6);
    expect(res[0].shortTermRate).toBeNull();
  });
});

describe('due dates', () => {
  it('adds months and clamps to month end', () => {
    expect(addMonths('2025-10-10', 12)).toBe('2026-10-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2025-11-15', 60)).toBe('2030-11-15');
  });
  it('places items in the right due bucket', () => {
    const today = '2026-10-10';
    expect(dueBucket('2026-10-09', today)).toBe('overdue');
    expect(dueBucket('2026-10-10', today)).toBe('d30');
    expect(dueBucket('2026-11-09', today)).toBe('d30');
    expect(dueBucket('2026-12-01', today)).toBe('d60');
    expect(dueBucket('2026-12-30', today)).toBe('d90');
    expect(dueBucket('2027-06-01', today)).toBe('later');
    expect(dueBucket(null, today)).toBe('none');
  });
});

describe('safety valve tolerance', () => {
  it('ASME VIII: ±2 psi up to 70 psi, ±3 % above', () => {
    expect(psvTolerancePa(toPa(50, 'psi'))).toBeCloseTo(toPa(2, 'psi'), 6);
    expect(psvTolerancePa(toPa(10, 'bar'))).toBeCloseTo(toPa(0.3, 'bar'), 6);
  });
  it('ASME I bands', () => {
    expect(psvTolerancePa(toPa(200, 'psi'), 'ASME I')).toBeCloseTo(toPa(6, 'psi'), 6);
    expect(psvTolerancePa(toPa(600, 'psi'), 'ASME I')).toBeCloseTo(toPa(10, 'psi'), 6);
    expect(psvTolerancePa(toPa(1500, 'psi'), 'ASME I')).toBeCloseTo(toPa(15, 'psi'), 6);
  });
  it('checks as-found / as-left against the set pressure', () => {
    const set = toPa(43, 'bar');
    expect(psvWithinTolerance(set, toPa(44.2, 'bar'))).toBe(true);
    expect(psvWithinTolerance(set, toPa(44.4, 'bar'))).toBe(false);
  });
});

describe('tags', () => {
  it('normalises tags in any client format', () => {
    expect(normaliseTag('PSV 18 111-1')).toBe('psv181111');
    expect(normaliseTag('21-PSV-003-2')).toBe('21psv0032');
  });
  it('warns about near-duplicates without assuming a format', () => {
    const existing = ['PSV-201A', 'SAS-PSV-660', 'PSV 18 111-1', 'V-201'];
    expect(nearDuplicateTags('psv 201a', existing)).toEqual(['PSV-201A']);
    expect(nearDuplicateTags('PSV-201B', existing)).toEqual(['PSV-201A']);
    expect(nearDuplicateTags('PSV18111-1', existing)).toEqual(['PSV 18 111-1']);
    expect(nearDuplicateTags('E-500', existing)).toEqual([]);
  });
});

describe('numbering', () => {
  const date = new Date(Date.UTC(2026, 9, 10));
  it('fills the scheme tokens', () => {
    expect(formatNumber('ES/{CLIENT}-{TYPE}-{YYYY}-{NN}', { client: 'ycsr', type: 'psv', date, n: 7 })).toBe('ES/YCSR-PSV-2026-07');
    expect(formatNumber('ES-R-12-{NNN}', { n: 1, date })).toBe('ES-R-12-001');
    expect(formatNumber('ES/{JOB}-DPR-{NNN}', { job: 'PC0251', n: 12, date })).toBe('ES/PC0251-DPR-012');
  });
  it('grows past the padding instead of wrapping', () => {
    expect(formatNumber('ES-R-12-{NN}', { n: 123, date })).toBe('ES-R-12-123');
  });
  it('labels revisions', () => {
    expect(revisionLabel(0)).toBe('Rev. 00');
    expect(revisionLabel(1)).toBe('Rev. 01');
  });
});
