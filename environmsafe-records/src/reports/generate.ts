// Renders a report model to Word and PDF files in the browser.

import { Packer } from 'docx';
import { renderDocx } from './docx';
import type { DocModel, RenderContext } from './model';
import { pdfDefinition, PDF_FONT_FILES } from './pdf';
import fontRegular from '../assets/fonts/ESReportSans-Regular.ttf?url';
import fontBold from '../assets/fonts/ESReportSans-Bold.ttf?url';
import fontItalic from '../assets/fonts/ESReportSans-Italic.ttf?url';
import fontBoldItalic from '../assets/fonts/ESReportSans-BoldItalic.ttf?url';

let vfs: Record<string, string> | null = null;

async function fonts(): Promise<Record<string, string>> {
  if (vfs) return vfs;
  const { toBase64 } = await import('./model');
  const urls: Record<string, string> = {
    [PDF_FONT_FILES.normal]: fontRegular, [PDF_FONT_FILES.bold]: fontBold,
    [PDF_FONT_FILES.italics]: fontItalic, [PDF_FONT_FILES.bolditalics]: fontBoldItalic,
  };
  const out: Record<string, string> = {};
  for (const [name, url] of Object.entries(urls)) {
    out[name] = toBase64(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  }
  vfs = out;
  return out;
}

export async function renderBoth(model: DocModel, ctx: RenderContext): Promise<{ docx: Blob; pdf: Blob }> {
  const docx = await Packer.toBlob(renderDocx(model, ctx));
  const pdfMake = (await import('pdfmake/build/pdfmake')).default as unknown as {
    createPdf: (d: unknown, t?: unknown, f?: unknown, v?: unknown) => { getBlob: (cb: (b: Blob) => void) => void };
  };
  const v = await fonts();
  const pdf: Blob = await new Promise((res) => pdfMake.createPdf(pdfDefinition(model, ctx), undefined, { Arial: PDF_FONT_FILES }, v).getBlob(res));
  return { docx: new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), pdf };
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}
