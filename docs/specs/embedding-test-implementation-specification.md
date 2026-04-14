# Embedding - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Embedding |
| Phase | 3 — Test Implementation Specification |
| Date | 2026-03-03 |
| Status | Draft |
| Derives from | `docs/specs/embedding-test-specification.md` |

## Test Framework & Conventions

| Aspect | Choice |
|--------|--------|
| Language | TypeScript |
| Test framework | Vitest |
| Assertion style | `expect()` from Vitest |
| Mocking | `vi.spyOn(globalThis, 'fetch')`, `vi.fn()`, `vi.spyOn(process.stdout, 'write')` |
| Integration DB | `@testcontainers/postgresql` with `pgvector/pgvector:pg16` image |
| HTTP mocking | Mock `globalThis.fetch` — no external mock server needed |

**Conventions** (same as foundation):
- `describe` blocks group by user story / functional area
- `it` blocks describe the behavior, not the implementation
- One assertion theme per `it` block (one test scenario → one test function)
- Test names read as sentences: `it("returns a 4096-dimensional float array for text input")`
- Explicit imports: `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`

## Test Structure

```
tests/
├── unit/
│   └── embed.test.ts                # TS-1.1–1.5, TS-2.1–2.4, TS-C-1, TS-C-3,
│                                    # TS-EC-1, TS-EC-2, TS-EC-4, TS-EC-5, TS-EC-7
├── integration/
│   └── embed-integration.test.ts    # TS-3.1–3.4, TS-C-2, TS-EC-3, TS-EC-6,
│                                    # TS-EC-8, TS-NG-1, TS-NG-2
└── helpers/
    ├── env.ts                       # (existing) Env var manipulation
    ├── test-db.ts                   # (existing) Testcontainers setup/teardown
    └── mock-ollama.ts               # (new) Ollama HTTP mock helpers
```

**Unit vs integration split:**
- **Unit tests** (`embed.test.ts`): Test the embedding module's logic in isolation. Ollama HTTP calls are mocked via `globalThis.fetch`. No database needed. 16 scenarios.
- **Integration tests** (`embed-integration.test.ts`): Test the embedding + database flow. Testcontainers PostgreSQL for real DB operations, Ollama still mocked via `globalThis.fetch`. 10 scenarios.

## Test Scenario Mapping

### Unit Tests — Embedding (`tests/unit/embed.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-1.1 | `it("returns a 4096-dimensional float array for text input")` | `embed.test.ts` |
| TS-1.2 | `it("generates a valid embedding for English text")` | `embed.test.ts` |
| TS-1.3 | `it("generates a valid embedding for German text")` | `embed.test.ts` |
| TS-1.4 | `it("generates a valid embedding for mixed English/German text")` | `embed.test.ts` |
| TS-1.5 | `it("concatenates entry name and content as embedding input")` | `embed.test.ts` |
| TS-2.1 | `it("checks Ollama model list on initialization")` | `embed.test.ts` |
| TS-2.2 | `it("pulls the model when it is missing from Ollama")` | `embed.test.ts` |
| TS-2.3 | `it("skips model pull when model is already present")` | `embed.test.ts` |
| TS-2.4 | `it("logs a warning and completes initialization when Ollama is unreachable")` | `embed.test.ts` |
| TS-C-1 | `it("uses the configured Ollama URL for requests")` | `embed.test.ts` |
| TS-C-3 | `it("times out embedding requests after 30 seconds")` | `embed.test.ts` |
| TS-EC-1 | `it("returns a valid embedding for single-word input")` | `embed.test.ts` |
| TS-EC-2 | `it("truncates text exceeding the token limit at a word boundary")` | `embed.test.ts` |
| TS-EC-4 | `it("skips embedding and logs a warning for empty input")` | `embed.test.ts` |
| TS-EC-5 | `it("passes special characters and emojis to Ollama without modification")` | `embed.test.ts` |
| TS-EC-7 | `it("rejects an embedding with incorrect dimensions")` | `embed.test.ts` |

---

**TS-1.1: Returns a 4096-dimensional float array for text input**

- **Setup (Given):** Mock `globalThis.fetch` to return a successful `/api/embed` response containing a 4096-element float array (`mockOllamaEmbed()`).
- **Action (When):** Call the embedding generation function with `"This is a test sentence"`.
- **Assertion (Then):** The returned array has exactly 4096 elements. Every element is a finite number (`Number.isFinite()`).
- **Teardown:** Restore fetch mock.

