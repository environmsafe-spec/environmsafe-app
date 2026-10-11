// Word renderer. Page set-up and branding follow the company standard:
// A4, margins T1100 R900 B800 L900 twips, header/footer 260, Arial,
// navy #1B1B3A table headers and titles, accent #E39B22 rules.

import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, PageBreak, PageNumber, PageOrientation, Paragraph, ShadingType, Table,
  TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, type IBorderOptions, type ParagraphChild,
} from 'docx';
import { fit, headingsOf, revLabel, type Block, type DocModel, type ImageData, type RenderContext } from './model';

const PAGE_W = 11906;
const PAGE_H = 16838;
const M = { top: 1100, right: 900, bottom: 800, left: 900, header: 260, footer: 260 };

const hex = (c: string) => c.replace('#', '').toUpperCase();
const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const GRID = (c = 'BFC3D1'): IBorderOptions => ({ style: BorderStyle.SINGLE, size: 4, color: c });

function img(i: ImageData, w: number, h: number): ImageRun {
  return new ImageRun({ type: i.type, data: i.data, transformation: { width: w, height: h } });
}

function run(text: string, o: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({ text, bold: o.bold, italics: o.italic, size: o.size, color: o.color, font: 'Arial' });
}

/** Text with line breaks preserved. */
function lines(text: string, o: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): ParagraphChild[] {
  const parts = (text ?? '').split('\n');
  return parts.map((p, i) => new TextRun({ text: p, break: i > 0 ? 1 : undefined, bold: o.bold, italics: o.italic, size: o.size, color: o.color, font: 'Arial' }));
}

