import { Badge, Button, Group, Menu, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useDocKinds, useMoneyAccounts, useParties } from './data'
import type { DocKind } from './logic'

const STATUS_COLOR: Record<string, string> = { draft: 'gray', submitted: 'yellow', posted: 'green', void: 'red' }

export function EntriesPage({ kinds: only, title }: { kinds?: DocKind[]; title?: string } = {}) {
  const { t, i18n } = useTranslation()
  const { company, can } = useAuth()
  const navigate = useNavigate()
  const kinds = useDocKinds()
  const parties = useParties()
  const accounts = useMoneyAccounts()
  const [kind, setKind] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const cid = company?.company_id

  const docs = useQuery({
    queryKey: ['entries', cid, kind, status, only],
    enabled: Boolean(cid),
    queryFn: async () => {
      let q = supabase.from('documents').select('id, kind, status, number, temp_number, revision, doc_date, party_id, money_account_id, amount, fee_amount, currency, description, reference_no, legacy_id')
        .eq('company_id', cid!).order('doc_date', { ascending: false }).limit(300)
      if (kind) q = q.eq('kind', kind)
      else if (only?.length) q = q.in('kind', only)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const name = (list: { id: string; name_en: string; name_ar: string | null }[] | undefined, id: string | null) => {
    const r = list?.find((x) => x.id === id)
    return r ? localName(r, i18n.language) : ''
  }
  const kindName = (k: string) => { const x = kinds.data?.find((y) => y.kind === k); return x ? localName(x, i18n.language) : k }
  const q = search.trim().toLowerCase()
  const rows = (docs.data ?? []).filter((d) => !q || [d.number, d.temp_number, d.description, d.reference_no, d.legacy_id, name(parties.data, d.party_id)]
    .some((v) => String(v ?? '').toLowerCase().includes(q)))

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{t(title ?? 'nav.entries')}</Title>
        {can('docs.create') && (
          <Menu position="bottom-end">
            <Menu.Target><Button leftSection={<IconPlus size={18} />}>{t('doc.new')}</Button></Menu.Target>
            <Menu.Dropdown>
              {(kinds.data ?? []).filter((k) => (!only || only.includes(k.kind)) && (k.kind !== 'manual_journal' || can('journal.manual'))).map((k) => (
                <Menu.Item key={k.kind} onClick={() => navigate(`/entries/new/${k.kind}`)}>{localName(k, i18n.language)}</Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Group wrap="wrap">
        <TextInput flex={1} miw={200} leftSection={<IconSearch size={16} />} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Select placeholder={t('doc.kind')} clearable value={kind} onChange={setKind} w={220}
          data={(kinds.data ?? []).filter((k) => !only || only.includes(k.kind)).map((k) => ({ value: k.kind, label: localName(k, i18n.language) }))} />
        <Select placeholder={t('doc.status')} clearable value={status} onChange={setStatus} w={180}
          data={['draft', 'submitted', 'posted', 'void'].map((s) => ({ value: s, label: t(`doc.${s}`) }))} />
      </Group>
      <ScrollArea type="auto">
        <Table striped highlightOnHover verticalSpacing="sm" miw={760}>
          <Table.Thead><Table.Tr>
            <Table.Th>{t('doc.number')}</Table.Th><Table.Th>{t('doc.date')}</Table.Th><Table.Th>{t('doc.kind')}</Table.Th>
            <Table.Th>{t('doc.party')}</Table.Th><Table.Th>{t('doc.account')}</Table.Th><Table.Th ta="end">{t('doc.amount')}</Table.Th><Table.Th>{t('doc.status')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((d) => (
              <Table.Tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/entries/${d.id}`)}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{d.number ?? <Text span c="dimmed" size="sm">{d.temp_number}</Text>}{d.revision ? ` Rev.${d.revision}` : ''}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{d.doc_date}</Table.Td>
                <Table.Td>{kindName(d.kind)}</Table.Td>
                <Table.Td>{name(parties.data, d.party_id)}</Table.Td>
                <Table.Td>{name(accounts.data, d.money_account_id)}</Table.Td>
                <Table.Td ta="end" style={{ whiteSpace: 'nowrap' }}><bdi>{formatMoney(Number(d.amount) + Number(d.fee_amount), d.currency, i18n.language)}</bdi></Table.Td>
                <Table.Td><Badge color={STATUS_COLOR[d.status]} variant="light">{t(`doc.${d.status}`)}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!docs.isLoading && rows.length === 0 && <Text c="dimmed" p="md">{t('doc.noEntries')}</Text>}
      </ScrollArea>
    </Stack>
  )
}