**TS-1.2: Generates a valid embedding for English text**

- **Setup (Given):** Mock fetch with a successful `/api/embed` response.
- **Action (When):** Call the embedding function with `"Meeting notes from the product review"`.
- **Assertion (Then):** The result is a 4096-element float array. Verify fetch was called with the expected text in the request body.
- **Teardown:** Restore fetch.

**TS-1.3: Generates a valid embedding for German text**

- **Setup (Given):** Mock fetch with a successful `/api/embed` response.
- **Action (When):** Call the embedding function with `"Besprechungsnotizen aus der Produktbewertung"`.
- **Assertion (Then):** The result is a 4096-element float array. Verify fetch was called with the German text in the request body.
- **Teardown:** Restore fetch.

**TS-1.4: Generates a valid embedding for mixed English/German text**

- **Setup (Given):** Mock fetch with a successful `/api/embed` response.
- **Action (When):** Call the embedding function with `"Meeting about the Projektzeitplan and next steps"`.
- **Assertion (Then):** The result is a 4096-element float array.
- **Teardown:** Restore fetch.

**TS-1.5: Concatenates entry name and content as embedding input**

- **Setup (Given):** Mock fetch with a successful `/api/embed` response. Capture the request body sent to fetch.
- **Action (When):** Call the entry embedding preparation function with `{ name: "Weekly Standup", content: "Discussed blockers and sprint goals" }`.
- **Assertion (Then):** The text sent in the fetch request body contains both `"Weekly Standup"` and `"Discussed blockers and sprint goals"` concatenated. The model parameter in the request body is `"qwen3-embedding"`.
- **Teardown:** Restore fetch.

**TS-2.1: Checks Ollama model list on initialization**

- **Setup (Given):** Mock fetch to return a `/api/tags` response with `qwen3-embedding` in the model list.
- **Action (When):** Call the embedding service initialization function.
- **Assertion (Then):** Fetch was called with a URL ending in `/api/tags`. Initialization completes without error.
- **Teardown:** Restore fetch.

**TS-2.2: Pulls the model when it is missing from Ollama**

- **Setup (Given):** Mock fetch to return: (1) `/api/tags` with an empty model list, then (2) `/api/pull` success response.
- **Action (When):** Call the initialization function.
- **Assertion (Then):** Fetch was called with `/api/tags` first, then `/api/pull` with body containing `"qwen3-embedding"`. Initialization completes successfully.
- **Teardown:** Restore fetch.

**TS-2.3: Skips model pull when model is already present**

- **Setup (Given):** Mock fetch to return `/api/tags` with `qwen3-embedding` in the list.
- **Action (When):** Call the initialization function.
- **Assertion (Then):** Fetch was called exactly once (only the `/api/tags` call). No `/api/pull` call was made.
- **Teardown:** Restore fetch.

**TS-2.4: Logs a warning and completes initialization when Ollama is unreachable**

- **Setup (Given):** Mock fetch to throw a connection error (e.g., `new TypeError("fetch failed")`). Spy on `process.stdout.write` to capture log output.
- **Action (When):** Call the initialization function.
- **Assertion (Then):** No error is thrown. Stdout contains a JSON log entry with `level: "warn"` and a message indicating Ollama is unreachable.
- **Teardown:** Restore fetch and stdout spy.

**TS-C-1: Uses the configured Ollama URL for requests**

- **Setup (Given):** Mock fetch. Set `OLLAMA_URL` to `"http://custom-ollama:11434"` via env var.
- **Action (When):** Call the embedding function with any text.
- **Assertion (Then):** The fetch call was made to a URL starting with `"http://custom-ollama:11434"`.
- **Teardown:** Restore fetch and env.

**TS-C-3: Times out embedding requests after 30 seconds**

- **Setup (Given):** Mock fetch with a delayed response using `vi.useFakeTimers()`. The mock returns a promise that never resolves (or resolves after 60 seconds).
- **Action (When):** Call the embedding function. Advance fake timers past 30 seconds.
- **Assertion (Then):** The embedding function rejects with a timeout-related error. No unhandled promise rejection.
- **Teardown:** Restore real timers and fetch.

**TS-EC-1: Returns a valid embedding for single-word input**

