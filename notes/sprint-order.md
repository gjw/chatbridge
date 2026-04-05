# Sprint Order — ChatBridge Final

**Deadline:** Sun 2026-04-05 midnight CT
**Strategy:** Close gaps between docs and code. Fix bugs visible in demo. Quick wins first — we may stop at any checkpoint to test and submit.

## Completed Phases

- **Phase 1** — Teacher/Admin (cb-4hm, cb-q5x) DONE
- **Phase 2** — Auth & Student Polish (cb-rvk, cb-dlk) DONE
- **Phase 3 partial** — cb-e6z refactor DONE, cb-07b docs DONE

## Phase 4 — Polish & Bug Fixes (today, ordered by impact/effort)

Stop-safe after each item. Cumulative value maximized at every checkpoint.

### Quick Wins (~55 min total)

1. **cb-69v** Hide raw JSON tool results from student view (10min)
   - Every tool call shows `JSON.stringify(result)` to students. Hide it.

2. **cb-xat** Add spinner during tool invocations (10min)
   - PRD: "lack of expected indicators will be frowned upon"

3. **cb-pzy** Fix iframe sandbox: remove `allow-same-origin` (10min)
   - ARCHITECTURE.md says omitted; code includes it. Security credibility gap.

4. **cb-tm4** Fix 6 typecheck errors (15min)
   - Was 192, now 6. Missing `search` on navigate calls + wrong var name.
   - Makes `pnpm typecheck` pass.

5. **cb-on7** Auth redirect guard (10min)
   - Unauthenticated → /login redirect for /server-chat and /admin/*

**--- STOP POINT 1: Test all user flows, could go to demo ---**

### High-Impact Medium Tasks (~65 min total)

6. **cb-uq7** Fix activity dashboard apps_used (20min)
   - Teacher dashboard showcase piece shows empty apps_used. Fix join.

7. **cb-e58** Filter LLM streaming output (30min)
   - CRITICAL: safety #1 grading axis. Streaming bypasses content filter entirely.

8. **cb-ot1** Circuit breaker user-facing error (15min)
   - Apps silently disappear on failure. Add graceful message.

**--- STOP POINT 2: Very solid, safe for final demo ---**

### Polish (~60 min total)

9. **cb-4v4** Persist blocklist to DB (20min)
   - Admin blocklist edits lost on restart. Safety feature completeness.

10. **cb-6vp** Fix test file references (10min)
    - 2 files reference deleted desktop_platform. Makes test output cleaner.

11. **cb-xbr** Markdown rendering in server-chat (30min)
    - Plain text → markdown for assistant messages. Better demo visuals.

**--- STOP POINT 3: Comprehensive ---**

### Stretch

12. **cb-t68** Loop C seed: conversation summaries (45min)
    - Table exists, no code writes to it. Thin implementation shows three-loop vision.

## Demo & Submit

13. **cb-gdx** Final demo script
14. **cb-umv** Record final demo video (last thing we do)

## Skipping

- **cb-piw** Stockfish — doesn't address grader feedback
- **cb-mrr** Strip Sentry — 18 files, low impact, risky cleanup
