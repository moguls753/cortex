# Classification - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Classification |
| Phase | 3 — Test Implementation Specification |
| Date | 2026-03-04 |
| Status | Draft |
| Derives from | `docs/specs/classification-test-specification.md` |

## Test Framework & Conventions

| Aspect | Choice |
|--------|--------|
| Language | TypeScript |
| Test framework | Vitest |
| Assertion style | `expect()` from Vitest |
| Mocking | `vi.mock()` for module mocking, `vi.fn()` for function mocks, `vi.spyOn(process.stdout, 'write')` for log capture |
| Integration DB | `@testcontainers/postgresql` with `pgvector/pgvector:pg16` image |
| LLM mocking | Mock `src/llm/index.ts` module via `vi.mock()` — no real API calls |
| Embedding mocking | Mock `generateEmbedding` from `src/embed.ts` via `vi.mock()` — no real Ollama calls |

**Conventions** (same as foundation and embedding):
- `describe` blocks group by user story / functional area
- `it` blocks describe the behavior, not the implementation
- One assertion theme per `it` block (one test scenario → one test function)
- Test names read as sentences: `it("rejects a response with an invalid category")`
- Explicit imports: `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`

## Test Structure

```
tests/
├── unit/
│   └── classify.test.ts               # TS-1.1–1.11, TS-2.8–2.10, TS-3.1, TS-3.3–3.5,
│                                       # TS-4.1–4.5, TS-4.9, TS-C-1,
│                                       # TS-EC-1–EC-4, TS-EC-6–EC-9
├── integration/
│   └── classify-integration.test.ts   # TS-2.1–2.7, TS-3.2, TS-4.6–4.8,
│                                       # TS-C-2, TS-C-3, TS-EC-5,
│                                       # TS-NG-1–TS-NG-3
└── helpers/
    ├── env.ts                         # (existing) Env var manipulation
    ├── test-db.ts                     # (existing) Testcontainers setup/teardown
    ├── mock-ollama.ts                 # (existing) Ollama HTTP mock helpers
    └── mock-llm.ts                    # (new) LLM provider mock helpers
```

**Unit vs integration split:**
- **Unit tests** (`classify.test.ts`): Test the classification module's pure functions and logic in isolation. LLM provider is mocked via `vi.mock()`. No database. 33 scenarios.
- **Integration tests** (`classify-integration.test.ts`): Test classification + database flow. Testcontainers PostgreSQL for real DB operations, LLM provider still mocked. 17 scenarios.

## New Helper: Mock LLM (`tests/helpers/mock-llm.ts`)

```typescript
import type { vi } from "vitest";

interface ClassificationResult {
  category: "people" | "projects" | "tasks" | "ideas" | "reference";
  name: string;
  confidence: number;
  fields: Record<string, unknown>;
  tags: string[];
  create_calendar_event: boolean;
  calendar_date: string | null;
}

/**
 * Create a valid classification result object with sensible defaults.
 * Override individual fields as needed.
 */
export function createClassificationResult(
  overrides?: Partial<ClassificationResult>,
): ClassificationResult;

/**
 * Create a valid JSON string response from the LLM.
 */
export function createClassificationJSON(
  overrides?: Partial<ClassificationResult>,
): string;

/**
 * Create a mock LLM chat function that returns the given response string.
 * Optionally simulates errors (timeout, 429, 500, network).
 */
export function createMockChat(
  response: string | Error | { status: number; message: string },
): (...args: unknown[]) => Promise<string>;
```

**Default classification result:**
```typescript
{
  category: "people",
  name: "Maria Coffee Chat",
  confidence: 0.92,
  fields: { relationship: "friend" },
  tags: ["social", "startup"],
  create_calendar_event: false,
  calendar_date: null,
}
```

This helper provides test data for the LLM response without requiring a real API call. The `createMockChat` function is used with `vi.mock()` to control what the LLM "returns."

## Mocking Strategy

### LLM Provider (`src/llm/index.ts`)

The classify module imports the LLM provider factory from `src/llm/index.ts`. Tests mock this module:

```typescript
vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));
```

Each test configures the mock `chat` function to return specific JSON strings (valid, invalid, truncated) or throw errors (timeout, network).

### Embedding (`src/embed.ts`)

Context-aware classification calls `generateEmbedding()` to embed the input text for similarity search. Tests mock this:

```typescript
vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn(),
}));
```

The mock returns a deterministic fake embedding (from `createFakeEmbedding()`) so cosine similarity queries in integration tests produce predictable results.

### Prompt Loading

The classify module reads `prompts/classify.md` at runtime. Unit tests mock the file system read (via `vi.mock("node:fs/promises")`) to return a known prompt template. Integration tests can use the same mock approach or provide a test fixture file.

### Log Capture

Same as embedding: `vi.spyOn(process.stdout, "write")` to capture structured JSON log output for assertions on error logging (TS-4.9, TS-EC-8, TS-EC-9).

## Test Scenario Mapping

