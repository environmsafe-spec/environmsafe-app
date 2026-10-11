// Photos and documents: compression on the device, local caching, upload queue
// and short-lived signed links for viewing.

import { useEffect, useState } from 'react';
import { db } from './db';
import { BUCKET, configured, supabase } from './supabase';
import { create, newId, queueFile } from './sync';
import type { DocKind, DocumentRow } from './types';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_TARGET_BYTES = 250 * 1024;

export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(Object.entries(ALLOWED_MIME).map(([m, e]) => [e, m]));
EXT_TO_MIME.jpeg = 'image/jpeg';

export function mimeOf(file: File | Blob, name?: string): string | null {
  if (file.type && ALLOWED_MIME[file.type]) return file.type;
  const ext = (name ?? (file as File).name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? null;
}

export function validateFile(file: File | Blob, name?: string): string | null {
  const mime = mimeOf(file, name);
  if (!mime) return 'This file type is not allowed. Use photos (JPG, PNG), PDF, Word, Excel or CSV.';
  if (file.size > MAX_FILE_BYTES) return 'The file is larger than 50 MB.';
  if (file.size === 0) return 'The file is empty.';
  return null;
}

/** Resizes to 1600 px on the long side and re-encodes as JPEG of about 250 KB. */
export async function compressImage(input: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() =>
    createImageBitmap(input),
  );
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let quality = 0.82;
  let blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality));
  while (blob.size > PHOTO_TARGET_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality));
  }
  return { blob, width, height };
}

export interface AddDocumentInput {
  file: Blob;
  name?: string;
  kind: DocKind;
  client_id: string;
  asset_id?: string | null;
  inspection_id?: string | null;
  finding_id?: string | null;
  job_id?: string | null;
  dpr_id?: string | null;
  report_id?: string | null;
  title?: string;
  caption?: string;
  sort?: number;
  lat?: number | null;
  lng?: number | null;
  compress?: boolean;
}

/** Stores a file on the device, queues the upload and creates its document record. */
export async function addDocument(input: AddDocumentInput): Promise<string> {
  const problem = validateFile(input.file, input.name);
  if (problem) throw new Error(problem);
  let blob = input.file;
  let mime = mimeOf(input.file, input.name)!;
  const isImage = mime.startsWith('image/');
  if (isImage && input.compress !== false) {
    blob = (await compressImage(input.file)).blob;
    mime = 'image/jpeg';
  }
  const id = newId();
  const ext = ALLOWED_MIME[mime] ?? 'bin';
  const path = `${input.client_id}/${id}.${ext}`;
  await queueFile(path, new Blob([blob], { type: mime }));
  await create<DocumentRow & Record<string, unknown>>('documents', {
    id,
    client_id: input.client_id,
    asset_id: input.asset_id ?? null,
    inspection_id: input.inspection_id ?? null,
    finding_id: input.finding_id ?? null,
    job_id: input.job_id ?? null,
    dpr_id: input.dpr_id ?? null,
    report_id: input.report_id ?? null,
    kind: input.kind,
    title: input.title ?? (input.name ? input.name.replace(/\.[^.]+$/, '') : ''),
    caption: input.caption ?? '',
    file_path: path,
    mime,
    size_bytes: blob.size,
    taken_at: isImage ? new Date().toISOString() : null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    sort: input.sort ?? Date.now() % 1_000_000,
  });
  return id;
}

/** Returns the file's bytes from the device, or downloads them with a short-lived link. */
export async function getFileBlob(path: string, cache = true): Promise<Blob | null> {
  const local = await db.blobs.get(path);
  if (local) return local.blob;
  if (!configured || !navigator.onLine) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data) return null;
  const res = await fetch(data.signedUrl);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (cache && blob.size < 3 * 1024 * 1024) {
    await db.blobs.put({ path, blob, mime: blob.type, size: blob.size, pending: false, cached_at: new Date().toISOString() });
  }
  return blob;
}

export async function openFile(path: string, fileName: string): Promise<void> {
  const blob = await getFileBlob(path, false);
  if (!blob) throw new Error('The file is not on this device and you are offline.');
  const { shareOrDownload } = await import('./native');
  await shareOrDownload(blob, fileName);
}

const urlCache = new Map<string, string>();

export function useFileUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(path ? urlCache.get(path) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(path);
    if (cached) {
      setUrl(cached);
      return;
    }
    getFileBlob(path).then((b) => {
      if (!alive || !b) return;
      const u = URL.createObjectURL(b);
      urlCache.set(path, u);
      setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
