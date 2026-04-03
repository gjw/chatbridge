import { z } from 'zod'
import { ofetch, type FetchOptions } from 'ofetch'
import { authInfoStore } from '@/stores/authInfoStore'

/** Wrap ofetch to handle 401 by logging out and redirecting to /login */
async function authedFetch<T>(url: string, opts: FetchOptions): Promise<T> {
  try {
    return await ofetch<T>(url, opts)
  } catch (err: unknown) {
    if (
      err != null &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status: number }).status === 401 &&
      !url.includes('/auth/')
    ) {
      authInfoStore.getState().logout()
      window.location.href = '/login'
    }
    throw err
  }
}

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['student', 'teacher', 'admin']),
})
export type User = z.infer<typeof UserSchema>

const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserSchema,
})

const TokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
})

const MeResponseSchema = z.object({
  user: UserSchema,
})

export async function login(email: string, password: string) {
  const raw = await ofetch('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  return AuthResponseSchema.parse(raw)
}

export async function register(email: string, password: string, name: string, role?: string) {
  const raw = await ofetch('/api/auth/register', {
    method: 'POST',
    body: { email, password, name, role },
  })
  return AuthResponseSchema.parse(raw)
}

export async function refreshTokens(refreshToken: string) {
  const raw = await ofetch('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  })
  return TokenResponseSchema.parse(raw)
}

export async function getMe(accessToken: string) {
  const raw = await ofetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return MeResponseSchema.parse(raw)
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const ConversationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Conversation = z.infer<typeof ConversationSchema>

const MessageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.unknown(),
  model: z.string().nullable(),
  token_usage: z.unknown().nullable(),
  created_at: z.string(),
})
export type ApiMessage = z.infer<typeof MessageSchema>

const ConversationWithMessagesSchema = ConversationSchema.extend({
  messages: z.array(MessageSchema),
})
export type ConversationWithMessages = z.infer<typeof ConversationWithMessagesSchema>

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export async function createConversation(token: string, title?: string) {
  const raw = await authedFetch('/api/conversations', {
    method: 'POST',
    headers: authHeaders(token),
    body: title ? { title } : {},
  })
  return ConversationSchema.parse(raw)
}

export async function listConversations(token: string) {
  const raw = await authedFetch('/api/conversations', {
    headers: authHeaders(token),
  })
  return z.array(ConversationSchema).parse(raw)
}

export async function getConversation(token: string, id: string) {
  const raw = await authedFetch(`/api/conversations/${id}`, {
    headers: authHeaders(token),
  })
  return ConversationWithMessagesSchema.parse(raw)
}

export async function deleteConversation(token: string, id: string) {
  await authedFetch(`/api/conversations/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

/**
 * Send a message and return an SSE event source.
 * Yields parsed SSE data objects as they arrive.
 */
export async function* sendMessage(
  token: string,
  conversationId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
    signal,
  })

  if (!response.ok) {
    if (response.status === 401) {
      authInfoStore.getState().logout()
      window.location.href = '/login'
    }
    const text = await response.text()
    throw new Error(`Send message failed: ${response.status} ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data: unknown = JSON.parse(line.slice(6))
        yield data as SseEvent
      }
    }
  }
}

export type SseEvent =
  | { type: 'message-ids'; userMessageId: string; assistantMessageId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown>; appSlug: string; appId: string; appEntryUrl: string; trustTier?: string; rendersUi: boolean }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; error: string }

