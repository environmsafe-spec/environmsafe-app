#!/usr/bin/env bash
# Renders the generated sample documents to page images for visual checking:
# PDFs directly, Word files through LibreOffice. Output: test-results/reports/png/
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=test-results/reports
mkdir -p "$OUT/png" "$OUT/from-docx"
for f in "$OUT"/*.docx; do
  soffice --headless --convert-to pdf --outdir "$OUT/from-docx" "$f" >/dev/null 2>&1
done
for f in "$OUT"/*.pdf "$OUT"/from-docx/*.pdf; do
  base=$(basename "$f" .pdf)
  [[ "$f" == *from-docx* ]] && base="${base}.docx"
  pdftoppm -r 60 -png "$f" "$OUT/png/$base"
done
for f in "$OUT"/*.pdf "$OUT"/from-docx/*.pdf; do echo "$(basename "$(dirname "$f")")/$(basename "$f"): $(pdfinfo "$f" | awk '/^Pages/{print $2}') pages"; done
