# Foundation - Test Specification

| Field | Value |
|-------|-------|
| Feature | Foundation |
| Phase | 2 — Test Specification |
| Date | 2026-03-03 |
| Status | Draft |
| Derives from | `docs/specs/foundation-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: Required env vars fail on missing | TS-1.1, TS-1.2, TS-1.3 |
| AC-1.2: Optional env vars have defaults | TS-1.4, TS-1.5 |
| AC-1.3: Settings table overrides env vars | TS-1.6, TS-1.7 |
| AC-1.4: Config exported as typed object | TS-1.8 |
| AC-2.1: Log entries have required fields | TS-2.1, TS-2.2, TS-2.3 |
| AC-2.2: Log output to stdout as JSON | TS-2.4 |
| AC-3.1: Entries table created with all columns | TS-3.1 |
| AC-3.2: Settings table created | TS-3.2 |
| AC-3.3: Indexes created (HNSW, category, created_at, GIN tags) | TS-3.3 |
| AC-3.4: updated_at trigger fires on update | TS-3.4, TS-3.5 |
| AC-3.5: Category column allows NULL | TS-3.6 |
| AC-4.1: Health returns JSON with service status | TS-4.1, TS-4.2 |
| AC-4.2: Health endpoint requires no auth | TS-4.3 |
| AC-4.3: Postgres disconnected → status degraded | TS-4.4, TS-4.5 |
| EC-1: Malformed DATABASE_URL | TS-EC-1 |
| EC-2: Postgres not ready on startup | TS-EC-2 |
| EC-3: Unrecognized settings key ignored | TS-EC-3 |
| EC-4: Ollama/whisper unreachable at health check | TS-EC-4 |
| EC-5: Empty settings table → env var fallback | TS-EC-5 |
| EC-6: Special characters in DATABASE_URL password | TS-EC-6 |

## Test Scenarios

### US-1: Configuration Loading & Validation

**TS-1.1: Startup fails when a required env var is missing**
```
Scenario: Startup fails when DATABASE_URL is missing
  Given all required environment variables are set except DATABASE_URL
  When the configuration module loads
  Then startup fails with an error message containing "DATABASE_URL"
```

**TS-1.2: Startup fails naming all missing required vars**
```
Scenario: Startup fails naming all missing required variables
  Given LLM_API_KEY and SESSION_SECRET are not set
  And all other required environment variables are set
  When the configuration module loads
  Then startup fails with an error message containing "LLM_API_KEY"
  And the error message contains "SESSION_SECRET"
```

**TS-1.3: Startup succeeds when all required env vars are present**
```
Scenario: Configuration loads successfully with all required variables
  Given all required environment variables are set (DATABASE_URL, LLM_API_KEY, TELEGRAM_BOT_TOKEN, WEBAPP_PASSWORD, SESSION_SECRET)
  When the configuration module loads
  Then the configuration object is returned without error
```

**TS-1.4: Optional env vars use defaults when not set**
```
Scenario: Optional variables use documented defaults
  Given all required environment variables are set
  And PORT is not set
  And OLLAMA_MODEL is not set
  And TZ is not set
  And LLM_PROVIDER is not set
  And LLM_MODEL is not set
  And DAILY_DIGEST_CRON is not set
  And WEEKLY_DIGEST_CRON is not set
  When the configuration module loads
  Then config.port is 3000
  And config.ollamaModel is "qwen3-embedding"
  And config.timezone is "Europe/Berlin"
  And config.llmProvider is "anthropic"
  And config.llmModel is "claude-sonnet-4-20250514"
  And config.dailyDigestCron is "30 7 * * *"
  And config.weeklyDigestCron is "0 16 * * 0"
```

**TS-1.5: Optional env vars are used when explicitly set**
```
Scenario: Optional variables use provided values
  Given all required environment variables are set
  And PORT is set to "4000"
  And LLM_PROVIDER is set to "openai-compatible"
  And LLM_MODEL is set to "gpt-4o"
  And LLM_BASE_URL is set to "http://localhost:1234/v1"
  When the configuration module loads
  Then config.port is 4000
  And config.llmProvider is "openai-compatible"
  And config.llmModel is "gpt-4o"
  And config.llmBaseUrl is "http://localhost:1234/v1"
```

**TS-1.6: Settings table value overrides env var**
```
Scenario: Database setting overrides environment variable
  Given the environment variable LLM_MODEL is set to "env-model"
  And the settings table contains key "llm_model" with value "db-model"
  When the configuration is resolved for "llm_model"
  Then the resolved value is "db-model"
```

**TS-1.7: Env var used when settings table has no override**
```
Scenario: Environment variable used when no database setting exists
  Given the environment variable LLM_MODEL is set to "env-model"
  And the settings table does not contain key "llm_model"
  When the configuration is resolved for "llm_model"
  Then the resolved value is "env-model"
