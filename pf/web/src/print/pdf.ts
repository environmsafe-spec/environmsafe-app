// EnvironmSafe printed documents, rendered in the browser with pdf-lib (no server, no cost).
// Line-for-line port of pf/pdf/es_pdf/render.py, which reproduced sample_PO.pdf / sample_Invoice.pdf from
// measured positions; the visual test (pf/pdf/tests/visual_js.py) checks this output against the samples.
// Coordinates are "from the top of the page" in points, like the measurements; Y() converts.
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import qrcode from 'qrcode-generator'

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const NAVY = hex('#14294a'), GOLD = hex('#d9a21b'), GREY = hex('#555555'), LIGHT = hex('#e8edf3'), LINE = hex('#c9d3df')
const WHITE = rgb(1, 1, 1)
const W = 595.2755905511812, H = 841.8897637795277      // A4, as ReportLab
const LEFT = 36.0, RIGHT = 557.3
const BOTTOM_LIMIT = 790.0
const Y = (y: number) => H - y
const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/

export interface PrintAssets {
  logo?: Uint8Array | ArrayBuffer | null          // JPEG
  signature?: Uint8Array | ArrayBuffer | null     // PNG
  arabicRegular?: Uint8Array | ArrayBuffer | null // TTF, loaded only when the document has Arabic text
  arabicBold?: Uint8Array | ArrayBuffer | null
}

// --- formatting ------------------------------------------------------------------------------
const DECIMALS: Record<string, number> = { USD: 2, SAR: 2, YER: 0 }
export function money(v: unknown, currency?: string | null): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  const d = DECIMALS[currency ?? 'USD'] ?? 2
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
export function qty(v: unknown): string {
  if (typeof v === 'string') return v
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dateShort(v: unknown): string {
  if (!v) return ''
  const [y, m, d] = String(v).slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}
export function dateLong(v: unknown): string {
  if (!v) return ''
  const [y, m, d] = String(v).slice(0, 10).split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

const ONES = 'Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' ')
const TENS = 'Zero Ten Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split(' ')
const CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
  USD: ['US Dollar', 'US Dollars', 'Cent', 'Cents'], SAR: ['Saudi Riyal', 'Saudi Riyals', 'Halala', 'Halalas'],
  YER: ['Yemeni Rial', 'Yemeni Rials', 'Fils', 'Fils'],
}
function words(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 === 0 ? '' : '-' + ONES[n % 10])
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 === 0 ? '' : ' ' + words(n % 100))
  for (const [div, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1000, 'Thousand']] as const) {
    if (n >= div) return words(Math.floor(n / div)) + ' ' + name + (n % div === 0 ? '' : ' ' + words(n % div))
  }
  return String(n)
}
/** 1852.63 USD -> 'One Thousand Eight Hundred Fifty-Two US Dollars and Sixty-Three Cents only'. */
export function amountInWords(amount: number, currency: string): string {
  const [ms, mp, ns, np] = CURRENCY_WORDS[currency] ?? [currency, currency, 'cent', 'cents']
  const total = Math.round(Number(amount) * 100)
  const major = Math.floor(total / 100), minor = total % 100
  let s = `${words(major)} ${major !== 1 ? mp : ms}`
  if (minor) s += ` and ${words(minor)} ${minor !== 1 ? np : ns}`
  return s + ' only'
}

// --- profiles (measured from the samples) --------------------------------------------------------
interface Profile {
  cols: number[]; headH: number; headSize: number; bodySize: number; detailSize: number; detailLeading: number
  totalsX: number; totalsRowH: number; valuePad: number; termsGap: number; po: boolean
}
const PROFILE_PO: Profile = { cols: [36, 62, 252, 286, 316, 386, 454, RIGHT], headH: 22, headSize: 8.5, bodySize: 8.5, detailSize: 7.5, detailLeading: 10.0, totalsX: 306.0, totalsRowH: 22.0, valuePad: 8.0, termsGap: 22.0, po: true }
const PROFILE_INVOICE: Profile = { cols: [36, 62, 282, 322, 356, 426, 496, RIGHT], headH: 26, headSize: 8.3, bodySize: 8.3, detailSize: 7.2, detailLeading: 9.5, totalsX: 357.3, totalsRowH: 20.0, valuePad: 6.0, termsGap: 26.0, po: false }

