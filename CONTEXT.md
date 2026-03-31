# ChatBridge — Project Context

## Situation

- AI chat platform with third-party app integration — clone of Chatbox (chatboxai/chatbox) with plugin architecture for K-12 education use case
- **Gauntlet Week 7 project.** One-week sprint.
- **Deadlines:** MVP/Presearch Tue 2026-03-31 midnight CT | Early Thu 2026-04-02 midnight CT | Final Sun 2026-04-05 midnight CT
- **Stage:** Pre-code. Scout cold-start for presearch and architecture planning.
- **Goal:** Production-quality chat platform where third-party apps register tools, render UI in-chat, and communicate bidirectionally with the AI — with trust & safety built in from the start (K-12 audience).

## Constraints

- **Solo + agents.** One person coordinating multiple Claude Code instances.
- **Cost-aware.** Agent sessions should be purposeful, not exploratory sprawl.
- **K-12 trust & safety is a primary concern.** Third-party apps serving children. This is heavily weighted in grading.
- **Deliver to GitLab.** Clone Chatbox, build on top, push to GitLab.
- **Read PRD.pdf and INSTRUCTOR-NOTES.md** — instructor notes override PRD where they conflict.

## Roles

- **Chair** — the human. Coordinates agents, merges branches, makes final calls.
- **Tower** — planning/architecture agent. Reads requirements, designs stack, produces plans and interface code. See prompts/tower.md.
- **Trench** — coding agent(s). Receives a task, writes code on a feature branch. Multiple can run in parallel. See prompts/trench.md.

## Defaults

- **Always monorepo.** One repo, one issue database, one CLAUDE.md.
- **Git init is Chair's job.** Repo is initialized before Tower/Scout starts.
- **Chair may be voice-transcribing.** Expect conversational style with filler words.
  Parse for intent, not exact phrasing.
- **Issue tracking: beads (`br`).** Tower creates issues, Trench claims and closes.
  See `beads-agent-guide.md` for full command reference.
- **Chair merges** — agents commit to task branches, Chair spot-checks and merges.

## Workflow

- **Issue tracking** via beads (br) for work breakdown and status
- **CLAUDE.md per project** so agents have shared context
- **Frequent integration** — short-lived branches, merge to main often
- **Chair merges** — agents commit to task branches, Chair spot-checks and merges
