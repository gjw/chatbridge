# Sprint Order — ChatBridge Final

**Deadline:** Sun 2026-04-05 midnight CT (~36 hours from now)
**Budget:** 8-12 hours of work
**Strategy:** Address grader feedback directly. Admin/teacher side first, then auth+polish, then docs+demo.

## Grader Feedback (Early Submission)

> Student experience is the most built out — spend more time on admin and teacher side.
> Consolidate parts of the student experience. Focus on polish, auth flows, and a
> clean end-to-end lifecycle demo.

## Phase 1 — Teacher/Admin (feedback target)

These two tasks are the direct response to "spend more time on admin and teacher side."

1. **cb-4hm** Teacher activity dashboard
   - New `/admin/activity` route — student conversation browser, tool usage stats
   - Server endpoint joining conversations + users + tool_invocations
   - Filter by student, date, app. Click to view conversation.
   - **This is the highest-ROI task. Build it first.**

2. **cb-q5x** Admin navigation + role visibility *(depends on cb-4hm)*
   - Wire admin links into sidebar: Activity, Safety, Apps, Users
   - Role-appropriate visibility (students see nothing, teachers see subset, admins see all)
   - Back-to-chat nav from admin pages
   - Can start once cb-4hm creates the activity route to link to.

## Phase 2 — Auth & Student Polish (parallel with Phase 1 tail)

These address "polish, auth flows, clean end-to-end lifecycle."

3. **cb-rvk** Google OAuth verification + auth polish *(no dependencies)*
   - Finish GCP setup (consent screen + credentials)
   - Test Google OAuth end-to-end with google-quiz app
   - Fix register redirect (→ /server-chat not /)
   - Verify token refresh works

4. **cb-dlk** Conversation auto-titles + UX cleanup *(no dependencies)*
   - Background LLM call after first exchange to generate 5-word title
   - PATCH /api/conversations/:id endpoint
   - Clean up legacy Chatbox landing page flash
   - Sign-out polish

**Parallelization:** cb-rvk and cb-dlk can run alongside cb-q5x. If only one Trench
at a time, do cb-rvk first (auth is grader-visible), then cb-dlk.

## Phase 3 — Documentation & Demo (after implementation)

5. **cb-07b** README + app developer guide *(depends on cb-4hm)*
   - README.md: overview, setup, env vars, deployed link
   - docs/app-developer-guide.md: manifest format, bridge protocol, quick start
   - Write after dashboard exists so we can document it.

6. **cb-gdx** Final demo script + video *(depends on everything)*
   - Updated demo flow: student → safety trigger → teacher dashboard → app registry → OAuth
   - Teacher activity dashboard is the showcase piece
   - 3-5 minutes, record last

## Skipping

These open beads are explicitly deprioritized for final:

- **cb-t68** Conversation summaries (Loop C seed) — architecture describes it, table exists, not enough ROI for 8-12hr sprint
- **cb-piw** Stockfish integration — flashy but doesn't address feedback
- **cb-mrr** Strip Sentry — cleanup, grader won't notice
- **cb-6vp** Fix test file references — cleanup
- **cb-tm4** Fix upstream type errors — cleanup

## Dependency Graph

```
Phase 1:  cb-4hm ──→ cb-q5x ──→ cb-gdx
                  └──→ cb-07b ──→ cb-gdx
Phase 2:  cb-rvk ─────────────→ cb-gdx
          cb-dlk ─────────────→ cb-gdx
```

## Execution Notes

- cb-4hm is the critical path. Everything downstream depends on it or runs parallel.
- cb-rvk requires Gabriel to finish GCP credential setup before Trench can test.
- cb-gdx (demo) must be last — it's the integration test of everything else.
- If time gets tight, cut cb-07b scope (README only, skip dev guide) before cutting anything in Phase 1-2.
