// Deals: one line per customer enquiry / order, from the request to the payment.
import { Badge, Button, Group, Modal, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useParties } from '../documents/data'
import { localName } from '../lib/format'
import { supabase } from '../lib/supabase'

export interface DealRow {
  id: string; code: string; name_en: string; customer_id: string | null; customer_name: string | null; status: string
  deal_outcome: string | null; closed_on: string | null; stage: string; drafts: number; last_date: string
  ordered_usd: number; invoiced_usd: number; receivable_usd: number; billed_usd: number; payable_usd: number
}

export const STAGE_COLOR: Record<string, string> = {
  new: 'gray', request: 'gray', sourcing: 'blue', offers: 'blue', quoted: 'indigo', ordered: 'violet', purchasing: 'grape',
  received: 'orange', delivered: 'yellow', invoiced: 'teal', paid: 'green', won: 'green', lost: 'red', cancelled: 'red', closed: 'gray',
}
export const STAGES = ['new', 'request', 'sourcing', 'offers', 'quoted', 'ordered', 'purchasing', 'received', 'delivered', 'invoiced', 'paid']

const usd = (v: number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function DealsPage() {
  const { t, i18n } = useTranslation()
  const { company, can } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const parties = useParties()
  const [show, setShow] = useState<'open' | 'closed' | 'all'>('open')
  const [creating, setCreating] = useState(false)
  const [customer, setCustomer] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const deals = useQuery({
    queryKey: ['deals', company?.company_id],
    enabled: Boolean(company),
    queryFn: async () => {
      const { data, error } = await supabase.from('v_deals').select('*').eq('company_id', company!.company_id).order('last_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as DealRow[]
    },
  })
  const rows = (deals.data ?? []).filter((d) => show === 'all' || (show === 'open' ? d.status !== 'closed' : d.status === 'closed'))

  const create = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('create_deal', { p_company: company!.company_id, p_customer: customer, p_name: name })
      if (error) throw error
      void qc.invalidateQueries({ queryKey: ['deals'] })
      void qc.invalidateQueries({ queryKey: ['tbl', 'projects'] })
      setCreating(false)
      navigate(`/deals/${data as string}`)
    } catch (e) {
      notifications.show({ color: 'red', title: t('common.error'), message: (e as Error).message })
    } finally { setBusy(false) }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{t('deal.title')}</Title>
        <Group>
          <SegmentedControl value={show} onChange={(v) => setShow(v as typeof show)}
            data={[{ value: 'open', label: t('deal.open') }, { value: 'closed', label: t('deal.closed') }, { value: 'all', label: t('deal.all') }]} />
          {can('docs.create') && <Button leftSection={<IconPlus size={16} />} onClick={() => { setName(''); setCustomer(null); setCreating(true) }}>{t('deal.new')}</Button>}
        </Group>
      </Group>
      <Text size="sm" c="dimmed">{t('deal.help')}</Text>
      <ScrollArea type="auto">
        <Table striped highlightOnHover miw={900} verticalSpacing={6}>
          <Table.Thead><Table.Tr>
            <Table.Th>{t('deal.deal')}</Table.Th><Table.Th>{t('doc.customer')}</Table.Th><Table.Th>{t('deal.stage')}</Table.Th>
            <Table.Th ta="end">{t('deal.orderedUsd')}</Table.Th><Table.Th ta="end">{t('deal.receivableUsd')}</Table.Th>
            <Table.Th ta="end">{t('deal.payableUsd')}</Table.Th><Table.Th>{t('deal.lastActivity')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((d) => (
              <Table.Tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/deals/${d.id}`)}>
                <Table.Td><Text fw={600} size="sm">{d.code}</Text><Text size="sm">{d.name_en}</Text></Table.Td>
                <Table.Td>{d.customer_name ?? ''}</Table.Td>
                <Table.Td>
                  <Badge color={STAGE_COLOR[d.stage] ?? 'gray'} variant="light">{t(`deal.stages.${d.stage}`)}</Badge>
                  {d.drafts > 0 && <Text size="xs" c="dimmed">{t('deal.drafts', { n: d.drafts })}</Text>}
                </Table.Td>
                <Table.Td ta="end"><bdi>{usd(d.ordered_usd)}</bdi></Table.Td>
                <Table.Td ta="end"><bdi>{usd(d.receivable_usd)}</bdi></Table.Td>
                <Table.Td ta="end"><bdi>{usd(d.payable_usd)}</bdi></Table.Td>
                <Table.Td>{d.last_date}</Table.Td>
              </Table.Tr>
            ))}
            {!rows.length && !deals.isLoading && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" size="sm">{t('deal.none')}</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Modal opened={creating} onClose={() => setCreating(false)} title={t('deal.new')}>
        <Stack>
          <Select label={t('doc.customer')} required searchable value={customer} onChange={setCustomer} data-autofocus
            data={(parties.data ?? []).filter((p) => p.is_active && p.is_customer).map((p) => ({ value: p.id, label: `${localName(p, i18n.language)} · ${p.code}` }))} />
          <TextInput label={t('deal.name')} placeholder={t('deal.namePh')} required value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Button loading={busy} disabled={!customer || !name.trim()} onClick={() => void create()}>{t('deal.create')}</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
