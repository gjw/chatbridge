# ChatBridge Architecture

AI chat platform with sandboxed third-party app integration, built for K-12 education.
Fork of [Chatbox](https://github.com/chatboxai/chatbox) with plugin architecture.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Frontend** | Chatbox web build (React 18 / Mantine / Tailwind / Zustand+Jotai) | Already built, proven UI. Web build mode strips Electron. |
| **Backend** | Node 24 / Express | Familiar, fast to ship. Handles app registry, auth, trust enforcement, LLM proxy. |
| **Database** | PostgreSQL 16 (Docker) | Multi-user platform needs real concurrency, structured queries, encrypted token storage. |
| **LLM** | Vercel AI SDK (multi-provider) | Already in Chatbox. Supports OpenAI, Anthropic, Google with streaming + tool calling. |
| **App sandbox** | Iframes + postMessage | Only option that provides real isolation for K-12. CSP + sandbox attributes. |
| **Auth** | JWT (platform) + OAuth2 proxy (per-app) | Server holds all tokens. Apps never see credentials. |
| **Process mgmt** | PM2 (production) | Keeps services up on Linode. |
| **Package mgr** | PNPM | Chatbox requires it. |

### Decisions & Rationale

- **React 18, not 19.** Chatbox pins 18.2. React 19's new features (Server Components,
  Actions, `use()`) don't help us — we're not on Next.js and our forms are simple.
  Upgrading risks Mantine/MUI compatibility breakage in a forked codebase we don't
  fully own yet. Upgrade later once we control the dependency tree.
- **Node 24 LTS** (Krypton, current Active LTS). Chatbox pins `engines.node` to `<23` —
  that constraint comes from Electron tooling we're stripping. Remove after forking.
- **Vercel AI SDK** already in Chatbox. Supports OpenAI, Anthropic, Google with streaming
  + tool calling. Provides `wrapLanguageModel` middleware for content filtering and logging.
  No additional SDK needed.

## Directory Structure

```
chatbridge/
├── src/
│   ├── renderer/            # React frontend (from Chatbox, kept intact)
│   │   ├── components/
│   │   │   ├── chat/        # Chat interface (existing)
│   │   │   ├── apps/        # NEW — app iframe host, app cards
│   │   │   └── admin/       # NEW — teacher/admin app management
│   │   ├── hooks/
│   │   ├── stores/          # Zustand/Jotai stores
│   │   ├── routes/          # TanStack Router
│   │   └── lib/
│   ├── shared/              # Shared types (existing + extended)
│   │   ├── types/
│   │   │   ├── session.ts   # Existing message/session types
│   │   │   ├── app.ts       # NEW — App manifest, tool schema types
│   │   │   └── bridge.ts    # NEW — postMessage protocol types
│   │   └── schemas/         # NEW — Zod schemas for all boundaries
│   └── main/                # STRIPPED — Electron main process removed
├── server/                  # NEW — Express backend
│   ├── src/
│   │   ├── routes/          # API endpoints
│   │   │   ├── auth.ts      # Login, register, JWT
│   │   │   ├── chat.ts      # Conversations, messages, streaming
│   │   │   ├── apps.ts      # App registry CRUD, approval
│   │   │   ├── invoke.ts    # Tool invocation orchestration
│   │   │   └── oauth.ts     # OAuth2 flows for external apps
│   │   ├── middleware/
│   │   │   ├── auth.ts      # JWT verification
│   │   │   ├── rateLimit.ts # Per-user, per-app limits
│   │   │   └── safety.ts    # Content filtering
│   │   ├── services/
│   │   │   ├── llm.ts       # AI SDK wrapper, tool injection
│   │   │   ├── appRunner.ts # Manages app lifecycle, timeout
│   │   │   └── audit.ts     # Invocation logging
│   │   └── db/
│   │       ├── schema.sql   # PostgreSQL schema
│   │       └── queries.ts   # Typed query layer
│   └── package.json
├── apps/                    # Third-party app implementations
│   ├── chess/               # Required — complex, bidirectional
│   ├── _template/           # Starter template for developers
│   └── [app2, app3]/        # Additional apps TBD
├── docker/
│   └── docker-compose.yml   # PostgreSQL + any other services
├── docs/
│   └── app-developer-guide.md  # Third-party developer docs
└── package.json             # Root workspace config
```

