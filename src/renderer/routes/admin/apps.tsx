import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconCheck,
  IconBan,
  IconDownload,
  IconDownloadOff,
  IconPlus,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import * as api from '@/lib/api'
import type { App } from '@/lib/api'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { AdminNav } from '@/components/admin/AdminNav'

export const Route = createFileRoute('/admin/apps')({
  component: AdminAppsPage,
})

function AdminAppsPage() {
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const user = useAuthInfoStore((s) => s.user)
  const [apps, setApps] = useState<App[]>([])
  const [registerOpened, { open: openRegister, close: closeRegister }] = useDisclosure(false)
  const [manifestJson, setManifestJson] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!accessToken || !user) {
    return (
      <Box p="xl">
        <Text>Please log in to access the admin panel.</Text>
      </Box>
    )
  }

  const isAdmin = user.role === 'admin'
  const isTeacherOrAdmin = user.role === 'teacher' || user.role === 'admin'

  const loadApps = useCallback(async () => {
    const list = await api.listApps(accessToken)
    setApps(list)
  }, [accessToken])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    void loadApps()
  }, [loadApps])

  const handleRegister = async () => {
    setRegisterError('')
    setLoading(true)
    try {
      const manifest: unknown = JSON.parse(manifestJson)
      await api.registerApp(accessToken, manifest)
      closeRegister()
      setManifestJson('')
      void loadApps()
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        setRegisterError('Invalid JSON')
      } else if (err instanceof Error) {
        setRegisterError(err.message)
      } else {
        setRegisterError('Registration failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (appId: string, status: 'approved' | 'blocked') => {
    await api.updateAppStatus(accessToken, appId, status)
    void loadApps()
  }

  const handleInstall = async (appId: string) => {
    await api.installApp(accessToken, appId)
    void loadApps()
  }

  const handleUninstall = async (appId: string) => {
    await api.uninstallApp(accessToken, appId)
    void loadApps()
  }

  return (
    <Box p="xl" maw={1000} mx="auto">
      <AdminNav current="apps" />
      <Group justify="space-between" mb="lg">
        <Title order={2}>App Registry</Title>
        {isAdmin && (
          <Button leftSection={<IconPlus size={16} />} onClick={openRegister}>
            Register App
          </Button>
        )}
      </Group>

      {apps.length === 0 ? (
        <Paper p="xl" withBorder>
          <Text c="dimmed" ta="center">
            No apps registered yet.
            {isAdmin && ' Click "Register App" to add one.'}
          </Text>
        </Paper>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Slug</Table.Th>
              <Table.Th>Trust Tier</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Tools</Table.Th>
              {isTeacherOrAdmin && <Table.Th>Actions</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {apps.map((app) => {
              const manifest = app.manifest as Record<string, unknown> | null
              const name = (manifest as { name?: string } | null)?.name ?? app.slug
              const tools = (manifest as { tools?: unknown[] } | null)?.tools ?? []

              return (
                <Table.Tr key={app.id}>
                  <Table.Td fw={500}>{name}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" ff="monospace">
                      {app.slug}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <TierBadge tier={app.trust_tier} />
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={app.status} />
                  </Table.Td>
                  <Table.Td>{tools.length}</Table.Td>
                  {isTeacherOrAdmin && (
                    <Table.Td>
                      <Group gap={4}>
                        {app.status !== 'approved' && (
                          <Tooltip label="Approve">
                            <ActionIcon
                              variant="light"
                              color="green"
                              onClick={() => void handleStatusChange(app.id, 'approved')}
                            >
                              <IconCheck size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {app.status !== 'blocked' && (
                          <Tooltip label="Block">
                            <ActionIcon
                              variant="light"
                              color="red"
                              onClick={() => void handleStatusChange(app.id, 'blocked')}
                            >
                              <IconBan size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        <Tooltip label="Install">
                          <ActionIcon
                            variant="light"
                            color="blue"
                            onClick={() => void handleInstall(app.id)}
                          >
                            <IconDownload size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Uninstall">
                          <ActionIcon
                            variant="light"
                            color="gray"
                            onClick={() => void handleUninstall(app.id)}
                          >
                            <IconDownloadOff size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      )}

      {/* Register App Modal */}
      <Modal opened={registerOpened} onClose={closeRegister} title="Register App" size="lg">
        <Stack>
          <Text size="sm" c="dimmed">
            Paste the app manifest JSON below. It will be validated against the schema.
          </Text>

          <Textarea
            label="Manifest JSON"
            placeholder='{"slug": "my-app", "name": "My App", ...}'
            minRows={12}
            autosize
            maxRows={20}
            value={manifestJson}
            onChange={(e) => setManifestJson(e.currentTarget.value)}
            styles={{ input: { fontFamily: 'monospace', fontSize: '13px' } }}
          />

          {registerError && (
            <Text c="red" size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              {registerError}
            </Text>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeRegister}>
              Cancel
            </Button>
            <Button onClick={() => void handleRegister()} loading={loading}>
              Register
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'yellow',
    approved: 'green',
    blocked: 'red',
  }
  return (
    <Badge color={colorMap[status] ?? 'gray'} variant="light" size="sm">
      {status}
    </Badge>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const colorMap: Record<string, string> = {
    internal: 'blue',
    external_public: 'cyan',
    external_auth: 'violet',
  }
  const labelMap: Record<string, string> = {
    internal: 'Internal',
    external_public: 'Public',
    external_auth: 'OAuth',
  }
  return (
    <Badge color={colorMap[tier] ?? 'gray'} variant="dot" size="sm">
      {labelMap[tier] ?? tier}
    </Badge>
  )
}
