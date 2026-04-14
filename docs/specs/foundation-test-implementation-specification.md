# Foundation - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Foundation |
| Phase | 3 — Test Implementation Specification |
| Date | 2026-03-03 |
| Status | Draft |
| Derives from | `docs/specs/foundation-test-specification.md` |

## Test Framework & Conventions

| Aspect | Choice |
|--------|--------|
| Language | TypeScript |
| Test framework | Vitest |
| Assertion style | `expect()` from Vitest |
| Mocking | `vi.spyOn()`, `vi.fn()`, `vi.resetModules()` |
| Integration DB | `@testcontainers/postgresql` with `pgvector/pgvector:pg16` image |
| HTTP testing | Hono `app.request()` (built-in, no supertest needed) |

**Conventions:**
- `describe` blocks group by user story / functional area
- `it` blocks describe the behavior, not the implementation
- One assertion theme per `it` block (one test scenario → one test function)
- Test names read as sentences: `it("fails startup when DATABASE_URL is missing")`

## Test Structure

```
tests/
├── unit/
│   ├── config.test.ts              # TS-1.1 – TS-1.5, TS-1.8, TS-EC-1
│   ├── logger.test.ts              # TS-2.1 – TS-2.4
│   ├── health.test.ts              # TS-4.1 – TS-4.5, TS-EC-4
│   └── migration-retry.test.ts     # TS-EC-2
├── integration/
│   ├── schema.test.ts              # TS-3.1 – TS-3.6
│   ├── config-settings.test.ts     # TS-1.6, TS-1.7, TS-EC-3, TS-EC-5
│   └── db-url-special-chars.test.ts # TS-EC-6
└── helpers/
    ├── env.ts                      # Env var manipulation helpers
    └── test-db.ts                  # Testcontainers setup/teardown
```

**Naming pattern:** Test files match the module under test or the functional area. Integration tests require external dependencies (testcontainers PostgreSQL). Unit tests use only mocks, stubs, and in-process assertions — no external services needed. This separation allows running `vitest --dir tests/unit` for fast feedback and `vitest --dir tests/integration` for full verification.

## Test Scenario Mapping

### Unit Tests — Configuration (`tests/unit/config.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-1.1 | `it("fails startup when DATABASE_URL is missing")` | `config.test.ts` |
| TS-1.2 | `it("fails startup naming all missing required variables")` | `config.test.ts` |
| TS-1.3 | `it("loads successfully when all required env vars are present")` | `config.test.ts` |
| TS-1.4 | `it("uses documented defaults for optional variables")` | `config.test.ts` |
| TS-1.5 | `it("uses provided values for optional variables")` | `config.test.ts` |
| TS-1.8 | `it("exports a typed config object with all expected properties")` | `config.test.ts` |
| TS-EC-1 | `it("fails startup with clear error for malformed DATABASE_URL")` | `config.test.ts` |

---

**TS-1.1: Startup fails when DATABASE_URL is missing**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set all required env vars (`LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WEBAPP_PASSWORD`, `SESSION_SECRET`) except `DATABASE_URL`. Delete `process.env.DATABASE_URL`.
- **Action (When):** Dynamically import `src/config.ts` via `await import(...)`. Wrap in try/catch or use `expect(...).rejects`.
- **Assertion (Then):** The import throws an error whose message contains the string `"DATABASE_URL"`.
- **Teardown:** Restore original `process.env`.

**TS-1.2: Startup fails naming all missing required vars**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `WEBAPP_PASSWORD` but omit `LLM_API_KEY` and `SESSION_SECRET`.
- **Action (When):** Dynamically import `src/config.ts`.
- **Assertion (Then):** The thrown error message contains both `"LLM_API_KEY"` and `"SESSION_SECRET"`.
- **Teardown:** Restore `process.env`.

**TS-1.3: Configuration loads successfully**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set all five required env vars to valid values.
- **Action (When):** Dynamically import `src/config.ts`.
- **Assertion (Then):** The import resolves without error. The exported `config` object is defined.
- **Teardown:** Restore `process.env`.

