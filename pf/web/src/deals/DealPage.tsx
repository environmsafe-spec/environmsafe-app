// One deal: every document from the customer's request to the payment, the offers side by side,
// the progress of each ordered line, and closing the deal.
import {
  Alert, Anchor, Badge, Button, Card, Checkbox, Group, Menu, Modal, NumberInput, Radio, ScrollArea, SegmentedControl, SimpleGrid,
  Stack, Table, Text, Textarea, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronDown, IconPlus } from '@tabler/icons-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useDocKinds, useParties } from '../documents/data'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { STAGE_COLOR, STAGES, type DealRow } from './DealsPage'
import { makeDocument } from './NextStep'

interface DealDoc { id: string; created_at: string; kind: string; number: string | null; temp_number: string; status: string; doc_date: string; party_id: string | null; amount: number; currency: string; revision: number }
interface Offer {
  request_line_id: string; request_number: string; line_no: number; description: string | null; qty: number; unit: string | null
  offer_line_id: string | null; offer_number: string | null; supplier: string | null; offer_qty: number | null; currency: string | null
  unit_price: number | null; unit_price_usd: number | null; rank_usd: number | null
}
interface Progress {
  line_id: string; document_id: string; kind: string; number: string; party_id: string | null; line_no: number; description: string | null
  unit: string | null; qty: number; purchased: number; received: number; delivered: number; invoiced: number; billed: number
}

