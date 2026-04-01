import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().min(1).default('postgresql://chatbridge:chatbridge@localhost:5432/chatbridge'),
  CORS_ORIGIN: z.string().default('http://localhost:1212'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = EnvSchema.parse(process.env)