### Unit Tests — Classification (`tests/unit/classify.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-1.1 | `it("sends classification request through the Anthropic provider")` | `classify.test.ts` |
| TS-1.2 | `it("sends classification request through the OpenAI-compatible provider")` | `classify.test.ts` |
| TS-1.3 | `it("uses the configured model for classification requests")` | `classify.test.ts` |
| TS-1.4 | `it("loads the classification prompt from prompts/classify.md")` | `classify.test.ts` |
| TS-1.5 | `it("parses a valid LLM response into a structured classification result")` | `classify.test.ts` |
| TS-1.6 | `it("rejects a response with an invalid category")` | `classify.test.ts` |
| TS-1.7 | `it("rejects a response with out-of-range confidence")` | `classify.test.ts` |
| TS-1.8 | `it("rejects a response with missing required fields")` | `classify.test.ts` |
| TS-1.9 | `it("rejects a response with wrong field types")` | `classify.test.ts` |
| TS-1.10 | `it("handles a non-JSON LLM response gracefully")` | `classify.test.ts` |
| TS-1.11 | `it("handles a truncated JSON LLM response gracefully")` | `classify.test.ts` |
| TS-2.8 | `it("replaces the context_entries placeholder in the prompt")` | `classify.test.ts` |
| TS-2.9 | `it("formats context entries with name, category, and truncated content")` | `classify.test.ts` |
| TS-2.10 | `it("includes full content when shorter than 200 characters")` | `classify.test.ts` |
| TS-3.1 | `it("defaults the confidence threshold to 0.6")` | `classify.test.ts` |
| TS-3.3 | `it("marks entries with confidence >= threshold as confident")` | `classify.test.ts` |
| TS-3.4 | `it("marks entries with confidence < threshold as uncertain")` | `classify.test.ts` |
| TS-3.5 | `it("treats confidence exactly equal to threshold as confident")` | `classify.test.ts` |
| TS-4.1 | `it("stores entry with null category when LLM request times out")` | `classify.test.ts` |
| TS-4.2 | `it("stores entry with null category on LLM rate limit (429)")` | `classify.test.ts` |
| TS-4.3 | `it("stores entry with null category on LLM server error (5xx)")` | `classify.test.ts` |
| TS-4.4 | `it("stores entry with null category on network error")` | `classify.test.ts` |
| TS-4.5 | `it("preserves raw input text in content field on classification failure")` | `classify.test.ts` |
| TS-4.9 | `it("logs classification errors with API response code, error message, entry ID, and input length")` | `classify.test.ts` |
| TS-C-1 | `it("uses updated prompt content on next classification without restart")` | `classify.test.ts` |
| TS-EC-1 | `it("sends very short input to the LLM without error")` | `classify.test.ts` |
| TS-EC-2 | `it("truncates very long input to fit within the model context window")` | `classify.test.ts` |
| TS-EC-3 | `it("classifies German input and returns English category names")` | `classify.test.ts` |
| TS-EC-4 | `it("returns a classification result even for ambiguous input")` | `classify.test.ts` |
| TS-EC-6 | `it("coerces a numeric string confidence to a number")` | `classify.test.ts` |
| TS-EC-7 | `it("rejects a non-numeric string confidence value")` | `classify.test.ts` |
| TS-EC-8 | `it("clamps a negative threshold to 0.0 and logs a warning")` | `classify.test.ts` |
| TS-EC-9 | `it("clamps a threshold above 1.0 to 1.0 and logs a warning")` | `classify.test.ts` |

---

#### describe("provider selection")

**TS-1.1: Sends classification request through the Anthropic provider**

- **Setup (Given):** Mock `src/llm/index.ts` — `createLLMProvider` returns a mock with a `chat` function that returns valid classification JSON. Set `LLM_PROVIDER=anthropic` via `withEnv()`. Mock `node:fs/promises` to return a prompt template.
- **Action (When):** Call the classification function with `"Had coffee with Maria, discussed her new startup"`.
- **Assertion (Then):** `createLLMProvider` was called with `{ provider: "anthropic", ... }`. The mock `chat` function was called. A valid classification result is returned.
- **Teardown:** Restore mocks and env.

**TS-1.2: Sends classification request through the OpenAI-compatible provider**

- **Setup (Given):** Same as TS-1.1, but set `LLM_PROVIDER=openai-compatible` and `LLM_BASE_URL=http://localhost:1234/v1`.
- **Action (When):** Call the classification function with the same text.
- **Assertion (Then):** `createLLMProvider` was called with `{ provider: "openai-compatible", baseUrl: "http://localhost:1234/v1", ... }`.
- **Teardown:** Restore mocks and env.

**TS-1.3: Uses the configured model for classification requests**

- **Setup (Given):** Mock LLM module. Set `LLM_MODEL=claude-sonnet-4-20250514`.
- **Action (When):** Call the classification function.
- **Assertion (Then):** `createLLMProvider` was called with `{ model: "claude-sonnet-4-20250514", ... }`, or the `chat` function was called with the model parameter matching the config.
- **Teardown:** Restore mocks and env.

#### describe("prompt loading")

**TS-1.4: Loads the classification prompt from prompts/classify.md**

- **Setup (Given):** Mock `node:fs/promises` `readFile` to return `"Classify this: {context_entries}\n\nInput: {input_text}"`. Mock LLM to return valid classification JSON.
- **Action (When):** Call the classification function with any text.
- **Assertion (Then):** `readFile` was called with a path ending in `prompts/classify.md`. The prompt sent to the LLM `chat` function contains the template content with placeholders replaced.
- **Teardown:** Restore mocks.

**TS-C-1: Uses updated prompt content on next classification without restart**

- **Setup (Given):** Mock `readFile` to return prompt version A on first call, then prompt version B on second call. Mock LLM to return valid JSON.
- **Action (When):** Call the classification function twice.
- **Assertion (Then):** The first LLM call received prompt A content. The second LLM call received prompt B content. `readFile` was called twice (not cached).
- **Teardown:** Restore mocks.

