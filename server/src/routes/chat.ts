import { Router } from 'express'
import { z } from 'zod'
import type { Response as ExpressResponse } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { queryRows, queryOne, execute } from '../db/queries.js'
import { ConversationRowSchema, MessageRowSchema, AppRowSchema } from '../db/schemas.js'
import { createSafeLLM, streamText, generateTitle } from '../services/llm.js'
import { stepCountIs } from 'ai'
import { buildToolSet } from '../services/tools.js'
import { submitResult as submitToolResult } from '../services/toolCalls.js'
import { AppToolDefSchema } from '../shared/app-schemas.js'
import { filterText, filterStreamChunk, flushBuffer, logFilterMatch, classifyContent } from '../services/contentFilter.js'
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

    // Teachers and admins can view any conversation (for safety review)
    const role = req.user!.role
    const conversation = await queryOne(
      ConversationRowSchema,
      role === 'teacher' || role === 'admin'
        ? `SELECT * FROM conversations WHERE id = $1`
        : `SELECT * FROM conversations WHERE id = $1 AND user_id = $2`,
      role === 'teacher' || role === 'admin' ? [id] : [id, userId],
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
// PATCH /conversations/:id — update conversation (title)
// ---------------------------------------------------------------------------

const UpdateConversationBody = z.object({
  title: z.string().min(1).max(200),
})

router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = ConversationIdParam.parse(req.params)
    const { title } = UpdateConversationBody.parse(req.body)
    const userId = req.user!.sub
    const role = req.user!.role

    // Owner or teacher/admin can update
    const count = await execute(
      role === 'teacher' || role === 'admin'
        ? `UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2`
        : `UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
      role === 'teacher' || role === 'admin' ? [title, id] : [title, id, userId],
    )

    if (count === 0) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    res.json({ id, title })
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
        trustTier: app.trust_tier,
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

APPS — You have tools from installed apps. Each app uses a next_turn tool that drives a state machine.

HOW TO USE next_turn:
- Call next_turn to advance the app. Read the "state" field in the result to know what to do next.
- "awaiting_answer": The app provides a question or prompt. Present it to the student and wait for their answer.
- "awaiting_judgment": The app provides the student's answer and the correct answer. Judge whether the student demonstrated understanding of the concept — accept reasonable paraphrases, not just exact matches. Then call next_turn with {correct: true/false}.
- "awaiting_move": The app is waiting for a chess move or similar action. Decide your move and call next_turn with it.
- "complete" / "game_over": Summarize the results for the student.
- "idle" / "no_game" / "no_deck": The app needs to be started. Provide the required fields (deck name, color, etc.).

RULES:
- NEVER fabricate questions, answers, scores, or game state. The app provides ALL content via next_turn results.
- Once an app session is active, ALL user messages relate to that app until they explicitly ask for something else.
- If the user asks to STUDY, REVIEW, or BE QUIZZED on material from a sheet → use google-quiz__authorize_google and google-quiz__load_deck first, then google-quiz__next_turn.
- If the user asks for WORDLE → use wordle__start_game, wordle__guess_word, wordle__get_status.
- Keep text responses brief — the visual app is the primary interface.
- When judging quiz answers, be generous. Students are learning. "when a plant converts light into energy" is correct for "Process by which plants convert light energy into chemical energy."`,
      messages: llmMessages,
      abortSignal: abortController.signal,
      ...(hasTools ? { tools, stopWhen: stepCountIs(5) } : {}),
    }
    const result = streamText(streamOptions)

    // 8. Iterate full stream for both text and tool events
    let fullText = ''
    let filterBuffer = ''
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          fullText += part.text
          const filtered = filterStreamChunk(part.text, filterBuffer)
          filterBuffer = filtered.buffer
          if (filtered.output) {
            sseWrite(res, { type: 'text-delta', text: filtered.output })
          }
          if (filtered.matched.length > 0 && filtered.severity) {
            void logFilterMatch({
              userId,
              conversationId,
              content: part.text,
              matchedWords: filtered.matched,
              severity: filtered.severity,
              source: 'llm_output',
              actionTaken: filtered.severity === 'critical' ? 'logged' : 'redacted',
            })
          }
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

    // Flush remaining buffer through filter
    if (filterBuffer) {
      const flushed = flushBuffer(filterBuffer)
      if (flushed.clean) {
        sseWrite(res, { type: 'text-delta', text: flushed.clean })
      }
      if (flushed.matched.length > 0 && flushed.severity) {
        void logFilterMatch({
          userId,
          conversationId,
          content: filterBuffer,
          matchedWords: flushed.matched,
          severity: flushed.severity,
          source: 'llm_output',
          actionTaken: flushed.severity === 'critical' ? 'logged' : 'redacted',
        })
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

    // 12. Auto-generate title for new conversations (async, don't block response)
    const conv = await queryOne(
      ConversationRowSchema,
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    )
    if (conv.title === 'New Chat' && fullText.length > 0) {
      void generateTitle(content, fullText).then(async (title) => {
        if (title) {
          await execute(
            `UPDATE conversations SET title = $1 WHERE id = $2`,
            [title, conversationId],
          )
          console.info('[chat] Auto-titled conversation:', conversationId, title)
        }
      }).catch((err: unknown) => {
        console.error('[chat] Title generation failed:', err)
      })
    }

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
