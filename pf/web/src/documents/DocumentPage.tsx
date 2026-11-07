import {
  ActionIcon, Alert, Anchor, Badge, Button, Card, Checkbox, Collapse, Group, Modal, NumberInput, SegmentedControl, Select,
  SimpleGrid, Stack, Table, Text, TextInput, Textarea, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronDown, IconPaperclip, IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'
import {
  lastAccount, partyMatchesRole, sha256Hex, useDocKinds, useGlAccounts, useMoneyAccounts, useParties, useProjects,
} from './data'
import {
  documentTotal, emptyDoc, journalDifference, missingForPosting, newLine, toDocumentRow, toLineRows, usdEquivalent,
  type DocKind, type DocState, type KindInfo,
} from './logic'

interface DocRow {
  id: string; kind: DocKind; status: 'draft' | 'submitted' | 'posted' | 'void'; number: string | null; temp_number: string
  doc_date: string; party_id: string | null; money_account_id: string | null; counter_money_account_id: string | null
  currency: string; rate: number; amount: number; counter_amount: number | null; counter_rate: number | null; fee_amount: number
  purpose: 'payable' | 'deposit' | null; reference_no: string | null; description: string | null; notes: string | null
  no_document_reason: string | null; journal_entry_id: string | null; reversal_entry_id: string | null
  void_reason: string | null; created_by: string | null; posted_at: string | null
}
interface Attachment { id: string; file_name: string; storage_path: string; size_bytes: number | null; sha256: string | null; uploaded_at: string }

const today = () => new Date().toISOString().slice(0, 10)

function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['doc', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [doc, lines, links, files] = await Promise.all([
        supabase.from('documents').select('*').eq('id', id!),
        supabase.from('document_lines').select('*').eq('document_id', id!).order('line_no'),
        supabase.from('document_links').select('*').eq('from_document_id', id!),
        supabase.from('attachments').select('*').eq('document_id', id!).order('uploaded_at'),
      ])
      if (doc.error) throw doc.error
      const d = (doc.data ?? [])[0] as DocRow | undefined
      if (!d) throw new Error('Document not found')
      return {
        doc: d,
        lines: (lines.data ?? []) as Record<string, unknown>[],
        links: (links.data ?? []) as { to_document_id: string; amount: number }[],
        files: (files.data ?? []) as Attachment[],
      }
    },
  })
}

function stateFrom(d: DocRow, lines: Record<string, unknown>[], links: { to_document_id: string; amount: number }[]): DocState {
  return {
    doc_date: d.doc_date, money_account_id: d.money_account_id, counter_money_account_id: d.counter_money_account_id,
    party_id: d.party_id, amount: Number(d.amount) || '', counter_amount: d.counter_amount ? Number(d.counter_amount) : '',
    fee_amount: Number(d.fee_amount) || '', rate: Number(d.rate), counter_rate: d.counter_rate ? Number(d.counter_rate) : '',
    purpose: d.purpose ?? 'payable', currency: d.currency, reference_no: d.reference_no ?? '', description: d.description ?? '', notes: d.notes ?? '',
    no_document_reason: d.no_document_reason ?? '',
    lines: lines.length
      ? lines.map((l) => ({
          key: String(l.id), gl_account_id: (l.gl_account_id as string) ?? null, project_id: (l.project_id as string) ?? null,
          item_id: (l.item_id as string) ?? null, description: (l.description as string) ?? '', amount: Number(l.amount),
          side: (l.side as 'D' | 'C') ?? 'D',
        }))
      : [newLine()],
    links: links.map((l) => ({ to_document_id: l.to_document_id, amount: Number(l.amount) })),
  }
}

