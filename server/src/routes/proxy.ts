import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { queryRows } from '../db/queries.js'
import { pool } from '../db/pool.js'
import { AppRowSchema, AppInstallationRowSchema } from '../db/schemas.js'

const router = Router()
router.use(requireAuth)

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const ProxyRequestBody = z.object({
  appId: z.string().uuid(),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
})

// ---------------------------------------------------------------------------
// POST /proxy — proxy an API request on behalf of an app
// ---------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const { appId, url, method, headers: requestHeaders, body } = ProxyRequestBody.parse(req.body)
    const userId = req.user!.sub

    // Verify app exists and is approved
    const apps = await queryRows(
      AppRowSchema,
      `SELECT * FROM apps WHERE id = $1 AND status = 'approved'`,
      [appId],
    )
    if (apps.length === 0) {
      res.status(404).json({ error: 'App not found or not approved' })
      return
    }

    // Verify user has the app installed
    const installations = await queryRows(
      AppInstallationRowSchema,
      `SELECT * FROM app_installations WHERE app_id = $1 AND user_id = $2 AND enabled = true`,
      [appId, userId],
    )
    if (installations.length === 0) {
      res.status(403).json({ error: 'App not installed for this user' })
      return
    }

    // Validate URL is HTTPS or localhost (safety check)
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
      res.status(400).json({ error: 'Proxy only supports HTTPS URLs or localhost' })
      return
    }

    // For external_auth apps, inject the stored OAuth token
    let headers: Record<string, string> | undefined = requestHeaders
    const app = apps[0]!
    if (app.trust_tier === 'external_auth') {
      const tokenResult = await pool.query(
        `SELECT access_token FROM oauth_tokens WHERE user_id = $1 AND app_id = $2`,
        [userId, appId],
      )
      const tokenRow = tokenResult.rows[0] as { access_token: string } | undefined
      if (tokenRow) {
        headers = { ...headers, Authorization: `Bearer ${tokenRow.access_token}` }
      }
    }

    // Make the proxied request
    const fetchHeaders = headers ? new Headers(headers) : new Headers()

    if (body !== undefined && method !== 'GET') {
      if (!fetchHeaders.has('content-type')) {
        fetchHeaders.set('Content-Type', 'application/json')
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
      ...(body !== undefined && method !== 'GET'
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    }

    const upstream = await fetch(url, fetchOptions)

    // Try to parse response as JSON, fall back to text
    let responseBody: unknown
    const contentType = upstream.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      responseBody = await upstream.json() as unknown
    } else {
      responseBody = await upstream.text()
    }

    res.json({
      status: upstream.status,
      body: responseBody,
    })
  } catch (err) {
    next(err)
  }
})

export { router as proxyRouter }
