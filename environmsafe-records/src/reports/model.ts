// A neutral description of a branded document. The same model is rendered to
// Word (.docx) and to PDF so both outputs always match.

export interface ImageData {
  data: Uint8Array;
  width: number; // pixels
  height: number;
  type: 'jpg' | 'png';
}

export type Block =
  | { t: 'heading'; text: string; level?: 1 | 2 }
  | { t: 'p'; text: string; bold?: boolean; italic?: boolean; size?: number; align?: 'left' | 'center' | 'right' | 'justify' }
  | { t: 'kv'; rows: [string, string][]; cols?: 1 | 2 }
  | { t: 'table'; head: string[]; rows: string[][]; widths?: number[]; fontSize?: number }
  | { t: 'bullets'; items: string[] }
  | { t: 'photos'; items: { image: ImageData; caption: string; figure: number }[] }
  | { t: 'signatures'; items: { role: string; name: string; title?: string; cert?: string; date?: string; image?: ImageData | null }[] }
  | { t: 'contents' }
  | { t: 'pagebreak' }
  | { t: 'spacer'; size?: number }
  | { t: 'statement'; text: string };

export interface Company {
  legal_name: string;
  tagline: string;
  website: string;
  email: string;
  phone: string;
  address: string;
}

export interface Branding {
  navy: string;
  accent: string;
  text: string;
}

export interface Cover {
  title: string;
  subtitle?: string;
  client: string;
  site?: string;
  control: [string, string][];
}

export interface DocModel {
  /** Bold centred title in the page header and the PDF/Word document title. */
  title: string;
  /** "Client or equipment · document number" line under the header title. */
  headerLine: string;
  docNumber: string;
  revision: number;
  clientName: string;
  cover?: Cover;
  blocks: Block[];
  landscape?: boolean;
}

export interface RenderContext {
  company: Company;
  branding: Branding;
  logo: ImageData;
}

export const DEFAULT_BRANDING: Branding = { navy: '#1B1B3A', accent: '#E39B22', text: '#333333' };

export function revLabel(rev: number): string {
  return `Rev. ${String(rev).padStart(2, '0')}`;
}

/** Numbered top-level headings, used for the contents list. */
export function headingsOf(model: DocModel): string[] {
  return model.blocks.filter((b): b is Extract<Block, { t: 'heading' }> => b.t === 'heading' && (b.level ?? 1) === 1).map((b) => b.text);
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

/** Fits an image inside a box, keeping its proportions. */
export function fit(img: ImageData, maxW: number, maxH: number): { width: number; height: number } {
  const r = Math.min(maxW / img.width, maxH / img.height);
  return { width: Math.round(img.width * r), height: Math.round(img.height * r) };
}
