import { Alert, Badge, Center, Image, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { formatMoney } from '../lib/format'
import { supabase } from '../lib/supabase'

/** Public page behind the QR code on printed documents. No sign-in; shows only what the paper already shows. */
export function VerifyPage() {
  const { token } = useParams()
  const q = useQuery({
    queryKey: ['verify', token],
    queryFn: async () => {
      if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return null
      const { data, error } = await supabase.rpc('verify_document', { p_token: token })
      if (error) throw error
      return ((data ?? []) as { company: string; document_type: string; number: string; revision: number; doc_date: string; party: string | null; total: number; currency: string; status: string }[])[0] ?? null
    },
  })
  const d = q.data
  return (
    <Center mih="100dvh" p="md" bg="var(--mantine-color-navy-0)">
      <Paper withBorder p="xl" radius="lg" w="100%" maw={460}>
        <Stack>
          <Center><Image src="/logo.png" alt="EnvironmSafe" h={56} w="auto" fit="contain" /></Center>
          <Title order={4} ta="center">Document verification · التحقق من المستند</Title>
          {q.isLoading && <Text c="dimmed" ta="center">…</Text>}
          {!q.isLoading && !d && <Alert color="red">This code does not match any document issued by EnvironmSafe. · هذا الرمز لا يطابق أي مستند صادر.</Alert>}
          {d && (
            <>
              <Center>
                <Badge size="xl" color={d.status === 'valid' ? 'green' : 'red'}>{d.status === 'valid' ? 'Genuine · صحيح' : d.status}</Badge>
              </Center>
              <Table>
                <Table.Tbody>
                  <Table.Tr><Table.Td>Issued by</Table.Td><Table.Td fw={600}>{d.company}</Table.Td></Table.Tr>
                  <Table.Tr><Table.Td>Document</Table.Td><Table.Td fw={600}>{d.document_type} {d.number}{d.revision ? ` Rev.${d.revision}` : ''}</Table.Td></Table.Tr>
                  <Table.Tr><Table.Td>Date</Table.Td><Table.Td>{d.doc_date}</Table.Td></Table.Tr>
                  {d.party && <Table.Tr><Table.Td>To / from</Table.Td><Table.Td>{d.party}</Table.Td></Table.Tr>}
                  <Table.Tr><Table.Td>Total</Table.Td><Table.Td fw={700}>{formatMoney(d.total, d.currency)}</Table.Td></Table.Tr>
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed">Compare these details with the paper. If anything differs, contact support@environmsafe.com.</Text>
            </>
          )}
        </Stack>
      </Paper>
    </Center>
  )
}