#### describe("schema validation")

**TS-1.5: Parses a valid LLM response into a structured classification result**

- **Setup (Given):** Mock LLM `chat` to return `createClassificationJSON({ category: "people", name: "Maria Coffee Chat", confidence: 0.92, fields: { relationship: "friend" }, tags: ["social", "startup"], create_calendar_event: false, calendar_date: null })`.
- **Action (When):** Call the classification function or the validation function directly.
- **Assertion (Then):** The result contains `category: "people"`, `name: "Maria Coffee Chat"`, `confidence: 0.92`, `fields` is an object, `tags` is an array of strings, `create_calendar_event` is a boolean, `calendar_date` is null.
- **Teardown:** Restore mocks.

**TS-1.6: Rejects a response with an invalid category**

- **Setup (Given):** Mock LLM `chat` to return JSON with `category: "meetings"`.
- **Action (When):** Call the classification function or the validation function.
- **Assertion (Then):** The result is null (validation failure). If testing the full flow, entry is stored with `category: null` and `confidence: null`.
- **Teardown:** Restore mocks.

**TS-1.7: Rejects a response with out-of-range confidence**

- **Setup (Given):** Mock LLM `chat` to return JSON with `confidence: 1.5`.
- **Action (When):** Call the validation function.
- **Assertion (Then):** Validation fails and the result is null.
- **Teardown:** Restore mocks.

**TS-1.8: Rejects a response with missing required fields**

- **Setup (Given):** Mock LLM `chat` to return JSON without the `category` field: `{ "name": "Test", "confidence": 0.9 }`.
- **Action (When):** Call the validation function.
- **Assertion (Then):** Validation fails and the result is null.
- **Teardown:** Restore mocks.

**TS-1.9: Rejects a response with wrong field types**

- **Setup (Given):** Mock LLM `chat` to return JSON with `tags: "not-an-array"` instead of an array.
- **Action (When):** Call the validation function.
- **Assertion (Then):** Validation fails and the result is null.
- **Teardown:** Restore mocks.

**TS-1.10: Handles a non-JSON LLM response gracefully**

- **Setup (Given):** Mock LLM `chat` to return the plain text string `"I think this is about people"`.
- **Action (When):** Call the classification function.
- **Assertion (Then):** JSON parsing fails. The function returns null (or the entry is stored with `category: null`). No unhandled exception.
- **Teardown:** Restore mocks.

**TS-1.11: Handles a truncated JSON LLM response gracefully**

- **Setup (Given):** Mock LLM `chat` to return the truncated string `'{"category": "people", "name": "Mar'`.
- **Action (When):** Call the classification function.
- **Assertion (Then):** JSON parsing fails. The function returns null. No unhandled exception.
- **Teardown:** Restore mocks.

**TS-EC-6: Coerces a numeric string confidence to a number**

- **Setup (Given):** Mock LLM `chat` to return JSON with `"confidence": "0.85"` (string, not number).
- **Action (When):** Call the validation function.
- **Assertion (Then):** Validation passes. The result has `confidence: 0.85` (number).
- **Teardown:** Restore mocks.

**TS-EC-7: Rejects a non-numeric string confidence value**

- **Setup (Given):** Mock LLM `chat` to return JSON with `"confidence": "high"`.
- **Action (When):** Call the validation function.
- **Assertion (Then):** Validation fails and the result is null.
- **Teardown:** Restore mocks.

#### describe("context formatting")

**TS-2.8: Replaces the context_entries placeholder in the prompt**

- **Setup (Given):** A prompt template containing `{context_entries}`. A list of 3 formatted context entries.
- **Action (When):** Call the prompt assembly function with the template and context.
- **Assertion (Then):** The resulting prompt contains the formatted context entries where `{context_entries}` was. The placeholder string itself is absent.
- **Teardown:** None (pure function).

**TS-2.9: Formats context entries with name, category, and truncated content**

- **Setup (Given):** A context entry with `name: "Project Alpha"`, `category: "projects"`, and `content` that is 350 characters long.
- **Action (When):** Call the context formatting function.
- **Assertion (Then):** The formatted output includes `"Project Alpha"`, `"projects"`, and exactly the first 200 characters of the content. The remaining 150 characters are excluded.
- **Teardown:** None (pure function).

**TS-2.10: Includes full content when shorter than 200 characters**

- **Setup (Given):** A context entry with `content` that is 150 characters long.
- **Action (When):** Call the context formatting function.
- **Assertion (Then):** The formatted output includes the full 150-character content. Nothing is truncated.
- **Teardown:** None (pure function).

#### describe("confidence threshold")

**TS-3.1: Defaults the confidence threshold to 0.6**

- **Setup (Given):** No `confidence_threshold` value provided (simulating no settings row).
- **Action (When):** Call the threshold resolution function with `undefined`.
- **Assertion (Then):** The resolved threshold is `0.6`.
- **Teardown:** None (pure function).

**TS-3.3: Marks entries with confidence >= threshold as confident**

- **Setup (Given):** Threshold is 0.6, classification confidence is 0.85.
- **Action (When):** Call the confidence check function.
- **Assertion (Then):** The entry is marked as confident (returns true).
- **Teardown:** None (pure function).

**TS-3.4: Marks entries with confidence < threshold as uncertain**

- **Setup (Given):** Threshold is 0.6, classification confidence is 0.45.
- **Action (When):** Call the confidence check function.
- **Assertion (Then):** The entry is marked as uncertain (returns false).
- **Teardown:** None (pure function).

