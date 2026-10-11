import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, PageHeader } from '../components/ui';
import { db } from '../lib/db';
import { live, notDeleted, useClients } from '../lib/domain';
import type { Asset } from '../lib/types';
import { assetUrl } from './AssetDetail';

/** Printable sheet of QR labels (3 × 8 per A4 page). */
export default function Labels() {
  const [params, setParams] = useSearchParams();
  const clients = useClients();
  const clientId = params.get('client') ?? '';
  const assets = live(async () => (clientId ? ((await db.assets.where('client_id').equals(clientId).toArray()) as Asset[]).filter(notDeleted).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })) : []), [clientId], []) ?? [];
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    void Promise.all(assets.map(async (a) => [a.id, await QRCode.toDataURL(assetUrl(a.id), { margin: 1, width: 220 })] as const)).then((e) => setCodes(Object.fromEntries(e)));
  }, [assets]);
  const client = clients.find((c) => c.id === clientId);
  return (
    <div>
      <div className="print:hidden">
        <PageHeader back title="QR labels" actions={<Button icon="download" onClick={() => window.print()} disabled={!assets.length}>Print / save as PDF</Button>} />
        <select className="input mb-4 max-w-md" aria-label="Client" value={clientId} onChange={(e) => setParams({ client: e.target.value })}>
          <option value="">Choose client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 bg-white text-black sm:grid-cols-3 print:grid-cols-3 print:gap-1">
        {assets.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded border border-gray-400 p-2 break-inside-avoid">
            {codes[a.id] && <img src={codes[a.id]} alt="" className="h-24 w-24" />}
            <div className="min-w-0 text-xs">
              <div className="text-base font-bold break-words">{a.tag}</div>
              <div className="line-clamp-2">{a.description}</div>
              <div className="mt-1 text-[10px]">{client?.code} · EnvironmSafe Records</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