### What We Keep from Chatbox

- `src/renderer/` — entire React UI layer (components, stores, hooks, routes)
- `src/shared/` — type definitions, constants, utilities
- Vite config (renderer portion only, adapted for standalone web build)
- Mantine theme, Tailwind config, i18n

### What We Strip

- `src/main/` — Electron main process (replaced by Express server)
- `src/preload/` — IPC bridge (replaced by HTTP/WebSocket calls)
- `electron-builder.yml`, Capacitor config
- `electron-store` dependency (replaced by server API + client cache)
- MCP stdio transport (keep HTTP transport as future option)
- Node engine constraint `<23`

### What We Add

- `server/` — Express backend (auth, app registry, LLM proxy, trust enforcement)
- App manifest system and iframe sandbox host
- PostgreSQL schema and query layer
- Bridge protocol (postMessage types and handlers)
- Content safety middleware

## Data Model

```sql
-- Platform users
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,  -- bcrypt hashed
    role        TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Chat conversations
CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Chat messages
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         JSONB NOT NULL,  -- Matches Chatbox contentParts structure
    model           TEXT,
    token_usage     JSONB,           -- {input, output, cached}
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Registered third-party apps
CREATE TABLE apps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,       -- url-safe identifier
    manifest    JSONB NOT NULL,             -- Full app manifest
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'blocked')),
    trust_tier  TEXT NOT NULL
                CHECK (trust_tier IN ('internal', 'external_public', 'external_auth')),
    created_by  UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Per-user app installations
CREATE TABLE app_installations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id      UUID REFERENCES apps(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(app_id, user_id)
);

-- Tool invocation audit log
CREATE TABLE tool_invocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID REFERENCES messages(id),
    app_id          UUID REFERENCES apps(id),
    user_id         UUID REFERENCES users(id),
    tool_name       TEXT NOT NULL,
    parameters      JSONB,
    result          JSONB,
    status          TEXT NOT NULL CHECK (status IN ('pending', 'success', 'error', 'timeout')),
    duration_ms     INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- OAuth tokens (server-side custody)
CREATE TABLE oauth_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    app_id          UUID REFERENCES apps(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    access_token    TEXT NOT NULL,   -- encrypted at rest (pgcrypto)
    refresh_token   TEXT,            -- encrypted at rest
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, app_id, provider)
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_invocations_user ON tool_invocations(user_id, created_at);
CREATE INDEX idx_apps_status ON apps(status);
```

## App Manifest

Every third-party app is defined by a manifest. This is the contract.

```typescript
interface AppManifest {
  /** Unique slug, url-safe. e.g. "chess", "weather-dashboard" */
  slug: string;

  /** Display name */
  name: string;

  /** Short description shown to users */
  description: string;

  /** Trust tier determines auth handling and approval requirements */
  trustTier: 'internal' | 'external_public' | 'external_auth';

  /** URL to the app's iframe entry point */
  entryUrl: string;

  /** Tools this app exposes to the LLM */
  tools: AppToolDef[];

  /** Permissions the app requests */
  permissions: AppPermission[];

  /** Auth config (only for external_auth apps) */
  auth?: {
    provider: string;          // e.g. "spotify", "github"
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
  };
}

interface AppToolDef {
  /** Tool name, unique within this app. e.g. "start_game", "move_piece" */
  name: string;

  /** Description the LLM uses to decide when to invoke this tool */
  description: string;

  /** JSON Schema for the tool's parameters */
  parameters: JsonSchema;

  /** Whether this tool renders UI in the iframe */
  rendersUi: boolean;
}

type AppPermission =
  | 'ui:render'           // Can render in iframe
  | 'api:proxy'           // Can make proxied API calls via platform
  | 'storage:session'     // Can persist data for the session
  ;
```

### Manifest Validation

Manifests are validated with Zod on registration:

