import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().min(1).default('postgresql://chatbridge:chatbridge@localhost:5432/chatbridge'),
  CORS_ORIGIN: z.string().default('http://localhost:1212'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(32).default('dev-secret-change-me-in-production-32chars'),
  JWT_EXPIRES_IN: z.coerce.number().int().positive().default(3600),
  JWT_REFRESH_EXPIRES_IN: z.coerce.number().int().positive().default(604800),
  OPENAI_API_KEY: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
})

export const env = EnvSchema.parse(process.env)
