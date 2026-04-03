import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../env.js'
import { requireAuth } from '../middleware/auth.js'
import { verifyToken } from '../utils/jwt.js'
import { pool } from '../db/pool.js'

const router = Router()

// ---------------------------------------------------------------------------
// In-memory state store for OAuth CSRF protection (state → userId)
// Entries expire after 10 minutes.
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000
const pendingStates = new Map<string, { userId: string; createdAt: number }>()

function cleanExpiredStates(): void {
  const now = Date.now()
  for (const [state, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      pendingStates.delete(state)
    }
  }
}

// ---------------------------------------------------------------------------
// GET /oauth/github/authorize — start OAuth flow (requires auth)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /oauth/github/authorize — start OAuth flow (popup opens this directly)
// Accepts JWT via query param since popups can't send Authorization headers.
// ---------------------------------------------------------------------------

router.get('/github/authorize', (req, res) => {
  if (!env.GITHUB_CLIENT_ID) {
    res.status(500).json({ error: 'GitHub OAuth not configured' })
    return
  }

  // Auth via query param (popup window can't send Authorization header)
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  let userId: string
  try {
    const payload = verifyToken(token)
    userId = payload.sub
  } catch {
    res.status(401).send('Invalid or missing token')
    return
  }

  cleanExpiredStates()

  const state = crypto.randomBytes(20).toString('hex')
  pendingStates.set(state, { userId, createdAt: Date.now() })

  const callbackUrl = `${req.protocol}://${req.get('host')}/api/oauth/github/callback`
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl,
    scope: 'read:user repo',
    state,
  })

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
})

// ---------------------------------------------------------------------------
// GET /oauth/github/callback — exchange code for token (public — GitHub redirects here)
// ---------------------------------------------------------------------------

const CallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

router.get('/github/callback', async (req, res, next) => {
  try {
    const parsed = CallbackQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).send('Invalid callback parameters')
      return
    }
    const { code, state } = parsed.data

    // Look up state → userId
    const entry = pendingStates.get(state)
    if (!entry) {
      res.status(400).send('Invalid or expired OAuth state')
      return
    }
    pendingStates.delete(state)

    // Check expiry
    if (Date.now() - entry.createdAt > STATE_TTL_MS) {
      res.status(400).send('OAuth state expired')
      return
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    })

    const tokenData = z
      .object({
        access_token: z.string(),
        token_type: z.string(),
        scope: z.string(),
      })
      .parse(await tokenResponse.json())

    // Look up the GitHub app ID from our apps table
    const appResult = await pool.query(
      `SELECT id FROM apps WHERE slug = 'github' AND status = 'approved'`,
    )
    if (appResult.rows.length === 0) {
      res.status(500).send('GitHub app not registered')
      return
    }
    const appId = (appResult.rows[0] as { id: string }).id

    // Upsert token into oauth_tokens
    await pool.query(
      `INSERT INTO oauth_tokens (user_id, app_id, provider, access_token)
       VALUES ($1, $2, 'github', $3)
       ON CONFLICT (user_id, app_id, provider)
       DO UPDATE SET access_token = EXCLUDED.access_token, created_at = now()`,
      [entry.userId, appId, tokenData.access_token],
    )

    // Render success page that closes the popup
    res.send(`<!DOCTYPE html>
<html>
<head><title>GitHub Connected</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f6f8fa;">
  <div style="text-align: center;">
    <h2 style="color: #24292f;">GitHub Connected!</h2>
    <p style="color: #57606a;">You can close this window.</p>
    <script>setTimeout(() => window.close(), 1500)</script>
  </div>
</body>
</html>`)
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /oauth/github/status — check if user has authorized (requires auth)
// ---------------------------------------------------------------------------

router.get('/github/status', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT 1 FROM oauth_tokens ot
       JOIN apps a ON a.id = ot.app_id
       WHERE ot.user_id = $1 AND a.slug = 'github' AND ot.provider = 'github'`,
      [req.user!.sub],
    )
    res.json({ authorized: result.rows.length > 0 })
  } catch (err) {
    next(err)
  }
})

export { router as oauthRouter }
