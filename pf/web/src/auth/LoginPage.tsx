import { Alert, Anchor, Button, Center, Image, Paper, PasswordInput, PinInput, Stack, Text, TextInput, Title } from '@mantine/core'
import qrcode from 'qrcode-generator'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageToggle } from '../layout/LanguageToggle'
import { authClient } from './client'
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
  const { refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'password' | 'code' | 'backup'>('password')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const next = await authClient.signIn(email, password)
      if (next === 'code') setStep('code')
      else await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value = code) => {
    setBusy(true); setError(null)
    try {
      if (step === 'backup') await authClient.verifyBackupCode(value.trim())
      else await authClient.verifyCode(value)
      await refresh()
    } catch (err) {
      setError((err as Error).message); setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (step !== 'password') {
    return (
      <Frame>
        <Title order={3} ta="center">{t('auth.mfaTitle')}</Title>
        {error && <Alert color="red">{error}</Alert>}
        {step === 'code' ? (
          <>
            <Text size="sm" c="dimmed" ta="center">{t('auth.mfaCode')}</Text>
            <Center dir="ltr"><PinInput length={6} type="number" oneTimeCode autoFocus value={code} onChange={setCode} onComplete={(v) => void verify(v)} /></Center>
          </>
        ) : (
          <TextInput label={t('auth.backupCode')} dir="ltr" autoFocus value={code} onChange={(e) => setCode(e.currentTarget.value)} />
        )}
        <Button onClick={() => void verify()} loading={busy} disabled={step === 'code' ? code.length !== 6 : code.trim().length < 6} fullWidth>{t('auth.verify')}</Button>
        <Anchor component="button" size="sm" onClick={() => { setStep(step === 'code' ? 'backup' : 'code'); setCode('') }}>
          {step === 'code' ? t('auth.useBackup') : t('auth.useApp')}
        </Anchor>
        <Anchor component="button" size="sm" onClick={() => { setStep('password'); setCode('') }}>{t('common.back')}</Anchor>
      </Frame>
    )
  }

  return (
    <Frame>
      <Title order={3} ta="center">{t('auth.title')}</Title>
      {error && <Alert color="red">{error}</Alert>}
      {info && <Alert color="blue">{info}</Alert>}
      <form onSubmit={submit}>
        <Stack>
          <TextInput label={t('auth.email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <PasswordInput label={t('auth.password')} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button type="submit" loading={busy} fullWidth>{t('auth.signIn')}</Button>
          <Anchor component="button" type="button" size="sm" onClick={() => setInfo(t('auth.forgotAsk'))}>{t('auth.forgot')}</Anchor>
        </Stack>
      </form>
    </Frame>
  )
}

/** Owner / Accountant without two-step sign-in yet: set it up once (password, QR code, first code). */
export function MfaPage() {
  const { t } = useTranslation()
  const { refresh, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await authClient.enableTwoFactor(password)
      setSetup({ qr: qrSvg(r.totpURI), secret: new URL(r.totpURI).searchParams.get('secret') ?? '', backupCodes: r.backupCodes })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value = code) => {
    setBusy(true); setError(null)
    try {
      await authClient.verifyCode(value)
      await refresh()
    } catch (err) {
      setError((err as Error).message); setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame>
      <Title order={3} ta="center">{t('auth.enrollTitle')}</Title>
      {error && <Alert color="red">{error}</Alert>}
      {!setup ? (
        <form onSubmit={start}>
          <Stack>
            <Text size="sm">{t('auth.enrollIntro')}</Text>
            <PasswordInput label={t('auth.password')} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <Button type="submit" loading={busy} fullWidth>{t('auth.enrollStart')}</Button>
          </Stack>
        </form>
      ) : (
        <>
          <Text size="sm">{t('auth.enrollHelp')}</Text>
          <Center><Image src={setup.qr} alt="QR" w={200} h={200} /></Center>
          <Text size="xs" c="dimmed" ta="center" dir="ltr" style={{ wordBreak: 'break-all' }}>{setup.secret}</Text>
          <Alert color="yellow" title={t('auth.backupTitle')}>
            <Text size="sm">{t('auth.backupHelp')}</Text>
            <Text ff="monospace" size="sm" dir="ltr">{setup.backupCodes.join('  ')}</Text>
          </Alert>
          <Text size="sm" c="dimmed" ta="center">{t('auth.mfaCode')}</Text>
          <Center dir="ltr"><PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={(v) => void verify(v)} /></Center>
          <Button onClick={() => void verify()} loading={busy} disabled={code.length !== 6} fullWidth>{t('auth.verify')}</Button>
        </>
      )}
      <Anchor component="button" size="sm" onClick={() => void signOut()}>{t('common.signOut')}</Anchor>
    </Frame>
  )
}

/** QR code of the authenticator link, as an SVG data URL (drawn in the browser; the secret never leaves it). */
function qrSvg(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createDataURL(4, 2)
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
