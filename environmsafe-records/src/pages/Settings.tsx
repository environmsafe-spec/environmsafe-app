import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SignaturePad } from '../components/SignaturePad';
import { Badge, Button, Card, Checkbox, Modal, PageHeader, SelectInput, Tabs, TextInput, useToast } from '../components/ui';
import { biometricEnabled, clearPin, hasPin, setPin } from '../lib/applock';
import { useAuth } from '../lib/auth';
import { formatNumber, PRESSURE_UNITS, type PressureUnit } from '../lib/calc';
import { db } from '../lib/db';
import { live, useSettings } from '../lib/domain';
import { useFileUrl } from '../lib/files';
import { APP_VERSION, biometricAvailable, isNative, shareOrDownload } from '../lib/native';
import { BUCKET, supabase } from '../lib/supabase';
import { newId, queueFile, syncNow } from '../lib/sync';
import type { NumberingScheme, Settings as SettingsRow } from '../lib/types';
import { ChangePasswordForm, MfaEnrollScreen } from './AuthScreens';
import { StorageMeter } from './Dashboard';
import { ConflictList } from './SyncPage';

function MyAccount() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ full_name: profile?.full_name ?? '', title: profile?.title ?? '', phone: profile?.phone ?? '', cert_number: profile?.cert_number ?? '' });
  const [modal, setModal] = useState<'pw' | 'mfa' | 'sig' | null>(null);
  const [factors, setFactors] = useState<number>(0);
  const sigUrl = useFileUrl(profile?.signature_path);
  useEffect(() => {
    if (navigator.onLine) void supabase.auth.mfa.listFactors().then(({ data }) => setFactors(data?.totp?.length ?? 0));
  }, [modal]);
  return (
    <div className="flex flex-col gap-4">
      <Card title="My details">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          const { error } = await supabase.from('profiles').update(v).eq('id', profile!.id);
          if (error) return toast(navigator.onLine ? error.message : 'Needs internet.', 'error');
          await refresh();
          toast('Saved');
        }}>
          <TextInput label="Full name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
          <TextInput label="Job title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <TextInput label="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          <TextInput label="Inspector certificate number" value={v.cert_number} onChange={(e) => setV({ ...v, cert_number: e.target.value })} />
          <Button type="submit" className="sm:col-span-2">Save</Button>
        </form>
      </Card>
      <Card title="Signature">
        {sigUrl ? <img src={sigUrl} alt="My signature" className="mb-2 h-20 rounded bg-white p-1" /> : <p className="text-muted mb-2">No signature saved yet.</p>}
        <Button tone="secondary" icon="pen" onClick={() => setModal('sig')}>{sigUrl ? 'Change signature' : 'Draw signature'}</Button>
      </Card>
      <Card title="Security">
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" icon="lock" onClick={() => setModal('pw')}>Change password</Button>
          <Button tone="secondary" onClick={() => setModal('mfa')}>{factors ? 'Two-step sign-in is on – set up again' : 'Turn on two-step sign-in'}</Button>
        </div>
      </Card>
      <Modal open={modal === 'pw'} onClose={() => setModal(null)} title="Change password">
        <ChangePasswordForm email={profile?.email} onDone={() => { setModal(null); toast('Password changed'); }} />
      </Modal>
      <Modal open={modal === 'mfa'} onClose={() => setModal(null)} title="Two-step sign-in">
        {modal === 'mfa' && <MfaEnrollScreen required={false} onDone={() => { setModal(null); toast('Two-step sign-in is on'); }} />}
      </Modal>
      <Modal open={modal === 'sig'} onClose={() => setModal(null)} title="Draw your signature">
        <SignaturePad onCancel={() => setModal(null)} onSave={async (png) => {
          const path = `signatures/${profile!.id}/${newId()}.png`;
          await queueFile(path, png);
          await syncNow();
          const { error } = await supabase.from('profiles').update({ signature_path: path }).eq('id', profile!.id);
          await db.profiles.update(profile!.id, { signature_path: path });
          if (error) toast('Saved on this phone; it will be stored on the server when online.', 'error');
          setModal(null);
          await refresh();
        }} />
      </Modal>
    </div>
  );
}

