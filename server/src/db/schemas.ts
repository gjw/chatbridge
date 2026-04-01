import { z } from 'zod'

export const UserRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  password: z.string(),
  role: z.enum(['student', 'teacher', 'admin']),
  name: z.string(),
  created_at: z.date(),
})
export type UserRow = z.infer<typeof UserRowSchema>

export const ConversationRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
})
export type ConversationRow = z.infer<typeof ConversationRowSchema>

export const MessageRowSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.unknown(),
  model: z.string().nullable(),
  token_usage: z.unknown().nullable(),
  created_at: z.date(),
})
export type MessageRow = z.infer<typeof MessageRowSchema>

export const AppRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  manifest: z.unknown(),
  status: z.enum(['pending', 'approved', 'blocked']),
  trust_tier: z.enum(['internal', 'external_public', 'external_auth']),
  created_by: z.string().uuid().nullable(),
  approved_by: z.string().uuid().nullable(),
  created_at: z.date(),
})
export type AppRow = z.infer<typeof AppRowSchema>

export const AppInstallationRowSchema = z.object({
  id: z.string().uuid(),
  app_id: z.string().uuid(),
  user_id: z.string().uuid(),
  enabled: z.boolean(),
  created_at: z.date(),
})
export type AppInstallationRow = z.infer<typeof AppInstallationRowSchema>

export const ToolInvocationRowSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid().nullable(),
  app_id: z.string().uuid().nullable(),
  user_id: z.string().uuid().nullable(),
  tool_name: z.string(),
  parameters: z.unknown().nullable(),
  result: z.unknown().nullable(),
  status: z.enum(['pending', 'success', 'error', 'timeout']),
  duration_ms: z.number().int().nullable(),
  created_at: z.date(),
})
export type ToolInvocationRow = z.infer<typeof ToolInvocationRowSchema>

export const OauthTokenRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  app_id: z.string().uuid(),
  provider: z.string(),
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  expires_at: z.date().nullable(),
  created_at: z.date(),
})
export type OauthTokenRow = z.infer<typeof OauthTokenRowSchema>

export const ConversationSummaryRowSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  user_id: z.string().uuid(),
  summary: z.string(),
  topics: z.array(z.string()),
  apps_used: z.array(z.string()),
  created_at: z.date(),
})
export type ConversationSummaryRow = z.infer<typeof ConversationSummaryRowSchema>