const TITLES: Record<string, string[]> = {
  purchase_order: ['PURCHASE', 'ORDER'], sales_invoice: ['INVOICE'], quotation: ['QUOTATION'], credit_note: ['CREDIT', 'NOTE'],
  supplier_bill: ['SUPPLIER', 'BILL'], customer_request: ['CUSTOMER', 'REQUEST'], supplier_rfq: ['REQUEST FOR', 'QUOTATION'],
  supplier_offer: ['SUPPLIER', 'OFFER'], sales_order: ['ORDER', 'CONFIRMATION'], goods_receipt: ['GOODS', 'RECEIPT'], delivery_note: ['DELIVERY', 'NOTE'], payment: ['PAYMENT', 'VOUCHER'], receipt: ['RECEIPT', 'VOUCHER'], statement: ['STATEMENT'],
}

/** The print description (built by buildPrintDocument, same shape the Python renderer took). */
export interface PrintDocument {
  kind?: string; number?: string | null; date?: string | null; currency?: string; status?: string; revision?: number
  title?: string[]; to_label?: string; to?: { name?: string; lines?: string[] }; meta?: [string, string][]
  lines?: { sn?: number | string; description?: string | null; detail?: string | null; unit?: string | null; qty?: number | string; unit_price?: number | string | null; amount?: number | string | null; currency?: string }[]
  totals?: { label: string; value: number | string }[]; total?: { label?: string; value?: string } | null
  terms?: { label?: string; text: string }[]; terms_title?: string; amount_words?: boolean; total_amount?: number | null
  signature?: { style?: 'acceptance' | 'single'; date?: string | null; signed?: boolean; acceptance?: { party?: string; name?: string } }
  verify_url?: string | null; company?: Record<string, string>
}

type FontName = 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique'

class Renderer {
  private pdf!: PDFDocument
  private page!: PDFPage
  private fonts = {} as Record<FontName | 'Arabic' | 'Arabic-Bold', PDFFont | undefined>
  private logo?: PDFImage
  private signatureImg?: PDFImage
  private profile: Profile
  private kind: string
  private company: Record<string, string>
  private pages = 1
  private y = 0
  private arabicHas?: (cp: number) => boolean
  private doc: PrintDocument
  private assets: PrintAssets

  constructor(doc: PrintDocument, assets: PrintAssets) {
    this.doc = doc
    this.assets = assets
    this.kind = doc.kind ?? 'sales_invoice'
    this.profile = ['purchase_order', 'supplier_bill', 'payment', 'receipt'].includes(this.kind) ? PROFILE_PO : PROFILE_INVOICE
    this.company = {
      name: 'EnvironmSafe', tagline: 'For Engineering, Trading, and Services Ltd',
      legal_name: 'EnvironmSafe For Engineering, Trading, and Services Ltd',
      address: 'Aden-Alburaqah / Sanaa-Alsafiah', phones: '(967) 773033186 - 783402932',
      email: 'support@environmsafe.com', website: 'www.environmsafe.com', ...(doc.company ?? {}),
    }
  }