function Device() {
  const toast = useToast();
  const { signOut } = useAuth();
  const [pin, setPinV] = useState('');
  const [bio, setBio] = useState(biometricEnabled());
  const [bioOk, setBioOk] = useState(false);
  const [, force] = useState(0);
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const [unit, setUnit] = useState<PressureUnit>((localStorage.getItem('es-pressure-unit') as PressureUnit) || 'bar');
  useEffect(() => {
    void biometricAvailable().then(setBioOk);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <Card title="App lock (PIN)">
        <p className="mb-3 text-sm">The PIN protects the data stored on this phone and lets you unlock the app offline after a pause.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await setPin(pin, bio);
            setPinV('');
            force((n) => n + 1);
            toast('PIN saved');
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}>
          <TextInput label={hasPin() ? 'New PIN (4–8 digits)' : 'PIN (4–8 digits)'} type="password" inputMode="numeric" value={pin} onChange={(e) => setPinV(e.target.value)} />
          <Button type="submit">{hasPin() ? 'Change PIN' : 'Set PIN'}</Button>
          {hasPin() && <Button tone="ghost" onClick={() => { clearPin(); force((n) => n + 1); }}>Remove PIN</Button>}
        </form>
        {isNative && bioOk && <div className="mt-2"><Checkbox label="Also allow fingerprint / face unlock" checked={bio} onChange={setBio} /></div>}
        <p className="mt-2 text-sm">{hasPin() ? <Badge tone="green">PIN is set</Badge> : <Badge tone="amber">No PIN</Badge>}</p>
      </Card>
      <Card title="Display">
        <div className="flex flex-col gap-3">
          <Checkbox label="Dark mode" checked={dark} onChange={(v) => {
            setDark(v);
            document.documentElement.classList.toggle('dark', v);
            localStorage.setItem('es-theme', v ? 'dark' : 'light');
          }} />
          <SelectInput label="Pressure unit on screen" value={unit} onChange={(e) => { setUnit(e.target.value as PressureUnit); localStorage.setItem('es-pressure-unit', e.target.value); }}
            options={Object.entries(PRESSURE_UNITS).map(([k, u]) => ({ value: k, label: u.label }))} hint="Values are stored in SI units; only the display changes." />
        </div>
      </Card>
      <Card title="This device">
        <p className="mb-2 text-sm">App version {APP_VERSION}. Signing out removes all EnvironmSafe data from this device.</p>
        <Button tone="danger" icon="logout" onClick={async () => {
          const msg = await signOut();
          if (msg) toast(msg, 'error');
        }}>Sign out</Button>
      </Card>
    </div>
  );
}

