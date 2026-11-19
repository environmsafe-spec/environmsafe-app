import { ActionIcon, Button, Group, NumberInput, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

interface Template { id: string; name: string; source_document_id: string; day_of_month: number; is_active: boolean; last_period: string | null }

export function RecurringPage() {
  const { t } = useTranslation()
  const { company, can } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const now = new Date()
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const cid = company!.company_id
  const list = useQuery({
    queryKey: ['recurring', cid],
    queryFn: async () => ((await supabase.from('recurring_templates').select('*').eq('company_id', cid).order('name')).data ?? []) as Template[],
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['recurring'] })
  const err = (e: Error) => notifications.show({ color: 'red', message: e.message })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Template> }) => {
      const { error } = await supabase.from('recurring_templates').update(patch).eq('id', id)
      if (error) throw error
    }, onSuccess: refresh, onError: err,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('recurring_templates').delete().eq('id', id); if (error) throw error },
    onSuccess: refresh, onError: err,
  })
  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_recurring', { p_company: cid, p_year: Number(ym.slice(0, 4)), p_month: Number(ym.slice(5, 7)) })
      if (error) throw error
      return data as number
    },
    onSuccess: (n) => { notifications.show({ color: 'green', message: t('rec.created', { n }) }); refresh(); void qc.invalidateQueries({ queryKey: ['home'] }) },
    onError: err,
  })
  const manage = can('docs.create')
  return (
    <Stack>
      <Title order={3}>{t('rec.title')}</Title>
      <Text size="sm" c="dimmed">{t('rec.help')}</Text>
      {manage && (
        <Group align="flex-end">
          <TextInput type="month" label={t('rec.month')} value={ym} onChange={(e) => setYm(e.currentTarget.value)} />
          <Button loading={generate.isPending} onClick={() => generate.mutate()}>{t('rec.generate')}</Button>
        </Group>
      )}
      <Table striped verticalSpacing="xs" maw={760}>
        <Table.Thead><Table.Tr><Table.Th>{t('common.name')}</Table.Th><Table.Th>{t('rec.day')}</Table.Th><Table.Th>{t('rec.last')}</Table.Th><Table.Th>{t('common.active')}</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td><Text component="a" c="navy" style={{ cursor: 'pointer' }} onClick={() => navigate(`/entries/${r.source_document_id}`)}>{r.name}</Text></Table.Td>
              <Table.Td><NumberInput size="xs" w={70} min={1} max={28} value={r.day_of_month} disabled={!manage}
                onBlur={(e) => { const v = Number(e.currentTarget.value); if (v >= 1 && v <= 28 && v !== r.day_of_month) update.mutate({ id: r.id, patch: { day_of_month: v } }) }} /></Table.Td>
              <Table.Td>{r.last_period ?? '—'}</Table.Td>
              <Table.Td><Switch checked={r.is_active} disabled={!manage} onChange={(e) => update.mutate({ id: r.id, patch: { is_active: e.currentTarget.checked } })} /></Table.Td>
              <Table.Td>{manage && <ActionIcon variant="subtle" color="red" aria-label="delete" onClick={() => remove.mutate(r.id)}><IconTrash size={16} /></ActionIcon>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {!list.isLoading && (list.data ?? []).length === 0 && <Text c="dimmed">{t('rec.none')}</Text>}
    </Stack>
  )
}
