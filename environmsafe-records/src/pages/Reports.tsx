import { useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, Empty, LinkButton, PageHeader, Row, SelectInput, statusTone, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { PRESSURE_UNITS, type PressureUnit } from '../lib/calc';
import { db } from '../lib/db';
import { DOC_STATUS, fmtDate, inspTypeName, live, notDeleted, today, useClients, useLibrary, usePressureUnit } from '../lib/domain';
import { addDocument, openFile } from '../lib/files';
import { shareOrDownload } from '../lib/native';
import { create, save, syncNow } from '../lib/sync';
import type { Asset, Certificate, Dpr, Inspection, Job, Report, ReportTemplate, TemplateSection } from '../lib/types';
import { ALL_REGISTER_SECTIONS, DEFAULT_TEMPLATES } from '../reports/defaults';

const TEMPLATES: { code: string; label: string; needs: string }[] = [
  { code: 'inspection', label: 'Inspection report', needs: 'inspection' },
  { code: 'final', label: 'Final report for a job', needs: 'job' },
  { code: 'dpr', label: 'Daily progress report', needs: 'dpr' },
  { code: 'cert', label: 'Certificate', needs: 'certificate' },
  { code: 'followup', label: 'Previous findings follow-up', needs: 'client' },
  { code: 'due_register', label: 'Due and overdue register', needs: 'client' },
  { code: 'custom', label: 'Custom report', needs: 'client' },
];

const EDITABLE: Record<string, string> = {
  scope: 'Scope', summary: 'Executive summary', results: 'Results summary', method: 'Method', recommendations: 'Recommendations', conclusion: 'Conclusion wording', limitations: 'Limitations',
};

function useTemplate(code: string): TemplateSection[] {
  const t = live(async () => ((await db.report_templates.toArray()) as ReportTemplate[]).find((x) => x.code === code && !x.deleted_at), [code]);
  return t?.config?.sections ?? DEFAULT_TEMPLATES[code]?.sections ?? [];
}

function Generator() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { profile, can } = useAuth();
  const clients = useClients();
  const { inspectionTypes } = useLibrary();
  const defaultUnit = usePressureUnit();
  const template = params.get('template') ?? (params.get('certificate') ? 'cert' : '');
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    p.delete('auto');
    setParams(p, { replace: true });
  };
  const clientId = params.get('client') ?? '';
  const tplSections = useTemplate(template === 'cert' ? 'inspection' : template);
  const [sections, setSections] = useState<TemplateSection[] | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<PressureUnit>(defaultUnit);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [findingFilter, setFindingFilter] = useState<'all' | 'open' | 'p1'>('all');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ pdf: Blob; docx: Blob; name: string; reportId: string | null; pdfUrl: string } | null>(null);
  const autoRan = useRef(false);

  const effectiveSections = useMemo(() => {
    if (sections) return sections;
    if (template === 'custom') return ALL_REGISTER_SECTIONS.map((s) => ({ ...s, enabled: tplSections.some((t) => t.key === s.key && t.enabled) }));
    return tplSections;
  }, [sections, tplSections, template]);

  const options = live(async () => {
    const [insp, jobs, dprs, certs, assets] = await Promise.all([
      db.inspections.toArray() as Promise<Inspection[]>, db.jobs.toArray() as Promise<Job[]>, db.dprs.toArray() as Promise<Dpr[]>,
      db.certificates.toArray() as Promise<Certificate[]>, db.assets.toArray() as Promise<Asset[]>,
    ]);
    return { insp: insp.filter(notDeleted), jobs: jobs.filter(notDeleted), dprs: dprs.filter(notDeleted), certs: certs.filter(notDeleted), assets: assets.filter(notDeleted) };
  }, []);
  const tag = (id: string) => options?.assets.find((a) => a.id === id)?.tag ?? '';

  const generate = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { loadCertificate, loadContext, loadDpr, loadInspection, loadLibrary, loadRegister } = await import('../reports/load');
      const { buildCertificate, buildDpr, buildInspectionReport, buildRegisterReport } = await import('../reports/build');
      const { renderBoth, safeFileName } = await import('../reports/generate');
      const [ctx, lib] = await Promise.all([loadContext(), loadLibrary()]);
      const common = {
        unit, lib, sections: effectiveSections, texts, docNumber: '—', revision: 0, date: today(),
        preparedBy: profile?.full_name, reviewedBy: '', approvedBy: '', status: 'For review',
      };
      let model;
      let reportRow: Partial<Report> | null = null;
      let name = 'Report';
      if (template === 'inspection') {
        const id = params.get('inspection');
        if (!id) throw new Error('Choose the inspection.');
        const b = await loadInspection(id, lib);
        reportRow = { client_id: b.insp.client_id, job_id: b.insp.job_id, template_code: 'inspection', title: `Inspection report ${b.asset.tag}`, number: b.insp.report_no, revision: b.insp.revision, config: { inspection_id: id } };
        common.revision = b.insp.revision;
        common.status = b.insp.status === 'issued' ? 'Issued' : 'For review';
        common.preparedBy = b.insp.inspector_name || common.preparedBy;
        name = `Inspection report ${b.asset.tag}`;
        model = (dn: string) => buildInspectionReport(b, { ...common, docNumber: dn });
      } else if (template === 'dpr') {
        const id = params.get('dpr');
        if (!id) throw new Error('Choose the daily report.');
        const b = await loadDpr(id);
        common.status = DOC_STATUS[b.dpr.status];
        name = `DPR ${b.job.number} ${b.dpr.report_date}`;
        reportRow = { client_id: b.dpr.client_id, job_id: b.dpr.job_id, template_code: 'dpr', title: name, number: b.dpr.number, config: { dpr_id: id } };
        model = () => buildDpr(b, { ...common, docNumber: b.dpr.number ?? '—' });
      } else if (template === 'cert') {
        const id = params.get('certificate');
        if (!id) throw new Error('Choose the certificate.');
        const b = await loadCertificate(id, lib);
        common.revision = b.cert.revision;
        name = `Certificate ${b.cert.number ?? b.asset.tag}`;
        reportRow = { client_id: b.cert.client_id, job_id: b.cert.job_id, template_code: 'cert', title: name, number: b.cert.number, revision: b.cert.revision, config: { certificate_id: id } };
        model = () => buildCertificate(b, { ...common, docNumber: b.cert.number ?? '—', sections: [] });
      } else {
        let cid = clientId;
        const jobId = params.get('job') ?? undefined;
        if (template === 'final') {
          const job = options?.jobs.find((j) => j.id === jobId);
          if (!job) throw new Error('Choose the job.');
          cid = job.client_id;
        }
        if (!cid) throw new Error('Choose the client.');
        const b = await loadRegister({ clientId: cid, jobId, assetIds, from: from || undefined, to: to || undefined, findingFilter: template === 'followup' ? findingFilter : findingFilter });
        name = `${TEMPLATES.find((t) => t.code === template)?.label} ${b.client.code}`;
        reportRow = { client_id: cid, job_id: jobId ?? null, template_code: template, title: name, config: { assetIds, from, to, findingFilter, sections: effectiveSections, texts } };
        model = (dn: string) => buildRegisterReport(template, b, { ...common, docNumber: dn });
      }
      // Keep a record of the report and take its number (needs internet the first time).
      let reportId: string | null = null;
      let docNumber = reportRow?.number ?? '—';
      if (reportRow) {
        const existing = params.get('report');
        reportId = existing ?? (await create('reports', { ...reportRow, status: 'draft' }));
        if (navigator.onLine) await syncNow();
        const saved = (await db.reports.get(reportId)) as Report | undefined;
        docNumber = saved?.number ?? reportRow.number ?? '—';
      }
      const m = model(docNumber);
      const files = await renderBoth(m, ctx);
      const fileName = safeFileName(`${docNumber !== '—' ? docNumber.replace(/\//g, '-') : name} ${m.revision ? `Rev ${String(m.revision).padStart(2, '0')}` : ''}`.trim());
      if (reportId && reportRow?.client_id) {
        const pdfId = await addDocument({ file: files.pdf, name: `${fileName}.pdf`, kind: 'report_output', client_id: reportRow.client_id, report_id: reportId, job_id: reportRow.job_id ?? null, title: `${name} (PDF)`, compress: false });
        const docxId = await addDocument({ file: files.docx, name: `${fileName}.docx`, kind: 'report_output', client_id: reportRow.client_id, report_id: reportId, job_id: reportRow.job_id ?? null, title: `${name} (Word)`, compress: false });
        const pdfDoc = await db.documents.get(pdfId);
        const docxDoc = await db.documents.get(docxId);
        await save('reports', reportId, { pdf_path: pdfDoc?.file_path ?? null, docx_path: docxDoc?.file_path ?? null });
      }
      setResult({ ...files, name: fileName, reportId, pdfUrl: URL.createObjectURL(files.pdf) });
      toast(docNumber === '—' ? 'Report ready. The document number is added when you are online – generate again then.' : 'Report ready');
    } catch (e) {
      console.error('Report generation failed', (e as Error)?.message, (e as Error)?.stack?.slice(0, 600));
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get('auto') === '1' && !autoRan.current && options && tplSections.length + (template === 'cert' ? 1 : 0) > 0) {
      autoRan.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, tplSections.length]);

  if (!options) return null;
  const clientAssets = options.assets.filter((a) => a.client_id === clientId).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const needs = TEMPLATES.find((t) => t.code === template)?.needs;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader back title="Generate a report" />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput label="Report type" value={template} placeholder="Choose" options={TEMPLATES.map((t) => ({ value: t.code, label: t.label }))} onChange={(e) => { setSections(null); set('template', e.target.value); }} />
          <SelectInput label="Pressure unit in the report" value={unit} onChange={(e) => setUnit(e.target.value as PressureUnit)} options={Object.entries(PRESSURE_UNITS).map(([k, u]) => ({ value: k, label: u.label }))} />
          {(needs === 'client' || needs === 'inspection') && (
            <SelectInput label="Client" value={clientId} placeholder="Choose client" options={clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => set('client', e.target.value)} />
          )}
          {needs === 'inspection' && (
            <SelectInput label="Inspection" value={params.get('inspection') ?? ''} placeholder="Choose inspection" onChange={(e) => set('inspection', e.target.value)}
              options={options.insp.filter((i) => !clientId || i.client_id === clientId).filter((i) => i.status !== 'revised').sort((a, b) => b.inspection_date.localeCompare(a.inspection_date)).map((i) => ({ value: i.id, label: `${tag(i.asset_id)} – ${inspTypeName(inspectionTypes, i.type_code)} – ${fmtDate(i.inspection_date)}` }))} />
          )}
          {needs === 'job' && (
            <SelectInput label="Job" value={params.get('job') ?? ''} placeholder="Choose job" onChange={(e) => set('job', e.target.value)} options={options.jobs.map((j) => ({ value: j.id, label: `${j.number} – ${j.title}` }))} />
          )}
          {needs === 'dpr' && (
            <SelectInput label="Daily report" value={params.get('dpr') ?? ''} placeholder="Choose" onChange={(e) => set('dpr', e.target.value)}
              options={options.dprs.sort((a, b) => b.report_date.localeCompare(a.report_date)).map((x) => ({ value: x.id, label: `${options.jobs.find((j) => j.id === x.job_id)?.number ?? ''} – ${fmtDate(x.report_date)}` }))} />
          )}
          {needs === 'certificate' && (
            <SelectInput label="Certificate" value={params.get('certificate') ?? ''} placeholder="Choose" onChange={(e) => set('certificate', e.target.value)}
              options={options.certs.map((x) => ({ value: x.id, label: `${x.number ?? 'Not issued'} – ${tag(x.asset_id)} (${x.kind.toUpperCase()})` }))} />
          )}
        </div>
      </Card>

      {needs === 'client' && clientId && (
        <Card title="What to include">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextInput label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <SelectInput label="Which findings" value={findingFilter} onChange={(e) => setFindingFilter(e.target.value as typeof findingFilter)} options={[{ value: 'all', label: 'All findings' }, { value: 'open', label: 'Open only' }, { value: 'p1', label: 'Open P1 only' }]} />
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer font-semibold">Assets ({assetIds.length ? `${assetIds.length} chosen` : 'all'})</summary>
            <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
              {clientAssets.map((a) => (
                <Checkbox key={a.id} label={`${a.tag} – ${a.description}`} checked={assetIds.includes(a.id)} onChange={(v) => setAssetIds(v ? [...assetIds, a.id] : assetIds.filter((x) => x !== a.id))} />
              ))}
            </div>
          </details>
        </Card>
      )}

      {template && template !== 'cert' && (
        <Card title="Sections">
          <ul className="flex flex-col gap-1">
            {effectiveSections.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                <Checkbox label={s.title} checked={s.enabled} onChange={(v) => setSections(effectiveSections.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer font-semibold">Edit wording</summary>
            <div className="mt-2 flex flex-col gap-3">
              {effectiveSections.filter((s) => s.enabled && EDITABLE[s.key]).map((s) => (
                <TextArea key={s.key} label={EDITABLE[s.key]} value={texts[s.key] ?? ''} placeholder="Leave empty to use the standard wording" onChange={(e) => setTexts({ ...texts, [s.key]: e.target.value })} />
              ))}
            </div>
          </details>
        </Card>
      )}

      <Button size="lg" tone="accent" icon="fileText" busy={busy} disabled={!template} onClick={generate}>Generate Word and PDF</Button>

      {result && (
        <Card title="Ready">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button icon="download" onClick={() => shareOrDownload(result.pdf, `${result.name}.pdf`)}>PDF</Button>
            <Button icon="download" tone="secondary" onClick={() => shareOrDownload(result.docx, `${result.name}.docx`)}>Word</Button>
            {result.reportId && <Button tone="ghost" onClick={() => nav(`/reports/${result.reportId}`)}>Open report record</Button>}
          </div>
          {!can.viewOnly && <p className="text-muted mb-2 text-sm">Both files are saved with the report and uploaded when online.</p>}
          <iframe title="PDF preview" src={result.pdfUrl} className="h-[70vh] w-full rounded-xl border border-line bg-white" />
        </Card>
      )}
    </div>
  );
}

function ReportList() {
  const clients = useClients();
  const reports = live(async () => ((await db.reports.toArray()) as Report[]).filter(notDeleted).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')), [], []) ?? [];
  const [tab, setTab] = useState<'all' | 'issued'>('all');
  const list = reports.filter((r) => tab === 'all' || r.status === 'issued');
  return (
    <div>
      <PageHeader title="Reports" actions={<LinkButton to="/reports/new" icon="plus" tone="accent">Generate report</LinkButton>} />
      <div className="mb-3 flex gap-2">
        <Button size="sm" tone={tab === 'all' ? 'primary' : 'secondary'} onClick={() => setTab('all')}>History</Button>
        <Button size="sm" tone={tab === 'issued' ? 'primary' : 'secondary'} onClick={() => setTab('issued')}>Issued</Button>
      </div>
      <div className="surface rounded-2xl border border-line px-3">
        {list.length === 0 && <Empty title="No reports yet" icon="fileText" />}
        {list.map((r) => (
          <Row key={r.id} to={`/reports/${r.id}`} title={r.title || r.template_code} sub={`${r.number ?? 'Number on sync'} · ${clients.find((c) => c.id === r.client_id)?.code ?? ''} · ${fmtDate(r.created_at)}`}
            right={<Badge tone={statusTone(r.status)}>{DOC_STATUS[r.status]}</Badge>} />
        ))}
      </div>
    </div>
  );
}

function ReportDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const r = live(async () => (await db.reports.get(id!)) as Report | undefined, [id]);
  if (!r) return null;
  const regenerate = () => {
    const c = r.config as Record<string, string>;
    const q = new URLSearchParams({ template: r.template_code, report: r.id, client: r.client_id });
    if (c.inspection_id) q.set('inspection', c.inspection_id);
    if (c.dpr_id) q.set('dpr', c.dpr_id);
    if (c.certificate_id) q.set('certificate', c.certificate_id);
    if (r.job_id) q.set('job', r.job_id);
    nav(`/reports/new?${q}`);
  };
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader back="/reports" title={r.title} sub={<span className="flex flex-wrap items-center gap-2">{r.number ?? 'Number on sync'} · Rev. {String(r.revision).padStart(2, '0')}<Badge tone={statusTone(r.status)}>{DOC_STATUS[r.status]}</Badge></span>} />
      <Card title="Files">
        <div className="flex flex-wrap gap-2">
          {r.pdf_path && <Button icon="download" onClick={() => openFile(r.pdf_path!, `${r.number ?? r.title}.pdf`.replace(/\//g, '-')).catch((e) => toast(e.message, 'error'))}>PDF</Button>}
          {r.docx_path && <Button tone="secondary" icon="download" onClick={() => openFile(r.docx_path!, `${r.number ?? r.title}.docx`.replace(/\//g, '-')).catch((e) => toast(e.message, 'error'))}>Word</Button>}
          {r.status === 'draft' && !can.viewOnly && <Button tone="ghost" onClick={regenerate}>Generate again</Button>}
        </div>
      </Card>
      {can.office && r.status === 'draft' && (
        <Button size="lg" tone="accent" onClick={async () => {
          if (!confirm('Issue this report? It will be locked. Changes then need a new revision.')) return;
          await save('reports', r.id, { status: 'issued' });
          toast('Report issued');
        }}>Issue report</Button>
      )}
      {can.office && r.status === 'issued' && (
        <Button tone="secondary" onClick={async () => {
          if (!confirm('Create a new revision? The issued report is kept unchanged.')) return;
          const nid = await create('reports', { client_id: r.client_id, job_id: r.job_id, template_code: r.template_code, number: r.number, title: r.title, revision: r.revision + 1, config: r.config, supersedes_id: r.id, status: 'draft' });
          await save('reports', r.id, { status: 'revised' });
          nav(`/reports/${nid}`);
        }}>Create revision</Button>
      )}
    </div>
  );
}

export default function Reports() {
  return (
    <Routes>
      <Route index element={<ReportList />} />
      <Route path="new" element={<Generator />} />
      <Route path=":id" element={<ReportDetail />} />
    </Routes>
  );
}
