import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { env } from '../env.js'

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['student', 'teacher', 'admin']),
})
export type JwtPayload = z.infer<typeof JwtPayloadSchema>

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN })
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN })
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET)
  return JwtPayloadSchema.parse(decoded)
}