export function DocumentPage() {
  const { id, kind: kindParam } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { company, can, session } = useAuth()
  const cid = company!.company_id

  const kinds = useDocKinds()
  const accounts = useMoneyAccounts()
  const parties = useParties()
  const gl = useGlAccounts()
  const projects = useProjects()
  const existing = useDocument(id)

  const kind: DocKind | undefined = (existing.data?.doc.kind ?? kindParam) as DocKind | undefined
  const k = kinds.data?.find((x) => x.kind === kind)
  const doc = existing.data?.doc
  const readOnly = Boolean(doc && doc.status !== 'draft')

  const [s, setS] = useState<DocState>(() => {
    const e = emptyDoc(today())
    return { ...e, money_account_id: lastAccount.get() }
  })
  const [moreOpen, setMoreOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (existing.data && loadedFor.current !== existing.data.doc.id + existing.data.doc.status) {
      loadedFor.current = existing.data.doc.id + existing.data.doc.status
      setS(stateFrom(existing.data.doc, existing.data.lines, existing.data.links))
    }
  }, [existing.data])

  // Kinds without a money account must not carry the remembered one.
  useEffect(() => {
    if (k && k.money_account === 'none' && s.money_account_id) setS((p) => ({ ...p, money_account_id: null }))
  }, [k, s.money_account_id])

  const set = <K extends keyof DocState>(key: K, v: DocState[K]) => setS((p) => ({ ...p, [key]: v }))
  const glById = useMemo(() => Object.fromEntries((gl.data ?? []).map((a) => [a.id, a])), [gl.data])
  const account = accounts.data?.find((a) => a.id === s.money_account_id)
  const counter = accounts.data?.find((a) => a.id === s.counter_money_account_id)
  const currency = account?.currency ?? s.currency
  const files = existing.data?.files ?? []

  // Settle-able open documents of the chosen party.
  const openDocs = useQuery({
    queryKey: ['open-docs', cid, s.party_id, k?.settles],
    enabled: Boolean(k && k.settles.length && s.party_id),
    queryFn: async () => {
      const { data: bal, error } = await supabase.from('v_document_balances').select('*').eq('company_id', cid).eq('party_id', s.party_id!)
      if (error) throw error
      const rows = (bal ?? []).filter((b) => k!.settles.includes(b.kind) && (Number(b.open_amount) > 0 || s.links.some((l) => l.to_document_id === b.id)))
      if (!rows.length) return []
      const { data: docs } = await supabase.from('documents').select('id, number, doc_date, kind, currency, description').in('id', rows.map((r) => r.id))
      return rows.map((r) => ({ ...r, ...(docs ?? []).find((d) => d.id === r.id) })) as {
        id: string; number: string; doc_date: string; kind: DocKind; currency: string; description: string | null; amount: number; open_amount: number
      }[]
    },
  })

  const duplicates = useQuery({
    queryKey: ['dups', id, doc?.status],
    enabled: Boolean(id && doc && doc.status !== 'void'),
    queryFn: async () => (await supabase.rpc('find_duplicates', { p_id: id })).data as { id: string; number: string; reason: string }[] ?? [],
  })

  const journal = useQuery({
    queryKey: ['journal', id, doc?.journal_entry_id, doc?.reversal_entry_id],
    enabled: Boolean(doc?.journal_entry_id),
    queryFn: async () => {
      const ids = [doc!.journal_entry_id, doc!.reversal_entry_id].filter(Boolean) as string[]
      const { data } = await supabase.from('journal_lines').select('*').in('entry_id', ids).order('line_no')
      return (data ?? []) as { id: number; entry_id: string; account_id: string; debit: number; credit: number; txn_currency: string; txn_amount: number; project_id: string | null; description: string | null }[]
    },
  })

  const missing = k ? missingForPosting(k, s, {
    hasAttachment: files.length > 0,
    accountNeedsProject: (aid) => Boolean(aid && glById[aid]?.requires_project),
  }) : []

  const save = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!k) throw new Error('Unknown document type')
      const row = toDocumentRow(k, s)
      const docId = id ?? crypto.randomUUID()
      if (id) {
        const { error } = await supabase.from('documents').update(row).eq('id', id)
        if (error) throw error
        await supabase.from('document_lines').delete().eq('document_id', id)
        await supabase.from('document_links').delete().eq('from_document_id', id)
      } else {
        const { error } = await supabase.from('documents').insert({ ...row, id: docId, company_id: cid, kind: k.kind })
        if (error) throw error
      }
      const lines = toLineRows(k, s, docId, cid)
      if (lines.length) {
        const { error } = await supabase.from('document_lines').insert(lines)
        if (error) throw error
      }
      const links = s.links.filter((l) => typeof l.amount === 'number' && l.amount > 0)
        .map((l) => ({ company_id: cid, from_document_id: docId, to_document_id: l.to_document_id, amount: l.amount }))
      if (links.length) {
        const { error } = await supabase.from('document_links').insert(links)
        if (error) throw error
      }
      if (s.money_account_id) lastAccount.set(s.money_account_id)
      return docId
    },
  })

  const refresh = (docId: string) => {
    void qc.invalidateQueries({ queryKey: ['doc', docId] })
    void qc.invalidateQueries({ queryKey: ['entries'] })
    void qc.invalidateQueries({ queryKey: ['home'] })
  }
  const fail = (e: Error) => notifications.show({ color: 'red', title: t('common.error'), message: e.message })

  const onSave = async (andPost: boolean) => {
    try {
      const docId = await save.mutateAsync()
      if (andPost) {
        const { data, error } = await supabase.rpc('post_document', { p_id: docId })
        if (error) throw error
        const st = (data as { status: string } | null)?.status
        notifications.show({ color: st === 'posted' ? 'green' : 'yellow', message: st === 'posted' ? t('doc.postedOk') : t('doc.sentForApproval') })
      } else {
        notifications.show({ color: 'green', message: t('common.saved') })
      }
      refresh(docId)
      if (!id) navigate(`/entries/${docId}`, { replace: true })
    } catch (e) { fail(e as Error) }
  }

  const rpc = useMutation({
    mutationFn: async ({ fn, args }: { fn: string; args: Record<string, unknown> }) => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      return data
    },
    onError: fail,
  })

  const upload = async (file: File | null) => {
    if (!file) return
    try {
      const docId = id ?? (await save.mutateAsync())
      const hash = await sha256Hex(file)
      const path = `${cid}/${docId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, '_')}`
      const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw up.error
      const { error } = await supabase.from('attachments').insert({
        company_id: cid, document_id: docId, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, sha256: hash,
      })
      if (error) throw error
      refresh(docId)
      if (!id) navigate(`/entries/${docId}`, { replace: true })
    } catch (e) { fail(e as Error) }
  }

  const openFile = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(a.storage_path, 120)
    if (error) return fail(error)
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (!k || (id && existing.isLoading)) return <Text c="dimmed">{t('common.loading')}</Text>
  if (existing.error) return <Alert color="red">{(existing.error as Error).message}</Alert>

  const kindName = localName(k, lang)
  const partyOptions = (parties.data ?? []).filter((p) => (p.is_active || p.id === s.party_id) && partyMatchesRole(p, k.party_role))
    .map((p) => ({ value: p.id, label: `${localName(p, lang)} · ${p.code}` }))
  const accountOptions = (accounts.data ?? []).filter((a) => a.is_active || a.id === s.money_account_id)
    .map((a) => ({ value: a.id, label: `${localName(a, lang)} · ${a.currency}` }))
  const projectOptions = (projects.data ?? []).filter((p) => p.status !== 'closed')
    .map((p) => ({ value: p.id, label: `${p.code} · ${localName(p, lang)}` }))
  const lineAccountOptions = (gl.data ?? [])
    .filter((a) => a.is_postable && a.is_active)
    .filter((a) => k.kind === 'manual_journal' || (['expense', 'asset'].includes(a.account_type) && !a.control_kind))
    .map((a) => ({ value: a.id, label: `${a.code} · ${localName(a, lang)}` }))
  const partyLabel = { supplier: t('doc.supplier'), customer: t('doc.customer'), employee: t('doc.employee'), owner: t('doc.owner'), employee_or_owner: t('doc.employeeOrOwner'), any: t('doc.party') }[k.party_role ?? 'any']
  const total = documentTotal(k, s)
  const rateNum = typeof s.rate === 'number' ? s.rate : undefined
  const statusColor = { draft: 'gray', submitted: 'yellow', posted: 'green', void: 'red' }[doc?.status ?? 'draft']

  const onPartyChange = (v: string | null) => {
    const p = parties.data?.find((x) => x.id === v)
    setS((prev) => ({
      ...prev, party_id: v, links: [],
      // Smart defaults: the party's usual project and account fill empty lines.
      lines: prev.lines.map((l) => ({
        ...l,
        project_id: l.project_id ?? p?.default_project_id ?? null,
        gl_account_id: l.gl_account_id ?? (k.has_lines && k.kind !== 'manual_journal' ? p?.default_gl_account_id ?? null : null),
      })),
    }))
  }

  return (
    <Stack maw={900}>
      <Group justify="space-between" wrap="wrap">
        <Stack gap={0}>
          <Title order={3}>{kindName}</Title>
          <Text c="dimmed" size="sm">{doc ? (doc.number ?? doc.temp_number) : t('doc.new')}</Text>
        </Stack>
        {doc && <Badge size="lg" color={statusColor} variant="light">{t(`doc.${doc.status}`)}</Badge>}
      </Group>

      {doc?.status === 'void' && <Alert color="red">{t('doc.void')}: {doc.void_reason}</Alert>}
      {(duplicates.data ?? []).length > 0 && doc?.status !== 'posted' && (
        <Alert color="orange" title={t('doc.duplicates')}>
          {(duplicates.data ?? []).map((d) => (
            <div key={d.id}><Anchor onClick={() => navigate(`/entries/${d.id}`)}>{d.number}</Anchor> — {d.reason}</div>
          ))}
        </Alert>
      )}

      <Card withBorder>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput type="date" label={t('doc.date')} value={s.doc_date} onChange={(e) => set('doc_date', e.currentTarget.value)} disabled={readOnly} required />
            {k.money_account !== 'none' && (
              <Select label={k.kind === 'transfer' ? t('doc.account') : t('doc.account')} data={accountOptions} value={s.money_account_id}
                onChange={(v) => set('money_account_id', v)} searchable disabled={readOnly} required={k.money_account === 'required'}
                allowDeselect={k.money_account !== 'required'}
                clearable={k.money_account === 'optional'} />
            )}
            {k.kind === 'transfer' && (
              <Select label={t('doc.toAccount')} data={accountOptions.filter((o) => o.value !== s.money_account_id)} value={s.counter_money_account_id}
                onChange={(v) => set('counter_money_account_id', v)} searchable disabled={readOnly} required allowDeselect={false} />
            )}
            {k.party_role && (
              <Select label={partyLabel} data={partyOptions} value={s.party_id} onChange={onPartyChange} searchable
                clearable={!k.party_required} allowDeselect={!k.party_required} disabled={readOnly} required={k.party_required} />
            )}
            {!k.has_lines && k.kind !== 'employee_offset' && (
              <NumberInput label={`${t('doc.amount')} (${currency})`} value={s.amount} onChange={(v) => set('amount', typeof v === 'number' ? v : '')}
                thousandSeparator="," decimalScale={2} min={0} disabled={readOnly} required
                description={rateNum && currency !== 'USD' && typeof s.amount === 'number' ? `≈ ${formatMoney(usdEquivalent(s.amount, rateNum), 'USD')}` : undefined} />
            )}
            {k.kind === 'transfer' && counter && account && counter.currency !== account.currency && (
              <NumberInput label={`${t('doc.amountReceived')} (${counter.currency})`} value={s.counter_amount}
                onChange={(v) => set('counter_amount', typeof v === 'number' ? v : '')} thousandSeparator="," decimalScale={2} disabled={readOnly} required />
            )}
            {(k.money_account === 'none' || (k.money_account === 'optional' && !s.money_account_id)) && (
              <Select label={t('md.currency')} data={['USD', 'SAR', 'YER']} value={s.currency} allowDeselect={false} disabled={readOnly}
                onChange={(v) => setS((p) => ({ ...p, currency: v ?? 'USD', rate: '', links: [] }))} />
            )}
            <TextInput label={t('doc.description')} value={s.description} onChange={(e) => set('description', e.currentTarget.value)} disabled={readOnly} />
          </SimpleGrid>

          {k.has_lines && (
            <LinesEditor k={k} s={s} setS={setS} readOnly={readOnly} accountOptions={lineAccountOptions} projectOptions={projectOptions}
              glById={glById} currency={currency} />
          )}

          {k.settles.length > 0 && s.party_id && (
            <Stack gap="xs">
              <Text fw={600}>{t('doc.settles')}</Text>
              {(openDocs.data ?? []).length === 0 && <Text size="sm" c="dimmed">—</Text>}
              {(openDocs.data ?? []).map((o) => {
                const link = s.links.find((l) => l.to_document_id === o.id)
                return (
                  <Group key={o.id} wrap="nowrap">
                    <Checkbox checked={Boolean(link)} disabled={readOnly} onChange={(e) => {
                      const on = e.currentTarget.checked
                      setS((p) => {
                        const links = on ? [...p.links, { to_document_id: o.id, amount: Number(o.open_amount) }] : p.links.filter((l) => l.to_document_id !== o.id)
                        const sum = links.reduce((a, l) => a + (typeof l.amount === 'number' ? l.amount : 0), 0)
                        // Reimbursement / repayment amount follows the documents ticked.
                        return { ...p, links, amount: k.kind === 'employee_offset' ? p.amount : sum || p.amount }
                      })
                    }} />
                    <Text size="sm" flex={1}>{o.number} · {o.doc_date} · {o.description ?? ''} <Text span c="dimmed">({t(`doc.open`)} <bdi>{formatMoney(o.open_amount, o.currency)}</bdi>)</Text></Text>
                    {link && (
                      <NumberInput w={140} size="sm" value={link.amount} disabled={readOnly} max={Number(o.open_amount)} decimalScale={2}
                        onChange={(v) => setS((p) => ({ ...p, links: p.links.map((l) => (l.to_document_id === o.id ? { ...l, amount: typeof v === 'number' ? v : '' } : l)) }))} />
                    )}
                  </Group>
                )
              })}
            </Stack>
          )}

          <Group justify="space-between">
            <Button variant="subtle" size="sm" onClick={() => setMoreOpen((o) => !o)} rightSection={<IconChevronDown size={16} />}>{t('doc.more')}</Button>
            <Text fw={700}>{t('doc.total')}: <bdi>{formatMoney(total + (Number(s.fee_amount) || 0), currency)}</bdi></Text>
          </Group>
          <Collapse expanded={moreOpen || readOnly}>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {k.allows_fee && k.money_account !== 'none' && (
                <NumberInput label={`${t('doc.fee')} (${currency})`} value={s.fee_amount} onChange={(v) => set('fee_amount', typeof v === 'number' ? v : '')}
                  decimalScale={2} min={0} disabled={readOnly} placeholder={account?.usual_fee ? String(account.usual_fee) : undefined} />
              )}
              {currency !== 'USD' && (
                <NumberInput label={`${t('doc.rate')} — ${currency}`} value={s.rate} onChange={(v) => set('rate', typeof v === 'number' ? v : '')} decimalScale={6} disabled={readOnly} />
              )}
              {k.kind === 'transfer' && counter && counter.currency !== 'USD' && counter.currency !== currency && (
                <NumberInput label={`${t('doc.counterRate')} — ${counter.currency}`} value={s.counter_rate} onChange={(v) => set('counter_rate', typeof v === 'number' ? v : '')} decimalScale={6} disabled={readOnly} />
              )}
              {k.kind === 'supplier_payment' && (
                <Stack gap={4}>
                  <Text size="sm" fw={500}>{t('doc.purpose')}</Text>
                  <SegmentedControl value={s.purpose} disabled={readOnly} onChange={(v) => set('purpose', v as 'payable' | 'deposit')}
                    data={[{ value: 'payable', label: t('doc.payable') }, { value: 'deposit', label: t('doc.deposit') }]} />
                </Stack>
              )}
              <TextInput label={t('doc.reference')} value={s.reference_no} onChange={(e) => set('reference_no', e.currentTarget.value)} disabled={readOnly} />
              {k.money_account !== 'none' && (
                <TextInput label={t('doc.noDocReason')} value={s.no_document_reason} onChange={(e) => set('no_document_reason', e.currentTarget.value)} disabled={readOnly} />
              )}
              <Textarea label={t('doc.notes')} value={s.notes} onChange={(e) => set('notes', e.currentTarget.value)} disabled={readOnly} autosize minRows={1} />
            </SimpleGrid>
          </Collapse>
        </Stack>
      </Card>

      {/* Files */}
      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>{t('doc.attachments')}</Text>
          {doc?.status !== 'void' && can('docs.create') && (
            <Button component="label" variant="light" size="sm" leftSection={<IconPaperclip size={16} />}>
              {t('doc.upload')}
              <input type="file" hidden accept="image/*,application/pdf" capture="environment" onChange={(e) => void upload(e.currentTarget.files?.[0] ?? null)} />
            </Button>
          )}
        </Group>
        {files.length === 0 && <Text size="sm" c="dimmed">—</Text>}
        {files.map((f) => (
          <Group key={f.id} justify="space-between">
            <Anchor size="sm" onClick={() => void openFile(f)}>{f.file_name}</Anchor>
            <Text size="xs" c="dimmed" dir="ltr">{f.sha256?.slice(0, 12)}…</Text>
          </Group>
        ))}
      </Card>

      {/* Actions */}
      {!readOnly && missing.length > 0 && (
        <Text size="sm" c="orange">{t('doc.missing')}: {missing.map((m) => {
          const [a, b] = m.split('.')
          return b ? `${t('doc.lines')} ${a.replace('line', '')} ${t(`doc.m.${b === 'account' ? 'accountMissing' : b}`)}` : t(`doc.m.${a}`)
        }).join(', ')}</Text>
      )}
      <Group wrap="wrap">
        {!readOnly && can('docs.create') && (
          <Button variant="default" loading={save.isPending} onClick={() => void onSave(false)}>{t('doc.saveDraft')}</Button>
        )}
        {!readOnly && can(k.post_permission) && (
          <Button loading={save.isPending || rpc.isPending} disabled={missing.length > 0} onClick={() => void onSave(true)}>{t('doc.saveAndPost')}</Button>
        )}
        {doc?.status === 'submitted' && can('docs.approve') && (
          <>
            <Button color="green" loading={rpc.isPending} onClick={() => rpc.mutate({ fn: 'approve_document', args: { p_id: doc.id } }, { onSuccess: () => refresh(doc.id) })}>{t('doc.approve')}</Button>
            <Button color="orange" variant="light" onClick={() => rpc.mutate({ fn: 'reject_document', args: { p_id: doc.id, p_note: '' } }, { onSuccess: () => refresh(doc.id) })}>{t('doc.reject')}</Button>
          </>
        )}
        {doc && doc.status !== 'void' && (doc.status !== 'posted' ? (can('docs.reverse') || doc.created_by === session?.user.id) : can('docs.reverse')) && (
          <Button color="red" variant="light" onClick={() => setVoidOpen(true)}>{t('doc.voidDoc')}</Button>
        )}
        {doc && (doc.status === 'void' || doc.status === 'posted') && can('docs.create') && (
          <Button variant="subtle" onClick={() => rpc.mutate({ fn: 'duplicate_document', args: { p_id: doc.id } }, { onSuccess: (newId) => navigate(`/entries/${newId as string}`) })}>{t('doc.copy')}</Button>
        )}
      </Group>

      {doc?.journal_entry_id && (
        <JournalView lines={journal.data ?? []} entryId={doc.journal_entry_id} reversalId={doc.reversal_entry_id} glById={glById}
          projectName={(pid) => { const p = projects.data?.find((x) => x.id === pid); return p ? p.code : '' }} />
      )}

      <Modal opened={voidOpen} onClose={() => setVoidOpen(false)} title={t('doc.voidReason')}>
        <Stack>
          <Textarea value={voidReason} onChange={(e) => setVoidReason(e.currentTarget.value)} minRows={2} autosize data-autofocus />
          <Button color="red" disabled={voidReason.trim().length < 3} loading={rpc.isPending}
            onClick={() => rpc.mutate({ fn: 'void_document', args: { p_id: doc!.id, p_reason: voidReason } }, { onSuccess: () => { setVoidOpen(false); refresh(doc!.id) } })}>
            {t('doc.voidDoc')}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  )
}