**TS-3.5: Treats confidence exactly equal to threshold as confident**

- **Setup (Given):** Threshold is 0.6, classification confidence is exactly 0.6.
- **Action (When):** Call the confidence check function.
- **Assertion (Then):** The entry is marked as confident (>= comparison).
- **Teardown:** None (pure function).

**TS-EC-8: Clamps a negative threshold to 0.0 and logs a warning**

- **Setup (Given):** Spy on `process.stdout.write`. Provide threshold settings value `"-0.5"`.
- **Action (When):** Call the threshold resolution function.
- **Assertion (Then):** The resolved threshold is `0.0`. Stdout contains a JSON log entry with `level: "warn"` about an invalid threshold value.
- **Teardown:** Restore stdout spy.

**TS-EC-9: Clamps a threshold above 1.0 to 1.0 and logs a warning**

- **Setup (Given):** Spy on `process.stdout.write`. Provide threshold settings value `"1.5"`.
- **Action (When):** Call the threshold resolution function.
- **Assertion (Then):** The resolved threshold is `1.0`. Stdout contains a JSON log entry with `level: "warn"`.
- **Teardown:** Restore stdout spy.

#### describe("error handling")

**TS-4.1: Stores entry with null category when LLM request times out**

- **Setup (Given):** Mock LLM `chat` to reject with a timeout error.
- **Action (When):** Call the classification function.
- **Assertion (Then):** The result is null (category: null, confidence: null). No unhandled exception.
- **Teardown:** Restore mocks.

**TS-4.2: Stores entry with null category on LLM rate limit (429)**

- **Setup (Given):** Mock LLM `chat` to throw an API error with status 429.
- **Action (When):** Call the classification function.
- **Assertion (Then):** The result is null.
- **Teardown:** Restore mocks.

**TS-4.3: Stores entry with null category on LLM server error (5xx)**

- **Setup (Given):** Mock LLM `chat` to throw an API error with status 500.
- **Action (When):** Call the classification function.
- **Assertion (Then):** The result is null.
- **Teardown:** Restore mocks.

**TS-4.4: Stores entry with null category on network error**

- **Setup (Given):** Mock LLM `chat` to throw a `TypeError("fetch failed")`.
- **Action (When):** Call the classification function.
- **Assertion (Then):** The result is null.
- **Teardown:** Restore mocks.

**TS-4.5: Preserves raw input text in content field on classification failure**

- **Setup (Given):** Mock LLM `chat` to throw an error. Input text is `"Buy groceries for the weekend"`.
- **Action (When):** Call the classification function.
- **Assertion (Then):** The returned result (or entry state) preserves the original `"Buy groceries for the weekend"` as content. Category and confidence are null.
- **Teardown:** Restore mocks.

**TS-4.9: Logs classification errors with structured context**

- **Setup (Given):** Mock LLM `chat` to throw an API error with status 500. Spy on `process.stdout.write`. Provide an entry ID of `"test-uuid-42"` and input text of 250 characters.
- **Action (When):** Call the classification function.
- **Assertion (Then):** Stdout contains a JSON log entry with `level: "error"` containing: the status code (`500`), an error message string, the entry ID (`"test-uuid-42"`), and the input text length (`250`).
- **Teardown:** Restore mocks and stdout spy.

#### describe("edge cases")

**TS-EC-1: Sends very short input to the LLM without error**

- **Setup (Given):** Mock LLM `chat` to return valid classification JSON with low confidence.
- **Action (When):** Call the classification function with `"Hi"`.
- **Assertion (Then):** The LLM `chat` function was called (text was not filtered out). A valid classification result is returned.
- **Teardown:** Restore mocks.

**TS-EC-2: Truncates very long input to fit within the model context window**

- **Setup (Given):** Create input text that is thousands of words long. Mock LLM `chat` to capture the prompt it receives. Mock prompt file.
- **Action (When):** Call the classification function with the long text.
- **Assertion (Then):** The prompt sent to the LLM is shorter than the raw input. The classification instructions and context entries sections of the prompt are preserved intact. The content/input portion is truncated.
- **Teardown:** Restore mocks.

**TS-EC-3: Classifies German input and returns English category names**

- **Setup (Given):** Mock LLM `chat` to return `createClassificationJSON({ category: "people", name: "Treffen mit Anna" })`.
- **Action (When):** Call the classification function with `"Treffen mit Anna über das neue Projekt besprochen"`.
- **Assertion (Then):** The German text was sent to the LLM without modification. The result has an English category (`"people"`). The `name` field may be in German.
- **Teardown:** Restore mocks.

**TS-EC-4: Returns a classification result even for ambiguous input**

- **Setup (Given):** Mock LLM `chat` to return `createClassificationJSON({ category: "reference", confidence: 0.3 })`.
- **Action (When):** Call the classification function with `"stuff"`.
- **Assertion (Then):** A classification result is returned (not null). The confidence is 0.3, which is below the default threshold (0.6), so the entry is flagged as uncertain.
- **Teardown:** Restore mocks.

---

