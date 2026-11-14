"""Visual regression: our renderer vs the reference PDFs supplied by EnvironmSafe.

Rasterises both at 100 dpi and reports the share of pixels that differ noticeably.
Run: python3 -m tests.visual   (from pf/pdf)  — exits 1 if a document drifts past the threshold.
"""
import json
import os
import sys

import pymupdf
from PIL import Image, ImageChops

from es_pdf import render_document

HERE = os.path.dirname(__file__)
REF = os.path.join(HERE, '..', '..', 'templates')
OUT = os.environ.get('VISUAL_OUT', os.path.join(HERE, 'out'))
CASES = [('sample_po.json', 'sample_PO.pdf', 0.005), ('sample_invoice.json', 'sample_Invoice.pdf', 0.005)]


def raster(pdf_bytes: bytes) -> Image.Image:
    page = pymupdf.open(stream=pdf_bytes, filetype='pdf')[0]
    pix = page.get_pixmap(dpi=100)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples).convert('L')


def compare(fixture: str, reference: str) -> tuple[float, Image.Image]:
    with open(os.path.join(HERE, 'fixtures', fixture)) as f:
        doc = json.load(f)
    ours = raster(render_document(doc))
    with open(os.path.join(REF, reference), 'rb') as f:
        ref = raster(f.read())
    diff = ImageChops.difference(ours, ref).point(lambda v: 255 if v > 64 else 0)
    ratio = diff.histogram()[255] / (diff.width * diff.height)
    return ratio, Image.merge('RGB', (ref, ours, ours))  # red = only in reference, cyan = only ours


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    for fixture, reference, limit in CASES:
        ratio, overlay = compare(fixture, reference)
        overlay.save(os.path.join(OUT, fixture.replace('.json', '_overlay.png')))
        ok = ratio <= limit
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'} {reference}: {ratio:.2%} of pixels differ (limit {limit:.1%})")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
