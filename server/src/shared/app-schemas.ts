/**
 * App manifest Zod schemas for server-side validation.
 *
 * These mirror the canonical schemas in src/shared/types/app.ts.
 * Kept in sync manually until the monorepo has proper workspace
 * package linking for shared types.
 */
import { z } from 'zod'

// --- Trust Tier ---

export const TrustTierSchema = z.enum(['internal', 'external_public', 'external_auth'])
export type TrustTier = z.infer<typeof TrustTierSchema>

// --- App Permission ---

export const AppPermissionSchema = z.enum(['ui:render', 'api:proxy', 'storage:session'])

// --- App Tool Definition ---

export const JsonSchemaSchema = z.record(z.string(), z.unknown())

export const AppToolDefSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  parameters: JsonSchemaSchema,
  rendersUi: z.boolean(),
})
export type AppToolDef = z.infer<typeof AppToolDefSchema>

// --- App Auth Config ---

export const AppAuthConfigSchema = z.object({
  provider: z.string().min(1),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  scopes: z.array(z.string().min(1)).min(1),
})

// --- App Manifest ---

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/
const HTTPS_OR_LOCALHOST = /^https:\/\/|^http:\/\/localhost(:\d+)?/

export const AppManifestSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(SLUG_PATTERN, 'Slug must be alphanumeric with hyphens, cannot start/end with hyphen'),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    trustTier: TrustTierSchema,
    entryUrl: z
      .string()
      .regex(HTTPS_OR_LOCALHOST, 'Entry URL must be HTTPS or localhost'),
    tools: z.array(AppToolDefSchema).min(1).max(20),
    permissions: z.array(AppPermissionSchema),
    auth: AppAuthConfigSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.trustTier === 'external_auth' && data.auth == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Auth config is required when trustTier is external_auth',
        path: ['auth'],
      })
    }
    if (data.trustTier !== 'external_auth' && data.auth != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Auth config must only be provided when trustTier is external_auth',
        path: ['auth'],
      })
    }
  })
export type AppManifest = z.infer<typeof AppManifestSchema>
