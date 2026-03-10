<h1 align="center">Cortex</h1>

<p align="center">
  A self-hosted, agent-readable second brain.<br>
  Capture from Telegram or the web, classify with AI, search by meaning, access via MCP.
</p>

<p align="center">
  <a href="https://moguls753.github.io/cortex/"><strong>Live Demo</strong></a>
</p>

## How It Works

1. **Capture** - send a Telegram message, write in the web editor, or add a thought via MCP from any AI tool.
2. **Classify** - an LLM sorts it into one of five categories (People, Projects, Tasks, Ideas, Reference) and extracts structured fields.
3. **Store** - PostgreSQL with pgvector embeddings. Search by meaning, not just keywords.
4. **Access** - web dashboard, daily/weekly email digests, or query your brain from any MCP-compatible tool.

## Features

- **Capture** - Telegram bot with text and voice (faster-whisper), web dashboard with quick capture and full editor, MCP server
- **Intelligence** - LLM classification into 5 categories with confidence scoring, context-aware (uses recent + similar entries), inline Telegram buttons for low-confidence entries, `/fix` to reclassify
- **Search** - semantic search via pgvector + snowflake-arctic-embed2 with text fallback, filter by category/tags/date, multilingual (EN/DE)
- **Digests** - daily briefing and weekly review, delivered by email and shown on the dashboard
- **Self-hosted** - local embeddings, local voice transcription, LLM-agnostic (Anthropic, OpenAI, or any compatible endpoint), soft delete, 7 MCP tools

## Quick Start

```bash
git clone https://github.com/moguls753/cortex.git && cd cortex
cp .env.example .env
```

Open `.env` and add your LLM API key:

```
LLM_API_KEY=your-key-here
```

Then start everything:

```bash
docker compose up -d
```

This boots PostgreSQL, Ollama, Whisper, and the app. The embedding model is pulled automatically on first start.

Open `http://localhost:3000`, log in with password `cortex`, and you're ready to go.

For Telegram capture, also set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`. All settings are editable at runtime from the Settings page.

## MCP

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

Tools: `search_brain` · `add_thought` · `list_recent` · `get_entry` · `update_entry` · `delete_entry` · `brain_stats`

## Configuration

Env vars serve as defaults. Everything is overridable from the Settings page at runtime.

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openai-compatible` |
| `LLM_API_KEY` | | API key for classification and digests |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model for classification and digests |
| `LLM_BASE_URL` | | Base URL for OpenAI-compatible endpoints |
| `OLLAMA_MODEL` | `snowflake-arctic-embed2` | Embedding model |
| `PORT` | `3000` | Web server port |
| `TZ` | `Europe/Berlin` | Timezone for digest scheduling |
| `DAILY_DIGEST_CRON` | `30 7 * * *` | Daily digest schedule |
| `WEEKLY_DIGEST_CRON` | `0 16 * * 0` | Weekly review schedule |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | | SMTP for email digests |

## Development

Stack: Node.js, TypeScript, Hono, PostgreSQL + pgvector + Drizzle ORM, Ollama, grammY, Vitest, Tailwind CSS, Docker Compose.

```bash
npm install && npm run dev    # local dev
npm test                      # 318 tests
npm run test:unit             # fast, no Docker
npm run test:integration      # needs Docker (testcontainers)
```

Architecture, schema, and prompt contracts are documented in [ARCHITECTURE.md](ARCHITECTURE.md). Spec artifacts in `docs/specs/`.

## License

TBD
