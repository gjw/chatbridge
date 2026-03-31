# ChatBridge — 5-Minute Presentation Cheat Sheet

## 30-Second Elevator Pitch

ChatBridge is a K-12 AI chat platform where third-party apps live *inside* the
conversation. A student says "let's play chess," a board appears inline, the LLM
can see the game state and coach them, and the whole time the app is sandboxed so
it can't touch student data or show inappropriate content. Fork of Chatbox with a
new Express backend and plugin architecture.

---

## The Two Hard Problems (from the PRD)

1. **Trust & Safety** — Third-party code running inside a children's product
2. **Communication & State** — How does the chatbot stay aware of what apps are doing?

---

## What Chatbox Actually Is (and What We Change)

Chatbox is a **model-agnostic chat UI wrapper** with provider configuration — message
bubbles, streaming markdown, model picker, settings panels, i18n, theming. No built-in
persona, no safety prompts, no guardrails. System prompt starts empty — raw passthrough
to whatever LLM the user configures. All calls client-side in Electron. It trusts the
user completely. **We keep the face, replace the brain (server-side LLM with safety
middleware) and the spine (PostgreSQL instead of local storage).**

**ChatBridge can't do that — the users are children and the apps are third-party code.**

The core architectural move: **LLM calls move from client to server.** The frontend
becomes a thin streaming client. The server wraps every LLM call with:

- **Mandatory base system prompt** (K-12 tutor persona, safety instructions — not
  user-removable, teacher-customizable)
- **Content filter middleware** (every token, every tool result)
- **App tool schema injection** (from the registry, based on enabled apps)
- **Audit logging + cost tracking**

Chatbox's `stream-text.ts` orchestrator → replaced by `server/src/services/llm.ts`.

---

## Architecture at a Glance

```
Student browser (thin client)
  ├── React UI (Chatbox fork)            ← keeps existing chat UX
  ├── App iframe (sandbox=allow-scripts)  ← app renders here, isolated
  │       ↕ postMessage (typed bridge protocol)
  └── streams from Express backend (/api/chat)
              │
Express backend (/api/*)     ← THIS IS THE NEW BRAIN
  ├── Base system prompt (mandatory K-12 safety persona)
  ├── Vercel AI SDK + wrapLanguageModel middleware:
  │     content filter → audit logger → cost tracker → context builder
  ├── App registry + manifest validation (Zod)
  ├── Tool pipeline orchestration
  ├── OAuth token custody (server-side, encrypted)
  └── PostgreSQL 16 (Docker)
```

---

## Key Decisions & Why

| Decision | Why | What I Rejected |
|----------|-----|-----------------|
| **Iframe sandbox** (not Web Components) | Only real isolation for K-12. CSP + sandbox attrs. | Web Components share DOM — no security boundary |
| **postMessage bridge** (not WebSocket) | No server roundtrip for UI updates. Typed protocol with Zod validation. | WS adds complexity, latency for local iframe comms |
| **Server holds all secrets** (token custody) | Apps never see OAuth tokens or API keys. Proxy pattern. | Passing tokens to iframe = game over for security |
| **Vercel AI SDK middleware** | Already in Chatbox. `wrapLanguageModel` gives us content filter + audit + cost tracking as composable layers | Building custom streaming infra from scratch |
| **Chatbox fork** (not from scratch) | Proven chat UI, Mantine components, existing streaming. Strip Electron, keep renderer. | Building chat UI = 2-3 days wasted on solved problem |
| **PostgreSQL** (not SQLite/Firebase) | Multi-user concurrency, encrypted token storage, structured audit queries | SQLite can't do concurrent writes; Firebase = vendor lock |
| **Three-loop agent architecture** | Sub-game (1 app interaction) → Conversation (session) → Meta-agent (cross-session memory). Demonstrates long-term vision. | Flat single-loop = no cross-session awareness story |

---

## Trust & Safety (Heavily Weighted)

**The architecture makes the safety problem small by design.** Apps are tools, not
agents — they can't *decide* to do anything harmful. They can't generate language
to the student. The only thing talking to the kid is the LLM, and every token goes
through the content filter. A malicious chess app can't *say* anything — it can only
render a board.

**The entire app threat model collapses to two vectors:**

1. **Visual content in iframes** — app renders something inappropriate. Mitigated by
   curated registry (teacher approval), iframe CSP restricting external resources,
   report + instant suspend. Same model as Apple/Google kids' app stores.
