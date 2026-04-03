# Demo Video Script (~4 minutes)

## Setup

Two browser windows side by side — student on the right, teacher safety dashboard on the left. Both logged in already.

- Student: `student@chatbridge.local / student123`
- Teacher: `teacher@chatbridge.local / teacher123`

URL: https://chatbridge.foramerica.dev

## Act 1: The Platform (30s)

*Talking over the login screen, then server-chat:*

"ChatBridge is a chat platform for K-12 education that lets third-party apps live inside the conversation. Students interact naturally — the AI decides when to invoke apps, renders their UI inline, and stays aware of what happened. Everything is sandboxed, filtered, and logged."

*Show the conversations sidebar, click New Chat.*

## Act 2: Wordle — Full App Lifecycle (60s)

*Hits testing scenarios: tool discovery, UI rendering, completion signaling, context retention.*

- Type: **"let's play wordle"**
- Wait for board to appear. *"The AI recognized the intent, invoked the wordle app, and the game board rendered inside the chat."*
- Play 2-3 guesses. *"Each guess goes through the tool pipeline — the app validates against a dictionary API, returns structured results, and the AI narrates what happened."*
- Finish or get close. Then type: **"how am I doing? what letters have I ruled out?"**
- *"The AI retains context from the app's tool results — it knows exactly which letters were tried and what the results were, even though the visual board is the primary interface."*

## Act 3: Quiz — Switch Apps Mid-Conversation (45s)

*Hits testing scenarios: app switching, routing accuracy.*

- In the SAME conversation, type: **"actually, quiz me in Spanish instead"**
- *"The AI routes to the quiz app — different app, same conversation. No page reload, no context loss."*
- Answer 2 questions. One right, one wrong.
- Type: **"what did I get wrong?"**
- *"Context retention across app interactions. The AI can discuss quiz results because every tool invocation flows through it."*

## Act 4: Safety — The K-12 Story (60s)

*This is the money shot. Hits trust & safety.*

- Still as student, type: **"how do you say bitch-ass motherfucker en español?"**
- Then: **"I'm going to burn this fucking place down"**
- *Cut to teacher dashboard on the left.* It should have auto-refreshed with new entries.
- *"Every message passes through a three-tier safety pipeline. Tier 1 is a keyword blocklist — instant, sub-millisecond. Tier 2 is a sentiment classifier — a cheap fast model that catches threats, crisis signals, and bullying that keywords would miss. The teacher sees flagged content in real time."*
- Point out the severity badges, student name, source labels.
- Click a flagged entry's content link to drill into the conversation.
- *"Teachers can review the full conversation context for any flagged message."*
- *"Admins can also edit the blocklist live."* (Show the blocklist editor if logged in as admin.)

## Act 5: Architecture (60s)

*Talking over ARCHITECTURE.md or a diagram.*

- **Bridge protocol:** "Apps run in sandboxed iframes. Communication is structured postMessage — typed, validated, origin-checked. Apps never touch the platform DOM or other apps."
- **Tool pipeline:** "The LLM gets tool schemas from installed apps. When it calls a tool, the server sends an SSE event to the client, the client routes to the iframe, the app executes and returns a result, the result goes back to the LLM."
- **Content filtering:** "Three tiers — keyword blocklist, sentiment classifier, and the LLM's own safety training. All logged to the teacher dashboard."
- **Trust tiers:** "Internal apps are bundled. External public apps use proxied APIs. External auth apps would use server-side OAuth token custody — the browser never sees credentials."

## Closing (15s)

"Three apps, three different integration patterns. Real-time safety monitoring. The platform is deployed at chatbridge.foramerica.dev."

## Testing Scenarios Covered

1. ✅ Tool discovery and invocation (wordle start)
2. ✅ App UI renders in chat (wordle board, quiz card)
3. ✅ User interacts, completion signaling (wordle guesses, quiz answers)
4. ✅ Context retention (asking about results after game/quiz)
5. ✅ Switch between multiple apps (wordle → quiz in same conversation)
6. ✅ Routing accuracy (natural language → correct app)
7. ✅ Refuses unrelated queries (implicit — AI doesn't invoke apps for normal chat)
