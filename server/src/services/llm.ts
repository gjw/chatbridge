import { openai } from '@ai-sdk/openai'
import { streamText, wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { execute } from '../db/queries.js'

// ---------------------------------------------------------------------------
// Middleware: Content Filter (placeholder)
// ---------------------------------------------------------------------------

const contentFilter: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    // Placeholder: log that content filtering ran
    console.info('[content-filter] generate call filtered (placeholder)')
    return result
  },

  wrapStream: async ({ doStream }) => {
    const result = await doStream()
    console.info('[content-filter] stream call filtered (placeholder)')
    return result
  },
}

// ---------------------------------------------------------------------------
// Middleware: Audit Logger
// ---------------------------------------------------------------------------

const auditLogger: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapGenerate: async ({ doGenerate, params, model }) => {
    const start = Date.now()
    const result = await doGenerate()
    const durationMs = Date.now() - start
    console.info('[audit] generate', {
      model: model.modelId,
      durationMs,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    })
    return result
  },

  wrapStream: async ({ doStream, model }) => {
    const start = Date.now()
    const result = await doStream()
    // Log when stream starts — final usage is logged in the route after consumption
    console.info('[audit] stream started', {
      model: model.modelId,
      startedAt: new Date(start).toISOString(),
    })
    return result
  },
}

// ---------------------------------------------------------------------------
// Middleware: Cost Tracker
// ---------------------------------------------------------------------------

/** Writes token usage to a message row after generation completes. */
export async function persistTokenUsage(
  messageId: string,
  usage: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  await execute(
    `UPDATE messages SET token_usage = $1 WHERE id = $2`,
    [JSON.stringify(usage), messageId],
  )
  console.info('[cost-tracker] persisted usage', { messageId, ...usage })
}

// ---------------------------------------------------------------------------
// Model factory
// ---------------------------------------------------------------------------

const MIDDLEWARE_STACK: LanguageModelMiddleware[] = [
  contentFilter,
  auditLogger,
]

/**
 * Create a language model wrapped with the platform middleware stack.
 * @param modelId - OpenAI model identifier (default: gpt-4o-mini)
 */
export function createSafeLLM(modelId = 'gpt-4o-mini'): LanguageModelV3 {
  const baseModel = openai(modelId)
  return wrapLanguageModel({
    model: baseModel,
    middleware: MIDDLEWARE_STACK,
  })
}

export { streamText }