### Integration Tests — Classification + Database (`tests/integration/classify-integration.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-2.1 | `it("fetches the 5 most recent entries as context")` | `classify-integration.test.ts` |
| TS-2.2 | `it("excludes soft-deleted entries from recent context")` | `classify-integration.test.ts` |
| TS-2.3 | `it("returns all entries when fewer than 5 exist")` | `classify-integration.test.ts` |
| TS-2.4 | `it("finds the top 3 similar entries above the similarity threshold")` | `classify-integration.test.ts` |
| TS-2.5 | `it("excludes entries below the 0.5 similarity threshold")` | `classify-integration.test.ts` |
| TS-2.6 | `it("excludes soft-deleted entries from similarity search")` | `classify-integration.test.ts` |
| TS-2.7 | `it("deduplicates context entries that appear in both recent and similar results")` | `classify-integration.test.ts` |
| TS-3.2 | `it("reads the confidence threshold from the settings table")` | `classify-integration.test.ts` |
| TS-4.6 | `it("retries classification for entries with null category")` | `classify-integration.test.ts` |
| TS-4.7 | `it("updates entry with classification result on successful retry")` | `classify-integration.test.ts` |
| TS-4.8 | `it("skips soft-deleted entries during retry")` | `classify-integration.test.ts` |
| TS-C-2 | `it("does not store calendar fields in the database")` | `classify-integration.test.ts` |
| TS-C-3 | `it("applies exponential backoff on consecutive 429 responses during retry")` | `classify-integration.test.ts` |
| TS-EC-5 | `it("uses a placeholder note when no context entries exist")` | `classify-integration.test.ts` |
| TS-NG-1 | `it("does not store the raw LLM API response")` | `classify-integration.test.ts` |
| TS-NG-2 | `it("does not re-classify existing entries when the prompt changes")` | `classify-integration.test.ts` |
| TS-NG-3 | `it("preserves the existing category when entry content is updated")` | `classify-integration.test.ts` |

All integration tests share a single testcontainers PostgreSQL instance (started in `beforeAll`, stopped in `afterAll`). Migrations run once. LLM provider and embedding are mocked via `vi.mock()`. Entry rows are cleaned up in `afterEach`.

---

#### describe("context gathering")

**TS-2.1: Fetches the 5 most recent entries as context**

- **Setup (Given):** Insert 8 entries via SQL with staggered `created_at` timestamps (none soft-deleted). Each with a `name`, `category`, and `content`.
- **Action (When):** Call the context-gathering function with the test DB connection.
- **Assertion (Then):** Exactly 5 entries are returned. They are the 5 with the most recent `created_at` values. They are ordered by `created_at` descending.
- **Teardown:** Delete test entries.

**TS-2.2: Excludes soft-deleted entries from recent context**

- **Setup (Given):** Insert 6 entries. Set `deleted_at` to a timestamp on one of the recent entries.
- **Action (When):** Call the context-gathering function (recent entries portion).
- **Assertion (Then):** The soft-deleted entry is not in the results. At most 5 non-deleted entries are returned.
- **Teardown:** Delete test entries.

**TS-2.3: Returns all entries when fewer than 5 exist**

- **Setup (Given):** Insert 3 entries (none soft-deleted).
- **Action (When):** Call the context-gathering function.
- **Assertion (Then):** All 3 entries are returned.
- **Teardown:** Delete test entries.

**TS-2.4: Finds the top 3 similar entries above the similarity threshold**

- **Setup (Given):** Insert 10 entries with embeddings. Use `createFakeEmbedding()` for a base vector, then create variations with known cosine similarity values — 5 entries with similarity >= 0.5 to the input embedding, 5 below. Mock `generateEmbedding()` to return the input embedding.
- **Action (When):** Call the similarity search function with a test input text.
- **Assertion (Then):** Exactly 3 entries are returned (the top 3 by similarity score). All have similarity >= 0.5.
- **Teardown:** Delete test entries.

**Note on similarity test data:** Create embeddings with controlled similarity by using the base vector with scaled perturbations. For example, `base.map((v, i) => v + noise[i] * scale)` where `scale` controls the similarity level. Normalize vectors to unit length for accurate cosine similarity.

**TS-2.5: Excludes entries below the 0.5 similarity threshold**

- **Setup (Given):** Insert 5 entries. 2 have embeddings with similarity >= 0.5 to the input, 3 have similarity < 0.5. Mock `generateEmbedding`.
- **Action (When):** Call the similarity search function.
- **Assertion (Then):** Only the 2 entries above the threshold are returned.
- **Teardown:** Delete test entries.

**TS-2.6: Excludes soft-deleted entries from similarity search**

- **Setup (Given):** Insert 3 entries with embeddings similar to the input. Soft-delete one of them.
- **Action (When):** Call the similarity search function.
- **Assertion (Then):** The soft-deleted entry is not in the results, even though its embedding is similar.
- **Teardown:** Delete test entries.

**TS-2.7: Deduplicates context entries that appear in both recent and similar results**

- **Setup (Given):** Insert 5 entries. Make 1 entry both recent (high `created_at`) and similar (embedding close to input). Mock `generateEmbedding`.
- **Action (When):** Call the full context assembly function (combines recent + similar).
- **Assertion (Then):** The overlapping entry appears exactly once in the assembled context. Total context entries = unique count (not recent_count + similar_count).
- **Teardown:** Delete test entries.

#### describe("classification with settings")

**TS-3.2: Reads the confidence threshold from the settings table**

- **Setup (Given):** Insert a settings row with `key: "confidence_threshold"`, `value: "0.8"`. Mock LLM to return classification with confidence 0.75.
- **Action (When):** Classify an entry through the full flow.
- **Assertion (Then):** The threshold used is 0.8 (from settings). The entry with confidence 0.75 is flagged as uncertain (since 0.75 < 0.8).
- **Teardown:** Delete settings row and test entries.

