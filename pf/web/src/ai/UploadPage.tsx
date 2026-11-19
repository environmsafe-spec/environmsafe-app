import { Alert, Badge, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core'
import { IconCamera, IconFileUpload, IconListCheck } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

type Status = 'uploading' | 'reading' | 'done' | 'failed'
interface Job { key: string; name: string; status: Status; documentId?: string; kind?: string; warnings?: string[]; error?: string }

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'

/** Upload one or many vouchers; each becomes a pre-filled draft to check (never posted automatically). */
export function UploadPage() {
  const { t } = useTranslation()
  const { company } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [jobs, setJobs] = useState<Job[]>([])
  const set = (key: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)))

  const process = async (file: File) => {
    const key = crypto.randomUUID()
    setJobs((js) => [...js, { key, name: file.name, status: 'uploading' }])
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error(t('ai.tooBig'))
      const path = `${company!.company_id}/inbox/${key}-${file.name.replace(/[^\w.\-]+/g, '_')}`
      const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw up.error
      set(key, { status: 'reading' })
      const { data, error } = await supabase.functions.invoke('extract-voucher', { body: { company_id: company!.company_id, storage_path: path, file_name: file.name } })
      if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message)
      set(key, { status: 'done', documentId: data.document_id as string, kind: data.kind as string, warnings: (data.warnings as string[]) ?? [] })
      void qc.invalidateQueries({ queryKey: ['home'] })
    } catch (e) {
      set(key, { status: 'failed', error: (e as Error).message })
    }
  }

  const onFiles = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    // Two at a time: fast enough, gentle on the phone connection.
    void (async () => {
      for (let i = 0; i < files.length; i += 2) await Promise.all(files.slice(i, i + 2).map(process))
    })()
  }

  const ready = jobs.filter((j) => j.status === 'done' && j.documentId)
  const busy = jobs.some((j) => j.status === 'uploading' || j.status === 'reading')
  const reviewAll = () => navigate(`/entries/${ready[0].documentId}?batch=${ready.map((j) => j.documentId).join(',')}`)

  return (
    <Stack maw={760}>
      <Title order={3}>{t('home.upload')}</Title>
      <Text size="sm" c="dimmed">{t('ai.help')}</Text>
      <Group>
        <Button component="label" size="lg" leftSection={<IconCamera size={22} />}>
          {t('ai.camera')}
          <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => onFiles(e.currentTarget.files)} />
        </Button>
        <Button component="label" size="lg" variant="light" leftSection={<IconFileUpload size={22} />}>
          {t('ai.files')}
          <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => onFiles(e.currentTarget.files)} />
        </Button>
      </Group>

      {jobs.map((j) => (
        <Card key={j.key} withBorder padding="sm">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text fw={600} truncate>{j.name}</Text>
              {j.status === 'done' && <Text size="sm" c="dimmed">{t(`ai.kind.${j.kind}`, { defaultValue: j.kind })}</Text>}
              {j.status === 'failed' && <Text size="sm" c="red">{j.error}</Text>}
              {(j.warnings ?? []).map((w) => <Text key={w} size="xs" c="orange">• {w}</Text>)}
            </Stack>
            {j.status === 'uploading' && <Group gap={6}><Loader size="xs" /><Text size="sm">{t('ai.uploading')}</Text></Group>}
            {j.status === 'reading' && <Group gap={6}><Loader size="xs" color="gold" /><Text size="sm">{t('ai.reading')}</Text></Group>}
            {j.status === 'done' && <Button size="xs" variant="light" onClick={() => navigate(`/entries/${j.documentId}`)}>{t('ai.open')}</Button>}
            {j.status === 'failed' && <Badge color="red">{t('ai.failed')}</Badge>}
          </Group>
        </Card>
      ))}

      {ready.length > 1 && !busy && (
        <Button leftSection={<IconListCheck size={18} />} onClick={reviewAll}>{t('ai.reviewAll', { n: ready.length })}</Button>
      )}
      {jobs.length > 0 && <Alert variant="light" color="gold">{t('ai.neverPosts')}</Alert>}
    </Stack>
  )
}
