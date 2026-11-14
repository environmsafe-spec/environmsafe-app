import { ActionIcon, AppShell, Burger, Group, Image, NavLink, Select, Stack, Text, Tooltip } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconBuildingStore, IconChartBar, IconFolders, IconHome, IconListDetails, IconLogout, IconReceipt, IconSettings,
} from '@tabler/icons-react'
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { localName } from '../lib/format'
import { LanguageToggle } from './LanguageToggle'

const SETTINGS_PERMS = ['company.manage', 'users.manage', 'audit.view', 'rates.manage', 'periods.close', 'money_accounts.manage', 'gl.manage']

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { company, companies, selectCompany, signOut, can, session } = useAuth()
  const [opened, { toggle, close }] = useDisclosure()
  const location = useLocation()

  const nav = [
    { to: '/', label: 'nav.home', icon: IconHome, show: true },
    { to: '/entries', label: 'nav.entries', icon: IconListDetails, show: can('docs.view') },
    { to: '/procurement', label: 'nav.procurement', icon: IconBuildingStore, show: can('masterdata.view') },
    { to: '/sales', label: 'nav.sales', icon: IconReceipt, show: can('masterdata.view') },
    { to: '/projects', label: 'nav.projects', icon: IconFolders, show: can('masterdata.view') },
    { to: '/reports', label: 'nav.reports', icon: IconChartBar, show: can('reports.view') || can('reports.financial') },
    { to: '/settings', label: 'nav.settings', icon: IconSettings, show: SETTINGS_PERMS.some(can) },
  ].filter((n) => n.show)

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header bg="navy.9" c="white">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="white" aria-label="menu" />
            <Image src="/logo.png" h={34} w="auto" alt="EnvironmSafe" style={{ background: 'white', borderRadius: 6, padding: 2 }} />
            <Text fw={700} visibleFrom="xs">{t('app.name')}</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {companies.length > 1 && (
              <Select size="xs" w={180} value={company?.company_id ?? null} allowDeselect={false}
                data={companies.map((c) => ({ value: c.company_id, label: localName(c, i18n.language) }))}
                onChange={(v) => v && selectCompany(v)} />
            )}
            <Tooltip label={session?.user.email}>
              <ActionIcon variant="subtle" color="white" size="lg" onClick={() => void signOut()} aria-label={t('common.signOut')}>
                <IconLogout size={20} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack justify="space-between" h="100%">
          <Stack gap={4}>
            {nav.map((n) => (
              <NavLink key={n.to} component={RouterLink} to={n.to} label={t(n.label)} leftSection={<n.icon size={20} />}
                active={n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)}
                onClick={close} variant="filled" style={{ borderRadius: 8 }} />
            ))}
          </Stack>
          <Stack gap={4}>
            <Text size="xs" c="dimmed">{company ? localName(company, i18n.language) : ''}</Text>
            <Text size="xs" c="dimmed">{company?.roles.map((r) => r).join(', ')}</Text>
            <LanguageToggle />
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
