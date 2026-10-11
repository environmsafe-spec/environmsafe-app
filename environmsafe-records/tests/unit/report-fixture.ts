// Demonstration data for the document tests: a pressure vessel inspected in
// 2025 and again a year later, with carried-over findings, readings, photos,
// a PSV certificate, a hydrostatic test and a job with daily reports.
import path from 'node:path';
import type { CertBundle, DprBundle, InspectionBundle, Library, RegisterBundle } from '../../src/reports/build';
import { DEFAULT_TEMPLATES } from '../../src/reports/defaults';
import type { ImageData } from '../../src/reports/model';
import type { Asset, Certificate, Client, Dpr, EquipmentType, Finding, FindingUpdate, Inspection, JobItem, Job, Reading, Site } from '../../src/lib/types';

const H = { created_at: '2026-10-01T08:00:00Z', field_ts: {} };

export function fixture(jpeg: (f: string) => ImageData) {
  const fx = (n: string) => path.resolve(__dirname, '../fixtures', n);
  const lib: Library = {
    inspectionTypes: [
      { id: 't1', code: 'EXT', name: 'External visual inspection', category: 'Visual', standards: ['API 510'], active: true, sort: 1, checklist: [
        { id: 'ext1', text: 'Nameplate present and legible', kind: 'ync' }, { id: 'ext2', text: 'Shell / body free of visible corrosion, dents or bulges', kind: 'ync' },
        { id: 'ext5', text: 'Supports, saddles, foundations and anchor bolts in good condition', kind: 'ync' }, { id: 'ext8', text: 'No leaks observed', kind: 'ync' }] },
      { id: 't2', code: 'PSV', name: 'PSV set pressure test and overhaul', category: '', standards: [], active: true, sort: 2, checklist: [] },
      { id: 't3', code: 'HYDRO', name: 'Hydrostatic / pressure test', category: '', standards: [], active: true, sort: 3, checklist: [] },
      { id: 't4', code: 'UT', name: 'UT thickness survey', category: '', standards: [], active: true, sort: 4, checklist: [] },
    ],
    equipmentTypes: [],
    textBlocks: [
      { id: 'b1', key: 'scope_general', category: 'scope', title: 'General scope', active: true, body: 'The scope of work covered the inspection of the equipment listed in this report in accordance with the referenced codes and the client\'s requirements.' },
      { id: 'b2', key: 'method_visual', category: 'methodology', title: 'Visual', active: true, body: 'We carried out a close visual examination of the accessible external surfaces, welds, nozzles, supports and attachments, using hand lamps, mirrors and gauges where needed. Conditions found were recorded and photographed.' },
      { id: 'b3', key: 'lim_general', category: 'limitations', title: 'General', active: true, body: 'This report records the condition of the equipment as found on the date of inspection, within the scope and access available. Areas that were insulated, buried, inaccessible or not prepared were not examined unless stated. Where the origin of a condition cannot be established from the as-found condition, this is stated.' },
    ],
    refLists: {
      priority: [{ code: 'P1', label: 'P1', desc: 'Action within 6 months.' }, { code: 'P2', label: 'P2', desc: 'Action at the next shutdown and not later than the set due date.' }, { code: 'P3', label: 'P3', desc: 'Continuous or routine attention.' }],
      conclusion: [{ code: 'fit_conditions', label: '', desc: 'The equipment is considered fit for continued service subject to the conditions and recommendations stated in this report being completed by the dates given.' }],
    },
  };
  const eq: EquipmentType = { id: 'e1', code: 'PV', name: 'Pressure vessel', category: '', active: true, sort: 1, checklists: {}, default_intervals: [{ type: 'EXT', months: 60 }, { type: 'UT', months: 120, basis: 'half_life' }],
    custom_fields: [{ key: 'orientation', label: 'Orientation', type: 'select' }, { key: 'corrosion_allowance', label: 'Corrosion allowance (mm)', type: 'number' }] };
  const client: Client = { ...H, id: 'c1', name: 'DEMO – Sample Process Plant (not a real client)', code: 'DEMO', contacts: [], address: '', notes: '', logo_path: null, status: 'active' };
  const site: Site = { ...H, id: 's1', client_id: 'c1', name: 'Demo Utilities Area', area: '', location: '', lat: null, lng: null, notes: '' };
  const asset: Asset = {
    ...H, id: 'a1', client_id: 'c1', site_id: 's1', parent_id: null, tag: 'V-201', equipment_type_id: 'e1', description: 'Air receiver / pressure vessel', manufacturer: 'Demo Fabricators',
    model: 'AR-10', serial_no: 'DF-5521', year_built: 2012, design: { design_pressure_pa: 1_200_000, mawp_pa: 1_200_000, design_temp_c: 80, capacity: '10 m³', material: 'SA-516 Gr 70', code: 'ASME VIII-1' },
    service: 'Compressed air', location: 'Compressor house', status: 'in_service', criticality: 'medium', custom: { orientation: 'Vertical', corrosion_allowance: 3 }, intervals: {}, notes: '',
  };
  const baseInsp = {
    ...H, client_id: 'c1', asset_id: 'a1', job_id: 'j1', standard: 'API 510', code_edition: '2022', inspector_id: null, witness: 'Demo Plant Engineer', is_historical: false, contractor: '',
    checklist: {}, results: {}, limitations: '', recommendations: '', report_no: null, revision: 0, supersedes_id: null, signature: {}, submitted_at: null, issued_at: null, issued_by: null,
  };
  const _insp1: Inspection = { ...baseInsp, id: 'i1', type_code: 'EXT', inspection_date: '2025-10-10', inspector_name: 'Demo Inspector', status: 'issued', is_historical: true, summary: '', conclusion: 'fit_conditions', conclusion_text: '', interval_months: 12, next_due: '2026-10-10', report_no: 'ES/DEMO-EXT-2025-001' };
  const insp2: Inspection = {
    ...baseInsp, id: 'i2', type_code: 'EXT', inspection_date: '2026-10-10', inspector_name: 'Demo Inspector', status: 'issued', report_no: 'ES/DEMO-EXT-2026-001',
    summary: 'We carried out an external visual inspection and an ultrasonic thickness survey of the air receiver. External corrosion at the bottom head has progressed since the previous inspection. The drain valve has been replaced. The origin of the pitting at the north support leg could not be established from the as-found condition.',
    checklist: { ext1: { answer: 'yes' }, ext2: { answer: 'no', note: 'Corrosion at bottom head' }, ext5: { answer: 'no', note: 'Pitting at north leg' }, ext8: { answer: 'yes' } },
    conclusion: 'fit_conditions', conclusion_text: 'The equipment is considered fit for continued service subject to the conditions and recommendations stated in this report being completed by the dates given.',
    recommendations: 'Restore the coating system on the bottom head and support legs before the next inspection.',
    limitations: 'The internal surfaces were not examined within the scope of this inspection.', interval_months: 12, next_due: '2027-10-10',
    signature: { name: 'Demo Inspector', title: 'Senior Inspector', cert_no: 'API 510 #00000', signed_at: '2026-10-10T14:00:00Z' }, issued_at: '2026-10-11T09:00:00Z',
  };
  void _insp1;
  const f = (id: string, n: number, title: string, p: 'P1' | 'P2' | 'P3', status: Finding['status'], insp: string, raised: string, extra: Partial<Finding> = {}): Finding => ({
    ...H, id, client_id: 'c1', asset_id: 'a1', inspection_id: insp, number: n, ref: `F-${String(n).padStart(3, '0')}`, title, description: '', location: '', severity: 'medium', priority: p,
    category: '', damage_mechanism: '', code_ref: '', recommendation: '', status, due_date: null, owner: '', raised_date: raised, closed_date: null, justification: '', ...extra,
  });
  const f1 = f('f1', 1, 'External corrosion at bottom head', 'P1', 'open_deteriorated', 'i1', '2025-10-10', { location: 'Bottom head, 6 o\'clock' });
  const f2 = f('f2', 2, 'Drain valve passing', 'P2', 'closed', 'i1', '2025-10-10');
  const f3 = f('f3', 3, 'Nameplate partly illegible', 'P3', 'open_unchanged', 'i1', '2025-10-10');
  const f4 = f('f4', 4, 'Pitting at north support leg', 'P1', 'open', 'i2', '2026-10-10', { location: 'North leg, 300 mm above base plate', severity: 'high', recommendation: 'Clean to bare metal, measure pit depth and assess against API 579-1 Part 6; restore coating.', due_date: '2027-04-10', description: 'Scattered pitting up to an estimated 1.5 mm deep over an area of approx. 150 × 200 mm.' });
  const f5 = f('f5', 5, 'Earthing strap loose', 'P3', 'open', 'i2', '2026-10-10', { severity: 'low', recommendation: 'Re-tighten and test the earthing connection.' });
  const u = (id: string, fid: string, status: FindingUpdate['status'], note: string): FindingUpdate => ({ ...H, id, finding_id: fid, client_id: 'c1', inspection_id: 'i2', update_date: '2026-10-10', status, note, photo_doc_id: null, by_name: 'Demo Inspector' });
  const updates = [u('u1', 'f1', 'open_deteriorated', 'Pitting deeper; coating breakdown now approx. 45 % of the head.'), u('u2', 'f2', 'closed', 'Valve replaced by client in March 2026.'), u('u3', 'f3', 'open_unchanged', 'No change.')];
  const r = (id: string, insp: string | null, point: string, loc: string, nominal: number, measured: number, tmin: number, date: string): Reading => ({ ...H, id, inspection_id: insp, asset_id: 'a1', client_id: 'c1', kind: 'ut', point, location: loc, nominal, measured, previous: null, retirement: tmin, unit: 'mm', reading_date: date, data: {}, sort: Number(point.slice(-1)) });
  const readings: Reading[] = [
    r('r1', null, 'CML-01', 'Top head', 12, 11.8, 8.2, '2021-10-01'), r('r2', null, 'CML-04', 'Bottom head', 12, 11.2, 8.2, '2021-10-01'), r('r3', null, 'CML-05', 'Drain nozzle', 7.1, 6.5, 4.0, '2021-10-01'),
    r('r4', 'i1', 'CML-01', 'Top head', 12, 11.6, 8.2, '2025-10-10'), r('r5', 'i1', 'CML-04', 'Bottom head', 12, 10.6, 8.2, '2025-10-10'), r('r6', 'i1', 'CML-05', 'Drain nozzle', 7.1, 6.0, 4.0, '2025-10-10'),
    r('r7', 'i2', 'CML-01', 'Top head', 12, 11.5, 8.2, '2026-10-10'), r('r8', 'i2', 'CML-04', 'Bottom head', 12, 10.1, 8.2, '2026-10-10'), r('r9', 'i2', 'CML-05', 'Drain nozzle', 7.1, 5.8, 4.0, '2026-10-10'),
  ];
  const photos = [1, 2, 3, 4].map((i) => ({ image: jpeg(fx(`photo${i}.jpg`)), caption: ['Bottom head – external corrosion (F-001)', 'Drain nozzle N5 with new valve (F-002)', 'Nameplate (F-003)', 'Pitting at north support leg (F-004)'][i - 1] }));
  const sig = jpeg(fx('signature.jpg'));
  const job: Job = { ...H, id: 'j1', client_id: 'c1', site_id: 's1', number: 'DEMO-PC0001', title: 'Demo boiler shutdown inspection', scope: 'Internal and external inspection of B-101, PSV overhaul and UT survey of V-201 / V-202 and P-301.', start_date: '2026-10-07', end_date: '2026-10-14', team: 'Demo Inspector, Demo NDT Technician', status: 'in_progress', notes: '' };
  const holds: JobItem[] = [
    { ...H, id: 'h1', job_id: 'j1', client_id: 'c1', kind: 'hold', ref_no: 'H-01', title: 'Boiler internal access', description: 'Gas-free certificate required before drum entry.', raised_date: '2026-10-08', closed_date: null, status: 'open', raised_by_name: 'Demo Inspector' },
    { ...H, id: 'h2', job_id: 'j1', client_id: 'c1', kind: 'observation', ref_no: 'O-01', title: 'Scaffold tag missing at drum level', description: '', raised_date: '2026-10-08', closed_date: '2026-10-09', status: 'closed', raised_by_name: 'Demo Inspector' },
  ];
  const dpr: Dpr = {
    ...H, id: 'd3', job_id: 'j1', client_id: 'c1', number: 'ES/DEMO-PC0001-DPR-003', seq: 3, report_date: '2026-10-09', manpower: [{ role: 'Inspector', count: 1 }, { role: 'NDT technician', count: 1 }, { role: 'Helper', count: 2 }],
    hours_worked: 20, toolbox_talks: 'Pressure testing safety', hse: { lti: 0, first_aid: 0, near_miss: 0 },
    activities: [{ discipline: 'PSV', description: 'As-found tests of PSV-101A, 21-PSV-003-2, PSV 18 111-1' }, { discipline: 'NDT', description: 'UT survey of V-201 completed (5 CMLs)' }],
    progress_planned: 50, progress_actual: 45, observations: '', planned_next: 'PSV overhaul and as-left tests\nUT of P-301', issues: 'Gas-free certificate for drum entry still awaited (H-01).', status: 'submitted', revision: 0, supersedes_id: null, issued_at: null,
  };
  const psvAsset: Asset = { ...asset, id: 'a2', tag: 'PSV-101A', description: 'Steam drum safety valve A', manufacturer: 'Demo Valves', model: 'SV-3', serial_no: 'DV-1101', service: 'Steam',
    custom: { set_pressure: 4_300_000, inlet_size: '3 in', outlet_size: '4 in', valve_type: 'Conventional spring', protected_item: 'B-101 steam drum', orifice: 'J' }, design: {} };
  const psvInsp: Inspection = { ...baseInsp, id: 'i3', asset_id: 'a2', type_code: 'PSV', inspection_date: '2026-10-09', inspector_name: 'Demo Inspector', status: 'issued', summary: '', conclusion: 'fit', conclusion_text: '', interval_months: 12, next_due: '2027-10-09',
    signature: { name: 'Demo Inspector', title: 'Senior Inspector', cert_no: 'API 510 #00000', signed_at: '2026-10-09T15:00:00Z' },
    results: { psv: { set_pressure_pa: 4_300_000, cdtp_pa: 4_300_000, as_found_pa: 4_460_000, as_left_pa: 4_310_000, reseat_pa: 4_050_000, seat_tightness: 'pass', test_medium: 'Air', bench: 'ES-TB-01', gauge: 'G-114 (cal. due 2027-03)', result: 'pass', code: 'ASME I',
      parts: [{ part: 'Disc', condition: 'Light wire drawing', action: 'Lapped' }, { part: 'Seat', condition: 'Light wire drawing', action: 'Lapped' }, { part: 'Spring', condition: 'Good', action: 'None' }] } } };
  const cert: Certificate = { ...H, id: 'x1', client_id: 'c1', asset_id: 'a2', inspection_id: 'i3', job_id: 'j1', kind: 'psv', number: 'ES-R-12-001', data: { witness: 'Demo Plant Engineer', valid_until: '2027-10-09' }, status: 'issued', revision: 0, supersedes_id: null, issued_at: '2026-10-10T10:00:00Z', issued_by: null, issued_by_name: 'Demo Office Lead', issued_by_cert: '', signature: {} };
  const hydroInsp: Inspection = { ...baseInsp, id: 'i4', type_code: 'HYDRO', inspection_date: '2026-10-09', inspector_name: 'Demo Inspector', status: 'issued', summary: '', conclusion: 'fit', conclusion_text: '', interval_months: null, next_due: null,
    results: { pressure: { design_pressure_pa: 1_200_000, test_pressure_pa: 1_560_000, hold_minutes: 30, test_medium: 'Water', water_temp_c: 24, gauges: 'G-114, G-115', start_time: '10:05', end_time: '10:35', pressure_drop_pa: null, result: 'pass' } } };
  const hydroCert: Certificate = { ...cert, id: 'x2', asset_id: 'a1', inspection_id: 'i4', kind: 'hydro', number: 'ES-H-2026-001' };

  const inspectionBundle: InspectionBundle = {
    insp: insp2, asset, eqType: eq, client, site, job,
    previous: [{ finding: f1, update: updates[0], before: 'open' }, { finding: f2, update: updates[1], before: 'open' }, { finding: f3, update: updates[2], before: 'open' }],
    newFindings: [f4, f5], readings, photos, certificates: [hydroCert], history: [{ rev: 0, date: '2026-10-11', text: 'First issue' }],
    inspectorSignature: sig, checklist: lib.inspectionTypes[0].checklist,
  };
  const dprBundle: DprBundle = { dpr, job, client, site, holds, photos: [{ image: jpeg(fx('photo5.jpg')), caption: 'PSV-101A on the test bench' }, { image: jpeg(fx('photo6.jpg')), caption: 'Boiler B-101 front' }], dayNumber: 3 };
  const psvCertBundle: CertBundle = { cert, asset: psvAsset, client, site, insp: psvInsp, findings: [], readings: [], inspectorSignature: sig };
  const hydroCertBundle: CertBundle = { cert: hydroCert, asset, client, site, insp: hydroInsp, findings: [], readings: [], inspectorSignature: sig };
  const registerBundle: RegisterBundle = {
    client, job, site, assets: [asset, psvAsset], inspections: [insp2, psvInsp, hydroInsp], findings: [f1, f2, f3, f4, f5], updates, readings, dprs: [dpr], holds, certificates: [cert, hydroCert],
    photos: photos.slice(0, 2), today: '2026-10-10',
    due: [{ asset, typeCode: 'EXT', lastDate: '2026-10-10', nextDue: '2027-10-10' }, { asset, typeCode: 'UT', lastDate: '2021-10-01', nextDue: '2026-09-30' }, { asset: psvAsset, typeCode: 'PSV', lastDate: '2026-10-09', nextDue: '2026-11-01' }],
  };
  const templates = Object.fromEntries(Object.entries(DEFAULT_TEMPLATES).map(([k, v]) => [k, v]));
  return { lib, templates, inspectionBundle, dprBundle, psvCertBundle, hydroCertBundle, registerBundle };
}
