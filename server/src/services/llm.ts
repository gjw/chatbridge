import { openai } from '@ai-sdk/openai'
import { streamText, wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import {
  filterText,
  filterStreamChunk,
  flushBuffer,
  logFilterMatch,
} from './contentFilter.js'

// ---------------------------------------------------------------------------
// Middleware: Content Filter (Tier 1 — keyword blocklist)
// ---------------------------------------------------------------------------

const contentFilter: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()

    // Filter text content parts
    let anyFiltered = false
    const filteredContent = result.content.map((part) => {
      if (part.type === 'text') {
        const filtered = filterText(part.text)
        if (filtered.matched.length > 0 && filtered.severity) {
          anyFiltered = true
          void logFilterMatch({
            userId: null,
            conversationId: null,
            content: part.text,
            matchedWords: filtered.matched,
            severity: filtered.severity,
            source: 'llm_output',
            actionTaken: 'redacted',
          })
          return { ...part, text: filtered.clean }
        }
      }
      return part
    })

    return anyFiltered ? { ...result, content: filteredContent } : result
  },

  wrapStream: async ({ doStream }) => {
    const result = await doStream()

    // Transform the stream to filter text deltas
    let buffer = ''
    const originalStream = result.stream
    const filteredStream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        const reader = originalStream.getReader()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              // Flush remaining buffer
              if (buffer.length > 0) {
                const flushed = flushBuffer(buffer)
                if (flushed.clean.length > 0) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: 'filter-flush',
                    delta: flushed.clean,
                  })
                }
                if (flushed.matched.length > 0 && flushed.severity) {
                  void logFilterMatch({
                    userId: null,
                    conversationId: null,
                    content: buffer,
                    matchedWords: flushed.matched,
                    severity: flushed.severity,
                    source: 'llm_output',
                    actionTaken: 'redacted',
                  })
                }
              }
              controller.close()
              break
            }

            // Only filter text-delta parts
            if (value.type === 'text-delta') {
              const filtered = filterStreamChunk(value.delta, buffer)
              buffer = filtered.buffer

              if (filtered.matched.length > 0 && filtered.severity) {
                void logFilterMatch({
                  userId: null,
                  conversationId: null,
                  content: value.delta,
                  matchedWords: filtered.matched,
                  severity: filtered.severity,
                  source: 'llm_output',
                  actionTaken: 'redacted',
                })
              }

              if (filtered.output.length > 0) {
                controller.enqueue({
                  ...value,
                  delta: filtered.output,
                })
              }
            } else {
              // Pass through non-text parts unchanged
              controller.enqueue(value)
            }
          }
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return { ...result, stream: filteredStream }
  },
}

// ---------------------------------------------------------------------------
// Middleware: Audit Logger
// ---------------------------------------------------------------------------

const auditLogger: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapGenerate: async ({ doGenerate, model }) => {
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
    console.info('[audit] stream started', {
      model: model.modelId,
      startedAt: new Date(start).toISOString(),
    })
    return result
  },
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
 * @param modelId - OpenAI model identifier (default: gpt-5.4)
 */
export function createSafeLLM(modelId = 'gpt-5.4'): LanguageModelV3 {
  const baseModel = openai(modelId)
  return wrapLanguageModel({
    model: baseModel,
    middleware: MIDDLEWARE_STACK,
  })
}

export { streamText }
