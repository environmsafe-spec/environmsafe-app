import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';
import { checkForUpdate, type VersionInfo } from '../lib/native';
import { subscribeSync, syncNow, syncState } from '../lib/sync';
import { Icon } from './Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { Modal } from './ui';

function useSyncState() {
  const [, force] = useState(0);
  useEffect(() => subscribeSync(() => force((n) => n + 1)), []);
  return syncState;
}

const onlineStore = {
  subscribe(cb: () => void) {
    window.addEventListener('online', cb);
    window.addEventListener('offline', cb);
    return () => {
      window.removeEventListener('online', cb);
      window.removeEventListener('offline', cb);
    };
  },
  get: () => navigator.onLine,
};

export function useOnline(): boolean {
  return useSyncExternalStore(onlineStore.subscribe, onlineStore.get);
}

export function SyncIndicator() {
  const s = useSyncState();
  const online = useOnline();
  const nav = useNavigate();
  let label: string;
  let cls: string;
  let icon = 'sync';
  if (!online) {
    label = s.pending + s.pendingFiles > 0 ? `${t('sync.offline')} · ${s.pending + s.pendingFiles} ${t('sync.pending')}` : t('sync.offline');
    cls = 'bg-amber-300 text-amber-950';
    icon = 'cloudOff';
  } else if (s.failed > 0) {
    label = `${s.failed} ${t('sync.failed')}`;
    cls = 'bg-red-700 text-white';
    icon = 'alert';
  } else if (s.syncing) {
    label = t('sync.syncing');
    cls = 'bg-white/15 text-white';
  } else if (s.pending + s.pendingFiles > 0) {
    label = `${s.pending + s.pendingFiles} ${t('sync.pending')}`;
    cls = 'bg-amber-300 text-amber-950';
  } else {
    label = t('sync.online');
    cls = 'bg-green-700 text-white';
    icon = 'check';
  }
  return (
    <button
      type="button"
      data-testid="sync-indicator"
      onClick={() => {
        void syncNow();
        nav('/sync');
      }}
      className={`flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${cls}`}
      aria-label={`Sync status: ${label}`}
    >
      <Icon name={icon} size={16} className={s.syncing ? 'animate-spin' : ''} />
      <span className="max-w-[9rem] truncate">{label}</span>
    </button>
  );
}

const NAV: { to: string; key: string; icon: string; end?: boolean }[] = [
  { to: '/', key: 'nav.home', icon: 'home', end: true },
  { to: '/clients', key: 'nav.clients', icon: 'briefcase' },
  { to: '/assets', key: 'nav.assets', icon: 'box' },
  { to: '/inspections', key: 'nav.inspections', icon: 'clipboard' },
  { to: '/findings', key: 'nav.findings', icon: 'alert' },
  { to: '/jobs', key: 'nav.jobs', icon: 'layers' },
  { to: '/reports', key: 'nav.reports', icon: 'fileText' },
  { to: '/due', key: 'nav.due', icon: 'calendar' },
];
const ADMIN_NAV = [
  { to: '/library', key: 'nav.library', icon: 'book' },
  { to: '/users', key: 'nav.users', icon: 'users' },
];

function SideNav() {
  const { can } = useAuth();
  const items: typeof NAV = [...NAV, ...(can.admin ? ADMIN_NAV : []), { to: '/settings', key: 'nav.settings', icon: 'settings' }, { to: '/help', key: 'nav.help', icon: 'help' }];
  return (
    <nav aria-label="Main" className="hidden w-60 shrink-0 flex-col gap-1 p-3 md:flex">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold ${isActive ? 'bg-navy text-white dark:bg-accent dark:text-navy' : 'hover:bg-black/5 dark:hover:bg-white/10'}`
          }
        >
          <Icon name={n.icon} size={20} />
          {t(n.key)}
        </NavLink>
      ))}
    </nav>
  );
}

function QuickActions({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const go = (to: string) => {
    onClose();
    nav(to);
  };
  const actions = [
    { label: t('action.new_inspection'), icon: 'clipboard', to: '/inspections/new', show: can.field },
    { label: t('action.add_photo'), icon: 'camera', to: '/photo', show: can.field },
    { label: t('action.find_tag'), icon: 'qr', to: '/scan', show: true },
    { label: t('action.new_dpr'), icon: 'fileText', to: '/dprs/new', show: can.field },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('nav.new')}>
      <div className="grid grid-cols-2 gap-3">
        {actions.filter((a) => a.show).map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => go(a.to)}
            className="surface flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-line p-3 text-center font-bold hover:border-accent"
          >
            <Icon name={a.icon} size={30} className="text-accent" />
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function BottomNav({ onNew }: { onNew: () => void }) {
  const loc = useLocation();
  const item = (to: string, icon: string, label: string, end = false) => {
    const active = end ? loc.pathname === to : loc.pathname.startsWith(to);
    return (
      <Link to={to} className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-bold ${active ? 'text-accent' : 'text-white/85'}`}>
        <Icon name={icon} size={24} />
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Bottom" className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex h-[4.25rem] items-stretch bg-navy md:hidden">
      {item('/', 'home', t('nav.home'), true)}
      {item('/assets', 'box', t('nav.assets'))}
      <button type="button" onClick={onNew} aria-label={t('nav.new')} className="flex flex-1 items-center justify-center">
        <span className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-accent text-navy shadow-lg ring-4 ring-[var(--bg)]">
          <Icon name="plus" size={30} strokeWidth={2.6} />
        </span>
      </button>
      {item('/findings', 'alert', t('nav.findings'))}
      {item('/more', 'menu', t('nav.more'))}
    </nav>
  );
}

function SearchBox() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className="hidden max-w-md flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        nav(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <input
        className="w-full rounded-xl border-0 bg-white/12 px-4 py-2.5 text-white placeholder:text-white/70 focus:bg-white focus:text-navy"
        placeholder={t('action.search')}
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}

function UpdateBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  useEffect(() => {
    void checkForUpdate().then(setInfo);
  }, []);
  if (!info) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-accent px-4 py-2 font-semibold text-navy">
      <span>A new version ({info.version}) of the app is available.</span>
      <a href={info.apk} className="rounded-lg bg-navy px-3 py-1.5 text-white">Download update</a>
    </div>
  );
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="bg-amber-300 px-4 py-1.5 text-center text-sm font-bold text-amber-950" role="status">
      No internet. You can keep working – everything is saved on this device and will sync later.
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const [quick, setQuick] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 bg-navy text-white shadow">
        <div className="flex h-16 items-center gap-3 px-3 md:px-5">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="EnvironmSafe Records home">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
              <img src="/icons/icon-192.png" alt="" width="40" height="40" className="h-full w-full object-contain" />
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-bold">EnvironmSafe</span>
              <span className="block text-xs text-accent">Records</span>
            </span>
          </Link>
          <SearchBox />
          <div className="ms-auto flex items-center gap-2">
            <Link to="/search" className="rounded-lg p-2 md:hidden" aria-label="Search">
              <Icon name="search" />
            </Link>
            <SyncIndicator />
          </div>
        </div>
        <UpdateBanner />
        <OfflineBanner />
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1">
        <SideNav />
        <main id="main" className="min-w-0 flex-1 px-3 pt-4 pb-28 md:px-6 md:pb-10">
          <ErrorBoundary key={loc.pathname}>{children ?? <Outlet />}</ErrorBoundary>
        </main>
      </div>
      <BottomNav onNew={() => setQuick(true)} />
      <QuickActions open={quick} onClose={() => setQuick(false)} />
    </div>
  );
}