function Company() {
  const toast = useToast();
  const s = useSettings();
  const [v, setV] = useState<SettingsRow | null>(null);
  const cur = v ?? s ?? null;
  const logoUrl = useFileUrl(cur?.branding?.logo_path);
  if (!cur) return <p className="text-muted">Loading…</p>;
  const setC = (k: keyof SettingsRow['company'], val: string) => setV({ ...cur, company: { ...cur.company, [k]: val } });
  const setO = (k: keyof SettingsRow['options'], val: number) => setV({ ...cur, options: { ...cur.options, [k]: val } });
  const saveAll = async (row: SettingsRow) => {
    const { error } = await supabase.from('settings').update({ company: row.company, branding: row.branding, options: row.options }).eq('id', 1);
    if (error) return toast(navigator.onLine ? error.message : 'Needs internet.', 'error');
    await db.settings.put(row);
    setV(null);
    toast('Settings saved');
  };
  return (
    <div className="flex flex-col gap-4">
      <Card title="Company details (printed on every document)">
        <div className="grid gap-3 sm:grid-cols-2">
          {(['legal_name', 'tagline', 'website', 'email', 'phone', 'address'] as const).map((k) => (
            <TextInput key={k} label={{ legal_name: 'Legal name', tagline: 'Cover line', website: 'Website', email: 'E-mail', phone: 'Phone', address: 'Address' }[k]} value={cur.company[k] ?? ''} onChange={(e) => setC(k, e.target.value)} />
          ))}
        </div>
      </Card>
      <Card title="Logo and colours">
        <div className="flex flex-wrap items-center gap-4">
          <img src={logoUrl ?? '/logo-trim.png'} alt="Logo" className="h-20 rounded bg-white p-1" />
          <label className="font-semibold">
            <span className="block text-sm">Upload new logo (PNG or JPG)</span>
            <input type="file" accept="image/png,image/jpeg" className="mt-1" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 2 * 1024 * 1024) return toast('Use a logo smaller than 2 MB.', 'error');
              const path = `branding/logo-${Date.now()}.${f.type === 'image/png' ? 'png' : 'jpg'}`;
              const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type });
              if (error) return toast(error.message, 'error');
              setV({ ...cur, branding: { ...cur.branding, logo_path: path } });
            }} />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(['navy', 'accent', 'text'] as const).map((k) => (
            <TextInput key={k} label={{ navy: 'Titles and table headers', accent: 'Rules and underlines', text: 'Body text' }[k]} type="color" value={cur.branding[k]} onChange={(e) => setV({ ...cur, branding: { ...cur.branding, [k]: e.target.value } })} />
          ))}
        </div>
      </Card>
      <Card title="Options">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Lock the app after (minutes without use)" type="number" min={2} max={240} value={cur.options.session_timeout_min} onChange={(e) => setO('session_timeout_min', Number(e.target.value))} />
          <TextInput label="Storage warning at (%)" type="number" min={10} max={95} value={cur.options.storage_warn_pct} onChange={(e) => setO('storage_warn_pct', Number(e.target.value))} />
          <TextInput label="File storage allowance (MB)" type="number" value={cur.options.storage_limit_mb} onChange={(e) => setO('storage_limit_mb', Number(e.target.value))} />
          <TextInput label="Database allowance (MB)" type="number" value={cur.options.db_limit_mb} onChange={(e) => setO('db_limit_mb', Number(e.target.value))} />
          <SelectInput label="Default pressure unit" value={cur.options.default_pressure_unit} onChange={(e) => setV({ ...cur, options: { ...cur.options, default_pressure_unit: e.target.value } })} options={Object.entries(PRESSURE_UNITS).map(([k, u]) => ({ value: k, label: u.label }))} />
        </div>
      </Card>
      <Button size="lg" disabled={!v} onClick={() => saveAll(cur)}>Save settings</Button>
    </div>
  );
}

