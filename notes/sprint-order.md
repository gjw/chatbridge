# Sprint Order — ChatBridge

## Presearch (due Tue 2026-03-31 midnight CT)

- **cb-zvy** Presearch document + architecture video — PARALLEL with everything below

## Critical Path (sequential)

1. **cb-al3** Fork Chatbox and strip Electron
2. **cb-ttw** Shared types + Zod schemas — PARALLEL with cb-uoh, cb-p5r
3. **cb-uoh** Express server scaffold — PARALLEL with cb-ttw, cb-p5r
4. **cb-p5r** PostgreSQL schema + Docker setup — PARALLEL with cb-ttw, cb-uoh
5. **cb-n7i** User auth (JWT) — needs cb-uoh + cb-p5r
6. **cb-hw7** Chat API + streaming — needs cb-uoh + cb-p5r + cb-ttw
7. **cb-dbb** Content safety middleware — needs cb-hw7, PARALLEL with cb-b9d, cb-4sv
8. **cb-b9d** App registry + manifest validation — needs cb-n7i + cb-ttw
9. **cb-4sv** Bridge protocol + iframe host — needs cb-ttw, PARALLEL with cb-b9d
10. **cb-mnv** Tool pipeline integration — needs cb-hw7 + cb-b9d + cb-4sv (THE CRUX)
11. **cb-31g** Chess app — needs cb-mnv

## Parallel after tool pipeline

- **cb-ivj** Second third-party app — needs cb-mnv
- **cb-o5g** Third third-party app (OAuth) — needs cb-mnv
- **cb-t68** Conversation summaries (Loop C seed) — needs cb-hw7
- **cb-l04** Deploy to Linode — needs cb-hw7 (can start early, iterate)
- **cb-mol** Developer docs + API guide — needs cb-mnv

## Parallelization Opportunities

- After cb-al3 completes: cb-ttw, cb-uoh, cb-p5r can ALL run in parallel (3 Trench agents)
- After cb-uoh + cb-p5r: cb-n7i and cb-hw7 can run in parallel (2 agents)
- After cb-hw7: cb-dbb, cb-t68, cb-l04 can run in parallel with cb-b9d and cb-4sv
- After cb-mnv: cb-31g, cb-ivj, cb-o5g, cb-mol can all run in parallel (4 agents)

## Milestones

- **presearch:** cb-zvy (Tue midnight)
- **mvp:** cb-al3 → cb-mnv + cb-31g + cb-dbb (working chat + chess + safety)
- **early:** cb-ivj, cb-o5g, cb-t68, cb-l04, cb-mol (Thu midnight — draft quality)
