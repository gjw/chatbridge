import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../env.js'
import { requireAuth } from '../middleware/auth.js'
import { verifyToken } from '../utils/jwt.js'
import { pool } from '../db/pool.js'

const router = Router()

/** Get the public base URL, respecting X-Forwarded-Proto from nginx */
function getBaseUrl(req: import('express').Request): string {
  const proto = req.get('x-forwarded-proto') ?? req.protocol
  return `${proto}://${req.get('host')}`
}

// ---------------------------------------------------------------------------
// In-memory state store for OAuth CSRF protection (state → userId + provider)
// Entries expire after 10 minutes.
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000
const pendingStates = new Map<string, { userId: string; provider: string; createdAt: number }>()

function cleanExpiredStates(): void {
  const now = Date.now()
  for (const [state, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      pendingStates.delete(state)
    }
  }
}

// ============================================================
// GitHub OAuth
// ============================================================

router.get('/github/authorize', (req, res) => {
  if (!env.GITHUB_CLIENT_ID) {
    res.status(500).json({ error: 'GitHub OAuth not configured' })
    return
  }

  const token = typeof req.query.token === 'string' ? req.query.token : ''
  let userId: string
  try {
    userId = verifyToken(token).sub
  } catch {
    res.status(401).send('Invalid or missing token')
    return
  }

  cleanExpiredStates()
  const state = crypto.randomBytes(20).toString('hex')
  pendingStates.set(state, { userId, provider: 'github', createdAt: Date.now() })

  const callbackUrl = `${getBaseUrl(req)}/api/oauth/github/callback`
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: 'read:user repo',
    state,
  })

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
})

router.get('/github/callback', async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query)

    const entry = pendingStates.get(state)
    if (!entry || entry.provider !== 'github') {
      res.status(400).send('Invalid or expired OAuth state')
      return
    }
    pendingStates.delete(state)
    if (Date.now() - entry.createdAt > STATE_TTL_MS) {
      res.status(400).send('OAuth state expired')
      return
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    })
    const tokenData = z.object({ access_token: z.string() }).parse(await tokenResponse.json())

    const appResult = await pool.query(`SELECT id FROM apps WHERE slug = 'github' AND status = 'approved'`)
    if (appResult.rows.length === 0) { res.status(500).send('GitHub app not registered'); return }
    const appId = (appResult.rows[0] as { id: string }).id

    await pool.query(
      `INSERT INTO oauth_tokens (user_id, app_id, provider, access_token)
       VALUES ($1, $2, 'github', $3)
       ON CONFLICT (user_id, app_id, provider)
       DO UPDATE SET access_token = EXCLUDED.access_token, created_at = now()`,
      [entry.userId, appId, tokenData.access_token],
    )

    res.send(successPage('GitHub Connected!'))
  } catch (err) { next(err) }
})

router.get('/github/status', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 1 FROM oauth_tokens ot JOIN apps a ON a.id = ot.app_id
       WHERE ot.user_id = $1 AND a.slug = 'github' AND ot.provider = 'github'`,
      [req.user!.sub],
    )
    res.json({ authorized: result.rows.length > 0 })
  } catch (err) { next(err) }
})

// ============================================================
// Google OAuth
// ============================================================

router.get('/google/authorize', (req, res) => {
  if (!env.GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: 'Google OAuth not configured' })
    return
  }

  const token = typeof req.query.token === 'string' ? req.query.token : ''
  let userId: string
  try {
    userId = verifyToken(token).sub
  } catch {
    res.status(401).send('Invalid or missing token')
    return
  }

  cleanExpiredStates()
  const state = crypto.randomBytes(20).toString('hex')
  pendingStates.set(state, { userId, provider: 'google', createdAt: Date.now() })

  const callbackUrl = `${getBaseUrl(req)}/api/oauth/google/callback`
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

router.get('/google/callback', async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.query)

    const entry = pendingStates.get(state)
    if (!entry || entry.provider !== 'google') {
      res.status(400).send('Invalid or expired OAuth state')
      return
    }
    pendingStates.delete(state)
    if (Date.now() - entry.createdAt > STATE_TTL_MS) {
      res.status(400).send('OAuth state expired')
      return
    }

    const callbackUrl = `${getBaseUrl(req)}/api/oauth/google/callback`
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = z.object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
      expires_in: z.number().optional(),
    }).parse(await tokenResponse.json())

    // Find the google-quiz app
    const appResult = await pool.query(`SELECT id FROM apps WHERE slug = 'google-quiz' AND status = 'approved'`)
    if (appResult.rows.length === 0) { res.status(500).send('Google Quiz app not registered'); return }
    const appId = (appResult.rows[0] as { id: string }).id

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null

    await pool.query(
      `INSERT INTO oauth_tokens (user_id, app_id, provider, access_token, refresh_token, expires_at)
       VALUES ($1, $2, 'google', $3, $4, $5)
       ON CONFLICT (user_id, app_id, provider)
       DO UPDATE SET access_token = EXCLUDED.access_token,
                     refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
                     expires_at = EXCLUDED.expires_at,
                     created_at = now()`,
      [entry.userId, appId, tokenData.access_token, tokenData.refresh_token ?? null, expiresAt],
    )

    res.send(successPage('Google Connected!'))
  } catch (err) { next(err) }
})

router.get('/google/status', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 1 FROM oauth_tokens ot JOIN apps a ON a.id = ot.app_id
       WHERE ot.user_id = $1 AND a.slug = 'google-quiz' AND ot.provider = 'google'`,
      [req.user!.sub],
    )
    res.json({ authorized: result.rows.length > 0 })
  } catch (err) { next(err) }
})

// ============================================================
// Shared
// ============================================================

function successPage(title: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f6f8fa;">
  <div style="text-align: center;">
    <h2 style="color: #24292f;">${title}</h2>
    <p style="color: #57606a;">You can close this window.</p>
    <script>setTimeout(() => window.close(), 1500)</script>
  </div>
</body>
</html>`
}

export { router as oauthRouter }
