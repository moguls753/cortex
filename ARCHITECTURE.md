# Cortex — Architecture v3

## What This Is

A self-hosted, agent-readable second brain. Capture thoughts from Telegram (text or voice) or a web editor, classify and embed them with AI, store everything in PostgreSQL with vector search, and expose it to any AI tool via MCP.

Your data lives on your server. No SaaS middlemen. One brain, every AI tool.

## Design Principles

- **One behavior:** Send a Telegram message or write a note in the webapp. Everything else is automated.
- **Agent-readable:** Every thought is embedded and searchable by meaning via MCP. Any AI tool that speaks MCP can read, write, update, and delete from your brain.
- **Own your data:** PostgreSQL on your server. No proprietary formats. No lock-in.
- **Prompts as contracts:** The LLM returns structured JSON. No creative output in the pipeline.
- **LLM-agnostic:** Classification and digests work with any LLM — Anthropic, OpenAI, or any OpenAI-compatible endpoint (LM Studio, Ollama chat, etc.). Swap providers without code changes.
- **Trust mechanism:** Confidence scores, confirmation messages, inline correction buttons, fix command, manual override in webapp.
- **Safe by default:** When uncertain, ask rather than misfile. Low-confidence entries get inline category buttons for quick correction.
- **Compounding:** Every thought captured makes semantic search smarter. The system gets more valuable over time.
- **Multilingual:** Embeddings support English and German at minimum.

## Architecture

```
CAPTURE                    INTELLIGENCE              STORAGE                 ACCESS
─────────────────────────────────────────────────────────────────────────────────────

Telegram Bot ──┐           ┌── LLM Provider           PostgreSQL + pgvector    Web Dashboard
(text + voice) │           │   (Anthropic, OpenAI,    (entries, embeddings,    (browse, search,
               ├── App ────┤    or any OpenAI-         settings, metadata)     edit, digest,
Web Editor ────┘           │    compatible endpoint)                           settings)
(long notes)               ├── Ollama
                           │   (local embeddings,     SSE ────────────────── Live updates
                           │    snowflake-arctic-                              (new entries,
                           │    embed2)                                        digest refresh)
                           │
                           └── faster-whisper                                MCP Server
                               (voice transcription)                          (any AI tool:
                                                                              Claude, ChatGPT,
                           ┌── SMTP                                           Cursor, etc.)
                           │   (email digests)
               App ────────┤
                           └── Google Calendar
                               (optional)
```

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Runtime | Node.js + TypeScript | One language everywhere |
| Web framework | Hono | Lightweight, TypeScript-first, serves API + pages + SSE |
| Database | PostgreSQL + pgvector | Vector search, battle-tested, boring (good) |
| Embeddings | Ollama + snowflake-arctic-embed2 | Local, free, private, 1024 dimensions, multilingual (EN+DE) |
| LLM (classification + digests) | Any: Anthropic, OpenAI, OpenAI-compatible | Provider abstraction — two implementations: `@anthropic-ai/sdk` and `openai` SDK (covers LM Studio, Ollama chat, OpenAI, etc.) |
| Voice | faster-whisper (medium model) | Local speech-to-text, no external API needed |
| Telegram | grammY | Best TypeScript Telegram bot library |
| ORM | Drizzle | Typed queries, lightweight, native pgvector support |
| Cron | node-cron | Simple scheduled jobs |
| Email | nodemailer | SMTP sending |
| MCP | @modelcontextprotocol/sdk | Official MCP server SDK |
| Frontend | Server-rendered HTML + Tailwind CSS (CLI build) | Pre-built CSS, no runtime overhead, responsive |
| Deployment | Docker Compose | App + PostgreSQL + Ollama + faster-whisper |

## Categories

Five categories. Each answers a distinct question.

| Category | Question | Actionable? |
|---|---|---|
| People | Who should I stay connected with? | Follow-ups |
| Projects | What am I working on? | Next actions |
| Tasks | What do I need to do? | Due dates |
| Ideas | What did I think of? | No |
| Reference | What did I want to remember? | No |

