# AI Cost Analysis — ChatBridge

## Development & Testing Costs

### LLM API Spend (OpenAI)

Actual spend from OpenAI dashboard for the ChatBridge project (week of Mar 30 - Apr 3):

| Metric | Value |
|--------|-------|
| Total spend | **$0.62** |
| Total tokens | 356,163 |
| Total API requests | 429 |
| Models used | gpt-4o-mini (days 1-3), gpt-5.4 (day 4+), gpt-4o-mini (Tier 2 classifier) |

Spend was low because early development used gpt-4o-mini ($0.15/$0.60 per 1M tokens). The jump to gpt-5.4 on the final day accounts for most of the cost — visible in the dashboard as the Apr 2-3 spike.

### Token Breakdown (from audit logs, representative session)

| Metric | Value |
|--------|-------|
| Avg input tokens/message | ~1,220 (short sessions) |
| Avg output tokens/message | ~54 (brief per system prompt) |
| Tool invocations tracked | 9 (post-reset sample) |
| Avg tool invocation latency | 116ms |

**Note:** Input tokens grow with conversation length due to full history in context. The 1,220 average reflects short test conversations. Production conversations with 20+ messages would average 3,000-5,000 input tokens per turn.

### Other AI-Related Costs

| Item | Cost |
|------|------|
| Linode VPS (shared 8GB) | $48/month (shared with other projects) |
| Domain (foramerica.dev wildcard) | Pre-existing, $0 incremental |
| Anthropic API (Claude Code dev agents) | ~$150 during sprint (not a production cost) |

---

## Production Cost Projections

### Assumptions

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Sessions per user per month | 20 | ~1 session per school day |
| Messages per session | 15 | Mix of chat + app interactions |
| Tool invocations per session | 5 | ~1 game or quiz per session |
| Input tokens per message (avg) | 3,000 | Grows with context; includes tool schemas |
| Output tokens per message (avg) | 150 | Brief responses per system prompt |
| Tier 2 classifier calls per session | 3 | Only on messages that don't match keywords |
| Model | gpt-5.4 | Only model that reliably follows tool-use instructions in our pipeline. gpt-4o-mini fabricated results instead of calling tools. gpt-4o not tested. |

### Per-User Monthly Cost Breakdown

| Component | Tokens/month | Cost/1M tokens | Monthly cost |
|-----------|-------------|---------------|-------------|
| Input tokens (gpt-5.4) | 900,000 | $15.00 | $13.50 |
| Output tokens (gpt-5.4) | 45,000 | $60.00 | $2.70 |
| Tier 2 classifier (gpt-4o-mini) | 9,000 | $0.15/$0.60 | ~$0.01 |
| **Per-user total** | | | **~$16.21/month** |

### Scaled Projections

| | 100 Users | 1,000 Users | 10,000 Users | 100,000 Users |
|---|-----------|-------------|--------------|---------------|
| LLM API (gpt-5.4) | $1,621/mo | $16,210/mo | $162,100/mo | $1,621,000/mo |
| Database (Postgres) | $20/mo | $50/mo | $200/mo | $1,000/mo |
| Compute (Node.js) | $48/mo | $96/mo | $480/mo | $2,400/mo |
| Bandwidth | $5/mo | $20/mo | $100/mo | $500/mo |
| **Total** | **$1,694/mo** | **$16,376/mo** | **$162,880/mo** | **$1,624,900/mo** |
| **Per user** | **$16.94** | **$16.38** | **$16.29** | **$16.25** |

### Key Observations

- **LLM API dominates costs at every scale** (>95% of total). Infrastructure is negligible.
- **Cost per user is nearly flat** — LLM pricing is per-token, so there are minimal economies of scale. Savings come from prompt optimization and caching, not infrastructure.
- **Tier 2 classifier cost is negligible** (<0.5% of LLM spend) — validates the tiered safety approach. A cheap fast model for crisis detection adds almost nothing to the bill.
- **Context window management is the key cost lever.** Conversation compaction (Loop C) would reduce input tokens by 40-60% for returning users by injecting summaries instead of full history.
- **Model selection is the elephant in the room.** gpt-5.4 is the only model that reliably followed tool-use instructions in our pipeline. gpt-4o-mini consistently fabricated game results instead of calling tools. If a cheaper model (gpt-4o or a future mid-tier) can handle structured tool use reliably, costs drop 6x overnight. This is the single biggest cost reduction opportunity — and it's entirely dependent on model capability, not our architecture.

### Cost Reduction Strategies (not implemented, future work)

1. **Tiered model routing** — Use mini for simple chat, full model only for tool-use turns
2. **Conversation compaction** — Summarize older messages to reduce input tokens
3. **Response caching** — Cache identical tool results (e.g., same chess position analysis)
4. **Prompt optimization** — Reduce system prompt size, compact tool schema descriptions
