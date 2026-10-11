// Small stroke icon set (24×24), drawn inline so the app needs no icon font.

const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  sync: 'M20 11a8 8 0 00-14.9-3M4 5v4h4M4 13a8 8 0 0014.9 3M20 19v-4h-4',
  cloudOff: 'M3 3l18 18M8 8a5 5 0 00-1 9.9h10M17 18a4 4 0 001-7.8A6 6 0 009.6 6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8zM12 10a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  image: 'M4 5h16v14H4V5zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  qr: 'M4 4h6v6H4V4zM14 4h6v6h-6V4zM4 14h6v6H4v-6zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronDown: 'M5 9l7 7 7-7',
  chevronUp: 'M5 15l7-7 7 7',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  file: 'M6 3h8l4 4v14H6V3zM14 3v4h4',
  fileText: 'M6 3h8l4 4v14H6V3zM14 3v4h4M9 12h6M9 16h6',
  calendar: 'M4 6h16v14H4V6zM4 10h16M8 3v4M16 3v4',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  book: 'M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4V4zM20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7V4z',
  briefcase: 'M3 7h18v13H3V7zM8 7V4h8v3M3 12h18',
  clipboard: 'M9 4h6v3H9V4zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  lock: 'M6 11h12v10H6V11zM8 11V7a4 4 0 018 0v4',
  pen: 'M3 21l3-1 12-12-2-2L4 18l-1 3zM14 6l2 2',
  history: 'M3 12a9 9 0 103-6.7M3 4v5h5M12 7v5l3 2',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  copy: 'M8 8h12v12H8V8zM4 16V4h12',
};

export function Icon({ name, size = 22, className = '', strokeWidth = 2 }: { name: keyof typeof PATHS | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  );
}
