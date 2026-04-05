import { Button, Group } from '@mantine/core'
import {
  IconActivity,
  IconApps,
  IconArrowLeft,
  IconShield,
  IconUsers,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthInfoStore } from '@/stores/authInfoStore'

interface AdminNavProps {
  current: 'activity' | 'safety' | 'apps' | 'users'
}

const navItems = [
  { key: 'activity' as const, label: 'Activity', icon: IconActivity, path: '/admin/activity' as const, minRole: 'teacher' },
  { key: 'safety' as const, label: 'Safety', icon: IconShield, path: '/admin/safety' as const, minRole: 'teacher' },
  { key: 'apps' as const, label: 'Apps', icon: IconApps, path: '/admin/apps' as const, minRole: 'teacher' },
  { key: 'users' as const, label: 'Users', icon: IconUsers, path: '/admin/users' as const, minRole: 'admin' },
]

export function AdminNav({ current }: AdminNavProps) {
  const navigate = useNavigate()
  const user = useAuthInfoStore((s) => s.user)

  return (
    <Group gap="xs" mb="lg">
      <Button
        variant="subtle"
        size="xs"
        leftSection={<IconArrowLeft size={14} />}
        onClick={() => void navigate({ to: '/server-chat' })}
      >
        Chat
      </Button>

      {navItems
        .filter((item) => {
          if (item.minRole === 'admin') return user?.role === 'admin'
          return user?.role === 'teacher' || user?.role === 'admin'
        })
        .map((item) => (
          <Button
            key={item.key}
            variant={current === item.key ? 'light' : 'subtle'}
            size="xs"
            leftSection={<item.icon size={14} />}
            onClick={() => void navigate({ to: item.path })}
          >
            {item.label}
          </Button>
        ))}
    </Group>
  )
}
