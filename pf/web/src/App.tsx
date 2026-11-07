import { Center, Loader } from '@mantine/core'
import { Navigate, Route, Routes } from 'react-router-dom'
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
import { PlaceholderPage } from './pages/PlaceholderPage'
import { AuditLogPage } from './pages/settings/AuditLogPage'
import { PeriodsPage } from './pages/settings/PeriodsPage'
import { UsersPage } from './pages/settings/UsersPage'

export default function App() {
  const { status, can } = useAuth()

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
          { path: 'suppliers', label: 'md.suppliers' }, { path: 'items', label: 'md.items' }]} />}>
          <Route index element={<Navigate to="suppliers" replace />} />
          <Route path="suppliers" element={md(suppliersConfig)} />
          <Route path="items" element={md(itemsConfig)} />
        </Route>

        <Route path="sales" element={<SectionTabs base="/sales" tabs={[{ path: 'customers', label: 'md.customers' }]} />}>
          <Route index element={<Navigate to="customers" replace />} />
          <Route path="customers" element={md(customersConfig)} />
        </Route>

        <Route path="projects" element={md(projectsConfig)} />
        <Route path="reports" element={<PlaceholderPage title="nav.reports" />} />

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
