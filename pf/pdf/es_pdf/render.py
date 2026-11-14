"""EnvironmSafe printed documents (ReportLab).

Reproduces the house design of sample_PO.pdf / sample_Invoice.pdf (positions measured from those
files), generated from a JSON description of the document. Adds: multi-page tables with repeated
header and page numbers, a QR verification code, revision marks, DRAFT / VOID watermarks and
Arabic text (shaped, right-to-left, embedded Noto Naskh Arabic font).

All coordinates below are "from the top of the page" in points, like the measurements;
`Y(y)` converts to ReportLab's bottom-up system.
"""
from __future__ import annotations

import io
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

NAVY = HexColor('#14294a')
GOLD = HexColor('#d9a21b')
GREY = HexColor('#555555')
LIGHT = HexColor('#e8edf3')
LINE = HexColor('#c9d3df')

W, H = A4
ASSETS = os.path.join(os.path.dirname(__file__), 'assets')
LOGO = os.path.join(ASSETS, 'es_logo.jpg')
SIGNATURE = os.path.join(ASSETS, 'signature_stamp.png')

LEFT, RIGHT = 36.0, 557.3
BOTTOM_LIMIT = 790.0          # content must stay above the footer bar (811.9)

ARABIC_FONT_DIRS = [os.environ.get('ESPDF_FONT_DIR', ''), ASSETS, '/usr/share/fonts/truetype/noto']
_AR = re.compile(r'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]')
_fonts_ready = False


def Y(y: float) -> float:
    return H - y


def _register_fonts() -> None:
    global _fonts_ready
    if _fonts_ready:
        return
    for name, file in (('Arabic', 'NotoNaskhArabic-Regular.ttf'), ('Arabic-Bold', 'NotoNaskhArabic-Bold.ttf')):
        for d in ARABIC_FONT_DIRS:
            path = os.path.join(d, file) if d else ''
            if path and os.path.exists(path):
                pdfmetrics.registerFont(TTFont(name, path))
                break
    _fonts_ready = True


def _has_arabic(s: str) -> bool:
    return bool(_AR.search(s or ''))


def _shape(s: str) -> str:
    """Join Arabic letters and put the string in visual (right-to-left) order."""
    import arabic_reshaper
    from bidi.algorithm import get_display
    return get_display(arabic_reshaper.reshape(s))


def _font_for(s: str, font: str) -> tuple[str, str]:
    if _has_arabic(s) and 'Arabic' in pdfmetrics.getRegisteredFontNames():
        return _shape(s), ('Arabic-Bold' if 'Bold' in font else 'Arabic')
    return s, font


def text(c, x: float, base: float, s: Any, font='Helvetica', size=8.5, color=GREY, align='left') -> float:
    s, font = _font_for('' if s is None else str(s), font)
    c.setFont(font, size)
    c.setFillColor(color)
    w = pdfmetrics.stringWidth(s, font, size)
    if align == 'center':
        x -= w / 2
    elif align == 'right':
        x -= w
    c.drawString(x, Y(base), s)
    return w


def width(s: str, font: str, size: float) -> float:
    s, font = _font_for(s or '', font)
    return pdfmetrics.stringWidth(s, font, size)


def wrap(s: str, font: str, size: float, max_w: float, first_w: float | None = None) -> list[str]:
    """Greedy word wrap; the first line may have a different width (text after a bold label)."""
    words = (s or '').split()
    lines, cur, limit = [], '', first_w if first_w is not None else max_w
    for w_ in words:
        trial = f'{cur} {w_}'.strip()
        if width(trial, font, size) <= limit or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur, limit = w_, max_w
    if cur:
        lines.append(cur)
    return lines or ['']


def rect(c, x0, y0, x1, y1, fill=None, stroke=None, lw=0.5):
    if fill is not None:
        c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(lw)
    c.rect(x0, Y(y1), x1 - x0, y1 - y0, fill=1 if fill is not None else 0, stroke=1 if stroke is not None else 0)


def hline(c, x0, x1, y, color=LINE, lw=0.5):
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.line(x0, Y(y), x1, Y(y))


