<h1 align="center">Cortex</h1>

<p align="center">
  A self-hosted, agent-readable second brain.<br>
  Capture from Telegram or the web, classify with AI, search by meaning, access via MCP.
</p>

<br>

**[Live Demo](https://era.github.io/cortex/)** — see the full UI with mock data, switch between dark/light theme.

<br>

## How It Works

```
You ──→ Capture ──→ Classify ──→ Store ──→ Access
        Telegram     LLM          PostgreSQL   Web Dashboard
        Web Editor   (any)        + pgvector   MCP Server
        MCP                       Embeddings   Email Digests
```

1. **Capture** — Send a Telegram message, write in the web editor, or add a thought from any AI tool via MCP.
2. **Classify** — An LLM sorts your thought into one of five categories (People, Projects, Tasks, Ideas, Reference) and extracts structured fields.
3. **Store** — PostgreSQL with vector embeddings. Semantic search finds things by meaning, not just keywords.
4. **Access** — Web dashboard, daily/weekly digests, or let any MCP-compatible AI tool query your brain.

<br>

## Features

**Capture** — Telegram bot (text + voice via faster-whisper), web dashboard with quick capture and full editor, MCP server for any AI tool.

**Intelligence** — LLM classification into 5 categories with confidence scoring. Context-aware: uses recent and similar entries. Low-confidence entries get inline Telegram buttons. `/fix` to reclassify.

**Search** — Semantic search via pgvector + snowflake-arctic-embed2. Text fallback. Filter by category, tags, date. Multilingual (EN/DE).

**Digests** — Daily briefing and weekly review, delivered by email and on the dashboard.

**Self-hosted** — PostgreSQL, local embeddings, local voice transcription. LLM-agnostic: Anthropic, OpenAI, or any compatible endpoint. Soft delete with trash. MCP with 7 CRUD tools.

<br>

## Quick Start

```bash
git clone <repo-url> && cd cortex
cp .env.example .env    # edit with your values
docker compose up -d
```

| Variable | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `LLM_API_KEY` | API key for your LLM provider |
| `WEBAPP_PASSWORD` | Web dashboard password |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Database password |

Dashboard at `http://localhost:3000`. All settings overridable at runtime via the Settings page.

<br>

## MCP Integration

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "cortex": {
      "command": "docker",
      "args": ["exec", "-i", "cortex-app-1", "node", "dist/mcp.js"]
    }
  }
}
```

7 tools: `search_brain` · `add_thought` · `list_recent` · `get_entry` · `update_entry` · `delete_entry` · `brain_stats`

<br>

## Configuration

All settings can be overridden at runtime via the web Settings page. Env vars serve as defaults.

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openai-compatible` |
| `LLM_API_KEY` | — | API key for classification and digests |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model for classification and digests |
| `LLM_BASE_URL` | — | Base URL for OpenAI-compatible endpoints |
| `OLLAMA_MODEL` | `snowflake-arctic-embed2` | Embedding model |
| `PORT` | `3000` | Web server port |
| `TZ` | `Europe/Berlin` | Timezone for digest scheduling |
| `DAILY_DIGEST_CRON` | `30 7 * * *` | Daily digest schedule |
| `WEEKLY_DIGEST_CRON` | `0 16 * * 0` | Weekly review schedule |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | — | SMTP for email digests |

<br>

## For Developers

**Stack** — Node.js, TypeScript, Hono, PostgreSQL + pgvector + Drizzle ORM, Ollama, grammY, Vitest, Tailwind CSS, Docker Compose.

```bash
npm install && npm run dev    # local development
npm test                      # all 318 tests
npm run test:unit             # fast, no Docker
npm run test:integration      # needs Docker (testcontainers)
```

**Architecture** — See [ARCHITECTURE.md](ARCHITECTURE.md) for database schema, capture flows, prompt contracts, error handling, and Docker Compose config.

**Spec-driven development** — Every feature went through: behavioral spec → test spec → test implementation spec → failing tests → passing code → review. All artifacts in `docs/specs/`.

<br>

## Status

All 12 features complete. 318 tests passing (234 unit + 84 integration).

<br>

## License

TBD