**TS-EC-5: Uses a placeholder note when no context entries exist**

- **Setup (Given):** Empty entries table (no entries at all). Mock LLM `chat`, capturing the prompt it receives.
- **Action (When):** Call the classification function for a new piece of text.
- **Assertion (Then):** The prompt sent to the LLM contains a placeholder note (e.g., "No existing entries yet") where context entries would normally be. Classification proceeds and returns a result.
- **Teardown:** Delete any created entries.

#### describe("retry")

**TS-4.6: Retries classification for entries with null category**

- **Setup (Given):** Insert 3 entries: 2 with `category: null` and 1 with `category: "tasks"`. All have `deleted_at: null`. Mock LLM to return valid classification JSON. Track `chat` call count.
- **Action (When):** Call the retry function.
- **Assertion (Then):** The LLM `chat` function was called exactly 2 times (once per null-category entry). The entry with `category: "tasks"` was not retried.
- **Teardown:** Delete test entries. Restore mocks.

**TS-4.7: Updates entry with classification result on successful retry**

- **Setup (Given):** Insert an entry with `category: null`, `confidence: null`. Mock LLM to return `createClassificationJSON({ category: "projects", name: "Alpha Project", confidence: 0.88, tags: ["work"] })`.
- **Action (When):** Call the retry function.
- **Assertion (Then):** Re-query the entry from DB. It now has `category: "projects"`, `name: "Alpha Project"`, `confidence: 0.88`, `tags` containing `"work"`, and non-empty `fields`.
- **Teardown:** Delete test entries. Restore mocks.

**TS-4.8: Skips soft-deleted entries during retry**

- **Setup (Given):** Insert 2 entries with `category: null`: one with `deleted_at: null`, one with `deleted_at` set to a timestamp. Mock LLM `chat`, track call count.
- **Action (When):** Call the retry function.
- **Assertion (Then):** LLM `chat` was called exactly once (only the non-deleted entry). The soft-deleted entry's category remains null.
- **Teardown:** Delete test entries. Restore mocks.

**TS-C-3: Applies exponential backoff on consecutive 429 responses during retry**

- **Setup (Given):** Insert 3 entries with `category: null`. Mock LLM `chat` to return 429 errors for the first 2 calls, then succeed on the 3rd. Record timestamps of each call using `Date.now()` or `performance.now()`.
- **Action (When):** Call the retry function.
- **Assertion (Then):** The delay between the 2nd and 3rd call is greater than the delay between the 1st and 2nd call (exponential increase). The 3rd entry gets classified successfully.
- **Teardown:** Delete test entries. Restore mocks.

**Note:** If the implementation uses `setTimeout` for backoff delays, use `vi.useFakeTimers()` and advance time to avoid slow tests. The assertion then checks that `setTimeout` was called with increasing delay values.

#### describe("storage")

**TS-C-2: Does not store calendar fields in the database**

- **Setup (Given):** Mock LLM to return `createClassificationJSON({ create_calendar_event: true, calendar_date: "2026-06-15" })`. Insert an entry with `category: null`.
- **Action (When):** Classify the entry (or run retry).
- **Assertion (Then):** Query the entry from DB. It has `category`, `name`, `confidence`, `fields`, `tags` updated. The columns `create_calendar_event` and `calendar_date` do not exist in the entries table (verified by checking the row does not contain those keys). The calendar fields are only available in the return value, not persisted.
- **Teardown:** Delete test entries. Restore mocks.

**TS-NG-1: Does not store the raw LLM API response**

- **Setup (Given):** Mock LLM to return valid classification JSON. Classify an entry.
- **Action (When):** Query the entry row from the database.
- **Assertion (Then):** The row contains standard columns (`id`, `category`, `name`, `content`, `fields`, `tags`, `confidence`, `source`, `created_at`, `updated_at`). No column stores the raw LLM response text.
- **Teardown:** Delete test entries. Restore mocks.

#### describe("non-goals")

**TS-NG-2: Does not re-classify existing entries when the prompt changes**

- **Setup (Given):** Insert 2 entries with `category: "people"` and `category: "tasks"`. These have non-null categories (already classified).
- **Action (When):** Simulate a prompt file change (update the mock). Then call the retry function.
- **Assertion (Then):** The retry function does not process these entries (they have categories). Their categories remain `"people"` and `"tasks"`. The LLM `chat` function was not called.
- **Teardown:** Delete test entries. Restore mocks.

**TS-NG-3: Preserves the existing category when entry content is updated**

- **Setup (Given):** Insert an entry with `category: "projects"`, `confidence: 0.9`, `content: "original"`.
- **Action (When):** Update the entry's `content` to `"new content"` via SQL.
- **Assertion (Then):** The entry's `category` remains `"projects"`. The entry's `confidence` remains `0.9`. No classification request was made (LLM `chat` was not called).
- **Teardown:** Delete test entries. Restore mocks.

## Fixtures & Test Data

### New Helper: Mock LLM (`tests/helpers/mock-llm.ts`)

```typescript
const DEFAULT_CLASSIFICATION = {
  category: "people" as const,
  name: "Maria Coffee Chat",
  confidence: 0.92,
  fields: { relationship: "friend" },
  tags: ["social", "startup"],
  create_calendar_event: false,
  calendar_date: null,
};

export function createClassificationResult(
  overrides?: Partial<typeof DEFAULT_CLASSIFICATION>,
) {
  return { ...DEFAULT_CLASSIFICATION, ...overrides };
}

export function createClassificationJSON(
  overrides?: Partial<typeof DEFAULT_CLASSIFICATION>,
): string {
  return JSON.stringify(createClassificationResult(overrides));
}
```

