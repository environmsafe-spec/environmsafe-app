import { Badge, Button, Group, Modal, Select, Stack, Table, Text, Textarea, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'

interface Period { id: string; year: number; month: number; status: 'open' | 'closed'; closed_at: string | null }

export function PeriodsPage() {
  const { t, i18n } = useTranslation()
  const { company, can } = useAuth()
  const qc = useQueryClient()
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [reopen, setReopen] = useState<Period | null>(null)
  const [reason, setReason] = useState('')
  const cid = company?.company_id

  const periods = useQuery({
    queryKey: ['periods', cid, year],
    enabled: Boolean(cid),
    queryFn: async () => {
      const { data, error } = await supabase.from('fiscal_periods').select('*').eq('company_id', cid!).eq('year', Number(year)).order('month')
      if (error) throw error
      return data as Period[]
    },
  })

  const act = useMutation({
    mutationFn: async ({ p, action }: { p: Period; action: 'close' | 'reopen' }) => {
      const { error } = action === 'close'
        ? await supabase.rpc('close_period', { p_company: cid, p_year: p.year, p_month: p.month })
        : await supabase.rpc('reopen_period', { p_company: cid, p_year: p.year, p_month: p.month, p_reason: reason })
      if (error) throw error
    },
    onSuccess: () => { setReopen(null); setReason(''); void qc.invalidateQueries({ queryKey: ['periods'] }) },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })

  const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString(i18n.language === 'ar' ? 'ar' : 'en', { month: 'long' })
  const thisYear = new Date().getFullYear()

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>{t('settings.periods')}</Title>
        <Select w={120} value={year} onChange={(v) => v && setYear(v)} allowDeselect={false}
          data={Array.from({ length: thisYear - 2024 + 1 }, (_, i) => String(2025 + i)).filter((y) => Number(y) <= thisYear + 1)} />
      </Group>
      <Table striped verticalSpacing="sm">
        <Table.Tbody>
          {(periods.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{monthName(p.month)} {p.year}</Table.Td>
              <Table.Td><Badge color={p.status === 'open' ? 'green' : 'gray'} variant="light">{t(`enum.${p.status}`)}</Badge></Table.Td>
              <Table.Td><Text size="xs" c="dimmed">{p.closed_at ? new Date(p.closed_at).toLocaleString() : ''}</Text></Table.Td>
              <Table.Td ta="end">
                {p.status === 'open' && can('periods.close') && (
                  <Button size="xs" variant="light" loading={act.isPending} onClick={() => act.mutate({ p, action: 'close' })}>{t('settings.close')}</Button>)}
                {p.status === 'closed' && can('periods.reopen') && (
                  <Button size="xs" variant="light" color="red" onClick={() => setReopen(p)}>{t('settings.reopen')}</Button>)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={Boolean(reopen)} onClose={() => setReopen(null)} title={t('settings.reopenReason')}>
        <Stack>
          <Textarea value={reason} onChange={(e) => setReason(e.currentTarget.value)} minRows={3} autosize data-autofocus />
          <Button color="red" disabled={reason.trim().length < 5} loading={act.isPending}
            onClick={() => reopen && act.mutate({ p: reopen, action: 'reopen' })}>{t('settings.reopen')}</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
