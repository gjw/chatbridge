import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { queryRows } from '../db/queries.js'
import { pool } from '../db/pool.js'
import { AppRowSchema, AppInstallationRowSchema } from '../db/schemas.js'
import { env } from '../env.js'

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

    // For external_auth apps, inject the stored OAuth token (refresh if expired)
    let headers: Record<string, string> | undefined = requestHeaders
    const app = apps[0]!
    if (app.trust_tier === 'external_auth') {
      const tokenResult = await pool.query(
        `SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id = $1 AND app_id = $2`,
        [userId, appId],
      )
      const tokenRow = tokenResult.rows[0] as
        | { access_token: string; refresh_token: string | null; expires_at: Date | null }
        | undefined

      if (tokenRow) {
        let accessToken = tokenRow.access_token

        // Refresh if expired or expiring within 5 minutes
        const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)
        if (tokenRow.refresh_token && tokenRow.expires_at && tokenRow.expires_at < fiveMinFromNow) {
          const refreshed = await refreshGoogleToken(tokenRow.refresh_token, userId, appId)
          if (refreshed) {
            accessToken = refreshed
          }
        }

        headers = { ...headers, Authorization: `Bearer ${accessToken}` }
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

// ---------------------------------------------------------------------------
// Token refresh helper
// ---------------------------------------------------------------------------

const GoogleTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
})

async function refreshGoogleToken(
  refreshToken: string,
  userId: string,
  appId: string,
): Promise<string | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      console.error('[proxy] Google token refresh failed:', response.status)
      return null
    }

    const data = GoogleTokenResponse.parse(await response.json())
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)

    await pool.query(
      `UPDATE oauth_tokens SET access_token = $1, expires_at = $2
       WHERE user_id = $3 AND app_id = $4`,
      [data.access_token, expiresAt, userId, appId],
    )

    console.info('[proxy] Refreshed Google token for user:', userId)
    return data.access_token
  } catch (err) {
    console.error('[proxy] Token refresh error:', err)
    return null
  }
}

export { router as proxyRouter }