- **Setup (Given):** Mock fetch with a successful embed response.
- **Action (When):** Call the embedding function with `"Hello"`.
- **Assertion (Then):** A 4096-element float array is returned. No error was thrown.
- **Teardown:** Restore fetch.

**TS-EC-2: Truncates text exceeding the token limit at a word boundary**

- **Setup (Given):** Create a very long text string (e.g., repeat a paragraph many times to exceed ~32,000 characters — a conservative proxy for 8192 tokens). Mock fetch with a successful embed response. Capture the request body.
- **Action (When):** Call the embedding function (or the input preparation function) with the long text.
- **Assertion (Then):** The text sent to Ollama is shorter than the original. The truncated text does not end in the middle of a word (i.e., the last character is a space or the text ends at a word boundary). A valid embedding is returned.
- **Teardown:** Restore fetch.

**TS-EC-4: Skips embedding and logs a warning for empty input**

- **Setup (Given):** Spy on `process.stdout.write` to capture log output.
- **Action (When):** Call the entry embedding preparation function with `{ name: "", content: null }`.
- **Assertion (Then):** The function returns `null` (no embedding generated). No fetch call was made. Stdout contains a JSON log entry with `level: "warn"` indicating embedding was skipped.
- **Teardown:** Restore stdout spy.

**TS-EC-5: Passes special characters and emojis to Ollama without modification**

- **Setup (Given):** Mock fetch with a successful embed response. Capture the request body.
- **Action (When):** Call the embedding function with `"Notizen 📝 über das Projekt — café ☕"`.
- **Assertion (Then):** The text in the fetch request body is exactly `"Notizen 📝 über das Projekt — café ☕"` (not stripped, escaped, or modified). A valid embedding is returned.
- **Teardown:** Restore fetch.

**TS-EC-7: Rejects an embedding with incorrect dimensions**

- **Setup (Given):** Mock fetch to return a `/api/embed` response with a 512-element array instead of 4096. Spy on stdout for log capture.
- **Action (When):** Call the embedding function.
- **Assertion (Then):** The function returns `null` (embedding rejected). Stdout contains a JSON log entry with `level: "error"` mentioning expected 4096 and got 512.
- **Teardown:** Restore fetch and stdout spy.

---

### Integration Tests — Embedding + Database (`tests/integration/embed-integration.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-3.1 | `it("stores entry with null embedding when Ollama is unavailable")` | `embed-integration.test.ts` |
| TS-3.2 | `it("finds only entries with null embeddings for retry")` | `embed-integration.test.ts` |
| TS-3.3 | `it("generates and stores embedding on retry")` | `embed-integration.test.ts` |
| TS-3.4 | `it("logs error and leaves embedding null on retry failure")` | `embed-integration.test.ts` |
| TS-C-2 | `it("uses Ollama URL from settings table over env var")` | `embed-integration.test.ts` |
| TS-EC-3 | `it("handles model deletion by logging error and storing null embedding")` | `embed-integration.test.ts` |
| TS-EC-6 | `it("retries entries sequentially in created_at order")` | `embed-integration.test.ts` |
| TS-EC-8 | `it("re-pulls missing model during retry")` | `embed-integration.test.ts` |
| TS-NG-1 | `it("regenerates embedding when entry content is updated")` | `embed-integration.test.ts` |
| TS-NG-2 | `it("makes separate embedding requests for identical text")` | `embed-integration.test.ts` |

All integration tests share a single testcontainers PostgreSQL instance (started in `beforeAll`, stopped in `afterAll`). Migrations run once. Ollama is mocked via `globalThis.fetch` in each test. Entry rows are cleaned up in `afterEach`.

---

**TS-3.1: Stores entry with null embedding when Ollama is unavailable**

- **Setup (Given):** Testcontainers PostgreSQL running with migrations. Mock fetch to throw a connection error for Ollama.
- **Action (When):** Insert an entry through the application's entry creation flow (or call the function that creates an entry and attempts embedding), with `name: "Test"` and `content: "Some content"`.
- **Assertion (Then):** Query the entries table. The row exists with the correct name and content. The `embedding` column is null.
- **Teardown:** Delete the test entry. Restore fetch.

**TS-3.2: Finds only entries with null embeddings for retry**

