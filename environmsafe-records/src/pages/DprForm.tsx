import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PhotoCapture, PhotoGrid } from '../components/Photos';
import { Badge, Button, Card, Empty, PageHeader, statusTone, TextArea, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatNumber } from '../lib/calc';
import { db } from '../lib/db';
import { DOC_STATUS, fmtDate, live, notDeleted, today } from '../lib/domain';
import { create, save } from '../lib/sync';
import type { Dpr, Job, JobItem, NumberingScheme } from '../lib/types';

function ChooseJob() {
  const nav = useNavigate();
  const jobs = live(async () => ((await db.jobs.toArray()) as Job[]).filter(notDeleted).filter((j) => j.status !== 'closed'), [], []) ?? [];
  return (
    <div className="max-w-xl">
      <PageHeader back title="New daily report" sub="Choose the job" />
      {jobs.length === 0 ? <Empty title="No open jobs" icon="layers">Office can create a job first.</Empty> : (
        <div className="flex flex-col gap-2">
          {jobs.map((j) => (
            <Button key={j.id} tone="secondary" size="lg" className="justify-start text-start" onClick={() => nav(`/dprs/new?job=${j.id}`, { replace: true })}>{j.number} – {j.title}</Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Creates the new DPR, pre-filled from the job's previous report. */
function CreateDpr({ jobId }: { jobId: string }) {
  const nav = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const job = (await db.jobs.get(jobId)) as Job | undefined;
      if (!job) return;
      const previous = ((await db.dprs.where('job_id').equals(jobId).toArray()) as Dpr[]).filter(notDeleted).sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
      const existingToday = ((await db.dprs.where('job_id').equals(jobId).toArray()) as Dpr[]).find((d) => d.report_date === today() && !d.deleted_at);
      if (existingToday) {
        nav(`/dprs/${existingToday.id}`, { replace: true });
        return;
      }
      const id = await create('dprs', {
        job_id: job.id, client_id: job.client_id, report_date: today(), status: 'draft',
        manpower: previous?.manpower ?? [{ role: 'Inspector', count: 1 }],
        hours_worked: previous?.hours_worked ?? null,
        hse: { lti: 0, first_aid: 0, near_miss: 0 },
        activities: previous?.planned_next ? previous.planned_next.split('\n').filter(Boolean).map((line) => ({ discipline: '', description: line.replace(/^[-•]\s*/, '') })) : [],
        progress_planned: previous?.progress_planned ?? null,
        progress_actual: previous?.progress_actual ?? null,
      });
      nav(`/dprs/${id}`, { replace: true });
    })();
  }, [jobId, nav]);
  return <p className="text-muted p-6">Preparing today's report…</p>;
}

function Editor({ id }: { id: string }) {
  const { can, profile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const d = live(async () => {
    const dpr = (await db.dprs.get(id)) as Dpr | undefined;
    if (!dpr) return null;
    const job = (await db.jobs.get(dpr.job_id)) as Job;
    const all = ((await db.dprs.where('job_id').equals(dpr.job_id).toArray()) as Dpr[]).filter(notDeleted).sort((a, b) => a.report_date.localeCompare(b.report_date));
    const prev = all.filter((x) => x.report_date < dpr.report_date).pop();
    const holds = ((await db.job_items.where('job_id').equals(dpr.job_id).toArray()) as JobItem[]).filter(notDeleted);
    const scheme = (await db.numbering_schemes.get('dpr')) as NumberingScheme | undefined;
    return { dpr, job, prev, holds, scheme, seqGuess: dpr.seq ?? all.indexOf(dpr) + 1 };
  }, [id]);
  if (d === undefined) return null;
  if (!d) return <Empty title="Daily report not found" />;
  const { dpr, job, prev, holds, scheme, seqGuess } = d;
  const editable = dpr.status === 'draft' ? can.office || (can.field && (dpr.created_by === profile?.id || !dpr.created_by)) : dpr.status === 'submitted' && can.office;
  const set = (patch: Partial<Dpr>) => save('dprs', dpr.id, patch);
  const number = dpr.number ?? `${formatNumber(scheme?.pattern ?? 'ES/{JOB}-DPR-{NNN}', { job: job.number, n: seqGuess })} (on sync)`;
  const openHolds = holds.filter((h) => h.status === 'open');
  const raisedToday = holds.filter((h) => h.raised_date === dpr.report_date);
  const closedToday = holds.filter((h) => h.closed_date === dpr.report_date);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={`/jobs/${job.id}`} title="Daily progress report" sub={<span className="flex flex-wrap items-center gap-2">{number} · {job.number}<Badge tone={statusTone(dpr.status)}>{DOC_STATUS[dpr.status]}</Badge></span>}
        actions={<Button tone="accent" icon="download" onClick={() => nav(`/reports/new?template=dpr&dpr=${dpr.id}&auto=1`)}>PDF + Word</Button>} />
      {prev?.planned_next && (
        <Card title="Planned yesterday">
          <p className="whitespace-pre-wrap text-sm">{prev.planned_next}</p>
        </Card>
      )}
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="Date" type="date" disabled={!editable} value={dpr.report_date} onChange={(e) => set({ report_date: e.target.value })} />
          <TextInput label="Hours worked" type="number" step="0.5" disabled={!editable} value={dpr.hours_worked ?? ''} onChange={(e) => set({ hours_worked: e.target.value ? Number(e.target.value) : null })} />
          <TextInput label="Toolbox talk topic" disabled={!editable} defaultValue={dpr.toolbox_talks} onBlur={(e) => e.target.value !== dpr.toolbox_talks && set({ toolbox_talks: e.target.value })} />
        </div>
      </Card>
      <Card title="Manpower">
        {(dpr.manpower ?? []).map((m, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_6rem_auto] gap-2">
            <input className="input" aria-label="Role" disabled={!editable} defaultValue={m.role} onBlur={(e) => set({ manpower: dpr.manpower.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} />
            <input className="input" aria-label="Number" type="number" min={0} disabled={!editable} defaultValue={m.count} onBlur={(e) => set({ manpower: dpr.manpower.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)) })} />
            {editable && <Button tone="ghost" aria-label="Remove" icon="x" onClick={() => set({ manpower: dpr.manpower.filter((_, j) => j !== i) })} />}
          </div>
        ))}
        {editable && <Button size="sm" tone="secondary" icon="plus" onClick={() => set({ manpower: [...(dpr.manpower ?? []), { role: '', count: 1 }] })}>Add role</Button>}
      </Card>
      <Card title="HSE">
        <div className="grid grid-cols-3 gap-3">
          {([['lti', 'Lost time injuries'], ['first_aid', 'First aid cases'], ['near_miss', 'Near misses']] as const).map(([k, l]) => (
            <TextInput key={k} label={l} type="number" min={0} disabled={!editable} value={dpr.hse?.[k] ?? 0} onChange={(e) => set({ hse: { ...dpr.hse, [k]: Number(e.target.value) } })} />
          ))}
        </div>
      </Card>
      <Card title="Activities completed today">
        {(dpr.activities ?? []).map((a, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <input className="input" placeholder="Discipline" aria-label="Discipline" disabled={!editable} defaultValue={a.discipline} onBlur={(e) => set({ activities: dpr.activities.map((x, j) => (j === i ? { ...x, discipline: e.target.value } : x)) })} />
            <input className="input" placeholder="Activity" aria-label="Activity" disabled={!editable} defaultValue={a.description} onBlur={(e) => set({ activities: dpr.activities.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
            {editable && <Button tone="ghost" icon="x" aria-label="Remove activity" onClick={() => set({ activities: dpr.activities.filter((_, j) => j !== i) })} />}
          </div>
        ))}
        {editable && <Button size="sm" tone="secondary" icon="plus" onClick={() => set({ activities: [...(dpr.activities ?? []), { discipline: '', description: '' }] })}>Add activity</Button>}
      </Card>
      <Card title="Progress">
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Planned (%)" type="number" min={0} max={100} disabled={!editable} value={dpr.progress_planned ?? ''} onChange={(e) => set({ progress_planned: e.target.value ? Math.min(100, Number(e.target.value)) : null })} />
          <TextInput label="Actual (%)" type="number" min={0} max={100} disabled={!editable} value={dpr.progress_actual ?? ''} onChange={(e) => set({ progress_actual: e.target.value ? Math.min(100, Number(e.target.value)) : null })} />
        </div>
      </Card>
      <Card title={`Holds and observations (${openHolds.length} open)`}>
        <ul className="text-sm">
          {openHolds.map((h) => <li key={h.id}>• {h.ref_no} {h.title} <span className="text-muted">({h.kind}, raised {fmtDate(h.raised_date)})</span></li>)}
          {openHolds.length === 0 && <li className="text-muted">No open holds.</li>}
        </ul>
        <p className="text-muted mt-2 text-sm">Raised today: {raisedToday.length} · closed today: {closedToday.length}. Manage them on the job page.</p>
        <TextArea className="mt-3" label="Observations raised today" disabled={!editable} defaultValue={dpr.observations} onBlur={(e) => e.target.value !== dpr.observations && set({ observations: e.target.value })} />
      </Card>
      <Card title="Next day and issues">
        <TextArea label="Planned activities for the next day" disabled={!editable} defaultValue={dpr.planned_next} onBlur={(e) => e.target.value !== dpr.planned_next && set({ planned_next: e.target.value })} hint="One per line. Tomorrow's report starts from this list." />
        <TextArea className="mt-3" label="Issues and constraints" disabled={!editable} defaultValue={dpr.issues} onBlur={(e) => e.target.value !== dpr.issues && set({ issues: e.target.value })} />
      </Card>
      <Card title="Photos" actions={editable && <PhotoCapture links={{ client_id: dpr.client_id, job_id: dpr.job_id, dpr_id: dpr.id }} />}>
        <PhotoGrid where={{ dpr_id: dpr.id }} editable={editable} />
      </Card>
      {editable && (
        <div className="flex flex-wrap gap-2">
          {dpr.status === 'draft' && <Button size="lg" onClick={async () => { await set({ status: 'submitted' }); toast('Daily report submitted'); }}>Submit</Button>}
          {can.office && <Button size="lg" tone="secondary" onClick={async () => { await set({ status: dpr.status === 'draft' ? 'submitted' : dpr.status }); await set({ status: 'issued' }); toast('Issued'); }}>Issue</Button>}
        </div>
      )}
    </div>
  );
}

export default function DprForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  if (id) return <Editor id={id} />;
  const job = params.get('job');
  return job ? <CreateDpr jobId={job} /> : <ChooseJob />;
}
