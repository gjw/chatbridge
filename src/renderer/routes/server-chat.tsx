import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconLogout, IconPlus, IconSend, IconShield, IconTrash } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/lib/api'
import type { Conversation, ConversationWithMessages, SseEvent } from '@/lib/api'
import { useAuthInfoStore } from '@/stores/authInfoStore'
import { AppHost } from '@/components/apps/AppHost'
import type { AppHostHandle } from '@/components/apps/AppHost'

export const Route = createFileRoute('/server-chat')({
  component: ServerChatPage,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
}

interface ActiveToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  appSlug: string
  appId: string
  appEntryUrl: string
  rendersUi: boolean
  status: 'invoking' | 'done' | 'error'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ServerChatPage() {
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const user = useAuthInfoStore((s) => s.user)
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activeToolCall, setActiveToolCall] = useState<ActiveToolCall | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const appHostRef = useRef<AppHostHandle>(null)

  if (!accessToken) {
    return (
      <Box p="xl">
        <Text>Please log in first to use Server Chat.</Text>
      </Box>
    )
  }

  const loadConversations = useCallback(async () => {
    const list = await api.listConversations(accessToken)
    setConversations(list)
  }, [accessToken])

  const loadConversation = useCallback(
    async (id: string) => {
      const conv = await api.getConversation(accessToken, id)
      setActiveId(id)
      setActiveToolCall(null)
      setMessages(parseMessages(conv))
    },
    [accessToken],
  )

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const handleNewChat = async () => {
    const conv = await api.createConversation(accessToken)
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
    setActiveToolCall(null)
    setMessages([])
  }

  const handleDelete = async (id: string) => {
    await api.deleteConversation(accessToken, id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
    }
  }

  const handleToolCall = async (evt: SseEvent & { type: 'tool-call' }) => {
    if (!activeId) return

    // If same app is already mounted, just update the tool call metadata (don't remount iframe)
    setActiveToolCall((prev) => {
      if (prev && prev.appId === evt.appId) {
        return { ...prev, toolCallId: evt.toolCallId, toolName: evt.toolName, args: evt.args, status: 'invoking' as const }
      }
      return {
        toolCallId: evt.toolCallId,
        toolName: evt.toolName,
        args: evt.args,
        appSlug: evt.appSlug,
        appId: evt.appId,
        appEntryUrl: evt.appEntryUrl,
        rendersUi: evt.rendersUi,
        status: 'invoking' as const,
      }
    })

    // Add a tool status message
    setMessages((prev) => [
      ...prev,
      { id: `tool-${evt.toolCallId}`, role: 'tool' as const, text: `Invoking ${evt.appSlug}/${evt.toolName}...` },
    ])

    try {
      // Wait for AppHost to be ready (may already be ready if iframe is reused)
      const waitForReady = (): Promise<void> =>
        new Promise((resolve) => {
          const check = () => {
            if (appHostRef.current?.isReady) {
              resolve()
            } else {
              setTimeout(check, 100)
            }
          }
          check()
          setTimeout(resolve, 10_000)
        })

      await waitForReady()

      if (!appHostRef.current?.isReady) {
        // App didn't signal ready — submit error
        await api.submitToolResult(accessToken, activeId, evt.toolCallId, { error: 'App failed to initialize' })
        setActiveToolCall((prev) => prev ? { ...prev, status: 'error' } : null)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `tool-${evt.toolCallId}` ? { ...m, text: `${evt.appSlug}/${evt.toolName}: App failed to initialize` } : m,
          ),
        )
        return
      }

      const result = await appHostRef.current.invoke(evt.toolName, evt.args)

      // Submit result back to server
      await api.submitToolResult(accessToken, activeId, evt.toolCallId, result)

      setActiveToolCall((prev) => prev ? { ...prev, status: 'done' } : null)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `tool-${evt.toolCallId}`
            ? { ...m, text: `${evt.appSlug}/${evt.toolName}: ${JSON.stringify(result)}` }
            : m,
        ),
      )
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      // Submit error as result so LLM can continue
      await api.submitToolResult(accessToken, activeId, evt.toolCallId, { error: errorMsg })

      setActiveToolCall((prev) => prev ? { ...prev, status: 'error' } : null)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `tool-${evt.toolCallId}` ? { ...m, text: `${evt.appSlug}/${evt.toolName}: Error — ${errorMsg}` } : m,
        ),
      )
    }
  }

  const handleSend = async () => {
    if (!activeId || !input.trim() || streaming) return

    const userText = input.trim()
    setInput('')

    const tempUserId = `temp-${Date.now()}`
    setMessages((prev) => [...prev, { id: tempUserId, role: 'user', text: userText }])

    const tempAssistantId = `temp-assistant-${Date.now()}`
    setMessages((prev) => [...prev, { id: tempAssistantId, role: 'assistant', text: '' }])

    setStreaming(true)
    abortRef.current = new AbortController()

    try {
      for await (const event of api.sendMessage(
        accessToken,
        activeId,
        userText,
        abortRef.current.signal,
      )) {
        const evt = event as SseEvent
        if (evt.type === 'message-ids') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === tempUserId) return { ...m, id: evt.userMessageId }
              if (m.id === tempAssistantId) return { ...m, id: evt.assistantMessageId }
              return m
            }),
          )
        } else if (evt.type === 'text-delta') {
          setMessages((prev) => {
            // Find the last assistant message (may not be the very last entry due to tool messages)
            const lastAssistantIdx = prev.findLastIndex((m) => m.role === 'assistant')
            if (lastAssistantIdx === -1) return prev
            const updated = [...prev]
            const msg = updated[lastAssistantIdx]
            updated[lastAssistantIdx] = { ...msg, text: msg.text + evt.text }
            return updated
          })
        } else if (evt.type === 'tool-call') {
          // Handle tool invocation asynchronously — the server's execute()
          // is blocked waiting for our result
          void handleToolCall(evt)
        } else if (evt.type === 'tool-result') {
          // Mark tool as done but keep iframe visible
          setActiveToolCall((prev) => prev ? { ...prev, status: 'done' } : null)
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant') return prev
          return [...prev.slice(0, -1), { ...last, text: last.text + `\n\n[Error: ${msg}]` }]
        })
      }
    } finally {
      setStreaming(false)
      // Don't clear activeToolCall here — keep iframe visible
      abortRef.current = null
      void loadConversations()
      inputRef.current?.focus()
    }
  }

  return (
    <Group align="stretch" h="100vh" gap={0} wrap="nowrap">
      {/* Sidebar */}
      <Stack
        w={260}
        p="sm"
        gap="xs"
        style={{ borderRight: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        <Group justify="space-between">
          <Title order={5}>Conversations</Title>
          <ActionIcon variant="light" onClick={() => void handleNewChat()}>
            <IconPlus size={16} />
          </ActionIcon>
        </Group>

        <ScrollArea style={{ flex: 1 }}>
          <Stack gap={4}>
            {conversations.map((c) => (
              <Group key={c.id} gap={4} wrap="nowrap">
                <Button
                  variant={c.id === activeId ? 'filled' : 'subtle'}
                  size="xs"
                  style={{ flex: 1, justifyContent: 'flex-start', overflow: 'hidden' }}
                  onClick={() => void loadConversation(c.id)}
                >
                  <Text size="xs" truncate>
                    {c.title}
                  </Text>
                </Button>
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  color="red"
                  onClick={() => void handleDelete(c.id)}
                >
                  <IconTrash size={12} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </ScrollArea>

        <Stack gap={4} mt="auto" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
          {user?.role !== 'student' && (
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconShield size={14} />}
              onClick={() => void navigate({ to: '/admin/safety' })}
              fullWidth
              justify="flex-start"
            >
              Safety Dashboard
            </Button>
          )}
          <Button
            variant="subtle"
            size="xs"
            color="red"
            leftSection={<IconLogout size={14} />}
            onClick={() => {
              authInfoStore.getState().logout()
              window.location.href = '/login'
            }}
            fullWidth
            justify="flex-start"
          >
            Sign out ({user?.name ?? 'unknown'})
          </Button>
        </Stack>
      </Stack>

      {/* Chat area */}
      <Stack style={{ flex: 1 }} gap={0}>
        {activeId ? (
          <>
            <ScrollArea style={{ flex: 1 }} p="md" viewportRef={scrollRef}>
              <Stack gap="sm">
                {messages.filter((m) => m.role !== 'tool').map((m) => (
                  <Paper
                    key={m.id}
                    p="sm"
                    radius="md"
                    withBorder
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                      backgroundColor:
                        m.role === 'user'
                          ? 'var(--mantine-color-blue-light)'
                          : 'var(--mantine-color-default)',
                    }}
                  >
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {m.text || (streaming && m.role === 'assistant' ? '...' : '')}
                    </Text>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>

            {/* App iframe (shown when a tool call is active with rendersUi) */}
            {activeToolCall?.rendersUi && (
              <Box
                p="sm"
                style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
              >
                <Text size="xs" c="dimmed" mb={4}>
                  App: {activeToolCall.appSlug}
                </Text>
                <AppHost
                  ref={appHostRef}
                  appId={activeToolCall.appId}
                  entryUrl={activeToolCall.appEntryUrl}
                  sessionId={activeId}
                  accessToken={accessToken}
                />
              </Box>
            )}

            <Group p="md" gap="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
              <TextInput
                ref={inputRef}
                style={{ flex: 1 }}
                placeholder="Type a message..."
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                disabled={streaming}
                rightSection={streaming ? <Loader size={16} /> : undefined}
              />
              <ActionIcon
                size="lg"
                variant="filled"
                onClick={() => void handleSend()}
                disabled={streaming || !input.trim()}
              >
                <IconSend size={18} />
              </ActionIcon>
            </Group>
          </>
        ) : (
          <Box p="xl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <Stack align="center" gap="sm">
              <Title order={3} c="dimmed">
                Server Chat Demo
              </Title>
              <Text c="dimmed">Create or select a conversation to start chatting.</Text>
              <Button onClick={() => void handleNewChat()}>New Chat</Button>
            </Stack>
          </Box>
        )}
      </Stack>
    </Group>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMessages(conv: ConversationWithMessages): DisplayMessage[] {
  return conv.messages.map((m) => {
    const parts = m.content as Array<{ type: string; text: string }> | null
    const text = parts
      ?.filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ?? ''
    return { id: m.id, role: m.role, text }
  })
}
