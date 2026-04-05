import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import * as api from '@/lib/api'
import type { FilterLogEntry, BlocklistWord } from '@/lib/api'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { AdminNav } from '@/components/admin/AdminNav'

export const Route = createFileRoute('/admin/safety')({
  component: SafetyDashboard,
})

function SafetyDashboard() {
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const user = useAuthInfoStore((s) => s.user)

  if (!accessToken || !user) {
    return (
      <Box p="xl">
        <Text>Please log in to access the safety dashboard.</Text>
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

  const isAdmin = user.role === 'admin'

  return (
    <Box p="xl" maw={1100} mx="auto">
      <AdminNav current="safety" />
      <Title order={2} mb="lg">
        Content Safety Dashboard
      </Title>

      <FilterLogSection accessToken={accessToken} />

      {isAdmin && (
        <>
          <Divider my="xl" />
          <BlocklistSection accessToken={accessToken} />
        </>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Filter Log Section
// ---------------------------------------------------------------------------

function FilterLogSection({ accessToken }: { accessToken: string }) {
  const [entries, setEntries] = useState<FilterLogEntry[]>([])
  const [severityFilter, setSeverityFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getFilterLog(accessToken, {
        limit: 50,
        severity: severityFilter ?? undefined,
      })
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }, [accessToken, severityFilter])

  useEffect(() => {
    void loadEntries()
    const interval = setInterval(() => void loadEntries(), 5000)
    return () => clearInterval(interval)
  }, [loadEntries])

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Filtered Content Log</Title>
        <Group gap="sm">
          <Select
            placeholder="All severities"
            data={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'critical', label: 'Critical' },
            ]}
            value={severityFilter}
            onChange={setSeverityFilter}
            clearable
            size="xs"
            w={140}
          />
          <Tooltip label="Refresh">
            <ActionIcon variant="light" onClick={() => void loadEntries()} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {entries.length === 0 ? (
        <Paper p="lg" withBorder>
          <Text c="dimmed" ta="center">
            No filtered content entries{severityFilter ? ` with severity "${severityFilter}"` : ''}.
          </Text>
        </Paper>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Student</Table.Th>
              <Table.Th>Severity</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Matched Words</Table.Th>
              <Table.Th>Content</Table.Th>
              <Table.Th>Action</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map((entry) => (
              <Table.Tr
                key={entry.id}
                style={
                  entry.severity === 'critical'
                    ? { backgroundColor: 'var(--mantine-color-red-light)' }
                    : undefined
                }
              >
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {formatTime(entry.created_at)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {entry.user_name ? (
                    <Text size="xs" fw={500}>{entry.user_name}</Text>
                  ) : (
                    <Text size="xs" c="dimmed">System</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <SeverityBadge severity={entry.severity} />
                </Table.Td>
                <Table.Td>
                  <Badge variant="outline" size="xs">
                    {entry.source.replace('_', ' ')}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {entry.matched_words.map((w, i) => (
                      <Badge key={i} size="xs" variant="light" color="gray">
                        {w}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td maw={300}>
                  {entry.conversation_id ? (
                    <Tooltip label="View conversation">
                      <Text
                        size="xs"
                        truncate
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                        onClick={() => window.open(`/server-chat?conv=${entry.conversation_id}`, '_blank')}
                      >
                        {entry.content}
                      </Text>
                    </Tooltip>
                  ) : (
                    <Text size="xs" truncate>
                      {entry.content}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant="dot" size="xs">
                    {entry.action_taken}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Blocklist Editor Section (admin only)
// ---------------------------------------------------------------------------

function BlocklistSection({ accessToken }: { accessToken: string }) {
  const [words, setWords] = useState<BlocklistWord[]>([])
  const [newWord, setNewWord] = useState('')
  const [newSeverity, setNewSeverity] = useState<string>('low')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const loadBlocklist = useCallback(async () => {
    const data = await api.getBlocklist(accessToken)
    setWords(data)
    setDirty(false)
  }, [accessToken])

  useEffect(() => {
    void loadBlocklist()
  }, [loadBlocklist])

  const handleAdd = () => {
    const w = newWord.trim().toLowerCase()
    if (!w) return
    if (words.some((e) => e.word === w)) return

    setWords((prev) => [...prev, { word: w, severity: newSeverity as BlocklistWord['severity'] }])
    setNewWord('')
    setDirty(true)
  }

  const handleRemove = (word: string) => {
    setWords((prev) => prev.filter((e) => e.word !== word))
    setDirty(true)
  }

  const handleSeverityChange = (word: string, severity: string) => {
    setWords((prev) =>
      prev.map((e) => (e.word === word ? { ...e, severity: severity as BlocklistWord['severity'] } : e)),
    )
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.updateBlocklist(accessToken, words)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Blocklist Editor</Title>
        <Button
          size="xs"
          onClick={() => void handleSave()}
          loading={saving}
          disabled={!dirty}
        >
          Save Changes
        </Button>
      </Group>

      <Paper p="sm" withBorder>
        <Group gap="sm" mb="sm">
          <TextInput
            placeholder="Add word..."
            value={newWord}
            onChange={(e) => setNewWord(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
            }}
            size="xs"
            style={{ flex: 1 }}
          />
          <Select
            data={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'critical', label: 'Critical' },
            ]}
            value={newSeverity}
            onChange={(v) => { if (v) setNewSeverity(v) }}
            size="xs"
            w={120}
          />
          <ActionIcon variant="light" onClick={handleAdd}>
            <IconPlus size={16} />
          </ActionIcon>
        </Group>

        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Word</Table.Th>
              <Table.Th>Severity</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {words.map((entry) => (
              <Table.Tr key={entry.word}>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {entry.word}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Select
                    data={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'critical', label: 'Critical' },
                    ]}
                    value={entry.severity}
                    onChange={(v) => { if (v) handleSeverityChange(entry.word, v) }}
                    size="xs"
                    w={120}
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="xs"
                    onClick={() => handleRemove(entry.word)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const color = severity === 'critical' ? 'red' : severity === 'medium' ? 'orange' : 'yellow'
  return (
    <Badge color={color} variant="filled" size="sm">
      {severity}
    </Badge>
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
