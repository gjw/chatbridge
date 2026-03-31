import { z } from 'zod'

// --- Trust Tier ---

export const TrustTierSchema = z.enum(['internal', 'external_public', 'external_auth'])
export type TrustTier = z.infer<typeof TrustTierSchema>

// --- App Permission ---

export const AppPermissionSchema = z.enum(['ui:render', 'api:proxy', 'storage:session'])
export type AppPermission = z.infer<typeof AppPermissionSchema>

// --- App Tool Definition ---

/** JSON Schema stored as an opaque record; structural validation is the registry's job. */
export const JsonSchemaSchema = z.record(z.string(), z.unknown())
export type JsonSchema = z.infer<typeof JsonSchemaSchema>

export const AppToolDefSchema = z.object({
  /** Tool name, unique within this app. e.g. "start_game", "move_piece" */
  name: z.string().min(1).max(100),

  /** Description the LLM uses to decide when to invoke this tool */
  description: z.string().min(1).max(1000),

  /** JSON Schema for the tool's parameters */
  parameters: JsonSchemaSchema,

  /** Whether this tool renders UI in the iframe */
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
export type AppAuthConfig = z.infer<typeof AppAuthConfigSchema>

// --- App Manifest ---

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{1,2}$/
const HTTPS_OR_LOCALHOST = /^https:\/\/|^http:\/\/localhost(:\d+)?/

export const AppManifestSchema = z
  .object({
    /** Unique slug, url-safe. e.g. "chess", "weather-dashboard" */
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(SLUG_PATTERN, 'Slug must be alphanumeric with hyphens, cannot start/end with hyphen'),

    /** Display name */
    name: z.string().min(1).max(100),

    /** Short description shown to users */
    description: z.string().min(1).max(500),

    /** Trust tier determines auth handling and approval requirements */
    trustTier: TrustTierSchema,

    /** URL to the app's iframe entry point */
    entryUrl: z
      .string()
      .regex(HTTPS_OR_LOCALHOST, 'Entry URL must be HTTPS or localhost'),

    /** Tools this app exposes to the LLM */
    tools: z.array(AppToolDefSchema).min(1).max(20),

    /** Permissions the app requests */
    permissions: z.array(AppPermissionSchema),

    /** Auth config (only for external_auth apps) */
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
