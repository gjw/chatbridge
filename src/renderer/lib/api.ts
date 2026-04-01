import { z } from 'zod'
import { ofetch } from 'ofetch'

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['student', 'teacher', 'admin']),
})
export type User = z.infer<typeof UserSchema>

const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserSchema,
})

const TokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
})

const MeResponseSchema = z.object({
  user: UserSchema,
})

export async function login(email: string, password: string) {
  const raw = await ofetch('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  return AuthResponseSchema.parse(raw)
}

export async function register(email: string, password: string, name: string, role?: string) {
  const raw = await ofetch('/api/auth/register', {
    method: 'POST',
    body: { email, password, name, role },
  })
  return AuthResponseSchema.parse(raw)
}

export async function refreshTokens(refreshToken: string) {
  const raw = await ofetch('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  })
  return TokenResponseSchema.parse(raw)
}

export async function getMe(accessToken: string) {
  const raw = await ofetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return MeResponseSchema.parse(raw)
}