2. **Poisoned tool results** — app returns toxic data hoping the LLM parrots it.
   Mitigated by content filter on tool results *before* they re-enter LLM context.

Everything else is standard LLM output filtering — same problem everyone has.

**Defense in depth (4 layers):**

1. **Iframe sandbox** — `allow-scripts` ONLY. No `allow-same-origin`, no `allow-top-navigation`, no `allow-popups`. App can't read cookies, redirect page, or open windows.
2. **Content filtering** — Every LLM token + every tool result passes through middleware. Keyword blocklist + configurable per classroom.
3. **Curated app registry** — Teachers/admins approve apps before students can use them. Report + instant suspend.
4. **Data isolation** — Apps can't read other apps' data, can't access conversation history, never see student PII. OAuth tokens encrypted at rest (pgcrypto).

---

## Tool Invocation Lifecycle (The Core Flow)

```
User: "let's play chess"
  → LLM sees chess tools in context (injected from enabled apps)
  → LLM emits tool_use: start_game
  → Server validates: tool exists? params match schema? user has app? rate limit?
  → Client loads chess iframe, sends bridge:tool:invoke
  → Chess app renders board + sends bridge:tool:result {fen, status}
  → Result passes content filter → returns to LLM context
  → LLM: "I've started a game! You're white. What's your opening?"
```

**Apps are tools, not agents.** They don't decide anything — they enforce rules, hold
state, and render UI. The conversation LLM (Loop B) is the only intelligence. It
decides what to invoke, when, and how to interpret results. "Bidirectional
communication" = one agent manipulating stateful tools that can push state back.
The bridge protocol is the puppet strings.

**Dual-channel design:** Iframe shows rich UI to student (visual channel). Structured data goes to LLM (data channel). LLM can't see the board — it reads the FEN string.

**Resilience:** 30s timeout, circuit breaker (3 fails/5min auto-disable), graceful error messages.

**Session lifecycle (design direction, not finalized):** When context window fills,
graceful wind-down — LLM generates structured summary, stored in Postgres. New session
picks up with summary injected. Full transcript kept in `messages` table — LLM can
query its own conversation history as a tool (RAG over itself) if it needs specifics
the summary lost. Compact the context, keep the record.

---

## Three Apps (Required: 3, with 3 different auth patterns)

| App | Trust Tier | Auth Pattern | Demonstrates |
|-----|-----------|-------------|-------------|
| **Chess** | Internal | None | Complex bidirectional state, ongoing interaction |
| **Weather/Dictionary** | External Public | Server-held API key | Simple tool→UI→result, external API |
| **Spotify/GitHub** | External Auth | OAuth2 (server-proxied) | Full auth flow, token custody |

---

## Roles (RBAC)

- **Student** — Use approved apps, chat
- **Teacher** — Install/approve/block apps, view student activity, configure content filters
- **Admin** — Register new apps, manage users, full audit access

---

## Likely Questions & Answers

**Q: Why not MCP (Model Context Protocol)?**
A: MCP uses stdio transport (designed for local desktop). We're web-based with iframe
isolation. Our bridge protocol is MCP-like but adapted for postMessage. Could add MCP
HTTP transport adapter later.

**Q: What if an app renders inappropriate images?**
A: Acknowledged gap. Mitigated by curated app registry (teacher approval), iframe CSP
restricting external resource loading, and report/suspend flow. Same approach as
Apple/Google app stores for kids.

**Q: How do you handle context window limits with many app tools?**
A: Context builder middleware manages tool schema injection. Only tools from user's
enabled apps are included. Future: summarize/compact tool descriptions based on relevance.

**Q: What about real-time collaboration (multiple students)?**
A: Not in scope for this sprint. Architecture supports it (server-side state, PostgreSQL),
but it's a post-MVP concern. Single-user sessions first.

**Q: Why not use NextAuth / Clerk for auth?**
A: Custom JWT is simpler for our needs (3 roles, no social login). Adding a dependency
for auth adds complexity we don't need. JWT + bcrypt + 3 role checks is ~100 lines.

**Q: How does the LLM know which app to call?**
A: Standard function calling. Tool schemas from enabled apps are injected into the system
prompt. The LLM routes based on tool descriptions — same as any tool-use implementation.
No custom routing logic needed.

**Q: What's the completion signaling approach?**
A: App sends `bridge:tool:result` or `bridge:tool:error` via postMessage. Platform
correlates by `invocationId`. If neither arrives in 30s, timeout triggers `bridge:destroy`
and error is returned to LLM. This is where most teams struggle — we have it specified
as a typed protocol.
