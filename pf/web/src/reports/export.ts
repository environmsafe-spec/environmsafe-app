// CSV export that Excel opens correctly (UTF-8 BOM so Arabic shows; comma separated; quoted).

export type Cell = string | number | null | undefined

export function toCsv(header: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'number' ? String(v) : v
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadCsv(name: string, header: string[], rows: Cell[][]) {
  downloadBlob(name.endsWith('.csv') ? name : `${name}.csv`, new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }))
}

export const n2 = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100) / 100)
