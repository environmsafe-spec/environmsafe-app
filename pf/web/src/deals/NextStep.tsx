// "Next step" on an issued deal document: make the next document from chosen lines
// (RFQ, offer, quotation, customer order, purchase order, receipt, delivery note, invoice, bill).
import { Alert, Button, Checkbox, Group, Menu, Modal, NumberInput, Select, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowRight, IconChevronDown } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useParties } from '../documents/data'
import { SUPPLIER_KINDS, type DocKind } from '../documents/logic'

export interface SourceLine { id: string; line_no: number; line_kind: string; description: string | null; qty: number; unit: string | null; unit_price: number | null }

export function useDealFlows() {
  return useQuery({
    queryKey: ['deal_flows'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.from('deal_flows').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as { from_kind: DocKind; to_kind: DocKind; sort: number }[]
    },
  })
}

const isSupplier = (k: DocKind) => SUPPLIER_KINDS.includes(k)

/** Call make_document and open the new draft. */
export async function makeDocument(args: { kind: DocKind; lineIds: string[]; party?: string | null; margin?: number | null; currency?: string | null }) {
  const { data, error } = await supabase.rpc('make_document', {
    p_kind: args.kind, p_line_ids: args.lineIds, p_party: args.party ?? null, p_margin: args.margin ?? null, p_currency: args.currency ?? null,
  })
  if (error) throw error
  return data as string
}

export function NextStep({ fromKind, partyId, currency, lines }: {
  fromKind: DocKind; partyId: string | null; currency: string; lines: SourceLine[]
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const flows = useDealFlows()
  const parties = useParties()
  const [to, setTo] = useState<DocKind | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [party, setParty] = useState<string | null>(null)
  const [margin, setMargin] = useState<number | ''>('')
  const [ccy, setCcy] = useState(currency)
  const [busy, setBusy] = useState(false)

  const targets = (flows.data ?? []).filter((f) => f.from_kind === fromKind).map((f) => f.to_kind)
  if (!targets.length) return null
  const itemLines = lines.filter((l) => l.line_kind === 'item')

  const open = (k: DocKind) => {
    setTo(k)
    setChosen(itemLines.map((l) => l.id))
    // Same side keeps the party; a new supplier must be chosen; customer documents default to the deal's customer.
    setParty(isSupplier(k) === isSupplier(fromKind) ? partyId : null)
    setMargin(fromKind === 'supplier_offer' && k === 'quotation' ? 20 : '')
    setCcy(currency)
  }
  const needsParty = to !== null && isSupplier(to) && !isSupplier(fromKind)
  const partyOptions = (parties.data ?? [])
    .filter((p) => p.is_active && (to && isSupplier(to) ? p.is_supplier : p.is_customer))
    .map((p) => ({ value: p.id, label: `${localName(p, i18n.language)} · ${p.code}` }))

  const go = async () => {
    if (!to) return
    setBusy(true)
    try {
      const id = await makeDocument({ kind: to, lineIds: chosen, party, margin: typeof margin === 'number' ? margin : null, currency: ccy !== currency ? ccy : null })
      setTo(null)
      navigate(`/entries/${id}`)
    } catch (e) {
      notifications.show({ color: 'red', title: t('common.error'), message: (e as Error).message })
    } finally { setBusy(false) }
  }

  return (
    <>
      {targets.length === 1 ? (
        <Button variant="light" rightSection={<IconArrowRight size={16} />} onClick={() => open(targets[0])}>{t(`deal.make.${targets[0]}`)}</Button>
      ) : (
        <Menu position="bottom-start">
          <Menu.Target>
            <Button variant="light" rightSection={<IconChevronDown size={16} />}>{t('deal.nextStep')}</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {targets.map((k) => <Menu.Item key={k} onClick={() => open(k)}>{t(`deal.make.${k}`)}</Menu.Item>)}
          </Menu.Dropdown>
        </Menu>
      )}
      <Modal opened={to !== null} onClose={() => setTo(null)} title={to ? t(`deal.make.${to}`) : ''} size="lg">
        {to && (
          <Stack>
            <Text size="sm" c="dimmed">{t('deal.chooseLines')}</Text>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Tbody>
                {itemLines.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td w={32}>
                      <Checkbox aria-label={l.description ?? String(l.line_no)} checked={chosen.includes(l.id)}
                        onChange={(e) => { const on = e.currentTarget.checked; setChosen((c) => (on ? [...c, l.id] : c.filter((x) => x !== l.id))) }} />
                    </Table.Td>
                    <Table.Td>{l.line_no}. {l.description}</Table.Td>
                    <Table.Td ta="end"><bdi>{l.qty} {l.unit ?? ''}</bdi></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Select label={isSupplier(to) ? t('doc.supplier') : t('doc.customer')} data={partyOptions} value={party} onChange={setParty} searchable
              clearable={!needsParty} required={needsParty}
              description={!needsParty && !party ? (isSupplier(to) ? t('deal.sameSupplier') : t('deal.dealCustomer')) : undefined} />
            <Group grow>
              {to === 'quotation' && (
                <NumberInput label={t('deal.marginPct')} value={margin} onChange={(v) => setMargin(typeof v === 'number' ? v : '')} rightSection="%" min={0} decimalScale={2}
                  description={fromKind === 'supplier_offer' ? t('deal.marginHelp') : t('deal.marginLastCost')} />
              )}
              <Select label={t('md.currency')} data={['USD', 'SAR', 'YER']} value={ccy} onChange={(v) => setCcy(v ?? currency)} allowDeselect={false}
                description={ccy !== currency ? t('deal.convertHelp') : undefined} />
            </Group>
            {['goods_receipt', 'delivery_note', 'sales_invoice', 'supplier_bill', 'purchase_order', 'sales_order'].includes(to) && (
              <Alert color="blue" variant="light">{t('deal.openQtyHelp')}</Alert>
            )}
            <Button onClick={() => void go()} loading={busy} disabled={!chosen.length || (needsParty && !party)}>{t('deal.makeDraft')}</Button>
          </Stack>
        )}
      </Modal>
    </>
  )
}

/** Three-way match on a supplier bill: warnings only. */
export function MatchWarnings({ billId, status }: { billId: string; status: string }) {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['match', billId, status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('match_check', { p_bill: billId })
      if (error) throw error
      return (data ?? []) as { line_no: number; problem: string }[]
    },
  })
  if (!q.data?.length) return null
  return (
    <Alert color="orange" title={t('deal.matchTitle')}>
      {q.data.map((w) => <div key={`${w.line_no}-${w.problem}`}>{t('deal.line')} {w.line_no}: {w.problem}</div>)}
    </Alert>
  )
}