The LLM's decision tree for classification:

1. About a specific person? → **People**
2. Multi-step ongoing work? → **Projects**
3. One-off thing to do? → **Tasks**
4. Creative thought or insight? → **Ideas**
5. Fact or detail to store? → **Reference**

### Status Values

**Projects:** `active`, `paused`, `done`, `cancelled`
- "Stalled" is not a stored status — it is derived: status is `active` but `updated_at` is older than 5 days.

**Tasks:** `pending`, `done`, `cancelled`

## Database Schema

All entries live in one table with category-specific fields stored as JSONB.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE entries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category      TEXT CHECK (category IN ('people', 'projects', 'tasks', 'ideas', 'reference')),
    name          TEXT NOT NULL,
    content       TEXT,                  -- raw input or full note body (markdown)
    fields        JSONB NOT NULL DEFAULT '{}', -- category-specific structured data
    tags          TEXT[] DEFAULT '{}',
    confidence    REAL,                  -- classification confidence (null if manual via webapp)
    source        TEXT NOT NULL CHECK (source IN ('telegram', 'webapp', 'mcp')),
    source_type   TEXT DEFAULT 'text' CHECK (source_type IN ('text', 'voice')),
    embedding     vector(1024),          -- snowflake-arctic-embed2 dimensions
    deleted_at    TIMESTAMPTZ,           -- soft delete (null = active)
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- HNSW index: works on empty tables, better recall than IVFFlat for small datasets
CREATE INDEX ON entries USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON entries (category);
CREATE INDEX ON entries (created_at);
CREATE INDEX ON entries USING gin (tags);

