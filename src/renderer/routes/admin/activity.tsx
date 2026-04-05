import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconRefresh, IconSearch } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '@/lib/api'
import type { ActivityEntry, ActivityStats } from '@/lib/api'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { AdminNav } from '@/components/admin/AdminNav'

export const Route = createFileRoute('/admin/activity')({
  component: ActivityDashboard,
})

function ActivityDashboard() {
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const user = useAuthInfoStore((s) => s.user)

  if (!accessToken || !user) {
    return (
      <Box p="xl">
        <Text>Please log in to access the activity dashboard.</Text>
      </Box>
    )
  }

  if (user.role === 'student') {
    return (
      <Box p="xl">
        <Text>Access denied. Teachers and admins only.</Text>
      </Box>
    )
  }

  return <ActivityContent accessToken={accessToken} />
}

function ActivityContent({ accessToken }: { accessToken: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [studentFilter, setStudentFilter] = useState('')
  const [appFilter, setAppFilter] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [activity, statsData] = await Promise.all([
        api.getActivity(accessToken, {
          limit: 50,
          student: studentFilter || undefined,
          app: appFilter ?? undefined,
        }),
        api.getActivityStats(accessToken),
      ])
      setEntries(activity)
      setStats(statsData)
    } finally {
      setLoading(false)
    }
  }, [accessToken, studentFilter, appFilter])

  useEffect(() => {
    void loadData()
    const interval = setInterval(() => void loadData(), 30_000)
    return () => clearInterval(interval)
  }, [loadData])

  const appOptions = useMemo(
    () =>
      (stats?.toolStats ?? []).map((s) => ({
        value: s.app_slug,
        label: s.app_slug,
      })),
    [stats],
  )

  return (
    <Box p="xl" maw={1200} mx="auto">
      <AdminNav current="activity" />
      <Group justify="space-between" mb="lg">
        <Title order={2}>Student Activity</Title>
        <Tooltip label="Refresh">
          <ActionIcon variant="light" onClick={() => void loadData()} loading={loading}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Stats cards */}
      {stats && (
        <SimpleGrid cols={3} mb="lg">
          <StatCard label="Students" value={stats.totalStudents} />
          <StatCard label="Conversations" value={stats.totalConversations} />
          <StatCard label="Tool calls today" value={stats.todayInvocations} />
        </SimpleGrid>
      )}

      {/* Filters */}
      <Group gap="sm" mb="md">
        <TextInput
          placeholder="Search student..."
          leftSection={<IconSearch size={14} />}
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.currentTarget.value)}
          size="xs"
          w={220}
        />
        <Select
          placeholder="All apps"
          data={appOptions}
          value={appFilter}
          onChange={setAppFilter}
          clearable
          size="xs"
          w={160}
        />
      </Group>

      {/* Conversation table */}
      {entries.length === 0 ? (
        <Paper p="lg" withBorder>
          <Text c="dimmed" ta="center">
            No student conversations found.
          </Text>
        </Paper>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Student</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Messages</Table.Th>
              <Table.Th>Apps Used</Table.Th>
              <Table.Th>Last Active</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((entry) => (
              <Table.Tr
                key={entry.id}
                style={{ cursor: 'pointer' }}
                onClick={() => window.open(`/server-chat?conv=${entry.id}`, '_blank')}
              >
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {entry.student_name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {entry.student_email}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" truncate maw={300}>
                    {entry.title}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{entry.message_count}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {entry.apps_used.map((slug) => (
                      <Badge key={slug} size="xs" variant="light">
                        {slug}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {formatTime(entry.updated_at)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Tool invocation summary */}
      {stats && stats.toolStats.length > 0 && (
        <Stack gap="sm" mt="xl">
          <Title order={4}>Tool Invocation Summary</Title>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>App</Table.Th>
                <Table.Th>Total</Table.Th>
                <Table.Th>Success</Table.Th>
                <Table.Th>Error</Table.Th>
                <Table.Th>Timeout</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {stats.toolStats.map((s) => (
                <Table.Tr key={s.app_slug}>
                  <Table.Td>
                    <Badge variant="light">{s.app_slug}</Badge>
                  </Table.Td>
                  <Table.Td>{s.total}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="green">
                      {s.success}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={s.error > 0 ? 'red' : undefined}>
                      {s.error}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={s.timeout > 0 ? 'orange' : undefined}>
                      {s.timeout}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Paper p="md" withBorder>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={4}>
        {value}
      </Text>
    </Paper>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