**TS-1.4: Optional env vars use defaults**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set only the five required env vars. Ensure `PORT`, `OLLAMA_MODEL`, `TZ`, `LLM_PROVIDER`, `LLM_MODEL`, `DAILY_DIGEST_CRON`, `WEEKLY_DIGEST_CRON` are all deleted from `process.env`.
- **Action (When):** Dynamically import `src/config.ts`.
- **Assertion (Then):** Verify each default:
  - `config.port === 3000`
  - `config.ollamaModel === "qwen3-embedding"`
  - `config.timezone === "Europe/Berlin"`
  - `config.llmProvider === "anthropic"`
  - `config.llmModel === "claude-sonnet-4-20250514"`
  - `config.dailyDigestCron === "30 7 * * *"`
  - `config.weeklyDigestCron === "0 16 * * 0"`
- **Teardown:** Restore `process.env`.

**TS-1.5: Optional env vars use provided values**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set all required env vars plus `PORT=4000`, `LLM_PROVIDER=openai-compatible`, `LLM_MODEL=gpt-4o`, `LLM_BASE_URL=http://localhost:1234/v1`.
- **Action (When):** Dynamically import `src/config.ts`.
- **Assertion (Then):**
  - `config.port === 4000`
  - `config.llmProvider === "openai-compatible"`
  - `config.llmModel === "gpt-4o"`
  - `config.llmBaseUrl === "http://localhost:1234/v1"`
- **Teardown:** Restore `process.env`.

**TS-1.8: Config is a typed exportable object**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set all required env vars.
- **Action (When):** Dynamically import `src/config.ts`.
- **Assertion (Then):** The `config` object has all expected properties: `databaseUrl`, `llmProvider`, `llmApiKey`, `llmModel`, `llmBaseUrl`, `telegramBotToken`, `webappPassword`, `sessionSecret`, `port`, `ollamaModel`, `timezone`, `dailyDigestCron`, `weeklyDigestCron`. Verify each property exists (is not `undefined`).
- **Teardown:** Restore `process.env`.

**TS-EC-1: Malformed DATABASE_URL produces clear error**

- **Setup (Given):** Save `process.env`, call `vi.resetModules()`. Set `DATABASE_URL=not-a-valid-url` and all other required env vars.
- **Action (When):** Dynamically import `src/config.ts`.
- **Assertion (Then):** The import throws an error whose message indicates the database URL is malformed (e.g., contains `"DATABASE_URL"` and a word like `"malformed"`, `"invalid"`, or `"format"`).
- **Teardown:** Restore `process.env`.

---

### Unit Tests — Logger (`tests/unit/logger.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-2.1 | `it("includes timestamp, level, module, and message in log output")` | `logger.test.ts` |
| TS-2.2 | `it("includes context object when provided")` | `logger.test.ts` |
| TS-2.3 (×4) | `it("outputs level 'debug' for debug()")`, `it("outputs level 'info' for info()")`, `it("outputs level 'warn' for warn()")`, `it("outputs level 'error' for error()")` | `logger.test.ts` |
| TS-2.4 | `it("produces newline-delimited JSON on stdout")` | `logger.test.ts` |

---

**TS-2.1: Log entry contains all required fields**