- **Setup (Given):** Insert three entries directly via SQL. Two with `embedding: null`, one with a valid 4096-dim embedding vector (use `createFakeEmbedding()` helper). Mock fetch with successful embed responses.
- **Action (When):** Call the retry job function.
- **Assertion (Then):** Fetch was called exactly twice (once per null-embedding entry). The entry with the existing embedding was not processed.
- **Teardown:** Delete all test entries. Restore fetch.

**TS-3.3: Generates and stores embedding on retry**

- **Setup (Given):** Insert an entry with `embedding: null` directly via SQL. Mock fetch to return a successful embed response with a known 4096-dim vector.
- **Action (When):** Call the retry job function.
- **Assertion (Then):** Re-select the entry from the database. The `embedding` column is no longer null. The stored vector has 4096 dimensions.
- **Teardown:** Delete the test entry. Restore fetch.

**TS-3.4: Logs error and leaves embedding null on retry failure**

- **Setup (Given):** Insert an entry with `embedding: null`. Record its ID. Mock fetch to return a 500 error for `/api/embed`. Spy on stdout for log capture.
- **Action (When):** Call the retry job function.
- **Assertion (Then):** Stdout contains a JSON log entry with `level: "error"` containing the entry's ID and an error description. Re-select the entry — its `embedding` is still null.
- **Teardown:** Delete the test entry. Restore fetch and stdout spy.

**TS-C-2: Uses Ollama URL from settings table over env var**

- **Setup (Given):** Set `OLLAMA_URL` env var to `"http://env-ollama:11434"`. Insert a settings row with `key: "ollama_url"`, `value: "http://db-ollama:11434"`. Mock fetch, capturing the request URL.
- **Action (When):** Call the embedding function through a path that resolves the URL via `resolveConfigValue`.
- **Assertion (Then):** The fetch call was made to a URL starting with `"http://db-ollama:11434"`, not `"http://env-ollama:11434"`.
- **Teardown:** Delete the settings row. Restore env and fetch.

**TS-EC-3: Handles model deletion by logging error and storing null embedding**

- **Setup (Given):** Mock fetch to return a model-not-found error for `/api/embed` (simulating a deleted model). Insert an entry via the creation flow. Spy on stdout.
- **Action (When):** The entry creation flow attempts to generate an embedding.
- **Assertion (Then):** Stdout contains an error log. The entry is stored in the database with `embedding: null`.
- **Teardown:** Delete the test entry. Restore fetch and stdout spy.

**TS-EC-6: Retries entries sequentially in created_at order**

- **Setup (Given):** Insert three entries with `embedding: null` and staggered `created_at` timestamps (e.g., entry A at T-3min, entry B at T-2min, entry C at T-1min). Mock fetch to return successful embed responses. Use a `vi.fn()` wrapper or capture call order to track which entry was processed when.
- **Action (When):** Call the retry job function.
- **Assertion (Then):** The request body texts sent to fetch correspond to entry A first, then B, then C (in `created_at` ascending order). Verify via the sequence of captured fetch calls. The calls were made sequentially (not concurrently) — each fetch call started after the previous completed.
- **Teardown:** Delete test entries. Restore fetch.

**TS-EC-8: Re-pulls missing model during retry**

- **Setup (Given):** Insert an entry with `embedding: null`. Mock fetch to: (1) return `/api/tags` with an empty model list (model missing), (2) return `/api/pull` success, (3) return a successful embed response.
- **Action (When):** Call the retry job function.
- **Assertion (Then):** Fetch was called for `/api/tags` (model check), then `/api/pull` (model pull), then `/api/embed` (embedding generation). The entry's embedding is updated in the database.
- **Teardown:** Delete the test entry. Restore fetch.

**TS-NG-1: Regenerates embedding when entry content is updated**

- **Setup (Given):** Insert an entry with a known embedding (use `createFakeEmbedding()` and store via SQL). Record the original embedding. Mock fetch to return a different 4096-dim vector for the new content.
- **Action (When):** Update the entry's content to new text through the application's update flow.
- **Assertion (Then):** The entry's embedding in the database differs from the original. Fetch was called with the new content text.
- **Teardown:** Delete the test entry. Restore fetch.

**TS-NG-2: Makes separate embedding requests for identical text**

