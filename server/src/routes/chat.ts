import { Router } from 'express'
import { z } from 'zod'
import type { Response as ExpressResponse } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { queryRows, queryOne, execute } from '../db/queries.js'
import { ConversationRowSchema, MessageRowSchema } from '../db/schemas.js'
import { createSafeLLM, streamText } from '../services/llm.js'
import type { ModelMessage } from '@ai-sdk/provider-utils'

const router = Router()
router.use(requireAuth)

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const CreateConversationBody = z.object({
  title: z.string().min(1).max(200).optional(),
})

const SendMessageBody = z.object({
  content: z.string().min(1).max(50_000),
})

const ConversationIdParam = z.object({
  id: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// POST /conversations — create conversation
// ---------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const { title } = CreateConversationBody.parse(req.body)
    const userId = req.user!.sub

    const row = await queryOne(
      ConversationRowSchema,
      `INSERT INTO conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING *`,
      [userId, title ?? 'New Chat'],
    )

    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /conversations — list conversations for current user
// ---------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.sub

    const rows = await queryRows(
      ConversationRowSchema,
      `SELECT * FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    )

    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /conversations/:id — get conversation with messages
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = ConversationIdParam.parse(req.params)
    const userId = req.user!.sub

    const conversation = await queryOne(
      ConversationRowSchema,
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )

    const messages = await queryRows(
      MessageRowSchema,
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id],
    )

    res.json({ ...conversation, messages })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// DELETE /conversations/:id — delete conversation
// ---------------------------------------------------------------------------

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = ConversationIdParam.parse(req.params)
    const userId = req.user!.sub

    const count = await execute(
      `DELETE FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, userId],
    )

    if (count === 0) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// POST /conversations/:id/messages — send message, stream LLM response
// ---------------------------------------------------------------------------

router.post('/:id/messages', async (req, res, next) => {
  try {
    const { id: conversationId } = ConversationIdParam.parse(req.params)
    const { content } = SendMessageBody.parse(req.body)
    const userId = req.user!.sub

    // Verify conversation belongs to user
    await queryOne(
      ConversationRowSchema,
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    )

    // 1. Persist user message
    const userMsg = await queryOne(
      MessageRowSchema,
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)
       RETURNING *`,
      [conversationId, JSON.stringify([{ type: 'text', text: content }])],
    )

    // 2. Fetch conversation history for context
    const historyRows = await queryRows(
      MessageRowSchema,
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId],
    )

    // 3. Convert DB rows to AI SDK messages
    const llmMessages: ModelMessage[] = historyRows.map((row) => {
      const parts = row.content as Array<{ type: string; text: string }>
      const text = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n')

      if (row.role === 'user') {
        return { role: 'user' as const, content: text }
      }
      if (row.role === 'assistant') {
        return { role: 'assistant' as const, content: text }
      }
      // system / tool messages — treat as system
      return { role: 'system' as const, content: text }
    })

    // 4. Create placeholder assistant message in DB
    const assistantMsg = await queryOne(
      MessageRowSchema,
      `INSERT INTO messages (conversation_id, role, content, model)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING *`,
      [conversationId, JSON.stringify([{ type: 'text', text: '' }]), 'gpt-4o-mini'],
    )

    // 5. Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    // Send the message IDs so the client knows what was created
    sseWrite(res, {
      type: 'message-ids',
      userMessageId: userMsg.id,
      assistantMessageId: assistantMsg.id,
    })

    // 6. Stream LLM response
    const model = createSafeLLM()
    const abortController = new AbortController()
    req.on('close', () => abortController.abort())

    const result = streamText({
      model,
      system: 'You are ChatBridge, a helpful AI assistant for students. Be concise, accurate, and educational.',
      messages: llmMessages,
      abortSignal: abortController.signal,
    })

    let fullText = ''
    for await (const chunk of result.textStream) {
      fullText += chunk
      sseWrite(res, { type: 'text-delta', text: chunk })
    }

    // 7. Get usage and persist
    const usage = await result.usage
    sseWrite(res, {
      type: 'done',
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    })

    // 8. Update assistant message with full text and usage
    await execute(
      `UPDATE messages SET content = $1, token_usage = $2 WHERE id = $3`,
      [
        JSON.stringify([{ type: 'text', text: fullText }]),
        JSON.stringify({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
        assistantMsg.id,
      ],
    )

    // 9. Update conversation timestamp
    await execute(
      `UPDATE conversations SET updated_at = now() WHERE id = $1`,
      [conversationId],
    )

    res.end()
  } catch (err) {
    // If headers already sent (streaming started), end the stream with error
    if (res.headersSent) {
      sseWrite(res, { type: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      res.end()
      return
    }
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sseWrite(res: ExpressResponse, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export { router as chatRouter }