const usd = (v: number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const q = (v: number) => String(Number(v))

export function DealPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { can, company } = useAuth()
  const kinds = useDocKinds()
  const parties = useParties()
  const partyName = (pid: string | null) => { const p = parties.data?.find((x) => x.id === pid); return p ? localName(p, lang) : '' }

  const deal = useQuery({
    queryKey: ['deal', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_deals').select('*').eq('id', id!)
      if (error) throw error
      const d = (data ?? [])[0] as DealRow | undefined
      if (!d) throw new Error(t('deal.notFound'))
      return d
    },
  })
  // Everything of the deal: its own documents, costs charged to it on lines (freight, customs, subcontractors),
  // and the payments / receipts that settle its bills and invoices.
  const docs = useQuery({
    queryKey: ['deal-docs', id],
    queryFn: async () => {
      const cols = 'id, created_at, kind, number, temp_number, status, doc_date, party_id, amount, currency, revision'
      const own = await supabase.from('documents').select(cols).eq('project_id', id!)
      if (own.error) throw own.error
      const onLines = await supabase.from('document_lines').select('document_id').eq('project_id', id!)
      const ids = new Set([...(own.data ?? []).map((d) => d.id as string), ...(onLines.data ?? []).map((l) => l.document_id as string)])
      const settling = ids.size ? await supabase.from('document_links').select('from_document_id').in('to_document_id', [...ids]) : { data: [] }
      for (const l of settling.data ?? []) ids.add(l.from_document_id as string)
      const known = new Set((own.data ?? []).map((d) => d.id as string))
      const more = [...ids].filter((x) => !known.has(x))
      const extra = more.length ? await supabase.from('documents').select(cols).in('id', more) : { data: [] }
      return [...(own.data ?? []), ...(extra.data ?? [])] as DealDoc[]
    },
  })
  const pl = useQuery({
    queryKey: ['deal-pl', id],
    queryFn: async () => {
      const { data } = await supabase.rpc('project_pl', { p_company: company!.company_id, p_from: '2000-01-01', p_to: '2100-12-31' })
      return ((data ?? []) as { project_id: string; revenue: number; cost_of_sales: number; operating_expenses: number; margin: number; margin_pct: number | null }[])
        .find((r) => r.project_id === id) ?? null
    },
  })
  const offers = useQuery({
    queryKey: ['deal-offers', id],
    queryFn: async () => ((await supabase.rpc('deal_offers', { p_project: id })).data ?? []) as Offer[],
  })
  const progress = useQuery({
    queryKey: ['deal-lines', id],
    queryFn: async () => ((await supabase.rpc('deal_lines', { p_project: id })).data ?? []) as Progress[],
  })
  const openItems = useQuery({
    queryKey: ['deal-open', id],
    queryFn: async () => ((await supabase.rpc('deal_open_items', { p_project: id })).data ?? []) as { problem: string }[],
  })

  // Offers: one choice per requested line (cheapest by default), then "Make quotation".
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [margin, setMargin] = useState<number | ''>(20)
  useEffect(() => {
    const best: Record<string, string> = {}
    for (const o of offers.data ?? []) if (o.offer_line_id && Number(o.rank_usd) === 1 && !best[o.request_line_id]) best[o.request_line_id] = o.offer_line_id
    setChoice(best)
  }, [offers.data])

  const [closeOpen, setCloseOpen] = useState(false)
  const [outcome, setOutcome] = useState<'won' | 'lost' | 'cancelled'>('won')
  const [note, setNote] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)

  const kindInfo = (k: string) => kinds.data?.find((x) => x.kind === k)
  // In the order things happened (the story of the deal).
  const sortedDocs = useMemo(() => [...(docs.data ?? [])].sort((a, b) =>
    a.doc_date.localeCompare(b.doc_date) || a.created_at.localeCompare(b.created_at)), [docs.data])

  const refresh = () => { for (const k of ['deal', 'deal-docs', 'deal-pl', 'deal-offers', 'deal-lines', 'deal-open', 'deals']) void qc.invalidateQueries({ queryKey: [k] }) }
  const fail = (e: unknown) => notifications.show({ color: 'red', title: t('common.error'), message: (e as Error).message })

  if (deal.isLoading) return <Text c="dimmed">{t('common.loading')}</Text>
  if (deal.error || !deal.data) return <Alert color="red">{(deal.error as Error)?.message}</Alert>
  const d = deal.data
  const closed = d.status === 'closed'
  const newDoc = (kind: string, party?: string | null) =>
    navigate(`/entries/new/${kind}?project=${d.id}${party ? `&party=${party}` : ''}`)

  const makeQuotation = async () => {
    setBusy(true)
    try {
      const nid = await makeDocument({ kind: 'quotation', lineIds: Object.values(choice), margin: typeof margin === 'number' ? margin : null })
      navigate(`/entries/${nid}`)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const closeDeal = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('close_deal', { p_project: d.id, p_outcome: outcome, p_note: note.trim() || null, p_force: force })
      if (error) throw error
      setCloseOpen(false); refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const reopen = async () => {
    const { error } = await supabase.rpc('reopen_deal', { p_project: d.id })
    if (error) fail(error); else refresh()
  }

  const offerGroups = Object.values((offers.data ?? []).reduce<Record<string, Offer[]>>((a, o) => { (a[o.request_line_id] ??= []).push(o); return a }, {}))
  const hasOffers = (offers.data ?? []).some((o) => o.offer_line_id)
  const stageIdx = STAGES.indexOf(d.stage)

  return (
    <Stack maw={1100}>
      <Anchor size="sm" onClick={() => navigate('/deals')}>← {t('deal.title')}</Anchor>
      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Title order={3}>{d.name_en}</Title>
          <Text c="dimmed" size="sm">{d.code} · {d.customer_name ?? ''}</Text>
        </Stack>
        <Badge size="lg" color={STAGE_COLOR[d.stage] ?? 'gray'} variant="light">{t(`deal.stages.${d.stage}`)}</Badge>
      </Group>

      {/* Where the deal stands */}
      {!closed && (
        <Group gap={4} wrap="wrap">
          {STAGES.filter((s) => s !== 'new').map((s, i) => (
            <Badge key={s} variant={STAGES.indexOf(s) <= stageIdx ? 'filled' : 'outline'} color={STAGES.indexOf(s) <= stageIdx ? 'navy' : 'gray'} size="sm">
              {i + 1}. {t(`deal.stages.${s}`)}
            </Badge>
          ))}
        </Group>
      )}
      {closed && <Alert color={d.deal_outcome === 'won' ? 'green' : 'red'}>{t('deal.closedOn', { date: d.closed_on, outcome: t(`deal.stages.${d.deal_outcome ?? 'closed'}`) })}</Alert>}

      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        {([['orderedUsd', d.ordered_usd], ['invoicedUsd', d.invoiced_usd], ['receivableUsd', d.receivable_usd], ['billedUsd', d.billed_usd], ['payableUsd', d.payable_usd]] as const).map(([k, v]) => (
          <Card key={k} withBorder p="sm"><Text size="xs" c="dimmed">{t(`deal.${k}`)}</Text><Text fw={700}><bdi>{usd(v)}</bdi></Text></Card>
        ))}
      </SimpleGrid>
      {pl.data && (Number(pl.data.revenue) > 0 || Number(pl.data.cost_of_sales) > 0) && (
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Card withBorder p="sm"><Text size="xs" c="dimmed">{t('deal.revenue')}</Text><Text fw={700}><bdi>{usd(pl.data.revenue)}</bdi></Text></Card>
          <Card withBorder p="sm"><Text size="xs" c="dimmed">{t('deal.costs')}</Text><Text fw={700}><bdi>{usd(Number(pl.data.cost_of_sales) + Number(pl.data.operating_expenses))}</bdi></Text></Card>
          <Card withBorder p="sm"><Text size="xs" c="dimmed">{t('deal.profit')}</Text>
            <Text fw={700} c={Number(pl.data.margin) < 0 ? 'red' : 'green'}><bdi>{usd(pl.data.margin)}</bdi></Text></Card>
          <Card withBorder p="sm"><Text size="xs" c="dimmed">{t('deal.profitPct')}</Text><Text fw={700}>{pl.data.margin_pct ?? '—'}%</Text></Card>
        </SimpleGrid>
      )}

      {!closed && can('docs.create') && (
        <Group gap="xs">
          <Button size="sm" leftSection={<IconPlus size={14} />} onClick={() => newDoc('customer_request', d.customer_id)}>{t('deal.add.customer_request')}</Button>
          <Menu position="bottom-start">
            <Menu.Target><Button size="sm" variant="light" rightSection={<IconChevronDown size={14} />}>{t('deal.addOther')}</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => newDoc('quotation', d.customer_id)}>{t('deal.add.quotation')}</Menu.Item>
              <Menu.Item onClick={() => newDoc('sales_order', d.customer_id)}>{t('deal.add.sales_order')}</Menu.Item>
              <Menu.Item onClick={() => newDoc('supplier_rfq')}>{t('deal.add.supplier_rfq')}</Menu.Item>
              <Menu.Item onClick={() => newDoc('purchase_order')}>{t('deal.add.purchase_order')}</Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => newDoc('expense')}>{t('deal.add.expense')}</Menu.Item>
              <Menu.Item onClick={() => newDoc('supplier_bill')}>{t('deal.add.supplier_bill')}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Text size="xs" c="dimmed">{t('deal.nextHelp')}</Text>
        </Group>
      )}

      {/* All documents of the deal */}
      <Card withBorder>
        <Text fw={600} mb="xs">{t('deal.documents')}</Text>
        <ScrollArea type="auto">
          <Table fz="sm" verticalSpacing={4} highlightOnHover miw={700}>
            <Table.Thead><Table.Tr>
              <Table.Th>{t('deal.docType')}</Table.Th><Table.Th>{t('deal.number')}</Table.Th><Table.Th>{t('doc.party')}</Table.Th>
              <Table.Th>{t('doc.date')}</Table.Th><Table.Th ta="end">{t('doc.amount')}</Table.Th><Table.Th>{t('deal.status')}</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {sortedDocs.map((x) => {
                const ki = kindInfo(x.kind)
                return (
                  <Table.Tr key={x.id} style={{ cursor: 'pointer', opacity: x.status === 'void' ? 0.5 : 1 }} onClick={() => navigate(`/entries/${x.id}`)}>
                    <Table.Td>{ki ? localName(ki, lang) : x.kind}</Table.Td>
                    <Table.Td>{x.number ?? x.temp_number}{x.revision > 0 ? ` Rev.${x.revision}` : ''}</Table.Td>
                    <Table.Td>{partyName(x.party_id)}</Table.Td>
                    <Table.Td>{x.doc_date}</Table.Td>
                    <Table.Td ta="end">{Number(x.amount) > 0 ? <bdi>{formatMoney(Number(x.amount), x.currency)}</bdi> : ''}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={{ draft: 'gray', submitted: 'yellow', posted: 'green', void: 'red' }[x.status]}>
                      {x.status === 'posted' && ki && !ki.creates_journal ? t('trade.issued') : t(`doc.${x.status}`)}</Badge></Table.Td>
                  </Table.Tr>
                )
              })}
              {!sortedDocs.length && <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed">{t('deal.noDocs')}</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      {/* Offers side by side */}
      {hasOffers && (
        <Card withBorder>
          <Text fw={600}>{t('deal.compare')}</Text>
          <Text size="xs" c="dimmed" mb="xs">{t('deal.compareHelp')}</Text>
          <ScrollArea type="auto">
            <Table fz="sm" verticalSpacing={4} miw={700}>
              <Table.Thead><Table.Tr>
                <Table.Th>{t('deal.requested')}</Table.Th><Table.Th>{t('doc.supplier')}</Table.Th>
                <Table.Th ta="end">{t('trade.unitPrice')}</Table.Th><Table.Th ta="end">USD</Table.Th><Table.Th>{t('deal.choose')}</Table.Th>
              </Table.Tr></Table.Thead>
              <Table.Tbody>
                {offerGroups.map((g) => g.map((o, i) => (
                  <Table.Tr key={`${o.request_line_id}-${o.offer_line_id ?? 'none'}`} bg={Number(o.rank_usd) === 1 ? 'var(--mantine-color-green-0)' : undefined}>
                    {i === 0 && <Table.Td rowSpan={g.length} style={{ verticalAlign: 'top' }}>{o.line_no}. {o.description} <Text span c="dimmed">({[q(o.qty), o.unit].filter(Boolean).join(' ')})</Text></Table.Td>}
                    {o.offer_line_id ? <>
                      <Table.Td>{o.supplier} <Text span size="xs" c="dimmed">{o.offer_number}{Number(o.offer_qty) !== Number(o.qty) ? ` · ${q(o.offer_qty ?? 0)} ${o.unit ?? ''}` : ''}</Text></Table.Td>
                      <Table.Td ta="end"><bdi>{formatMoney(Number(o.unit_price), o.currency ?? 'USD')}</bdi></Table.Td>
                      <Table.Td ta="end"><bdi>{usd(Number(o.unit_price_usd))}</bdi></Table.Td>
                      <Table.Td>
                        <Radio aria-label={`${o.supplier} ${o.description ?? ''}`} checked={choice[o.request_line_id] === o.offer_line_id}
                          onChange={() => setChoice((c) => ({ ...c, [o.request_line_id]: o.offer_line_id! }))} disabled={closed} />
                      </Table.Td>
                    </> : <Table.Td colSpan={4}><Text size="sm" c="dimmed">{t('deal.noOffer')}</Text></Table.Td>}
                  </Table.Tr>
                )))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {!closed && can('docs.create') && (
            <Group mt="sm" align="flex-end">
              <NumberInput w={140} label={t('deal.marginPct')} value={margin} onChange={(v) => setMargin(typeof v === 'number' ? v : '')} rightSection="%" min={0} decimalScale={2} />
              <Button loading={busy} disabled={!Object.keys(choice).length} onClick={() => void makeQuotation()}>{t('deal.makeQuotation')}</Button>
            </Group>
          )}
        </Card>
      )}

      {/* Progress of each ordered line */}
      {(progress.data ?? []).length > 0 && (
        <Card withBorder>
          <Text fw={600}>{t('deal.progress')}</Text>
          <Text size="xs" c="dimmed" mb="xs">{t('deal.progressHelp')}</Text>
          <ScrollArea type="auto">
            <Table fz="sm" verticalSpacing={4} miw={800}>
              <Table.Thead><Table.Tr>
                <Table.Th>{t('deal.order')}</Table.Th><Table.Th>{t('deal.line')}</Table.Th><Table.Th ta="end">{t('trade.qty')}</Table.Th>
                <Table.Th ta="end">{t('deal.purchased')}</Table.Th><Table.Th ta="end">{t('deal.received')}</Table.Th>
                <Table.Th ta="end">{t('deal.delivered')}</Table.Th><Table.Th ta="end">{t('deal.invoiced')}</Table.Th><Table.Th ta="end">{t('deal.billed')}</Table.Th>
              </Table.Tr></Table.Thead>
              <Table.Tbody>
                {(progress.data ?? []).map((p) => {
                  const cell = (v: number, applies: boolean) => (
                    <Table.Td ta="end" c={!applies ? 'dimmed' : Number(v) >= Number(p.qty) ? 'green' : Number(v) > 0 ? 'orange' : 'red'}>{applies ? q(v) : '—'}</Table.Td>
                  )
                  const so = p.kind === 'sales_order'
                  return (
                    <Table.Tr key={p.line_id}>
                      <Table.Td><Anchor size="sm" onClick={() => navigate(`/entries/${p.document_id}`)}>{p.number}</Anchor> <Text span size="xs" c="dimmed">{so ? t('deal.customerOrder') : partyName(p.party_id)}</Text></Table.Td>
                      <Table.Td>{p.line_no}. {p.description}</Table.Td>
                      <Table.Td ta="end">{q(p.qty)} {p.unit ?? ''}</Table.Td>
                      {cell(p.purchased, so)}{cell(p.received, !so)}{cell(p.delivered, so)}{cell(p.invoiced, so)}{cell(p.billed, !so)}
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      {/* Closing */}
      <Card withBorder>
        <Group justify="space-between">
          <Text fw={600}>{t('deal.closeTitle')}</Text>
          {can('docs.post') && (closed
            ? <Button variant="light" onClick={() => void reopen()}>{t('deal.reopen')}</Button>
            : <Button variant="light" onClick={() => { setOutcome('won'); setNote(''); setForce(false); setCloseOpen(true) }}>{t('deal.close')}</Button>)}
        </Group>
        {!closed && ((openItems.data ?? []).length
          ? <Stack gap={2} mt="xs">{(openItems.data ?? []).map((o) => <Text key={o.problem} size="sm" c="orange">• {o.problem}</Text>)}</Stack>
          : ['invoiced', 'paid'].includes(d.stage)
            ? <Text size="sm" c="green" mt="xs">{t('deal.readyToClose')}</Text>
            : <Text size="sm" c="dimmed" mt="xs">{t('deal.noOrderYet')}</Text>)}
      </Card>

      <Modal opened={closeOpen} onClose={() => setCloseOpen(false)} title={t('deal.close')}>
        <Stack>
          <SegmentedControl value={outcome} onChange={(v) => setOutcome(v as typeof outcome)}
            data={[{ value: 'won', label: t('deal.stages.won') }, { value: 'lost', label: t('deal.stages.lost') }, { value: 'cancelled', label: t('deal.stages.cancelled') }]} />
          {outcome === 'won' && (openItems.data ?? []).length > 0 && (
            <Checkbox checked={force} onChange={(e) => setForce(e.currentTarget.checked)} label={t('deal.forceClose')} />
          )}
          <Textarea label={t('deal.closeNote')} value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2}
            required={force} placeholder={outcome === 'lost' ? t('deal.lostPh') : undefined} />
          <Button loading={busy} onClick={() => void closeDeal()} disabled={force && !note.trim()}>{t('deal.close')}</Button>
        </Stack>
      </Modal>
    </Stack>
  )
}