  // --- text helpers -----------------------------------------------------------------------------
  private fontFor(s: string, font: FontName): [string, PDFFont] {
    if (AR.test(s) && this.fonts.Arabic) {
      // fontkit joins the letters and orders the text right to left itself (logical text in).
      // Characters the Arabic font lacks (e.g. "-") become a dash it has, or a space.
      const has = this.arabicHas ?? (() => true)
      const safe = [...s].map((ch) => has(ch.codePointAt(0)!) ? ch : ch === '-' && has(0x2013) ? '\u2013' : ' ').join('')
      return [safe, (font === 'Helvetica-Bold' ? this.fonts['Arabic-Bold'] ?? this.fonts.Arabic : this.fonts.Arabic)!]
    }
    // Standard fonts only cover Latin-1: anything else is shown as "?" rather than failing the document.
    const f = this.fonts[font]!
    const safe = [...s].map((ch) => { try { f.encodeText(ch); return ch } catch { return '?' } }).join('')
    return [safe, f]
  }
  /** Width as drawn: pdf-lib's own measure applies kerning pairs, but drawText (like ReportLab) does not
   *  kern, so the width is the sum of the characters' widths. */
  private measure(f: PDFFont, s: string, size: number) {
    if (f === this.fonts.Arabic || f === this.fonts['Arabic-Bold']) return f.widthOfTextAtSize(s, size)   // shaped width
    let w = 0
    for (const ch of s) w += f.widthOfTextAtSize(ch, size)
    return w
  }
  width(s: string, font: FontName, size: number) {
    const [t, f] = this.fontFor(s ?? '', font)
    return this.measure(f, t, size)
  }
  text(x: number, base: number, value: unknown, font: FontName = 'Helvetica', size = 8.5, color: RGB = GREY, align: 'left' | 'center' | 'right' = 'left') {
    const [s, f] = this.fontFor(value === null || value === undefined ? '' : String(value), font)
    const w = this.measure(f, s, size)
    if (align === 'center') x -= w / 2
    else if (align === 'right') x -= w
    if (s) this.page.drawText(s, { x, y: Y(base), size, font: f, color })
    return w
  }
  wrap(s: string, font: FontName, size: number, maxW: number, firstW?: number): string[] {
    const ws = (s ?? '').split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let cur = '', limit = firstW ?? maxW
    for (const w of ws) {
      const trial = `${cur} ${w}`.trim()
      if (this.width(trial, font, size) <= limit || !cur) cur = trial
      else { lines.push(cur); cur = w; limit = maxW }
    }
    if (cur) lines.push(cur)
    return lines.length ? lines : ['']
  }
  rect(x0: number, y0: number, x1: number, y1: number, fill: RGB) {
    this.page.drawRectangle({ x: x0, y: Y(y1), width: x1 - x0, height: y1 - y0, color: fill })
  }
  hline(x0: number, x1: number, y: number, color = LINE, lw = 0.5) {
    this.page.drawLine({ start: { x: x0, y: Y(y) }, end: { x: x1, y: Y(y) }, thickness: lw, color })
  }
  vline(x: number, y0: number, y1: number, color = LINE, lw = 0.5) {
    this.page.drawLine({ start: { x, y: Y(y0) }, end: { x, y: Y(y1) }, thickness: lw, color })
  }

  // --- page furniture ---------------------------------------------------------------------------
  frame() {
    this.rect(0, 0, 8, H, GOLD)
    this.rect(0, 811.9, W, H, NAVY)
    this.text(W / 2, 829.9, `${this.company.legal_name}   |   ${this.company.website}`, 'Helvetica', 7.5, WHITE, 'center')
    const status = this.doc.status
    if (status === 'draft' || status === 'void') {
      const label = status === 'void' ? 'VOID' : 'DRAFT'
      const f = this.fonts['Helvetica-Bold']!
      const w = this.measure(f, label, 96)
      const a = (35 * Math.PI) / 180
      this.page.drawText(label, {
        x: W / 2 - (w / 2) * Math.cos(a), y: H / 2 - (w / 2) * Math.sin(a), size: 96, font: f, rotate: degrees(35),
        color: status === 'void' ? hex('#c0392b') : hex('#999999'), opacity: 0.12,
      })
    }
  }

