# Sprint Order — ChatBridge Final

**Deadline:** Sun 2026-04-05 midnight CT
**Strategy:** Address grader feedback directly. Admin/teacher side first, then auth+polish, then docs+demo.

## Grader Feedback (Early Submission)

> Student experience is the most built out — spend more time on admin and teacher side.
> Consolidate parts of the student experience. Focus on polish, auth flows, and a
> clean end-to-end lifecycle demo.

## Phase 1 — Teacher/Admin (feedback target) ✅

1. **cb-4hm** Teacher activity dashboard ✅
2. **cb-q5x** Admin navigation + role visibility ✅

## Phase 2 — Auth & Student Polish ✅

3. **cb-rvk** Google OAuth verification + auth polish ✅
4. **cb-dlk** Conversation auto-titles + UX cleanup ✅

## Phase 3 — Refinement & Docs (today)

5. **cb-e6z** Refactor quiz apps to state-machine tool pattern
   - Improves the app quality we're demoing — polish our best ideas

6. **cb-07b** README + app developer guide
   - README.md: overview, setup, env vars, deployed link
   - docs/app-developer-guide.md: manifest format, bridge protocol, quick start

7. **Testing, fixes, and polish round**
   - Manual walkthrough of all user flows (student, teacher, admin)
   - Fix anything broken or janky discovered during testing
   - Review skipped beads (cb-t68, cb-piw, cb-mrr, cb-6vp, cb-tm4) — pick up any quick wins

8. **cb-gdx** Final demo script (script only, no recording)
   - Updated demo flow: student → safety trigger → teacher dashboard → app registry → OAuth
   - Teacher activity dashboard is the showcase piece

9. **cb-umv** Record final demo video
   - Record from the script. 3-5 minutes. Last thing we do.

## Skipping (review before cb-gdx)

- **cb-t68** Conversation summaries (Loop C seed) — architecture describes it, table exists
- **cb-piw** Stockfish integration — flashy but doesn't address feedback
- **cb-mrr** Strip Sentry — cleanup, grader won't notice
- **cb-6vp** Fix test file references — cleanup
- **cb-tm4** Fix upstream type errors — cleanup

## Execution Notes

- cb-e6z first — polishes the apps before we document and demo them.
- cb-07b next — docs reflect the finished state.
- Testing round catches anything broken before we write the demo script.
- Skipped beads get a final review during the testing round — grab any 15-min wins.
- cb-gdx (script) then cb-umv (recording) are the last two steps.
