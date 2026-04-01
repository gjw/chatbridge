import {
  ActionIcon,
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
import { IconPlus, IconSend, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/lib/api'
import type { Conversation, ConversationWithMessages, SseEvent } from '@/lib/api'
import { useAuthInfoStore } from '@/stores/authInfoStore'

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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ServerChatPage() {
  const accessToken = useAuthInfoStore((s) => s.accessToken)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Redirect hint if not logged in
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
      setMessages(parseMessages(conv))
    },
    [accessToken],
  )

  // Load conversations on mount
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  // Auto-scroll on new messages
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const handleNewChat = async () => {
    const conv = await api.createConversation(accessToken)
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
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

  const handleSend = async () => {
    if (!activeId || !input.trim() || streaming) return

    const userText = input.trim()
    setInput('')

    // Optimistic: add user message
    const tempUserId = `temp-${Date.now()}`
    setMessages((prev) => [...prev, { id: tempUserId, role: 'user', text: userText }])

    // Add placeholder assistant message
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
          // Replace temp IDs with real ones
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === tempUserId) return { ...m, id: evt.userMessageId }
              if (m.id === tempAssistantId) return { ...m, id: evt.assistantMessageId }
              return m
            }),
          )
        } else if (evt.type === 'text-delta') {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (!last || last.role !== 'assistant') return prev
            return [...prev.slice(0, -1), { ...last, text: last.text + evt.text }]
          })
        }
        // 'done' and 'error' handled implicitly — streaming ends
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — ignore
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
      abortRef.current = null
      // Refresh conversation list to update timestamps
      void loadConversations()
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
      </Stack>

      {/* Chat area */}
      <Stack style={{ flex: 1 }} gap={0}>
        {activeId ? (
          <>
            <ScrollArea style={{ flex: 1 }} p="md" viewportRef={scrollRef}>
              <Stack gap="sm">
                {messages.map((m) => (
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
                    <Text size="xs" c="dimmed" mb={4}>
                      {m.role}
                    </Text>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {m.text || (streaming && m.role === 'assistant' ? '...' : '')}
                    </Text>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>

            <Group p="md" gap="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
              <TextInput
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
