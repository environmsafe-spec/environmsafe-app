import { Group, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useParties } from '../documents/data'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'

interface Row { entry_date: string; document_id: string | null; number: string | null; description: string | null; currency: string; debit: number | null; credit: number | null; balance: number }

/** Statement of any party (customer, supplier, employee, owner), per currency, with running balance. */
export function StatementPage() {
  const { t, i18n } = useTranslation()
  const { company } = useAuth()
  const navigate = useNavigate()
  const parties = useParties()
  const [party, setParty] = useState<string | null>(null)
  const y = new Date().getFullYear()
  const [from, setFrom] = useState(`${y}-01-01`)
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const q = useQuery({
    queryKey: ['statement', company?.company_id, party, from, to],
    enabled: Boolean(company && party),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('party_statement', { p_company: company!.company_id, p_party: party, p_from: from, p_to: to })
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })
  const rows = q.data ?? []
  return (
    <Stack>
      <Title order={3}>{t('rep.statement')}</Title>
      <Group align="flex-end" wrap="wrap">
        <Select label={t('doc.party')} searchable value={party} onChange={setParty} miw={260}
          data={(parties.data ?? []).map((p) => ({ value: p.id, label: `${localName(p, i18n.language)} · ${p.code}` }))} />
        <TextInput type="date" label={t('rep.from')} value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput type="date" label={t('rep.to')} value={to} onChange={(e) => setTo(e.currentTarget.value)} />
      </Group>
      <Text size="xs" c="dimmed">{t('rep.statementHelp')}</Text>
      <ScrollArea type="auto">
        <Table striped miw={680} verticalSpacing="xs">
          <Table.Thead><Table.Tr>
            <Table.Th>{t('doc.date')}</Table.Th><Table.Th>{t('doc.number')}</Table.Th><Table.Th>{t('doc.description')}</Table.Th>
            <Table.Th ta="end">{t('doc.debit')}</Table.Th><Table.Th ta="end">{t('doc.credit')}</Table.Th><Table.Th ta="end">{t('rep.balance')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i} style={{ cursor: r.document_id ? 'pointer' : 'default' }} onClick={() => r.document_id && navigate(`/entries/${r.document_id}`)}>
                <Table.Td>{r.entry_date}</Table.Td><Table.Td>{r.number}</Table.Td><Table.Td>{r.description}</Table.Td>
                <Table.Td ta="end">{r.debit ? <bdi>{formatMoney(r.debit, r.currency, i18n.language)}</bdi> : ''}</Table.Td>
                <Table.Td ta="end">{r.credit ? <bdi>{formatMoney(r.credit, r.currency, i18n.language)}</bdi> : ''}</Table.Td>
                <Table.Td ta="end" fw={600}><bdi>{formatMoney(r.balance, r.currency, i18n.language)}</bdi></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  )
}