export function renderDocx(model: DocModel, ctx: RenderContext): Document {
  const navy = hex(ctx.branding.navy);
  const accent = hex(ctx.branding.accent);
  const text = hex(ctx.branding.text);
  const landscape = !!model.landscape;
  const pageW = landscape ? PAGE_H : PAGE_W;
  const usable = pageW - M.left - M.right;

  const headerTable = () => {
    const logo = fit(ctx.logo, 70, 51);
    const left = Math.round(usable * 0.18);
    const right = Math.round(usable * 0.38);
    const middle = usable - left - right;
    return new Table({
      width: { size: usable, type: WidthType.DXA },
      columnWidths: [left, middle, right],
      layout: TableLayoutType.FIXED,
      borders: { top: NONE, left: NONE, right: NONE, bottom: { style: BorderStyle.SINGLE, size: 12, color: accent }, insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ verticalAlign: VerticalAlign.CENTER, width: { size: left, type: WidthType.DXA }, children: [new Paragraph({ children: [img(ctx.logo, logo.width, logo.height)] })] }),
            new TableCell({
              verticalAlign: VerticalAlign.CENTER, width: { size: middle, type: WidthType.DXA },
              children: [
                new Paragraph({ alignment: AlignmentType.CENTER, children: [run(model.title, { bold: true, size: model.title.length > 26 ? 19 : 22, color: navy })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [run(model.headerLine, { size: 16, color: text })] }),
              ],
            }),
            new TableCell({
              verticalAlign: VerticalAlign.CENTER, width: { size: right, type: WidthType.DXA },
              children: [
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(ctx.company.legal_name, { bold: true, size: 13, color: navy })] }),
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${ctx.company.website} | ${ctx.company.email}`, { size: 13, color: text })] }),
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${ctx.company.phone} | ${ctx.company.address}`, { size: 13, color: text })] }),
              ],
            }),
          ],
        }),
      ],
    });
  };

  const footerTable = () => {
    const l = Math.round(usable * 0.3);
    const r = Math.round(usable * 0.22);
    return new Table({
      width: { size: usable, type: WidthType.DXA },
      columnWidths: [l, usable - l - r, r],
      layout: TableLayoutType.FIXED,
      borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'BFC3D1' }, left: NONE, right: NONE, bottom: NONE, insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [run(`${model.docNumber}  ${revLabel(model.revision)}`, { size: 15, color: text })] })] }),
            new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`Confidential - EnvironmSafe & ${model.clientName}`, { italic: true, size: 15, color: text })] })] }),
            new TableCell({
              children: [new Paragraph({ style: 'EsFooter', alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: text, font: 'Arial' })] })],
            }),
          ],
        }),
      ],
    });
  };

  const headCell = (t: string, w: number) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: navy },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ children: [run(t, { bold: true, color: 'FFFFFF', size: 17 })] })],
    });
  const bodyCell = (t: string, w: number, o: { bold?: boolean; shade?: string; size?: number } = {}) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: o.shade } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      children: [new Paragraph({ children: lines(t, { bold: o.bold, size: o.size ?? 17, color: text }) })],
    });

  const tableBorders = { top: GRID(), bottom: GRID(), left: GRID(), right: GRID(), insideHorizontal: GRID(), insideVertical: GRID() };

  const widthsFor = (n: number, rel?: number[]) => {
    const r = rel && rel.length === n ? rel : Array(n).fill(1);
    const sum = r.reduce((a, b) => a + b, 0);
    const w = r.map((x) => Math.floor((x / sum) * usable));
    w[w.length - 1] += usable - w.reduce((a, b) => a + b, 0);
    return w;
  };

  const heading = (textStr: string, level: 1 | 2, number?: number) =>
    new Paragraph({
      keepNext: true,
      spacing: { before: level === 1 ? 280 : 180, after: 120 },
      border: level === 1 ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 2 } } : undefined,
      children: [run(`${number ? `${number}. ` : ''}${level === 1 ? textStr.toUpperCase() : textStr}`, { bold: true, size: level === 1 ? 24 : 20, color: navy })],
    });

  const children: (Paragraph | Table)[] = [];

  // Cover page
  if (model.cover) {
    const c = model.cover;
    const big = fit(ctx.logo, 230, 170);
    children.push(new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [img(ctx.logo, big.width, big.height)] }));
    children.push(new Paragraph({ spacing: { before: 300, after: 60 }, alignment: AlignmentType.CENTER, children: [run(ctx.company.tagline, { bold: true, size: 26, color: navy })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 4 } }, indent: { left: 3200, right: 3200 }, children: [] }));
    children.push(new Paragraph({ spacing: { before: 600, after: 120 }, alignment: AlignmentType.CENTER, children: [run(c.title.toUpperCase(), { bold: true, size: 40, color: navy })] }));
    if (c.subtitle) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(c.subtitle, { size: 26, color: text })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [run('Client', { size: 18, color: text })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [run(c.client, { bold: true, size: 28, color: navy })] }));
    if (c.site) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(c.site, { size: 20, color: text })] }));
    children.push(new Paragraph({ spacing: { before: 600 }, children: [] }));
    const w = widthsFor(2, [1, 2]);
    children.push(new Table({
      width: { size: usable, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, borders: tableBorders,
      rows: [
        new TableRow({ tableHeader: true, children: [headCell('Document control', w[0]), headCell('', w[1])] }),
        ...c.control.map(([k, v]) => new TableRow({ children: [bodyCell(k, w[0], { bold: true, shade: 'EEF0F7' }), bodyCell(v, w[1])] })),
      ],
    }));
    children.push(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [run(`This document is confidential and is intended only for ${model.clientName}. It shall not be reproduced except in full without the written approval of EnvironmSafe.`, { italic: true, size: 15, color: text })] }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  const sections = headingsOf(model);
  let hNum = 0;
  for (const b of model.blocks as Block[]) {
    switch (b.t) {
      case 'heading':
        if ((b.level ?? 1) === 1) hNum += 1;
        children.push(heading(b.text, b.level ?? 1, (b.level ?? 1) === 1 ? hNum : undefined));
        break;
      case 'p':
        children.push(new Paragraph({
          spacing: { after: 120 },
          alignment: b.align === 'center' ? AlignmentType.CENTER : b.align === 'right' ? AlignmentType.RIGHT : b.align === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
          children: lines(b.text, { bold: b.bold, italic: b.italic, size: b.size ? b.size * 2 : 19, color: text }),
        }));
        break;
      case 'statement':
        children.push(new Paragraph({
          keepNext: true,
          spacing: { before: 120, after: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: accent, space: 8 } },
          indent: { left: 200 },
          children: lines(b.text, { size: 19, color: text, bold: true }),
        }));
        break;
      case 'bullets':
        for (const it of b.items) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: lines(it, { size: 19, color: text }) }));
        break;
      case 'kv': {
        const cols = b.cols ?? 1;
        const w = cols === 2 ? widthsFor(4, [1.1, 1.4, 1.1, 1.4]) : widthsFor(2, [1, 2.2]);
        const rows: TableRow[] = [];
        if (cols === 2) {
          for (let i = 0; i < b.rows.length; i += 2) {
            const a = b.rows[i];
            const c2 = b.rows[i + 1] ?? ['', ''];
            rows.push(new TableRow({ cantSplit: true, children: [bodyCell(a[0], w[0], { bold: true, shade: 'EEF0F7' }), bodyCell(a[1], w[1]), bodyCell(c2[0], w[2], { bold: true, shade: 'EEF0F7' }), bodyCell(c2[1], w[3])] }));
          }
        } else {
          for (const [k, v] of b.rows) rows.push(new TableRow({ cantSplit: true, children: [bodyCell(k, w[0], { bold: true, shade: 'EEF0F7' }), bodyCell(v, w[1])] }));
        }
        children.push(new Table({ width: { size: usable, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, borders: tableBorders, rows }));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case 'table': {
        const w = widthsFor(b.head.length, b.widths);
        const size = b.fontSize ? b.fontSize * 2 : 17;
        children.push(new Table({
          width: { size: usable, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, borders: tableBorders,
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: b.head.map((h, i) => headCell(h, w[i])) }),
            ...b.rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((cell, i) => bodyCell(cell, w[i], { size, shade: ri % 2 ? 'F7F8FB' : undefined })) })),
          ],
        }));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case 'photos': {
        const colW = Math.floor(usable / 2);
        const maxPx = Math.floor((colW / 1440) * 96) - 16;
        const rows: TableRow[] = [];
        for (let i = 0; i < b.items.length; i += 2) {
          const pair = b.items.slice(i, i + 2);
          rows.push(new TableRow({
            cantSplit: true,
            children: [0, 1].map((k) => {
              const it = pair[k];
              if (!it) return new TableCell({ width: { size: colW, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] });
              const s = fit(it.image, maxPx, Math.round(maxPx * 0.78));
              return new TableCell({
                width: { size: colW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 80, right: 80 },
                children: [
                  new Paragraph({ alignment: AlignmentType.CENTER, children: [img(it.image, s.width, s.height)] }),
                  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: [run(`Figure ${it.figure} – `, { bold: true, size: 16, color: navy }), run(it.caption || '', { size: 16, color: text })] }),
                ],
              });
            }),
          }));
        }
        children.push(new Table({ width: { size: usable, type: WidthType.DXA }, columnWidths: [colW, usable - colW], layout: TableLayoutType.FIXED, borders: tableBorders, rows }));
        break;
      }
      case 'signatures': {
        const n = Math.max(1, b.items.length);
        const w = widthsFor(n);
        children.push(new Table({
          width: { size: usable, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, borders: tableBorders,
          rows: [
            new TableRow({ tableHeader: true, children: b.items.map((s, i) => headCell(s.role, w[i])) }),
            new TableRow({
              cantSplit: true,
              children: b.items.map((s, i) => {
                const sig = s.image ? fit(s.image, 150, 55) : null;
                return new TableCell({
                  width: { size: w[i], type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 80, right: 80 },
                  children: [
                    new Paragraph({ spacing: { after: 60 }, children: sig && s.image ? [img(s.image, sig.width, sig.height)] : [run(' ', { size: 40 })] }),
                    new Paragraph({ children: [run(s.name || '', { bold: true, size: 17, color: text })] }),
                    new Paragraph({ children: [run([s.title, s.cert ? `Cert. ${s.cert}` : ''].filter(Boolean).join(' · '), { size: 15, color: text })] }),
                    new Paragraph({ children: [run(s.date ? `Date: ${s.date}` : 'Date:', { size: 15, color: text })] }),
                  ],
                });
              }),
            }),
          ],
        }));
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case 'contents':
        children.push(heading('Contents', 1));
        sections.forEach((s, i) => {
          children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 200 }, children: [run(`${i + 1}.  ${s.toUpperCase()}`, { size: 19, color: text })] }));
        });
        break;
      case 'pagebreak':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'spacer':
        children.push(new Paragraph({ spacing: { after: (b.size ?? 10) * 20 }, children: [] }));
        break;
    }
  }

  return new Document({
    creator: ctx.company.legal_name,
    title: `${model.title} ${model.docNumber}`,
    description: model.headerLine,
    styles: {
      default: { document: { run: { font: 'Arial', size: 19, color: text } } },
      paragraphStyles: [{ id: 'EsFooter', name: 'ES Footer', basedOn: 'Normal', run: { font: 'Arial', size: 15, color: text } }],
    },
    sections: [
      {
        properties: {
          titlePage: !!model.cover,
          page: {
            size: { width: PAGE_W, height: PAGE_H, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: M,
          },
        },
        headers: { default: new Header({ children: [headerTable(), new Paragraph({ spacing: { after: 60 }, children: [] })] }), first: new Header({ children: [new Paragraph({ children: [] })] }) },
        footers: { default: new Footer({ children: [footerTable()] }), first: new Footer({ children: [new Paragraph({ children: [] })] }) },
        children,
      },
    ],
  });
}