function Numbering() {
  const toast = useToast();
  const schemes = live(async () => (await db.numbering_schemes.toArray()) as NumberingScheme[], [], []) ?? [];
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <Card title="Numbering schemes">
      <p className="mb-3 text-sm">Tokens: {'{CLIENT}'} client short code, {'{TYPE}'} document or inspection type, {'{JOB}'} job number, {'{YYYY}'} / {'{YY}'} / {'{MM}'} date, {'{NNN}'} running number (zeros = digits). Numbers are never reused, even after a change here.</p>
      <div className="flex flex-col gap-3">
        {schemes.map((s) => {
          const pattern = edits[s.doc_type] ?? s.pattern;
          return (
            <div key={s.doc_type} className="grid items-end gap-2 sm:grid-cols-[1fr_1.4fr_1fr_auto]">
              <div className="font-semibold">{s.label}</div>
              <input className="input" aria-label={`${s.label} pattern`} value={pattern} onChange={(e) => setEdits({ ...edits, [s.doc_type]: e.target.value })} />
              <div className="text-muted text-sm">e.g. {formatNumber(pattern, { client: 'YCSR', type: 'PSV', job: 'PC0251', n: 7 })}</div>
              <Button size="sm" disabled={edits[s.doc_type] == null} onClick={async () => {
                if (!/\{N+\}/.test(pattern)) return toast('Include a running number such as {NNN}.', 'error');
                const { error } = await supabase.from('numbering_schemes').update({ pattern }).eq('doc_type', s.doc_type);
                if (error) return toast(error.message, 'error');
                await db.numbering_schemes.put({ ...s, pattern });
                const n = { ...edits };
                delete n[s.doc_type];
                setEdits(n);
                toast('Saved');
              }}>Save</Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Backup() {
  const toast = useToast();
  const [files, setFiles] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Export everything">
        <p className="mb-3 text-sm">Downloads one ZIP with every table (JSON and CSV for Excel) and, if ticked, every photo and document. Keep it somewhere safe. Automatic backups also run every night (see the Admin Guide).</p>
        <Checkbox label="Include photos and documents (larger file)" checked={files} onChange={setFiles} />
        <Button className="mt-2" icon="download" busy={busy} onClick={async () => {
          if (!navigator.onLine) return toast('Export needs internet.', 'error');
          setBusy(true);
          try {
            const { exportEverything } = await import('../lib/exporter');
            const zip = await exportEverything(files, setMsg);
            await shareOrDownload(zip, `environmsafe-records-export-${new Date().toISOString().slice(0, 10)}.zip`);
            setMsg('Export finished.');
          } catch (e) {
            toast((e as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}>Export everything</Button>
        {msg && <p className="text-muted mt-2 text-sm">{msg}</p>}
      </Card>
      <Card title="Storage used">
        <StorageMeter />
      </Card>
    </div>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<{ id: number; at: string; user_email: string | null; action: string; table_name: string | null; details: unknown }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!navigator.onLine) return;
    void supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300).then(({ data }) => setRows(data ?? []));
  }, []);
  const list = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title="Audit log (latest 300)">
      <input className="input mb-3" placeholder="Filter" aria-label="Filter audit log" value={q} onChange={(e) => setQ(e.target.value)} />
      {!navigator.onLine && <p className="text-muted">Available when online.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-navy text-white"><tr>{['When', 'Who', 'Action', 'Record', 'Details'].map((h) => <th key={h} className="px-2 py-2 text-start">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b border-line align-top">
                <td className="px-2 py-1.5 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
                <td className="px-2 py-1.5">{r.user_email ?? 'system'}</td>
                <td className="px-2 py-1.5 font-semibold">{r.action}</td>
                <td className="px-2 py-1.5">{r.table_name}</td>
                <td className="max-w-md truncate px-2 py-1.5" title={JSON.stringify(r.details)}>{JSON.stringify(r.details).slice(0, 160)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Demo() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: 'load_demo_data' | 'remove_demo_data') => {
    if (fn === 'remove_demo_data' && !confirm('Remove all demo data? Real data is not touched.')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc(fn);
    setBusy(false);
    if (error) return toast(error.message, 'error');
    if (fn === 'remove_demo_data') {
      for (const t of ['clients', 'sites', 'assets', 'jobs', 'job_items', 'inspections', 'readings', 'findings', 'finding_updates', 'dprs', 'certificates', 'documents', 'reports'] as const) {
        await (db as unknown as Record<string, { filter: (f: (r: { is_demo?: boolean }) => boolean) => { delete: () => Promise<number> } }>)[t].filter((r) => !!r.is_demo).delete();
      }
    }
    await syncNow();
    toast(fn === 'load_demo_data' ? (data?.loaded ? 'Demo data loaded' : data?.reason ?? 'Done') : `Demo data removed (${data?.removed ?? 0} records)`);
  };
  return (
    <Card title="Demo data">
      <p className="mb-3 text-sm">A clearly labelled demo client ("DEMO – Sample Process Plant") with a boiler, three PSVs, two vessels, a piping circuit, a past inspection with findings and a job with three daily reports. Use it for training, then remove it.</p>
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} onClick={() => run('load_demo_data')}>Load demo data</Button>
        <Button busy={busy} tone="danger" onClick={() => run('remove_demo_data')}>Remove demo data</Button>
      </div>
    </Card>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'me';
  const tabs = [
    { key: 'me', label: 'My account' }, { key: 'device', label: 'This device' },
    ...(can.admin ? [{ key: 'company', label: 'Company' }, { key: 'numbering', label: 'Numbering' }, { key: 'backup', label: 'Backup & storage' }, { key: 'audit', label: 'Audit log' }, { key: 'conflicts', label: 'Conflicts' }, { key: 'demo', label: 'Demo data' }] : []),
  ];
  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} tabs={tabs} />
      {tab === 'me' && <MyAccount />}
      {tab === 'device' && <Device />}
      {can.admin && tab === 'company' && <Company />}
      {can.admin && tab === 'numbering' && <Numbering />}
      {can.admin && tab === 'backup' && <Backup />}
      {can.admin && tab === 'audit' && <AuditLog />}
      {can.admin && tab === 'conflicts' && <Card title="Offline edit conflicts"><ConflictList /></Card>}
      {can.admin && tab === 'demo' && <Demo />}
    </div>
  );
}
