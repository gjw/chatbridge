import { Router } from 'express'
import { z } from 'zod'
import type { Response as ExpressResponse } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { queryRows, queryOne, execute } from '../db/queries.js'
import { ConversationRowSchema, MessageRowSchema, AppRowSchema } from '../db/schemas.js'
import { createSafeLLM, streamText } from '../services/llm.js'
import { stepCountIs } from 'ai'
import { buildToolSet } from '../services/tools.js'
import { submitResult as submitToolResult } from '../services/toolCalls.js'
import { AppToolDefSchema } from '../shared/app-schemas.js'
import { filterText, logFilterMatch, classifyContent } from '../services/contentFilter.js'
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

const ToolResultBody = z.object({
  result: z.unknown(),
})

const ToolResultParams = z.object({
  id: z.string().uuid(),
  toolCallId: z.string().min(1),
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

    // 1b. Filter user input for safety — Tier 1 (keyword) + Tier 2 (classifier)
    const userFilter = filterText(content)
    if (userFilter.matched.length > 0 && userFilter.severity) {
      void logFilterMatch({
        userId,
        conversationId,
        content,
        matchedWords: userFilter.matched,
        severity: userFilter.severity,
        source: 'user_input',
        actionTaken: 'logged',
      })
    }

    // Tier 2: Run sentiment classifier if Tier 1 didn't flag critical
    if (userFilter.severity !== 'critical') {
      void classifyContent(content).then((classification) => {
        if (classification) {
          void logFilterMatch({
            userId,
            conversationId,
            content,
            matchedWords: [classification.reason],
            severity: classification.severity ?? 'medium',
            source: 'user_input',
            actionTaken: 'logged',
          })
        }
      })
    }

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
      return { role: 'system' as const, content: text }
    })

    // 4. Fetch user's enabled apps and build tool set
    const enabledApps = await queryRows(
      AppRowSchema,
      `SELECT a.* FROM apps a
       JOIN app_installations ai ON ai.app_id = a.id
       WHERE ai.user_id = $1 AND ai.enabled = true AND a.status = 'approved'`,
      [userId],
    )

    const write = (data: Record<string, unknown>) => sseWrite(res, data)

    const appToolData = enabledApps.map((app) => {
      const manifest = app.manifest as Record<string, unknown>
      const rawTools = (manifest as { tools?: unknown[] }).tools ?? []
      const tools = rawTools
        .map((t) => AppToolDefSchema.safeParse(t))
        .filter((r) => r.success)
        .map((r) => r.data)
      return {
        appId: app.id,
        slug: app.slug,
        entryUrl: (manifest as { entryUrl?: string }).entryUrl ?? '',
        tools,
      }
    })

    const tools = buildToolSet(appToolData, {
      userId,
      res,
      sseWrite: write,
    })

    const hasTools = Object.keys(tools).length > 0

    // 5. Create placeholder assistant message in DB
    const assistantMsg = await queryOne(
      MessageRowSchema,
      `INSERT INTO messages (conversation_id, role, content, model)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING *`,
      [conversationId, JSON.stringify([{ type: 'text', text: '' }]), 'gpt-5.4'],
    )

    // 6. Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    sseWrite(res, {
      type: 'message-ids',
      userMessageId: userMsg.id,
      assistantMessageId: assistantMsg.id,
    })

    // 7. Stream LLM response with tools
    const model = createSafeLLM()
    const abortController = new AbortController()
    req.on('close', () => abortController.abort())

    const streamOptions = {
      model,
      system: `You are ChatBridge, a helpful AI assistant for students. Be concise, accurate, and educational.

MANDATORY: You MUST call the appropriate tool for EVERY game action, EVERY time, with NO exceptions.
- Wordle: ALWAYS call guess_word for every word the user says during a game. You do NOT know the target word — only the tool does. If you respond without calling guess_word, your answer is WRONG.
- Chess: ALWAYS call move_piece for every move. ALWAYS call get_board_state if you need to check the position. Never draw ASCII boards — the app renders the board visually.
- NEVER fabricate, simulate, or make up game results. You have NO ability to evaluate guesses or validate moves without the tools.
- Keep text responses brief — the visual app is the primary interface.`,
      messages: llmMessages,
      abortSignal: abortController.signal,
      ...(hasTools ? { tools, stopWhen: stepCountIs(5) } : {}),
    }
    const result = streamText(streamOptions)

    // 8. Iterate full stream for both text and tool events
    let fullText = ''
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          fullText += part.text
          sseWrite(res, { type: 'text-delta', text: part.text })
          break
        }
        case 'tool-call': {
          // tool-call SSE is sent by the execute function in buildToolSet
          // Just log here
          console.info('[chat] Tool call:', part.toolName, part.toolCallId)
          break
        }
        case 'tool-result': {
          sseWrite(res, {
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.output,
          })
          break
        }
        case 'error': {
          sseWrite(res, { type: 'error', error: String(part.error) })
          break
        }
        // Ignore other part types (text-start, text-end, step markers, etc.)
        default:
          break
      }
    }

    // 9. Get usage and persist
    const usage = await result.usage
    sseWrite(res, {
      type: 'done',
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    })

    // 10. Update assistant message with full text and usage
    await execute(
      `UPDATE messages SET content = $1, token_usage = $2 WHERE id = $3`,
      [
        JSON.stringify([{ type: 'text', text: fullText }]),
        JSON.stringify({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
        assistantMsg.id,
      ],
    )

    // 11. Update conversation timestamp
    await execute(
      `UPDATE conversations SET updated_at = now() WHERE id = $1`,
      [conversationId],
    )

    res.end()
  } catch (err) {
    if (res.headersSent) {
      sseWrite(res, { type: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
      res.end()
      return
    }
    next(err)
  }
})

// ---------------------------------------------------------------------------
// POST /conversations/:id/tool-result/:toolCallId — submit tool result
// ---------------------------------------------------------------------------

router.post('/:id/tool-result/:toolCallId', async (req, res, next) => {
  try {
    const { id: conversationId, toolCallId } = ToolResultParams.parse(req.params)
    const { result } = ToolResultBody.parse(req.body)
    const userId = req.user!.sub

    // Verify conversation belongs to user
    await queryOne(
      ConversationRowSchema,
      `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    )

    const found = submitToolResult(toolCallId, result)
    if (!found) {
      res.status(404).json({ error: 'Tool call not found or already completed' })
      return
    }

    res.status(204).end()
  } catch (err) {
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
