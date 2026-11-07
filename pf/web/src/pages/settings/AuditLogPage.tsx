import { Badge, Code, Group, ScrollArea, Select, Spoiler, Stack, Table, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'

interface AuditRow {
  id: number; at: string; user_id: string | null; table_name: string; record_id: string | null
  action: string; changed_fields: string[] | null; before: Record<string, unknown> | null
  after: Record<string, unknown> | null; note: string | null; ip: string | null
}

const TABLES = ['projects', 'parties', 'items', 'money_accounts', 'gl_accounts', 'fx_rates', 'fiscal_periods', 'user_roles', 'user_profiles', 'companies']
const COLORS: Record<string, string> = { INSERT: 'green', UPDATE: 'blue', DELETE: 'red', EVENT: 'grape' }

export function AuditLogPage() {
  const { t } = useTranslation()
  const { company } = useAuth()
  const [table, setTable] = useState<string | null>(null)
  const cid = company?.company_id

  const rows = useQuery({
    queryKey: ['audit', cid, table],
    enabled: Boolean(cid),
    queryFn: async () => {
      let q = supabase.from('audit_log').select('*').eq('company_id', cid!).order('id', { ascending: false }).limit(200)
      if (table) q = q.eq('table_name', table)
      const { data, error } = await q
      if (error) throw error
      const list = data as AuditRow[]
      const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))] as string[]
      const people = ids.length ? (await supabase.from('user_profiles').select('user_id, full_name, email').in('user_id', ids)).data ?? [] : []
      const names = Object.fromEntries(people.map((p) => [p.user_id, p.full_name || p.email]))
      return list.map((r) => ({ ...r, who: r.user_id ? names[r.user_id] ?? r.user_id.slice(0, 8) : 'system' }))
    },
  })

  const diff = (r: AuditRow) => {
    if (r.note) return r.note
    if (r.action === 'UPDATE') return (r.changed_fields ?? []).map((f) => `${f}: ${JSON.stringify(r.before?.[f])} → ${JSON.stringify(r.after?.[f])}`).join('\n')
    return JSON.stringify(r.after ?? r.before, null, 1)
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{t('settings.audit')}</Title>
        <Select placeholder={t('settings.record')} clearable value={table} onChange={setTable} data={TABLES} w={200} />
      </Group>
      <ScrollArea>
        <Table striped verticalSpacing="xs" miw={700}>
          <Table.Thead><Table.Tr>
            <Table.Th>{t('settings.when')}</Table.Th><Table.Th>{t('settings.who')}</Table.Th>
            <Table.Th>{t('settings.what')}</Table.Th><Table.Th>{t('settings.changes')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {(rows.data ?? []).map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td><Text size="xs">{new Date(r.at).toLocaleString()}</Text><Text size="xs" c="dimmed">{r.ip}</Text></Table.Td>
                <Table.Td><Text size="sm">{r.who}</Text></Table.Td>
                <Table.Td><Badge color={COLORS[r.action]} variant="light">{r.action}</Badge><Text size="xs">{r.table_name}</Text></Table.Td>
                <Table.Td><Spoiler maxHeight={60} showLabel="+" hideLabel="−"><Code block dir="ltr">{diff(r)}</Code></Spoiler></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  )
}
