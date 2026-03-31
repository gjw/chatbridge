# Architecture Video Script (~4 min)

Show the presearch PDF on screen throughout. Flip pages as you go.

---

**[Page 1 — Case Study Analysis on screen]**

So everyone knows the assignment — fork Chatbox, add third-party app integration,
K-12 audience. The two hard problems are trust and safety — third-party code running
inside a children's product — and communication — how the chatbot stays aware of
what apps are doing.

Our key architectural insight is that apps are tools, not agents. They don't generate
language or make decisions. They render UI and hold state — a chess board, a weather
widget. The AI is the only thing that talks to the student, and every word it says
goes through content filtering. A malicious app can't *say* anything to a kid because
it doesn't speak. That collapses the attack surface dramatically.

We're building small and modular — any school can stand up ChatBridge without
enterprise infrastructure. Teachers approve apps, the platform enforces safety at
runtime. Same model as education app stores.

**[Flip to page 2 — Stack + Architecture diagram]**

Chatbox is just a chat UI wrapper — model picker, streaming markdown, settings
panels. No safety, no system prompts. We keep the face, replace the brain and the
spine.

The brain is a new Express backend. All LLM calls move from client to server so
we can wrap them with mandatory middleware — a K-12 system prompt that's not
user-removable, content filtering, audit logging, cost tracking. This is all via
Vercel AI SDK's wrapLanguageModel — composable middleware layers, already in
Chatbox's dependency tree.

The spine is PostgreSQL replacing Electron's local storage — because this is
multi-user now, and we need encrypted token storage and structured audit queries.

Apps live in sandboxed iframes — allow-scripts only. We deliberately strip
allow-same-origin, allow-top-navigation, allow-popups. The app can't read our
cookies, redirect the page, or open new windows. Communication is via a typed
postMessage bridge protocol, validated with Zod on both ends.

**[Flip to page 3 — Safety diagrams]**

Trust and safety is where I spent the most design time. Three-tier filter pipeline.

Tier one is a keyword blocklist — sub-millisecond, catches the obvious stuff.

Tier two is a cheap fast classifier — Gemini Nano or Haiku — that understands
*intent*, not just words. "I hate math" is frustration. "I hate my life" is a
crisis signal. Those are categorically different events that need categorically
different responses. The cost of a Nano call per flagged message is negligible
compared to missing a cry for help.

Tier three is a full LLM review, only triggered when tier two's confidence is low.

Alerts scale by severity — profanity just gets logged, bullying pushes a
notification to the teacher, self-harm or violence threats trigger an immediate
alert to teacher *and* school admin. Teachers can kill sessions and disable apps
for their classroom instantly, no sysadmin needed.

The four defense layers — iframe sandbox, content filter on every token and tool
result, curated app registry with report-and-suspend, and data isolation with
encrypted tokens that never reach the browser.

Known gap: we can't inspect what the iframe renders visually. Mitigation is
curation plus iframe CSP restricting what resources the app can load. Same approach
as every app store for kids.

**[Flip to page 4 — Lifecycle, Three loops, Apps table]**

Quick walkthrough of the tool lifecycle. Student says "let's play chess." Server
injects chess tool schemas into the LLM context. LLM emits a tool_use call.
Server validates — does this tool exist, do the params match the schema, does
this user have this app enabled? Then the client loads the iframe and invokes
via the bridge protocol. The chess app renders the board for the student — that's
the visual channel — and sends structured game state back to the LLM — that's the
data channel. The LLM can't see the board; it reads a FEN string. Result goes
through the content filter before returning to LLM context.

The three-loop architecture: Loop A is a single app interaction — one chess game,
one quiz. Loop B is the conversation — the LLM orchestrating across app
interactions. Loop C is cross-session memory — student learning profiles built
from conversation summaries. We're seeding Loop C this sprint, not building it
fully, but the data pipeline is real.

Three apps, three trust tiers — chess is internal with no auth, a weather app
demonstrates external public with a server-held API key, and a third app shows
the full OAuth flow with server-side token custody.

That's the architecture. Happy to take questions.
