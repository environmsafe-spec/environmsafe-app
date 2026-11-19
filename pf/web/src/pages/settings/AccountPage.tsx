import { Alert, Button, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { authClient } from '../../auth/client'

/** My sign-in: change my password (other devices are signed out). */
export function AccountPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== again) { setMsg({ ok: false, text: t('account.mismatch') }); return }
    setBusy(true); setMsg(null)
    try {
      await authClient.changePassword(current, next)
      setMsg({ ok: true, text: t('account.changed') }); setCurrent(''); setNext(''); setAgain('')
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack maw={420}>
      <Title order={3}>{t('account.title')}</Title>
      <Text size="sm" c="dimmed">{session?.user.email}</Text>
      {msg && <Alert color={msg.ok ? 'green' : 'red'}>{msg.text}</Alert>}
      <form onSubmit={save}>
        <Stack>
          <PasswordInput label={t('account.current')} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.currentTarget.value)} />
          <PasswordInput label={t('account.new')} autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.currentTarget.value)} />
          <PasswordInput label={t('account.again')} autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.currentTarget.value)} />
          <Button type="submit" loading={busy}>{t('account.change')}</Button>
        </Stack>
      </form>
    </Stack>
  )
}