- **Setup (Given):** Mock fetch to return successful embed responses. Track the number of fetch calls.
- **Action (When):** Create two entries with identical `name: "Same"` and `content: "Identical content"` through the application's creation flow.
- **Assertion (Then):** Fetch was called twice for `/api/embed` (once per entry). Both entries exist in the database, each with its own non-null embedding.
- **Teardown:** Delete test entries. Restore fetch.

## Fixtures & Test Data

### New Helper: Mock Ollama (`tests/helpers/mock-ollama.ts`)

```typescript
// Generate a deterministic fake embedding vector
export function createFakeEmbedding(dim?: number): number[];

// Mock fetch for successful /api/embed — returns a 4096-dim vector
export function mockOllamaEmbed(fetchSpy: vi.SpyInstance, embedding?: number[]): void;

// Mock fetch for /api/tags — returns specified model names
export function mockOllamaTags(fetchSpy: vi.SpyInstance, models: string[]): void;

// Mock fetch for Ollama unreachable — throws connection error
export function mockOllamaUnreachable(fetchSpy: vi.SpyInstance): void;

// Mock fetch with a URL-based router for complex scenarios (startup, retry)
export function createOllamaRouter(options: {
  models?: string[];
  embedResult?: number[] | 'error' | 'timeout';
  pullResult?: 'success' | 'error';
}): (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
```

**`createFakeEmbedding(dim = 4096)`:** Returns an array of `dim` floats. Uses a seeded/deterministic approach (e.g., `Array.from({ length: dim }, (_, i) => Math.sin(i) * 0.5)`) so tests are reproducible.

**`createOllamaRouter(options)`:** Returns a function suitable for `vi.spyOn(globalThis, 'fetch').mockImplementation(router)`. Routes by URL suffix:
- `/api/tags` → returns `{ models: options.models.map(name => ({ name })) }`
- `/api/embed` → returns `{ embeddings: [options.embedResult] }` or throws
- `/api/pull` → returns success or error
- Any other URL → passes through (or throws)

This router pattern is used by integration tests that need multiple Ollama API endpoints in a single test.

### Existing Helpers (reused from foundation)

- **`tests/helpers/env.ts`** — `withEnv()`, `setRequiredEnvVars()`, `clearAllConfigEnvVars()` for env var manipulation in TS-C-1, TS-C-2.
- **`tests/helpers/test-db.ts`** — `startTestDb()`, `runMigrations()` for testcontainers PostgreSQL in all integration tests.

### Test Data Factories

**Entry factory (inline in integration tests):**

```typescript
async function insertEntry(sql: postgres.Sql, overrides?: {
  name?: string;
  content?: string | null;
  embedding?: number[] | null;
  createdAt?: Date;
}): Promise<{ id: string; name: string; content: string | null; embedding: number[] | null }>;
```

Inserts a minimal valid entry (required fields: `name`, `source: 'webapp'`) with optional overrides. Returns the inserted row for assertions. Used across all integration tests.

**Settings row helpers (inline in integration tests):**

```typescript
// Insert a setting and return cleanup function
async function insertSetting(sql: postgres.Sql, key: string, value: string): Promise<void>;
```

### Fixture Lifecycle

| Scope | Fixture | Lifecycle |
|-------|---------|-----------|
| Per suite | Testcontainers PostgreSQL | `beforeAll` / `afterAll` in integration test file |
| Per suite | Drizzle migration run | Once in `beforeAll`, after container starts |
| Per test | `globalThis.fetch` spy | `vi.spyOn()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach` |
| Per test | `process.stdout.write` spy | `vi.spyOn()` where needed, restored in `afterEach` |
| Per test | Environment variables | `withEnv()` save/restore in tests that modify env |
| Per test | DB rows (entries, settings) | Each test inserts its own data; `afterEach` deletes by test-specific markers |
| Per test | Module registry | `vi.resetModules()` in `beforeEach` for tests that need fresh module state |

### Test Isolation

- **Unit tests:** Each test gets a fresh fetch mock. No shared state between tests. Logger spy is restored per test.
- **Integration tests:** Shared DB container, but each test manages its own rows. Tests insert entries with unique names/IDs and clean up in `afterEach`. No test depends on another test's data.
- **Fetch mocking:** `vi.restoreAllMocks()` in `afterEach` ensures no fetch mock leaks between tests.
- **Env vars:** Tests using `withEnv()` restore original values in `afterEach`.

## Alignment Check