export async function submitToolResult(
  token: string,
  conversationId: string,
  toolCallId: string,
  result: unknown,
): Promise<void> {
  await authedFetch(`/api/conversations/${conversationId}/tool-result/${toolCallId}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: { result },
  })
}

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

const AppSchema = z.object({
  id: z.string(),
  slug: z.string(),
  manifest: z.unknown(),
  status: z.enum(['pending', 'approved', 'blocked']),
  trust_tier: z.enum(['internal', 'external_public', 'external_auth']),
  created_by: z.string().nullable(),
  approved_by: z.string().nullable(),
  created_at: z.string(),
})
export type App = z.infer<typeof AppSchema>

const AppWithInstallSchema = AppSchema.extend({
  installed: z.boolean().optional(),
})
export type AppWithInstall = z.infer<typeof AppWithInstallSchema>

const AppInstallationSchema = z.object({
  id: z.string(),
  app_id: z.string(),
  user_id: z.string(),
  enabled: z.boolean(),
  created_at: z.string(),
})

const EnabledAppSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  tools: z.array(z.unknown()),
})
export type EnabledApp = z.infer<typeof EnabledAppSchema>

export async function registerApp(token: string, manifest: unknown) {
  const raw = await authedFetch('/api/apps', {
    method: 'POST',
    headers: authHeaders(token),
    body: manifest as Record<string, unknown>,
  })
  return AppSchema.parse(raw)
}

export async function listApps(token: string) {
  const raw = await authedFetch('/api/apps', {
    headers: authHeaders(token),
  })
  return z.array(AppSchema).parse(raw)
}

export async function getApp(token: string, id: string) {
  const raw = await authedFetch(`/api/apps/${id}`, {
    headers: authHeaders(token),
  })
  return AppWithInstallSchema.parse(raw)
}

export async function updateAppStatus(token: string, id: string, status: 'approved' | 'blocked') {
  const raw = await authedFetch(`/api/apps/${id}/status`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: { status },
  })
  return AppSchema.parse(raw)
}

export async function installApp(token: string, id: string) {
  const raw = await authedFetch(`/api/apps/${id}/install`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  return AppInstallationSchema.parse(raw)
}

export async function uninstallApp(token: string, id: string) {
  await authedFetch(`/api/apps/${id}/install`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

export async function getEnabledApps(token: string) {
  const raw = await authedFetch('/api/apps/enabled', {
    headers: authHeaders(token),
  })
  return z.array(EnabledAppSchema).parse(raw)
}

// ---------------------------------------------------------------------------
// API Proxy
// ---------------------------------------------------------------------------

const ProxyResponseSchema = z.object({
  status: z.number(),
  body: z.unknown(),
})

export async function proxyApiRequest(
  token: string,
  appId: string,
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  headers?: Record<string, string>,
  body?: unknown,
) {
  const raw = await authedFetch('/api/proxy', {
    method: 'POST',
    headers: authHeaders(token),
    body: { appId, url, method, headers, body },
  })
  return ProxyResponseSchema.parse(raw)
}

// ---------------------------------------------------------------------------
// Safety / Content Filter
// ---------------------------------------------------------------------------

const FilterLogEntrySchema = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  user_name: z.string().nullable().optional(),
  conversation_id: z.string().nullable(),
  content: z.string(),
  matched_words: z.array(z.string()),
  severity: z.enum(['low', 'medium', 'critical']),
  source: z.enum(['llm_output', 'tool_result', 'user_input']),
  action_taken: z.enum(['redacted', 'blocked', 'logged']),
  created_at: z.string(),
})
export type FilterLogEntry = z.infer<typeof FilterLogEntrySchema>

const BlocklistWordSchema = z.object({
  word: z.string(),
  severity: z.enum(['low', 'medium', 'critical']),
})
export type BlocklistWord = z.infer<typeof BlocklistWordSchema>

export async function getFilterLog(
  token: string,
  opts?: { limit?: number; offset?: number; severity?: string },
) {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  if (opts?.severity) params.set('severity', opts.severity)
  const qs = params.toString()

  const raw = await authedFetch(`/api/safety/log${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(token),
  })
  return z.array(FilterLogEntrySchema).parse(raw)
}

export async function getBlocklist(token: string) {
  const raw = await authedFetch('/api/safety/blocklist', {
    headers: authHeaders(token),
  }) as { words: unknown[] }
  return z.array(BlocklistWordSchema).parse(raw.words)
}

export async function updateBlocklist(token: string, words: BlocklistWord[]) {
  const raw = await authedFetch('/api/safety/blocklist', {
    method: 'PUT',
    headers: authHeaders(token),
    body: { words },
  })
  return raw as { count: number }
}
