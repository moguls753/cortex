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
- **Search** - semantic search via pgvector + qwen3-embedding with text fallback, filter by category/tags/date, multilingual (EN/DE)
- **Google Calendar** - automatic event creation from classified entries, multi-calendar support with LLM-based routing
- **Digests** - daily briefing and weekly review, delivered by email and shown on the dashboard
- **Self-hosted** - local embeddings, local voice transcription, LLM-agnostic (Anthropic, OpenAI, or any compatible endpoint), soft delete, 7 MCP tools

## Quick Start

```bash
git clone https://github.com/moguls753/cortex.git && cd cortex
```

Create a `.env` file with a database password:

```bash
echo "POSTGRES_PASSWORD=changeme" > .env
```

Start everything:

```bash
docker compose up -d
```

This boots PostgreSQL, Ollama (embeddings), Whisper (voice transcription), and the app. The embedding model is pulled automatically on first start.

Open `http://localhost:3000` and the **setup wizard** will walk you through:

1. **Account** - create your login credentials
2. **LLM** - pick a provider (Anthropic, OpenAI, Groq, Gemini, LM Studio, Ollama) and enter your API key
3. **Telegram** - optionally connect a Telegram bot for capture
4. **Done** - start using Cortex

Everything is reconfigurable later from the Settings page.

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

## Resource Requirements

| Service | RAM |
|---|---|
| Whisper (medium model) | ~3 GB |
| Ollama (qwen3-embedding) | ~1 GB |
| PostgreSQL | ~256 MB |
| App | ~128 MB |

**Minimum: ~4-5 GB RAM** with a cloud LLM provider (Anthropic, OpenAI).

If you run classification and digests through a local LLM via Ollama instead of a cloud provider, add the RAM for that model on top. Recommended minimum: **Qwen 2.5 7B** (~5 GB) or **Llama 3.1 8B** (~5 GB) — smaller models tend to struggle with reliable structured output. **10 GB+ RAM recommended** for fully local setups.

## Configuration

All configuration is done through the setup wizard and the Settings page. No `.env` editing required beyond `POSTGRES_PASSWORD`.

If you prefer env vars, they serve as defaults and are overridden by settings saved in the database:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | *(required)* | Database password |
| `PORT` | `3000` | Web server port |
| `TZ` | `Europe/Berlin` | Timezone for digest scheduling |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | | SMTP for email digests |
| `DIGEST_EMAIL_FROM` / `DIGEST_EMAIL_TO` | | Email addresses for digests |

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