  header() {
    const co = this.company
    if (this.logo) this.page.drawImage(this.logo, { x: 42, y: Y(111), width: 88, height: 64 })
    this.text(245, 52.0, co.name, 'Helvetica-Bold', 17, NAVY, 'center')
    ;[co.tagline, co.address, co.phones, `${co.email}  |  ${co.website}`].forEach((line, i) =>
      this.text(245, 66.0 + 11 * i, line, 'Helvetica', 8.5, GREY, 'center'))
    const title = this.doc.title ?? TITLES[this.kind] ?? ['DOCUMENT']
    if (title.length === 1) {
      const short = title[0].length <= 9
      this.text(RIGHT, short ? 62.0 : 56.0, title[0], 'Helvetica-Bold', short ? 20 : 18, GOLD, 'right')
    } else {
      this.text(RIGHT, 56.0, title[0], 'Helvetica-Bold', 18, GOLD, 'right')
      this.text(RIGHT, 76.0, title[1], 'Helvetica-Bold', 18, GOLD, 'right')
    }
    if (this.doc.revision) this.text(RIGHT, 92.0, `Rev.${this.doc.revision}`, 'Helvetica-Bold', 10, NAVY, 'right')
  }

  toBlock() {
    this.hline(LEFT, 290, 128.0, LINE, 0.6)
    this.text(LEFT, 140.0, this.doc.to_label ?? 'TO:', 'Helvetica-Bold', 8, GOLD)
    const to = this.doc.to ?? {}
    const lines = (to.lines ?? []).filter(Boolean)
    const po = this.profile.po
    const [first, step] = po ? [156.0, 13.0] : [152.0, 12.0]
    this.text(LEFT, first, to.name ?? '', 'Helvetica-Bold', 10, NAVY)
    lines.slice(0, 6).forEach((line, i) => this.text(LEFT, po ? first + 13.0 + step * i : first + 12.0 + step * i, line, 'Helvetica', 9, GREY))
  }

  metaBox() {
    const meta = [...(this.doc.meta ?? [])].slice(0, 4) as [string, string][]
    while (meta.length < 4) meta.push(['', ''])
    const mid = (330 + RIGHT) / 2
    for (const [row, top] of [[0, 138.0], [1, 180.0]] as const) {
      this.rect(330, top, RIGHT, top + 20, NAVY)
      this.rect(330, top + 20, RIGHT, top + 42, LIGHT)
      this.hline(330, RIGHT, top + 20, WHITE, 0.6)
      this.hline(330, RIGHT, top + 42, WHITE, 0.6)
      for (const col of [0, 1]) {
        const [label, value] = meta[row * 2 + col]
        const cx = col === 0 ? (330 + mid) / 2 : (mid + RIGHT) / 2
        this.text(cx, top + 12.5, label, 'Helvetica-Bold', 8.5, WHITE, 'center')
        const v = String(value ?? '')
        const size = this.width(v, 'Helvetica', 8.5) <= mid - 330 - 20 ? 8.5 : 7.5
        this.text(cx, top + 33.5, v, 'Helvetica', size, GREY, 'center')
      }
    }
  }

  // --- items table --------------------------------------------------------------------------------
  tableHeader(top: number): number {
    const p = this.profile, x = p.cols
    this.rect(x[0], top, x[x.length - 1], top + p.headH, NAVY)
    const base = top + p.headH / 2 + 2.5 + (p.headH > 22 ? 0.5 : 0)
    ;['SN', 'DESCRIPTION', 'UNIT', 'QTY', 'UNIT PRICE', 'AMOUNT', 'CURRENCY'].forEach((lab, i) => {
      if (i === 1) this.text(x[1] + 6, base, lab, 'Helvetica-Bold', p.headSize, WHITE)
      else this.text((x[i] + x[i + 1]) / 2, base, lab, 'Helvetica-Bold', p.headSize, WHITE, 'center')
    })
    return top + p.headH
  }

  rowLayout(line: NonNullable<PrintDocument['lines']>[number]): [string[], number, number] {
    const p = this.profile
    const descW = p.cols[2] - p.cols[1] - 12
    const details: string[] = []
    for (const part of String(line.detail ?? '').split('\n')) {
      if (part.trim()) details.push(...this.wrap(part, 'Helvetica-Oblique', p.detailSize, descW))
    }
    const title = this.wrap(String(line.description ?? ''), 'Helvetica', p.bodySize, descW)
    const n = title.length - 1 + details.length
    let h = p.po ? 24.0 + p.detailLeading * n : 20.0 + p.detailLeading * Math.max(n, 0) + (n ? 1.0 : 0)
    h = Math.max(h, 24.0)
    return [[...title, ...details], h, title.length]
  }

