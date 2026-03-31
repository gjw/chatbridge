import { z } from 'zod'

// ============================================================
// Platform → App messages
// ============================================================

export const BridgeInitSchema = z.object({
  type: z.literal('bridge:init'),
  appId: z.string().min(1),
  sessionId: z.string().min(1),
  theme: z.object({
    mode: z.enum(['light', 'dark']),
    accent: z.string().min(1),
  }),
})
export type BridgeInit = z.infer<typeof BridgeInitSchema>

export const BridgeToolInvokeSchema = z.object({
  type: z.literal('bridge:tool:invoke'),
  invocationId: z.string().min(1),
  toolName: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
})
export type BridgeToolInvoke = z.infer<typeof BridgeToolInvokeSchema>

export const BridgeDestroySchema = z.object({
  type: z.literal('bridge:destroy'),
})
export type BridgeDestroy = z.infer<typeof BridgeDestroySchema>

// ============================================================
// App → Platform messages
// ============================================================

export const BridgeReadySchema = z.object({
  type: z.literal('bridge:ready'),
})
export type BridgeReady = z.infer<typeof BridgeReadySchema>

export const BridgeToolResultSchema = z.object({
  type: z.literal('bridge:tool:result'),
  invocationId: z.string().min(1),
  result: z.unknown(),
})
export type BridgeToolResult = z.infer<typeof BridgeToolResultSchema>

export const BridgeToolErrorSchema = z.object({
  type: z.literal('bridge:tool:error'),
  invocationId: z.string().min(1),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
})
export type BridgeToolError = z.infer<typeof BridgeToolErrorSchema>

export const BridgeUiResizeSchema = z.object({
  type: z.literal('bridge:ui:resize'),
  height: z.number().int().positive(),
})
export type BridgeUiResize = z.infer<typeof BridgeUiResizeSchema>

export const BridgeApiRequestSchema = z.object({
  type: z.literal('bridge:api:request'),
  requestId: z.string().min(1),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
})
export type BridgeApiRequest = z.infer<typeof BridgeApiRequestSchema>

// ============================================================
// Platform → App (response)
// ============================================================

export const BridgeApiResponseSchema = z.object({
  type: z.literal('bridge:api:response'),
  requestId: z.string().min(1),
  status: z.number().int(),
  body: z.unknown(),
})
export type BridgeApiResponse = z.infer<typeof BridgeApiResponseSchema>

// ============================================================
// Discriminated unions
// ============================================================

export const PlatformToAppMessageSchema = z.discriminatedUnion('type', [
  BridgeInitSchema,
  BridgeToolInvokeSchema,
  BridgeDestroySchema,
  BridgeApiResponseSchema,
])
export type PlatformToAppMessage = z.infer<typeof PlatformToAppMessageSchema>

export const AppToPlatformMessageSchema = z.discriminatedUnion('type', [
  BridgeReadySchema,
  BridgeToolResultSchema,
  BridgeToolErrorSchema,
  BridgeUiResizeSchema,
  BridgeApiRequestSchema,
])
export type AppToPlatformMessage = z.infer<typeof AppToPlatformMessageSchema>

export const BridgeMessageSchema = z.discriminatedUnion('type', [
  // Platform → App
  BridgeInitSchema,
  BridgeToolInvokeSchema,
  BridgeDestroySchema,
  BridgeApiResponseSchema,
  // App → Platform
  BridgeReadySchema,
  BridgeToolResultSchema,
  BridgeToolErrorSchema,
  BridgeUiResizeSchema,
  BridgeApiRequestSchema,
])
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>
