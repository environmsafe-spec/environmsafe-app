import { Stack, Tabs } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

export interface SectionTab { path: string; label: string; show?: boolean }

/** Tabs under a top-level section (e.g. Procurement: Suppliers | Items). Tabs scroll on phones. */
export function SectionTabs({ base, tabs }: { base: string; tabs: SectionTab[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const visible = tabs.filter((x) => x.show !== false)
  const current = visible.find((x) => location.pathname.startsWith(`${base}/${x.path}`))?.path ?? visible[0]?.path
  return (
    <Stack>
      <Tabs value={current} onChange={(v) => v && navigate(`${base}/${v}`)} variant="pills">
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          {visible.map((x) => <Tabs.Tab key={x.path} value={x.path}>{t(x.label)}</Tabs.Tab>)}
        </Tabs.List>
      </Tabs>
      <Outlet />
    </Stack>
  )
}
