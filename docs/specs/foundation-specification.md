# Foundation - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Foundation |
| Phase | 1 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

The Foundation feature establishes the operational baseline for the Cortex application by providing validated configuration loading, structured logging, automatic database provisioning, and a health endpoint. These capabilities ensure that the application starts reliably with correct settings, produces machine-parseable log output for debugging and monitoring, creates its own database schema without manual intervention, and exposes a lightweight status check for uptime monitoring. Every other feature in the system depends on Foundation being correct.

## User Stories & Acceptance Criteria

**US-1: As a developer, I want environment variables loaded and validated at startup so that misconfiguration is caught early.**

- AC-1.1: Required environment variables (`DATABASE_URL`, `LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WEBAPP_PASSWORD`, `SESSION_SECRET`) cause startup failure with a clear error message naming the missing variable if any are absent.
- AC-1.2: Optional environment variables have documented defaults: `PORT=3000`, `OLLAMA_MODEL=qwen3-embedding`, `TZ=Europe/Berlin`, `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-sonnet-4-20250514`, `LLM_BASE_URL=` (empty, provider-dependent default), `DAILY_DIGEST_CRON=30 7 * * *`, `WEEKLY_DIGEST_CRON=0 16 * * 0`.
- AC-1.3: Settings table values override environment variable values when present. When a key exists in the `settings` table, its value takes precedence over the corresponding env var.
- AC-1.4: Configuration is exported as a typed TypeScript object (`config`) importable by all other modules. Includes LLM provider settings (`llmProvider`, `llmApiKey`, `llmModel`, `llmBaseUrl`).

**US-2: As a developer, I want structured JSON logging so that errors are searchable and parseable.**

- AC-2.1: Every log entry includes: `timestamp` (ISO 8601 with timezone), `level` (one of `debug`, `info`, `warn`, `error`), `module` (originating module name), `message` (human-readable string), and an optional `context` object for structured metadata.
- AC-2.2: Log output goes to stdout in JSON format (one JSON object per line, newline-delimited).

**US-3: As a developer, I want the database schema created automatically on startup so that deployment is zero-config.**

- AC-3.1: Drizzle migrations run on app startup, creating the `entries` table with all columns: `id` (UUID, primary key), `category` (TEXT, nullable, CHECK constraint for five allowed values), `name` (TEXT, NOT NULL), `content` (TEXT), `fields` (JSONB, default `{}`), `tags` (TEXT[], default `{}`), `confidence` (REAL), `source` (TEXT, NOT NULL, CHECK constraint), `source_type` (TEXT, default `text`, CHECK constraint), `embedding` (vector(4096)), `deleted_at` (TIMESTAMPTZ), `created_at` (TIMESTAMPTZ, default now()), `updated_at` (TIMESTAMPTZ, default now()).
- AC-3.2: The `settings` table is created with columns: `key` (TEXT, primary key), `value` (TEXT, NOT NULL), `updated_at` (TIMESTAMPTZ, default now()).
- AC-3.3: HNSW index is created on the `embedding` column with `vector_cosine_ops`. Additional indexes are created on `category`, `created_at`, and a GIN index on `tags`.
- AC-3.4: An `updated_at` trigger fires before row updates on both `entries` and `settings` tables, setting `updated_at` to `now()`.
- AC-3.5: The `category` column allows NULL to support unclassified entries (when Claude API fails or entry is pending classification).

**US-4: As a monitoring system, I want a health endpoint so that I can verify the app is running and all services are connected.**

- AC-4.1: `GET /health` returns a JSON response with fields: `status` (`ok` or `degraded`), `postgres` (`connected` or `disconnected`), `ollama` (`connected` or `disconnected`), `whisper` (`connected` or `disconnected`), `telegram` (`polling` or `stopped`), and `uptime` (integer, seconds since app start).
- AC-4.2: The `/health` endpoint does not require authentication. It is accessible without a session cookie or any credentials.
- AC-4.3: If `postgres` is `disconnected`, the `status` field is set to `degraded`. If all services are connected, `status` is `ok`.

## Constraints

- **Technical:** Configuration must be loaded synchronously at module import time so that other modules can import `config` at the top level without async initialization.
- **Technical:** The `pgvector` extension (`CREATE EXTENSION IF NOT EXISTS vector`) must be enabled before any migration that references the `vector` type. Drizzle migrations must handle this.
- **Technical:** The health endpoint must respond within 5 seconds. Each service check (Postgres, Ollama, Whisper) should have an individual timeout of 2 seconds so that one slow service does not block the entire response.
- **Operational:** The application runs in Docker Compose. Postgres may not be ready when the app container starts, even with `depends_on: condition: service_healthy`. Migrations must handle transient connection failures.
- **Business:** The settings table is the single source of truth for runtime-configurable values. Environment variables serve only as initial defaults.

## Edge Cases

- **DATABASE_URL has wrong format:** The application should fail at startup with a clear error message indicating the URL is malformed, rather than crashing with an opaque driver error.
- **PostgreSQL is not yet ready when app starts:** Migration runner should retry with exponential backoff (e.g., 1s, 2s, 4s) up to a maximum of 30 seconds before giving up and exiting with a non-zero exit code.
- **Settings table has an unrecognized key:** The application ignores keys it does not recognize. No error, no warning. This allows forward-compatibility if keys are added in future versions.
- **Ollama or faster-whisper unreachable at health check time:** The health endpoint reports that service as `disconnected` but still returns a 200 response. Only Postgres being disconnected changes status to `degraded`.
- **Empty settings table:** All configuration values fall back to their environment variable values (or hardcoded defaults if the env var is also absent for optional settings).
- **DATABASE_URL contains special characters in password:** The URL must be properly encoded. The config module should not attempt to re-encode or parse the password portion.
- **Multiple app instances starting simultaneously:** Drizzle migrations must be safe to run concurrently (idempotent DDL with `IF NOT EXISTS` or Drizzle's built-in migration locking).

## Non-Goals

- **Settings UI:** The web interface for managing settings is a separate feature (`web-settings`). Foundation only provides the settings table and the override mechanism.
- **Database backup/restore:** Backup and recovery are the operator's responsibility via standard PostgreSQL tooling.
- **Log rotation or log file management:** The application writes to stdout only. Log rotation, aggregation, and retention are handled by Docker's logging driver or an external log collector.
- **Health endpoint for external monitoring services:** No Prometheus metrics, no OpenTelemetry traces, no `/metrics` endpoint. The health endpoint is intentionally simple JSON.
- **Secrets management:** The application reads secrets from environment variables. Integration with Vault, AWS Secrets Manager, or similar tools is out of scope.

## Open Questions

(None)
