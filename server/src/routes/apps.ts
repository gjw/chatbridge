import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { queryRows, queryOne, execute } from '../db/queries.js'
import { AppRowSchema, AppInstallationRowSchema } from '../db/schemas.js'
import { AppManifestSchema } from '../shared/app-schemas.js'

const router = Router()
router.use(requireAuth)

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const AppIdParam = z.object({
  id: z.string().uuid(),
})

const UpdateStatusBody = z.object({
  status: z.enum(['approved', 'blocked']),
})

// ---------------------------------------------------------------------------
// POST /apps — register a new app (admin only)
// ---------------------------------------------------------------------------

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const manifest = AppManifestSchema.parse(req.body)

    // Check slug uniqueness
    const existing = await queryRows(
      AppRowSchema,
      `SELECT * FROM apps WHERE slug = $1`,
      [manifest.slug],
    )
    if (existing.length > 0) {
      res.status(409).json({ error: `App with slug "${manifest.slug}" already exists` })
      return
    }

    const row = await queryOne(
      AppRowSchema,
      `INSERT INTO apps (slug, manifest, trust_tier, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [manifest.slug, JSON.stringify(manifest), manifest.trustTier, req.user!.sub],
    )

    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /apps — list apps
// Students: only approved + installed for them
// Teachers/Admins: all apps
// ---------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user!.sub
    const role = req.user!.role

    if (role === 'student') {
      // Students see only approved apps they have installed
      const rows = await queryRows(
        AppRowSchema,
        `SELECT a.* FROM apps a
         JOIN app_installations ai ON ai.app_id = a.id
         WHERE ai.user_id = $1 AND ai.enabled = true AND a.status = 'approved'
         ORDER BY a.created_at DESC`,
        [userId],
      )
      res.json(rows)
    } else {
      // Teachers and admins see all apps
      const rows = await queryRows(
        AppRowSchema,
        `SELECT * FROM apps ORDER BY created_at DESC`,
      )
      res.json(rows)
    }
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /apps/enabled — get user's enabled apps with tool schemas
// Used by LLM context builder to inject available tools
// ---------------------------------------------------------------------------

router.get('/enabled', async (req, res, next) => {
  try {
    const userId = req.user!.sub

    const rows = await queryRows(
      AppRowSchema,
      `SELECT a.* FROM apps a
       JOIN app_installations ai ON ai.app_id = a.id
       WHERE ai.user_id = $1 AND ai.enabled = true AND a.status = 'approved'
       ORDER BY a.created_at DESC`,
      [userId],
    )

    // Return apps with their tool schemas extracted from manifest
    const enabledApps = rows.map((app) => {
      const manifest = app.manifest as Record<string, unknown>
      return {
        id: app.id,
        slug: app.slug,
        name: (manifest as { name?: string }).name ?? app.slug,
        tools: (manifest as { tools?: unknown[] }).tools ?? [],
      }
    })

    res.json(enabledApps)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /apps/:id — get single app
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = AppIdParam.parse(req.params)
    const userId = req.user!.sub
    const role = req.user!.role

    const app = await queryOne(
      AppRowSchema,
      `SELECT * FROM apps WHERE id = $1`,
      [id],
    )

    // Students can only see approved apps they have installed
    if (role === 'student') {
      if (app.status !== 'approved') {
        res.status(404).json({ error: 'App not found' })
        return
      }
      const installations = await queryRows(
        AppInstallationRowSchema,
        `SELECT * FROM app_installations WHERE app_id = $1 AND user_id = $2 AND enabled = true`,
        [id, userId],
      )
      if (installations.length === 0) {
        res.status(404).json({ error: 'App not found' })
        return
      }
    }

    // Include installation status for the requesting user
    const installations = await queryRows(
      AppInstallationRowSchema,
      `SELECT * FROM app_installations WHERE app_id = $1 AND user_id = $2`,
      [id, userId],
    )
    const installed = installations.length > 0 && installations[0]!.enabled

    res.json({ ...app, installed })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// PATCH /apps/:id/status — approve or block an app (teacher+)
// ---------------------------------------------------------------------------

router.patch('/:id/status', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { id } = AppIdParam.parse(req.params)
    const { status } = UpdateStatusBody.parse(req.body)

    const count = await execute(
      `UPDATE apps SET status = $1, approved_by = $2 WHERE id = $3`,
      [status, req.user!.sub, id],
    )

    if (count === 0) {
      res.status(404).json({ error: 'App not found' })
      return
    }

    const updated = await queryOne(AppRowSchema, `SELECT * FROM apps WHERE id = $1`, [id])
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// POST /apps/:id/install — install app for current user (teacher+)
// ---------------------------------------------------------------------------

router.post('/:id/install', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { id } = AppIdParam.parse(req.params)
    const userId = req.user!.sub

    // Verify app exists
    await queryOne(AppRowSchema, `SELECT * FROM apps WHERE id = $1`, [id])

    // Upsert installation
    await execute(
      `INSERT INTO app_installations (app_id, user_id, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (app_id, user_id)
       DO UPDATE SET enabled = true`,
      [id, userId],
    )

    const installation = await queryOne(
      AppInstallationRowSchema,
      `SELECT * FROM app_installations WHERE app_id = $1 AND user_id = $2`,
      [id, userId],
    )

    res.status(201).json(installation)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// DELETE /apps/:id/install — uninstall app for current user (teacher+)
// ---------------------------------------------------------------------------

router.delete('/:id/install', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { id } = AppIdParam.parse(req.params)
    const userId = req.user!.sub

    const count = await execute(
      `UPDATE app_installations SET enabled = false WHERE app_id = $1 AND user_id = $2`,
      [id, userId],
    )

    if (count === 0) {
      res.status(404).json({ error: 'Installation not found' })
      return
    }

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export { router as appsRouter }