  items() {
    const p = this.profile, x = p.cols
    let top = this.tableHeader(250.0)
    const currency = this.doc.currency ?? 'USD'
    ;(this.doc.lines ?? []).forEach((line, k) => {
      const [all, h, titleN] = this.rowLayout(line)
      if (top + h > BOTTOM_LIMIT) {
        this.closeTable(top)
        this.newPage()
        top = this.tableHeader(60.0)
      }
      const first = top + (p.po ? 15.1 : 13.5)
      all.forEach((s, i) => {
        if (i < titleN) this.text(x[1] + 6, first + i * 10.5, s, 'Helvetica', p.bodySize, NAVY)
        else this.text(x[1] + 6, first + (titleN - 1) * 10.5 + (p.po ? 10.0 : 9.7) + (i - titleN) * p.detailLeading, s, 'Helvetica-Oblique', p.detailSize, GREY)
      })
      const base = top + h / 2 + 2.5
      const ccy = line.currency ?? currency
      this.text((x[0] + x[1]) / 2, base, line.sn ?? k + 1, 'Helvetica', p.bodySize, GREY, 'center')
      this.text((x[2] + x[3]) / 2, base, line.unit ?? '', 'Helvetica', p.bodySize, GREY, 'center')
      this.text((x[3] + x[4]) / 2, base, qty(line.qty ?? 1), 'Helvetica', p.bodySize, GREY, 'center')
      this.text(x[5] - p.valuePad, base, line.unit_price !== null && line.unit_price !== undefined ? money(line.unit_price, ccy) : '', 'Helvetica', p.bodySize, GREY, 'right')
      this.text(x[6] - p.valuePad, base, line.amount !== null && line.amount !== undefined ? money(line.amount, ccy) : '', 'Helvetica-Bold', p.bodySize, NAVY, 'right')
      this.text((x[6] + x[7]) / 2, base, ccy, 'Helvetica', p.bodySize, GREY, 'center')
      this.hline(x[0], x[x.length - 1], top)
      for (const xx of x) this.vline(xx, top, top + h)
      top += h
    })
    this.closeTable(top)
    this.y = top
  }

  closeTable(bottom: number) {
    this.hline(this.profile.cols[0], this.profile.cols[this.profile.cols.length - 1], bottom)
  }

