import { Alert, Stack, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'

export function PlaceholderPage({ title }: { title: string }) {
  const { t } = useTranslation()
  return (
    <Stack>
      <Title order={3}>{t(title)}</Title>
      <Alert color="gold" variant="light">{t('common.comingSoon')}</Alert>
    </Stack>
  )
}
