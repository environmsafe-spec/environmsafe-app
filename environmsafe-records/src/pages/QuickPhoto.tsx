import { useState } from 'react';
import { PhotoCapture, PhotoGrid } from '../components/Photos';
import { Card, PageHeader, Row } from '../components/ui';
import { db } from '../lib/db';
import { live, notDeleted } from '../lib/domain';
import type { Asset } from '../lib/types';

/** Add a photo to an asset in two taps: pick the tag, take the photo. */
export default function QuickPhoto() {
  const [q, setQ] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const assets = live(async () => ((await db.assets.toArray()) as Asset[]).filter(notDeleted), [], []) ?? [];
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const list = q ? assets.filter((a) => squash(`${a.tag} ${a.description}`).includes(squash(q))).slice(0, 30) : [];
  return (
    <div className="max-w-xl">
      <PageHeader back title="Add photo" sub={asset ? `${asset.tag} – ${asset.description}` : 'Choose the asset'} />
      {!asset ? (
        <>
          <input className="input mb-2 text-lg" autoFocus placeholder="Type the tag" aria-label="Tag" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="surface rounded-2xl border border-line px-3">
            {list.map((a) => <Row key={a.id} title={a.tag} sub={a.description} onClick={() => setAsset(a)} />)}
          </div>
        </>
      ) : (
        <Card actions={<button type="button" className="font-semibold underline" onClick={() => setAsset(null)}>Change asset</button>}>
          <div className="mb-4"><PhotoCapture links={{ client_id: asset.client_id, asset_id: asset.id }} /></div>
          <PhotoGrid where={{ asset_id: asset.id }} editable />
        </Card>
      )}
    </div>
  );
}
