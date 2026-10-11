// Gathers the data for a report from the device and turns stored files into
// images for the renderers. Runs in the browser only.

import logoUrl from '../assets/report-logo.jpg?url';
import { computeDue, notDeleted } from '../lib/domain';
import { db } from '../lib/db';
import { getFileBlob } from '../lib/files';
import type {
  Asset, Certificate, Client, DocumentRow, Dpr, EquipmentType, Finding, FindingUpdate, Inspection, InspectionType, Job, JobItem, Reading,
  RefList, Settings, Site, TextBlock,
} from '../lib/types';
import type { CertBundle, DprBundle, InspectionBundle, Library, Photo, RegisterBundle } from './build';
import { DEFAULT_BRANDING, type ImageData, type RenderContext } from './model';

async function blobToImage(blob: Blob): Promise<ImageData | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const isPng = blob.type === 'image/png';
    const data = new Uint8Array(await blob.arrayBuffer());
    const out = { data, width: bmp.width, height: bmp.height, type: (isPng ? 'png' : 'jpg') as 'png' | 'jpg' };
    bmp.close?.();
    if (!isPng && blob.type !== 'image/jpeg') {
      // Re-encode other formats (e.g. WebP) as JPEG, which both renderers accept.
      const c = document.createElement('canvas');
      c.width = out.width;
      c.height = out.height;
      c.getContext('2d')!.drawImage(await createImageBitmap(blob), 0, 0);
      const j: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
      return { ...out, data: new Uint8Array(await j.arrayBuffer()), type: 'jpg' };
    }
    return out;
  } catch {
    return null;
  }
}

export async function imageFromPath(path: string | null | undefined): Promise<ImageData | null> {
  if (!path) return null;
  const b = await getFileBlob(path);
  return b ? blobToImage(b) : null;
}

export async function loadContext(): Promise<RenderContext> {
  const s = (await db.settings.get(1)) as Settings | undefined;
  let logo = s?.branding?.logo_path ? await imageFromPath(s.branding.logo_path) : null;
  if (!logo) logo = await blobToImage(await (await fetch(logoUrl)).blob());
  return {
    company: {
      legal_name: s?.company?.legal_name ?? 'EnvironmSafe for Engineering, Trading & Services Ltd.',
      tagline: s?.company?.tagline ?? 'Inspection & Testing Services',
      website: s?.company?.website ?? 'www.environmsafe.com',
      email: s?.company?.email ?? 'support@environmsafe.com',
      phone: s?.company?.phone ?? '+967 78 340 2932',
      address: s?.company?.address ?? 'Al Buraiqah, Aden, Yemen',
    },
    branding: { ...DEFAULT_BRANDING, ...(s?.branding ? { navy: s.branding.navy || DEFAULT_BRANDING.navy, accent: s.branding.accent || DEFAULT_BRANDING.accent, text: s.branding.text || DEFAULT_BRANDING.text } : {}) },
    logo: logo!,
  };
}

export async function loadLibrary(): Promise<Library> {
  const [it, et, tb, rl] = await Promise.all([
    db.inspection_types.toArray() as Promise<InspectionType[]>,
    db.equipment_types.toArray() as Promise<EquipmentType[]>,
    db.text_blocks.toArray() as Promise<TextBlock[]>,
    db.ref_lists.toArray() as Promise<RefList[]>,
  ]);
  return {
    inspectionTypes: it.filter(notDeleted), equipmentTypes: et.filter(notDeleted), textBlocks: tb.filter(notDeleted),
    refLists: Object.fromEntries(rl.map((r) => [r.key, r.items])),
  };
}

async function photosFor(filter: (d: DocumentRow) => boolean, max = 60): Promise<Photo[]> {
  const docs = ((await db.documents.toArray()) as DocumentRow[]).filter(notDeleted).filter((d) => (d.kind === 'photo' || d.kind === 'nameplate') && filter(d)).sort((a, b) => a.sort - b.sort).slice(0, max);
  const out: Photo[] = [];
  for (const d of docs) {
    const image = await imageFromPath(d.file_path);
    if (image) out.push({ image, caption: d.caption });
  }
  return out;
}

