import { ActionIcon, Button, Card, Group, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthProvider'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useItems } from './data'
import { computeTradeLines, newLine, SALES_KINDS, tradeTotals, type DocState, type KindInfo, type LineKind, type LineState } from './logic'

const NEW_ITEM = '__new__'

export function TradeLines({ k, s, setS, readOnly, projectOptions, accountOptions, currency }: {
  k: KindInfo; s: DocState; setS: React.Dispatch<React.SetStateAction<DocState>>; readOnly: boolean
  projectOptions: { value: string; label: string }[]; accountOptions: { value: string; label: string }[]; currency: string
}) {
  const { t, i18n } = useTranslation()
  const { company, can } = useAuth()
  const qc = useQueryClient()
  const items = useItems()
  const [creating, setCreating] = useState<{ key: string; name: string; kind: 'goods' | 'service'; unit: string } | null>(null)
  const sales = SALES_KINDS.includes(k.kind)
  const computed = computeTradeLines(s.lines)
  const totals = tradeTotals(s.lines)
  const canCreateItem = can('items.manage') || can('masterdata.create')

  const upd = (key: string, patch: Partial<LineState>) =>
    setS((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))

  const pickItem = (line: LineState, id: string | null) => {
    if (id === NEW_ITEM) { setCreating({ key: line.key, name: '', kind: 'service', unit: 'ea' }); return }
    const it = items.data?.find((x) => x.id === id)
    upd(line.key, {
      item_id: id,
      description: line.description || it?.name_en || '',
      unit: line.unit || it?.unit || '',
      // Smart default: last price for this item on the same side (sales / purchases).
      unit_price: line.unit_price !== '' ? line.unit_price : ((sales ? it?.last_sale_price : it?.last_cost) ?? ''),
    })
  }

  const createItem = async () => {
    if (!creating || !creating.name.trim()) return
    const id = crypto.randomUUID()
    const { error } = await supabase.from('items').insert({
      id, company_id: company!.company_id, code: '', name_en: creating.name.trim(), kind: creating.kind, unit: creating.unit.trim() || 'ea',
    })
    if (error) { notifications.show({ color: 'red', message: error.message }); return }
    await qc.invalidateQueries({ queryKey: ['tbl', 'items'] })
    upd(creating.key, { item_id: id, description: creating.name.trim(), unit: creating.unit.trim() || 'ea' })
    setCreating(null)
  }

  const itemOptions = [
    ...(canCreateItem && !readOnly ? [{ value: NEW_ITEM, label: `+ ${t('trade.newItem')}` }] : []),
    ...(items.data ?? []).filter((i) => i.is_active || s.lines.some((l) => l.item_id === i.id))
      .map((i) => ({ value: i.id, label: `${i.code} · ${localName(i, i18n.language)}` })),
  ]
  const add = (kind: LineKind) => setS((p) => ({
    ...p,
    lines: [...p.lines, {
      ...newLine('D', kind),
      project_id: p.lines.find((l) => l.project_id)?.project_id ?? null,
      description: kind === 'tax' ? (sales ? 'VAT' : 'Tax') : kind === 'discount' ? 'Discount' : '',
      percent: kind === 'item' ? '' : kind === 'tax' ? 5 : '',
    }],
  }))

  return (
    <Stack gap="xs">
      <Text fw={600}>{t('doc.lines')}</Text>
      {s.lines.map((l, idx) => {
        const amount = computed[idx]?.amount
        return (
          <Card key={l.key} withBorder p="xs" bg={l.line_kind === 'item' ? 'var(--mantine-color-gray-0)' : 'var(--mantine-color-yellow-0)'}>
            {l.line_kind === 'item' ? (
              <SimpleGrid cols={{ base: 1, sm: 6 }} spacing="xs">
                <Select size="sm" placeholder={t('trade.item')} aria-label={t('trade.item')} data={itemOptions} value={l.item_id} searchable
                  disabled={readOnly} allowDeselect={false} onChange={(v) => pickItem(l, v)} style={{ gridColumn: 'span 2' }} />
                <TextInput size="sm" placeholder={t('doc.description')} aria-label={t('doc.description')} value={l.description} disabled={readOnly}
                  onChange={(e) => upd(l.key, { description: e.currentTarget.value })} style={{ gridColumn: 'span 2' }} />
                <TextInput size="sm" placeholder={t('trade.detail')} aria-label={t('trade.detail')} value={l.detail} disabled={readOnly}
                  onChange={(e) => upd(l.key, { detail: e.currentTarget.value })} style={{ gridColumn: 'span 2' }} />
                <NumberInput size="sm" placeholder={t('trade.qty')} aria-label={t('trade.qty')} value={l.qty} min={0} decimalScale={4} disabled={readOnly}
                  onChange={(v) => upd(l.key, { qty: typeof v === 'number' ? v : '' })} />
                <TextInput size="sm" placeholder={t('md.unit')} aria-label={t('md.unit')} value={l.unit} disabled={readOnly}
                  onChange={(e) => upd(l.key, { unit: e.currentTarget.value })} />
                <NumberInput size="sm" placeholder={`${t('trade.unitPrice')} ${currency}`} aria-label={t('trade.unitPrice')} value={l.unit_price} min={0}
                  decimalScale={4} thousandSeparator="," disabled={readOnly} onChange={(v) => upd(l.key, { unit_price: typeof v === 'number' ? v : '' })} />
                {k.creates_journal ? (
                  <Select size="sm" placeholder={t('doc.project')} aria-label={t('doc.project')} data={projectOptions} value={l.project_id} searchable clearable
                    disabled={readOnly} onChange={(v) => upd(l.key, { project_id: v })} />
                ) : <div />}
                {k.creates_journal ? (
                  <Select size="sm" placeholder={t('trade.accountAuto')} aria-label={t('doc.glAccount')} data={accountOptions} value={l.gl_account_id} searchable clearable
                    disabled={readOnly} onChange={(v) => upd(l.key, { gl_account_id: v })} />
                ) : <div />}
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <Text fw={700} size="sm"><bdi>{formatMoney(Number(amount) || 0, currency)}</bdi></Text>
                  {!readOnly && s.lines.length > 1 && (
                    <ActionIcon variant="subtle" color="red" aria-label="remove" onClick={() => setS((p) => ({ ...p, lines: p.lines.filter((x) => x.key !== l.key) }))}><IconTrash size={16} /></ActionIcon>
                  )}
                </Group>
              </SimpleGrid>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 6 }} spacing="xs">
                <Text size="sm" fw={600} c="dimmed">{t(`trade.${l.line_kind}`)}</Text>
                <TextInput size="sm" placeholder={t('doc.description')} aria-label={t('doc.description')} value={l.description} disabled={readOnly}
                  onChange={(e) => upd(l.key, { description: e.currentTarget.value })} style={{ gridColumn: 'span 2' }} />
                <NumberInput size="sm" placeholder="%" aria-label={t('trade.percent')} value={l.percent} min={0} decimalScale={4} rightSection="%" disabled={readOnly}
                  onChange={(v) => upd(l.key, { percent: typeof v === 'number' ? v : '' })} />
                {l.line_kind === 'tax' ? (
                  <SegmentedControl size="xs" value={l.percent_base} disabled={readOnly} onChange={(v) => upd(l.key, { percent_base: v as 'items' | 'untaxed' })}
                    data={[{ value: 'items', label: t('trade.onItems') }, { value: 'untaxed', label: t('trade.onUntaxed') }]} />
                ) : typeof l.percent === 'number' ? <div /> : (
                  <NumberInput size="sm" placeholder={t('doc.amount')} aria-label={t('doc.amount')} value={l.amount} min={0} decimalScale={2} disabled={readOnly}
                    onChange={(v) => upd(l.key, { amount: typeof v === 'number' ? v : '' })} />
                )}
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <Text fw={700} size="sm"><bdi>{l.line_kind === 'discount' ? '−' : ''}{formatMoney(Number(amount) || 0, currency)}</bdi></Text>
                  {!readOnly && (
                    <ActionIcon variant="subtle" color="red" aria-label="remove" onClick={() => setS((p) => ({ ...p, lines: p.lines.filter((x) => x.key !== l.key) }))}><IconTrash size={16} /></ActionIcon>
                  )}
                </Group>
              </SimpleGrid>
            )}
          </Card>
        )
      })}
      {!readOnly && (
        <Group gap="xs">
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => add('item')}>{t('trade.addItem')}</Button>
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => add('charge')}>{t('trade.charge')}</Button>
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => add('discount')}>{t('trade.discount')}</Button>
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => add('tax')}>{t('trade.tax')}</Button>
        </Group>
      )}
      <Table w={{ base: '100%', sm: 320 }} ms="auto" fz="sm" verticalSpacing={2}>
        <Table.Tbody>
          <Table.Tr><Table.Td>{t('trade.subtotal')}</Table.Td><Table.Td ta="end"><bdi>{formatMoney(totals.items, currency)}</bdi></Table.Td></Table.Tr>
          {(totals.charges > 0 || totals.discounts > 0) && <Table.Tr><Table.Td>{t('trade.untaxed')}</Table.Td><Table.Td ta="end"><bdi>{formatMoney(totals.untaxed, currency)}</bdi></Table.Td></Table.Tr>}
          {totals.tax > 0 && <Table.Tr><Table.Td>{t('trade.tax')}</Table.Td><Table.Td ta="end"><bdi>{formatMoney(totals.tax, currency)}</bdi></Table.Td></Table.Tr>}
          <Table.Tr><Table.Td fw={700}>{t('doc.total')}</Table.Td><Table.Td ta="end" fw={700}><bdi>{formatMoney(totals.total, currency)}</bdi></Table.Td></Table.Tr>
        </Table.Tbody>
      </Table>

      <Modal opened={Boolean(creating)} onClose={() => setCreating(null)} title={t('trade.newItem')}>
        {creating && (
          <Stack>
            <TextInput label={t('common.nameEn')} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.currentTarget.value })} data-autofocus required />
            <SegmentedControl value={creating.kind} onChange={(v) => setCreating({ ...creating, kind: v as 'goods' | 'service' })}
              data={[{ value: 'service', label: t('enum.service') }, { value: 'goods', label: t('enum.goods') }]} />
            <TextInput label={t('md.unit')} value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.currentTarget.value })} />
            <Text size="xs" c="dimmed">{t('trade.newItemHelp')}</Text>
            <Button onClick={() => void createItem()} disabled={!creating.name.trim()}>{t('common.save')}</Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
