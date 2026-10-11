import { useRef, useState } from 'react';
import { db } from '../lib/db';
import { live, notDeleted } from '../lib/domain';
import { addDocument, useFileUrl, type AddDocumentInput } from '../lib/files';
import { isNative, takePhotoNative } from '../lib/native';
import { save, softDelete } from '../lib/sync';
import type { DocumentRow } from '../lib/types';
import { Icon } from './Icon';
import { Button, useToast } from './ui';

type Links = Omit<AddDocumentInput, 'file' | 'kind'>;

/** Camera / gallery buttons that add compressed photos linked to the given record. */
export function PhotoCapture({ links, onAdded, label = 'Take photo', disabled }: { links: Links; onAdded?: (id: string) => void; label?: string; disabled?: boolean }) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const add = async (files: Blob[]) => {
    setBusy(true);
    try {
      let pos: GeolocationPosition | null = null;
      try {
        pos = await new Promise<GeolocationPosition | null>((res) => {
          if (!navigator.geolocation) return res(null);
          navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 2500, maximumAge: 300_000 });
        });
      } catch {
        pos = null;
      }
      for (const f of files) {
        const id = await addDocument({ ...links, file: f, name: (f as File).name || 'photo.jpg', kind: 'photo', lat: pos?.coords.latitude ?? null, lng: pos?.coords.longitude ?? null });
        onAdded?.(id);
      }
      toast(files.length === 1 ? 'Photo saved' : `${files.length} photos saved`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const open = async (source: 'camera' | 'gallery') => {
    if (isNative) {
      try {
        const b = await takePhotoNative(source);
        if (b) await add([b]);
      } catch (e) {
        if (!/cancel/i.test((e as Error).message)) toast((e as Error).message, 'error');
      }
      return;
    }
    (source === 'camera' ? camRef : galRef).current?.click();
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button icon="camera" onClick={() => open('camera')} busy={busy} disabled={disabled}>{label}</Button>
      <Button tone="secondary" icon="image" onClick={() => open('gallery')} disabled={disabled || busy}>From gallery</Button>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden data-testid="photo-camera-input"
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void add(fs); }} />
      <input ref={galRef} type="file" accept="image/*" multiple hidden data-testid="photo-gallery-input"
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void add(fs); }} />
    </div>
  );
}

export function Thumb({ doc, onClick, className = '' }: { doc: DocumentRow; onClick?: () => void; className?: string }) {
  const url = useFileUrl(doc.mime.startsWith('image/') ? doc.file_path : null);
  return (
    <button type="button" onClick={onClick} className={`relative block overflow-hidden rounded-xl bg-black/10 ${className}`} aria-label={doc.caption || doc.title || 'Photo'}>
      {url ? <img src={url} alt={doc.caption || ''} className="h-full w-full object-cover" loading="lazy" /> : (
        <span className="text-muted flex h-full w-full items-center justify-center"><Icon name={doc.mime.startsWith('image/') ? 'image' : 'file'} size={28} /></span>
      )}
    </button>
  );
}

/** Photo list with captions, order and figure numbers for the report annex. */
export type DocWhere = Partial<Record<'asset_id' | 'inspection_id' | 'finding_id' | 'job_id' | 'dpr_id' | 'client_id', string>>;

export function matchWhere(d: DocumentRow, where: DocWhere): boolean {
  return Object.entries(where).every(([k, v]) => (d as unknown as Record<string, unknown>)[k] === v);
}

export function PhotoGrid({ where, editable, title = 'Photos' }: { where: DocWhere; editable: boolean; title?: string }) {
  const key = JSON.stringify(where);
  const docs = live(async () => ((await db.documents.toArray()) as DocumentRow[]).filter(notDeleted).filter((d) => d.kind === 'photo' || d.kind === 'nameplate').filter((d) => matchWhere(d, JSON.parse(key))).sort((a, b) => a.sort - b.sort), [key], []) ?? [];
  const [big, setBig] = useState<DocumentRow | null>(null);
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= docs.length) return;
    const a = docs[i];
    const b = docs[j];
    await save('documents', a.id, { sort: b.sort });
    await save('documents', b.id, { sort: a.sort === b.sort ? b.sort + dir : a.sort });
  };
  if (!docs.length) return <p className="text-muted text-sm">No {title.toLowerCase()} yet.</p>;
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {docs.map((d, i) => (
          <li key={d.id} className="flex gap-3 rounded-xl border border-line p-2">
            <Thumb doc={d} onClick={() => setBig(d)} className="h-24 w-24 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="text-muted text-xs font-bold">Figure {i + 1}</div>
              {editable ? (
                <input className="input !min-h-10 !py-1.5 text-sm" placeholder="Caption" defaultValue={d.caption} aria-label={`Caption for figure ${i + 1}`}
                  onBlur={(e) => e.target.value !== d.caption && save('documents', d.id, { caption: e.target.value })} />
              ) : (
                <div className="text-sm">{d.caption || <span className="text-muted">No caption</span>}</div>
              )}
              {editable && (
                <div className="mt-auto flex gap-1">
                  <button type="button" className="rounded-lg border border-line p-1.5" aria-label="Move up" onClick={() => move(i, -1)}><Icon name="chevronUp" size={16} /></button>
                  <button type="button" className="rounded-lg border border-line p-1.5" aria-label="Move down" onClick={() => move(i, 1)}><Icon name="chevronDown" size={16} /></button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {big && <PhotoViewer doc={big} onClose={() => setBig(null)} canDelete={editable} />}
    </>
  );
}

function PhotoViewer({ doc, onClose, canDelete }: { doc: DocumentRow; onClose: () => void; canDelete: boolean }) {
  const url = useFileUrl(doc.file_path);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-label="Photo">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="truncate font-semibold">{doc.caption || doc.title}</span>
        <div className="flex gap-2">
          {canDelete && (
            <button type="button" className="rounded-lg bg-white/15 px-3 py-2" onClick={async () => {
              if (confirm('Remove this photo? (Office or Admin can restore it.)')) {
                try {
                  await softDelete('documents', doc.id);
                } catch { /* refused changes are shown in the sync screen */ }
                onClose();
              }
            }}>Remove</button>
          )}
          <button type="button" className="rounded-lg bg-white/15 px-3 py-2" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-2">
        {url ? <img src={url} alt={doc.caption} className="max-h-full max-w-full object-contain" /> : <span className="text-white">Not available offline</span>}
      </div>
    </div>
  );
}