export async function loadInspection(id: string, lib: Library): Promise<InspectionBundle> {
  const insp = (await db.inspections.get(id)) as Inspection;
  const asset = (await db.assets.get(insp.asset_id)) as Asset;
  const [client, site, job, findings, updates, readings, certs, allInsp] = await Promise.all([
    db.clients.get(insp.client_id) as Promise<Client>,
    asset.site_id ? (db.sites.get(asset.site_id) as Promise<Site | undefined>) : Promise.resolve(undefined),
    insp.job_id ? (db.jobs.get(insp.job_id) as Promise<Job | undefined>) : Promise.resolve(undefined),
    db.findings.where('asset_id').equals(asset.id).toArray() as Promise<Finding[]>,
    db.finding_updates.toArray() as Promise<FindingUpdate[]>,
    db.readings.where('asset_id').equals(asset.id).toArray() as Promise<Reading[]>,
    db.certificates.toArray() as Promise<Certificate[]>,
    db.inspections.where('asset_id').equals(asset.id).toArray() as Promise<Inspection[]>,
  ]);
  // A revision keeps the readings and findings of the version it replaces.
  const chain = [insp.id];
  let cur: Inspection | undefined = insp;
  while (cur?.supersedes_id) {
    chain.push(cur.supersedes_id);
    cur = allInsp.find((i) => i.id === cur!.supersedes_id);
  }
  const live = findings.filter(notDeleted);
  const myUpdates = updates.filter(notDeleted).filter((u) => u.inspection_id && chain.includes(u.inspection_id));
  const previous = live
    .filter((f) => !f.inspection_id || !chain.includes(f.inspection_id))
    .filter((f) => f.raised_date <= insp.inspection_date)
    .map((f) => {
      const update = myUpdates.find((u) => u.finding_id === f.id);
      const before = updates.filter((u) => u.finding_id === f.id && !u.deleted_at && u.update_date < insp.inspection_date).sort((a, b) => a.update_date.localeCompare(b.update_date)).pop()?.status ?? 'open';
      return { finding: f, update, before };
    })
    .filter((x) => x.update || !['closed', 'superseded'].includes(x.before));
  const eqType = lib.equipmentTypes.find((e) => e.id === asset.equipment_type_id);
  const itype = lib.inspectionTypes.find((t) => t.code === insp.type_code);
  const checklist = eqType?.checklists?.[insp.type_code]?.length ? eqType.checklists[insp.type_code] : itype?.checklist ?? [];
  const history = allInsp
    .filter((i) => chain.includes(i.id))
    .sort((a, b) => a.revision - b.revision)
    .map((i) => ({ rev: i.revision, date: (i.issued_at ?? i.submitted_at ?? i.inspection_date).slice(0, 10), text: i.revision === 0 ? 'First issue' : 'Revised' }));
  return {
    insp, asset, eqType, client, site, job,
    previous: previous.map((p) => ({ ...p, before: p.before as Finding['status'] })),
    newFindings: live.filter((f) => f.inspection_id && chain.includes(f.inspection_id)).sort((a, b) => (a.number ?? 999) - (b.number ?? 999)),
    readings: readings.filter(notDeleted).map((r) => (r.inspection_id && chain.includes(r.inspection_id) ? { ...r, inspection_id: insp.id } : r)),
    photos: await photosFor((d) => !!d.inspection_id && chain.includes(d.inspection_id)),
    certificates: certs.filter(notDeleted).filter((c) => c.inspection_id && chain.includes(c.inspection_id) && c.status === 'issued'),
    history,
    inspectorSignature: await imageFromPath(insp.signature?.image_path),
    checklist,
  };
}

export async function loadDpr(id: string): Promise<DprBundle> {
  const dpr = (await db.dprs.get(id)) as Dpr;
  const job = (await db.jobs.get(dpr.job_id)) as Job;
  const [client, site, holds, all] = await Promise.all([
    db.clients.get(dpr.client_id) as Promise<Client>,
    job.site_id ? (db.sites.get(job.site_id) as Promise<Site | undefined>) : Promise.resolve(undefined),
    db.job_items.where('job_id').equals(job.id).toArray() as Promise<JobItem[]>,
    db.dprs.where('job_id').equals(job.id).toArray() as Promise<Dpr[]>,
  ]);
  const days = all.filter(notDeleted).map((x) => x.report_date).sort();
  return { dpr, job, client, site, holds: holds.filter(notDeleted).filter((h) => h.raised_date <= dpr.report_date), photos: await photosFor((d) => d.dpr_id === dpr.id, 24), dayNumber: days.indexOf(dpr.report_date) + 1 };
}

export async function loadCertificate(id: string, lib: Library): Promise<CertBundle> {
  const cert = (await db.certificates.get(id)) as Certificate;
  const asset = (await db.assets.get(cert.asset_id)) as Asset;
  const insp = cert.inspection_id ? ((await db.inspections.get(cert.inspection_id)) as Inspection | undefined) : undefined;
  const [client, site, findings, readings] = await Promise.all([
    db.clients.get(cert.client_id) as Promise<Client>,
    asset.site_id ? (db.sites.get(asset.site_id) as Promise<Site | undefined>) : Promise.resolve(undefined),
    insp ? (db.findings.where('inspection_id').equals(insp.id).toArray() as Promise<Finding[]>) : Promise.resolve([]),
    db.readings.where('asset_id').equals(asset.id).toArray() as Promise<Reading[]>,
  ]);
  return {
    cert, asset, client, site, insp, eqType: lib.equipmentTypes.find((e) => e.id === asset.equipment_type_id),
    findings: findings.filter(notDeleted), readings: readings.filter(notDeleted), inspectorSignature: await imageFromPath(insp?.signature?.image_path),
  };
}

