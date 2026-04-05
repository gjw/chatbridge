import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { queryRows } from '../db/queries.js'

const router = Router()
router.use(requireAuth)
router.use(requireRole('teacher', 'admin'))

// ---------------------------------------------------------------------------
// GET /admin/activity — student conversation list with tool usage stats
// ---------------------------------------------------------------------------

const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  student: z.string().optional(),
  since: z.string().optional(),
  app: z.string().optional(),
})

const ActivityRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  student_name: z.string(),
  student_email: z.string(),
  message_count: z.coerce.number(),
  apps_used: z.array(z.string()),
  created_at: z.date(),
  updated_at: z.date(),
})

router.get('/activity', async (req, res, next) => {
  try {
    const { limit, offset, student, since, app } = ActivityQuerySchema.parse(req.query)

    const conditions: string[] = ["u.role = 'student'"]
    const params: unknown[] = []

    if (student) {
      params.push(`%${student}%`)
      conditions.push(`(u.name ILIKE $${String(params.length)} OR u.email ILIKE $${String(params.length)})`)
    }

    if (since) {
      params.push(since)
      conditions.push(`c.updated_at >= $${String(params.length)}::timestamptz`)
    }

    if (app) {
      params.push(app)
      conditions.push(`EXISTS (
        SELECT 1 FROM tool_invocations ti2
        JOIN apps a2 ON ti2.app_id = a2.id
        JOIN messages m2 ON ti2.message_id = m2.id
        WHERE m2.conversation_id = c.id AND a2.slug = $${String(params.length)}
      )`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    params.push(limit)
    const limitParam = `$${String(params.length)}`
    params.push(offset)
    const offsetParam = `$${String(params.length)}`

    const sql = `
      SELECT c.id, c.title, c.created_at, c.updated_at,
             u.name AS student_name, u.email AS student_email,
             COUNT(DISTINCT m.id)::int AS message_count,
             COALESCE(
               array_agg(DISTINCT a.slug) FILTER (WHERE a.slug IS NOT NULL),
               '{}'
             ) AS apps_used
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN messages m ON m.conversation_id = c.id
      LEFT JOIN tool_invocations ti ON ti.message_id = m.id
      LEFT JOIN apps a ON ti.app_id = a.id
      ${where}
      GROUP BY c.id, u.name, u.email
      ORDER BY c.updated_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `

    const rows = await queryRows(ActivityRowSchema, sql, params)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /admin/stats — summary stats + tool invocation aggregates
// ---------------------------------------------------------------------------

const StatsSchema = z.object({
  totalStudents: z.number(),
  totalConversations: z.number(),
  todayInvocations: z.number(),
  toolStats: z.array(z.object({
    app_slug: z.string(),
    total: z.number(),
    success: z.number(),
    error: z.number(),
    timeout: z.number(),
  })),
})

router.get('/stats', async (_req, res, next) => {
  try {
    const CountSchema = z.object({ count: z.coerce.number() })

    const [studentsResult, convsResult, invocResult] = await Promise.all([
      queryRows(CountSchema, `SELECT COUNT(*)::int AS count FROM users WHERE role = 'student'`),
      queryRows(CountSchema, `SELECT COUNT(*)::int AS count FROM conversations c JOIN users u ON c.user_id = u.id WHERE u.role = 'student'`),
      queryRows(CountSchema, `SELECT COUNT(*)::int AS count FROM tool_invocations WHERE created_at >= CURRENT_DATE`),
    ])

    const ToolStatRow = z.object({
      app_slug: z.string(),
      total: z.coerce.number(),
      success: z.coerce.number(),
      error: z.coerce.number(),
      timeout: z.coerce.number(),
    })

    const toolStats = await queryRows(
      ToolStatRow,
      `SELECT a.slug AS app_slug,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ti.status = 'success')::int AS success,
              COUNT(*) FILTER (WHERE ti.status = 'error')::int AS error,
              COUNT(*) FILTER (WHERE ti.status = 'timeout')::int AS timeout
       FROM tool_invocations ti
       JOIN apps a ON ti.app_id = a.id
       GROUP BY a.slug
       ORDER BY total DESC`,
    )

    const stats: z.infer<typeof StatsSchema> = {
      totalStudents: studentsResult[0]?.count ?? 0,
      totalConversations: convsResult[0]?.count ?? 0,
      todayInvocations: invocResult[0]?.count ?? 0,
      toolStats,
    }

    res.json(stats)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /admin/users — user list (teacher: students only, admin: all)
// ---------------------------------------------------------------------------

const UsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

const UserListRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['student', 'teacher', 'admin']),
  created_at: z.date(),
  conversation_count: z.coerce.number(),
})

router.get('/users', async (req, res, next) => {
  try {
    const { limit, offset } = UsersQuerySchema.parse(req.query)
    const isAdmin = req.user!.role === 'admin'

    const roleFilter = isAdmin ? '' : "WHERE u.role = 'student'"

    const rows = await queryRows(
      UserListRowSchema,
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              COUNT(c.id)::int AS conversation_count
       FROM users u
       LEFT JOIN conversations c ON c.user_id = u.id
       ${roleFilter}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

export { router as adminRouter }
