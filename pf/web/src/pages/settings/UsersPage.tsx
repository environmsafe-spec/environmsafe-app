import { Alert, Badge, Button, CloseButton, Group, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthProvider'
import { localName } from '../../lib/format'
import { supabase } from '../../lib/supabase'

interface UserRole { user_id: string; role_code: string }
interface Profile { user_id: string; email: string | null; full_name: string | null; is_active: boolean }
interface Role { code: string; name_en: string; name_ar: string | null; requires_mfa: boolean }

export function UsersPage() {
  const { t, i18n } = useTranslation()
  const { company, can, session } = useAuth()
  const qc = useQueryClient()
  const cid = company?.company_id
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string | null>('data_entry')
  const manage = can('users.manage')

  const data = useQuery({
    queryKey: ['users', cid],
    enabled: Boolean(cid),
    queryFn: async () => {
      const [ur, roles] = await Promise.all([
        supabase.from('user_roles').select('user_id, role_code').eq('company_id', cid!),
        supabase.from('roles').select('*').order('sort'),
      ])
      if (ur.error) throw ur.error
      const ids = [...new Set((ur.data as UserRole[]).map((r) => r.user_id))]
      const profiles = ids.length ? (await supabase.from('user_profiles').select('*').in('user_id', ids)).data ?? [] : []
      return { userRoles: ur.data as UserRole[], roles: roles.data as Role[], profiles: profiles as Profile[] }
    },
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] })
  const onError = (e: Error) => notifications.show({ color: 'red', message: e.message })

  const grant = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('grant_role_by_email', { p_company: cid, p_email: email, p_role: role })
      if (error) throw error
    },
    onSuccess: () => { setEmail(''); refresh() }, onError,
  })
  const revoke = useMutation({
    mutationFn: async (r: UserRole) => {
      const { error } = await supabase.from('user_roles').delete().match({ company_id: cid, user_id: r.user_id, role_code: r.role_code })
      if (error) throw error
    },
    onSuccess: refresh, onError,
  })
  const setActive = useMutation({
    mutationFn: async ({ user, active }: { user: string; active: boolean }) => {
      const { error } = await supabase.rpc('set_user_active', { p_company: cid, p_user: user, p_active: active })
      if (error) throw error
    },
    onSuccess: refresh, onError,
  })

  const roles = data.data?.roles ?? []
  const roleName = (code: string) => { const r = roles.find((x) => x.code === code); return r ? localName(r, i18n.language) : code }

  return (
    <Stack>
      <Title order={3}>{t('settings.users')}</Title>
      <Alert variant="light">{t('settings.invite')}</Alert>
      {manage && (
        <Group align="flex-end" wrap="wrap">
          <TextInput label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} miw={240} />
          <Select label={t('settings.role')} value={role} onChange={setRole} allowDeselect={false}
            data={roles.map((r) => ({ value: r.code, label: localName(r, i18n.language) }))} />
          <Button onClick={() => grant.mutate()} loading={grant.isPending} disabled={!email || !role}>{t('settings.grant')}</Button>
        </Group>
      )}
      <Table striped verticalSpacing="sm">
        <Table.Tbody>
          {(data.data?.profiles ?? []).map((p) => (
            <Table.Tr key={p.user_id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
              <Table.Td>
                <Text fw={600}>{p.full_name}</Text>
                <Text size="xs" c="dimmed">{p.email}</Text>
              </Table.Td>
              <Table.Td>
                <Group gap={6}>
                  {(data.data?.userRoles ?? []).filter((r) => r.user_id === p.user_id).map((r) => (
                    <Badge key={r.role_code} variant="light" rightSection={manage &&
                      <CloseButton size="xs" aria-label={t('settings.revoke')} onClick={() => revoke.mutate(r)} />}>
                      {roleName(r.role_code)}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
              <Table.Td ta="end">
                {manage && p.user_id !== session?.user.id && (
                  <Button size="xs" variant="subtle" color={p.is_active ? 'red' : 'green'}
                    onClick={() => setActive.mutate({ user: p.user_id, active: !p.is_active })}>
                    {p.is_active ? t('settings.deactivate') : t('settings.activate')}
                  </Button>)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
