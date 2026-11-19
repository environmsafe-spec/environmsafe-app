import {
  Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, ScrollArea, Select, SimpleGrid, Stack, Switch,
  Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { buildPayload, matchesSearch, missingRequired } from './payload'
import type { Field, MasterConfig, RefSource, Row } from './types'

type RefRow = { id: string; code: string; name_en: string; name_ar: string | null }

function useRefRows(source: RefSource | undefined, companyId: string | undefined) {
  return useQuery({
    queryKey: ['ref', source?.table, source?.filter, companyId],
    enabled: Boolean(source && companyId),
    queryFn: async () => {
      let q = supabase.from(source!.table).select('id, code, name_en, name_ar').eq('company_id', companyId!)
      for (const [k, v] of Object.entries(source!.filter ?? {})) q = q.eq(k, v as never)
      const { data, error } = await q.order('code')
      if (error) throw error
      return (data ?? []) as RefRow[]
    },
  })
}

function RefSelect({ field, value, onChange, error, disabled }: {
  field: Field; value: unknown; onChange: (v: string | null) => void; error?: React.ReactNode; disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { company } = useAuth()
  const { data = [] } = useRefRows(field.ref, company?.company_id)
  const options = data.map((r) => ({ value: r.id, label: `${r.code} · ${localName(r, i18n.language)}` }))
  return (
    <Select label={t(field.label)} data={options} value={(value as string) ?? null} onChange={onChange}
      searchable clearable required={field.required} error={error} disabled={disabled} nothingFoundMessage="—" />
  )
}

function FieldInput({ field, form, mode }: {
  field: Field
  form: ReturnType<typeof useForm<Record<string, unknown>>>
  mode: 'create' | 'edit'
}) {
  const { t } = useTranslation()
  const { data: currencies = [] } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => (await supabase.from('currencies').select('code').order('sort')).data ?? [],
    staleTime: Infinity,
  })
  if (field.visibleWhen && !field.visibleWhen(form.getValues())) return null
  const disabled = mode === 'edit' && field.createOnly
  const props = form.getInputProps(field.key, field.type === 'checkbox' ? { type: 'checkbox' } : undefined)
  const label = t(field.label)

  switch (field.type) {
    case 'textarea':
      return <Textarea label={label} autosize minRows={2} {...props} value={(props.value as string) ?? ''} disabled={disabled} />
    case 'number':
      return <NumberInput label={label} thousandSeparator="," decimalScale={4} required={field.required} {...props}
        value={(props.value as number | string) ?? ''} disabled={disabled} />
    case 'date':
      return <TextInput type="date" label={label} required={field.required} {...props} value={(props.value as string) ?? ''} disabled={disabled} />
    case 'checkbox':
      return <Checkbox label={label} mt="lg" {...props} disabled={disabled} />
    case 'select':
      return <Select label={label} required={field.required} disabled={disabled}
        data={(field.options ?? []).map((o) => ({ value: o, label: t(`enum.${o}`) }))}
        {...props} value={(props.value as string) ?? null} />
    case 'currency':
      return <Select label={label} required={field.required} disabled={disabled} clearable={!field.required}
        data={currencies.map((c) => c.code as string)} {...props} value={(props.value as string) ?? null} />
    case 'ref':
      return <RefSelect field={field} value={props.value} onChange={(v) => form.setFieldValue(field.key, v)}
        error={props.error} disabled={disabled} />
    default:
      return <TextInput label={label} required={field.required} dir={field.dir} {...props}
        value={(props.value as string) ?? ''} disabled={disabled} />
  }
}