function LinesEditor({ k, s, setS, readOnly, accountOptions, projectOptions, glById, currency }: {
  k: KindInfo; s: DocState; setS: React.Dispatch<React.SetStateAction<DocState>>; readOnly: boolean
  accountOptions: { value: string; label: string }[]; projectOptions: { value: string; label: string }[]
  glById: Record<string, { requires_project: boolean }>; currency: string
}) {
  const { t } = useTranslation()
  const upd = (key: string, patch: Partial<DocState['lines'][number]>) =>
    setS((p) => ({ ...p, lines: p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const journal = k.kind === 'manual_journal'
  const diff = journal ? journalDifference(s) : 0
  return (
    <Stack gap="xs">
      <Text fw={600}>{t('doc.lines')}</Text>
      {s.lines.map((l) => (
        <Card key={l.key} withBorder p="xs" bg="var(--mantine-color-gray-0)">
          <SimpleGrid cols={{ base: 1, sm: journal ? 5 : 4 }} spacing="xs">
            {journal && (
              <SegmentedControl size="xs" value={l.side} disabled={readOnly} onChange={(v) => upd(l.key, { side: v as 'D' | 'C' })}
                data={[{ value: 'D', label: t('doc.debit') }, { value: 'C', label: t('doc.credit') }]} />
            )}
            <Select size="sm" placeholder={t('doc.glAccount')} data={accountOptions} value={l.gl_account_id} searchable disabled={readOnly} allowDeselect={false}
              onChange={(v) => upd(l.key, { gl_account_id: v })} aria-label={t('doc.glAccount')} />
            <Select size="sm" placeholder={t('doc.project')} data={projectOptions} value={l.project_id} searchable clearable disabled={readOnly}
              onChange={(v) => upd(l.key, { project_id: v })} aria-label={t('doc.project')}
              error={l.gl_account_id && glById[l.gl_account_id]?.requires_project && !l.project_id ? ' ' : undefined} />
            <TextInput size="sm" placeholder={t('doc.description')} value={l.description} disabled={readOnly}
              onChange={(e) => upd(l.key, { description: e.currentTarget.value })} aria-label={t('doc.description')} />
            <Group gap={4} wrap="nowrap">
              <NumberInput size="sm" placeholder={`${t('doc.amount')} ${currency}`} value={l.amount} thousandSeparator="," decimalScale={2} min={0}
                disabled={readOnly} onChange={(v) => upd(l.key, { amount: typeof v === 'number' ? v : '' })} aria-label={t('doc.amount')} flex={1} />
              {!readOnly && s.lines.length > 1 && (
                <ActionIcon variant="subtle" color="red" aria-label="remove" onClick={() => setS((p) => ({ ...p, lines: p.lines.filter((x) => x.key !== l.key) }))}>
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Group>
          </SimpleGrid>
        </Card>
      ))}
      <Group justify="space-between">
        {!readOnly && <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />}
          onClick={() => setS((p) => ({ ...p, lines: [...p.lines, { ...newLine(journal && journalDifference(p) > 0 ? 'C' : 'D'), project_id: p.lines.at(-1)?.project_id ?? null }] }))}>{t('doc.addLine')}</Button>}
        {journal && <Text size="sm" c={diff === 0 ? 'green' : 'red'}>{t('doc.difference')}: <bdi>{formatMoney(diff, currency)}</bdi></Text>}
      </Group>
    </Stack>
  )
}

function JournalView({ lines, entryId, reversalId, glById, projectName }: {
  lines: { id: number; entry_id: string; account_id: string; debit: number; credit: number; txn_currency: string; txn_amount: number; project_id: string | null; description: string | null }[]
  entryId: string; reversalId: string | null
  glById: Record<string, { code: string; name_en: string; name_ar: string | null }>
  projectName: (id: string | null) => string
}) {
  const { t, i18n } = useTranslation()
  const block = (eid: string, title: string) => {
    const rows = lines.filter((l) => l.entry_id === eid)
    return (
      <Card withBorder key={eid}>
        <Text fw={600} mb="xs">{title}</Text>
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={4} fz="sm">
            <Table.Thead><Table.Tr>
              <Table.Th>{t('md.glAccount')}</Table.Th><Table.Th>{t('doc.project')}</Table.Th>
              <Table.Th ta="end">{t('doc.debit')} USD</Table.Th><Table.Th ta="end">{t('doc.credit')} USD</Table.Th><Table.Th ta="end">{t('doc.amount')}</Table.Th>
            </Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((l) => {
                const a = glById[l.account_id]
                return (
                  <Table.Tr key={l.id}>
                    <Table.Td>{a ? `${a.code} · ${localName(a, i18n.language)}` : ''}</Table.Td>
                    <Table.Td>{projectName(l.project_id)}</Table.Td>
                    <Table.Td ta="end">{Number(l.debit) ? Number(l.debit).toFixed(2) : ''}</Table.Td>
                    <Table.Td ta="end">{Number(l.credit) ? Number(l.credit).toFixed(2) : ''}</Table.Td>
                    <Table.Td ta="end"><Text size="xs" c="dimmed">{Number(l.txn_amount) ? formatMoney(l.txn_amount, l.txn_currency) : ''}</Text></Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    )
  }
  return <>{block(entryId, t('doc.journal'))}{reversalId && block(reversalId, t('doc.reversal'))}</>
}
