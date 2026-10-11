import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** Draw-on-screen signature. Returns a PNG blob. */
export function SignaturePad({ onSave, onCancel }: { onSave: (png: Blob) => void; onCancel?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * ratio;
    c.height = h * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1B1B3A';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="flex flex-col gap-3">
      <canvas
        ref={ref}
        data-testid="signature-pad"
        aria-label="Sign here"
        className="h-48 w-full touch-none rounded-xl border-2 border-dashed border-line bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={empty} onClick={() => ref.current!.toBlob((b) => b && onSave(b), 'image/png')}>Use this signature</Button>
        <Button tone="secondary" onClick={() => {
          const c = ref.current!;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          setEmpty(true);
        }}>Clear</Button>
        {onCancel && <Button tone="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