export function MasterDataPage({ config }: { config: MasterConfig }) {
  const { t, i18n } = useTranslation()
  const { company, can } = useAuth()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [opened, { open, close }] = useDisclosure(false)
  const companyId = company?.company_id

  const canEdit = config.managePerms.some(can)
  const canCreate = (config.createPerms ?? config.managePerms).some(can)

  const list = useQuery({
    queryKey: ['md', config.id, companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = supabase.from(config.table).select('*').eq('company_id', companyId!)
      for (const [k, v] of Object.entries(config.baseFilter ?? {})) q = q.eq(k, v as never)
      const { data, error } = await q.order(config.orderBy)
      if (error) throw error
      return (data ?? []) as Row[]
    },
  })

  // Names for reference columns (customer of a project, parent account...).
  const refTables = useMemo(() => [...new Set(config.fields.filter((f) => f.ref).map((f) => f.ref!.table))], [config])
  const refs = useQuery({
    queryKey: ['refnames', refTables, companyId],
    enabled: Boolean(companyId) && refTables.length > 0,
    queryFn: async () => {
      const out: Record<string, Record<string, RefRow>> = {}
      for (const tbl of refTables) {
        const { data } = await supabase.from(tbl).select('id, code, name_en, name_ar').eq('company_id', companyId!)
        out[tbl] = Object.fromEntries(((data ?? []) as RefRow[]).map((r) => [r.id, r]))
      }
      return out
    },
  })
  const refName = (table: string, id: unknown) => {
    const r = refs.data?.[table]?.[id as string]
    return r ? `${r.code} · ${localName(r, i18n.language)}` : ''
  }

  const form = useForm<Record<string, unknown>>({ mode: 'controlled', initialValues: {} })

  const save = useMutation({
    mutationFn: async () => {
      const values = form.getValues()
      const missing = missingRequired(config.fields, values)
      if (missing.length) {
        missing.forEach((k) => form.setFieldError(k, t('common.error')))
        throw new Error(missing.map((k) => t(config.fields.find((f) => f.key === k)!.label)).join(', '))
      }
      const mode = editing ? 'edit' : 'create'
      const payload = buildPayload(config.fields, values, mode)
      if (editing && config.hasActiveFlag) payload.is_active = Boolean(values.is_active)
      if (editing) {
        const { error } = await supabase.from(config.table).update(payload as never).eq('id', editing.id)
        if (error) throw error
      } else {
        const row = { ...config.defaults, ...payload, company_id: companyId, ...(config.autoCode ? { code: '' } : {}) }
        const { error } = await supabase.from(config.table).insert(row as never)
        if (error) throw error
      }
    },
    onSuccess: () => {
      notifications.show({ color: 'green', message: t('common.saved') })
      void qc.invalidateQueries({ queryKey: ['md', config.id] })
      void qc.invalidateQueries({ queryKey: ['ref'] })
      void qc.invalidateQueries({ queryKey: ['refnames'] })
      close()
    },
    onError: (e: Error) => notifications.show({ color: 'red', title: t('common.error'), message: e.message }),
  })

  const startCreate = () => {
    setEditing(null)
    form.setValues({ ...Object.fromEntries(config.fields.map((f) => [f.key, f.type === 'checkbox' ? false : ''])), ...config.defaults })
    form.clearErrors()
    open()
  }
  const startEdit = (row: Row) => {
    setEditing(row)
    form.setValues({
      ...Object.fromEntries(config.fields.map((f) => [f.key, row[f.key] ?? (f.type === 'checkbox' ? false : '')])),
      is_active: row.is_active,
    })
    form.clearErrors()
    open()
  }

  const rows = (list.data ?? [])
    .filter((r) => showInactive || !config.hasActiveFlag || r.is_active !== false)
    .filter((r) => matchesSearch(r, config.searchKeys, search))

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>{t(config.title)}</Title>
        {canCreate && <Button leftSection={<IconPlus size={18} />} onClick={startCreate}>{t('common.add')}</Button>}
      </Group>
      <Group wrap="wrap">
        <TextInput flex={1} miw={200} leftSection={<IconSearch size={16} />} placeholder={t('common.search')}
          value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        {config.hasActiveFlag && <Switch label={t('common.showInactive')} checked={showInactive}
          onChange={(e) => setShowInactive(e.currentTarget.checked)} />}
      </Group>
      {!canEdit && <Text size="sm" c="dimmed">{t('common.readOnly')}</Text>}
      {list.error && <Alert color="red">{(list.error as Error).message}</Alert>}

      <ScrollArea type="auto">
        <Table striped highlightOnHover verticalSpacing="sm" miw={560}>
          <Table.Thead>
            <Table.Tr>{config.columns.map((c) => <Table.Th key={c.key}>{t(c.label)}</Table.Th>)}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id} onClick={() => canEdit && startEdit(r)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                {config.columns.map((c) => (
                  <Table.Td key={c.key}>
                    {c.render ? c.render(r, { lang: i18n.language, t, refName }) : String(r[c.key] ?? '')}
                    {c.key === 'code' && r.is_active === false && <Badge ms="xs" color="gray" size="xs">{t('common.inactive')}</Badge>}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {list.isLoading && <Text c="dimmed" p="md">{t('common.loading')}</Text>}
        {!list.isLoading && rows.length === 0 && <Text c="dimmed" p="md">{t('common.noRows')}</Text>}
      </ScrollArea>

      <Modal opened={opened} onClose={close} size="lg" fullScreen={window.innerWidth < 600}
        title={<Text fw={600}>{editing ? `${t('common.edit')} · ${String(editing.code ?? '')}` : `${t('common.add')} · ${t(config.title)}`}</Text>}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {config.fields.map((f) => <FieldInput key={f.key} field={f} form={form} mode={editing ? 'edit' : 'create'} />)}
              {config.hasActiveFlag && editing && (
                <Checkbox label={t('common.active')} mt="lg" {...form.getInputProps('is_active', { type: 'checkbox' })} />
              )}
            </SimpleGrid>
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>{t('common.cancel')}</Button>
              <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}