- **Setup (Given):** Spy on `process.stdout.write` using `vi.spyOn(process.stdout, 'write').mockImplementation(...)`. Import the logger and create an instance for module `"test-module"`.
- **Action (When):** Call `logger.info("test message")`.
- **Assertion (Then):** The captured stdout write call contains a JSON string. Parse it and verify:
  - `timestamp` matches ISO 8601 pattern (regex: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/`)
  - `level === "info"`
  - `module === "test-module"`
  - `message === "test message"`
- **Teardown:** Restore `process.stdout.write`.

**TS-2.2: Log entry includes optional context**

- **Setup (Given):** Spy on `process.stdout.write`. Create logger for `"test-module"`.
- **Action (When):** Call `logger.error("failed", { code: 500, detail: "timeout" })`.
- **Assertion (Then):** Parsed JSON has `context` field equal to `{ code: 500, detail: "timeout" }`.
- **Teardown:** Restore spy.

**TS-2.3: All four log levels produce output (4 tests)**

- **Setup (Given):** Spy on `process.stdout.write`. Create logger.
- **Action (When):** Call `logger.debug(...)`, `logger.info(...)`, `logger.warn(...)`, `logger.error(...)` respectively.
- **Assertion (Then):** Each parsed JSON output has `level` set to the corresponding level string.
- **Teardown:** Restore spy.

**TS-2.4: Newline-delimited JSON to stdout**

- **Setup (Given):** Spy on `process.stdout.write`. Create logger.
- **Action (When):** Call the logger twice (two separate log calls).
- **Assertion (Then):** Concatenate all captured write calls. Split on `"\n"`, filter empty strings. Exactly 2 entries remain. Each is valid JSON (no parse error with `JSON.parse()`).
- **Teardown:** Restore spy.

---

### Integration Tests — Schema (`tests/integration/schema.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-3.1 | `it("creates entries table with all columns and constraints")` | `schema.test.ts` |
| TS-3.2 | `it("creates settings table with correct schema")` | `schema.test.ts` |
| TS-3.3 | `it("creates HNSW, category, created_at, and GIN tags indexes")` | `schema.test.ts` |
| TS-3.4 | `it("auto-updates updated_at on entries row update")` | `schema.test.ts` |
| TS-3.5 | `it("auto-updates updated_at on settings row update")` | `schema.test.ts` |
| TS-3.6 | `it("accepts entry with null category")` | `schema.test.ts` |

All tests in this file share a single testcontainers PostgreSQL instance (started in `beforeAll`, stopped in `afterAll`). Migrations run once before all tests.

---

**TS-3.1: Entries table created with all columns and constraints**

- **Setup (Given):** Testcontainers starts a `pgvector/pgvector:pg16` container. Drizzle migrations run against it.
- **Action (When):** Query `information_schema.columns` where `table_name = 'entries'`.
- **Assertion (Then):**
  - Table exists with columns: `id` (uuid), `category` (text, nullable), `name` (text, not null), `content` (text), `fields` (jsonb), `tags` (ARRAY/text[]), `confidence` (real), `source` (text, not null), `source_type` (text), `embedding` (USER-DEFINED/vector), `deleted_at` (timestamptz), `created_at` (timestamptz), `updated_at` (timestamptz).
  - Query `pg_constraint` / `information_schema.check_constraints` to verify CHECK constraints on `category` (allows 'people', 'projects', 'tasks', 'ideas', 'reference'), `source` (allows 'telegram', 'webapp', 'mcp'), and `source_type` (allows 'text', 'voice').
  - Verify category allows NULL by inserting a row with `category: null` (covered more specifically in TS-3.6, but a column-level nullability check via `is_nullable = 'YES'` is also valid here).

**TS-3.2: Settings table created**

- **Setup (Given):** Same testcontainers instance, migrations already run.
- **Action (When):** Query `information_schema.columns` where `table_name = 'settings'`.
- **Assertion (Then):**
  - Table has columns: `key` (text, primary key), `value` (text, not null), `updated_at` (timestamptz).
  - Verify primary key on `key` via `information_schema.table_constraints`.

**TS-3.3: All indexes created**

- **Setup (Given):** Same testcontainers instance, migrations already run.
- **Action (When):** Query `pg_indexes` where `tablename = 'entries'`.
- **Assertion (Then):**
  - An index exists using `hnsw` access method with `vector_cosine_ops` on the `embedding` column.
  - An index exists on `category`.
  - An index exists on `created_at`.
  - A GIN index exists on `tags` (access method = `gin`).

**TS-3.4: updated_at trigger on entries**

- **Setup (Given):** Insert an entry row with all required fields in its own transaction (Drizzle's default auto-commit). Record the returned `updated_at` value.
- **Action (When):** In a separate transaction, update the entry's `name` to a different value. The INSERT and UPDATE **must** be separate transactions because PostgreSQL's `now()` returns the transaction start time — within a single transaction, `updated_at` would not change even with the trigger.
- **Assertion (Then):** Re-select the entry. Its `updated_at` is strictly greater than the original value.

**TS-3.5: updated_at trigger on settings**

- **Setup (Given):** Insert a setting row with `key = 'test_key'`, `value = 'original'` in its own transaction. Record its `updated_at`.
- **Action (When):** In a separate transaction, update the setting's `value` to `'updated'`.
- **Assertion (Then):** Re-select the setting. Its `updated_at` is strictly greater than the original value.

**TS-3.6: Entry with null category accepted**

- **Setup (Given):** Same testcontainers instance, migrations already run.
- **Action (When):** Insert an entry with `category: null`, `name: 'test'`, `source: 'webapp'`.
- **Assertion (Then):** The insert succeeds. Selecting the entry back returns `category === null`.

---

### Integration Tests — Config Settings Override (`tests/integration/config-settings.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-1.6 | `it("returns database setting when it overrides env var")` | `config-settings.test.ts` |
| TS-1.7 | `it("returns env var when no database setting exists")` | `config-settings.test.ts` |
| TS-EC-3 | `it("ignores unrecognized keys in settings table")` | `config-settings.test.ts` |
| TS-EC-5 | `it("falls back to env vars when settings table is empty")` | `config-settings.test.ts` |

These tests need both a database (for the settings table) and env var manipulation. They test the config resolution layer — the function/mechanism that checks the settings table first, then falls back to env vars.

**Architectural note:** The config system has two layers. The synchronous `config` object (tested in `unit/config.test.ts`) is loaded at import time from environment variables only — it cannot query the database. The settings override mechanism is a separate async layer that reads from the `settings` table at runtime (e.g., during app startup or on-demand). These integration tests target that async resolution layer, not the synchronous import-time `config` object.

---

**TS-1.6: Settings table value overrides env var**

- **Setup (Given):** Testcontainers PostgreSQL running with migrations applied. Set `process.env.LLM_MODEL = "env-model"`. Insert a row into `settings` with `key = 'llm_model'`, `value = 'db-model'`.
- **Action (When):** Call the config resolution function for key `"llm_model"` (this may be a function like `getConfigValue("llm_model")` or part of config reload).
- **Assertion (Then):** The resolved value is `"db-model"`.
- **Teardown:** Delete the settings row. Restore env var.

**TS-1.7: Env var used when no database setting exists**

- **Setup (Given):** Testcontainers PostgreSQL running. Set `process.env.LLM_MODEL = "env-model"`. Ensure no row with `key = 'llm_model'` exists in `settings`.
- **Action (When):** Call the config resolution function for `"llm_model"`.
- **Assertion (Then):** The resolved value is `"env-model"`.

**TS-EC-3: Unrecognized settings key is ignored**

- **Setup (Given):** Testcontainers PostgreSQL running. Insert a row into `settings` with `key = 'unknown_future_key'`, `value = 'something'`.
- **Action (When):** Call the config resolution function (or load the full config). No specific key lookup needed.
- **Assertion (Then):** No error is thrown. The config object does not contain a property `unknown_future_key`. The application continues normally.

**TS-EC-5: Empty settings table falls back to env vars**

- **Setup (Given):** Testcontainers PostgreSQL running. Settings table is empty (truncate it). Set `process.env.LLM_MODEL = "env-model"`.
- **Action (When):** Call the config resolution function for `"llm_model"`.
- **Assertion (Then):** The resolved value is `"env-model"`.

---

### Unit Tests — Health Endpoint (`tests/unit/health.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-4.1 | `it("returns JSON with status, postgres, ollama, whisper, telegram, and uptime")` | `health.test.ts` |
| TS-4.2 | `it("reports 'ok' when all services are connected")` | `health.test.ts` |
| TS-4.3 | `it("is accessible without authentication")` | `health.test.ts` |
| TS-4.4 | `it("reports 'degraded' when PostgreSQL is unreachable")` | `health.test.ts` |
| TS-4.5 | `it("reports 'ok' when Ollama is unreachable but Postgres is connected")` | `health.test.ts` |
| TS-EC-4 | `it("reports disconnected services without error")` | `health.test.ts` |

The health route receives injected service checker functions. Tests provide stubs that return controlled results.

---

**TS-4.1: Health endpoint returns all expected fields**

- **Setup (Given):** Create a Hono app with the health route. Inject service checkers that all return "connected"/"polling". Record app start time.
- **Action (When):** Call `app.request("/health")`.
- **Assertion (Then):** Response status is 200. Parse JSON body. Verify fields exist: `status`, `postgres`, `ollama`, `whisper`, `telegram`, `uptime`. `uptime` is a non-negative integer.

**TS-4.2: Health reports "ok" when all services connected**

- **Setup (Given):** Inject checkers: `postgres → "connected"`, `ollama → "connected"`, `whisper → "connected"`, `telegram → "polling"`.
- **Action (When):** `app.request("/health")`.
- **Assertion (Then):** JSON has `status: "ok"`, `postgres: "connected"`, `ollama: "connected"`, `whisper: "connected"`, `telegram: "polling"`.

**TS-4.3: Health endpoint requires no authentication**

- **Setup (Given):** Create Hono app with auth middleware protecting all routes except `/health`. Do NOT set any session cookie or auth header on the request.
- **Action (When):** `app.request("/health")` with no credentials.
- **Assertion (Then):** Response status is 200. Body is valid JSON.

**TS-4.4: Postgres disconnected yields "degraded"**

- **Setup (Given):** Inject checkers: `postgres → "disconnected"`, others → "connected"/"polling".
- **Action (When):** `app.request("/health")`.
- **Assertion (Then):** JSON has `status: "degraded"`, `postgres: "disconnected"`.

**TS-4.5: Ollama disconnected does not degrade status**

- **Setup (Given):** Inject checkers: `postgres → "connected"`, `ollama → "disconnected"`, others → "connected"/"polling".
- **Action (When):** `app.request("/health")`.
- **Assertion (Then):** JSON has `status: "ok"`, `ollama: "disconnected"`.

**TS-EC-4: Unreachable services reported without error**

- **Setup (Given):** Inject checkers: `postgres → "connected"`, `ollama → "disconnected"`, `whisper → "disconnected"`, `telegram → "stopped"`.
- **Action (When):** `app.request("/health")`.
- **Assertion (Then):** Response status is 200. JSON has `status: "ok"`, `ollama: "disconnected"`, `whisper: "disconnected"`. No error thrown.

---

### Unit Tests — Migration Retry (`tests/unit/migration-retry.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-EC-2 | `it("retries migrations with backoff until Postgres becomes available")` | `unit/migration-retry.test.ts` |

---

**TS-EC-2: Migration retry on transient connection failure**

- **Setup (Given):** Create a mock migration runner function. Configure it to throw a connection error on the first 2 calls, then succeed on the 3rd. Use `vi.useFakeTimers()` to control backoff timing.
- **Action (When):** Call the migration-with-retry wrapper function. Advance fake timers to allow retries to proceed.
- **Assertion (Then):** The migration runner was called 3 times (2 failures + 1 success). The retries used increasing delays (verify via timer advancement: first retry after ~1s, second after ~2s). The function resolves successfully.
- **Teardown:** Restore real timers.

**Note:** This tests the retry wrapper logic, not actual Drizzle migration execution. The retry wrapper is a thin function around Drizzle's `migrate()` call. Testing it with a mock is appropriate since we're verifying retry behavior, not SQL execution.

---

### Integration Tests — Special Characters in DB URL (`tests/integration/db-url-special-chars.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-EC-6 | `it("connects successfully with special characters in DATABASE_URL password")` | `db-url-special-chars.test.ts` |

---

**TS-EC-6: DATABASE_URL with special characters in password**

- **Setup (Given):** Start a testcontainers PostgreSQL instance with a password containing special characters (e.g., `p@ss%20word!`). Construct a properly percent-encoded `DATABASE_URL`.
- **Action (When):** Establish a database connection using the URL and execute a simple query (`SELECT 1`).
- **Assertion (Then):** The query succeeds without URL parsing errors. The connection is valid.
- **Teardown:** Stop container.

## Fixtures & Test Data

### Shared Test Helpers

**`tests/helpers/env.ts`** — Environment variable manipulation:

```typescript
// Saves current process.env, returns a restore function
export function withEnv(overrides: Record<string, string | undefined>): () => void;

// Sets minimum required env vars for config to load
export function setRequiredEnvVars(): void;
```

- `withEnv()` takes a map of env var overrides. It saves the current values, applies the overrides (deleting keys set to `undefined`), and returns a restore function to call in `afterEach`.
- `setRequiredEnvVars()` sets `DATABASE_URL`, `LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WEBAPP_PASSWORD`, `SESSION_SECRET` to valid placeholder values.

**`tests/helpers/test-db.ts`** — Testcontainers database setup:

```typescript
// Starts a pgvector container, returns connection URL and cleanup function
export async function startTestDb(): Promise<{
  url: string;
  stop: () => Promise<void>;
}>;

// Runs Drizzle migrations against the provided URL
export async function runMigrations(url: string): Promise<void>;
```

- `startTestDb()` uses `@testcontainers/postgresql` with the `pgvector/pgvector:pg16` image. Returns the connection URL and a stop function.
- `runMigrations()` creates a Drizzle instance from the URL and runs migrations. Handles the `CREATE EXTENSION IF NOT EXISTS vector` prerequisite.
- These are used in `beforeAll` / `afterAll` hooks of integration test files.

### Fixture Lifecycle

| Scope | Fixture | Lifecycle |
|-------|---------|-----------|
| Per suite | Testcontainers PostgreSQL | `beforeAll` / `afterAll` in each integration test file |
| Per suite | Drizzle migration run | Once in `beforeAll`, after container starts |
| Per test | Environment variables | `beforeEach` saves, `afterEach` restores via `withEnv()` |
| Per test | Module registry | `vi.resetModules()` in `beforeEach` for config tests |
| Per test | stdout spy | `vi.spyOn()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach` |
| Per test | DB rows | Each test inserts its own data; `afterEach` cleans up inserted rows |

### Test Isolation

- **Config tests:** Each test gets a clean module registry (`vi.resetModules()`) and its own env var state. No config test depends on another.
- **Logger tests:** Each test gets a fresh stdout spy. Logger instances are created per-test.
- **Schema tests:** Read-only queries against the schema (information_schema, pg_indexes). The schema itself is idempotent — created once per suite.
- **Trigger tests (TS-3.4, TS-3.5):** Each test inserts its own row, updates it, and verifies. Rows are cleaned up after each test to avoid interference.
- **Health tests (unit):** Each test creates its own Hono app instance with injected checker stubs. No shared mutable state. No database or external services needed.
- **Migration retry tests (unit):** Uses mock functions and fake timers. No database or external services needed.
- **Settings override tests:** Each test manages its own settings rows (insert/delete). Tests truncate or restore the settings table in `afterEach`.

## Alignment Check

### Coverage Verification

| Test Scenario ID | Title | Test Function | Status |
|------------------|-------|---------------|--------|
| TS-1.1 | Missing DATABASE_URL fails startup | `it("fails startup when DATABASE_URL is missing")` | ✅ Mapped |
| TS-1.2 | Names all missing required vars | `it("fails startup naming all missing required variables")` | ✅ Mapped |
| TS-1.3 | All required vars → success | `it("loads successfully when all required env vars are present")` | ✅ Mapped |
| TS-1.4 | Optional defaults | `it("uses documented defaults for optional variables")` | ✅ Mapped |
| TS-1.5 | Optional overrides | `it("uses provided values for optional variables")` | ✅ Mapped |
| TS-1.6 | Settings override env var | `it("returns database setting when it overrides env var")` | ✅ Mapped |
| TS-1.7 | Env var when no setting | `it("returns env var when no database setting exists")` | ✅ Mapped |
| TS-1.8 | Typed config export | `it("exports a typed config object with all expected properties")` | ✅ Mapped |
| TS-2.1 | Required log fields | `it("includes timestamp, level, module, and message in log output")` | ✅ Mapped |
| TS-2.2 | Optional context | `it("includes context object when provided")` | ✅ Mapped |
| TS-2.3 | Four log levels | 4× `it("outputs level '...' for ...()")` | ✅ Mapped |
| TS-2.4 | Newline-delimited JSON | `it("produces newline-delimited JSON on stdout")` | ✅ Mapped |
| TS-3.1 | Entries table schema | `it("creates entries table with all columns and constraints")` | ✅ Mapped |
| TS-3.2 | Settings table schema | `it("creates settings table with correct schema")` | ✅ Mapped |
| TS-3.3 | Indexes | `it("creates HNSW, category, created_at, and GIN tags indexes")` | ✅ Mapped |
| TS-3.4 | Entries updated_at trigger | `it("auto-updates updated_at on entries row update")` | ✅ Mapped |
| TS-3.5 | Settings updated_at trigger | `it("auto-updates updated_at on settings row update")` | ✅ Mapped |
| TS-3.6 | Null category accepted | `it("accepts entry with null category")` | ✅ Mapped |
| TS-4.1 | Health JSON fields | `it("returns JSON with status, postgres, ollama, whisper, telegram, and uptime")` | ✅ Mapped |
| TS-4.2 | All connected → ok | `it("reports 'ok' when all services are connected")` | ✅ Mapped |
| TS-4.3 | No auth required | `it("is accessible without authentication")` | ✅ Mapped |
| TS-4.4 | Postgres down → degraded | `it("reports 'degraded' when PostgreSQL is unreachable")` | ✅ Mapped |
| TS-4.5 | Ollama down → still ok | `it("reports 'ok' when Ollama is unreachable but Postgres is connected")` | ✅ Mapped |
| TS-EC-1 | Malformed URL error | `it("fails startup with clear error for malformed DATABASE_URL")` | ✅ Mapped |
| TS-EC-2 | Migration retry | `it("retries migrations with backoff until Postgres becomes available")` | ✅ Mapped |
| TS-EC-3 | Unknown key ignored | `it("ignores unrecognized keys in settings table")` | ✅ Mapped |
| TS-EC-4 | Unreachable services | `it("reports disconnected services without error")` | ✅ Mapped |
| TS-EC-5 | Empty settings fallback | `it("falls back to env vars when settings table is empty")` | ✅ Mapped |
| TS-EC-6 | Special chars in URL | `it("connects successfully with special characters in DATABASE_URL password")` | ✅ Mapped |

### Result

**Full alignment.** All 26 test scenarios (including TS-2.3 which expands to 4 sub-tests for each log level) are mapped to concrete test functions with setup, action, and assertion strategies defined. Every test can run in isolation. Every test will fail before the feature code exists.

### Design Concerns

None. All tests verify observable behavior (exported config values, stdout output, database state, HTTP responses). No test requires knowledge of private methods or internal data structures.

### Initial Failure Verification

All tests will fail before implementation because:

- **Config tests:** `src/config.ts` does not exist → dynamic import will fail with a module-not-found error.
- **Logger tests:** `src/logger.ts` does not exist → import will fail.
- **Schema tests:** No Drizzle schema or migrations exist → no tables will be created.
- **Health tests:** No Hono app or health route exists → `app.request()` will fail.
- **Migration retry tests:** No retry wrapper function exists → import will fail.
- **DB URL tests:** No connection logic exists → import will fail.
