import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PageHeader, Row } from '../components/ui';
import { db } from '../lib/db';
import { notDeleted } from '../lib/domain';
import type { Asset } from '../lib/types';

const ID_RE = /\/a\/([0-9a-f-]{36})/i;

export default function Scan() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [matches, setMatches] = useState<Asset[]>([]);
  const [running, setRunning] = useState(false);

  const open = (id: string) => nav(next === 'inspect' ? `/inspections/new?asset=${id}` : `/assets/${id}`, { replace: true });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setRunning(true);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const Detector = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (s: unknown) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : (await import('jsqr')).default;
        const loop = async () => {
          if (stop) return;
          if (v.readyState >= 2) {
            let text: string | null = null;
            if (detector) {
              const r = await detector.detect(v).catch(() => []);
              text = r[0]?.rawValue ?? null;
            } else if (jsQR) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              ctx.drawImage(v, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height)?.data ?? null;
            }
            const m = text?.match(ID_RE);
            if (m) {
              stop = true;
              open(m[1]);
              return;
            }
          }
          setTimeout(loop, 250);
        };
        void loop();
      } catch {
        setError('The camera is not available. Type the tag instead.');
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = tag.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!q) return setMatches([]);
    void db.assets.toArray().then((all) => setMatches((all as Asset[]).filter(notDeleted).filter((a) => a.tag.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q)).slice(0, 20)));
  }, [tag]);

  return (
    <div className="max-w-xl">
      <PageHeader back title="Find a tag" sub="Point the camera at the asset's QR label, or type the tag." />
      <div className="relative mb-4 overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
        {running && <div className="pointer-events-none absolute inset-10 rounded-2xl border-4 border-accent" />}
        {error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center font-semibold text-white">{error}</div>}
      </div>
      <input className="input mb-2 text-lg" placeholder="Type the tag, e.g. PSV-201A" aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} />
      <div className="surface rounded-2xl border border-line px-3">
        {matches.map((a) => <Row key={a.id} title={a.tag} sub={a.description} onClick={() => open(a.id)} />)}
      </div>
      <Button tone="ghost" className="mt-3" onClick={() => nav(-1)}>Cancel</Button>
    </div>
  );
}
