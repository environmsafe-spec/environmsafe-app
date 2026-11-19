import { Badge, Group, ScrollArea, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatMoney } from '../lib/format'
import { supabase } from '../lib/supabase'

const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const
const COLORS: Record<string, string> = { current: 'green', '1-30': 'yellow', '31-60': 'orange', '61-90': 'red', '90+': 'red' }

interface Row { document_id: string; number: string; party_id: string; party_name: string; doc_date: string; due_date: string; currency: string; amount: number; open_amount: number; days_overdue: number; bucket: string }

/** AR or AP aging as at a date, with totals per bucket and currency (amounts are never mixed across currencies). */
export function AgingPage({ side }: { side: 'ar' | 'ap' }) {
  const { t, i18n } = useTranslation()
  const { company } = useAuth()
  const navigate = useNavigate()
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const q = useQuery({
    queryKey: ['aging', side, company?.company_id, asOf],
    enabled: Boolean(company),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('aging', { p_company: company!.company_id, p_side: side, p_as_of: asOf })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })
  const rows = q.data ?? []
  const currencies = [...new Set(rows.map((r) => r.currency))]
  const total = (ccy: string, b?: string) => rows.filter((r) => r.currency === ccy && (!b || r.bucket === b)).reduce((a, r) => a + Number(r.open_amount), 0)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{t(side === 'ar' ? 'rep.arAging' : 'rep.apAging')}</Title>
        <TextInput type="date" label={t('rep.asOf')} value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} w={180} />
      </Group>
      {currencies.map((ccy) => (
        <Group key={ccy} gap="xs" wrap="wrap">
          <Text fw={700} w={50}>{ccy}</Text>
          {BUCKETS.map((b) => (
            <Badge key={b} size="lg" variant="light" color={COLORS[b]}>{t(`rep.b.${b}`)}: <bdi>{formatMoney(total(ccy, b), ccy, i18n.language)}</bdi></Badge>
          ))}
          <Badge size="lg" color="navy">{t('doc.total')}: <bdi>{formatMoney(total(ccy), ccy, i18n.language)}</bdi></Badge>
        </Group>
      ))}
      <ScrollArea type="auto">
        <Table striped highlightOnHover miw={720} verticalSpacing="xs">
          <Table.Thead><Table.Tr>
            <Table.Th>{t('doc.party')}</Table.Th><Table.Th>{t('doc.number')}</Table.Th><Table.Th>{t('doc.date')}</Table.Th>
            <Table.Th>{t('trade.dueDate')}</Table.Th><Table.Th ta="end">{t('doc.amount')}</Table.Th><Table.Th ta="end">{t('doc.open')}</Table.Th><Table.Th>{t('rep.overdue')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.document_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/entries/${r.document_id}`)}>
                <Table.Td>{r.party_name}</Table.Td><Table.Td>{r.number}</Table.Td><Table.Td>{r.doc_date}</Table.Td><Table.Td>{r.due_date}</Table.Td>
                <Table.Td ta="end"><bdi>{formatMoney(r.amount, r.currency, i18n.language)}</bdi></Table.Td>
                <Table.Td ta="end" fw={600}><bdi>{formatMoney(r.open_amount, r.currency, i18n.language)}</bdi></Table.Td>
                <Table.Td><Badge variant="light" color={COLORS[r.bucket]}>{r.days_overdue > 0 ? `${r.days_overdue} ${t('rep.days')}` : t('rep.b.current')}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!q.isLoading && rows.length === 0 && <Text c="dimmed" p="md">{t('rep.nothingOpen')}</Text>}
      </ScrollArea>
    </Stack>
  )
}
