import { Button } from '@mantine/core'
import { IconLanguage } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '../lib/i18n'

export function LanguageToggle() {
  const { t, i18n } = useTranslation()
  return (
    <Button variant="subtle" size="sm" leftSection={<IconLanguage size={18} />}
      onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')}>
      {t('common.language')}
    </Button>
  )
}
