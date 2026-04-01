import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { queryRows } from '../db/queries.js'
import { ContentFilterLogRowSchema } from '../db/schemas.js'
import { getBlocklistWords, setBlocklistWords } from '../services/contentFilter.js'

const router = Router()
router.use(requireAuth)

// ---------------------------------------------------------------------------
// GET /safety/log — view filtered content log (teacher+)
// ---------------------------------------------------------------------------

const LogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  severity: z.enum(['low', 'medium', 'critical']).optional(),
})

router.get('/log', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { limit, offset, severity } = LogQuerySchema.parse(req.query)

    let sql = `SELECT * FROM content_filter_log`
    const params: unknown[] = []

    if (severity) {
      params.push(severity)
      sql += ` WHERE severity = $${String(params.length)}`
    }

    sql += ` ORDER BY created_at DESC`
    params.push(limit)
    sql += ` LIMIT $${String(params.length)}`
    params.push(offset)
    sql += ` OFFSET $${String(params.length)}`

    const rows = await queryRows(ContentFilterLogRowSchema, sql, params)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /safety/blocklist — get current blocklist (admin)
// ---------------------------------------------------------------------------

router.get('/blocklist', requireRole('admin'), (_req, res) => {
  res.json({ words: getBlocklistWords() })
})

// ---------------------------------------------------------------------------
// PUT /safety/blocklist — update blocklist (admin)
// ---------------------------------------------------------------------------

const UpdateBlocklistBody = z.object({
  words: z.array(
    z.object({
      word: z.string().min(1).max(100),
      severity: z.enum(['low', 'medium', 'critical']),
    }),
  ).min(1).max(500),
})

router.put('/blocklist', requireRole('admin'), (req, res, next) => {
  try {
    const { words } = UpdateBlocklistBody.parse(req.body)
    setBlocklistWords(words)
    res.json({ words: getBlocklistWords(), count: words.length })
  } catch (err) {
    next(err)
  }
})

export { router as safetyRouter }