def vline(c, x, y0, y1, color=LINE, lw=0.5):
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.line(x, Y(y0), x, Y(y1))


# ---------------------------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------------------------
DECIMALS = {'USD': 2, 'SAR': 2, 'YER': 0}


def money(v: Any, currency: str | None = None) -> str:
    if isinstance(v, str):
        return v
    if v is None:
        return ''
    d = DECIMALS.get(currency or 'USD', 2)
    return f'{float(v):,.{d}f}'


def qty(v: Any) -> str:
    if isinstance(v, str):
        return v
    s = f'{float(v):,.4f}'.rstrip('0').rstrip('.')
    return s


def _as_date(v: Any) -> date | None:
    if v in (None, ''):
        return None
    if isinstance(v, date):
        return v
    return datetime.strptime(str(v)[:10], '%Y-%m-%d').date()


def date_long(v: Any) -> str:     # 01-Nov-2026
    d = _as_date(v)
    return d.strftime('%d-%b-%Y') if d else ''


def date_short(v: Any) -> str:    # 01-11-2026
    d = _as_date(v)
    return d.strftime('%d-%m-%Y') if d else ''


_ONES = 'Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split()
_TENS = 'Zero Ten Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split()
CURRENCY_WORDS = {'USD': ('US Dollar', 'US Dollars', 'Cent', 'Cents'), 'SAR': ('Saudi Riyal', 'Saudi Riyals', 'Halala', 'Halalas'),
                  'YER': ('Yemeni Rial', 'Yemeni Rials', 'Fils', 'Fils')}