- `slug` must be alphanumeric + hyphens, 3-50 chars
- `entryUrl` must be HTTPS (except `localhost` in dev)
- `tools` array must have 1-20 tools, each with valid JSON Schema
- `permissions` must be a known set — no open-ended capability grants
- `auth` required iff `trustTier === 'external_auth'`

## Bridge Protocol

Communication between the platform and sandboxed app iframes uses structured
postMessage. All messages have a `type` discriminant for exhaustive handling.

### Platform → App

```typescript
/** Sent when iframe loads. App must respond with 'ready'. */
type BridgeInit = {
  type: 'bridge:init';
  appId: string;
  sessionId: string;
  theme: { mode: 'light' | 'dark'; accent: string };
};

/** Invoke a tool the app registered */
type BridgeToolInvoke = {
  type: 'bridge:tool:invoke';
  invocationId: string;
  toolName: string;
  parameters: Record<string, unknown>;
};

/** Tell app to clean up (conversation ended, app switched out) */
type BridgeDestroy = {
  type: 'bridge:destroy';
};
```

### App → Platform

```typescript
/** App finished loading, ready to receive invocations */
type BridgeReady = {
  type: 'bridge:ready';
};

/** Tool completed successfully */
type BridgeToolResult = {
  type: 'bridge:tool:result';
  invocationId: string;
  result: unknown;
};

/** Tool failed */
type BridgeToolError = {
  type: 'bridge:tool:error';
  invocationId: string;
  error: { code: string; message: string };
};

/** App wants to resize its iframe */
type BridgeUiResize = {
  type: 'bridge:ui:resize';
  height: number;
};

/** App requests a proxied API call (external_auth apps) */
type BridgeApiRequest = {
  type: 'bridge:api:request';
  requestId: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
};
```

### Platform → App (response)

```typescript
type BridgeApiResponse = {
  type: 'bridge:api:response';
  requestId: string;
  status: number;
  body: unknown;
};
```

### Dual-Channel Design

Apps communicate on two parallel channels that serve different audiences:

- **Visual channel** (iframe → student): Rich, interactive UI. The chess board,
  the weather dashboard, the drawing canvas. Rendered by the app, seen by the human.
- **Data channel** (bridge:tool:result → LLM): Structured description of state/outcome.
  The LLM **cannot see the iframe** — it only knows what the app tells it.

These are separate concerns. The chess app renders a board for the student and sends
`{ fen: "...", lastMove: "e2e4", gameStatus: "in_progress" }` for the LLM. The visual
can be rich; the data should be concise and machine-readable.

What to include in tool results is the **app author's decision** — the manifest's tool
schema defines the shape, the developer guide should emphasize: "report enough for the
LLM to reason about what happened, not a DOM dump."

### Security Rules

- All messages validated against Zod schemas before processing
- Platform ignores messages from iframes whose `origin` doesn't match the app's registered `entryUrl`
- Message size capped at 1MB
- Bridge namespace prefix (`bridge:`) prevents collision with other postMessage users

## LLM Middleware Stack

The Vercel AI SDK's `wrapLanguageModel` lets us intercept requests and responses.
Middleware is stacked — each layer wraps the next.

```typescript
const safeLLM = wrapLanguageModel({
  model: openai('gpt-4o'),  // or anthropic('claude-sonnet-4-6'), switchable via config
  middleware: [contentFilter, auditLogger, costTracker],
});
```

### Middleware layers (in order)

1. **Content Filter** (`wrapStream`) — Buffers streaming tokens in a sliding window,
   checks against blocklist + classifier. Redacts or halts if unsafe content detected.
   Also filters tool results before they re-enter LLM context. This is the K-12 safety
   gate — every token passes through it.

2. **Audit Logger** (`wrapGenerate`, `wrapStream`) — Logs every request/response:
   model, token usage, tool calls, latency. Feeds the AI cost analysis deliverable
   and the teacher activity dashboard.

3. **Cost Tracker** (`wrapGenerate`, `wrapStream`) — Accumulates token usage per user,
   per conversation, per app. Stored in Postgres for the cost projection report.

4. **Context Builder** (`transformParams`) — Injects system prompt, timestamps,
   available tool schemas from user's enabled apps. Handles context window management.