### Existing Helpers (reused)

- **`tests/helpers/env.ts`** — `withEnv()`, `setRequiredEnvVars()` for env var manipulation.
- **`tests/helpers/test-db.ts`** — `startTestDb()`, `runMigrations()` for testcontainers PostgreSQL.
- **`tests/helpers/mock-ollama.ts`** — `createFakeEmbedding()` reused for generating test embeddings for similarity search setup.

### Test Data Factories

**Entry factory (inline in integration tests):**

```typescript
async function insertEntry(sql: postgres.Sql, overrides?: {
  name?: string;
  content?: string | null;
  category?: string | null;
  confidence?: number | null;
  fields?: Record<string, unknown>;
  tags?: string[];
  embedding?: number[] | null;
  deletedAt?: Date | null;
  createdAt?: Date;
}): Promise<{ id: string; [key: string]: unknown }>;
```

Extends the existing entry factory from embedding integration tests with `category`, `confidence`, `fields`, and `tags` fields.

**Settings row helper (inline in integration tests):**

```typescript
async function insertSetting(sql: postgres.Sql, key: string, value: string): Promise<void>;
async function deleteSetting(sql: postgres.Sql, key: string): Promise<void>;
```

### Similarity Test Data Strategy

For TS-2.4, TS-2.5, TS-2.6, and TS-2.7, create embeddings with controlled cosine similarity:

```typescript
function createSimilarEmbedding(base: number[], similarity: number): number[] {
  // Mix base vector with random noise to achieve target similarity
  // similarity ~1.0 → mostly base vector
  // similarity ~0.0 → mostly noise
  const noise = Array.from({ length: base.length }, (_, i) => Math.cos(i * 7.3) * 0.5);
  const mix = base.map((v, i) => v * similarity + noise[i] * (1 - similarity));
  // Normalize to unit length for cosine similarity accuracy
  const magnitude = Math.sqrt(mix.reduce((sum, v) => sum + v * v, 0));
  return mix.map(v => v / magnitude);
}
```

This produces vectors with predictable cosine similarity to the base, enabling reliable threshold tests.

### Fixture Lifecycle

| Scope | Fixture | Lifecycle |
|-------|---------|-----------|
| Per suite | Testcontainers PostgreSQL | `beforeAll` / `afterAll` in integration test file |
| Per suite | Drizzle migration run | Once in `beforeAll`, after container starts |
| Per test | LLM provider mock | `vi.mock()` at top of file, `vi.mocked(chat).mockReset()` in `beforeEach` |
| Per test | Embedding mock | `vi.mock()` at top of file, reset in `beforeEach` |
| Per test | `process.stdout.write` spy | `vi.spyOn()` where needed, restored in `afterEach` |
| Per test | `node:fs/promises` mock | `vi.mock()` at top, reset in `beforeEach` |
| Per test | Environment variables | `withEnv()` save/restore in tests that modify env |
| Per test | DB rows (entries, settings) | Each test inserts its own data; `afterEach` deletes by test-specific markers |

### Test Isolation

- **Unit tests:** Each test gets fresh mock resets. No shared state. Logger spy restored per test.
- **Integration tests:** Shared DB container, but each test manages its own rows. Tests insert entries with unique names/IDs and clean up in `afterEach`. No test depends on another test's data.
- **LLM mocking:** `vi.mocked(chat).mockReset()` in `beforeEach` ensures no mock leaks.
- **Env vars:** Tests using `withEnv()` restore original values automatically.

## Alignment Check

### Coverage Verification

