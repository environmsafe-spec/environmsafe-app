import { Alert, Anchor, Badge, Checkbox, ScrollArea, Select, SegmentedControl, Table, Text, TextInput } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useGlAccounts, useParties, useProjects } from '../documents/data'
import { localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import { n2 } from './export'
import { ReportShell, thisYear } from './ReportShell'
import { groupStatement, ifrsLabel, type PlRow } from './statements'

const usd = (v: unknown) => (v === null || v === undefined ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const num = (v: unknown) => <bdi>{usd(v)}</bdi>
const neg = (v: number) => (v < 0 ? `(${usd(-v)})` : usd(v))   // accountants' brackets for negatives

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

function Period({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { t } = useTranslation()
  return (
    <>
      <TextInput type="date" label={t('rep.from')} value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
      <TextInput type="date" label={t('rep.to')} value={to} onChange={(e) => setTo(e.currentTarget.value)} />
    </>
  )
}

const lastYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`

// ---------------------------------------------------------------------------------------------
export function ProfitLossPage() {
  const { t, i18n } = useTranslation()
  const [{ from, to }, setP] = useState(thisYear)
  const [cmp, setCmp] = useState(true)
  const [view, setView] = useState<'period' | 'monthly'>('period')
  const [project, setProject] = useState<string | null>(null)
  const projects = useProjects()
  const pl = useRpc<PlRow & { account_id: string }>([from, to, cmp, project], 'profit_and_loss',
    { p_from: from, p_to: to, p_cmp_from: cmp ? lastYear(from) : null, p_cmp_to: cmp ? lastYear(to) : null, p_project: project })
  const monthly = useRpc<{ code: string; name_en: string; name_ar: string | null; ifrs_line: string; month: string; amount: number }>(
    [from], 'profit_and_loss_monthly', { p_from: `${from.slice(0, 7)}-01` }, view === 'monthly')
  const g = groupStatement(pl.data ?? [])
  const lang = i18n.language
  const sectionTitle = { revenue: t('rep.pl.revenue'), cost_of_sales: t('rep.pl.cos'), operating: t('rep.pl.opex'), other: t('rep.pl.other') }

  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); return d.toISOString().slice(0, 7) })
  const accounts = [...new Map((monthly.data ?? []).map((r) => [r.code, r])).values()].sort((a, b) => a.code.localeCompare(b.code))
  const cell = (code: string, m: string) => (monthly.data ?? []).filter((r) => r.code === code && r.month.slice(0, 7) === m).reduce((a, r) => a + Number(r.amount), 0)

  return (
    <ReportShell title={t('rep.pl.title')} period={view === 'period' ? `${from} – ${to}` : `${months[0]} – ${months[11]}`}
      filters={<>
        <Period from={from} to={to} setFrom={(v) => setP((p) => ({ ...p, from: v }))} setTo={(v) => setP((p) => ({ ...p, to: v }))} />
        <Select label={t('doc.project')} clearable searchable value={project} onChange={setProject} w={220}
          data={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${localName(p, lang)}` }))} />
        <SegmentedControl value={view} onChange={(v) => setView(v as 'period' | 'monthly')} data={[{ value: 'period', label: t('rep.period') }, { value: 'monthly', label: t('rep.monthly') }]} />
        {view === 'period' && <Checkbox label={t('rep.compare')} checked={cmp} onChange={(e) => setCmp(e.currentTarget.checked)} mb={8} />}
      </>}
      csv={() => ({ name: `profit-and-loss-${from}-${to}`, header: ['Code', 'Account', 'Statement line', 'Amount USD', 'Comparative USD'],
        rows: (pl.data ?? []).map((r) => [r.code, r.name_en, ifrsLabel(r.ifrs_line, 'en'), n2(r.amount), n2(r.cmp_amount)]) })}>
      {pl.error && <Alert color="red">{(pl.error as Error).message}</Alert>}
      {view === 'period' ? (
        <Table maw={760} verticalSpacing={4}>
          <Table.Thead><Table.Tr><Table.Th /><Table.Th ta="end">{from.slice(0, 4) === to.slice(0, 4) ? to.slice(0, 4) : `${from} – ${to}`}</Table.Th>{cmp && <Table.Th ta="end">{lastYear(to).slice(0, 4)}</Table.Th>}</Table.Tr></Table.Thead>
          <Table.Tbody>
            {g.sections.map((s) => (
              <Fragment key={s.key}>
                <Table.Tr><Table.Td colSpan={3} fw={700} pt="md">{sectionTitle[s.key]}</Table.Td></Table.Tr>
                {s.rows.map((r) => (
                  <Table.Tr key={r.code}>
                    <Table.Td ps="lg">{r.code} · {localName(r, lang)}</Table.Td>
                    <Table.Td ta="end"><bdi>{neg(Number(r.amount))}</bdi></Table.Td>{cmp && <Table.Td ta="end"><bdi>{neg(Number(r.cmp_amount))}</bdi></Table.Td>}
                  </Table.Tr>
                ))}
                <Table.Tr><Table.Td fw={600}>{t('rep.total')} {sectionTitle[s.key].toLowerCase()}</Table.Td><Table.Td ta="end" fw={600}><bdi>{neg(s.amount)}</bdi></Table.Td>{cmp && <Table.Td ta="end" fw={600}><bdi>{neg(s.cmp)}</bdi></Table.Td>}</Table.Tr>
                {s.key === 'cost_of_sales' && <Table.Tr bg="var(--mantine-color-navy-0)"><Table.Td fw={700}>{t('rep.pl.gross')}</Table.Td><Table.Td ta="end" fw={700}><bdi>{neg(g.gross.amount)}</bdi></Table.Td>{cmp && <Table.Td ta="end" fw={700}><bdi>{neg(g.gross.cmp)}</bdi></Table.Td>}</Table.Tr>}
                {s.key === 'operating' && <Table.Tr bg="var(--mantine-color-navy-0)"><Table.Td fw={700}>{t('rep.pl.operating')}</Table.Td><Table.Td ta="end" fw={700}><bdi>{neg(g.operating.amount)}</bdi></Table.Td>{cmp && <Table.Td ta="end" fw={700}><bdi>{neg(g.operating.cmp)}</bdi></Table.Td>}</Table.Tr>}
              </Fragment>
            ))}
            <Table.Tr bg="var(--mantine-color-gold-1)"><Table.Td fw={800}>{t('rep.pl.profit')}</Table.Td><Table.Td ta="end" fw={800}><bdi>{neg(g.profit.amount)}</bdi></Table.Td>{cmp && <Table.Td ta="end" fw={800}><bdi>{neg(g.profit.cmp)}</bdi></Table.Td>}</Table.Tr>
          </Table.Tbody>
        </Table>
      ) : (
        <ScrollArea type="auto">
          <Table miw={1200} fz="xs" verticalSpacing={2} striped>
            <Table.Thead><Table.Tr><Table.Th>{t('md.glAccount')}</Table.Th>{months.map((m) => <Table.Th key={m} ta="end">{m}</Table.Th>)}<Table.Th ta="end">{t('doc.total')}</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {accounts.map((a) => (
                <Table.Tr key={a.code}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{a.code} · {localName(a, lang)}</Table.Td>
                  {months.map((m) => <Table.Td key={m} ta="end">{cell(a.code, m) ? neg(cell(a.code, m)) : ''}</Table.Td>)}
                  <Table.Td ta="end" fw={600}>{neg(months.reduce((s, m) => s + cell(a.code, m), 0))}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr bg="var(--mantine-color-gold-1)">
                <Table.Td fw={800}>{t('rep.pl.profit')}</Table.Td>
                {months.map((m) => <Table.Td key={m} ta="end" fw={700}>{neg(accounts.reduce((s, a) => s + cell(a.code, m), 0))}</Table.Td>)}
                <Table.Td ta="end" fw={800}>{neg(accounts.reduce((s, a) => s + months.reduce((x, m) => x + cell(a.code, m), 0), 0))}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
export function BalanceSheetPage() {
  const { t, i18n } = useTranslation()
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10))
  const bs = useRpc<{ section: string; ifrs_line: string; code: string | null; name_en: string; name_ar: string | null; balance: number }>([asOf], 'balance_sheet', { p_as_of: asOf })
  const rows = bs.data ?? []
  const total = (s: string) => rows.filter((r) => r.section === s).reduce((a, r) => a + Number(r.balance), 0)
  const diff = Math.round((total('assets') - total('liabilities') - total('equity')) * 100) / 100
  const block = (section: string, title: string) => {
    const lines = [...new Set(rows.filter((r) => r.section === section).map((r) => r.ifrs_line))]
    return (
      <Fragment key={section}>
        <Table.Tr><Table.Td colSpan={2} fw={800} pt="md">{title}</Table.Td></Table.Tr>
        {lines.map((line) => {
          const rs = rows.filter((r) => r.section === section && r.ifrs_line === line)
          return (
            <Fragment key={line}>
              <Table.Tr><Table.Td fw={600} ps="md">{ifrsLabel(line, i18n.language)}</Table.Td><Table.Td ta="end" fw={600}>{num(rs.reduce((a, r) => a + Number(r.balance), 0))}</Table.Td></Table.Tr>
              {rs.length > 1 && rs.map((r, i) => <Table.Tr key={i}><Table.Td ps="xl" c="dimmed" fz="sm">{r.code ? `${r.code} · ` : ''}{localName(r, i18n.language)}</Table.Td><Table.Td ta="end" c="dimmed" fz="sm">{num(r.balance)}</Table.Td></Table.Tr>)}
            </Fragment>
          )
        })}
        <Table.Tr bg="var(--mantine-color-navy-0)"><Table.Td fw={700}>{t('rep.total')} {title.toLowerCase()}</Table.Td><Table.Td ta="end" fw={700}>{num(total(section))}</Table.Td></Table.Tr>
      </Fragment>
    )
  }
  return (
    <ReportShell title={t('rep.bs.title')} period={`${t('rep.asOf')} ${asOf}`}
      filters={<TextInput type="date" label={t('rep.asOf')} value={asOf} onChange={(e) => setAsOf(e.currentTarget.value)} />}
      csv={() => ({ name: `balance-sheet-${asOf}`, header: ['Section', 'Statement line', 'Code', 'Account', 'Balance USD'],
        rows: rows.map((r) => [r.section, ifrsLabel(r.ifrs_line, 'en'), r.code, r.name_en, n2(r.balance)]) })}>
      <Badge color={diff === 0 ? 'green' : 'red'} size="lg" className="no-print">{diff === 0 ? t('rep.bs.balanced') : `${t('rep.bs.difference')}: ${usd(diff)}`}</Badge>
      <Table maw={680} verticalSpacing={4}>
        <Table.Tbody>
          {block('assets', t('rep.bs.assets'))}
          {block('liabilities', t('rep.bs.liabilities'))}
          {block('equity', t('rep.bs.equity'))}
          <Table.Tr bg="var(--mantine-color-gold-1)"><Table.Td fw={800}>{t('rep.bs.liabEquity')}</Table.Td><Table.Td ta="end" fw={800}>{num(total('liabilities') + total('equity'))}</Table.Td></Table.Tr>
        </Table.Tbody>
      </Table>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
export function CashFlowPage() {
  const { t } = useTranslation()
  const [{ from, to }, setP] = useState(thisYear)
  const cf = useRpc<{ activity: string; category: string; amount: number }>([from, to], 'cash_flow', { p_from: from, p_to: to })
  const rows = cf.data ?? []
  const acts = [['operating', t('rep.cf.operating')], ['investing', t('rep.cf.investing')], ['financing', t('rep.cf.financing')]] as const
  const sum = (a: string) => rows.filter((r) => r.activity === a).reduce((s, r) => s + Number(r.amount), 0)
  const opening = rows.find((r) => r.activity === 'opening')?.amount ?? 0
  const closing = rows.find((r) => r.activity === 'closing')?.amount ?? 0
  const net = sum('operating') + sum('investing') + sum('financing')
  return (
    <ReportShell title={t('rep.cf.title')} period={`${from} – ${to}`}
      filters={<Period from={from} to={to} setFrom={(v) => setP((p) => ({ ...p, from: v }))} setTo={(v) => setP((p) => ({ ...p, to: v }))} />}
      csv={() => ({ name: `cash-flow-${from}-${to}`, header: ['Activity', 'Line', 'Amount USD'], rows: rows.map((r) => [r.activity, r.category, n2(r.amount)]) })}>
      <Text size="xs" c="dimmed">{t('rep.cf.help')}</Text>
      <Table maw={680} verticalSpacing={4}>
        <Table.Tbody>
          {acts.map(([a, title]) => (
            <Fragment key={a}>
              <Table.Tr><Table.Td colSpan={2} fw={700} pt="md">{title}</Table.Td></Table.Tr>
              {rows.filter((r) => r.activity === a).map((r) => <Table.Tr key={r.category}><Table.Td ps="lg">{t(`rep.cfl.${r.category}`, { defaultValue: r.category })}</Table.Td><Table.Td ta="end"><bdi>{neg(Number(r.amount))}</bdi></Table.Td></Table.Tr>)}
              <Table.Tr bg="var(--mantine-color-navy-0)"><Table.Td fw={600}>{t('rep.cf.net')} {title.toLowerCase()}</Table.Td><Table.Td ta="end" fw={600}><bdi>{neg(sum(a))}</bdi></Table.Td></Table.Tr>
            </Fragment>
          ))}
          <Table.Tr><Table.Td fw={700} pt="md">{t('rep.cf.change')}</Table.Td><Table.Td ta="end" fw={700}><bdi>{neg(net)}</bdi></Table.Td></Table.Tr>
          <Table.Tr><Table.Td>{t('rep.cf.opening')}</Table.Td><Table.Td ta="end"><bdi>{neg(Number(opening))}</bdi></Table.Td></Table.Tr>
          <Table.Tr bg="var(--mantine-color-gold-1)"><Table.Td fw={800}>{t('rep.cf.closing')}</Table.Td><Table.Td ta="end" fw={800}><bdi>{neg(Number(closing))}</bdi></Table.Td></Table.Tr>
        </Table.Tbody>
      </Table>
      <Badge color={Math.abs(Number(opening) + net - Number(closing)) < 0.005 ? 'green' : 'red'} className="no-print">
        {Math.abs(Number(opening) + net - Number(closing)) < 0.005 ? t('rep.cf.ties') : t('rep.cf.noTie')}
      </Badge>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
export function EquityPage() {
  const { t } = useTranslation()
  const [{ from, to }, setP] = useState(thisYear)
  const eq = useRpc<{ component: string; opening: number; profit: number; drawings: number; other: number; closing: number }>([from, to], 'changes_in_equity', { p_from: from, p_to: to })
  const rows = eq.data ?? []
  const cols = ['opening', 'profit', 'drawings', 'other', 'closing'] as const
  return (
    <ReportShell title={t('rep.eq.title')} period={`${from} – ${to}`}
      filters={<Period from={from} to={to} setFrom={(v) => setP((p) => ({ ...p, from: v }))} setTo={(v) => setP((p) => ({ ...p, to: v }))} />}
      csv={() => ({ name: `changes-in-equity-${from}-${to}`, header: ['Component', ...cols], rows: rows.map((r) => [r.component, ...cols.map((c) => n2(r[c]))]) })}>
      <ScrollArea type="auto">
        <Table miw={640} verticalSpacing={4}>
          <Table.Thead><Table.Tr><Table.Th />{cols.map((c) => <Table.Th key={c} ta="end">{t(`rep.eq.${c}`)}</Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r) => <Table.Tr key={r.component}><Table.Td>{t(`rep.eqc.${r.component}`, { defaultValue: r.component })}</Table.Td>{cols.map((c) => <Table.Td key={c} ta="end"><bdi>{neg(Number(r[c]))}</bdi></Table.Td>)}</Table.Tr>)}
            <Table.Tr bg="var(--mantine-color-gold-1)"><Table.Td fw={800}>{t('rep.total')}</Table.Td>{cols.map((c) => <Table.Td key={c} ta="end" fw={800}><bdi>{neg(rows.reduce((a, r) => a + Number(r[c]), 0))}</bdi></Table.Td>)}</Table.Tr>
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
export function TrialBalancePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [{ from, to }, setP] = useState(thisYear)
  const tb = useRpc<{ account_id: string; code: string; name_en: string; name_ar: string | null; opening: number; debit: number; credit: number; closing: number }>([from, to], 'trial_balance', { p_from: from, p_to: to })
  const rows = tb.data ?? []
  const tot = (k: 'opening' | 'debit' | 'credit' | 'closing') => rows.reduce((a, r) => a + Number(r[k]), 0)
  return (
    <ReportShell title={t('rep.tb.title')} period={`${from} – ${to}`}
      filters={<Period from={from} to={to} setFrom={(v) => setP((p) => ({ ...p, from: v }))} setTo={(v) => setP((p) => ({ ...p, to: v }))} />}
      csv={() => ({ name: `trial-balance-${from}-${to}`, header: ['Code', 'Account', 'Opening', 'Debit', 'Credit', 'Closing'],
        rows: rows.map((r) => [r.code, r.name_en, n2(r.opening), n2(r.debit), n2(r.credit), n2(r.closing)]) })}>
      <Badge color={Math.abs(tot('debit') - tot('credit')) < 0.005 ? 'green' : 'red'} size="lg" className="no-print">
        {Math.abs(tot('debit') - tot('credit')) < 0.005 ? t('rep.tb.balanced') : t('rep.tb.unbalanced')}
      </Badge>
      <ScrollArea type="auto">
        <Table striped highlightOnHover miw={720} verticalSpacing={4}>
          <Table.Thead><Table.Tr><Table.Th>{t('md.glAccount')}</Table.Th><Table.Th ta="end">{t('rep.opening')}</Table.Th><Table.Th ta="end">{t('doc.debit')}</Table.Th><Table.Th ta="end">{t('doc.credit')}</Table.Th><Table.Th ta="end">{t('rep.closing')}</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.account_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/reports/gl?account=${r.account_id}&from=${from}&to=${to}`)}>
                <Table.Td>{r.code} · {localName(r, i18n.language)}</Table.Td>
                <Table.Td ta="end">{num(r.opening)}</Table.Td><Table.Td ta="end">{num(r.debit)}</Table.Td><Table.Td ta="end">{num(r.credit)}</Table.Td><Table.Td ta="end" fw={600}>{num(r.closing)}</Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr bg="var(--mantine-color-gold-1)"><Table.Td fw={800}>{t('rep.total')}</Table.Td><Table.Td ta="end" fw={800}>{num(tot('opening'))}</Table.Td><Table.Td ta="end" fw={800}>{num(tot('debit'))}</Table.Td><Table.Td ta="end" fw={800}>{num(tot('credit'))}</Table.Td><Table.Td ta="end" fw={800}>{num(tot('closing'))}</Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------------------------
interface GlRow { account_id: string; account_code: string; account_name: string; entry_date: string; document_id: string | null; number: string | null; description: string | null; project_code: string | null; party_name: string | null; txn_currency: string | null; txn_amount: number | null; debit: number | null; credit: number | null; balance: number; is_opening: boolean }

export function GeneralLedgerPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const y = thisYear()
  const [from, setFrom] = useState(params.get('from') ?? y.from)
  const [to, setTo] = useState(params.get('to') ?? y.to)
  const [account, setAccount] = useState<string | null>(params.get('account'))
  const [project, setProject] = useState<string | null>(null)
  const [party, setParty] = useState<string | null>(null)
  const gl = useGlAccounts()
  const projects = useProjects()
  const parties = useParties()
  const q = useRpc<GlRow>([from, to, account, project, party], 'general_ledger',
    { p_from: from, p_to: to, p_account: account, p_project: project, p_party: party }, Boolean(account || project || party))
  const rows = q.data ?? []
  const groups = [...new Set(rows.map((r) => r.account_id))]
  return (
    <ReportShell title={t('rep.gl.title')} period={`${from} – ${to}`}
      filters={<>
        <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <Select label={t('md.glAccount')} searchable clearable value={account} onChange={setAccount} w={260}
          data={(gl.data ?? []).filter((a) => a.is_postable).map((a) => ({ value: a.id, label: `${a.code} · ${localName(a, i18n.language)}` }))} />
        <Select label={t('doc.project')} searchable clearable value={project} onChange={setProject} w={200}
          data={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${localName(p, i18n.language)}` }))} />
        <Select label={t('doc.party')} searchable clearable value={party} onChange={setParty} w={220}
          data={(parties.data ?? []).map((p) => ({ value: p.id, label: `${localName(p, i18n.language)} · ${p.code}` }))} />
      </>}
      csv={() => ({ name: `general-ledger-${from}-${to}`, header: ['Account', 'Date', 'Document', 'Description', 'Project', 'Party', 'Currency', 'Original amount', 'Debit USD', 'Credit USD', 'Balance USD'],
        rows: rows.map((r) => [`${r.account_code} ${r.account_name}`, r.entry_date, r.number, r.description, r.project_code, r.party_name, r.txn_currency, n2(r.txn_amount), n2(r.debit), n2(r.credit), n2(r.balance)]) })}>
      {!(account || project || party) && <Text c="dimmed">{t('rep.gl.choose')}</Text>}
      <ScrollArea type="auto">
        <Table miw={980} verticalSpacing={2} fz="sm">
          <Table.Thead><Table.Tr>
            <Table.Th>{t('doc.date')}</Table.Th><Table.Th>{t('doc.number')}</Table.Th><Table.Th>{t('doc.description')}</Table.Th><Table.Th>{t('doc.project')}</Table.Th>
            <Table.Th>{t('doc.party')}</Table.Th><Table.Th ta="end">{t('doc.amount')}</Table.Th><Table.Th ta="end">{t('doc.debit')}</Table.Th><Table.Th ta="end">{t('doc.credit')}</Table.Th><Table.Th ta="end">{t('rep.balance')}</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {groups.map((g) => {
              const rs = rows.filter((r) => r.account_id === g)
              return (
                <Fragment key={g}>
                  <Table.Tr bg="var(--mantine-color-navy-0)"><Table.Td colSpan={9} fw={700}>{rs[0].account_code} · {rs[0].account_name}</Table.Td></Table.Tr>
                  {rs.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.is_opening ? '' : r.entry_date}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.document_id ? <Anchor size="sm" onClick={() => navigate(`/entries/${r.document_id}`)}>{r.number}</Anchor> : ''}</Table.Td>
                      <Table.Td fs={r.is_opening ? 'italic' : undefined}>{r.description}</Table.Td><Table.Td>{r.project_code}</Table.Td><Table.Td>{r.party_name}</Table.Td>
                      <Table.Td ta="end" c="dimmed">{r.txn_amount ? <bdi>{Number(r.txn_amount).toLocaleString('en-US')} {r.txn_currency}</bdi> : ''}</Table.Td>
                      <Table.Td ta="end">{r.debit ? num(r.debit) : ''}</Table.Td><Table.Td ta="end">{r.credit ? num(r.credit) : ''}</Table.Td><Table.Td ta="end" fw={600}>{num(r.balance)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Fragment>
              )
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </ReportShell>
  )
}

