import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, LinkButton, PageHeader, statusTone, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatPressure, psvWithinTolerance } from '../lib/calc';
import { db } from '../lib/db';
import { CERT_KINDS, DOC_STATUS, fmtDate, live, usePressureUnit } from '../lib/domain';
import { create, save } from '../lib/sync';
import type { Asset, Certificate, CertKind, Inspection } from '../lib/types';

function CreateCert() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const insp = (await db.inspections.get(params.get('inspection') ?? '')) as Inspection | undefined;
      if (!insp) {
        toast('Open the inspection first, then create the certificate from it.', 'error');
        nav(-1);
        return;
      }
      const existing = ((await db.certificates.where('inspection_id').equals(insp.id).toArray()) as Certificate[]).find((c) => !c.deleted_at && c.status !== 'revised');
      if (existing) {
        nav(`/certificates/${existing.id}`, { replace: true });
        return;
      }
      const id = await create('certificates', {
        client_id: insp.client_id, asset_id: insp.asset_id, inspection_id: insp.id, job_id: insp.job_id, kind: (params.get('kind') ?? 'general') as CertKind,
        status: 'draft', data: { valid_until: insp.next_due },
      });
      nav(`/certificates/${id}`, { replace: true });
    })();
  }, [params, nav, toast]);
  return <p className="text-muted p-6">Preparing certificate…</p>;
}

function Detail({ id }: { id: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const unit = usePressureUnit();
  const d = live(async () => {
    const cert = (await db.certificates.get(id)) as Certificate | undefined;
    if (!cert) return null;
    const asset = (await db.assets.get(cert.asset_id)) as Asset;
    const insp = cert.inspection_id ? ((await db.inspections.get(cert.inspection_id)) as Inspection | undefined) : undefined;
    return { cert, asset, insp };
  }, [id]);
  if (d === undefined) return null;
  if (!d) return <Empty title="Certificate not found" />;
  const { cert, asset, insp } = d;
  const editable = cert.status === 'draft' && can.field;
  const data = cert.data ?? {};
  const setData = (k: string, v: unknown) => save('certificates', cert.id, { data: { ...data, [k]: v } });
  const psv = insp?.results?.psv;
  const pt = insp?.results?.pressure;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back title={CERT_KINDS[cert.kind]} sub={<span className="flex flex-wrap items-center gap-2">{cert.number ?? 'Number given when issued'}<Link to={`/assets/${asset.id}`} className="underline">{asset.tag}</Link><Badge tone={statusTone(cert.status)}>{DOC_STATUS[cert.status]}</Badge>{cert.revision > 0 && <span>Rev. {String(cert.revision).padStart(2, '0')}</span>}</span>}
        actions={<LinkButton tone="accent" icon="download" to={`/reports/new?template=cert&certificate=${cert.id}&auto=1`}>PDF + Word</LinkButton>} />
      {cert.status === 'issued' && <div className="rounded-xl bg-green-100 p-3 font-semibold text-green-900 dark:bg-green-900/40 dark:text-green-100">Issued {fmtDate(cert.issued_at)} by {cert.issued_by_name}{cert.issued_by_cert ? ` (cert. ${cert.issued_by_cert})` : ''}. Locked.</div>}
      <Card title="From the inspection">
        {!insp ? <p className="text-muted">No inspection linked.</p> : (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-muted">Inspection:</span> <Link className="underline" to={`/inspections/${insp.id}`}>{fmtDate(insp.inspection_date)} {insp.type_code}</Link></div>
            <div><span className="text-muted">Inspector:</span> {insp.inspector_name}</div>
            {cert.kind === 'psv' && psv && (
              <>
                <div><span className="text-muted">Set pressure:</span> {formatPressure(psv.set_pressure_pa, unit)}</div>
                <div><span className="text-muted">CDTP:</span> {formatPressure(psv.cdtp_pa, unit)}</div>
                <div><span className="text-muted">As found:</span> {formatPressure(psv.as_found_pa, unit)} {psv.set_pressure_pa && psv.as_found_pa ? (psvWithinTolerance(psv.set_pressure_pa, psv.as_found_pa, psv.code) ? '(within tolerance)' : '(outside tolerance)') : ''}</div>
                <div><span className="text-muted">As left:</span> {formatPressure(psv.as_left_pa, unit)}</div>
                <div><span className="text-muted">Seat tightness:</span> {psv.seat_tightness}</div>
                <div><span className="text-muted">Final result:</span> {psv.result === 'pass' ? 'Accepted' : psv.result === 'fail' ? 'Rejected' : '—'}</div>
              </>
            )}
            {cert.kind === 'hydro' && pt && (
              <>
                <div><span className="text-muted">Test pressure:</span> {formatPressure(pt.test_pressure_pa, unit)}</div>
                <div><span className="text-muted">Hold:</span> {pt.hold_minutes ?? '—'} min · {pt.test_medium}</div>
                <div><span className="text-muted">Result:</span> {pt.result}</div>
              </>
            )}
          </div>
        )}
        <p className="text-muted mt-2 text-sm">Test values are taken from the inspection. To change them, edit the inspection while it is a draft.</p>
      </Card>
      <Card title="Certificate details">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Valid until / next test" type="date" disabled={!editable} value={(data.valid_until as string) ?? ''} onChange={(e) => setData('valid_until', e.target.value)} />
          <TextInput label="Witnessed by" disabled={!editable} defaultValue={(data.witness as string) ?? insp?.witness ?? ''} onBlur={(e) => setData('witness', e.target.value)} />
          {cert.kind === 'calibration' && (
            <>
              <TextInput label="Instrument" disabled={!editable} defaultValue={(data.instrument as string) ?? ''} onBlur={(e) => setData('instrument', e.target.value)} />
              <TextInput label="Range" disabled={!editable} defaultValue={(data.range as string) ?? ''} onBlur={(e) => setData('range', e.target.value)} />
              <TextInput label="Reference standard used" disabled={!editable} defaultValue={(data.reference as string) ?? ''} onBlur={(e) => setData('reference', e.target.value)} />
              <TextInput label="Results (nominal = reading; …)" disabled={!editable} defaultValue={(data.points as string) ?? ''} onBlur={(e) => setData('points', e.target.value)} hint="e.g. 0=0.0; 10=10.1; 20=20.0" />
            </>
          )}
          <TextArea className="sm:col-span-2" label="Remarks" disabled={!editable} defaultValue={(data.remarks as string) ?? ''} onBlur={(e) => setData('remarks', e.target.value)} />
        </div>
      </Card>
      {can.office && cert.status === 'draft' && (
        <Button size="lg" tone="accent" onClick={async () => {
          if (!confirm('Issue this certificate? It gets its number now and is locked.')) return;
          await save('certificates', cert.id, { status: 'issued' });
          toast('Certificate issued – the number appears after sync.');
        }}>Issue certificate</Button>
      )}
      {can.office && cert.status === 'issued' && (
        <Button tone="secondary" onClick={async () => {
          if (!confirm('Create a revision of this certificate? The issued one is kept and marked superseded.')) return;
          const nid = await create('certificates', { client_id: cert.client_id, asset_id: cert.asset_id, inspection_id: cert.inspection_id, job_id: cert.job_id, kind: cert.kind, number: cert.number, data: cert.data, status: 'draft', revision: cert.revision + 1, supersedes_id: cert.id });
          await save('certificates', cert.id, { status: 'revised' });
          nav(`/certificates/${nid}`);
        }}>Create revision</Button>
      )}
    </div>
  );
}

export default function CertificatePage() {
  const { id } = useParams();
  return id ? <Detail id={id} /> : <CreateCert />;
}