| Test Scenario ID | Title | Test Function | Status |
|------------------|-------|---------------|--------|
| TS-1.1 | Anthropic provider | `it("sends classification request through the Anthropic provider")` | ✅ Mapped |
| TS-1.2 | OpenAI-compatible provider | `it("sends classification request through the OpenAI-compatible provider")` | ✅ Mapped |
| TS-1.3 | Configured model | `it("uses the configured model for classification requests")` | ✅ Mapped |
| TS-1.4 | Prompt from file | `it("loads the classification prompt from prompts/classify.md")` | ✅ Mapped |
| TS-1.5 | Valid response parsed | `it("parses a valid LLM response into a structured classification result")` | ✅ Mapped |
| TS-1.6 | Invalid category | `it("rejects a response with an invalid category")` | ✅ Mapped |
| TS-1.7 | Out-of-range confidence | `it("rejects a response with out-of-range confidence")` | ✅ Mapped |
| TS-1.8 | Missing fields | `it("rejects a response with missing required fields")` | ✅ Mapped |
| TS-1.9 | Wrong field types | `it("rejects a response with wrong field types")` | ✅ Mapped |
| TS-1.10 | Non-JSON response | `it("handles a non-JSON LLM response gracefully")` | ✅ Mapped |
| TS-1.11 | Truncated JSON | `it("handles a truncated JSON LLM response gracefully")` | ✅ Mapped |
| TS-2.1 | Last 5 recent entries | `it("fetches the 5 most recent entries as context")` | ✅ Mapped |
| TS-2.2 | Soft-deleted excluded (recent) | `it("excludes soft-deleted entries from recent context")` | ✅ Mapped |
| TS-2.3 | Fewer than 5 entries | `it("returns all entries when fewer than 5 exist")` | ✅ Mapped |
| TS-2.4 | Top 3 similar entries | `it("finds the top 3 similar entries above the similarity threshold")` | ✅ Mapped |
| TS-2.5 | Below similarity threshold | `it("excludes entries below the 0.5 similarity threshold")` | ✅ Mapped |
| TS-2.6 | Soft-deleted excluded (similar) | `it("excludes soft-deleted entries from similarity search")` | ✅ Mapped |
| TS-2.7 | Dedup by ID | `it("deduplicates context entries that appear in both recent and similar results")` | ✅ Mapped |
| TS-2.8 | Context in prompt | `it("replaces the context_entries placeholder in the prompt")` | ✅ Mapped |
| TS-2.9 | Context format + snippet | `it("formats context entries with name, category, and truncated content")` | ✅ Mapped |
| TS-2.10 | Short content untruncated | `it("includes full content when shorter than 200 characters")` | ✅ Mapped |
| TS-3.1 | Default threshold 0.6 | `it("defaults the confidence threshold to 0.6")` | ✅ Mapped |
| TS-3.2 | Threshold from settings | `it("reads the confidence threshold from the settings table")` | ✅ Mapped |
| TS-3.3 | Confident >= threshold | `it("marks entries with confidence >= threshold as confident")` | ✅ Mapped |
| TS-3.4 | Uncertain < threshold | `it("marks entries with confidence < threshold as uncertain")` | ✅ Mapped |
| TS-3.5 | Exactly at threshold | `it("treats confidence exactly equal to threshold as confident")` | ✅ Mapped |
| TS-4.1 | Timeout → null | `it("stores entry with null category when LLM request times out")` | ✅ Mapped |
| TS-4.2 | 429 → null | `it("stores entry with null category on LLM rate limit (429)")` | ✅ Mapped |
| TS-4.3 | 5xx → null | `it("stores entry with null category on LLM server error (5xx)")` | ✅ Mapped |
| TS-4.4 | Network error → null | `it("stores entry with null category on network error")` | ✅ Mapped |
| TS-4.5 | Content preserved | `it("preserves raw input text in content field on classification failure")` | ✅ Mapped |
| TS-4.6 | Retry finds null-category | `it("retries classification for entries with null category")` | ✅ Mapped |
| TS-4.7 | Retry updates entry | `it("updates entry with classification result on successful retry")` | ✅ Mapped |
| TS-4.8 | Retry skips soft-deleted | `it("skips soft-deleted entries during retry")` | ✅ Mapped |
| TS-4.9 | Structured error logging | `it("logs classification errors with API response code, error message, entry ID, and input length")` | ✅ Mapped |
| TS-C-1 | Prompt reload | `it("uses updated prompt content on next classification without restart")` | ✅ Mapped |
| TS-C-2 | Calendar fields ephemeral | `it("does not store calendar fields in the database")` | ✅ Mapped |
| TS-C-3 | Exponential backoff | `it("applies exponential backoff on consecutive 429 responses during retry")` | ✅ Mapped |
| TS-EC-1 | Short input | `it("sends very short input to the LLM without error")` | ✅ Mapped |
| TS-EC-2 | Long input truncated | `it("truncates very long input to fit within the model context window")` | ✅ Mapped |
| TS-EC-3 | German input | `it("classifies German input and returns English category names")` | ✅ Mapped |
| TS-EC-4 | Ambiguous input | `it("returns a classification result even for ambiguous input")` | ✅ Mapped |
| TS-EC-5 | Empty context | `it("uses a placeholder note when no context entries exist")` | ✅ Mapped |
| TS-EC-6 | Numeric string coerced | `it("coerces a numeric string confidence to a number")` | ✅ Mapped |
| TS-EC-7 | Non-numeric string fails | `it("rejects a non-numeric string confidence value")` | ✅ Mapped |
| TS-EC-8 | Threshold clamped low | `it("clamps a negative threshold to 0.0 and logs a warning")` | ✅ Mapped |
| TS-EC-9 | Threshold clamped high | `it("clamps a threshold above 1.0 to 1.0 and logs a warning")` | ✅ Mapped |
| TS-NG-1 | Raw response not stored | `it("does not store the raw LLM API response")` | ✅ Mapped |
| TS-NG-2 | No re-classify on prompt change | `it("does not re-classify existing entries when the prompt changes")` | ✅ Mapped |
| TS-NG-3 | No re-classify on content edit | `it("preserves the existing category when entry content is updated")` | ✅ Mapped |

### Result

**Full alignment.** All 50 test scenarios are mapped to concrete test functions with setup, action, and assertion strategies defined. Every test can run in isolation. Every test will fail before the feature code exists.

### Design Concerns

None. All tests verify observable behavior:
- **Unit tests:** Assert on return values (classification results, null), mock call arguments (provider config, prompt content, model), and log output (stdout JSON).
- **Integration tests:** Assert on database state (category, confidence, fields, tags columns), mock call patterns (count, arguments), and query results (context entries).

No test requires knowledge of private methods or internal data structures.

### Initial Failure Verification

All tests will fail before implementation because:

- **Unit tests (`classify.test.ts`):** The classification module (`src/classify.ts`) and LLM provider module (`src/llm/`) do not exist → imports will fail with module-not-found errors.
- **Integration tests (`classify-integration.test.ts`):** Same — no classify module, no LLM module, no context-gathering or retry functions.
- **Mock helper (`mock-llm.ts`):** This is test infrastructure only. It doesn't depend on feature code and can be created first.
