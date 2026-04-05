# Final Demo Script (~4 minutes)

## Pre-recording Setup

- Two browser windows side by side: student (right), teacher (left)
- Student: `student@chatbridge.local / student123`
- Teacher: `teacher@chatbridge.local / teacher123`
- URL: https://chatbridge.foramerica.dev
- Clear localStorage in both windows before recording (`localStorage.removeItem('chatbridge-auth')`)
- Allow popups from chatbridge.foramerica.dev (for Google OAuth)
- Have the Google Sheet URL ready: `https://docs.google.com/spreadsheets/d/1I8gctRZenDKaNQ2N9mfafi5jHtJY1gYjMcmghsEut4g/edit`
- Teacher window: open Safety dashboard (`/admin/safety`) — it auto-refreshes every 5s
- Do a dry run first. LLM tool use is probabilistic — if it goes off the rails, restart the conversation and retake.

## Act 1: Platform + Login (~20s)

*Start on the login screen.*

"ChatBridge is an AI chat platform for K-12 education. Third-party apps register tools, render UI inside the conversation, and communicate bidirectionally with the AI — all sandboxed, filtered, and logged."

*Log in as student. Show the server-chat page, click New Chat.*

## Act 2: Chess — Full App Lifecycle (~60s)

*PRD-required app. Most reliable. Shows the complete lifecycle.*

Type: **"let's play chess, I'll be white"**

Wait for the board to appear.

"The AI recognized the intent, invoked the chess app's next_turn tool, and the board rendered in a sandboxed iframe. The app is hosted on a separate asset domain for origin isolation."

Play 2-3 moves. The AI will respond with its moves and the board updates.

Type: **"what should I do here?"**

"The AI can analyze the board state because every tool result flows through it — it knows the FEN position, whose turn it is, and can reason about strategy. The visual board is for the student; the data channel is for the AI."

*If it goes well, play another move or two. If it stalls, move on.*

## Act 3: Google Quiz — OAuth + External Data (~45s)

*Shows the hardest integration pattern: OAuth, external API, state machine.*

*Start a new conversation (or continue in the same one if chess ended cleanly).*

Type: **"quiz me from my Google Sheet"** and provide the URL when asked (or include it in the message).

Wait for the OAuth popup. Click through Google consent.

"This is the external_auth trust tier. The platform handles the entire OAuth flow — the app requests authorization via the bridge protocol, the parent opens the popup, Google's callback hits our server, and the token is stored server-side. The iframe never sees credentials."

Answer 2-3 questions.

"The quiz app is a state machine — the AI calls next_turn, reads the state field, presents the question, waits for the student's answer, judges it, and advances. All content comes from the Google Sheet, not the AI."

## Act 4: Teacher Dashboard (~60s)

*This is the showcase piece. Grader feedback: "spend more time on admin and teacher side."*

*Switch to the teacher window (left side).*

### Safety Dashboard

"While the student was chatting, the teacher's safety dashboard has been updating in real time."

Point out the flagged content entries — severity badges (low/medium/critical), source labels (user_input, llm_output, tool_result), matched words.

*Switch back to the student window. Type something that triggers the filter:*

**"this is so damn hard"**

*Switch to teacher window. The new entry should appear within 5 seconds.*

"Every message passes through a three-tier content filter. Tier 1 is a keyword blocklist — instant, sub-millisecond. Tier 2 is a sentiment classifier using a fast model that catches crisis signals and bullying that keywords miss. Everything is logged here for teacher review."

### Activity Dashboard

Navigate to Activity (`/admin/activity`).

"Teachers see all student conversations — which apps were used, how many messages, tool invocation stats. They can click into any conversation to review it."

Point out the stats cards (total students, conversations, tool calls today) and the per-app breakdown (success/error/timeout counts).

### App Registry

Navigate to Apps (`/admin/apps`).

"Teachers approve or block apps before students can use them. Each app declares its tools, trust tier, and permissions in a manifest validated by the platform."

Show the trust tier badges (Internal, Public, OAuth). Show the approve/block toggle if any app is pending.

## Act 5: Architecture (~45s)

*Talk over the code or ARCHITECTURE.md. Can screen-share the doc or a diagram.*

"Three key architectural decisions:"

**1. Origin isolation.** "Apps are served from cb-assets.foramerica.dev — a separate origin from the platform. The browser's same-origin policy enforces isolation. Apps can't access platform cookies, localStorage, or the DOM."

**2. Bridge protocol.** "Communication between the platform and app iframes is structured postMessage — typed, Zod-validated, origin-checked. The platform sends tool invocations; apps return results. Every message goes through schema validation."

**3. Server-orchestrated tool pipeline.** "The LLM never talks to apps directly. It calls tools, the server sends an SSE event to the client, the client routes to the iframe, the app executes and returns a result, the result passes through the content filter, and flows back to the LLM. The server holds all secrets — OAuth tokens, API keys — and proxies requests on behalf of apps."

## Closing (~10s)

"Five apps across three trust tiers — internal, external public, and external with OAuth. Real-time safety monitoring, role-based access, and audit logging. Deployed at chatbridge.foramerica.dev."

---

## PRD Checklist

| PRD Item | Where in Demo |
|----------|---------------|
| 1. Basic chat + history | Acts 1-3 (conversations persist in sidebar) |
| 2. App registration | Act 4 (app registry) |
| 3. Tool invocation | Act 2 (chess next_turn) |
| 4. UI embedding | Act 2 (chess board in iframe) |
| 5. Completion signaling | Act 2 (chess move results) |
| 6. Context retention | Act 2 ("what should I do here?") |
| 7. Multiple apps + routing | Acts 2-3 (chess + google-quiz) |
| 8. Auth flows | Act 3 (Google OAuth) |
| 9. Error handling | Act 5 (mention circuit breaker, timeouts) |
| 10. Developer docs | Closing (mention deployed guide) |

## Backup Plans

- **Chess doesn't start:** Say "start chess as white" explicitly. If it still fails, skip to quiz.
- **Google OAuth popup blocked:** Allow popups before recording. If it still fails, show the teacher dashboard directly.
- **LLM fabricates content:** Restart the conversation. Fresh conversations are more reliable.
- **Tool timeout:** Wait 10 seconds, then say "try again." The circuit breaker won't trip on a single failure.
- **Filter doesn't appear on teacher dashboard:** Check that auto-refresh is running (5s interval). Try a stronger trigger word.