export interface RegisterScope {
  clientId: string;
  jobId?: string;
  assetIds?: string[];
  from?: string;
  to?: string;
  findingFilter?: 'all' | 'open' | 'p1';
  includePhotos?: boolean;
}

export async function loadRegister(scope: RegisterScope): Promise<RegisterBundle> {
  const client = (await db.clients.get(scope.clientId)) as Client;
  const job = scope.jobId ? ((await db.jobs.get(scope.jobId)) as Job | undefined) : undefined;
  const site = job?.site_id ? ((await db.sites.get(job.site_id)) as Site | undefined) : undefined;
  let assets = ((await db.assets.where('client_id').equals(scope.clientId).toArray()) as Asset[]).filter(notDeleted);
  let inspections = ((await db.inspections.where('client_id').equals(scope.clientId).toArray()) as Inspection[]).filter(notDeleted).filter((i) => i.status !== 'draft' && i.status !== 'revised');
  if (job) {
    inspections = inspections.filter((i) => i.job_id === job.id);
    const ids = new Set(inspections.map((i) => i.asset_id));
    assets = assets.filter((a) => ids.has(a.id));
  }
  if (scope.assetIds?.length) {
    const set = new Set(scope.assetIds);
    assets = assets.filter((a) => set.has(a.id));
    inspections = inspections.filter((i) => set.has(i.asset_id));
  }
  if (scope.from) inspections = inspections.filter((i) => i.inspection_date >= scope.from!);
  if (scope.to) inspections = inspections.filter((i) => i.inspection_date <= scope.to!);
  const assetSet = new Set(assets.map((a) => a.id));
  let findings = ((await db.findings.where('client_id').equals(scope.clientId).toArray()) as Finding[]).filter(notDeleted).filter((f) => assetSet.has(f.asset_id));
  if (scope.findingFilter === 'open') findings = findings.filter((f) => !['closed', 'superseded'].includes(f.status));
  if (scope.findingFilter === 'p1') findings = findings.filter((f) => f.priority === 'P1' && !['closed', 'superseded'].includes(f.status));
  findings.sort((a, b) => a.asset_id.localeCompare(b.asset_id) || (a.number ?? 0) - (b.number ?? 0));
  const fset = new Set(findings.map((f) => f.id));
  const inspIds = new Set(inspections.map((i) => i.id));
  const [updates, readings, dprs, holds, certs] = await Promise.all([
    db.finding_updates.toArray() as Promise<FindingUpdate[]>,
    db.readings.where('client_id').equals(scope.clientId).toArray() as Promise<Reading[]>,
    job ? (db.dprs.where('job_id').equals(job.id).toArray() as Promise<Dpr[]>) : Promise.resolve([] as Dpr[]),
    job ? (db.job_items.where('job_id').equals(job.id).toArray() as Promise<JobItem[]>) : Promise.resolve([] as JobItem[]),
    db.certificates.where('client_id').equals(scope.clientId).toArray() as Promise<Certificate[]>,
  ]);
  const due = (await computeDue()).filter((x) => x.client?.id === scope.clientId && assetSet.has(x.asset.id));
  return {
    client, job, site, assets: assets.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })),
    inspections: inspections.sort((a, b) => a.inspection_date.localeCompare(b.inspection_date)),
    findings, updates: updates.filter(notDeleted).filter((u) => fset.has(u.finding_id)), readings: readings.filter(notDeleted),
    dprs: dprs.filter(notDeleted).sort((a, b) => a.report_date.localeCompare(b.report_date)), holds: holds.filter(notDeleted),
    certificates: certs.filter(notDeleted).filter((c) => c.status === 'issued' && (job ? c.job_id === job.id : !c.inspection_id || inspIds.has(c.inspection_id) || assetSet.has(c.asset_id))),
    photos: scope.includePhotos === false ? [] : await photosFor((d) => !!d.inspection_id && inspIds.has(d.inspection_id), 40),
    due: due.map((x) => ({ asset: x.asset, typeCode: x.typeCode, lastDate: x.lastDate, nextDue: x.nextDue })),
    from: scope.from, to: scope.to, today: new Date().toISOString().slice(0, 10),
  };
}
