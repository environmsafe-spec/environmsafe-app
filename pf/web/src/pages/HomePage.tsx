import { Alert, Card, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconArrowsExchange, IconCash, IconFileInvoice, IconReceipt2, IconUpload, IconUserDollar } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

const actions = [
  { key: 'home.pay', icon: IconCash },
  { key: 'home.receive', icon: IconReceipt2 },
  { key: 'home.transfer', icon: IconArrowsExchange },
  { key: 'home.claim', icon: IconUserDollar },
  { key: 'home.billInvoice', icon: IconFileInvoice },
  { key: 'home.upload', icon: IconUpload },
]

export function HomePage() {
  const { t } = useTranslation()
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
        {actions.map((a) => (
          <UnstyledButton key={a.key} disabled aria-disabled title={t('common.comingSoon')}
            style={{ border: '1px solid var(--mantine-color-navy-1)', borderRadius: 12, padding: 20, opacity: 0.55, minHeight: 104 }}>
            <Stack align="center" gap={6}>
              <a.icon size={34} color="var(--mantine-color-navy-9)" />
              <Text fw={600} ta="center">{t(a.key)}</Text>
            </Stack>
          </UnstyledButton>
        ))}
      </SimpleGrid>
      <Alert variant="light" color="gold">{t('common.comingSoon')}: {t('home.pay')}, {t('home.receive')}, {t('home.transfer')}, {t('home.claim')}…</Alert>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {['home.drafts', 'home.cash', 'home.attention'].map((k) => (
          <Card key={k} withBorder><Title order={5}>{t(k)}</Title><Text c="dimmed" size="sm">{t('common.comingSoon')}</Text></Card>
        ))}
      </SimpleGrid>
    </Stack>
  )
}
