import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { queryOne, queryRows } from '../db/queries.js'
import { UserRowSchema } from '../db/schemas.js'
import { requireAuth } from '../middleware/auth.js'
import { signAccessToken, signRefreshToken, verifyToken } from '../utils/jwt.js'
import type { JwtPayload } from '../utils/jwt.js'

const router = Router()

const RegisterBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['student', 'teacher', 'admin']).default('student'),
})

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
})

function makeTokenPayload(user: { id: string; email: string; name: string; role: string }): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role as 'student' | 'teacher' | 'admin',
  }
}

function issueTokens(payload: JwtPayload) {
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  }
}

router.post('/register', async (req, res) => {
  const body = RegisterBodySchema.parse(req.body)

  const existing = await queryRows(UserRowSchema, 'SELECT * FROM users WHERE email = $1', [body.email])
  if (existing.length > 0) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const hash = await bcrypt.hash(body.password, 10)
  const user = await queryOne(
    UserRowSchema,
    'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [body.email, hash, body.name, body.role],
  )

  const payload = makeTokenPayload(user)
  const tokens = issueTokens(payload)

  res.status(201).json({
    ...tokens,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
})

router.post('/login', async (req, res) => {
  const body = LoginBodySchema.parse(req.body)

  const users = await queryRows(UserRowSchema, 'SELECT * FROM users WHERE email = $1', [body.email])
  const user = users[0]
  if (user === undefined) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const valid = await bcrypt.compare(body.password, user.password)
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const payload = makeTokenPayload(user)
  const tokens = issueTokens(payload)

  res.json({
    ...tokens,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
})

router.post('/refresh', async (req, res) => {
  const body = RefreshBodySchema.parse(req.body)

  let decoded: JwtPayload
  try {
    decoded = verifyToken(body.refreshToken)
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' })
    return
  }

  const users = await queryRows(UserRowSchema, 'SELECT * FROM users WHERE id = $1', [decoded.sub])
  const user = users[0]
  if (user === undefined) {
    res.status(401).json({ error: 'User not found' })
    return
  }

  const payload = makeTokenPayload(user)
  const tokens = issueTokens(payload)

  res.json(tokens)
})

router.get('/me', requireAuth, (req, res) => {
  const user = req.user
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  res.json({
    user: { id: user.sub, email: user.email, name: user.name, role: user.role },
  })
})

export { router as authRouter }
