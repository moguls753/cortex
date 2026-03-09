# Cortex

A self-hosted, agent-readable second brain. Capture thoughts from Telegram or a web editor, classify and embed them with AI, and expose everything to any AI tool via MCP.

Your data lives on your server. No SaaS middlemen. One brain, every AI tool.

## How It Works

1. **Capture** -- Send a Telegram message (text or voice), write a note in the web dashboard, or add a thought from any AI tool via MCP.
2. **Classify** -- An LLM automatically sorts your thought into one of five categories (People, Projects, Tasks, Ideas, Reference) and extracts structured fields.
3. **Store** -- Everything goes into PostgreSQL with vector embeddings for semantic search. Your data, your server.
4. **Access** -- Browse and search from the web dashboard, get daily/weekly digests by email, or let any MCP-compatible AI tool query your brain.

```
CAPTURE                    INTELLIGENCE              STORAGE               ACCESS
───────────────────────────────────────────────────────────────────────────────────

Telegram Bot ──┐           ┌── LLM Provider           PostgreSQL            Web Dashboard
(text + voice) │           │   (Anthropic, OpenAI,    + pgvector            (browse, search,
               ├── App ────┤    or any compatible)                          edit, settings)
Web Editor ────┘           ├── Ollama
                           │   (local embeddings)     SSE ──────────────── Live updates
                           └── faster-whisper
                               (voice transcription)                       MCP Server
                                                                           (any AI tool)
```

## Features

**Capture**
- Telegram bot: text messages and voice notes (transcribed locally via faster-whisper)
- Web dashboard with quick capture and a full markdown editor
- MCP server for adding thoughts from Claude, ChatGPT, Cursor, or any MCP client

**Intelligence**
- LLM-powered classification into 5 categories with confidence scoring
- Context-aware: uses recent and semantically similar entries to improve accuracy
- Low-confidence entries get inline Telegram buttons for quick correction
- `/fix` command to reclassify the last entry

**Search and browse**
- Semantic search (cosine similarity via pgvector + snowflake-arctic-embed2)
- Text search fallback
- Filter by category, tags, date
- Multilingual: English and German

**Digests**
- Daily briefing (top priorities, stuck items, small wins)
- Weekly review (activity summary, open loops, recurring themes)
- Delivered by email and always visible on the dashboard

**Your data**
- Self-hosted: PostgreSQL, local embeddings, local voice transcription
- LLM-agnostic: Anthropic, OpenAI, or any OpenAI-compatible endpoint (LM Studio, Ollama)
- Soft delete with trash and restore
- MCP server exposes 7 tools for full CRUD access

## Quick Start

Docker Compose runs four services: the app, PostgreSQL with pgvector, Ollama for embeddings, and faster-whisper for voice transcription.

```bash
git clone <repo-url> && cd cortex
cp .env.example .env
```

Edit `.env` and set these required values:

| Variable | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Create a bot via [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Your personal Telegram chat ID |
| `LLM_API_KEY` | API key for your LLM provider |
| `WEBAPP_PASSWORD` | Password for the web dashboard |
| `SESSION_SECRET` | Run `openssl rand -hex 32` to generate |
| `POSTGRES_PASSWORD` | Database password (change from default) |

Then:

```bash
docker compose up -d
```

The app will run database migrations, pull the embedding model, and start all services. Access the dashboard at `http://localhost:3000`.

## Configuration

All settings can be overridden at runtime via the web Settings page. Env vars serve as defaults.

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openai-compatible` |
| `LLM_API_KEY` | -- | API key for classification and digests |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model for classification and digests |
| `LLM_BASE_URL` | -- | Base URL for OpenAI-compatible endpoints |
| `OLLAMA_MODEL` | `snowflake-arctic-embed2` | Embedding model |
| `TELEGRAM_BOT_TOKEN` | -- | Telegram bot token |
| `TELEGRAM_CHAT_ID` | -- | Authorized Telegram chat ID |
| `WEBAPP_PASSWORD` | -- | Web dashboard login password |
| `SESSION_SECRET` | -- | Cookie signing secret |
| `PORT` | `3000` | Web server port |
| `TZ` | `Europe/Berlin` | Timezone for digest scheduling |
| `DAILY_DIGEST_CRON` | `30 7 * * *` | Daily digest schedule |
| `WEEKLY_DIGEST_CRON` | `0 16 * * 0` | Weekly review schedule (Sunday 16:00) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | -- | SMTP for email digests |
| `DIGEST_EMAIL_TO` | -- | Digest recipient email |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `cortex` / `cortex` / -- | Database credentials |

## MCP Integration

Configure your AI tool to connect to Cortex via MCP:

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

Available tools: `search_brain`, `add_thought`, `list_recent`, `get_entry`, `update_entry`, `delete_entry`, `brain_stats`.

## For Developers

### Tech stack

Node.js + TypeScript, Hono (web), PostgreSQL + pgvector + Drizzle ORM, Ollama (embeddings), grammY (Telegram), Vitest (tests), Tailwind CSS (CLI build), Docker Compose.

### Local development

```bash
npm install
npm run dev
```

Requires a running PostgreSQL instance with pgvector and Ollama with the embedding model loaded.

### Tests

```bash
npm test              # all tests
npm run test:unit     # unit tests (fast, no Docker)
npm run test:integration  # integration tests (needs Docker for testcontainers)
```

### Specification-driven development

This project follows a spec-dd workflow:

1. Behavioral specification
2. Test specification
3. Test implementation specification
4. Implement tests (must fail)
5. Implement feature (make tests pass)
6. Review alignment

All spec artifacts live in `docs/specs/`. See `docs/specs/progress.md` for current status.

### Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture document, including database schema, capture flows, prompt contracts, error handling, and Docker Compose configuration.

## Status

All 12 features complete, 318 tests passing (234 unit + 84 integration):

Foundation, Embedding, Classification, Telegram Bot, Web Auth, Web Dashboard, Web Browse, Web Entry, Web New Note, Web Settings, MCP Server, Digests.

## License

TBD
