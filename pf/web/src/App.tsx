import { Center, Loader } from '@mantine/core'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { LoginPage, MfaPage, NoCompanyPage } from './auth/LoginPage'
import { AppLayout } from './layout/AppLayout'
import { SectionTabs } from './layout/SectionTabs'
import {
  coaConfig, customersConfig, employeesConfig, itemsConfig, moneyAccountsConfig, projectsConfig, ratesConfig, suppliersConfig,
} from './masterdata/configs'
import { MasterDataPage } from './masterdata/MasterDataPage'
import { DocumentPage } from './documents/DocumentPage'
import { EntriesPage } from './documents/EntriesPage'
import { HomePage } from './pages/HomePage'
import { VerifyPage } from './pages/VerifyPage'
import { AgingPage } from './reports/AgingPage'
import { StatementPage } from './reports/StatementPage'
import { AssetsPage, AuditPackPage, BankBookPage, PartyBalancesPage, ProjectPlPage } from './reports/OperationalPages'
import { BalanceSheetPage, CashFlowPage, EquityPage, GeneralLedgerPage, ProfitLossPage, TrialBalancePage } from './reports/StatementPages'
import { AuditLogPage } from './pages/settings/AuditLogPage'
import { PeriodsPage } from './pages/settings/PeriodsPage'
import { UsersPage } from './pages/settings/UsersPage'

export default function App() {
  const { status, can } = useAuth()
  const location = useLocation()

  // The QR verification page is public: it never asks anyone to sign in.
  if (location.pathname.startsWith('/verify/')) {
    return <Routes><Route path="/verify/:token" element={<VerifyPage />} /></Routes>
  }

  if (status === 'loading') return <Center h="100dvh"><Loader /></Center>
  if (status === 'signedOut') return <LoginPage />
  if (status === 'needsMfa') return <MfaPage />
  if (status === 'noCompany') return <NoCompanyPage />

  const md = (c: typeof projectsConfig) => <MasterDataPage key={c.id} config={c} />

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="entries" element={<EntriesPage />} />
        <Route path="entries/new/:kind" element={<DocumentPage key="new" />} />
        <Route path="entries/:id" element={<DocumentPage />} />

        <Route path="procurement" element={<SectionTabs base="/procurement" tabs={[
          { path: 'orders', label: 'proc.orders' }, { path: 'bills', label: 'proc.bills' },
          { path: 'suppliers', label: 'md.suppliers' }, { path: 'items', label: 'md.items' }]} />}>
          <Route index element={<Navigate to="orders" replace />} />
          <Route path="orders" element={<EntriesPage key="po" kinds={['purchase_order']} title="proc.orders" />} />
          <Route path="bills" element={<EntriesPage key="bill" kinds={['supplier_bill']} title="proc.bills" />} />
          <Route path="suppliers" element={md(suppliersConfig)} />
          <Route path="items" element={md(itemsConfig)} />
        </Route>

        <Route path="sales" element={<SectionTabs base="/sales" tabs={[
          { path: 'invoices', label: 'proc.invoices' }, { path: 'quotations', label: 'proc.quotations' },
          { path: 'credit-notes', label: 'proc.creditNotes' }, { path: 'customers', label: 'md.customers' }]} />}>
          <Route index element={<Navigate to="invoices" replace />} />
          <Route path="invoices" element={<EntriesPage key="inv" kinds={['sales_invoice']} title="proc.invoices" />} />
          <Route path="quotations" element={<EntriesPage key="qt" kinds={['quotation']} title="proc.quotations" />} />
          <Route path="credit-notes" element={<EntriesPage key="cn" kinds={['credit_note']} title="proc.creditNotes" />} />
          <Route path="customers" element={md(customersConfig)} />
        </Route>

        <Route path="projects" element={md(projectsConfig)} />
        <Route path="reports" element={<SectionTabs base="/reports" tabs={[
          { path: 'pl', label: 'rep.tabs.pl', show: can('reports.financial') }, { path: 'bs', label: 'rep.tabs.bs', show: can('reports.financial') },
          { path: 'cf', label: 'rep.tabs.cf', show: can('reports.financial') }, { path: 'equity', label: 'rep.tabs.eq', show: can('reports.financial') },
          { path: 'tb', label: 'rep.tabs.tb', show: can('reports.financial') }, { path: 'gl', label: 'rep.tabs.gl', show: can('reports.financial') },
          { path: 'ar', label: 'rep.tabs.ar' }, { path: 'ap', label: 'rep.tabs.ap' }, { path: 'statement', label: 'rep.tabs.st' },
          { path: 'projects', label: 'rep.tabs.prj' }, { path: 'bank', label: 'rep.tabs.bank', show: can('docs.view') },
          { path: 'balances', label: 'rep.tabs.pb' }, { path: 'assets', label: 'rep.tabs.fa' },
          { path: 'audit', label: 'rep.tabs.pack', show: can('reports.financial') }]} />}>
          <Route index element={<Navigate to={can('reports.financial') ? 'pl' : 'ar'} replace />} />
          <Route path="pl" element={<ProfitLossPage />} />
          <Route path="bs" element={<BalanceSheetPage />} />
          <Route path="cf" element={<CashFlowPage />} />
          <Route path="equity" element={<EquityPage />} />
          <Route path="tb" element={<TrialBalancePage />} />
          <Route path="gl" element={<GeneralLedgerPage />} />
          <Route path="ar" element={<AgingPage key="ar" side="ar" />} />
          <Route path="ap" element={<AgingPage key="ap" side="ap" />} />
          <Route path="statement" element={<StatementPage />} />
          <Route path="projects" element={<ProjectPlPage />} />
          <Route path="bank" element={<BankBookPage />} />
          <Route path="balances" element={<PartyBalancesPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="audit" element={<AuditPackPage />} />
        </Route>

        <Route path="settings" element={<SectionTabs base="/settings" tabs={[
          { path: 'accounts', label: 'md.moneyAccounts' },
          { path: 'coa', label: 'md.coa' },
          { path: 'rates', label: 'md.rates' },
          { path: 'employees', label: 'md.employees' },
          { path: 'periods', label: 'settings.periods' },
          { path: 'users', label: 'settings.users', show: can('users.manage') || can('audit.view') },
          { path: 'audit', label: 'settings.audit', show: can('audit.view') }]} />}>
          <Route index element={<Navigate to="accounts" replace />} />
          <Route path="accounts" element={md(moneyAccountsConfig)} />
          <Route path="coa" element={md(coaConfig)} />
          <Route path="rates" element={md(ratesConfig)} />
          <Route path="employees" element={md(employeesConfig)} />
          <Route path="periods" element={<PeriodsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="audit" element={<AuditLogPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
