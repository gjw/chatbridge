import { jsonSchema } from 'ai'
import type { Tool, ToolExecutionOptions } from '@ai-sdk/provider-utils'
import type { Response as ExpressResponse } from 'express'
import type { AppToolDef } from '../shared/app-schemas.js'
import { waitForResult } from './toolCalls.js'
import { isOpen, recordFailure, recordSuccess } from './circuitBreaker.js'
import { execute as dbExecute } from '../db/queries.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolSetContext {
  /** The requesting user's ID */
  userId: string
  /** The SSE response to send tool-call events to */
  res: ExpressResponse
  /** SSE write helper */
  sseWrite: (data: Record<string, unknown>) => void
}

// ---------------------------------------------------------------------------
// Convert AppToolDef[] → AI SDK ToolSet
// ---------------------------------------------------------------------------

/**
 * Build an AI SDK ToolSet from an app's tool definitions.
 * Each tool's execute function:
 * 1. Checks the circuit breaker
 * 2. Sends a tool-call SSE event to the client
 * 3. Waits for the client to POST the result back
 * 4. Logs the invocation to the database
 */
export function buildToolSet(
  apps: Array<{ appId: string; slug: string; entryUrl: string; tools: AppToolDef[] }>,
  ctx: ToolSetContext,
): Record<string, Tool<unknown, unknown>> {
  const toolSet: Record<string, Tool<unknown, unknown>> = {}

  for (const app of apps) {
    if (isOpen(app.slug)) {
      console.warn(`[tools] Skipping app "${app.slug}" — circuit breaker open`)
      continue
    }

    for (const appTool of app.tools) {
      // Namespace tool names to avoid collisions: "appSlug__toolName"
      const toolKey = `${app.slug}__${appTool.name}`

      const appId = app.appId
      const appSlug = app.slug
      const entryUrl = app.entryUrl
      const rendersUi = appTool.rendersUi
      const toolName = appTool.name

      toolSet[toolKey] = {
        description: `[${appSlug}] ${appTool.description}`,
        inputSchema: jsonSchema(appTool.parameters),
        execute: async (args: unknown, options: ToolExecutionOptions): Promise<unknown> => {
          const start = Date.now()
          const toolCallId = options.toolCallId

          // Send tool-call event to client
          ctx.sseWrite({
            type: 'tool-call',
            toolCallId,
            toolName,
            args,
            appSlug,
            appId,
            appEntryUrl: entryUrl,
            rendersUi,
          })

          try {
            // Wait for client to submit result
            const result = await waitForResult(toolCallId)
            const durationMs = Date.now() - start

            recordSuccess(appSlug)

            // Log invocation
            void logInvocation({
              appId,
              userId: ctx.userId,
              toolName,
              parameters: args,
              result,
              status: 'success',
              durationMs,
            })

            return result
          } catch (err: unknown) {
            const durationMs = Date.now() - start
            const errorMsg = err instanceof Error ? err.message : 'Unknown error'

            recordFailure(appSlug)

            void logInvocation({
              appId,
              userId: ctx.userId,
              toolName,
              parameters: args,
              result: { error: errorMsg },
              status: errorMsg.includes('timed out') ? 'timeout' : 'error',
              durationMs,
            })

            return `Tool error: ${errorMsg}`
          }
        },
      }
    }
  }

  return toolSet
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

async function logInvocation(params: {
  appId: string
  userId: string
  toolName: string
  parameters: unknown
  result: unknown
  status: 'pending' | 'success' | 'error' | 'timeout'
  durationMs: number
}): Promise<void> {
  try {
    await dbExecute(
      `INSERT INTO tool_invocations (app_id, user_id, tool_name, parameters, result, status, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.appId,
        params.userId,
        params.toolName,
        JSON.stringify(params.parameters),
        JSON.stringify(params.result),
        params.status,
        params.durationMs,
      ],
    )
  } catch (err) {
    console.error('[tools] Failed to log invocation:', err)
  }
}
