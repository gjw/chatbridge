import { Button, Anchor, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import * as api from '@/lib/api'
import { authInfoStore } from '@/stores/authInfoStore'

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api.register(email, password, name)
      authInfoStore.getState().loginComplete(
        { accessToken: result.accessToken, refreshToken: result.refreshToken },
        result.user,
      )
      void navigate({ to: '/' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-full">
      <Paper shadow="md" p="xl" w={400} withBorder>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <Stack>
            <Title order={2} ta="center">Create an account</Title>

            {error && <Text c="red" size="sm">{error}</Text>}

            <TextInput
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />

            <TextInput
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />

            <PasswordInput
              label="Password"
              required
              description="Must be at least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />

            <Button type="submit" loading={loading} fullWidth>
              Create account
            </Button>

            <Text size="sm" ta="center">
              Already have an account?{' '}
              <Anchor onClick={() => void navigate({ to: '/login' })}>Sign in</Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </div>
  )
}
