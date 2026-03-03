# Cortex — Project Instructions

## What This Is

A self-hosted, agent-readable second brain. See `ARCHITECTURE.md` for the full architecture (v3).

## Key Architectural Decisions

These were decided during the spec interview and are final:

- **LLM-agnostic:** Classification and digests use a provider abstraction (`src/llm/`). Two implementations: Anthropic SDK and OpenAI-compatible SDK (covers LM Studio, Ollama chat, OpenAI, etc.). Config: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`.
- **Embedding model:** snowflake-arctic-embed2 via Ollama, 1024 dimensions, multilingual (EN+DE).
- **Voice capture:** Telegram voice messages transcribed via faster-whisper (medium model) in a Docker container.
- **Inline correction:** Low-confidence (< threshold) Telegram replies include inline category buttons for quick correction.
- **Context-aware classification:** Before classifying, fetch last 5 recent entries + top 3 semantically similar entries as context for the LLM.
- **Soft delete:** `deleted_at` column on entries table. Trash page in webapp with restore + empty trash.
- **Settings page:** Runtime-configurable preferences (Telegram chat IDs, LLM model, digest schedule, timezone, confidence threshold, email, Ollama URL). Stored in `settings` table, overrides env vars.
- **SSE:** Server-Sent Events for live dashboard updates (new entries, digest refresh).
- **MCP CRUD:** 7 tools including `update_entry` and `delete_entry` (soft delete).
- **Tags:** Claude-suggested + free-form + autocomplete from existing tags.
- **Search:** Semantic (cosine similarity >= 0.5) + text search fallback.
- **Frontend:** Server-rendered HTML via Hono, Tailwind CSS (CLI pre-built), responsive design.
- **Single-user for now:** Don't prevent multi-user architecturally (settings table supports multiple Telegram chat IDs).
- **Google Calendar:** Optional (COULD priority). Keep in spec, build if time permits.
- **No Obsidian import:** Removed from architecture.

## Tech Stack

- Runtime: Node.js + TypeScript
- Web: Hono
- DB: PostgreSQL + pgvector + Drizzle ORM
- Embeddings: Ollama + snowflake-arctic-embed2
- LLM: Provider abstraction (Anthropic SDK / OpenAI SDK)
- Voice: faster-whisper (medium)
- Telegram: grammY
- Testing: Vitest (recommended — not yet set up)
- CSS: Tailwind CLI
- Deploy: Docker Compose

## Development Workflow

This project uses **Specification-Driven Development (spec-dd)**:

1. Behavioral specification → 2. Test specification → 3. Test implementation spec → 4. Implement tests (must FAIL) → 5. Implement feature (make tests PASS) → 6. Review alignment

All spec artifacts live in `docs/specs/`. Check `docs/specs/progress.md` for current status per feature.

## Implementation Order

Priority: **Capture first** (Telegram → classify → store, then web, then MCP).

| Phase | Features |
|-------|----------|
| 1. Foundation | Config, logging, DB schema, health endpoint |
| 2. Intelligence | Embedding (Ollama), Classification (LLM provider) |
| 3. Telegram | Bot (text + voice + fix + inline buttons) |
| 4. Web | Auth, dashboard, browse, entry, new note, trash, settings, SSE |
| 5. MCP | Stdio + HTTP transport, 7 tools |
| 6. Digests | Daily + weekly + email + cron |

## File Conventions

- Specs: `docs/specs/{feature}-specification.md`, `{feature}-test-specification.md`, `{feature}-test-implementation-specification.md`
- Source: `src/` per `ARCHITECTURE.md` project structure
- Prompts: `prompts/classify.md`, `prompts/daily-digest.md`, `prompts/weekly-review.md`

## Resuming Work

To continue spec-dd work: read `docs/specs/progress.md` to see which feature is at which phase, then run the appropriate spec-dd phase. Use the `spec-dd` skill.
