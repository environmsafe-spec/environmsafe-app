// PDF renderer (pdfmake). Matches the Word layout: A4, same margins, header on
// every page except the cover, footer with document number, confidentiality
// line and "Page X of Y".

import type { Content, ContentTable, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { fit, headingsOf, revLabel, toBase64, type Block, type DocModel, type ImageData, type RenderContext } from './model';

const TW = 1 / 20; // twips → points
const MARGIN = { top: 1100 * TW, right: 900 * TW, bottom: 800 * TW, left: 900 * TW };
const HEADER_FROM_TOP = 260 * TW;
const HEADER_H = 46; // logo (≈ 51 px → 38 pt) plus the accent line
const A4_W = 595.28;

const uri = (i: ImageData) => `data:image/${i.type === 'jpg' ? 'jpeg' : 'png'};base64,${toBase64(i.data)}`;
const px = (n: number) => n * 0.75; // CSS px → pt

export const PDF_FONT_FILES = {
  normal: 'ESReportSans-Regular.ttf',
  bold: 'ESReportSans-Bold.ttf',
  italics: 'ESReportSans-Italic.ttf',
  bolditalics: 'ESReportSans-BoldItalic.ttf',
};

export function pdfDefinition(model: DocModel, ctx: RenderContext): TDocumentDefinitions {
  const { navy, accent, text } = ctx.branding;
  const usable = A4_W - MARGIN.left - MARGIN.right;
  const logoUri = uri(ctx.logo);
  const logoSmall = fit(ctx.logo, px(70), px(51));
  const topMargin = Math.max(MARGIN.top, HEADER_FROM_TOP + HEADER_H + 10);
  const hasCover = !!model.cover;

  const gridLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#BFC3D1',
    vLineColor: () => '#BFC3D1',
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };
  const head = (t: string): TableCell => ({ text: t, bold: true, color: '#FFFFFF', fillColor: navy, fontSize: 8.5 });
  const cell = (t: string, o: { bold?: boolean; fill?: string; size?: number } = {}): TableCell => ({ text: t ?? '', bold: o.bold, fillColor: o.fill, fontSize: o.size ?? 8.5 });

  const content: Content[] = [];

  if (model.cover) {
    const c = model.cover;
    const big = fit(ctx.logo, px(230), px(170));
    content.push(
      { image: logoUri, width: big.width, height: big.height, alignment: 'center', margin: [0, 24, 0, 14] },
      { text: ctx.company.tagline, bold: true, fontSize: 13, color: navy, alignment: 'center' },
      { canvas: [{ type: 'line', x1: usable / 2 - 80, y1: 4, x2: usable / 2 + 80, y2: 4, lineWidth: 2, lineColor: accent }], margin: [0, 2, 0, 28] },
      { text: c.title.toUpperCase(), bold: true, fontSize: 20, color: navy, alignment: 'center', margin: [0, 10, 0, 6] },
    );
    if (c.subtitle) content.push({ text: c.subtitle, fontSize: 13, alignment: 'center', margin: [0, 0, 0, 16] });
    content.push(
      { text: 'Client', fontSize: 9, alignment: 'center', margin: [0, 8, 0, 0] },
      { text: c.client, bold: true, fontSize: 14, color: navy, alignment: 'center', margin: [0, 2, 0, 4] },
    );
    if (c.site) content.push({ text: c.site, fontSize: 10, alignment: 'center' });
    content.push({
      margin: [0, 34, 0, 0],
      table: { widths: [usable / 3, '*'], headerRows: 1, body: [[head('Document control'), head('')], ...c.control.map(([k, v]) => [cell(k, { bold: true, fill: '#EEF0F7' }), cell(v)])] },
      layout: gridLayout,
    } as ContentTable);
    content.push({
      text: `This document is confidential and is intended only for ${model.clientName}. It shall not be reproduced except in full without the written approval of EnvironmSafe.`,
      italics: true, fontSize: 7.5, alignment: 'center', margin: [0, 24, 0, 0], pageBreak: 'after',
    });
  }

  const sections = headingsOf(model);
  let hNum = 0;
  for (const b of model.blocks as Block[]) {
    switch (b.t) {
      case 'heading': {
        const lvl = b.level ?? 1;
        if (lvl === 1) hNum += 1;
        const label = lvl === 1 ? `${hNum}. ${b.text.toUpperCase()}` : b.text;
        content.push({
          stack: [
            { text: label, bold: true, fontSize: lvl === 1 ? 12 : 10, color: navy, tocItem: lvl === 1, tocStyle: { fontSize: 9.5 }, tocMargin: [6, 2, 0, 2] } as Content,
            ...(lvl === 1 ? [{ canvas: [{ type: 'line', x1: 0, y1: 2, x2: usable, y2: 2, lineWidth: 1.5, lineColor: accent }] } as Content] : []),
          ],
          margin: [0, lvl === 1 ? 12 : 8, 0, 6],
          unbreakable: true,
          headlineLevel: lvl,
        } as Content);
        break;
      }
      case 'p':
        content.push({ text: b.text ?? '', bold: b.bold, italics: b.italic, fontSize: b.size ?? 9.5, alignment: b.align ?? 'left', margin: [0, 0, 0, 6] });
        break;
      case 'statement':
        content.push({
          table: { widths: [3, '*'], body: [[{ text: '', fillColor: accent }, { text: b.text, bold: true, fontSize: 9.5, margin: [6, 2, 0, 2] }]] },
          layout: 'noBorders', margin: [0, 4, 0, 8],
        } as ContentTable);
        break;
      case 'bullets':
        content.push({ ul: b.items.map((i) => ({ text: i, fontSize: 9.5 })), margin: [0, 0, 0, 6] });
        break;
      case 'kv': {
        const body: TableCell[][] = [];
        if ((b.cols ?? 1) === 2) {
          for (let i = 0; i < b.rows.length; i += 2) {
            const a = b.rows[i];
            const c2 = b.rows[i + 1] ?? ['', ''];
            body.push([cell(a[0], { bold: true, fill: '#EEF0F7' }), cell(a[1]), cell(c2[0], { bold: true, fill: '#EEF0F7' }), cell(c2[1])]);
          }
          content.push({ unbreakable: body.length <= 12, table: { widths: ['21%', '29%', '21%', '29%'], body, dontBreakRows: true }, layout: gridLayout, margin: [0, 0, 0, 8] } as ContentTable);
        } else {
          for (const [k, v] of b.rows) body.push([cell(k, { bold: true, fill: '#EEF0F7' }), cell(v)]);
          content.push({ unbreakable: body.length <= 16, table: { widths: ['31%', '*'], body, dontBreakRows: true }, layout: gridLayout, margin: [0, 0, 0, 8] } as ContentTable);
        }
        break;
      }
      case 'table': {
        const rel = b.widths && b.widths.length === b.head.length ? b.widths : b.head.map(() => 1);
        const sum = rel.reduce((x, y) => x + y, 0);
        const size = b.fontSize ?? 8.5;
        content.push({
          table: {
            headerRows: 1,
            dontBreakRows: true,
            widths: rel.map((r) => (r / sum) * usable - 8.5),
            body: [b.head.map(head), ...b.rows.map((r, ri) => r.map((v) => cell(v, { size, fill: ri % 2 ? '#F7F8FB' : undefined })))],
          },
          layout: gridLayout,
          margin: [0, 0, 0, 8],
        } as ContentTable);
        break;
      }
      case 'photos': {
        const colW = usable / 2 - 9;
        const rows: TableCell[][] = [];
        for (let i = 0; i < b.items.length; i += 2) {
          rows.push([0, 1].map((k) => {
            const it = b.items[i + k];
            if (!it) return { text: '' };
            const s = fit(it.image, colW - 8, (colW - 8) * 0.78);
            return {
              stack: [
                { image: uri(it.image), width: s.width, height: s.height, alignment: 'center' },
                { text: [{ text: `Figure ${it.figure} – `, bold: true, color: navy }, { text: it.caption || '' }], fontSize: 8, alignment: 'center', margin: [0, 4, 0, 0] },
              ],
              margin: [0, 4, 0, 4],
            } as TableCell;
          }));
        }
        content.push({ table: { widths: [colW, colW], body: rows, dontBreakRows: true }, layout: gridLayout } as ContentTable);
        break;
      }
      case 'signatures': {
        const n = Math.max(1, b.items.length);
        content.push({
          unbreakable: true,
          table: {
            widths: Array(n).fill('*'),
            headerRows: 1,
            body: [
              b.items.map((s) => head(s.role)),
              b.items.map((s) => {
                const sig = s.image ? fit(s.image, 110, 40) : null;
                return {
                  stack: [
                    sig && s.image ? { image: uri(s.image), width: sig.width, height: sig.height, margin: [0, 2, 0, 4] } : { text: ' ', fontSize: 20 },
                    { text: s.name || ' ', bold: true, fontSize: 8.5 },
                    { text: [s.title, s.cert ? `Cert. ${s.cert}` : ''].filter(Boolean).join(' · ') || ' ', fontSize: 7.5 },
                    { text: s.date ? `Date: ${s.date}` : 'Date:', fontSize: 7.5 },
                  ],
                } as TableCell;
              }),
            ],
          },
          layout: gridLayout,
          margin: [0, 0, 0, 8],
        } as ContentTable);
        break;
      }
      case 'contents':
        content.push({
          stack: [
            { text: 'CONTENTS', bold: true, fontSize: 12, color: navy },
            { canvas: [{ type: 'line', x1: 0, y1: 2, x2: usable, y2: 2, lineWidth: 1.5, lineColor: accent }] },
          ],
          margin: [0, 6, 0, 8],
        });
        if (sections.length) content.push({ toc: { title: { text: '' }, numberStyle: { fontSize: 9.5 } } } as Content);
        break;
      case 'pagebreak':
        content.push({ text: '', pageBreak: 'after' });
        break;
      case 'spacer':
        content.push({ text: '', margin: [0, 0, 0, b.size ?? 10] });
        break;
    }
  }

  // Keep each heading on the same page as the block that follows it.
  const glued: Content[] = [];
  for (let i = 0; i < content.length; i++) {
    const c = content[i] as unknown as Record<string, unknown>;
    const next = content[i + 1] as unknown as Record<string, unknown> | undefined;
    if (c?.headlineLevel && next && !(next as { headlineLevel?: number }).headlineLevel) {
      const rows = ((next.table as { body?: unknown[] } | undefined)?.body?.length) ?? 0;
      const small = !next.table || rows <= 16;
      if (small) {
        glued.push({ stack: [c as unknown as Content, next as unknown as Content], unbreakable: true } as Content);
        i++;
        continue;
      }
    }
    glued.push(c as unknown as Content);
  }

  return {
    pageSize: 'A4',
    pageOrientation: model.landscape ? 'landscape' : 'portrait',
    pageMargins: [MARGIN.left, topMargin, MARGIN.right, MARGIN.bottom + 6],
    info: { title: `${model.title} ${model.docNumber}`, author: ctx.company.legal_name, subject: model.headerLine },
    defaultStyle: { font: 'Arial', fontSize: 9.5, color: text, lineHeight: 1.15 },
    header: (page: number) => {
      if (hasCover && page === 1) return { text: '' };
      return {
        margin: [MARGIN.left, HEADER_FROM_TOP, MARGIN.right, 0],
        stack: [
          {
            columns: [
              { width: '18%', stack: [{ image: logoUri, fit: [logoSmall.width, logoSmall.height] }] },
              {
                width: '*',
                stack: [
                  { text: model.title, bold: true, fontSize: model.title.length > 26 ? 9.5 : 11, color: navy, alignment: 'center' },
                  { text: model.headerLine, fontSize: 8, alignment: 'center', margin: [0, 2, 0, 0] },
                ],
                margin: [0, 6, 0, 0],
              },
              {
                width: '38%',
                stack: [
                  { text: ctx.company.legal_name, bold: true, fontSize: 6.8, color: navy, alignment: 'right' },
                  { text: `${ctx.company.website} | ${ctx.company.email}`, fontSize: 6.5, alignment: 'right' },
                  { text: `${ctx.company.phone} | ${ctx.company.address}`, fontSize: 6.5, alignment: 'right' },
                ],
                margin: [0, 4, 0, 0],
              },
            ],
          },
          { canvas: [{ type: 'line', x1: 0, y1: 4, x2: usable, y2: 4, lineWidth: 1.5, lineColor: accent }] },
        ],
      };
    },
    footer: (page: number, pages: number) => {
      if (hasCover && page === 1) return { text: '' };
      return {
        margin: [MARGIN.left, 4, MARGIN.right, 0],
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: usable, y2: 0, lineWidth: 0.5, lineColor: '#BFC3D1' }] },
          {
            columns: [
              { width: '30%', text: `${model.docNumber}  ${revLabel(model.revision)}`, fontSize: 7.5 },
              { width: '48%', text: `Confidential - EnvironmSafe & ${model.clientName}`, italics: true, fontSize: 7.5, alignment: 'center' },
              { width: '22%', text: `Page ${page} of ${pages}`, fontSize: 7.5, alignment: 'right' },
            ],
            margin: [0, 3, 0, 0],
          },
        ],
      };
    },
    content: glued,
  };
}