```

**TS-1.8: Config is a typed exportable object**
```
Scenario: Configuration is exported as a typed object
  Given all required environment variables are set
  When the configuration module is imported
  Then it exports a config object with typed properties
  And the config object includes: databaseUrl, llmProvider, llmApiKey, llmModel, llmBaseUrl, telegramBotToken, webappPassword, sessionSecret, port, ollamaModel, timezone, dailyDigestCron, weeklyDigestCron
```

### US-2: Structured JSON Logging

**TS-2.1: Log entry contains all required fields**
```
Scenario: Log entry includes timestamp, level, module, and message
  Given the logger is initialized for module "test-module"
  When a log entry is written at level "info" with message "test message"
  Then the output contains a JSON object with field "timestamp" in ISO 8601 format
  And the JSON object has field "level" with value "info"
  And the JSON object has field "module" with value "test-module"
  And the JSON object has field "message" with value "test message"
```

**TS-2.2: Log entry includes optional context**
```
Scenario: Log entry includes context when provided
  Given the logger is initialized for module "test-module"
  When a log entry is written at level "error" with message "failed" and context { "code": 500, "detail": "timeout" }
  Then the output JSON object has field "context" containing { "code": 500, "detail": "timeout" }
```

**TS-2.3: All four log levels produce output**
```
Scenario: Each log level produces correctly labeled output
  Given the logger is initialized for module "test-module"
  When a log entry is written at level "debug"
  Then the output JSON has "level" set to "debug"

Scenario: Info level log
  Given the logger is initialized for module "test-module"
  When a log entry is written at level "info"
  Then the output JSON has "level" set to "info"

Scenario: Warn level log
  Given the logger is initialized for module "test-module"
  When a log entry is written at level "warn"
  Then the output JSON has "level" set to "warn"

Scenario: Error level log
  Given the logger is initialized for module "test-module"
  When a log entry is written at level "error"
  Then the output JSON has "level" set to "error"
```

**TS-2.4: Log output is newline-delimited JSON to stdout**
```
Scenario: Multiple log entries produce newline-delimited JSON
  Given the logger is initialized
  When two log entries are written
  Then stdout contains two lines
  And each line is valid JSON
```

### US-3: Database Schema & Migrations

**TS-3.1: Entries table is created with all columns**
```
Scenario: Migrations create the entries table with correct schema
  Given a fresh PostgreSQL database with pgvector extension available
  When Drizzle migrations run
  Then the "entries" table exists
  And it has columns: id (uuid), category (text, nullable), name (text, not null), content (text), fields (jsonb), tags (text[]), confidence (real), source (text, not null), source_type (text), embedding (vector(4096)), deleted_at (timestamptz), created_at (timestamptz), updated_at (timestamptz)
  And the category column has a CHECK constraint allowing only 'people', 'projects', 'tasks', 'ideas', 'reference', and NULL
  And the source column has a CHECK constraint allowing only 'telegram', 'webapp', 'mcp'
  And the source_type column has a CHECK constraint allowing only 'text', 'voice'
```

**TS-3.2: Settings table is created**
```
Scenario: Migrations create the settings table
  Given a fresh PostgreSQL database
  When Drizzle migrations run
  Then the "settings" table exists
  And it has columns: key (text, primary key), value (text, not null), updated_at (timestamptz)
```

**TS-3.3: All indexes are created**
```
Scenario: Required indexes are created on the entries table
  Given a fresh PostgreSQL database with pgvector extension available
  When Drizzle migrations run
  Then an HNSW index exists on the embedding column with vector_cosine_ops
  And an index exists on the category column
  And an index exists on the created_at column
  And a GIN index exists on the tags column
```

**TS-3.4: updated_at trigger fires on entries update**
```
Scenario: Updating an entry automatically updates its updated_at timestamp
  Given an entry exists with a known updated_at value
  When the entry's name is changed
  Then the entry's updated_at is later than the original value
```

**TS-3.5: updated_at trigger fires on settings update**
```
Scenario: Updating a setting automatically updates its updated_at timestamp
  Given a setting exists with key "test_key" and a known updated_at value
  When the setting's value is changed
  Then the setting's updated_at is later than the original value
```

**TS-3.6: Entry can be inserted with null category**
```
Scenario: Entry with null category is accepted
  Given the entries table exists
  When an entry is inserted with category set to NULL and all other required fields present
  Then the entry is stored successfully
  And the stored entry has category NULL
```

### US-4: Health Endpoint

**TS-4.1: Health endpoint returns all expected fields**
```
Scenario: Health endpoint returns complete status JSON
  Given the application is running
  And PostgreSQL is connected
  When GET /health is requested
  Then the response status is 200
  And the response body is JSON containing fields: status, postgres, ollama, whisper, telegram, uptime
  And uptime is a non-negative integer
```

**TS-4.2: Health endpoint reports "ok" when all services are connected**
```
Scenario: All services connected yields status "ok"
  Given the application is running
  And PostgreSQL is connected
  And Ollama is reachable
  And faster-whisper is reachable
  And the Telegram bot is polling
  When GET /health is requested
  Then the response JSON has status "ok"
  And postgres is "connected"
  And ollama is "connected"
  And whisper is "connected"
  And telegram is "polling"