### Coverage Verification

| Test Scenario ID | Title | Test Function | Status |
|------------------|-------|---------------|--------|
| TS-1.1 | 4096-dim float array | `it("returns a 4096-dimensional float array for text input")` | ✅ Mapped |
| TS-1.2 | English text | `it("generates a valid embedding for English text")` | ✅ Mapped |
| TS-1.3 | German text | `it("generates a valid embedding for German text")` | ✅ Mapped |
| TS-1.4 | Mixed EN/DE text | `it("generates a valid embedding for mixed English/German text")` | ✅ Mapped |
| TS-1.5 | Concatenate name + content | `it("concatenates entry name and content as embedding input")` | ✅ Mapped |
| TS-2.1 | Startup checks model list | `it("checks Ollama model list on initialization")` | ✅ Mapped |
| TS-2.2 | Startup pulls missing model | `it("pulls the model when it is missing from Ollama")` | ✅ Mapped |
| TS-2.3 | Startup skips present model | `it("skips model pull when model is already present")` | ✅ Mapped |
| TS-2.4 | Unreachable → warn, no crash | `it("logs a warning and completes initialization when Ollama is unreachable")` | ✅ Mapped |
| TS-3.1 | Failed → null embedding | `it("stores entry with null embedding when Ollama is unavailable")` | ✅ Mapped |
| TS-3.2 | Retry finds null entries | `it("finds only entries with null embeddings for retry")` | ✅ Mapped |
| TS-3.3 | Retry generates + stores | `it("generates and stores embedding on retry")` | ✅ Mapped |
| TS-3.4 | Retry failure → log, null | `it("logs error and leaves embedding null on retry failure")` | ✅ Mapped |
| TS-C-1 | Configured Ollama URL | `it("uses the configured Ollama URL for requests")` | ✅ Mapped |
| TS-C-2 | Settings overrides env URL | `it("uses Ollama URL from settings table over env var")` | ✅ Mapped |
| TS-C-3 | 30-second timeout | `it("times out embedding requests after 30 seconds")` | ✅ Mapped |
| TS-EC-1 | Short text → valid | `it("returns a valid embedding for single-word input")` | ✅ Mapped |
| TS-EC-2 | Long text truncation | `it("truncates text exceeding the token limit at a word boundary")` | ✅ Mapped |
| TS-EC-3 | Model deleted → error | `it("handles model deletion by logging error and storing null embedding")` | ✅ Mapped |
| TS-EC-4 | Empty input → skip | `it("skips embedding and logs a warning for empty input")` | ✅ Mapped |
| TS-EC-5 | Special chars passed through | `it("passes special characters and emojis to Ollama without modification")` | ✅ Mapped |
| TS-EC-6 | Retry order oldest-first | `it("retries entries sequentially in created_at order")` | ✅ Mapped |
| TS-EC-7 | Wrong dimensions rejected | `it("rejects an embedding with incorrect dimensions")` | ✅ Mapped |
| TS-EC-8 | Retry re-pulls missing model | `it("re-pulls missing model during retry")` | ✅ Mapped |
| TS-NG-1 | Re-embed on content update | `it("regenerates embedding when entry content is updated")` | ✅ Mapped |
| TS-NG-2 | No caching, separate requests | `it("makes separate embedding requests for identical text")` | ✅ Mapped |

### Result

**Full alignment.** All 26 test scenarios are mapped to concrete test functions with setup, action, and assertion strategies defined. Every test can run in isolation. Every test will fail before the feature code exists.

### Design Concerns

None. All tests verify observable behavior:
- **Unit tests:** Assert on return values (embedding arrays, null), fetch call arguments (URL, request body), and log output (stdout JSON).
- **Integration tests:** Assert on database state (embedding column values, row counts) and fetch call patterns (count, order, arguments).

No test requires knowledge of private methods or internal data structures.

### Initial Failure Verification

All tests will fail before implementation because:

- **Unit tests (`embed.test.ts`):** The embedding module (`src/embed.ts`) does not exist → dynamic import will fail with a module-not-found error.
- **Integration tests (`embed-integration.test.ts`):** Even with the DB available, there is no embedding service, retry job, or entry creation flow → imports will fail or functions won't exist.
- **Mock helper (`mock-ollama.ts`):** This is test infrastructure only. It doesn't depend on feature code and can be created first.
