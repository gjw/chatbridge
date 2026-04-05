# ChatBridge App Developer Guide

How to build apps that integrate with ChatBridge.

## What is a ChatBridge App?

A ChatBridge app is a web page that runs inside a sandboxed iframe in the chat interface. It communicates with the platform through a typed postMessage bridge protocol. The LLM can invoke your app's tools, and your app can render interactive UI for the student.

Your app provides **tools** — discrete capabilities the LLM can call. Each tool has a name, description (for the LLM), parameter schema, and optionally renders UI. The LLM decides when to call your tools based on conversation context.

## Quick Start

1. Copy an existing app as a starting point (e.g., `apps/chess/` or `apps/quiz/`)
2. Create a `manifest.json` defining your app's metadata and tools
3. Build your app as a static web page with a bridge protocol handler
4. Register it via the admin panel or database
5. Test locally with the dev server

## Manifest Format

Every app is defined by a `manifest.json`. This is the contract between your app and the platform.

```json
{
  "slug": "my-app",
  "name": "My App",
  "description": "Short description shown to users and the LLM.",
  "trustTier": "internal",
  "entryUrl": "http://localhost:3210",
  "tools": [
    {
      "name": "next_turn",
      "description": "Description the LLM reads to decide when to call this tool.",
      "parameters": {
        "type": "object",
        "properties": {
          "action": {
            "type": "string",
            "description": "What to do"
          }
        }
      },
      "rendersUi": true
    }
  ],
  "permissions": ["ui:render"]
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | Yes | URL-safe identifier (3-50 chars, alphanumeric + hyphens) |
| `name` | Yes | Display name (1-100 chars) |
| `description` | Yes | Description for users and LLM (1-500 chars) |
| `trustTier` | Yes | One of `internal`, `external_public`, `external_auth` |
| `entryUrl` | Yes | URL to your app's HTML entry point (HTTPS required, except localhost in dev) |
| `tools` | Yes | Array of tool definitions (1-20 tools) |
| `permissions` | Yes | Array of permission strings |
| `auth` | Only for `external_auth` | OAuth2 configuration |

### Permissions

| Permission | Description |
|------------|-------------|
| `ui:render` | App renders UI in an iframe |
| `api:proxy` | App can make proxied API calls via the platform |
| `storage:session` | App can persist data for the session |

## Tool Definitions

Each tool in the `tools` array defines a capability the LLM can invoke.

```json
{
  "name": "next_turn",
  "description": "What this tool does — the LLM reads this to decide when to call it.",
  "parameters": {
    "type": "object",
    "properties": {
      "answer": {
        "type": "string",
        "description": "The student's answer"
      }
    },
    "required": ["answer"]
  },
  "rendersUi": true
}
```

| Field | Description |
|-------|-------------|
| `name` | Unique within your app. The LLM sees it as `{slug}__{name}` (e.g., `chess__next_turn`). |
| `description` | Critical — this is how the LLM knows when and why to call the tool. Be specific. |
| `parameters` | JSON Schema for the tool's input. The LLM generates values matching this schema. |
| `rendersUi` | If `true`, the platform shows your iframe when this tool is called. |

### The State-Machine Pattern

We recommend a single `next_turn` tool per app rather than multiple tools. The app tracks state internally; the LLM just calls `next_turn` with context and follows the `state` field in the response.

This prevents LLM drift — with multiple tools, the LLM can pick the wrong tool at the wrong time (restarting a game, skipping quiz steps). With one tool, the app controls the flow.

**Example flow (quiz app):**

```
LLM calls next_turn({deck: "science"})
  → App returns {state: "awaiting_answer", question: "What is gravity?", ...}
LLM asks student the question, student answers

LLM calls next_turn({studentAnswer: "a force that pulls things"})
  → App returns {state: "awaiting_judgment", correctAnswer: "...", studentAnswer: "..."}
LLM judges the answer

LLM calls next_turn({correct: true})
  → App returns {state: "awaiting_answer", question: "What is DNA?", ...}
...repeat until...
  → App returns {state: "complete", score: {correct: 8, total: 10, missed: [...]}}
```

The app decides the transitions. The LLM just follows `state`.

## Bridge Protocol

Your app communicates with the platform via `window.postMessage`. All messages have a `type` field starting with `bridge:`.

### Messages You Receive (Platform → App)

**`bridge:init`** — Sent when your iframe loads. Respond with `bridge:ready`.

```js
{
  type: "bridge:init",
  appId: "abc-123",
  sessionId: "sess-456",
  theme: { mode: "light", accent: "#228be6" }
}
```

**`bridge:tool:invoke`** — The LLM called one of your tools.

```js
{
  type: "bridge:tool:invoke",
  invocationId: "inv-789",
  toolName: "next_turn",
  parameters: { answer: "photosynthesis" }
}
```

**`bridge:destroy`** — Clean up. Conversation ended or app switched out.

### Messages You Send (App → Platform)

**`bridge:ready`** — You're loaded and ready.

```js
window.parent.postMessage({ type: "bridge:ready" }, "*")
```

**`bridge:tool:result`** — Tool completed successfully.

```js
window.parent.postMessage({
  type: "bridge:tool:result",
  invocationId: "inv-789",
  result: { state: "awaiting_answer", question: "What is DNA?" }
}, "*")
```

**`bridge:tool:error`** — Tool failed.

```js
window.parent.postMessage({
  type: "bridge:tool:error",
  invocationId: "inv-789",
  error: { code: "INVALID_INPUT", message: "Answer cannot be empty" }
}, "*")
```

**`bridge:ui:resize`** — Request iframe height change.

```js
window.parent.postMessage({
  type: "bridge:ui:resize",
  height: 400
}, "*")
```

### Minimal App Template

```html
<!DOCTYPE html>
<html>
<body>
  <div id="app">Hello from my app!</div>
  <script>
    let appId = null

    window.addEventListener("message", (event) => {
      const msg = event.data
      if (!msg?.type?.startsWith("bridge:")) return

      switch (msg.type) {
        case "bridge:init":
          appId = msg.appId
          window.parent.postMessage({ type: "bridge:ready" }, "*")
          break

        case "bridge:tool:invoke":
          handleTool(msg.invocationId, msg.toolName, msg.parameters)
          break

        case "bridge:destroy":
          // Reset state
          break
      }
    })

    function handleTool(invocationId, toolName, params) {
      // Your logic here
      const result = { state: "done", message: "Hello!" }

      window.parent.postMessage({
        type: "bridge:tool:result",
        invocationId,
        result,
      }, "*")
    }
  </script>