Custom middleware can be added without touching core LLM call sites — the server
calls `safeLLM` everywhere, layers handle cross-cutting concerns.

## Tool Invocation Pipeline

This is the core flow. Every step is server-orchestrated.

```
User message
    │
    ▼
┌─────────────────────────────────┐
│  1. Build LLM context           │
│     - System prompt             │
│     - Conversation history      │
│     - Tool schemas from         │
│       user's enabled apps       │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  2. Stream LLM response         │
│     (Vercel AI SDK)             │
│     - Text chunks → client      │
│     - tool_use block → step 3   │
└──────────────┬──────────────────┘
               │ tool_use detected
               ▼
┌─────────────────────────────────┐
│  3. Validate invocation         │
│     - Tool exists in app?       │
│     - Parameters match schema?  │
│     - User has app enabled?     │
│     - Rate limit check          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  4. Route to app                │
│     - Client loads app iframe   │
│       (if rendersUi)            │
│     - Send bridge:tool:invoke   │
│     - Start 30s timeout         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  5. App processes               │
│     - Renders UI (optional)     │
│     - User interacts (optional) │
│     - Sends bridge:tool:result  │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  6. Completion                  │
│     - Result passes content     │
│       filter                    │
│     - Audit log entry           │
│     - Result returned to LLM    │
│     - LLM continues response    │
└─────────────────────────────────┘
```

### Timeout & Error Handling

- Tool invocations timeout after **30 seconds**
- On timeout: platform sends `bridge:destroy`, returns error to LLM, LLM explains gracefully
- On app crash (iframe error): same recovery path
- Circuit breaker: if an app fails 3 times in 5 minutes, temporarily disable and notify user

## Trust & Safety

K-12 is the use case. This is not an afterthought — it's load-bearing architecture.

### Iframe Sandbox

```html
<iframe
  src="{app.entryUrl}"
  sandbox="allow-scripts allow-same-origin"
  referrerpolicy="no-referrer"
  loading="lazy"
></iframe>
```

