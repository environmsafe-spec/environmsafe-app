import { Badge, Card, Group, Menu, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconArrowsExchange, IconCash, IconFileInvoice, IconReceipt2, IconUpload, IconUserDollar } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useDocKinds } from '../documents/data'
import { ACTION_GROUPS, type DocKind } from '../documents/logic'
import { formatMoney, localName } from '../lib/format'
import { supabase } from '../lib/supabase'

const tileStyle = { border: '1px solid var(--mantine-color-navy-1)', borderRadius: 12, padding: 18, minHeight: 100, width: '100%', background: 'var(--mantine-color-body)' }

function Tile({ label, icon: Icon, disabled, onClick }: { label: string; icon: typeof IconCash; disabled?: boolean; onClick?: () => void }) {
  return (
    <UnstyledButton style={{ ...tileStyle, opacity: disabled ? 0.45 : 1 }} disabled={disabled} onClick={onClick}>
      <Stack align="center" gap={6}>
        <Icon size={34} color="var(--mantine-color-navy-9)" />
        <Text fw={600} ta="center">{label}</Text>
      </Stack>
    </UnstyledButton>
  )
}

export function HomePage() {
  const { t, i18n } = useTranslation()
  const { company, can } = useAuth()
  const navigate = useNavigate()
  const kinds = useDocKinds()
  const cid = company?.company_id
  const canCreate = can('docs.create')

  const home = useQuery({
    queryKey: ['home', cid],
    enabled: Boolean(cid) && can('docs.view'),
    queryFn: async () => {
      const [drafts, cash] = await Promise.all([
        supabase.from('v_drafts').select('*').eq('company_id', cid!).order('doc_date', { ascending: false }).limit(50),
        supabase.from('v_money_account_balances').select('*').eq('company_id', cid!).eq('is_active', true).order('code'),
      ])
      return { drafts: drafts.data ?? [], cash: cash.data ?? [] }
    },
  })

  const group = (g: keyof typeof ACTION_GROUPS, label: string, icon: typeof IconCash) => {
    const list = ACTION_GROUPS[g].filter((k) => kinds.data?.some((x) => x.kind === k))
    if (list.length === 1) return <Tile key={g} label={label} icon={icon} disabled={!canCreate} onClick={() => navigate(`/entries/new/${list[0]}`)} />
    return (
      <Menu key={g} position="bottom" width={260} disabled={!canCreate}>
        <Menu.Target><div><Tile label={label} icon={icon} disabled={!canCreate} /></div></Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t('doc.choose')}</Menu.Label>
          {list.map((k: DocKind) => {
            const info = kinds.data?.find((x) => x.kind === k)
            return <Menu.Item key={k} onClick={() => navigate(`/entries/new/${k}`)}>{info ? localName(info, i18n.language) : k}</Menu.Item>
          })}
        </Menu.Dropdown>
      </Menu>
    )
  }

  const missingBadges = (d: Record<string, unknown>) => [
    d.missing_attachment && t('doc.m.evidence'), d.missing_project && t('doc.m.project'),
    d.missing_account && t('doc.m.accountMissing'), d.missing_amount && t('doc.m.amount'),
  ].filter(Boolean) as string[]

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
        {group('pay', t('home.pay'), IconCash)}
        {group('receive', t('home.receive'), IconReceipt2)}
        {group('transfer', t('home.transfer'), IconArrowsExchange)}
        {group('claim', t('home.claim'), IconUserDollar)}
        <Tile label={t('home.billInvoice')} icon={IconFileInvoice} disabled />
        <Tile label={t('home.upload')} icon={IconUpload} disabled />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Title order={5} mb="xs">{t('doc.inbox')}</Title>
          {(home.data?.drafts ?? []).length === 0 && <Text c="dimmed" size="sm">—</Text>}
          <Stack gap={6}>
            {(home.data?.drafts ?? []).map((d) => {
              const miss = missingBadges(d)
              const kind = kinds.data?.find((k) => k.kind === d.kind)
              return (
                <UnstyledButton key={d.id} onClick={() => navigate(`/entries/${d.id}`)}>
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={0}>
                      <Text size="sm" fw={500}>{kind ? localName(kind, i18n.language) : d.kind} · <bdi>{formatMoney(d.amount, d.currency, i18n.language)}</bdi></Text>
                      <Text size="xs" c="dimmed">{d.temp_number} · {d.doc_date} {d.description ? `· ${d.description}` : ''}</Text>
                    </Stack>
                    <Group gap={4} justify="flex-end">
                      {d.status === 'submitted' && <Badge color="yellow" variant="light">{t('doc.submitted')}</Badge>}
                      {d.status === 'draft' && miss.length === 0 && <Badge color="green" variant="light">{t('doc.nothingMissing')}</Badge>}
                      {miss.map((m) => <Badge key={m} color="orange" variant="outline" size="sm">{m}</Badge>)}
                    </Group>
                  </Group>
                </UnstyledButton>
              )
            })}
          </Stack>
        </Card>
        <Card withBorder>
          <Title order={5} mb="xs">{t('doc.cash')}</Title>
          <Stack gap={4}>
            {(home.data?.cash ?? []).map((a) => (
              <Group key={a.id} justify="space-between">
                <Text size="sm">{localName(a, i18n.language)}</Text>
                <Text size="sm" fw={600} c={Number(a.balance) < 0 ? 'red' : undefined}><bdi>{formatMoney(a.balance, a.currency, i18n.language)}</bdi></Text>
              </Group>
            ))}
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  )
}