</body>
</html>
```

## Trust Tiers

| Tier | Auth Model | Approval | Use Case |
|------|-----------|----------|----------|
| `internal` | None — bundled with platform | Pre-approved | Chess, quiz, calculator |
| `external_public` | API key held server-side | Admin approval | Weather API, dictionary |
| `external_auth` | OAuth2, server-proxied | Admin approval | Google Sheets, GitHub |

### OAuth Apps (`external_auth`)

For apps that need user-specific API access (e.g., reading a student's Google Sheets):

1. Add `auth` config to your manifest:

```json
{
  "auth": {
    "provider": "google",
    "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.googleapis.com/token",
    "scopes": ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  }
}
```

2. Your app requests OAuth via the bridge:

```js
window.parent.postMessage({
  type: "bridge:oauth:request",
  requestId: "oauth-123",
  provider: "google",
}, "*")
```

3. The platform opens the OAuth popup and stores tokens server-side.

4. Make proxied API calls — the platform injects the OAuth token:

```js
window.parent.postMessage({
  type: "bridge:api:request",
  requestId: "req-456",
  url: "https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID/values/A:C",
  method: "GET",
  headers: { Accept: "application/json" },
}, "*")
```

5. Receive the response:

```js
// Listen for bridge:api:response with matching requestId
{ type: "bridge:api:response", requestId: "req-456", status: 200, body: { ... } }
```

Your app **never sees credentials**. The platform proxies all API calls with the stored token.

## Dual-Channel Design

Apps communicate on two channels serving different audiences:

- **Visual channel** (iframe → student): Rich, interactive UI. The chess board, the flashcard, the quiz card. Rendered by your app, seen by the student.
- **Data channel** (bridge:tool:result → LLM): Structured data describing state and outcomes. The LLM **cannot see your iframe** — it only knows what you tell it in tool results.

Design your tool results for the LLM: concise, machine-readable, with enough context to continue the conversation. Design your UI for the student: rich, interactive, visually clear.

## Testing Locally

1. Serve your app on a local port:

```bash
cd apps/my-app
npx serve -l 3210 -s .
```

2. Set `entryUrl` in your manifest to `http://localhost:3210`

3. Register the app in the database (or use the admin panel)

4. Start the platform (`pnpm dev` + `pnpm dev:server`)

5. Log in and start a conversation — the LLM will have access to your tools

### Timeouts

Tool invocations timeout after 30 seconds. If your app doesn't respond with `bridge:tool:result` or `bridge:tool:error` in time, the platform returns an error to the LLM.

### Circuit Breaker

If your app fails 3 times in 5 minutes, the platform temporarily disables it. Fix the issue and it will re-enable automatically.

## Real Example: Chess App Manifest

```json
{
  "slug": "chess",
  "name": "Chess",
  "description": "Play chess interactively. The app is a state machine — call next_turn to start a game, make moves, or get board state.",
  "trustTier": "internal",
  "entryUrl": "http://localhost:3200",
  "tools": [
    {
      "name": "next_turn",
      "description": "Advance the chess state machine. Pass {color} to start a game, {from, to} to make a move, {resign: true} to resign. Empty call returns current board state. The response 'state' field tells you what to do next.",
      "parameters": {
        "type": "object",
        "properties": {
          "color": {
            "type": "string",
            "enum": ["white", "black"],
            "description": "Start a new game with the human playing this color. Only needed to begin."
          },
          "from": {
            "type": "string",
            "description": "Source square in algebraic notation (e.g. 'e2')"
          },
          "to": {
            "type": "string",
            "description": "Target square in algebraic notation (e.g. 'e4')"
          },
          "promotion": {
            "type": "string",
            "enum": ["q", "r", "b", "n"],
            "description": "Promotion piece if pawn reaches last rank"
          },
          "resign": {
            "type": "boolean",
            "description": "Set to true to resign the current game."
          }
        }
      },
      "rendersUi": true
    }
  ],
  "permissions": ["ui:render"]
}
```

The chess app uses the state-machine pattern: one `next_turn` tool, app decides what to do based on internal state + input fields. See `apps/chess/app.js` for the full implementation.