**`allow-same-origin` is required** — without it, the iframe gets an opaque
`"null"` origin and `postMessage` origin validation breaks (the platform
validates `event.origin` against the app's registered `entryUrl`). Platform
cookies/storage are protected by the app being hosted on a separate origin
(its own subdirectory under `/apps/`), not by the sandbox flag.

**Deliberately omitted sandbox flags:**

- `allow-top-navigation` — prevents app from redirecting the page
- `allow-popups` — prevents app from opening new windows
- `allow-forms` — prevents app from submitting forms outside the iframe

**Exception: `external_auth` apps** get `allow-popups` added to their sandbox so
the platform can open OAuth consent popups on their behalf. The app itself never
opens the popup directly — it sends a `bridge:oauth:request` message, and the
parent (AppHost) opens the popup with the user's auth token. This keeps
credentials out of the iframe while enabling the OAuth flow.

### Content Security Policy

Server sets CSP headers:

```
Content-Security-Policy:
  default-src 'self';
  frame-src https:;
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://api.openai.com https://api.anthropic.com;
  img-src 'self' data: https:;
```

### Content Filtering

**Text content** (LLM responses, tool results) is filtered server-side:

1. **LLM responses** — filtered before streaming to client via middleware
2. **Tool results** — filtered before returning to LLM context

#### Three-tier filter pipeline

| Tier | Latency | What it catches | Response |
|------|---------|----------------|----------|
| **1. Keyword blocklist** | <1ms | Profanity, slurs, known-bad patterns | Redact + log |
| **2. Fast classifier** | ~50ms | Crisis signals (self-harm, violence, abuse disclosure), bullying, sexual content. Cheap no-reasoning model (e.g. Gemini Flash/Nano, Haiku). Sentiment + intent, not just words. | Tier-appropriate alert (see below) |
| **3. Full LLM review** | ~1s | Ambiguous content that passes tiers 1-2 but seems off. Only triggered when tier 2 confidence is low. | Hold + async review |

Tier 2 is the critical addition for K-12. "I hate math" is frustration. "I hate my
life" is a crisis signal. A keyword list can't tell the difference — a cheap fast
model can. The cost of a Nano/Haiku call per flagged message is negligible compared
to the cost of missing a cry for help.

#### Alert severity levels

| Severity | Example | Action |
|----------|---------|--------|
| **Low** | Profanity | Redact, log, visible in teacher's filtered content dashboard |
| **Medium** | Bullying language, inappropriate sexual content | Redact, log, **push notification to teacher** |
| **Critical** | Self-harm, violence threats, abuse disclosure | Redact, log, **immediate push alert to teacher + school admin**, flag conversation for review |

#### Teacher controls (per-classroom, immediate effect)

- **View filtered content log** — dashboard showing flagged messages with severity
- **Real-time alerts** — push notifications for medium/critical events
- **Instant session kill** — teacher can terminate a student's active session
- **Per-classroom app disable** — teacher disables an app for their classroom immediately, no admin needed
- **Blocklist customization** — add/remove keywords per classroom

Configurable per-school or per-classroom by teachers/admins.

**Visual iframe content is a known gap.** Browser isolation works both ways — we
can't read the app's DOM any more than it can read ours. A sandboxed iframe can
render anything it wants visually. Mitigations:

- **Curated app registry.** K-12 apps are approved by teachers/admins before use.
  This is the primary control — don't let untrusted apps in. Same model as
  enterprise app stores and children's app marketplaces.
- **Iframe CSP attribute.** Restrict what resources the app can load:
  ```html
  <iframe csp="default-src 'self' 'unsafe-inline'; img-src 'self' data:">
  ```
  Prevents loading external images, scripts, or media from arbitrary domains.
  A chess app shouldn't need to fetch resources from unknown origins.
- **Report + suspend.** Students and teachers can flag an app. Flagged apps are
  immediately suspended platform-wide pending admin review.
- **Internal apps are trusted.** Bundled apps (chess, calculator, etc.) are our code,
  reviewed by us. The visual content gap only applies to externally-hosted apps,
  which require admin approval anyway.

### Data Isolation

- Apps cannot read other apps' data
- Apps cannot access conversation history (only receive explicit tool invocations)
- OAuth tokens stored server-side, encrypted, never sent to iframes
- Student PII never included in tool invocation parameters

### Role-Based Access

| Capability | Student | Teacher | Admin |
|------------|---------|---------|-------|
| Use approved apps | ✓ | ✓ | ✓ |
| See app catalog | ✓ | ✓ | ✓ |
| Install/uninstall apps | — | ✓ | ✓ |
| Approve/block apps | — | ✓ | ✓ |
| Register new apps | — | — | ✓ |
| Manage users | — | — | ✓ |

### Audit Trail

Every tool invocation is logged with: user, app, tool, parameters (scrubbed of PII),
result summary, duration, status. Teachers can review student activity. Admins can
review all activity.

## Key Abstractions

A Trench agent needs to understand these five concepts:

1. **App Manifest** — The contract between an app and the platform. Defines tools,
   UI entry point, auth requirements, permissions. Validated by Zod schema.

2. **Bridge Protocol** — Typed postMessage layer between platform and sandboxed
   iframes. Request/response correlation via invocationId. All messages carry a
   `type` discriminant for exhaustive switch handling.

3. **Tool Pipeline** — The server-orchestrated flow from LLM tool_use → validation
   → app invocation → content filter → LLM context. Timeout at 30s. Circuit breaker
   at 3 failures/5min.

4. **Trust Tier** — Classification of apps: `internal` (bundled, no auth),
   `external_public` (API key, server-held), `external_auth` (OAuth2, server-proxied).
   Determines approval requirements and data access.

5. **Token Custody** — Server holds all secrets. OAuth tokens encrypted in Postgres.
   Apps request API calls via `bridge:api:request`; platform proxies with credentials.
   Tokens never reach the browser.

## Glossary

| Term | Definition | Not to be confused with |
|------|------------|------------------------|
| **App** | A third-party application registered with ChatBridge. Provides tools and optionally UI. | Mobile app, Electron app |
| **Manifest** | JSON document defining an app's capabilities, tools, auth, and entry URL. | package.json, MCP config |
| **Tool** | A discrete capability an app exposes. Has name, description, parameter schema. LLM decides when to call it. | MCP tool, CLI tool |
| **Invocation** | A single tool call: parameters in, result out. Logged for audit. | API request (invocations are higher-level) |
| **Bridge** | The postMessage channel between platform and an app iframe. Typed, validated. | WebSocket, API endpoint |
| **Trust Tier** | One of internal / external_public / external_auth. Determines auth model and approval flow. | User role (that's student/teacher/admin) |
| **Sandbox** | Iframe isolation boundary. Strict `sandbox` attribute prevents DOM access, navigation, popups. | Docker container, VM |
| **Completion Signal** | `bridge:tool:result` or `bridge:tool:error` from app. Without this, LLM blocks waiting. | HTTP response (completion is app-level) |
| **Token Custody** | Pattern: server holds OAuth tokens, proxies API calls. Browser never sees credentials. | Token refresh (that's a sub-operation) |

## Invariants

1. **Apps NEVER access platform DOM** or other apps' iframes.
2. **OAuth tokens NEVER leave the server.** Apps use `bridge:api:request` for proxied calls.
3. **All LLM output passes content filtering** before reaching students.
4. **Tool invocations complete or timeout within 30 seconds.**
5. **App manifests validated against Zod schema** before registration accepted.
6. **Students can only use teacher/admin-approved apps.**
7. **All tool invocations are audit-logged** with user, app, tool, status, duration.
8. **postMessage origin validated** against app's registered entryUrl.

## Agent Loop Architecture

The platform has three conceptual loops operating at different time scales.
**Loops A and B are built this sprint. Loop C is seeded to demonstrate the vision.**

### Loop A — Sub-game (minutes)

A single app interaction: one chess game, one flashcard deck, one quiz attempt.
Self-contained state, clear start/end, bounded context. Managed entirely by the
app iframe + bridge protocol. The platform tracks it as a sequence of tool
invocations within a conversation.

### Loop B — Conversation (session, ~a day)

A single chat session. Oversees Loop A instances — the student can start a chess
game, ask for help mid-game, finish, then ask about something else. The LLM
maintains context across app interactions. Eventually hits context limits and must
compact or end.

**On conversation close or compaction:** the server generates a structured summary:
topics covered, apps used, key outcomes, student struggles/successes. Stored in the
`conversation_summaries` table. This is the data Loop C consumes.

### Loop C — Meta-agent (cross-session, semester-scale)

The long-term student experience. Knows what happened in previous conversations,
what topics were covered, where the student struggled. Enables "you had trouble
with fractions last Tuesday — want to try a different approach?"

**Sprint scope:** Seed only. We build:

- `conversation_summaries` table (auto-generated on conversation close)
- A simple student profile view that aggregates past summaries
- System prompt injection that includes recent summaries for continuity

This is explicitly a **dog and pony show** — enough to demonstrate how real Loop A
and B work feeds into Loop C, and what the full vision looks like. The presearch doc
articulates the full three-loop architecture; the demo shows the seam.

**Not built this sprint:** domain-aware compaction, learning state tracking,
teacher-configurable curriculum goals, FERPA-compliant data lifecycle management.

### Data support for Loop C

```sql
CREATE TABLE conversation_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    summary         TEXT NOT NULL,         -- LLM-generated structured summary
    topics          TEXT[] DEFAULT '{}',   -- Extracted topic tags
    apps_used       TEXT[] DEFAULT '{}',   -- App slugs used in this conversation
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_summaries_user ON conversation_summaries(user_id, created_at);
```

## Future Directions (Post-MVP)

- **Full Loop C** — Domain-aware compaction, learning profiles, teacher curriculum integration
- **MCP adapter** — Let developers use standard MCP HTTP transport for tool-only apps
- **App marketplace** — Public registry with community ratings and reviews
- **Classroom mode** — Teacher can see all student screens, push/restrict apps in real time
- **Electron re-wrap** — If desktop distribution needed, re-add Electron shell around web build
- **WebSocket upgrade** — Replace polling with persistent connections for real-time features