def _words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ('' if n % 10 == 0 else '-' + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + ' Hundred' + ('' if n % 100 == 0 else ' ' + _words(n % 100))
    for div, name in ((10**9, 'Billion'), (10**6, 'Million'), (1000, 'Thousand')):
        if n >= div:
            return _words(n // div) + ' ' + name + ('' if n % div == 0 else ' ' + _words(n % div))
    return str(n)


def amount_in_words(amount: float, currency: str) -> str:
    """1852.63 USD -> 'One Thousand Eight Hundred Fifty-Two US Dollars and Sixty-Three Cents only'."""
    major_s, major_p, minor_s, minor_p = CURRENCY_WORDS.get(currency, (currency, currency, 'cent', 'cents'))
    total = round(float(amount) * 100)
    major, minor = divmod(total, 100)
    s = f'{_words(major)} {major_p if major != 1 else major_s}'
    if minor:
        s += f' and {_words(minor)} {minor_p if minor != 1 else minor_s}'
    return s + ' only'


# ---------------------------------------------------------------------------------------------
# Layout profiles (column edges and fonts measured from the two samples)
# ---------------------------------------------------------------------------------------------
@dataclass
class Profile:
    cols: list[float]            # x of column edges: SN | DESCRIPTION | UNIT | QTY | UNIT PRICE | AMOUNT | CURRENCY
    head_h: float                # height of the navy header row
    head_size: float
    body_size: float
    detail_size: float
    detail_leading: float
    totals_x: float
    totals_row_h: float
    value_pad: float             # right padding of unit price / amount
    terms_gap: float             # totals bottom -> "Terms & Conditions:" baseline


PROFILE_PO = Profile([36, 62, 252, 286, 316, 386, 454, RIGHT], 22, 8.5, 8.5, 7.5, 10.0, 306.0, 22.0, 8.0, 22.0)
PROFILE_INVOICE = Profile([36, 62, 282, 322, 356, 426, 496, RIGHT], 26, 8.3, 8.3, 7.2, 9.5, 357.3, 20.0, 6.0, 26.0)

TITLES = {
    'purchase_order': ['PURCHASE', 'ORDER'], 'sales_invoice': ['INVOICE'], 'quotation': ['QUOTATION'],
    'credit_note': ['CREDIT', 'NOTE'], 'supplier_bill': ['SUPPLIER', 'BILL'], 'payment': ['PAYMENT', 'VOUCHER'],
    'receipt': ['RECEIPT', 'VOUCHER'], 'statement': ['STATEMENT'],
}


class Renderer:
    def __init__(self, doc: dict):
        _register_fonts()
        self.doc = doc
        self.kind = doc.get('kind', 'sales_invoice')
        self.profile = PROFILE_PO if self.kind in ('purchase_order', 'supplier_bill', 'payment', 'receipt') else PROFILE_INVOICE
        self.company = {
            'name': 'EnvironmSafe', 'tagline': 'For Engineering, Trading, and Services Ltd',
            'legal_name': 'EnvironmSafe For Engineering, Trading, and Services Ltd',
            'address': 'Aden-Alburaqah / Sanaa-Alsafiah', 'phones': '(967) 773033186 - 783402932',
            'email': 'support@environmsafe.com', 'website': 'www.environmsafe.com', **doc.get('company', {}),
        }
        self.buf = io.BytesIO()
        self.c = rl_canvas.Canvas(self.buf, pagesize=A4, pageCompression=1)
        self.c.setTitle(f"{' '.join(TITLES.get(self.kind, ['DOCUMENT'])).title()} {doc.get('number') or ''}".strip())
        self.c.setAuthor(self.company['legal_name'])
        self.page = 1
        self.y = 0.0

    # --- page furniture --------------------------------------------------------------------
    def frame(self):
        c = self.c
        rect(c, 0, 0, 8, H, fill=GOLD)
        rect(c, 0, 811.9, W, H, fill=NAVY)
        text(c, W / 2, 829.9, f"{self.company['legal_name']}   |   {self.company['website']}", size=7.5, color=white, align='center')
        status = self.doc.get('status')
        if status in ('draft', 'void'):
            c.saveState()
            c.setFillColor(HexColor('#c0392b') if status == 'void' else HexColor('#999999'))
            c.setFillAlpha(0.12)
            c.setFont('Helvetica-Bold', 96)
            c.translate(W / 2, H / 2)
            c.rotate(35)
            c.drawCentredString(0, 0, 'VOID' if status == 'void' else 'DRAFT')
            c.restoreState()

    def header(self):
        c, co = self.c, self.company
        if os.path.exists(LOGO):
            c.drawImage(LOGO, 42, Y(111), width=88, height=64, mask='auto')
        text(c, 245, 52.0, co['name'], 'Helvetica-Bold', 17, NAVY, 'center')
        for i, line in enumerate([co['tagline'], co['address'], co['phones'], f"{co['email']}  |  {co['website']}"]):
            text(c, 245, 66.0 + 11 * i, line, size=8.5, color=GREY, align='center')
        title = self.doc.get('title') or TITLES.get(self.kind, ['DOCUMENT'])
        if len(title) == 1:
            text(c, RIGHT, 62.0 if len(title[0]) <= 9 else 56.0, title[0], 'Helvetica-Bold', 20 if len(title[0]) <= 9 else 18, GOLD, 'right')
        else:
            text(c, RIGHT, 56.0, title[0], 'Helvetica-Bold', 18, GOLD, 'right')
            text(c, RIGHT, 76.0, title[1], 'Helvetica-Bold', 18, GOLD, 'right')
        rev = self.doc.get('revision') or 0
        if rev:
            text(c, RIGHT, 92.0, f'Rev.{rev}', 'Helvetica-Bold', 10, NAVY, 'right')

    def to_block(self):
        c = self.c
        hline(c, LEFT, 290, 128.0, LINE, 0.6)
        text(c, LEFT, 140.0, self.doc.get('to_label', 'TO:'), 'Helvetica-Bold', 8, GOLD)
        to = self.doc.get('to', {})
        lines = [l for l in to.get('lines', []) if l]
        # The PO sample spaces the TO block a little more than the invoice sample.
        first, step = (156.0, 13.0) if self.profile is PROFILE_PO else (152.0, 12.0)
        text(c, LEFT, first, to.get('name', ''), 'Helvetica-Bold', 10, NAVY)
        for i, line in enumerate(lines[:6]):
            text(c, LEFT, first + 13.0 + step * i if self.profile is PROFILE_PO else first + 12.0 + step * i, line, size=9, color=GREY)

    def meta_box(self):
        c = self.c
        meta = (self.doc.get('meta') or [])[:4]
        while len(meta) < 4:
            meta.append(['', ''])
        mid = (330 + RIGHT) / 2
        for row, top in ((0, 138.0), (1, 180.0)):
            rect(c, 330, top, RIGHT, top + 20, fill=NAVY)
            rect(c, 330, top + 20, RIGHT, top + 42, fill=LIGHT)
            hline(c, 330, RIGHT, top + 20, white, 0.6)
            hline(c, 330, RIGHT, top + 42, white, 0.6)
            for col in (0, 1):
                label, value = meta[row * 2 + col]
                cx = (330 + mid) / 2 if col == 0 else (mid + RIGHT) / 2
                text(c, cx, top + 12.5, label, 'Helvetica-Bold', 8.5, white, 'center')
                v = str(value or '')
                size = 8.5 if width(v, 'Helvetica', 8.5) <= (mid - 330) - 20 else 7.5
                text(c, cx, top + 33.5, v, size=size, color=GREY, align='center')

    # --- items table ------------------------------------------------------------------------
    def table_header(self, top: float) -> float:
        c, p = self.c, self.profile
        x = p.cols
        rect(c, x[0], top, x[-1], top + p.head_h, fill=NAVY)
        base = top + p.head_h / 2 + 2.5 + (0.5 if p.head_h > 22 else 0)
        labels = ['SN', 'DESCRIPTION', 'UNIT', 'QTY', 'UNIT PRICE', 'AMOUNT', 'CURRENCY']
        for i, lab in enumerate(labels):
            if i == 1:
                text(c, x[1] + 6, base, lab, 'Helvetica-Bold', p.head_size, white)
            else:
                text(c, (x[i] + x[i + 1]) / 2, base, lab, 'Helvetica-Bold', p.head_size, white, 'center')
        return top + p.head_h

    def row_layout(self, line: dict) -> tuple[list[str], float]:
        p = self.profile
        desc_w = p.cols[2] - p.cols[1] - 12
        details: list[str] = []
        for part in str(line.get('detail') or '').split('\n'):
            if part.strip():
                details += wrap(part, 'Helvetica-Oblique', p.detail_size, desc_w)
        title_lines = wrap(str(line.get('description') or ''), 'Helvetica', p.body_size, desc_w)
        n = len(title_lines) - 1 + len(details)
        h = 24.0 + p.detail_leading * n if self.profile is PROFILE_PO else 20.0 + p.detail_leading * max(n, 0) + (1.0 if n else 0)
        h = max(h, 24.0)
        return title_lines + details, h

    def items(self):
        c, p, x = self.c, self.profile, self.profile.cols
        top = self.table_header(250.0)
        lines = self.doc.get('lines') or []
        currency = self.doc.get('currency', 'USD')
        for idx, line in enumerate(lines, start=1):
            all_lines, h = self.row_layout(line)
            if top + h > BOTTOM_LIMIT:
                self.close_table(top)
                self.new_page()
                top = self.table_header(60.0)
            title_n = len(wrap(str(line.get('description') or ''), 'Helvetica', p.body_size, x[2] - x[1] - 12))
            first = top + (15.1 if p is PROFILE_PO else 13.5)
            for i, s in enumerate(all_lines):
                if i < title_n:
                    text(c, x[1] + 6, first + i * 10.5, s, size=p.body_size, color=NAVY)
                else:
                    ii = i - title_n
                    text(c, x[1] + 6, first + (title_n - 1) * 10.5 + (10.0 if p is PROFILE_PO else 9.7) + ii * p.detail_leading,
                         s, 'Helvetica-Oblique', p.detail_size, GREY)
            base = top + h / 2 + 2.5
            ccy = line.get('currency') or currency
            text(c, (x[0] + x[1]) / 2, base, line.get('sn', idx), size=p.body_size, align='center')
            text(c, (x[2] + x[3]) / 2, base, line.get('unit') or '', size=p.body_size, align='center')
            text(c, (x[3] + x[4]) / 2, base, qty(line.get('qty', 1)), size=p.body_size, align='center')
            text(c, x[5] - p.value_pad, base, money(line.get('unit_price'), ccy) if line.get('unit_price') is not None else '', size=p.body_size, align='right')
            text(c, x[6] - p.value_pad, base, money(line.get('amount'), ccy), 'Helvetica-Bold', p.body_size, NAVY, 'right')
            text(c, (x[6] + x[7]) / 2, base, ccy, size=p.body_size, align='center')
            hline(c, x[0], x[-1], top)
            for xx in x:
                vline(c, xx, top, top + h)
            top += h
        self.close_table(top)
        self.y = top

    def close_table(self, bottom: float):
        hline(self.c, self.profile.cols[0], self.profile.cols[-1], bottom)

    def new_page(self):
        self.c.showPage()
        self.page += 1
        self.frame()
        text(self.c, LEFT, 40.0, f"{' '.join(TITLES.get(self.kind, ['DOCUMENT'])).title()} {self.doc.get('number') or ''} (continued)",
             'Helvetica-Bold', 9, NAVY)

    def ensure(self, needed: float):
        if self.y + needed > BOTTOM_LIMIT:
            self.new_page()
            self.y = 60.0

    # --- totals, terms, signatures ----------------------------------------------------------
    def totals(self):
        c, p = self.c, self.profile
        rows = self.doc.get('totals') or []
        total = self.doc.get('total')
        self.ensure(8 + p.totals_row_h * len(rows) + 26)
        top = self.y + 8
        tx = p.totals_x
        for r in rows:
            base = top + (13.5 if p.totals_row_h >= 22 else 12.5)
            text(c, tx + 6, base, str(r.get('label', '')).upper(), size=8.5, color=GREY)
            text(c, RIGHT - 6, base, money(r.get('value'), self.doc.get('currency')), 'Helvetica-Bold', 8.5, NAVY, 'right')
            top += p.totals_row_h
            hline(c, tx, RIGHT, top)
        if total:
            rect(c, tx, top, RIGHT, top + 26, fill=GOLD)
            text(c, tx + 6, top + 17, str(total.get('label', 'TOTAL')).upper(), 'Helvetica-Bold', 10, white)
            text(c, RIGHT - 6, top + 17, total.get('value', ''), 'Helvetica-Bold', 10, white, 'right')
            top += 26
        self.y = top

    def terms(self):
        c = self.c
        terms = [t for t in (self.doc.get('terms') or []) if t.get('text')]
        if self.doc.get('amount_words') and self.doc.get('total_amount') is not None \
                and not any(str(t.get('label', '')).lower() == 'amount in words' for t in terms):
            words = {'label': 'Amount in words', 'text': amount_in_words(self.doc['total_amount'], self.doc.get('currency', 'USD'))}
            at = next((i for i, t in enumerate(terms) if str(t.get('label', '')).lower() == 'bank'), len(terms))
            terms.insert(at, words)
        if not terms:
            return
        self.ensure(40)
        base = self.y + self.profile.terms_gap
        text(c, LEFT, base, self.doc.get('terms_title', 'Terms & Conditions:'), 'Helvetica-Bold', 10, NAVY)
        base += 16.5
        max_w = RIGHT - LEFT
        for t in terms:
            label = f"{t.get('label', '').rstrip(':')}:" if t.get('label') else ''
            lw = width(label, 'Helvetica-Bold', 8) if label else 0
            body = wrap(str(t['text']), 'Helvetica', 8, max_w, max_w - lw - width(' ', 'Helvetica', 8))
            if base + 10.5 * len(body) > BOTTOM_LIMIT:
                self.new_page()
                base = 60.0
            if label:
                text(c, LEFT, base, label, 'Helvetica-Bold', 8, NAVY)
            for i, b in enumerate(body):
                if i == 0:
                    text(c, LEFT + lw, base, (' ' if label else '') + b, size=8, color=GREY)
                else:
                    base += 10.5
                    text(c, LEFT, base, b, size=8, color=GREY)
            base += 13.0
        self.y = base - 13.0

    def signature(self):
        c, sig = self.c, self.doc.get('signature') or {}
        style = sig.get('style', 'acceptance' if self.kind == 'purchase_order' else 'single')
        sign_date = date_short(sig.get('date') or self.doc.get('date'))
        if style == 'acceptance':
            self.ensure(150)
            b = self.y + 28.5
            for i, s in enumerate(wrap(f"For {self.company['legal_name']}", 'Helvetica-Bold', 9, 200)):
                text(c, LEFT, b + 11 * i, s, 'Helvetica-Bold', 9, NAVY)
            acc = sig.get('acceptance') or {}
            text(c, 306.6, b, 'Supplier Acceptance', 'Helvetica-Bold', 9, NAVY)
            text(c, 306.6, b + 11, f"For {acc.get('party', '')}".strip(), size=8, color=GREY)
            text(c, LEFT, b + 26, 'Authorized Signature:', size=8.5)
            text(c, 306.6, b + 26, f"Name: {acc.get('name', '')}".rstrip(), size=8.5)
            text(c, 306.6, b + 40, 'Signature & Stamp:', size=8.5)
            line_y = b + 121
            if sig.get('signed', True) and os.path.exists(SIGNATURE):
                c.drawImage(SIGNATURE, 91, Y(line_y + 5), width=165, height=113.8, mask='auto')
            hline(c, LEFT, 271, line_y, NAVY, 0.8)
            hline(c, 306.6, RIGHT, line_y, NAVY, 0.8)
            text(c, LEFT, line_y + 13, f'Date: {sign_date}', size=8.5)
            text(c, 306.6, line_y + 13, 'Date:', size=8.5)
            self.y = line_y + 13
        else:
            self.ensure(125)
            b = self.y + 32.5
            text(c, LEFT, b, self.company['legal_name'], 'Helvetica-Bold', 9.5, NAVY)
            text(c, LEFT, b + 22, 'Authorized Signature:', size=8.5)
            line_y = b + 24
            if sig.get('signed', True) and os.path.exists(SIGNATURE):
                c.drawImage(SIGNATURE, 141, Y(line_y + 68), width=165, height=113.8, mask='auto')
            hline(c, 128, 336, line_y, NAVY, 0.8)
            text(c, LEFT, b + 40, f'Date: {sign_date}', size=8.5)
            self.y = line_y + 68

    def qr(self):
        url = self.doc.get('verify_url')
        if not url:
            return
        size = 58.0
        x0, top = RIGHT - size, 803.0 - size - 8
        widget = QrCodeWidget(url, barLevel='M')
        b = widget.getBounds()
        d = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
        d.add(widget)
        renderPDF.draw(d, self.c, x0, Y(top + size))
        text(self.c, x0 + size / 2, top + size + 6, 'Scan to verify', size=6, color=GREY, align='center')

    def page_numbers(self):
        # Only when there is more than one page, so single-page documents match the samples exactly.
        pass

    def render(self) -> bytes:
        self.frame()
        self.header()
        self.to_block()
        self.meta_box()
        self.items()
        self.totals()
        self.terms()
        self.signature()
        self.qr()
        self.c.showPage()
        self.c.save()
        pdf = self.buf.getvalue()
        if self.page > 1:
            pdf = _stamp_page_numbers(pdf, self.page)
        return pdf


def _stamp_page_numbers(pdf: bytes, pages: int) -> bytes:
    """Re-render with 'Page x of y' in the footer bar (second pass, the page count is known)."""
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:          # page numbers are a nicety; never fail the document for them
        return pdf
    reader = PdfReader(io.BytesIO(pdf))
    writer = PdfWriter()
    for i, page in enumerate(reader.pages, start=1):
        overlay = io.BytesIO()
        oc = rl_canvas.Canvas(overlay, pagesize=A4)
        oc.setFont('Helvetica', 7.5)
        oc.setFillColor(white)
        oc.drawRightString(RIGHT, Y(829.9), f'Page {i} of {pages}')
        oc.save()
        page.merge_page(PdfReader(io.BytesIO(overlay.getvalue())).pages[0])
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def render_document(doc: dict) -> bytes:
    """Render a document description (see README) to PDF bytes."""
    return Renderer(doc).render()
