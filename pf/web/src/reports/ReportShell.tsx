import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { IconFileSpreadsheet, IconPrinter } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { localName } from '../lib/format'
import { type Cell, downloadCsv } from './export'

/** Frame shared by every report: title, period, filters, CSV + print, then the report itself. */
export function ReportShell({ title, period, filters, csv, children }: {
  title: string; period?: string; filters?: ReactNode
  csv?: () => { name: string; header: string[]; rows: Cell[][] }
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const { company } = useAuth()
  return (
    <Stack>
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={0}>
          <Title order={3}>{title}</Title>
          <Text size="sm" c="dimmed">{company ? localName(company, i18n.language) : ''}{period ? ` · ${period}` : ''} · USD</Text>
        </Stack>
        <Group className="no-print" gap="xs">
          {csv && <Button variant="default" size="sm" leftSection={<IconFileSpreadsheet size={16} />} onClick={() => { const c = csv(); downloadCsv(c.name, c.header, c.rows) }}>{t('rep.csv')}</Button>}
          <Button variant="default" size="sm" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>{t('rep.printPdf')}</Button>
        </Group>
      </Group>
      {filters && <Group className="no-print" align="flex-end" wrap="wrap">{filters}</Group>}
      {children}
    </Stack>
  )
}

export const thisYear = () => {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: new Date().toISOString().slice(0, 10) }
}
