import { Alert, Anchor, Badge, Button, Card, Checkbox, Group, NumberInput, Progress, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFileZip } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zipSync, strToU8 } from 'fflate'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useMoneyAccounts } from '../documents/data'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { downloadBlob, n2, toCsv } from './export'
import { ReportShell, thisYear } from './ReportShell'

const usd = (v: unknown) => (v === null || v === undefined ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function useRpc<T>(key: unknown[], fn: string, args: Record<string, unknown>, enabled = true) {
  const { company } = useAuth()
  return useQuery({
    queryKey: ['rpc', fn, company?.company_id, ...key],
    enabled: Boolean(company) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(fn, { p_company: company!.company_id, ...args })
      if (error) throw error
      return (data ?? []) as T[]
    },
  })
}

// ---------------------------------------------------------------------------------------------
export function ProjectPlPage() {
  const { t } = useTranslation()
  const [{ from, to }, setP] = useState(thisYear)
  const q = useRpc<{ project_id: string; code: string; name_en: string; status: string; revenue: number; cost_of_sales: number; operating_expenses: number; margin: number; margin_pct: number | null; budget_usd: number | null; budget_used_pct: number | null }>(
    [from, to], 'project_pl', { p_from: from, p_to: to })
  const rows = (q.data ?? []).filter((r) => r.revenue || r.cost_of_sales || r.operating_expenses || r.budget_usd)
  return (
    <ReportShell title={t('rep.prj.title')} period={`${from} – ${to}`}
      filters={<>
        <TextInput type="date" label={t('rep.from')} value={from} onChange={(e) => setP((p) => ({ ...p, from: e.currentTarget.value }))} />
        <TextInput type="date" label={t('rep.to')} value={to} onChange={(e) => setP((p) => ({ ...p, to: e.currentTarget.value }))} />
      </>}
      csv={() => ({ name: `project-pl-${from}-${to}`, header: ['Project', 'Name', 'Revenue', 'Cost of sales', 'Operating expenses', 'Margin', 'Margin %', 'Budget USD', 'Budget used %'],
        rows: rows.map((r) => [r.code, r.name_en, n2(r.revenue), n2(r.cost_of_sales), n2(r.operating_expenses), n2(r.margin), r.margin_pct, n2(r.budget_usd), r.budget_used_pct]) })}>
      <ScrollArea type="auto">
        <Table striped miw={900} verticalSpacing={4}>
          <Table.Thead><Table.Tr>
            <Table.Th>{t('doc.project')}</Table.Th><Table.Th ta="end">{t('rep.prj.revenue')}</Table.Th><Table.Th ta="end">{t('rep.prj.cos')}</Table.Th>
            <Table.Th ta="end">{t('rep.prj.opex')}</Table.Th><Table.Th ta="end">{t('rep.prj.margin')}</Table.Th><Table.Th ta="end">%</Table.Th><Table.Th w={200}>{t('rep.prj.budget')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.project_id}>
                <Table.Td>{r.code} · {r.name_en}</Table.Td>
                <Table.Td ta="end"><bdi>{usd(r.revenue)}</bdi></Table.Td><Table.Td ta="end"><bdi>{usd(r.cost_of_sales)}</bdi></Table.Td>
                <Table.Td ta="end"><bdi>{usd(r.operating_expenses)}</bdi></Table.Td>
                <Table.Td ta="end" fw={600} c={Number(r.margin) < 0 ? 'red' : undefined}><bdi>{usd(r.margin)}</bdi></Table.Td>
                <Table.Td ta="end">{r.margin_pct ?? ''}</Table.Td>
                <Table.Td>{r.budget_usd ? (
                  <Stack gap={2}>
                    <Progress value={Math.min(Number(r.budget_used_pct ?? 0), 100)} color={Number(r.budget_used_pct) > 100 ? 'red' : Number(r.budget_used_pct) > 80 ? 'orange' : 'green'} />
                    <Text size="xs" c="dimmed">{r.budget_used_pct ?? 0}% {t('rep.prj.of')} <bdi>{usd(r.budget_usd)}</bdi></Text>
                  </Stack>) : ''}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
export function PartyBalancesPage() {
  const { t, i18n } = useTranslation()
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const q = useRpc<{ party_id: string; party_code: string; party_name: string; account_code: string; account_name: string; currency: string; balance: number; balance_usd: number }>(
    [asOf], 'party_balances', { p_as_of: asOf })
  const rows = q.data ?? []
  return (
    <ReportShell title={t('rep.pb.title')} period={`${t('rep.asOf')} ${asOf}`}
      filters={<TextInput type="date" label={t('rep.asOf')} value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} />}
      csv={() => ({ name: `employee-owner-balances-${asOf}`, header: ['Party', 'Account', 'Currency', 'Balance', 'Balance USD'],
        rows: rows.map((r) => [`${r.party_name} (${r.party_code})`, `${r.account_code} ${r.account_name}`, r.currency, n2(r.balance), n2(r.balance_usd)]) })}>
      <Text size="xs" c="dimmed">{t('rep.pb.help')}</Text>
      <Table striped maw={860} verticalSpacing={4}>
        <Table.Thead><Table.Tr><Table.Th>{t('doc.party')}</Table.Th><Table.Th>{t('md.glAccount')}</Table.Th><Table.Th ta="end">{t('rep.balance')}</Table.Th><Table.Th ta="end">USD</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => (
            <Table.Tr key={i}>
              <Table.Td>{r.party_name} <Text span c="dimmed" size="xs">{r.party_code}</Text></Table.Td><Table.Td>{r.account_code} · {r.account_name}</Table.Td>
              <Table.Td ta="end" fw={600}><bdi>{formatMoney(r.balance, r.currency, i18n.language)}</bdi></Table.Td><Table.Td ta="end"><bdi>{usd(r.balance_usd)}</bdi></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {!q.isLoading && rows.length === 0 && <Text c="dimmed">{t('rep.nothingOpen')}</Text>}
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
interface BookRow { journal_line_id: number | null; entry_date: string; document_id: string | null; number: string | null; party_name: string | null; description: string | null; money_in: number | null; money_out: number | null; balance: number; cleared: boolean | null; is_opening: boolean }

export function BankBookPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { company, can } = useAuth()
  const accounts = useMoneyAccounts()
  const [account, setAccount] = useState<string | null>(null)
  const [{ from, to }, setP] = useState(thisYear)
  const [stmtDate, setStmtDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stmtBal, setStmtBal] = useState<number | ''>('')
  const acc = accounts.data?.find((a) => a.id === account)
  const book = useRpc<BookRow>([account, from, to], 'bank_book', { p_money_account: account, p_from: from, p_to: to }, Boolean(account))
  const rec = useQuery({
    queryKey: ['bankrec', account],
    enabled: Boolean(account),
    queryFn: async () => {
      const { data } = await supabase.from('bank_reconciliations').select('*').eq('money_account_id', account!).eq('status', 'open').order('created_at', { ascending: false })
      return ((data ?? [])[0] ?? null) as { id: string; statement_date: string; statement_balance: number } | null
    },
  })
  const rows = book.data ?? []
  const cleared = rows.filter((r) => r.cleared).reduce((a, r) => a + Number(r.money_in ?? 0) - Number(r.money_out ?? 0), 0)
  // Opening lines were cleared in earlier reconciliations when there are any; the difference shows what is left to tick.
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['rpc', 'bank_book'] }); void qc.invalidateQueries({ queryKey: ['bankrec'] }) }
  const err = (e: Error) => notifications.show({ color: 'red', message: e.message })

  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('bank_reconciliations').insert({ company_id: company!.company_id, money_account_id: account, statement_date: stmtDate, statement_balance: stmtBal })
      if (error) throw error
    }, onSuccess: refresh, onError: err,
  })
  const toggle = useMutation({
    mutationFn: async (r: BookRow) => {
      const { error } = r.cleared
        ? await supabase.from('bank_cleared_lines').delete().eq('journal_line_id', r.journal_line_id!)
        : await supabase.from('bank_cleared_lines').insert({ journal_line_id: r.journal_line_id, company_id: company!.company_id, reconciliation_id: rec.data!.id })
      if (error) throw error
    }, onSuccess: refresh, onError: err,
  })
  const close = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('close_bank_reconciliation', { p_id: rec.data!.id })
      if (error) throw error
    }, onSuccess: () => { notifications.show({ color: 'green', message: t('rep.bb.closed') }); refresh() }, onError: err,
  })
  const diff = rec.data ? Math.round((Number(rec.data.statement_balance) - cleared) * 100) / 100 : null

  return (
    <ReportShell title={t('rep.bb.title')} period={acc ? `${localName(acc, i18n.language)} · ${acc.currency} · ${from} – ${to}` : undefined}
      filters={<>
        <Select label={t('doc.account')} value={account} onChange={setAccount} w={260} data={(accounts.data ?? []).map((a) => ({ value: a.id, label: `${localName(a, i18n.language)} · ${a.currency}` }))} />
        <TextInput type="date" label={t('rep.from')} value={from} onChange={(e) => setP((p) => ({ ...p, from: e.currentTarget.value }))} />
        <TextInput type="date" label={t('rep.to')} value={to} onChange={(e) => setP((p) => ({ ...p, to: e.currentTarget.value }))} />
      </>}
      csv={() => ({ name: `bank-book-${acc?.code ?? ''}-${from}-${to}`, header: ['Date', 'Document', 'Party', 'Description', 'In', 'Out', 'Balance', 'Cleared'],
        rows: rows.map((r) => [r.entry_date, r.number, r.party_name, r.description, n2(r.money_in), n2(r.money_out), n2(r.balance), r.cleared ? 'yes' : '']) })}>
      {account && can('docs.post_money') && (
        <Card withBorder className="no-print">
          {rec.data ? (
            <Group justify="space-between" wrap="wrap">
              <Text size="sm">{t('rep.bb.reconciling')} {rec.data.statement_date}: <b><bdi>{formatMoney(rec.data.statement_balance, acc?.currency ?? 'USD')}</bdi></b> · {t('rep.bb.cleared')}: <bdi>{formatMoney(cleared, acc?.currency ?? 'USD')}</bdi></Text>
              <Badge color={diff === 0 ? 'green' : 'orange'} size="lg">{t('doc.difference')}: <bdi>{formatMoney(diff ?? 0, acc?.currency ?? 'USD')}</bdi></Badge>
              <Button size="xs" disabled={diff !== 0} loading={close.isPending} onClick={() => close.mutate()}>{t('rep.bb.finish')}</Button>
            </Group>
          ) : (
            <Group align="flex-end" wrap="wrap">
              <TextInput type="date" label={t('rep.bb.stmtDate')} value={stmtDate} onChange={(e) => setStmtDate(e.currentTarget.value)} />
              <NumberInput label={`${t('rep.bb.stmtBalance')} (${acc?.currency ?? ''})`} value={stmtBal} onChange={(v) => setStmtBal(typeof v === 'number' ? v : '')} decimalScale={2} thousandSeparator="," />
              <Button variant="light" disabled={stmtBal === ''} loading={start.isPending} onClick={() => start.mutate()}>{t('rep.bb.start')}</Button>
            </Group>
          )}
        </Card>
      )}
      {!account && <Text c="dimmed">{t('rep.bb.choose')}</Text>}
      <ScrollArea type="auto">
        <Table striped miw={860} verticalSpacing={2} fz="sm">
          <Table.Thead><Table.Tr>
            {rec.data && <Table.Th className="no-print">✓</Table.Th>}
            <Table.Th>{t('doc.date')}</Table.Th><Table.Th>{t('doc.number')}</Table.Th><Table.Th>{t('doc.party')}</Table.Th><Table.Th>{t('doc.description')}</Table.Th>
            <Table.Th ta="end">{t('rep.bb.in')}</Table.Th><Table.Th ta="end">{t('rep.bb.out')}</Table.Th><Table.Th ta="end">{t('rep.balance')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r, i) => (
              <Table.Tr key={i}>
                {rec.data && <Table.Td className="no-print">{!r.is_opening && <Checkbox size="xs" checked={Boolean(r.cleared)} onChange={() => toggle.mutate(r)} aria-label="cleared" />}</Table.Td>}
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.is_opening ? '' : r.entry_date}</Table.Td>
                <Table.Td>{r.document_id ? <Anchor size="sm" onClick={() => navigate(`/entries/${r.document_id}`)}>{r.number}</Anchor> : ''}{r.cleared && !rec.data ? ' ✓' : ''}</Table.Td>
                <Table.Td>{r.party_name}</Table.Td><Table.Td fs={r.is_opening ? 'italic' : undefined}>{r.description}</Table.Td>
                <Table.Td ta="end">{r.money_in ? <bdi>{formatMoney(r.money_in, acc?.currency ?? 'USD')}</bdi> : ''}</Table.Td>
                <Table.Td ta="end">{r.money_out ? <bdi>{formatMoney(r.money_out, acc?.currency ?? 'USD')}</bdi> : ''}</Table.Td>
                <Table.Td ta="end" fw={600}><bdi>{formatMoney(r.balance, acc?.currency ?? 'USD')}</bdi></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
export function AssetsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { company, can } = useAuth()
  const navigate = useNavigate()
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const now = new Date()
  const [ym, setYm] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const q = useRpc<{ asset_id: string; code: string; name_en: string; account_code: string; acquisition_date: string; cost_usd: number; life_months: number; monthly_charge: number; accumulated: number; net_book_value: number; status: string }>(
    [asOf], 'asset_register', { p_as_of: asOf })
  const rows = q.data ?? []
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('run_depreciation', { p_company: company!.company_id, p_year: Number(ym.slice(0, 4)), p_month: Number(ym.slice(5, 7)) })
      if (error) throw error
      return data as string
    },
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['rpc', 'asset_register'] }); navigate(`/entries/${id}`) },
    onError: (e: Error) => notifications.show({ color: 'red', message: e.message }),
  })
  const tot = (k: 'cost_usd' | 'accumulated' | 'net_book_value') => rows.reduce((a, r) => a + Number(r[k]), 0)
  return (
    <ReportShell title={t('rep.fa.title')} period={`${t('rep.asOf')} ${asOf}`}
      filters={<>
        <TextInput type="date" label={t('rep.asOf')} value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} />
        {can('journal.manual') && (
          <Group align="flex-end" gap="xs">
            <TextInput type="month" label={t('rep.fa.month')} value={ym} onChange={(e) => setYm(e.currentTarget.value)} />
            <Button variant="light" loading={run.isPending} onClick={() => run.mutate()}>{t('rep.fa.run')}</Button>
          </Group>
        )}
      </>}
      csv={() => ({ name: `fixed-assets-${asOf}`, header: ['Code', 'Asset', 'Account', 'Acquired', 'Cost USD', 'Life (months)', 'Monthly charge', 'Accumulated', 'Net book value', 'Status'],
        rows: rows.map((r) => [r.code, r.name_en, r.account_code, r.acquisition_date, n2(r.cost_usd), r.life_months, n2(r.monthly_charge), n2(r.accumulated), n2(r.net_book_value), r.status]) })}>
      <Text size="xs" c="dimmed">{t('rep.fa.help')}</Text>
      <ScrollArea type="auto">
        <Table striped miw={880} verticalSpacing={4}>
          <Table.Thead><Table.Tr>
            <Table.Th>{t('common.code')}</Table.Th><Table.Th>{t('rep.fa.asset')}</Table.Th><Table.Th>{t('rep.fa.acquired')}</Table.Th><Table.Th ta="end">{t('rep.fa.cost')}</Table.Th>
            <Table.Th ta="end">{t('rep.fa.life')}</Table.Th><Table.Th ta="end">{t('rep.fa.monthly')}</Table.Th><Table.Th ta="end">{t('rep.fa.accumulated')}</Table.Th><Table.Th ta="end">{t('rep.fa.nbv')}</Table.Th><Table.Th>{t('md.status')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.asset_id}>
                <Table.Td>{r.code}</Table.Td><Table.Td>{r.name_en} <Text span size="xs" c="dimmed">{r.account_code}</Text></Table.Td><Table.Td>{r.acquisition_date}</Table.Td>
                <Table.Td ta="end"><bdi>{usd(r.cost_usd)}</bdi></Table.Td><Table.Td ta="end">{r.life_months}</Table.Td><Table.Td ta="end"><bdi>{usd(r.monthly_charge)}</bdi></Table.Td>
                <Table.Td ta="end"><bdi>{usd(r.accumulated)}</bdi></Table.Td><Table.Td ta="end" fw={600}><bdi>{usd(r.net_book_value)}</bdi></Table.Td>
                <Table.Td><Badge variant="light" color={r.status === 'active' ? 'green' : 'gray'}>{r.status}</Badge></Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr bg="var(--mantine-color-gold-1)"><Table.Td colSpan={3} fw={800}>{t('rep.total')}</Table.Td><Table.Td ta="end" fw={800}><bdi>{usd(tot('cost_usd'))}</bdi></Table.Td><Table.Td colSpan={2} /><Table.Td ta="end" fw={800}><bdi>{usd(tot('accumulated'))}</bdi></Table.Td><Table.Td ta="end" fw={800}><bdi>{usd(tot('net_book_value'))}</bdi></Table.Td><Table.Td /></Table.Tr>
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
/** Audit pack: trial balance, general ledger, document list and file manifest (with the files) in one ZIP. */
export function AuditPackPage() {
  const { t } = useTranslation()
  const { company } = useAuth()
  const [{ from, to }, setP] = useState(thisYear)
  const [withFiles, setWithFiles] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const build = async () => {
    const cid = company!.company_id
    try {
      setBusy(t('rep.ap.step.tb')); setDone(null)
      const tb = await supabase.rpc('trial_balance', { p_company: cid, p_from: from, p_to: to })
      const all = await supabase.from('gl_accounts').select('id').eq('company_id', cid).eq('is_postable', true)
      setBusy(t('rep.ap.step.gl'))
      const gl: Record<string, unknown>[] = []
      for (const a of (all.data ?? []) as { id: string }[]) {
        const r = await supabase.rpc('general_ledger', { p_company: cid, p_from: from, p_to: to, p_account: a.id, p_project: null, p_party: null })
        gl.push(...((r.data ?? []) as Record<string, unknown>[]))
      }
      setBusy(t('rep.ap.step.docs'))
      const docs = await supabase.from('documents').select('id, kind, status, number, revision, doc_date, party_id, currency, rate, amount, fee_amount, reference_no, description, void_reason, posted_at, legacy_id')
        .eq('company_id', cid).gte('doc_date', from).lte('doc_date', to).in('status', ['posted', 'void']).order('doc_date')
      const docRows = (docs.data ?? []) as Record<string, unknown>[]
      const ids = docRows.map((d) => d.id as string)
      const files: Record<string, unknown>[] = []
      for (let i = 0; i < ids.length; i += 100) {
        const r = await supabase.from('attachments').select('document_id, file_name, storage_path, mime_type, size_bytes, sha256, kind, uploaded_at').in('document_id', ids.slice(i, i + 100))
        files.push(...((r.data ?? []) as Record<string, unknown>[]))
      }
      const number = Object.fromEntries(docRows.map((d) => [d.id, d.number]))
      const zip: Record<string, Uint8Array> = {
        'README.txt': strToU8(`EnvironmSafe audit pack\nCompany: ${company!.name_en}\nPeriod: ${from} to ${to}\nCreated: ${new Date().toISOString()}\n\nAmounts in USD unless a currency column says otherwise.\nfiles/ holds each attachment named <document number>/<file name>; attachments.csv gives its SHA-256 so you can check it was not altered.\n`),
        'trial_balance.csv': strToU8(toCsv(['Code', 'Account', 'Opening', 'Debit', 'Credit', 'Closing'],
          ((tb.data ?? []) as Record<string, unknown>[]).map((r) => [r.code as string, r.name_en as string, n2(r.opening), n2(r.debit), n2(r.credit), n2(r.closing)]))),
        'general_ledger.csv': strToU8(toCsv(['Account', 'Date', 'Document', 'Description', 'Project', 'Party', 'Currency', 'Original amount', 'Debit', 'Credit', 'Balance'],
          gl.map((r) => [`${r.account_code} ${r.account_name}`, r.entry_date as string, r.number as string, r.description as string, r.project_code as string, r.party_name as string, r.txn_currency as string, n2(r.txn_amount), n2(r.debit), n2(r.credit), n2(r.balance)]))),
        'documents.csv': strToU8(toCsv(['Number', 'Revision', 'Type', 'Status', 'Date', 'Currency', 'Rate', 'Amount', 'Fee', 'Reference', 'Description', 'Void reason', 'Posted at', 'Old ID'],
          docRows.map((d) => [d.number as string, d.revision as number, d.kind as string, d.status as string, d.doc_date as string, d.currency as string, d.rate as number, n2(d.amount), n2(d.fee_amount), d.reference_no as string, d.description as string, d.void_reason as string, d.posted_at as string, d.legacy_id as string]))),
        'attachments.csv': strToU8(toCsv(['Document', 'File', 'Kind', 'Type', 'Bytes', 'SHA-256', 'Uploaded', 'Storage path'],
          files.map((f) => [number[f.document_id as string] as string, f.file_name as string, f.kind as string, f.mime_type as string, f.size_bytes as number, f.sha256 as string, f.uploaded_at as string, f.storage_path as string]))),
      }
      let missing = 0
      if (withFiles) {
        for (let i = 0; i < files.length; i++) {
          setBusy(`${t('rep.ap.step.files')} ${i + 1}/${files.length}`)
          const f = files[i]
          const dl = await supabase.storage.from('documents').download(f.storage_path as string)
          if (dl.error || !dl.data) { missing++; continue }
          zip[`files/${number[f.document_id as string] ?? 'unnumbered'}/${f.file_name as string}`] = new Uint8Array(await dl.data.arrayBuffer())
        }
      }
      const blob = new Blob([zipSync(zip, { level: 6 }) as BlobPart], { type: 'application/zip' })
      downloadBlob(`audit-pack-${from}-${to}.zip`, blob)
      setDone(t('rep.ap.done', { docs: docRows.length, files: files.length - missing, missing }))
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message })
    } finally { setBusy(null) }
  }

  return (
    <ReportShell title={t('rep.ap.title')} period={`${from} – ${to}`}
      filters={<>
        <TextInput type="date" label={t('rep.from')} value={from} onChange={(e) => setP((p) => ({ ...p, from: e.currentTarget.value }))} />
        <TextInput type="date" label={t('rep.to')} value={to} onChange={(e) => setP((p) => ({ ...p, to: e.currentTarget.value }))} />
        <Checkbox label={t('rep.ap.withFiles')} checked={withFiles} onChange={(e) => setWithFiles(e.currentTarget.checked)} mb={8} />
      </>}>
      <Text size="sm">{t('rep.ap.help')}</Text>
      <Group><Button leftSection={<IconFileZip size={18} />} loading={Boolean(busy)} onClick={() => void build()}>{t('rep.ap.build')}</Button>{busy && <Text size="sm" c="dimmed">{busy}</Text>}</Group>
      {done && <Alert color="green">{done}</Alert>}
    </ReportShell>
  )
}
