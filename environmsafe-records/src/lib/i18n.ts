// Interface text. English today; Arabic can be added later by supplying a second
// dictionary — layouts use start/end (not left/right) so they flip for RTL.

type Dict = Record<string, string>;

const en: Dict = {
  'nav.home': 'Home',
  'nav.clients': 'Clients',
  'nav.assets': 'Assets',
  'nav.inspections': 'Inspections',
  'nav.findings': 'Findings',
  'nav.jobs': 'Jobs',
  'nav.reports': 'Reports',
  'nav.due': 'Due board',
  'nav.library': 'Library',
  'nav.users': 'Users',
  'nav.settings': 'Settings',
  'nav.help': 'Help',
  'nav.more': 'More',
  'nav.new': 'New',
  'action.new_inspection': 'New inspection',
  'action.add_photo': 'Add photo',
  'action.find_tag': 'Find a tag',
  'action.new_dpr': 'New daily report',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.restore': 'Restore',
  'action.edit': 'Edit',
  'action.back': 'Back',
  'action.search': 'Search tags, findings, notes…',
  'sync.online': 'Synced',
  'sync.offline': 'Offline',
  'sync.pending': 'to sync',
  'sync.syncing': 'Syncing…',
  'sync.failed': 'need attention',
};

const dictionaries: Record<string, Dict> = { en };
let lang = 'en';

export function setLanguage(l: string): void {
  if (!dictionaries[l]) return;
  lang = l;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
}

export function t(key: string, fallback?: string): string {
  return dictionaries[lang]?.[key] ?? en[key] ?? fallback ?? key;
}
