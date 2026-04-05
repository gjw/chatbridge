import {
  Badge,
  Box,
  Paper,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import * as api from '@/lib/api'
import type { UserListEntry } from '@/lib/api'
import { authInfoStore, useAuthInfoStore } from '@/stores/authInfoStore'
import { AdminNav } from '@/components/admin/AdminNav'

export const Route = createFileRoute('/admin/users')({
  component: UsersPage,
  beforeLoad: () => {
    if (!authInfoStore.getState().accessToken) throw redirect({ to: '/login' })
  },
})

function UsersPage() {
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const user = useAuthInfoStore((s) => s.user)
  const [users, setUsers] = useState<UserListEntry[]>([])
  const [loading, setLoading] = useState(false)

  if (!accessToken || !user) {
    return (
      <Box p="xl">
        <Text>Please log in.</Text>
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

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getUsers(accessToken)
      setUsers(data)
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  return (
    <Box p="xl" maw={900} mx="auto">
      <AdminNav current="users" />
      <Title order={2} mb="lg">
        Users
      </Title>

      {users.length === 0 ? (
        <Paper p="lg" withBorder>
          <Text c="dimmed" ta="center">
            No users found.
          </Text>
        </Paper>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Conversations</Table.Th>
              <Table.Th>Joined</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {u.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {u.email}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <RoleBadge role={u.role} />
                </Table.Td>
                <Table.Td>{u.conversation_count}</Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {formatDate(u.created_at)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Box>
  )
}

function RoleBadge({ role }: { role: string }) {
  const color = role === 'admin' ? 'red' : role === 'teacher' ? 'blue' : 'gray'
  return (
    <Badge color={color} variant="light" size="sm">
      {role}
    </Badge>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}
