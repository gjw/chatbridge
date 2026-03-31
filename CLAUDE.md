# ChatBridge

AI chat platform with third-party app integration — fork of Chatbox with plugin architecture.

## Role Assignment

Your first message from Chair will be your role name.

- **TOWER** → Read `prompts/tower.md` for your full instructions.
- **SCOUT** → Read `prompts/tower.md` — Scout triggers Tower in cold-start mode (new project, no existing architecture).
- **TRENCH** → Read `prompts/trench.md`. Chair provides your task.

Read `CONTEXT.md` for constraints. Read `ARCHITECTURE.md` for system design.
Read `beads-agent-guide.md` for br commands.

## Stack

- **Frontend:** React 18 / TypeScript / Mantine / Tailwind / Zustand+Jotai / TanStack Router
- **Backend:** Node 24 / Express / Vercel AI SDK
- **Database:** PostgreSQL 16 (Docker)
- **Package manager:** PNPM (required by Chatbox upstream)
- **Process manager:** PM2 (production)

## Commands

```bash
# Development
pnpm install              # Install dependencies
pnpm dev                  # Start frontend dev server
pnpm dev:server           # Start Express backend
docker compose up -d      # Start PostgreSQL

# Quality
pnpm typecheck            # tsc --noEmit
pnpm test                 # Run tests
pnpm lint                 # Biome lint + format check

# Build
pnpm build:web            # Production frontend build
pnpm build:server         # Production backend build
```

## Conventions

- **Commits:** Imperative mood, include issue ID: `Add feature (cb-a1b2)`
- **Branches:** `task/{id}-{slug}` (e.g., `task/abc1-timer-widget`)
- **Markdown formatting:** Always leave a blank line between a heading (or bold line)
  and the first list item, table, or code block below it.
- **No `any`.** Use `unknown` + narrowing.
- **No `as X` casts** unless preceded by a runtime check.
- **Zod at all boundaries.** API responses, user input, postMessage, env vars.
- **App protocol types** live in `src/shared/types/bridge.ts` and `src/shared/types/app.ts`.

## Pointers

- Read `ARCHITECTURE.md` for system design (stack, data model, bridge protocol, trust & safety).
- Run `br ready --json` for your task.
- See `beads-agent-guide.md` for br commands.
- Third-party apps live in `apps/`. Each has its own package.json.
- Server code lives in `server/`. Frontend in `src/renderer/`.