  newPage() {
    this.page = this.pdf.addPage([W, H])
    this.pages += 1
    this.frame()
    const name = (TITLES[this.kind] ?? ['DOCUMENT']).join(' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    this.text(LEFT, 40.0, `${name} ${this.doc.number ?? ''} (continued)`, 'Helvetica-Bold', 9, NAVY)
  }

  ensure(needed: number) {
    if (this.y + needed > BOTTOM_LIMIT) { this.newPage(); this.y = 60.0 }
  }

  // --- totals, terms, signatures ------------------------------------------------------------------
  totals() {
    const p = this.profile
    const rows = this.doc.totals ?? []
    const total = this.doc.total
    this.ensure(8 + p.totalsRowH * rows.length + 26)
    let top = this.y + 8
    const tx = p.totalsX
    for (const r of rows) {
      const base = top + (p.totalsRowH >= 22 ? 13.5 : 12.5)
      this.text(tx + 6, base, String(r.label ?? '').toUpperCase(), 'Helvetica', 8.5, GREY)
      this.text(RIGHT - 6, base, money(r.value, this.doc.currency), 'Helvetica-Bold', 8.5, NAVY, 'right')
      top += p.totalsRowH
      this.hline(tx, RIGHT, top)
    }
    if (total) {
      this.rect(tx, top, RIGHT, top + 26, GOLD)
      this.text(tx + 6, top + 17, String(total.label ?? 'TOTAL').toUpperCase(), 'Helvetica-Bold', 10, WHITE)
      this.text(RIGHT - 6, top + 17, total.value ?? '', 'Helvetica-Bold', 10, WHITE, 'right')
      top += 26
    }
    this.y = top
  }

  terms() {
    const terms = (this.doc.terms ?? []).filter((t) => t.text)
    if (this.doc.amount_words && this.doc.total_amount !== null && this.doc.total_amount !== undefined
        && !terms.some((t) => String(t.label ?? '').toLowerCase() === 'amount in words')) {
      const at = terms.findIndex((t) => String(t.label ?? '').toLowerCase() === 'bank')
      terms.splice(at < 0 ? terms.length : at, 0, { label: 'Amount in words', text: amountInWords(this.doc.total_amount, this.doc.currency ?? 'USD') })
    }
    if (!terms.length) return
    this.ensure(40)
    let base = this.y + this.profile.termsGap
    this.text(LEFT, base, this.doc.terms_title ?? 'Terms & Conditions:', 'Helvetica-Bold', 10, NAVY)
    base += 16.5
    const maxW = RIGHT - LEFT
    for (const t of terms) {
      const label = t.label ? `${t.label.replace(/:+$/, '')}:` : ''
      const lw = label ? this.width(label, 'Helvetica-Bold', 8) : 0
      const body = this.wrap(String(t.text), 'Helvetica', 8, maxW, maxW - lw - this.width(' ', 'Helvetica', 8))
      if (base + 10.5 * body.length > BOTTOM_LIMIT) { this.newPage(); base = 60.0 }
      if (label) this.text(LEFT, base, label, 'Helvetica-Bold', 8, NAVY)
      body.forEach((b, i) => {
        if (i === 0) this.text(LEFT + lw, base, (label ? ' ' : '') + b, 'Helvetica', 8, GREY)
        else { base += 10.5; this.text(LEFT, base, b, 'Helvetica', 8, GREY) }
      })
      base += 13.0
    }
    this.y = base - 13.0
  }

  signature() {
    const sig = this.doc.signature ?? {}
    const style = sig.style ?? (this.kind === 'purchase_order' ? 'acceptance' : 'single')
    const signDate = dateShort(sig.date ?? this.doc.date)
    const signed = sig.signed ?? true
    if (style === 'acceptance') {
      this.ensure(150)
      const b = this.y + 28.5
      this.wrap(`For ${this.company.legal_name}`, 'Helvetica-Bold', 9, 200).forEach((s, i) => this.text(LEFT, b + 11 * i, s, 'Helvetica-Bold', 9, NAVY))
      const acc = sig.acceptance ?? {}
      this.text(306.6, b, 'Supplier Acceptance', 'Helvetica-Bold', 9, NAVY)
      this.text(306.6, b + 11, `For ${acc.party ?? ''}`.trim(), 'Helvetica', 8, GREY)
      this.text(LEFT, b + 26, 'Authorized Signature:', 'Helvetica', 8.5)
      this.text(306.6, b + 26, `Name: ${acc.name ?? ''}`.trimEnd(), 'Helvetica', 8.5)
      this.text(306.6, b + 40, 'Signature & Stamp:', 'Helvetica', 8.5)
      const lineY = b + 121
      if (signed && this.signatureImg) this.page.drawImage(this.signatureImg, { x: 91, y: Y(lineY + 5), width: 165, height: 113.8 })
      this.hline(LEFT, 271, lineY, NAVY, 0.8)
      this.hline(306.6, RIGHT, lineY, NAVY, 0.8)
      this.text(LEFT, lineY + 13, `Date: ${signDate}`, 'Helvetica', 8.5)
      this.text(306.6, lineY + 13, 'Date:', 'Helvetica', 8.5)
      this.y = lineY + 13
    } else {
      this.ensure(125)
      const b = this.y + 32.5
      this.text(LEFT, b, this.company.legal_name, 'Helvetica-Bold', 9.5, NAVY)
      this.text(LEFT, b + 22, 'Authorized Signature:', 'Helvetica', 8.5)
      const lineY = b + 24
      if (signed && this.signatureImg) this.page.drawImage(this.signatureImg, { x: 141, y: Y(lineY + 68), width: 165, height: 113.8 })
      this.hline(128, 336, lineY, NAVY, 0.8)
      this.text(LEFT, b + 40, `Date: ${signDate}`, 'Helvetica', 8.5)
      this.y = lineY + 68
    }
  }

  qr() {
    const url = this.doc.verify_url
    if (!url) return
    const size = 58.0
    const x0 = RIGHT - size, top = 803.0 - size - 8
    const q = qrcode(0, 'M')
    q.addData(url)
    q.make()
    const n = q.getModuleCount()
    const quiet = 4                                  // white border, as ReportLab's widget
    const cell = size / (n + 2 * quiet)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (q.isDark(r, c)) this.rect(x0 + (c + quiet) * cell, top + (r + quiet) * cell, x0 + (c + quiet + 1) * cell, top + (r + quiet + 1) * cell, rgb(0, 0, 0))
      }
    }
    this.text(x0 + size / 2, top + size + 6, 'Scan to verify', 'Helvetica', 6, GREY, 'center')
  }

  async render(): Promise<Uint8Array> {
    this.pdf = await PDFDocument.create()
    const name = (TITLES[this.kind] ?? ['DOCUMENT']).join(' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    this.pdf.setTitle(`${name} ${this.doc.number ?? ''}`.trim())
    this.pdf.setAuthor(this.company.legal_name)
    this.pdf.setProducer('EnvironmSafe PF')
    this.pdf.setCreator('EnvironmSafe PF')
    this.fonts.Helvetica = await this.pdf.embedFont(StandardFonts.Helvetica)
    this.fonts['Helvetica-Bold'] = await this.pdf.embedFont(StandardFonts.HelveticaBold)
    this.fonts['Helvetica-Oblique'] = await this.pdf.embedFont(StandardFonts.HelveticaOblique)
    if (this.assets.arabicRegular) {
      const { default: fontkit } = await import('@pdf-lib/fontkit')     // only for Arabic text
      this.pdf.registerFontkit(fontkit)
      const face = fontkit.create(new Uint8Array(this.assets.arabicRegular) as never) as unknown as { hasGlyphForCodePoint(cp: number): boolean }
      this.arabicHas = (cp) => face.hasGlyphForCodePoint(cp)
      this.fonts.Arabic = await this.pdf.embedFont(this.assets.arabicRegular, { subset: true })
      if (this.assets.arabicBold) this.fonts['Arabic-Bold'] = await this.pdf.embedFont(this.assets.arabicBold, { subset: true })
    }
    if (this.assets.logo) this.logo = await this.pdf.embedJpg(this.assets.logo)
    if (this.assets.signature) this.signatureImg = await this.pdf.embedPng(this.assets.signature)

    this.page = this.pdf.addPage([W, H])
    this.frame()
    this.header()
    this.toBlock()
    this.metaBox()
    this.items()
    this.totals()
    this.terms()
    this.signature()
    this.qr()
    // Page numbers only when there is more than one page, so single pages match the samples exactly.
    if (this.pages > 1) {
      this.pdf.getPages().forEach((pg, i) => {
        this.page = pg
        this.text(RIGHT, 829.9, `Page ${i + 1} of ${this.pages}`, 'Helvetica', 7.5, WHITE, 'right')
      })
    }
    return this.pdf.save()
  }
}

/** True when the document has Arabic text (then the caller loads the Arabic fonts). */
export function needsArabic(doc: PrintDocument): boolean {
  return AR.test(JSON.stringify(doc))
}

export function renderDocument(doc: PrintDocument, assets: PrintAssets = {}): Promise<Uint8Array> {
  return new Renderer(doc, assets).render()
}
