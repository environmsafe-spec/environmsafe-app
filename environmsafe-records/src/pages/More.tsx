import { Icon } from '../components/Icon';
import { PageHeader, Row } from '../components/ui';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';

export default function More() {
  const { can, profile } = useAuth();
  const items = [
    { to: '/clients', icon: 'briefcase', label: t('nav.clients') },
    { to: '/inspections', icon: 'clipboard', label: t('nav.inspections') },
    { to: '/jobs', icon: 'layers', label: t('nav.jobs') },
    { to: '/reports', icon: 'fileText', label: t('nav.reports') },
    { to: '/due', icon: 'calendar', label: t('nav.due') },
    ...(can.office ? [{ to: '/import', icon: 'upload', label: 'Import from Excel' }] : []),
    ...(can.admin ? [{ to: '/library', icon: 'book', label: t('nav.library') }, { to: '/users', icon: 'users', label: t('nav.users') }] : []),
    { to: '/settings', icon: 'settings', label: t('nav.settings') },
    { to: '/sync', icon: 'sync', label: 'Sync status' },
    { to: '/help', icon: 'help', label: t('nav.help') },
  ];
  return (
    <div>
      <PageHeader title={t('nav.more')} sub={`${profile?.full_name || profile?.email} · ${profile?.role}`} />
      <div className="surface rounded-2xl border border-line px-3">
        {items.map((i) => (
          <Row key={i.to} to={i.to} title={<span className="flex items-center gap-3"><Icon name={i.icon} />{i.label}</span>} />
        ))}
      </div>
    </div>
  );
}