```

**TS-4.3: Health endpoint requires no authentication**
```
Scenario: Health endpoint is accessible without authentication
  Given the application is running
  And no session cookie is provided
  When GET /health is requested
  Then the response status is 200
  And the response body is valid JSON
```

**TS-4.4: Postgres disconnected yields status "degraded"**
```
Scenario: Health reports degraded when PostgreSQL is unreachable
  Given the application is running
  And PostgreSQL is unreachable
  When GET /health is requested
  Then the response status is 200
  And the response JSON has status "degraded"
  And postgres is "disconnected"
```

**TS-4.5: Ollama disconnected does not degrade status**
```
Scenario: Health reports "ok" when Ollama is unreachable but Postgres is connected
  Given the application is running
  And PostgreSQL is connected
  And Ollama is unreachable
  When GET /health is requested
  Then the response JSON has status "ok"
  And ollama is "disconnected"
```

## Edge Case Scenarios

**TS-EC-1: Malformed DATABASE_URL produces clear error**
```
Scenario: Malformed database URL produces a descriptive error
  Given DATABASE_URL is set to "not-a-valid-url"
  And all other required environment variables are set
  When the configuration module loads
  Then startup fails with an error message indicating the database URL is malformed
```

**TS-EC-2: Migrations retry when Postgres is not yet ready**
```
Scenario: Migration runner retries on transient connection failure
  Given PostgreSQL becomes available after 5 seconds
  When the application starts and attempts to run migrations
  Then migrations retry with backoff until PostgreSQL is available
  And migrations complete successfully once the connection is established
```

**TS-EC-3: Unrecognized settings key is ignored**
```
Scenario: Unknown settings key does not cause errors
  Given the settings table contains a key "unknown_future_key" with value "something"
  When the configuration is resolved
  Then no error is raised
  And the unrecognized key is ignored
```

**TS-EC-4: Unreachable services at health check time**
```
Scenario: Health endpoint reports disconnected services without error
  Given the application is running
  And Ollama is unreachable
  And faster-whisper is unreachable
  And PostgreSQL is connected
  When GET /health is requested
  Then the response status is 200
  And ollama is "disconnected"
  And whisper is "disconnected"
  And status is "ok"
```

**TS-EC-5: Empty settings table falls back to env vars**
```
Scenario: All config values come from env vars when settings table is empty
  Given the settings table is empty
  And LLM_MODEL is set to "env-model"
  When the configuration is resolved for "llm_model"
  Then the resolved value is "env-model"
```

**TS-EC-6: DATABASE_URL with special characters in password**
```
Scenario: Database URL with special characters connects successfully
  Given DATABASE_URL contains a password with special characters (e.g., "p@ss%20word!")
  And the URL is properly percent-encoded
  When the database connection is established
  Then the connection succeeds without URL parsing errors
```

## Traceability

| Spec Requirement | Scenarios | Status |
|------------------|-----------|--------|
| AC-1.1 (required env vars) | TS-1.1, TS-1.2, TS-1.3 | ✅ Covered |
| AC-1.2 (optional defaults) | TS-1.4, TS-1.5 | ✅ Covered |
| AC-1.3 (settings override) | TS-1.6, TS-1.7 | ✅ Covered |
| AC-1.4 (typed config export) | TS-1.8 | ✅ Covered |
| AC-2.1 (log entry fields) | TS-2.1, TS-2.2, TS-2.3 | ✅ Covered |
| AC-2.2 (JSON to stdout) | TS-2.4 | ✅ Covered |
| AC-3.1 (entries table) | TS-3.1 | ✅ Covered |
| AC-3.2 (settings table) | TS-3.2 | ✅ Covered |
| AC-3.3 (indexes) | TS-3.3 | ✅ Covered |
| AC-3.4 (updated_at trigger) | TS-3.4, TS-3.5 | ✅ Covered |
| AC-3.5 (nullable category) | TS-3.6 | ✅ Covered |
| AC-4.1 (health JSON fields) | TS-4.1, TS-4.2 | ✅ Covered |
| AC-4.2 (no auth on health) | TS-4.3 | ✅ Covered |
| AC-4.3 (degraded status) | TS-4.4, TS-4.5 | ✅ Covered |
| EC-1 (malformed URL) | TS-EC-1 | ✅ Covered |
| EC-2 (retry on startup) | TS-EC-2 | ✅ Covered |
| EC-3 (unknown settings key) | TS-EC-3 | ✅ Covered |
| EC-4 (unreachable services) | TS-EC-4 | ✅ Covered |
| EC-5 (empty settings table) | TS-EC-5 | ✅ Covered |
| EC-6 (special chars in URL) | TS-EC-6 | ✅ Covered |

**Coverage gaps:** None. All acceptance criteria and edge cases have at least one test scenario.

**Orphan tests:** None. Every scenario traces to a spec requirement.
