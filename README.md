# ChatBridge

AI chat platform with sandboxed third-party app integration, built for K-12 education.

**Live:** [chatbridge.foramerica.dev](https://chatbridge.foramerica.dev)

## Overview

ChatBridge is a multi-user AI chat platform where third-party apps can register tools, render interactive UI inside conversations, and communicate bidirectionally with the LLM. Built as a fork of [Chatbox](https://github.com/chatboxai/chatbox) with a full plugin architecture layered on top.

Apps run in sandboxed iframes and communicate through a typed postMessage bridge protocol. The server orchestrates everything: LLM calls, tool invocation, content filtering, and OAuth token custody. Students never touch API keys or credentials — the platform handles all of that server-side.

Content safety is built into the architecture, not bolted on. Every LLM response and tool result passes through a three-tier filter pipeline (keyword blocklist, fast classifier, full LLM review) before reaching students. Teachers get real-time alerts for flagged content and can kill sessions instantly.

For full architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Testing the Google Sheets Quiz

The Google Quiz app pulls flashcard decks from Google Sheets. To try it:

1. Log in and start a conversation
2. Say **"quiz me from this sheet"** and paste this URL:
   `https://docs.google.com/spreadsheets/d/1I8gctRZenDKaNQ2N9mfafi5jHtJY1gYjMcmghsEut4g/edit`
3. Click **Connect Google** when the app prompts you
4. Authorize with your Google account (read-only Sheets access)
5. The quiz loads terms from the sheet and the AI tutors you through them

**Note on Google OAuth:** Google requires a lengthy verification process before an OAuth app can be used by arbitrary accounts. I've pre-added known Gauntlet grader addresses to the testing whitelist. If you hit an authorization error, please reach out and I'll add your Google account — it takes under a minute. The OAuth flow itself is fully functional and demonstrated in the demo video.

The sheet is publicly readable and the OAuth scope is read-only (`spreadsheets.readonly`).

## Key Features

- **Multi-role authentication** — Students, teachers, and admins with role-based access control
- **Sandboxed app integration** — Third-party apps run in iframe sandboxes with strict CSP
- **Bridge protocol** — Typed postMessage communication between platform and apps
- **State-machine tool pattern** — Apps drive interaction flow via `next_turn`, preventing LLM drift
- **Content safety pipeline** — Three-tier filtering with real-time teacher alerts
- **OAuth token custody** — Server holds all credentials; apps request proxied API calls
- **Teacher dashboard** — Activity monitoring, content flags, session management
- **Auto-titles** — Conversations get LLM-generated titles

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Mantine, Tailwind, Zustand + Jotai, TanStack Router |
| Backend | Node 24, Express, Vercel AI SDK |
| Database | PostgreSQL 16 (Docker) |
| Auth | JWT (platform) + OAuth2 proxy (per-app) |
| Package Manager | PNPM |
| Process Manager | PM2 (production) |

## Setup

### Prerequisites

- Node.js 24+
- PNPM 10+
- Docker (for PostgreSQL)

### Install and run

```bash
# Clone and install
git clone <repo-url> chatbridge
cd chatbridge
pnpm install

# Start PostgreSQL
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env — set OPENAI_API_KEY at minimum

# Initialize database and seed accounts
pnpm --filter @chatbridge/server seed

# Start development servers
pnpm dev          # Frontend (http://localhost:1212)
pnpm dev:server   # Backend  (http://localhost:3100)
```

### Default accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@chatbridge.local | admin123 |
| Teacher | teacher@chatbridge.local | teacher123 |
| Student | student@chatbridge.local | student123 |

### Start apps (optional)

Each app runs its own dev server. From the app directory:

```bash
cd apps/chess && npx serve -l 3200 -s .
cd apps/quiz && npx serve -l 3202 -s .
cd apps/wordle && npx serve -l 3201 -s .
cd apps/google-quiz && npx serve -l 3205 -s .
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `DATABASE_URL` | `postgresql://chatbridge:chatbridge@localhost:5432/chatbridge` | PostgreSQL connection string |
| `CORS_ORIGIN` | `http://localhost:1212` | Allowed CORS origin |
| `JWT_SECRET` | (dev default) | Secret for JWT signing (min 32 chars) |
| `JWT_EXPIRES_IN` | `3600` | Access token lifetime (seconds) |
| `JWT_REFRESH_EXPIRES_IN` | `604800` | Refresh token lifetime (seconds) |
| `OPENAI_API_KEY` | — | OpenAI API key for LLM calls |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID (for Google Sheets apps) |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth client secret |
| `NODE_ENV` | `development` | Environment mode |

## Commands

```bash
pnpm dev              # Start frontend dev server
pnpm dev:server       # Start backend dev server
pnpm build:web        # Production frontend build
pnpm build:server     # Production backend build
pnpm typecheck        # TypeScript type checking
pnpm test             # Run tests
pnpm lint             # Biome lint + format check
```

## Building Apps

See the [App Developer Guide](docs/app-developer-guide.md) for how to build third-party apps that integrate with ChatBridge.

## License

Private — Gauntlet Week 7 project.
