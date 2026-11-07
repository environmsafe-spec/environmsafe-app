const en = {
  app: { name: 'ES Finance', company: 'EnvironmSafe' },
  nav: {
    home: 'Home', entries: 'Entries', procurement: 'Procurement', sales: 'Sales',
    projects: 'Projects', reports: 'Reports', settings: 'Settings',
  },
  common: {
    save: 'Save', cancel: 'Cancel', add: 'Add', edit: 'Edit', search: 'Search', loading: 'Loading…',
    yes: 'Yes', no: 'No', active: 'Active', inactive: 'Inactive', code: 'Code', name: 'Name',
    nameEn: 'Name (English)', nameAr: 'Name (Arabic)', legacyId: 'Old ID', notes: 'Notes',
    noRows: 'Nothing here yet.', saved: 'Saved', error: 'Something went wrong', language: 'العربية',
    signOut: 'Sign out', comingSoon: 'Coming in a later phase', readOnly: 'Read-only for your role',
    showInactive: 'Show inactive',
  },
  auth: {
    title: 'Sign in', email: 'Email', password: 'Password', signIn: 'Sign in',
    mfaTitle: 'Two-step verification', mfaCode: '6-digit code from your authenticator app', verify: 'Verify',
    enrollTitle: 'Set up two-step verification',
    enrollHelp: 'Your role needs an authenticator app (Google Authenticator, Microsoft Authenticator…). Scan this code, then enter the 6-digit code it shows.',
    noBackend: 'This build is not connected to a database yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
    noCompany: 'Your account has no role in any company yet. Ask the owner to give you access.',
    forgot: 'Forgot password?', resetSent: 'If the email exists, a reset link was sent.',
  },
  home: {
    pay: 'Pay', receive: 'Receive', transfer: 'Transfer', claim: 'Claim', billInvoice: 'Bill / Invoice',
    upload: 'Upload voucher', drafts: 'Drafts inbox', cash: 'Cash position', attention: 'Needs attention',
  },
  md: {
    projects: 'Projects', customers: 'Customers', suppliers: 'Suppliers', employees: 'Employees',
    items: 'Items', moneyAccounts: 'Bank & cash accounts', coa: 'Chart of accounts', rates: 'FX rates',
    customer: 'Customer', kind: 'Kind', status: 'Status', budget: 'Budget', budgetCurrency: 'Budget currency',
    startDate: 'Start date', endDate: 'End date', description: 'Description', driveFolder: 'Drive folder link',
    phone: 'Phone', email: 'Email', address: 'Address', city: 'City', country: 'Country', taxNo: 'Tax number',
    contact: 'Contact person', currency: 'Currency', defaultAccount: 'Default GL account',
    defaultProject: 'Default project', jobTitle: 'Job title', drawings: 'Withdrawals are owner drawings',
    alsoCustomer: 'Also a customer', alsoSupplier: 'Also a supplier', unit: 'Unit', expenseAccount: 'Expense account',
    revenueAccount: 'Revenue account', lastCost: 'Last cost', lastPrice: 'Last sale price', isAsset: 'Fixed asset',
    lifeYears: 'Useful life (years)', bankName: 'Bank / company', accountNo: 'Account number', iban: 'IBAN',
    holder: 'Held by', usualFee: 'Usual fee', openingBalance: 'Opening balance', openingDate: 'Opening date',
    glAccount: 'GL account', type: 'Type', parent: 'Parent', ifrsLine: 'Statement line', postable: 'Postable',
    requiresProject: 'Needs project', control: 'Control', date: 'Date', ratePerUsd: 'Units per 1 USD', source: 'Source',
  },
  enum: {
    active: 'Active', contract: 'Contract', internal: 'Internal', on_hold: 'On hold', closed: 'Closed', open: 'Open',
    goods: 'Goods', service: 'Service', bank: 'Bank', cash: 'Cash', card: 'Card', exchange: 'Exchange / remittance',
    asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense',
  },
  settings: {
    users: 'Users & roles', periods: 'Periods', audit: 'Audit log', company: 'Company',
    close: 'Close', reopen: 'Reopen', reopenReason: 'Why reopen this period?', closedBy: 'Closed',
    grant: 'Give role', revoke: 'Remove', role: 'Role', user: 'User', mfa: 'Needs 2-step',
    invite: 'New users are invited from the Supabase dashboard for now; an invite button comes with go-live.',
    when: 'When', who: 'Who', what: 'What', record: 'Record', changes: 'Changes', year: 'Year',
    deactivate: 'Deactivate', activate: 'Activate',
  },
}
export default en
export type Messages = typeof en
