# Software Requirements Specification — Cortex

| Field     | Value                                |
|-----------|--------------------------------------|
| Project   | Cortex                               |
| Document  | Software Requirements Specification  |
| Version   | 0.1 (Draft)                          |
| Date      | 2026-03-03                           |
| Status    | Draft -- Pending Review              |
| Reference | `ARCHITECTURE.md` v3                 |

---

## Table of Contents

1. [Introduction & Scope](#1-introduction--scope)
2. [System Context & Overview](#2-system-context--overview)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [External Interfaces](#5-external-interfaces)
6. [Constraints, Assumptions & Dependencies](#6-constraints-assumptions--dependencies)
7. [Traceability](#7-traceability)

---

## 1. Introduction & Scope

### 1.1 Purpose

This document specifies the functional and non-functional requirements for Cortex, a self-hosted, agent-readable second brain. It serves as the authoritative reference for development, testing, and acceptance of the system.

### 1.2 System Description

Cortex captures thoughts from Telegram (text or voice) and a web editor, classifies and embeds them with AI, stores everything in PostgreSQL with vector search, and exposes the data to any AI tool via the Model Context Protocol (MCP). All data lives on the user's server. No SaaS dependencies except the Claude API for classification and digest generation.

### 1.3 System Boundaries

**In scope:**

- Telegram bot (text and voice capture)
- Web dashboard (browse, search, edit, create, settings, digest display)
- AI classification pipeline (Claude API)
- Local embedding generation (Ollama)
- Local voice transcription (faster-whisper)
- MCP server (stdio and HTTP transports)
- Digest generation and email delivery
- PostgreSQL storage with pgvector
- Cron-based background jobs
- Docker Compose deployment

**Out of scope:**

- Multi-user authentication and authorization
- Mobile native applications
- File attachments and media storage
- Entry linking and relationship graphs
- Local LLM classification (future possibility)
- Import from external tools

### 1.4 References

| Document          | Location                     |
|-------------------|------------------------------|
| Architecture v3   | `ARCHITECTURE.md`            |
| ISO/IEC/IEEE 29148:2018 | Requirements engineering |
| IEEE 830-1998     | SRS recommended practice     |

### 1.5 Definitions & Abbreviations

| Term | Definition |
|------|-----------|
| Entry | A single unit of stored information (thought, note, task, etc.) |
| MCP | Model Context Protocol -- open standard for AI tool interoperability |
| SSE | Server-Sent Events -- unidirectional server-to-client push over HTTP |
| HNSW | Hierarchical Navigable Small World -- approximate nearest neighbor index |
| GIN | Generalized Inverted Index -- PostgreSQL index type for arrays |
| JSONB | Binary JSON storage type in PostgreSQL |
| pgvector | PostgreSQL extension for vector similarity search |
| grammY | TypeScript Telegram Bot framework |
| Hono | Lightweight TypeScript web framework |
| Drizzle | TypeScript ORM with native pgvector support |
| MoSCoW | Prioritization: Must, Should, Could, Won't |

---

## 2. System Context & Overview

### 2.1 Architecture Overview

Cortex is organized into four layers:

**Capture** -- Two input channels feed the application. The Telegram bot accepts text and voice messages for quick capture. The web editor provides a full-form interface for longer notes. Both channels feed into a shared processing pipeline.

**Intelligence** -- Three AI services process incoming data. The Claude API (claude-sonnet-4-20250514) performs structured JSON classification and generates daily/weekly digests. Ollama runs the qwen3-embedding model locally to produce 4096-dimensional multilingual embeddings. faster-whisper runs locally to transcribe voice messages to text.

**Storage** -- PostgreSQL with the pgvector extension stores all entries, embeddings, and settings in a single-table design with JSONB fields for category-specific data.

**Access** -- Three access paths serve the data. The web dashboard provides server-rendered HTML pages for browsing, searching, editing, and viewing digests with live updates via SSE. The MCP server exposes the brain to any AI tool via stdio and HTTP transports. Email delivers digests via SMTP.

### 2.2 External Systems

| System | Protocol | Direction | Required |
|--------|----------|-----------|----------|
| Telegram Bot API | HTTPS (long-polling) | Bidirectional | Yes |
| Anthropic Claude API | HTTPS | Request/Response | Yes |
| Ollama | HTTP (localhost/Docker network) | Request/Response | Yes |
| faster-whisper | HTTP (localhost/Docker network) | Request/Response | Yes |
| SMTP server | SMTP/TLS | Outbound | Yes (for email digests) |
| Google Calendar API | HTTPS | Outbound | No (optional) |

### 2.3 Actors

| Actor | Channel | Capabilities |
|-------|---------|-------------|
| User (Telegram) | Telegram Bot | Send text/voice messages, tap inline category buttons, issue /fix command |
| User (Webapp) | Web browser | Browse, search, create, edit, delete entries; view digests; manage settings |
| AI Tool (MCP) | MCP stdio or HTTP | Search, add, read, update, delete entries; view stats |
| Cron Scheduler | Internal | Trigger digests, retry failed embeddings/classifications |

---

## 3. Functional Requirements

Requirements are organized by feature area. Each requirement has a unique ID, MoSCoW priority (MUST / SHOULD / COULD), and testable acceptance criteria.

---

### 3.1 Configuration

#### REQ-CONF-001: Load environment variables with defaults

**Priority:** MUST

**Description:** The application shall load configuration from environment variables at startup. Variables with defined defaults shall use those defaults when the environment variable is not set.

**Acceptance Criteria:**
1. `PORT` defaults to `3000` when not set.
2. `ANTHROPIC_MODEL` defaults to `claude-sonnet-4-20250514` when not set.
3. `OLLAMA_MODEL` defaults to `qwen3-embedding` when not set.
4. `TZ` defaults to `Europe/Berlin` when not set.
5. `DAILY_DIGEST_CRON` defaults to `30 7 * * *` when not set.
6. `WEEKLY_DIGEST_CRON` defaults to `0 16 * * 0` when not set.
7. `DIGEST_EMAIL_FROM` defaults to the value of `SMTP_USER` when not set.

#### REQ-CONF-002: Settings table overrides environment variables

**Priority:** MUST

**Description:** The `settings` table shall override environment variable values at runtime. When a setting key exists in the database with a non-empty value, that value shall take precedence over the corresponding environment variable.

**Acceptance Criteria:**
1. Setting `ollama_url` in the database overrides the `OLLAMA_URL` environment variable.
2. Setting `anthropic_model` in the database overrides the `ANTHROPIC_MODEL` environment variable.
3. Setting `confidence_threshold` in the database overrides the default `0.6`.
4. Setting `telegram_chat_ids` in the database overrides the `TELEGRAM_CHAT_ID` environment variable.
5. Setting `digest_daily_cron` in the database overrides the `DAILY_DIGEST_CRON` environment variable.
6. Setting `digest_weekly_cron` in the database overrides the `WEEKLY_DIGEST_CRON` environment variable.
7. Setting `timezone` in the database overrides the `TZ` environment variable.
8. Setting `digest_email_to` in the database overrides the `DIGEST_EMAIL_TO` environment variable.
9. When a setting is deleted from the database, the environment variable value resumes effect.

#### REQ-CONF-003: Validate required environment variables at startup

**Priority:** MUST

**Description:** The application shall validate that all required environment variables are present at startup and fail fast with a descriptive error message if any are missing.

**Acceptance Criteria:**
1. Startup fails with an error message naming the missing variable if `DATABASE_URL` is not set.
2. Startup fails if `ANTHROPIC_API_KEY` is not set.
3. Startup fails if `TELEGRAM_BOT_TOKEN` is not set.
4. Startup fails if `WEBAPP_PASSWORD` is not set.
5. Startup fails if `SESSION_SECRET` is not set.
6. The error message clearly identifies which variable is missing.

---

### 3.2 Logging

#### REQ-LOG-001: Structured JSON logging

**Priority:** MUST

**Description:** All application log output shall use structured JSON format with consistent fields.

**Acceptance Criteria:**
1. Every log line is valid JSON.
2. Every log entry contains the fields: `timestamp` (ISO 8601), `level`, `module`, `message`.
3. Log entries may include an additional `context` field with structured data relevant to the event.

#### REQ-LOG-002: Log levels

**Priority:** MUST

**Description:** The logger shall support four log levels: `debug`, `info`, `warn`, `error`.

**Acceptance Criteria:**
1. Each log entry's `level` field contains one of: `debug`, `info`, `warn`, `error`.
2. Normal operations (startup, request handling, entry creation) log at `info` level.
3. Recoverable failures (API timeout, embedding failure) log at `warn` level.
4. Unrecoverable failures (database unreachable, missing config) log at `error` level.
5. Verbose operational detail (query timing, prompt content) logs at `debug` level.

---

### 3.3 Database

#### REQ-DB-001: PostgreSQL with pgvector extension

**Priority:** MUST

**Description:** The system shall use PostgreSQL with the pgvector extension for data storage and vector similarity search.

**Acceptance Criteria:**
1. The application connects to PostgreSQL using the `DATABASE_URL` environment variable.
2. The `vector` extension is created if it does not exist (`CREATE EXTENSION IF NOT EXISTS vector`).
3. The pgvector/pgvector:pg16 Docker image is used in the Compose stack.

#### REQ-DB-002: Entries table schema

**Priority:** MUST

**Description:** The `entries` table shall store all entries with the following columns.

**Acceptance Criteria:**
1. `id` -- UUID primary key, auto-generated with `gen_random_uuid()`.
2. `category` -- nullable TEXT with CHECK constraint limiting values to `people`, `projects`, `tasks`, `ideas`, `reference`. Null indicates unclassified.
3. `name` -- TEXT NOT NULL, short descriptive title.
4. `content` -- nullable TEXT for raw input or full note body (markdown).
5. `fields` -- JSONB NOT NULL defaulting to `'{}'`, stores category-specific structured data.
6. `tags` -- TEXT array defaulting to `'{}'`.
7. `confidence` -- nullable REAL for classification confidence score. Null when entry is created manually via webapp.
8. `source` -- TEXT NOT NULL with CHECK constraint limiting values to `telegram`, `webapp`, `mcp`.
9. `source_type` -- TEXT defaulting to `text` with CHECK constraint limiting values to `text`, `voice`.
10. `embedding` -- `vector(4096)` nullable, stores qwen3-embedding embeddings.
11. `deleted_at` -- nullable TIMESTAMPTZ for soft delete. Null means active.
12. `created_at` -- TIMESTAMPTZ defaulting to `now()`.
13. `updated_at` -- TIMESTAMPTZ defaulting to `now()`.

#### REQ-DB-003: Settings table schema

**Priority:** MUST

**Description:** The `settings` table shall store key-value pairs for UI-configurable preferences.

**Acceptance Criteria:**
1. `key` -- TEXT primary key.
2. `value` -- TEXT NOT NULL.
3. `updated_at` -- TIMESTAMPTZ defaulting to `now()`.

#### REQ-DB-004: HNSW index for cosine similarity

**Priority:** MUST

**Description:** An HNSW index shall be created on the `embedding` column for efficient cosine similarity search.

**Acceptance Criteria:**
1. An index exists: `CREATE INDEX ON entries USING hnsw (embedding vector_cosine_ops)`.
2. Semantic search queries use cosine similarity via this index.

#### REQ-DB-005: GIN index on tags

**Priority:** MUST

**Description:** A GIN index shall be created on the `tags` column for efficient tag filtering.

**Acceptance Criteria:**
1. An index exists: `CREATE INDEX ON entries USING gin (tags)`.
2. Tag filter queries use this index.

#### REQ-DB-006: Indexes on category and created_at

**Priority:** MUST

**Description:** B-tree indexes shall exist on `category` and `created_at` columns.

**Acceptance Criteria:**
1. `CREATE INDEX ON entries (category)` exists.
2. `CREATE INDEX ON entries (created_at)` exists.

#### REQ-DB-007: Auto-update trigger for updated_at

**Priority:** MUST

**Description:** A trigger shall automatically set the `updated_at` column to the current timestamp on every row update for both `entries` and `settings` tables.

**Acceptance Criteria:**
1. A PL/pgSQL function `update_updated_at()` exists that sets `NEW.updated_at = now()`.
2. Trigger `entries_updated_at` fires BEFORE UPDATE on `entries` FOR EACH ROW.
3. Trigger `settings_updated_at` fires BEFORE UPDATE on `settings` FOR EACH ROW.
4. Updating any column on an entry row causes `updated_at` to reflect the current time.

#### REQ-DB-008: Drizzle ORM with migrations

**Priority:** MUST

**Description:** The application shall use Drizzle ORM for database access and manage schema changes through Drizzle migrations.

**Acceptance Criteria:**
1. Database schema is defined in `src/db/schema.ts` using Drizzle's schema DSL.
2. SQL migration files are stored in `src/db/migrations/`.
3. Migrations run automatically at startup (see REQ-START-002).
4. Drizzle config is defined in `drizzle.config.ts`.

---

### 3.4 Embedding

#### REQ-EMB-001: Ollama embedding generation

**Priority:** MUST

**Description:** The system shall generate 4096-dimensional embeddings using the qwen3-embedding model via Ollama for all entry content.

**Acceptance Criteria:**
1. Embedding requests are sent to the Ollama HTTP API at the configured URL.
2. The model used is `qwen3-embedding` (configurable via `OLLAMA_MODEL`).
3. Generated embeddings are 4096-dimensional float vectors.
4. Embeddings support multilingual content (English and German at minimum).

#### REQ-EMB-002: Check Ollama connectivity on startup

**Priority:** MUST

**Description:** The application shall verify Ollama connectivity during the startup sequence.

**Acceptance Criteria:**
1. On startup, the application sends a connectivity check to the Ollama API.
2. The result is logged and reported in the health endpoint.

#### REQ-EMB-003: Pull model if not present

**Priority:** MUST

**Description:** If the embedding model is not available on the Ollama instance, the application shall pull it automatically.

**Acceptance Criteria:**
1. On startup, if the configured model is not present, the application executes `ollama pull qwen3-embedding`.
2. The pull operation is logged.
3. After a successful pull, embedding generation is available.

#### REQ-EMB-004: Graceful failure with null embedding

**Priority:** MUST

**Description:** If embedding generation fails, the entry shall be stored with a null embedding and retried later.

**Acceptance Criteria:**
1. When Ollama is unreachable or returns an error, the entry is stored with `embedding: null`.
2. A warning is logged with the entry ID and error details.
3. The entry remains browsable and editable but does not appear in semantic search results.
4. The cron job (REQ-CRON-003) retries embedding generation for entries with null embeddings.

---

### 3.5 Classification

#### REQ-CLS-001: Claude API structured JSON classification

**Priority:** MUST

**Description:** The system shall classify each incoming thought into one of five categories using the Claude API, receiving structured JSON output.

**Acceptance Criteria:**
1. The classification request is sent to the Claude API using the configured model (default: `claude-sonnet-4-20250514`).
2. The response is valid JSON matching the classification schema: `category`, `name`, `confidence`, `fields`, `tags`, `create_calendar_event`, `calendar_date`.
3. `category` is one of: `people`, `projects`, `tasks`, `ideas`, `reference`.
4. `name` is a short descriptive title (maximum 6 words).
5. `confidence` is a float between 0.0 and 1.0.
6. `fields` contains category-specific structured data matching the defined schemas.
7. `tags` is an array of lowercase, short, relevant strings.

#### REQ-CLS-002: Context-aware classification

**Priority:** MUST

**Description:** Before classifying a new thought, the system shall fetch context from existing entries and include it in the classification prompt.

**Acceptance Criteria:**
1. The system fetches the last 5 most recent entries (any category) for temporal context.
2. The system embeds the input text and retrieves the top 3 semantically similar entries.
3. Both sets of context entries are injected into the classification prompt as `{context_entries}`.
4. Context helps Claude reuse existing names, improve category decisions, and maintain consistent tagging.

#### REQ-CLS-003: Five categories with decision tree

**Priority:** MUST

**Description:** Classification shall use exactly five categories, each answering a distinct question, determined by a defined decision tree.

**Acceptance Criteria:**
1. `people` -- about a specific person, relationship, or social interaction.
2. `projects` -- about work, a goal, or something with multiple steps.
3. `tasks` -- a one-off thing to do, errand, appointment, or deadline.
4. `ideas` -- a standalone insight, concept, or creative thought.
5. `reference` -- a fact, detail, or piece of information to remember.
6. Decision tree: person? -> projects (multi-step)? -> tasks (one-off)? -> ideas (creative)? -> reference (fact).

#### REQ-CLS-004: Category-specific JSONB fields

**Priority:** MUST

**Description:** Each category shall have a defined set of fields stored in the `fields` JSONB column.

**Acceptance Criteria:**
1. `people` fields: `context` (string), `follow_ups` (string).
2. `projects` fields: `status` (one of `active`, `paused`, `done`, `cancelled`), `next_action` (string), `notes` (string).
3. `tasks` fields: `due_date` (string, YYYY-MM-DD or null), `status` (one of `pending`, `done`, `cancelled`), `notes` (string).
4. `ideas` fields: `oneliner` (string), `notes` (string).
5. `reference` fields: `notes` (string).

#### REQ-CLS-005: Confidence score

**Priority:** MUST

**Description:** Every AI-classified entry shall include a confidence score indicating the classification certainty.

**Acceptance Criteria:**
1. The confidence score is a float between 0.0 and 1.0.
2. Entries created manually via the webapp have `confidence: null`.
3. The confidence threshold (default 0.6, configurable) determines high vs. low confidence behavior.

#### REQ-CLS-006: Calendar event detection

**Priority:** COULD

**Description:** The classification response may include calendar event detection fields that trigger Google Calendar event creation.

**Acceptance Criteria:**
1. The Claude response includes `create_calendar_event` (boolean) and `calendar_date` (string or null).
2. These fields are ephemeral -- used to trigger calendar event creation but not stored in the database.
3. Calendar event creation only occurs if Google Calendar is configured.
4. `create_calendar_event` is only true when there is a clear date or deadline in the input.

#### REQ-CLS-007: Graceful failure with null category

**Priority:** MUST

**Description:** If classification fails, the entry shall be stored with null category and flagged as unclassified.

**Acceptance Criteria:**
1. When the Claude API is unreachable, times out, or returns an invalid response, the entry is stored with `category: null` and `confidence: null`.
2. The entry is flagged on the dashboard as "unclassified."
3. The cron job (REQ-CRON-004) retries classification for entries with null category.
4. Users can classify the entry manually via the webapp.

---

### 3.6 Telegram Bot

#### REQ-TG-001: Long-polling mode via grammY

**Priority:** MUST

**Description:** The Telegram bot shall operate in long-polling mode using the grammY library. No public URL or webhook configuration is required.

**Acceptance Criteria:**
1. The bot connects to the Telegram Bot API using the `TELEGRAM_BOT_TOKEN` environment variable.
2. The bot uses long-polling (not webhooks) to receive updates.
3. grammY handles reconnection automatically.

#### REQ-TG-002: Validate sender against authorized chat ID list

**Priority:** MUST

**Description:** The bot shall only process messages from authorized Telegram chat IDs.

**Acceptance Criteria:**
1. Incoming messages are checked against the authorized chat ID list from settings (REQ-CONF-002) or the `TELEGRAM_CHAT_ID` environment variable.
2. Messages from unauthorized chat IDs are silently ignored.
3. The authorized chat ID list can be managed via the settings page (REQ-SET-001).

#### REQ-TG-003: Text message processing

**Priority:** MUST

**Description:** Text messages from authorized users shall be classified, embedded, and stored.

**Acceptance Criteria:**
1. The incoming text is sent through the classification pipeline (REQ-CLS-001, REQ-CLS-002).
2. An embedding is generated for the text (REQ-EMB-001).
3. The entry is stored in PostgreSQL with `source: 'telegram'` and `source_type: 'text'`.
4. Processing follows the full capture flow: validate -> fetch context -> classify -> embed -> store -> reply.

#### REQ-TG-004: Voice message processing

**Priority:** MUST

**Description:** Voice messages from authorized users shall be transcribed, classified, embedded, and stored.

**Acceptance Criteria:**
1. The audio file (OGG/Opus) is downloaded from Telegram.
2. The audio is sent to faster-whisper (medium model) for transcription.
3. The transcribed text enters the same classification pipeline as text messages.
4. The entry is stored with `source: 'telegram'` and `source_type: 'voice'`.
5. If transcription fails, the bot replies: "Could not transcribe voice message. Please send as text." The entry is not stored.

#### REQ-TG-005: High confidence reply

**Priority:** MUST

**Description:** When classification confidence meets or exceeds the threshold, the bot shall reply with a confirmation message.

**Acceptance Criteria:**
1. When `confidence >= threshold` (default 0.6), the bot replies with: `"✅ Filed as {category} → {name} ({confidence}%) — reply /fix to correct"`.
2. For voice messages, the reply is prefixed with the transcription: `"🎤 '{transcript}'\n✅ Filed as {category} → {name} ({confidence}%)"`.

#### REQ-TG-006: Low confidence reply with inline buttons

**Priority:** MUST

**Description:** When classification confidence is below the threshold, the bot shall reply with the best guess and present inline category buttons for correction.

**Acceptance Criteria:**
1. When `confidence < threshold`, the entry is stored with the best-guess category and flagged for review.
2. The bot replies: `"❓ Best guess: {category} → {name} ({confidence}%)"`.
3. The reply includes an inline keyboard with 5 category buttons (people, projects, tasks, ideas, reference).

#### REQ-TG-007: Inline category correction

**Priority:** MUST

**Description:** When a user taps a category button on a low-confidence entry, the entry shall be re-classified with the corrected category.

**Acceptance Criteria:**
1. Tapping a category button updates the entry's category to the selected value.
2. Category-specific fields are re-generated by Claude using the correction context.
3. The embedding is re-generated.
4. The bot updates the reply message to: `"✅ Fixed → {new category} → {name}"`.

#### REQ-TG-008: /fix command

**Priority:** MUST

**Description:** The `/fix` command shall re-classify the most recent entry with optional correction context.

**Acceptance Criteria:**
1. `/fix` (with optional text, e.g., `/fix this should be a person not a project`) triggers re-classification of the most recent entry by the user.
2. The entry is re-classified with Claude using the correction context.
3. Category, fields, and embedding are updated.
4. The bot replies: `"✅ Fixed → {new category} → {name}"`.

#### REQ-TG-009: Error reply when database is down

**Priority:** MUST

**Description:** When the database is unreachable, the bot shall reply with a service unavailability message.

**Acceptance Criteria:**
1. If the database is unreachable during message processing, the bot replies: "System temporarily unavailable".
2. The entry is not stored (it cannot be, since the database is down).
3. The error is logged.

---

### 3.7 Web Authentication

#### REQ-AUTH-001: Login page

**Priority:** MUST

**Description:** The application shall serve a login page at `/login`.

**Acceptance Criteria:**
1. `GET /login` renders a login page with a password input field and submit button.
2. Unauthenticated users accessing any protected route are redirected to `/login`.

#### REQ-AUTH-002: Cookie-based session authentication

**Priority:** MUST

**Description:** Authentication shall use cookie-based sessions signed with the `SESSION_SECRET` environment variable.

**Acceptance Criteria:**
1. Successful login sets a signed session cookie.
2. The session cookie is validated on each request to a protected route.
3. The `SESSION_SECRET` environment variable is used to sign and verify the cookie.
4. Invalid or expired sessions redirect to `/login`.

#### REQ-AUTH-003: Password authentication

**Priority:** MUST

**Description:** The login form shall authenticate against the `WEBAPP_PASSWORD` environment variable.

**Acceptance Criteria:**
1. Submitting the correct password creates a valid session.
2. Submitting an incorrect password re-renders the login page with an error message.

#### REQ-AUTH-004: Route protection

**Priority:** MUST

**Description:** All routes except `/login` and `/health` shall require authentication.

**Acceptance Criteria:**
1. `/login` is accessible without authentication.
2. `/health` is accessible without authentication.
3. All other routes (`/`, `/browse`, `/entry/:id`, `/new`, `/trash`, `/settings`, `/mcp`) require a valid session.
4. Unauthenticated requests to protected routes redirect to `/login` (for HTML) or return 401 (for API).

---

### 3.8 Dashboard

#### REQ-DASH-001: Dashboard route

**Priority:** MUST

**Description:** The dashboard shall be served at the root route `/`.

**Acceptance Criteria:**
1. `GET /` renders the dashboard page for authenticated users.
2. The dashboard is the default landing page after login.

#### REQ-DASH-002: Today's digest display

**Priority:** MUST

**Description:** The dashboard shall display today's digest, always visible.

**Acceptance Criteria:**
1. The most recent daily digest is displayed on the dashboard.
2. The digest content matches the email digest format.
3. The digest is cached and served from cache on page load.
4. When a new digest is generated, it is pushed to the dashboard via SSE (REQ-SSE-001).

#### REQ-DASH-003: Recent entries

**Priority:** MUST

**Description:** The dashboard shall display recent entries from the last 7 days, grouped by day.

**Acceptance Criteria:**
1. Entries from the last 7 days are listed, grouped by date.
2. Only active entries (where `deleted_at IS NULL`) are shown.
3. Each entry displays its category, name, and timestamp.

#### REQ-DASH-004: Quick stats

**Priority:** MUST

**Description:** The dashboard shall display summary statistics.

**Acceptance Criteria:**
1. "Entries this week" shows the count of entries created in the current week.
2. "Open tasks" shows the count of tasks with `status: 'pending'`.
3. "Stalled projects" shows the count of projects with `status: 'active'` and `updated_at` older than 5 days.

#### REQ-DASH-005: Quick capture input

**Priority:** MUST

**Description:** The dashboard shall include a quick capture text input for creating new entries inline.

**Acceptance Criteria:**
1. A text input is visible at the top of the dashboard.
2. The input supports markdown.
3. Submitting the input triggers the same classification pipeline as Telegram text messages.
4. The new entry appears on the dashboard via SSE without a page refresh.
5. The entry is stored with `source: 'webapp'`.

#### REQ-DASH-006: Live updates via SSE

**Priority:** MUST

**Description:** The dashboard shall receive live updates through Server-Sent Events.

**Acceptance Criteria:**
1. New entries appear on the dashboard without a page refresh.
2. Entry updates are reflected on the dashboard in real time.
3. New digest generation updates the digest display in real time.
4. See REQ-SSE-001 for SSE specification.

---

### 3.9 Browse & Search

#### REQ-BRWS-001: Browse route

**Priority:** MUST

**Description:** The browse page shall be served at `/browse`.

**Acceptance Criteria:**
1. `GET /browse` renders the browse page with entry listings.

#### REQ-BRWS-002: Filter by category

**Priority:** MUST

**Description:** Entries shall be filterable by category.

**Acceptance Criteria:**
1. Category filter options are available for all 5 categories.
2. Selecting a category shows only entries of that category.
3. Only active entries (`deleted_at IS NULL`) are shown.

#### REQ-BRWS-003: Semantic search

**Priority:** MUST

**Description:** The browse page shall support semantic search using vector similarity.

**Acceptance Criteria:**
1. A search bar accepts natural language queries (e.g., "what do I know about career changes").
2. The query text is embedded using Ollama.
3. Entries are ranked by cosine similarity to the query embedding.
4. Only entries with similarity >= 0.5 are returned.
5. Similarity scores are not displayed to the user; results are ranked only.

#### REQ-BRWS-004: Text search fallback

**Priority:** MUST

**Description:** When semantic search is unavailable or as a complementary search mode, text search shall match words in entry names and content.

**Acceptance Criteria:**
1. Text search matches exact words in the `name` and `content` columns.
2. Results are returned when matching words are found.

#### REQ-BRWS-005: Tag filtering with autocomplete

**Priority:** MUST

**Description:** Entries shall be filterable by tags with autocomplete suggestions.

**Acceptance Criteria:**
1. A tag filter input is available on the browse page.
2. Typing in the tag input shows autocomplete suggestions from existing tags across all entries.
3. Selecting a tag filters entries to those containing that tag.

---

### 3.10 Entry View & Edit

#### REQ-ENTRY-001: Entry route

**Priority:** MUST

**Description:** Individual entries shall be viewable and editable at `/entry/:id`.

**Acceptance Criteria:**
1. `GET /entry/:id` renders the entry view for a valid entry UUID.
2. Returns 404 for non-existent entries.

#### REQ-ENTRY-002: View with rendered markdown

**Priority:** MUST

**Description:** Entry content shall be displayed with rendered markdown.

**Acceptance Criteria:**
1. The entry's `content` field is rendered as HTML from markdown.
2. The entry's category, name, tags, and fields are displayed.
3. The entry's source, confidence, and timestamps are visible.

#### REQ-ENTRY-003: Edit mode

**Priority:** MUST

**Description:** Entries shall be editable through an edit mode.

**Acceptance Criteria:**
1. An edit mode allows modifying the entry's `content` (markdown textarea).
2. The `category` can be changed via a selector.
3. Tags can be added or removed.
4. Category-specific `fields` can be edited.
5. Saving triggers re-embedding of the updated content.

#### REQ-ENTRY-004: Soft delete

**Priority:** MUST

**Description:** Entries shall be soft-deleted by setting the `deleted_at` timestamp.

**Acceptance Criteria:**
1. A delete action sets `deleted_at` to the current timestamp.
2. A confirmation is required before deleting.
3. Soft-deleted entries no longer appear in browse, search, or dashboard views.
4. Soft-deleted entries are visible in the trash (REQ-TRASH-001).

---

### 3.11 New Note

#### REQ-NEW-001: New note route

**Priority:** MUST

**Description:** A full editor for creating new notes shall be served at `/new`.

**Acceptance Criteria:**
1. `GET /new` renders the new note editor page.

#### REQ-NEW-002: Category selector

**Priority:** MUST

**Description:** The new note editor shall include a category selector supporting manual selection and AI suggestion.

**Acceptance Criteria:**
1. A dropdown or button group allows selecting one of the 5 categories manually.
2. An "AI Suggest" button triggers classification of the current content, proposing a category and tags.

#### REQ-NEW-003: Tag input with autocomplete

**Priority:** MUST

**Description:** The new note editor shall include a tag input with autocomplete from existing tags.

**Acceptance Criteria:**
1. A tag input field is present.
2. Typing shows autocomplete suggestions from all existing tags in the database.
3. New tags can be created that do not yet exist.

#### REQ-NEW-004: Markdown textarea

**Priority:** MUST

**Description:** The new note editor shall include a markdown textarea for the note body.

**Acceptance Criteria:**
1. A textarea accepts markdown-formatted text.
2. The textarea is the primary content input area.

#### REQ-NEW-005: AI Suggest button

**Priority:** MUST

**Description:** An "AI Suggest" button shall classify the current content and propose a category and tags.

**Acceptance Criteria:**
1. Clicking "AI Suggest" sends the current textarea content to the classification pipeline.
2. The proposed category is populated in the category selector.
3. The proposed tags are populated in the tag input.
4. The user can accept or override the suggestions before saving.

#### REQ-NEW-006: Save entry

**Priority:** MUST

**Description:** Saving a new note shall embed the content and store it in the database.

**Acceptance Criteria:**
1. On save, an embedding is generated for the note content via Ollama.
2. The entry is stored with `confidence: null` (manual creation) and `source: 'webapp'`.
3. After save, the user is redirected to the entry view page.

---

### 3.12 Trash

#### REQ-TRASH-001: Trash route

**Priority:** MUST

**Description:** The trash page shall be served at `/trash`, listing all soft-deleted entries.

**Acceptance Criteria:**
1. `GET /trash` renders a list of entries where `deleted_at IS NOT NULL`.
2. Each entry displays its name, category, and deletion timestamp.

#### REQ-TRASH-002: Restore entry

**Priority:** MUST

**Description:** Soft-deleted entries shall be restorable from the trash.

**Acceptance Criteria:**
1. A restore button is available for each trashed entry.
2. Restoring sets `deleted_at` to null.
3. The restored entry reappears in browse, search, and dashboard views.

#### REQ-TRASH-003: Empty trash

**Priority:** MUST

**Description:** An "empty trash" action shall permanently delete all trashed entries.

**Acceptance Criteria:**
1. An "Empty Trash" button is available on the trash page.
2. Clicking it permanently deletes (hard delete) all entries where `deleted_at IS NOT NULL`.
3. A confirmation is required before emptying.
4. Hard-deleted entries are irrecoverable.

---

### 3.13 Settings

#### REQ-SET-001: Settings route

**Priority:** MUST

**Description:** The settings page shall be served at `/settings`.

**Acceptance Criteria:**
1. `GET /settings` renders the settings page with all configurable options.

#### REQ-SET-002: Authorized Telegram chat IDs

**Priority:** MUST

**Description:** The settings page shall allow managing authorized Telegram chat IDs.

**Acceptance Criteria:**
1. Current authorized chat IDs are displayed.
2. New chat IDs can be added.
3. Existing chat IDs can be removed.
4. Changes are stored in the `settings` table with key `telegram_chat_ids` as a JSON array.

#### REQ-SET-003: Classification model

**Priority:** MUST

**Description:** The settings page shall allow changing the Claude model used for classification and digests.

**Acceptance Criteria:**
1. The current model is displayed.
2. The model can be changed via a text input.
3. Changes are stored in the `settings` table with key `anthropic_model`.

#### REQ-SET-004: Digest schedule

**Priority:** MUST

**Description:** The settings page shall allow configuring the daily and weekly digest cron schedules.

**Acceptance Criteria:**
1. The current daily digest cron expression is displayed and editable.
2. The current weekly digest cron expression is displayed and editable.
3. Changes are stored in the `settings` table with keys `digest_daily_cron` and `digest_weekly_cron`.
4. Cron job schedules are updated when settings change.

#### REQ-SET-005: Timezone

**Priority:** MUST

**Description:** The settings page shall allow configuring the timezone for digest scheduling.

**Acceptance Criteria:**
1. The current timezone is displayed and editable.
2. Changes are stored in the `settings` table with key `timezone`.

#### REQ-SET-006: Confidence threshold

**Priority:** MUST

**Description:** The settings page shall allow configuring the confidence threshold for classification.

**Acceptance Criteria:**
1. The current threshold is displayed (default 0.6).
2. The threshold can be changed via a numeric input.
3. Changes are stored in the `settings` table with key `confidence_threshold`.
4. The threshold affects Telegram bot reply behavior (REQ-TG-005, REQ-TG-006).

#### REQ-SET-007: Digest email recipient

**Priority:** MUST

**Description:** The settings page shall allow configuring the digest email recipient.

**Acceptance Criteria:**
1. The current email recipient is displayed and editable.
2. Changes are stored in the `settings` table with key `digest_email_to`.

#### REQ-SET-008: Ollama server URL

**Priority:** MUST

**Description:** The settings page shall allow configuring the Ollama server URL.

**Acceptance Criteria:**
1. The current Ollama URL is displayed and editable.
2. Changes are stored in the `settings` table with key `ollama_url`.

---

### 3.14 MCP Server

#### REQ-MCP-001: Stdio transport

**Priority:** MUST

**Description:** The MCP server shall support stdio transport as a separate entrypoint for local AI tool integration.

**Acceptance Criteria:**
1. `src/mcp.ts` serves as the stdio MCP entrypoint.
2. The server communicates over stdin/stdout.
3. It can be invoked via Docker exec: `docker exec -i cortex-app-1 node dist/mcp.js`.
4. The @modelcontextprotocol/sdk is used as the MCP server implementation.

#### REQ-MCP-002: Streamable HTTP transport

**Priority:** MUST

**Description:** The MCP server shall support streamable HTTP transport at `/mcp` on the Hono server for remote access.

**Acceptance Criteria:**
1. The `/mcp` endpoint accepts MCP protocol messages over HTTP.
2. The endpoint requires the same session authentication as the webapp (REQ-AUTH-004).
3. Remote AI tools can connect to Cortex MCP via the HTTP endpoint.

#### REQ-MCP-003: search_brain tool

**Priority:** MUST

**Description:** The `search_brain` MCP tool shall perform semantic search across all entries.

**Acceptance Criteria:**
1. Input: `{ query: string, limit?: number }` where limit defaults to 10.
2. The query is embedded and compared against entry embeddings using cosine similarity.
3. Only entries with similarity >= 0.5 are returned.
4. Results are ranked by similarity.
5. Only active entries (`deleted_at IS NULL`) are searched.

#### REQ-MCP-004: add_thought tool

**Priority:** MUST

**Description:** The `add_thought` MCP tool shall capture a new thought with full classification and embedding.

**Acceptance Criteria:**
1. Input: `{ text: string }`.
2. The text is processed through the context-aware classification pipeline (REQ-CLS-002).
3. An embedding is generated.
4. The entry is stored with `source: 'mcp'`.
5. Output: the classified entry with category, name, and confidence.

#### REQ-MCP-005: list_recent tool

**Priority:** MUST

**Description:** The `list_recent` MCP tool shall list recent entries with optional filtering.

**Acceptance Criteria:**
1. Input: `{ days?: number, category?: string }` where days defaults to 7.
2. Returns entries from the last N days, optionally filtered by category.
3. Only active entries are returned.

#### REQ-MCP-006: get_entry tool

**Priority:** MUST

**Description:** The `get_entry` MCP tool shall return a specific entry by ID.

**Acceptance Criteria:**
1. Input: `{ id: string }` (UUID).
2. Returns the full entry with all fields and content.
3. Returns an error if the entry does not exist.

#### REQ-MCP-007: update_entry tool

**Priority:** MUST

**Description:** The `update_entry` MCP tool shall update an existing entry's fields.

**Acceptance Criteria:**
1. Input: `{ id: string, name?: string, content?: string, category?: string, tags?: string[], fields?: object }`.
2. Only provided fields are updated; omitted fields are unchanged.
3. Returns the updated entry.

#### REQ-MCP-008: delete_entry tool

**Priority:** MUST

**Description:** The `delete_entry` MCP tool shall soft-delete an entry.

**Acceptance Criteria:**
1. Input: `{ id: string }` (UUID).
2. Sets `deleted_at` to the current timestamp (soft delete).
3. Returns confirmation of deletion.

#### REQ-MCP-009: brain_stats tool

**Priority:** MUST

**Description:** The `brain_stats` MCP tool shall return an overview of the brain's contents.

**Acceptance Criteria:**
1. Input: `{}` (no parameters).
2. Returns entry counts grouped by category.
3. Returns recent activity summary.
4. Returns count of open tasks (`status: 'pending'`).
5. Returns count of stalled projects (active with `updated_at` older than 5 days).

---

### 3.15 Digests

#### REQ-DIG-001: Daily digest generation

**Priority:** MUST

**Description:** The system shall generate a daily digest summarizing actionable items.

**Acceptance Criteria:**
1. Generated on the configured schedule (default 07:30 local time).
2. Reads from the database: active projects with next actions, people with pending follow-ups, tasks due within 7 days, items captured yesterday.
3. Sent to Claude with the daily digest prompt.
4. Output is plain text, maximum 150 words.
5. Contains three sections: TOP 3 TODAY, STUCK ON, SMALL WIN.
6. Uses actual names and project titles (never generic).

#### REQ-DIG-002: Weekly review generation

**Priority:** MUST

**Description:** The system shall generate a weekly review summarizing the past 7 days.

**Acceptance Criteria:**
1. Generated on the configured schedule (default Sunday 16:00 local time).
2. Reads past 7 days of entries, activity stats, and stalled projects.
3. Sent to Claude with the weekly review prompt.
4. Output is plain text, maximum 250 words.
5. Contains four sections: WHAT HAPPENED, OPEN LOOPS, NEXT WEEK, RECURRING THEME.
6. Uses actual names and project titles.

#### REQ-DIG-003: Digest delivery via email and dashboard

**Priority:** MUST

**Description:** Generated digests shall be delivered via email and displayed on the dashboard.

**Acceptance Criteria:**
1. The digest is sent via email to the configured recipient (REQ-EMAIL-001).
2. The digest is cached and displayed on the dashboard (REQ-DASH-002).
3. The dashboard is updated via SSE when a new digest is generated.

---

### 3.16 Email

#### REQ-EMAIL-001: SMTP email delivery

**Priority:** MUST

**Description:** The system shall send emails via SMTP using nodemailer.

**Acceptance Criteria:**
1. SMTP connection uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` configuration.
2. Emails are sent from `DIGEST_EMAIL_FROM` to `DIGEST_EMAIL_TO`.
3. Email content matches the digest plain text output.

#### REQ-EMAIL-002: Graceful email failure

**Priority:** MUST

**Description:** If email delivery fails, the error shall be logged without retry. The digest remains visible on the dashboard.

**Acceptance Criteria:**
1. SMTP errors are logged at error level with context.
2. The application does not crash on email failure.
3. No automatic retry is attempted for failed emails.
4. The digest is still accessible on the dashboard regardless of email delivery status.

---

### 3.17 Cron Jobs

#### REQ-CRON-001: Daily digest cron

**Priority:** MUST

**Description:** A cron job shall trigger daily digest generation on the configured schedule.

**Acceptance Criteria:**
1. The cron expression defaults to `30 7 * * *` (07:30 daily).
2. The cron expression is configurable via settings (REQ-SET-004).
3. The job triggers REQ-DIG-001.
4. Implemented using node-cron.

#### REQ-CRON-002: Weekly review cron

**Priority:** MUST

**Description:** A cron job shall trigger weekly review generation on the configured schedule.

**Acceptance Criteria:**
1. The cron expression defaults to `0 16 * * 0` (Sunday 16:00).
2. The cron expression is configurable via settings (REQ-SET-004).
3. The job triggers REQ-DIG-002.

#### REQ-CRON-003: Embedding retry cron

**Priority:** MUST

**Description:** A cron job shall retry embedding generation for entries with null embeddings every 15 minutes.

**Acceptance Criteria:**
1. The job runs every 15 minutes.
2. It queries entries where `embedding IS NULL`.
3. For each such entry, it attempts to generate an embedding via Ollama.
4. Successfully embedded entries are updated in place.
5. Failures are logged and retried on the next cycle.

#### REQ-CRON-004: Classification retry cron

**Priority:** MUST

**Description:** A cron job shall retry classification for entries with null category.

**Acceptance Criteria:**
1. The job identifies entries where `category IS NULL`.
2. For each such entry, it attempts classification via the Claude API.
3. Successfully classified entries are updated with category, fields, confidence, and tags.
4. Failures are logged and retried on the next cycle.

---

### 3.18 Health

#### REQ-HEALTH-001: Health endpoint

**Priority:** MUST

**Description:** A `GET /health` endpoint shall return the status of all system components.

**Acceptance Criteria:**
1. The endpoint is accessible without authentication.
2. Returns JSON with the following fields: `status`, `postgres`, `ollama`, `whisper`, `telegram`, `uptime`.
3. `status` is `"ok"` when all critical components are connected.
4. `postgres` reflects the database connection status (e.g., `"connected"`).
5. `ollama` reflects the Ollama API connectivity status.
6. `whisper` reflects the faster-whisper API connectivity status.
7. `telegram` reflects the bot polling status (e.g., `"polling"`).
8. `uptime` is the server uptime in seconds.

---

### 3.19 Startup

#### REQ-START-001: Wait for PostgreSQL

**Priority:** MUST

**Description:** The application shall wait for PostgreSQL to be healthy before proceeding with startup.

**Acceptance Criteria:**
1. The Docker Compose `depends_on` condition ensures PostgreSQL passes its healthcheck before the app starts.
2. The app verifies database connectivity before running migrations.

#### REQ-START-002: Run Drizzle migrations

**Priority:** MUST

**Description:** The application shall run Drizzle migrations on startup, creating tables, indexes, and triggers if they do not exist.

**Acceptance Criteria:**
1. Migrations execute automatically on application startup.
2. Tables, indexes, and triggers are created if not present.
3. Existing data is preserved across migrations.

#### REQ-START-003: Check Ollama and pull model

**Priority:** MUST

**Description:** The application shall check Ollama connectivity and pull the embedding model if it is not present.

**Acceptance Criteria:**
1. On startup, the app checks if the configured model is available on the Ollama instance.
2. If the model is not present, `ollama pull qwen3-embedding` is executed.
3. The pull result is logged.

#### REQ-START-004: Start Hono server

**Priority:** MUST

**Description:** The Hono web server shall start, serving all web routes and the SSE endpoint.

**Acceptance Criteria:**
1. The server listens on the configured port (default 3000).
2. All web routes are registered (dashboard, browse, entry, new, trash, settings, login, health, /mcp).
3. The SSE endpoint is available.

#### REQ-START-005: Start Telegram bot

**Priority:** MUST

**Description:** The grammY Telegram bot shall start in long-polling mode.

**Acceptance Criteria:**
1. The bot starts polling the Telegram Bot API.
2. Message handlers are registered for text, voice, inline callbacks, and the /fix command.

#### REQ-START-006: Start cron jobs

**Priority:** MUST

**Description:** All cron jobs shall be registered and started.

**Acceptance Criteria:**
1. Daily digest cron is scheduled.
2. Weekly review cron is scheduled.
3. Embedding retry cron is scheduled (every 15 minutes).
4. Classification retry cron is scheduled.

#### REQ-START-007: Log startup complete

**Priority:** MUST

**Description:** The application shall log "Cortex ready" with component status when startup is complete.

**Acceptance Criteria:**
1. After all components have started, the application logs an `info`-level message: "Cortex ready".
2. The log includes component status (database, Ollama, whisper, Telegram bot).

---

### 3.20 Server-Sent Events

#### REQ-SSE-001: SSE endpoint for live updates

**Priority:** MUST

**Description:** The application shall provide a Server-Sent Events endpoint for pushing real-time updates to the dashboard.

**Acceptance Criteria:**
1. An SSE endpoint is available on the Hono server.
2. The endpoint requires authentication.
3. Events are pushed for: new entry created, entry updated, entry deleted, digest generated.
4. The connection is managed for a single-user system (one active connection).

#### REQ-SSE-002: New entry event

**Priority:** MUST

**Description:** When a new entry is created (from any source), an SSE event shall be pushed.

**Acceptance Criteria:**
1. The event contains the new entry's ID, category, name, and timestamp.
2. The dashboard renders the new entry without a page refresh.

#### REQ-SSE-003: Entry updated event

**Priority:** MUST

**Description:** When an entry is updated, an SSE event shall be pushed.

**Acceptance Criteria:**
1. The event contains the updated entry's ID and changed fields.
2. The dashboard reflects the update without a page refresh.

#### REQ-SSE-004: Entry deleted event

**Priority:** MUST

**Description:** When an entry is soft-deleted, an SSE event shall be pushed.

**Acceptance Criteria:**
1. The event contains the deleted entry's ID.
2. The dashboard removes the entry from view without a page refresh.

#### REQ-SSE-005: Digest generated event

**Priority:** MUST

**Description:** When a new digest is generated, an SSE event shall be pushed.

**Acceptance Criteria:**
1. The event contains the digest content.
2. The dashboard updates the digest display without a page refresh.

---

## 4. Non-Functional Requirements

#### REQ-NFR-001: Single table design

**Priority:** MUST

**Description:** All entries shall be stored in a single `entries` table with category-specific data in a JSONB `fields` column.

**Fit Criteria:** The database schema contains exactly one table for entry storage. No separate tables exist for people, projects, tasks, ideas, or reference entries. Category-specific data is stored exclusively in the `fields` JSONB column.

#### REQ-NFR-002: Graceful degradation

**Priority:** MUST

**Description:** The application shall never crash due to a component failure. Individual component failures shall degrade functionality without bringing down the entire system.

**Fit Criteria:**
- Claude API failure: entries are stored as unclassified, system continues operating.
- Ollama failure: entries are stored without embeddings, system continues operating.
- faster-whisper failure: voice messages are rejected with a user-friendly message, text processing continues.
- SMTP failure: email is skipped, digest is still visible on the dashboard.
- Telegram send failure: entry is stored, confirmation failure is logged.
- No unhandled exceptions propagate to process crash under any single-component failure scenario.

#### REQ-NFR-003: Structured JSON logging

**Priority:** MUST

**Description:** All application logs shall be structured JSON for machine parseability.

**Fit Criteria:** Every line written to stdout/stderr is valid JSON. Every log entry contains `timestamp`, `level`, `module`, and `message` fields. No unstructured console.log output exists in the codebase.

#### REQ-NFR-004: Single-user system

**Priority:** MUST

**Description:** The system is designed for a single user. However, the architecture shall not preclude future multi-user extension.

**Fit Criteria:** One password protects the webapp. One set of Telegram chat IDs is authorized. No user table or user ID foreign keys exist. The `entries` table schema does not include a `user_id` column but also does not use patterns that would prevent adding one.

#### REQ-NFR-005: Server-rendered HTML

**Priority:** MUST

**Description:** The web interface shall use server-rendered HTML. No single-page application framework shall be used.

**Fit Criteria:** HTML is generated server-side via Hono template functions. No React, Vue, Angular, Svelte, or equivalent SPA framework is present in `package.json`. Tailwind CSS is pre-built via CLI (no runtime CSS-in-JS). Client-side JavaScript is limited to SSE handling, form interactions, and autocomplete.

#### REQ-NFR-006: Docker Compose deployment

**Priority:** MUST

**Description:** The system shall be deployable via a single `docker-compose.yml` file.

**Fit Criteria:** Running `docker compose up` starts all services: app, PostgreSQL (pgvector/pgvector:pg16), Ollama, and faster-whisper. All inter-service communication uses Docker network hostnames. Persistent data uses named Docker volumes (`postgres_data`, `ollama_data`, `whisper_data`).

#### REQ-NFR-007: Responsive design

**Priority:** SHOULD

**Description:** The web interface shall be usable on mobile devices.

**Fit Criteria:** All pages render without horizontal scrolling on viewports >= 320px wide. Interactive elements (buttons, inputs) have touch-friendly sizing (minimum 44x44px tap targets). Tailwind responsive utility classes are used for layout adaptation.

#### REQ-NFR-008: Multilingual embeddings

**Priority:** MUST

**Description:** The embedding model shall support English and German at minimum.

**Fit Criteria:** The qwen3-embedding model is used, which supports multilingual content. A query in English returns semantically similar entries written in German, and vice versa, with similarity >= 0.5 for genuinely related content.

#### REQ-NFR-009: Soft delete pattern

**Priority:** MUST

**Description:** Entry deletion shall use a soft delete pattern via the `deleted_at` timestamp column.

**Fit Criteria:** Deleting an entry sets `deleted_at` to the current timestamp. All queries for active entries filter on `deleted_at IS NULL`. Soft-deleted entries are recoverable from the trash page. Only the "Empty Trash" action performs hard deletes.

#### REQ-NFR-010: Settings override pattern

**Priority:** MUST

**Description:** Environment variables shall serve as defaults. The `settings` database table shall override them at runtime.

**Fit Criteria:** For each configurable setting, the application checks the `settings` table first. If no row exists for that key, the corresponding environment variable value is used. If neither exists, the hardcoded default applies. Changes to the settings table take effect without application restart.

---

## 5. External Interfaces

### 5.1 Telegram Bot API

| Property | Value |
|----------|-------|
| Protocol | HTTPS (long-polling) |
| Authentication | Bot token (`TELEGRAM_BOT_TOKEN`) |
| Direction | Bidirectional (receive messages, send replies) |
| Data format | JSON |
| Library | grammY |
| Rate limits | Telegram-imposed (30 messages/second to different chats, 1 message/second to same chat) |

### 5.2 Anthropic Claude API

| Property | Value |
|----------|-------|
| Protocol | HTTPS |
| Authentication | API key (`ANTHROPIC_API_KEY`) |
| Direction | Request/Response |
| Data format | JSON |
| Default model | claude-sonnet-4-20250514 |
| Library | @anthropic-ai/sdk |
| Usage | Classification (structured JSON extraction), digest generation (summarization) |

### 5.3 Ollama HTTP API

| Property | Value |
|----------|-------|
| Protocol | HTTP |
| Authentication | None (internal network) |
| Direction | Request/Response |
| Default URL | `http://ollama:11434` |
| Model | qwen3-embedding |
| Output | 4096-dimensional float vectors |
| Usage | Embedding generation for semantic search |

### 5.4 faster-whisper HTTP API

| Property | Value |
|----------|-------|
| Protocol | HTTP |
| Authentication | None (internal network) |
| Default URL | `http://whisper:8000` |
| Model | medium |
| Input | Audio files (OGG/Opus from Telegram) |
| Output | Transcribed text |
| Usage | Voice message transcription |

### 5.5 SMTP

| Property | Value |
|----------|-------|
| Protocol | SMTP/TLS |
| Authentication | Username/password (`SMTP_USER`, `SMTP_PASS`) |
| Direction | Outbound only |
| Library | nodemailer |
| Usage | Digest email delivery |

### 5.6 Google Calendar API (Optional)

| Property | Value |
|----------|-------|
| Protocol | HTTPS |
| Authentication | OAuth2 (client ID, client secret, refresh token) |
| Direction | Outbound only |
| Usage | Create calendar events when classification detects dates |
| Required | No -- disabled when credentials are not configured |

---

## 6. Constraints, Assumptions & Dependencies

### 6.1 Constraints

| ID | Constraint |
|----|-----------|
| CON-001 | Claude API is the only external paid dependency. All other services run locally. |
| CON-002 | The system is deployed via Docker Compose on the user's own server. |
| CON-003 | The system is single-user. No multi-tenant isolation is implemented. |
| CON-004 | The web interface is server-rendered HTML. No SPA framework is permitted. |
| CON-005 | The Telegram bot uses long-polling. No public URL or webhook endpoint is required. |
| CON-006 | All data resides on the user's server. No data is sent to third parties other than the Claude API (for classification/digests) and Telegram (for bot communication). |

### 6.2 Assumptions

| ID | Assumption |
|----|-----------|
| ASM-001 | The user has a Telegram account and has created a Telegram bot via BotFather. |
| ASM-002 | The user has an Anthropic API key with sufficient quota. |
| ASM-003 | The deployment server has Docker and Docker Compose installed. |
| ASM-004 | The deployment server has sufficient resources to run PostgreSQL, Ollama, faster-whisper, and the Node.js application concurrently. |
| ASM-005 | The user has access to an SMTP server for digest email delivery. |
| ASM-006 | The Ollama container ships with no models; the application handles model pulling on first startup. |
| ASM-007 | The faster-whisper container downloads the medium model on first use; subsequent starts use the cached model. |

### 6.3 Dependencies

| Dependency | Version/Image | Purpose |
|-----------|---------------|---------|
| Node.js | (current LTS) | Application runtime |
| TypeScript | (latest stable) | Type-safe development |
| Hono | (latest) | Web framework, routing, SSE |
| PostgreSQL | 16 (pgvector/pgvector:pg16) | Data storage, vector search |
| pgvector | (bundled with image) | Vector similarity extension |
| Ollama | ollama/ollama (latest) | Local embedding generation |
| qwen3-embedding | (pulled by Ollama) | Multilingual embedding model (4096 dims) |
| faster-whisper | fedirz/faster-whisper-server:latest | Voice transcription |
| grammY | (latest) | Telegram bot framework |
| Drizzle ORM | (latest) | Database access and migrations |
| node-cron | (latest) | Scheduled job execution |
| nodemailer | (latest) | SMTP email sending |
| @modelcontextprotocol/sdk | (latest) | MCP server implementation |
| @anthropic-ai/sdk | (latest) | Claude API client |
| Tailwind CSS | (latest, CLI build) | Styling |

---

## 7. Traceability

The following table maps each requirement to its source section in `ARCHITECTURE.md`.

| Requirement | ARCHITECTURE.md Section |
|-------------|------------------------|
| REQ-CONF-001 | Docker Compose, .env.example |
| REQ-CONF-002 | Settings Table |
| REQ-CONF-003 | Startup Sequence, .env.example |
| REQ-LOG-001, REQ-LOG-002 | Error Handling — Strategy |
| REQ-DB-001 through REQ-DB-008 | Database Schema |
| REQ-EMB-001 through REQ-EMB-004 | Tech Stack (Embeddings), Error Handling (Ollama) |
| REQ-CLS-001 through REQ-CLS-007 | Categories, Classification Prompt, Context-Aware Classification, Error Handling (Claude API) |
| REQ-TG-001 through REQ-TG-009 | Capture Flows (Telegram), Error Handling (PostgreSQL, faster-whisper, Telegram) |
| REQ-AUTH-001 through REQ-AUTH-004 | Web Dashboard — Authentication |
| REQ-DASH-001 through REQ-DASH-006 | Web Dashboard — Pages (Dashboard) |
| REQ-BRWS-001 through REQ-BRWS-005 | Web Dashboard — Pages (Browse) |
| REQ-ENTRY-001 through REQ-ENTRY-004 | Web Dashboard — Pages (Entry view/edit) |
| REQ-NEW-001 through REQ-NEW-006 | Web Dashboard — Pages (New note), Capture Flows (Webapp — full editor) |
| REQ-TRASH-001 through REQ-TRASH-003 | Web Dashboard — Pages (Trash) |
| REQ-SET-001 through REQ-SET-008 | Web Dashboard — Pages (Settings), Settings Table |
| REQ-MCP-001 through REQ-MCP-009 | MCP Server |
| REQ-DIG-001 through REQ-DIG-003 | Digests |
| REQ-EMAIL-001, REQ-EMAIL-002 | Error Handling (SMTP) |
| REQ-CRON-001 through REQ-CRON-004 | Startup Sequence, Error Handling (Ollama, Claude API) |
| REQ-HEALTH-001 | Health endpoint |
| REQ-START-001 through REQ-START-007 | Startup Sequence |
| REQ-SSE-001 through REQ-SSE-005 | Architecture (SSE), Web Dashboard (Dashboard — Live updates) |
| REQ-NFR-001 | Database Schema ("All entries live in one table") |
| REQ-NFR-002 | Error Handling — Strategy, Error Handling — By component |
| REQ-NFR-003 | Error Handling — Strategy |
| REQ-NFR-004 | Web Dashboard — Authentication |
| REQ-NFR-005 | Tech Stack (Frontend), Web Dashboard |
| REQ-NFR-006 | Docker Compose |
| REQ-NFR-007 | Web Dashboard ("Responsive design") |
| REQ-NFR-008 | Tech Stack (Embeddings), Design Principles (Multilingual) |
| REQ-NFR-009 | Database Schema (deleted_at), Web Dashboard — Pages (Trash) |
| REQ-NFR-010 | Settings Table |

---

*End of document.*