-- Settings table: UI-configurable preferences (env vars are defaults, DB overrides)
CREATE TABLE settings (
    key           TEXT PRIMARY KEY,
    value         TEXT NOT NULL,
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entries_updated_at
    BEFORE UPDATE ON entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

Note: `category` is nullable to support unclassified entries (when LLM API fails). These are flagged on the dashboard.

### Category-specific fields (JSONB)

**People:**
```json
{
    "context": "Product lead at Acme, met at conference",
    "follow_ups": "Ask about Q2 roadmap next call"
}
```

**Projects:**
```json
{
    "status": "active",
    "next_action": "Email Sarah to confirm copy deadline",
    "notes": "Launch target end of Q2"
}
```

**Tasks:**
```json
{
    "due_date": "2026-04-01",
    "status": "pending",
    "notes": "Need photos too"
}
```

**Ideas:**
```json
{
    "oneliner": "Self-hosted second brain using MCP",
    "notes": "Could be open sourced"
}
```

**Reference:**
```json
{
    "notes": "Use host.docker.internal to access host from container"
}
```

### Settings Table

UI-configurable preferences. Env vars provide defaults; settings table overrides them.

| Key | Type | Default source | Description |
|---|---|---|---|
| `telegram_chat_ids` | JSON array | `TELEGRAM_CHAT_ID` env var | Authorized Telegram chat IDs |
| `llm_provider` | string | `LLM_PROVIDER` env var / `anthropic` | LLM provider: `anthropic` or `openai-compatible` |
| `llm_model` | string | `LLM_MODEL` env var | Model name for classification + digests |
| `llm_base_url` | string | `LLM_BASE_URL` env var | Base URL for OpenAI-compatible endpoints |
| `digest_daily_cron` | string | `DAILY_DIGEST_CRON` env var / `30 7 * * *` | Daily digest cron expression |
| `digest_weekly_cron` | string | `WEEKLY_DIGEST_CRON` env var / `0 16 * * 0` | Weekly review cron expression |
| `timezone` | string | `TZ` env var / `Europe/Berlin` | Timezone for digest scheduling |
| `confidence_threshold` | number | `0.6` | Threshold for confident vs uncertain classification |
| `digest_email_to` | string | `DIGEST_EMAIL_TO` env var | Digest email recipient |
| `ollama_url` | string | `OLLAMA_URL` env var | Ollama server URL |

## Capture Flows

### Telegram (quick capture — text)

```
User sends text message
  → Validate sender (chat ID check against authorized list)
  → Fetch context: last 5 recent entries + top 3 semantically similar entries
  → Classify with LLM (with context) → structured JSON
  → Generate embedding with Ollama
  → Store in PostgreSQL
  → If confidence >= threshold:
      → Reply: "✅ Filed as {category} → {name} ({confidence}%) — reply /fix to correct"
  → If confidence < threshold:
      → Store with category from best guess, flag for review
      → Reply: "❓ Best guess: {category} → {name} ({confidence}%)"
      → Show inline keyboard with 5 category buttons for quick correction
  → If calendar_date detected and Google Calendar configured:
      → Create calendar event
```

`create_calendar_event` and `calendar_date` from the LLM's response are ephemeral — used to trigger the calendar event, not stored in the database.

### Telegram (quick capture — voice)

```
User sends voice message
  → Validate sender (chat ID check against authorized list)
  → Download audio file (OGG/Opus)
  → Transcribe with faster-whisper → text
  → Same classification pipeline as text messages
  → Store with source_type: 'voice'
  → Reply includes transcription: "🎤 '{transcript}'\n✅ Filed as {category} → {name} ({confidence}%)"
```

### Telegram — inline category correction

```
User taps category button on low-confidence entry
  → Update entry's category
  → Re-generate category-specific fields with LLM (using correction context)
  → Re-generate embedding
  → Update reply: "✅ Fixed → {new category} → {name}"
```

### Webapp — quick capture

Same as Telegram text flow but via a text input on the dashboard page. User types a thought (markdown supported), hits enter. Same classification pipeline, result appears inline on the page via SSE.

### Webapp — full editor

```
User writes note in web editor
  → Chooses category (or clicks "AI Suggest" for LLM to propose)
  → Writes title and body (markdown)
  → Picks tags (autocomplete from existing tags, or lets LLM suggest)
  → Save
  → Generate embedding with Ollama
  → Store in PostgreSQL (confidence: null, source: 'webapp')
```

### MCP (from any AI tool)

```
AI tool calls MCP "add_thought" tool
  → Fetch context: last 5 recent entries + top 3 semantically similar
  → Classify with LLM (with context)
  → Generate embedding
  → Store in PostgreSQL (source: 'mcp')
  → Return classified entry as confirmation
```

### Fix Command (Telegram)

```
User sends "/fix this should be a person not a project"
  → Find most recent entry by this user
  → Re-classify with LLM using correction context
  → Update category, fields, re-generate embedding
  → Reply: "✅ Fixed → {new category} → {name}"
```

## Web Dashboard

Server-rendered HTML via Hono. No SPA. Tailwind CSS pre-built via CLI. Responsive design. The user's browser start page. Live updates via Server-Sent Events (SSE).

### Authentication

Single-user system. Protected with a `SESSION_SECRET` env var used for cookie-based auth. Login page with a configured password (`WEBAPP_PASSWORD` env var). All routes except `/login` and `/health` require authentication.

### Pages

**Dashboard (`/`)**
- Today's digest (same content as email, always visible)
- Recent entries (last 7 days, grouped by day)
- Quick stats (entries this week, open tasks, stalled projects)
- Quick capture input at the top (markdown supported)
- Live updates via SSE (new entries appear without page refresh)

**Browse (`/browse`)**
- Entries by category, filterable and searchable
- Semantic search bar ("what do I know about career changes")
- Text search fallback (matching exact words in name/content)
- Tag filtering with autocomplete
- Minimum similarity threshold: 0.5 for semantic search results

**Entry view/edit (`/entry/:id`)**
- View any entry with rendered markdown
- Edit mode: textarea with markdown, change category/tags/fields
- Soft delete with confirmation (moves to trash)

**New note (`/new`)**
- Full editor for long-form notes
- Category selector (manual or AI-suggested)
- Tag input with autocomplete from existing tags
- Markdown textarea
- "AI Suggest" button for auto-classification

**Trash (`/trash`)**
- List of soft-deleted entries
- Restore button (sets deleted_at back to null)
- Empty trash button (hard delete all trashed entries)

**Settings (`/settings`)**
- Authorized Telegram chat IDs (add/remove)
- Classification model selection
- Digest schedule (daily and weekly cron expressions)
- Timezone
- Confidence threshold
- Digest email recipient
- Ollama server URL

## MCP Server

Exposes the brain to any AI tool via Model Context Protocol.

### Transport

**Stdio transport.** The MCP server runs as a separate entrypoint (`src/mcp.ts`) that communicates over stdin/stdout. Configure in your AI tool's MCP settings:

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

**Streamable HTTP transport.** For remote access (e.g., from a different machine), use the dedicated endpoint on the Hono server at `/mcp`. Requires the same session authentication as the webapp.

### Tools

**`search_brain`** — Semantic search across all entries
```
Input:  { query: "people considering career changes", limit?: 10 }
Output: Matching entries ranked by semantic similarity (threshold >= 0.5)
```

**`add_thought`** — Capture a thought from any AI tool
```
Input:  { text: "Sarah mentioned she's considering consulting" }
Output: Classified entry with category, name, confidence
```

**`list_recent`** — Browse recent entries
```
Input:  { days?: 7, category?: "projects" }
Output: Entries from the last N days, optionally filtered by category
```

**`get_entry`** — Read a specific entry
```
Input:  { id: "uuid" }
Output: Full entry with all fields and content
```

**`update_entry`** — Update an existing entry
```
Input:  { id: "uuid", name?: "new name", content?: "new content", category?: "tasks", tags?: ["tag1"], fields?: { ... } }
Output: Updated entry
```

**`delete_entry`** — Soft-delete an entry
```
Input:  { id: "uuid" }
Output: Confirmation of deletion
```

**`brain_stats`** — Overview of what's in the brain
```
Input:  {}
Output: Entry counts by category, recent activity, open tasks, stalled projects
```

## Digests

### Daily Digest (configurable, default 07:30)

Reads from the database:
- Active projects with next actions
- People with pending follow-ups
- Tasks due within 7 days
- Items captured yesterday

Sends to the configured LLM with the daily digest prompt. Result delivered via:
- Email (SMTP)
- Dashboard (cached, always visible on start page, pushed via SSE)

Format (150 words max, plain text):
```
Good morning

TOP 3 TODAY
• Email Sarah to confirm copy deadline (Website Relaunch)
• Renew passport — due in 12 days
• Follow up with Marcus about the proposal

STUCK ON
• AI Second Brain project has no next action defined

SMALL WIN
• You filed 8 thoughts yesterday — that's a streak
```

### Weekly Review (configurable, default Sunday 16:00)

Reads past 7 days of entries, activity stats, stalled projects.

Format (250 words max, plain text):
```
Weekly Review — w/c 24 Feb

WHAT HAPPENED
• Filed 23 thoughts across 5 categories
• 2 projects moved to done

OPEN LOOPS
• Website Relaunch — no update in 5 days
• Call with Marcus still pending

NEXT WEEK
• Confirm Sarah's deadline
• Start passport renewal
• Review Q2 budget draft

RECURRING THEME
• Lots of tasks piling up — consider a dedicated session
```

## Prompts

### Classification Prompt

```
You are a classification engine for a personal knowledge management system.

Classify the following thought into exactly one category:
- people: about a specific person, relationship, or social interaction
- projects: about work, a goal, or something with multiple steps
- tasks: a one-off thing to do, errand, appointment, or deadline
- ideas: a standalone insight, concept, or creative thought
- reference: a fact, detail, or piece of information to remember

Context (recent and related entries for reference):
{context_entries}

Return ONLY valid JSON. No explanation. No markdown.

Schema:
{
    "category": "people|projects|tasks|ideas|reference",
    "name": "short descriptive title (max 6 words)",
    "confidence": 0.0-1.0,
    "fields": { ... category-specific ... },
    "tags": ["tag1", "tag2"],
    "create_calendar_event": true|false,
    "calendar_date": "YYYY-MM-DD or null"
}

Category-specific fields:
- people:    { "context": "", "follow_ups": "" }
- projects:  { "status": "active|paused|done|cancelled", "next_action": "", "notes": "" }
- tasks:     { "due_date": "YYYY-MM-DD or null", "status": "pending|done|cancelled", "notes": "" }
- ideas:     { "oneliner": "", "notes": "" }
- reference: { "notes": "" }

Principles:
- Extract a concrete next_action for projects — never vague intentions
- Set create_calendar_event true only when there is a clear date or deadline
- If genuinely ambiguous, return your best guess with confidence below 0.6
- Never invent details not present in the input
- For people, always try to extract a follow_up action if one is implied
- For tasks, extract due_date if any temporal reference exists
- Tags should be lowercase, short, and relevant
- Use existing entry names when the input clearly refers to the same person/project
```

### Daily Digest Prompt

```
You are a personal assistant generating a morning briefing.

Rules:
- Maximum 150 words
- Plain text, no markdown headers
- 3 sections: TOP 3 TODAY, STUCK ON, SMALL WIN
- Be direct and specific — use actual names
- Never be motivational or generic
- If there are no stuck items, say "Nothing stalled — good momentum"
- If there is no recent activity, say so honestly instead of inventing wins
```

### Weekly Review Prompt

```
You are a personal assistant generating a weekly review.

Rules:
- Maximum 250 words
- Plain text
- 4 sections: WHAT HAPPENED, OPEN LOOPS, NEXT WEEK, RECURRING THEME
- Be honest about stalled work
- Use actual names and project titles
- If the week was quiet, acknowledge it without judgment
```

## Error Handling

### Strategy

Log errors with structured JSON logging (timestamp, level, module, message, context). Errors should degrade gracefully, never crash the app.

### By component

**LLM API** — If classification fails (timeout, rate limit, bad response), store the entry with `category: null` and `confidence: null`. Flag it on the dashboard as "unclassified." Retry on next cron cycle or let the user classify manually via webapp.

**Ollama** — If embedding generation fails, store the entry without an embedding (`embedding: null`). The entry is still browsable and editable, just not searchable via semantic search. Log a warning. Retry embedding generation on a background cron (every 15 minutes, process entries with null embeddings).

**faster-whisper** — If voice transcription fails, reply via Telegram: "Could not transcribe voice message. Please send as text." Do not store the entry.

**PostgreSQL** — If the database is unreachable, the app cannot function. Return a 503 on the webapp, send an error reply via Telegram ("System temporarily unavailable"), and retry on next request.

**SMTP** — If digest email fails to send, log the error. The digest is still visible on the dashboard. Do not retry email sends — the next scheduled digest will include current data.

**Telegram** — grammY handles reconnection automatically in long-polling mode. If sending a confirmation fails, log it. The entry is already stored.

## Startup Sequence

1. PostgreSQL starts, becomes healthy (healthcheck)
2. Ollama starts, model is available
3. faster-whisper starts, API is available
4. App starts:
   a. Runs Drizzle migrations (creates tables, indexes, triggers if not exist)
   b. Checks Ollama connectivity, pulls model if not present (`ollama pull snowflake-arctic-embed2`)
   c. Starts Hono web server (including SSE endpoint)
   d. Starts grammY Telegram bot (long-polling mode — no public URL needed)
   e. Starts cron jobs (daily digest, weekly review, embedding retry)
   f. Logs "Cortex ready" with component status

### Health endpoint

`GET /health` returns:
```json
{
    "status": "ok",
    "postgres": "connected",
    "ollama": "connected",
    "whisper": "connected",
    "telegram": "polling",
    "uptime": 3600
}
```

## Project Structure

```
cortex/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── tailwind.config.ts
├── src/
│   ├── index.ts                # entry point: start server, bot, cron
│   ├── config.ts               # env var loading and validation
│   ├── logger.ts               # structured JSON logging
│   ├── bot.ts                  # Telegram bot (grammY), long-polling, voice
│   ├── llm/
│   │   ├── index.ts            # LLM provider interface + factory
│   │   ├── anthropic.ts        # Anthropic SDK implementation
│   │   └── openai-compatible.ts # OpenAI SDK implementation (LM Studio, Ollama, OpenAI, etc.)
│   ├── classify.ts             # classification logic (uses LLM provider)
│   ├── embed.ts                # Ollama — embedding generation
│   ├── transcribe.ts           # faster-whisper — voice-to-text
│   ├── digest.ts               # daily + weekly digest generation
│   ├── email.ts                # nodemailer SMTP wrapper
│   ├── cron.ts                 # scheduled jobs (digests, embedding retry)
│   ├── mcp.ts                  # MCP server (stdio entrypoint)
│   ├── db/
│   │   ├── index.ts            # database connection (Drizzle + PostgreSQL)
│   │   ├── schema.ts           # Drizzle schema (entries + settings tables)
│   │   └── migrations/         # SQL migrations
│   └── web/
│       ├── routes.ts           # Hono routes (dashboard, browse, editor, API, /mcp, SSE)
│       ├── auth.ts             # session-based auth middleware
│       ├── sse.ts              # Server-Sent Events manager
│       ├── templates/
│       │   ├── layout.ts       # base HTML layout with Tailwind
│       │   ├── login.ts        # login page
│       │   ├── dashboard.ts    # start page (digest, recent, stats, quick capture)
│       │   ├── browse.ts       # category browsing + semantic + text search
│       │   ├── entry.ts        # view/edit single entry
│       │   ├── new.ts          # new note editor
│       │   ├── trash.ts        # soft-deleted entries
│       │   └── settings.ts     # settings page
│       └── public/
│           └── style.css       # Tailwind CLI output
├── prompts/
│   ├── classify.md
│   ├── daily-digest.md
│   └── weekly-review.md
└── docs/
    └── specs/                  # spec-dd behavioral specifications
```

## Docker Compose

```yaml
services:
    app:
        build: .
        ports:
            - "${PORT:-3000}:3000"
        environment:
            - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
            - OLLAMA_URL=http://ollama:11434
            - OLLAMA_MODEL=${OLLAMA_MODEL:-snowflake-arctic-embed2}
            - WHISPER_URL=http://whisper:8000
            - LLM_PROVIDER=${LLM_PROVIDER:-anthropic}
            - LLM_API_KEY
            - LLM_MODEL=${LLM_MODEL:-claude-sonnet-4-20250514}
            - LLM_BASE_URL
            - TELEGRAM_BOT_TOKEN
            - TELEGRAM_CHAT_ID
            - SMTP_HOST
            - SMTP_PORT
            - SMTP_USER
            - SMTP_PASS
            - DIGEST_EMAIL_TO
            - DIGEST_EMAIL_FROM=${DIGEST_EMAIL_FROM:-${SMTP_USER}}
            - DAILY_DIGEST_CRON=${DAILY_DIGEST_CRON:-30 7 * * *}
            - WEEKLY_DIGEST_CRON=${WEEKLY_DIGEST_CRON:-0 16 * * 0}
            - GOOGLE_CALENDAR_ID
            - GOOGLE_CLIENT_ID
            - GOOGLE_CLIENT_SECRET
            - GOOGLE_REFRESH_TOKEN
            - WEBAPP_PASSWORD
            - SESSION_SECRET
            - TZ=${TZ:-Europe/Berlin}
        depends_on:
            postgres:
                condition: service_healthy
            ollama:
                condition: service_started
            whisper:
                condition: service_started

    postgres:
        image: pgvector/pgvector:pg16
        environment:
            POSTGRES_DB: ${POSTGRES_DB:-cortex}
            POSTGRES_USER: ${POSTGRES_USER:-cortex}
            POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
        volumes:
            - postgres_data:/var/lib/postgresql/data
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-cortex}"]
            interval: 10s
            timeout: 5s
            retries: 5

    ollama:
        image: ollama/ollama
        volumes:
            - ollama_data:/root/.ollama

    whisper:
        image: fedirz/faster-whisper-server:latest
        environment:
            WHISPER__MODEL: medium
            WHISPER__DEVICE: cpu
        volumes:
            - whisper_data:/root/.cache/huggingface

volumes:
    postgres_data:
    ollama_data:
    whisper_data:
```

Note: The Ollama container ships with no models. On first startup, the app pulls the embedding model automatically (see Startup Sequence). Alternatively, run manually: `docker exec cortex-ollama-1 ollama pull snowflake-arctic-embed2`

Note: The faster-whisper container downloads the medium model on first use. Subsequent starts use the cached model.

## .env.example

```env
# Telegram
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-personal-chat-id

# LLM Provider (classification + digests)
# Provider: "anthropic" or "openai-compatible"
# For Anthropic: set LLM_API_KEY to your Anthropic API key
# For OpenAI: set LLM_API_KEY to your OpenAI API key, LLM_BASE_URL to https://api.openai.com/v1
# For LM Studio: set LLM_BASE_URL to http://localhost:1234/v1, LLM_API_KEY to any non-empty string
# For Ollama chat: set LLM_PROVIDER to openai-compatible, LLM_BASE_URL to http://ollama:11434/v1
LLM_PROVIDER=anthropic
LLM_API_KEY=your-api-key
LLM_MODEL=claude-sonnet-4-20250514
LLM_BASE_URL=

# Ollama (local embeddings)
OLLAMA_MODEL=snowflake-arctic-embed2

# App
PORT=3000
WEBAPP_PASSWORD=your-dashboard-password
SESSION_SECRET=generate-with-openssl-rand-hex-32

# Digest schedule (cron expressions, configurable via settings page)
DAILY_DIGEST_CRON=30 7 * * *
WEEKLY_DIGEST_CRON=0 16 * * 0

# Email (SMTP for digests)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-smtp-password
DIGEST_EMAIL_TO=you@example.com
DIGEST_EMAIL_FROM=cortex@example.com

# Google Calendar (optional — leave empty to disable)
GOOGLE_CALENDAR_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# PostgreSQL
POSTGRES_DB=cortex
POSTGRES_USER=cortex
POSTGRES_PASSWORD=changeme

# Timezone
TZ=Europe/Berlin
```

## External Dependencies

**Optional:** An LLM API for classification and digest generation. Can be:
- Anthropic Claude API (recommended, best at structured JSON)
- OpenAI API
- Any OpenAI-compatible endpoint (LM Studio, Ollama chat, etc. — fully local, zero external dependencies)

Everything else runs locally:
- PostgreSQL + pgvector (storage + vector search)
- Ollama + snowflake-arctic-embed2 (embeddings, multilingual)
- faster-whisper (voice transcription)
- nodemailer (SMTP — talks to your own mail server)
- grammY (Telegram Bot API — free)

## Context-Aware Classification

Before classifying a new thought, the system fetches context to help the LLM make better decisions:

1. **Recent entries:** Last 5 entries (any category) for temporal context
2. **Similar entries:** Embed the input text, find top 3 semantically similar entries

This context is injected into the classification prompt as `{context_entries}`. Benefits:
- The LLM reuses existing project/person names instead of creating duplicates
- Better category decisions when the input is ambiguous but relates to known topics
- More consistent tagging across related entries

## Future Possibilities

- **Person deduplication:** When a person is mentioned again, update existing entry instead of creating a new one
- **Webapp on mobile:** PWA support for capturing from phone browser
- **File attachments:** Images, PDFs stored alongside entries
- **Shared brains:** Multiple users with separate data
- **Local LLM for classification:** Already supported via the `openai-compatible` provider (Ollama chat, LM Studio). Quality depends on the model.
- **Import from other tools:** ChatGPT memory export, Apple Notes, Google Keep
- **Entry linking:** Optional `parent_id` or relation system to connect entries (e.g., task belongs to project, person relates to project)
- **Embedding model switching:** Settings UI to change embedding model with automatic re-embedding of all entries
