import { Alert, Anchor, Button, Center, Image, Paper, PasswordInput, PinInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageToggle } from '../layout/LanguageToggle'
import { backendConfigured, supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <Center mih="100dvh" p="md" bg="var(--mantine-color-navy-0)">
      <Paper withBorder shadow="sm" p="xl" radius="lg" w="100%" maw={420}>
        <Stack gap="md">
          <Center><Image src="/logo.png" alt="EnvironmSafe" h={64} w="auto" fit="contain" /></Center>
          {children}
          <Center><LanguageToggle /></Center>
        </Stack>
      </Paper>
    </Center>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
  }

  const forgot = async () => {
    if (!email) return
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setInfo(t('auth.resetSent'))
  }

  return (
    <Frame>
      <Title order={3} ta="center">{t('auth.title')}</Title>
      {!backendConfigured && <Alert color="yellow">{t('auth.noBackend')}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      {info && <Alert color="blue">{info}</Alert>}
      <form onSubmit={submit}>
        <Stack>
          <TextInput label={t('auth.email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label={t('auth.password')} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button type="submit" loading={busy} disabled={!backendConfigured} fullWidth>{t('auth.signIn')}</Button>
          <Anchor component="button" type="button" size="sm" onClick={forgot}>{t('auth.forgot')}</Anchor>
        </Stack>
      </form>
    </Frame>
  )
}

/** Second step for Owner / Accountant: enrol a TOTP app the first time, then verify each sign-in. */
export function MfaPage() {
  const { t } = useTranslation()
  const { refresh, signOut } = useAuth()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.mfa.listFactors()
      const verified = data?.totp?.find((f) => f.status === 'verified')
      if (verified) { setFactorId(verified.id); return }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `ES Finance ${Date.now()}` })
      if (enrolled.error) { setError(enrolled.error.message); return }
      setFactorId(enrolled.data.id)
      setQr(enrolled.data.totp.qr_code)
    })()
  }, [])

  const verify = async () => {
    if (!factorId) return
    setBusy(true); setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (error) { setError(error.message); setCode(''); return }
    await refresh()
  }

  return (
    <Frame>
      <Title order={3} ta="center">{qr ? t('auth.enrollTitle') : t('auth.mfaTitle')}</Title>
      {qr && <Text size="sm">{t('auth.enrollHelp')}</Text>}
      {qr && <Center><Image src={qr} alt="QR" w={200} h={200} /></Center>}
      {error && <Alert color="red">{error}</Alert>}
      <Text size="sm" c="dimmed" ta="center">{t('auth.mfaCode')}</Text>
      <Center dir="ltr"><PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={() => void verify()} /></Center>
      <Button onClick={verify} loading={busy} disabled={code.length !== 6} fullWidth>{t('auth.verify')}</Button>
      <Anchor component="button" size="sm" onClick={() => void signOut()}>{t('common.signOut')}</Anchor>
    </Frame>
  )
}

export function NoCompanyPage() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  return (
    <Frame>
      <Alert color="yellow">{t('auth.noCompany')}</Alert>
      <Button variant="light" onClick={() => void signOut()}>{t('common.signOut')}</Button>
    </Frame>
  )
}
