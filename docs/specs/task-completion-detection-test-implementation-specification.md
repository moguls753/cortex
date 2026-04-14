# Task Completion Detection - Test Implementation Specification

## Test Framework & Conventions

- **Stack:** TypeScript, Node.js, Vitest
- **Test framework:** Vitest with `describe`/`it` blocks, `vi.mock()` hoisted mocks, `vi.fn()` spies
- **Assertion style:** `expect(...)` (Vitest built-in)
- **Mocking strategy:** Module-level `vi.mock()` for external dependencies (LLM provider, embed, DB, config). Hoisted `vi.fn()` for mock implementations. Follows existing patterns in `tests/unit/classify.test.ts` and `tests/unit/digests.test.ts`.
- **Test data:** Factory functions in `tests/helpers/mock-llm.ts` (extend with completion-related factories). Inline test data for simple cases.

## Test Structure

### File Organization

| File | Scope |
|------|-------|
| `tests/unit/task-completion.test.ts` | Core detection logic: classification flag, semantic search, second LLM call, confidence gating, result processing (TS-1.x, TS-2.x, TS-3.x, TS-4.x, TS-EC-1–8, TS-C-1, TS-NG-1–3) |
| `tests/unit/task-completion-messages.test.ts` | Reply message formatting for Telegram (TS-5.x) |
| `tests/integration/task-completion-integration.test.ts` | End-to-end flows through capture sources: Telegram text, Telegram voice, webapp, MCP (TS-6.x, TS-7.1) |

### Naming Convention

Test functions follow the pattern: `it("TS-X.Y: <behavior description>")` — matching the test specification IDs. Grouped by `describe` blocks per user story or edge case category.

## Test Scenario Mapping

### Module Under Test

The feature will be implemented in a new module `src/task-completion.ts` exporting:

- `detectTaskCompletion(text, classificationResult, sql)` — orchestrator that checks `is_task_completion`, searches candidates, calls second LLM, applies confidence gating
- `findPendingTaskCandidates(embedding, sql)` — queries pending tasks by cosine similarity
- `matchCompletedTasks(candidates, thoughtText, llmConfig, sql)` — second LLM call to identify matches
- `applyTaskCompletions(matches, confidenceThreshold, sql)` — updates task status for high-confidence matches, returns lists of auto-completed and needs-confirmation

The classification response schema (`validateClassificationResponse`) will be extended with an `is_task_completion: boolean` field.

### Mocks Required

```typescript
// Hoisted mocks (top of test file)
const mockChat = vi.fn();
const mockCreateLLMProvider = vi.fn(() => ({ chat: mockChat }));
vi.mock("../../src/llm/index.js", () => ({ createLLMProvider: mockCreateLLMProvider }));

const mockGenerateEmbedding = vi.fn();
vi.mock("../../src/embed.js", () => ({ generateEmbedding: mockGenerateEmbedding }));

const mockGetLLMConfig = vi.fn();
vi.mock("../../src/llm/config.js", () => ({ getLLMConfig: mockGetLLMConfig }));

const mockResolveConfigValue = vi.fn();
vi.mock("../../src/config.js", () => ({ config: {}, resolveConfigValue: mockResolveConfigValue }));

// Mock SQL for DB queries
const mockSql: Record<string, vi.Mock> = {};
```

### Helper Factories (extend `tests/helpers/mock-llm.ts`)

```typescript
// New factory functions to add:
export function createTaskCompletionMatch(overrides?: Partial<{entry_id: string, confidence: number}>) {
  return { entry_id: "uuid-1", confidence: 0.9, ...overrides };
}

export function createPendingTask(overrides?: Partial<{id: string, name: string, content: string, fields: Record<string, unknown>}>) {
  return {
    id: overrides?.id ?? "task-uuid-1",
    name: overrides?.name ?? "Call landlord about Sendling",
    content: overrides?.content ?? "Call landlord about Sendling apartment",
    category: "tasks",
    fields: overrides?.fields ?? { status: "pending", due_date: null, notes: null },
    similarity: 0.75,
  };
}
```

### File: `tests/unit/task-completion.test.ts`

#### US-1: Detection in First LLM Call

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-1.1 | `it("TS-1.1: classification response includes is_task_completion flag")` | Mock LLM returns JSON with `is_task_completion: true` plus standard classification fields | Call `classifyText()` with test input | Result includes `is_task_completion` boolean field |
| TS-1.2 | `it("TS-1.2: is_task_completion is true for completion-indicating text")` | Mock LLM returns `is_task_completion: true` for "I called the landlord" | Call `classifyText()` with "I called the landlord" | `result.is_task_completion` is `true` |
| TS-1.3 | `it("TS-1.3: explicit completion is recognized")` | Create pending task "Call landlord about Sendling" in mock DB. Mock first LLM call returns `is_task_completion: true`. Mock embedding returns vector. Mock SQL query returns the pending task as candidate. Mock second LLM call returns match with high confidence. | Call `detectTaskCompletion("I called the landlord", classificationResult, mockSql)` | Result includes task "Call landlord about Sendling" as a match |
| TS-1.4 | `it("TS-1.4: implicit completion is recognized")` | Same as TS-1.3 but input is "The landlord said the apartment is available next month" | Call `detectTaskCompletion(...)` | Task "Call landlord about Sendling" is identified as a match |
| TS-1.5 | `it("TS-1.5: no second LLM call when is_task_completion is false")` | Mock first LLM returns `is_task_completion: false` | Call `detectTaskCompletion(...)` with `classificationResult.is_task_completion = false` | `mockChat` not called a second time. No semantic search performed (mock embedding not called for candidate search). |

#### US-2: Task Matching

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-2.1 | `it("TS-2.1: semantic search targets pending non-deleted tasks only")` | Mock SQL to return rows. Include a done task, a soft-deleted pending task, and a valid pending task in the DB mock. | Call `findPendingTaskCandidates(embedding, mockSql)` | SQL query filters by `category = 'tasks'`, `fields->>'status' = 'pending'`, `deleted_at IS NULL`. Only valid pending tasks returned. |
| TS-2.2 | `it("TS-2.2: top 5 candidates above similarity threshold retrieved")` | Mock SQL returns 7 pending tasks, 5 with similarity >= 0.5, 2 below | Call `findPendingTaskCandidates(embedding, mockSql)` | Returns exactly 5 candidates. SQL uses `LIMIT 5` and similarity >= 0.5 filter. |
| TS-2.3 | `it("TS-2.3: second LLM call returns matches with entry_id and confidence")` | Mock 3 candidate tasks. Mock `mockChat` to return JSON array of matches: `[{entry_id: "uuid-1", confidence: 0.9}]` | Call `matchCompletedTasks(candidates, thoughtText, llmConfig, mockSql)` | Result is array of objects each with `entry_id` (string) and `confidence` (number 0.0–1.0) |
| TS-2.4 | `it("TS-2.4: maximum 3 completions per message")` | Mock second LLM call returns 5 matches with varying confidence | Call `matchCompletedTasks(...)` or `detectTaskCompletion(...)` | Only top 3 by confidence are returned. Remaining 2 discarded. |
| TS-2.5 | `it("TS-2.5: zero candidates skips second LLM call")` | Mock SQL returns empty array from candidate search. `is_task_completion` is `true`. | Call `detectTaskCompletion(...)` | `mockChat` not called for second LLM. Result has empty matches array. |

#### US-3: Confidence-Based Auto/Confirm

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-3.1 | `it("TS-3.1: high-confidence match auto-completes task")` | Confidence threshold = 0.6. Match with confidence 0.85. Mock SQL for status update. | Call `applyTaskCompletions([{entry_id, confidence: 0.85}], 0.6, mockSql)` | SQL UPDATE sets `fields.status = 'done'` for matched task. Result `autoCompleted` array includes the task. |
| TS-3.2 | `it("TS-3.2: low-confidence match does not auto-complete")` | Confidence threshold = 0.6. Match with confidence 0.45. | Call `applyTaskCompletions([{entry_id, confidence: 0.45}], 0.6, mockSql)` | No SQL UPDATE for status. Result `needsConfirmation` array includes the task. Task status remains "pending". |
| TS-3.3 | `it("TS-3.3: user confirms low-confidence completion")` | A pending task exists. Confirmation callback triggered with "yes". | Call the confirmation handler with entry_id and action "confirm" | SQL UPDATE sets `fields.status = 'done'` for the task. |
| TS-3.4 | `it("TS-3.4: user denies low-confidence completion")` | A pending task exists. Confirmation callback triggered with "no". | Call the confirmation handler with entry_id and action "deny" | No SQL UPDATE. Task status remains "pending". |

#### US-4: Independent Classification and Storage

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-4.1 | `it("TS-4.1: new thought classified independently of completion")` | Mock LLM returns `is_task_completion: true` and `category: "people"` | Call `classifyText(...)` | Classification result has `category: "people"` — not overridden by completion detection |
| TS-4.2 | `it("TS-4.2: new thought stored as separate entry")` | Completion detection matches a task. New entry is inserted. | Call `detectTaskCompletion(...)` | The function does not modify or merge the new entry into the completed task. New entry retains its own ID, embedding, tags. |
| TS-4.3 | `it("TS-4.3: completion detection does not alter new entry fields")` | Classification returns `{category: "people", name: "Landlord Chat", tags: ["housing"]}`. Completion detection runs. | Call `detectTaskCompletion(...)` | Returned result does not modify category, name, tags, or fields of the new entry |

#### US-5: Capture Confirmation Messages

### File: `tests/unit/task-completion-messages.test.ts`

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-5.1 | `it("TS-5.1: auto-completion shown in reply message")` | Auto-completed task "Call landlord" with classification "people" → "Landlord Chat" at 92% | Call message formatter with classification + completion results | Message contains classification confirmation AND "Marked 'Call landlord' as done" |
| TS-5.2 | `it("TS-5.2: multiple auto-completions listed in reply")` | Two auto-completed tasks: "Call landlord" and "Email accountant" | Call message formatter | Message lists both: "Marked 'Call landlord' as done" and "Marked 'Email accountant' as done" |
| TS-5.3 | `it("TS-5.3: low-confidence completion shows inline button prompt")` | One low-confidence match for "Call landlord" | Call message formatter | Message includes classification confirmation. Inline keyboard data includes button text "Did this complete 'Call landlord'?" with Yes/No options |
| TS-5.4 | `it("TS-5.4: mixed confidence shows both auto and confirm")` | One high-confidence ("Call landlord") and one low-confidence ("Email accountant") | Call message formatter | Message shows "Marked 'Call landlord' as done" AND includes inline button for "Email accountant" |

### File: `tests/integration/task-completion-integration.test.ts`

These tests use the real database (testcontainers + PostgreSQL) and mock only the LLM provider and Ollama embedding endpoint. They verify the full capture-to-completion flow.

#### US-6: Cross-Source Support

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-6.1 | `it("TS-6.1: completion detection works for Telegram text")` | Insert pending task in DB. Mock LLM returns `is_task_completion: true` + classification. Mock second LLM returns match. Mock embedding. | Simulate Telegram text message handler | Pending task's status updated to "done" in DB. New entry created separately. |
| TS-6.2 | `it("TS-6.2: completion detection works for Telegram voice")` | Same setup as TS-6.1. Mock transcription returns completion-indicating text. | Simulate Telegram voice message handler | Pending task's status updated to "done". New entry created. |
| TS-6.3 | `it("TS-6.3: completion detection works for webapp capture")` | Same setup. | Simulate webapp POST /new with completion-indicating content | Pending task's status updated to "done". New entry created. |
| TS-6.4 | `it("TS-6.4: completion detection works for MCP add_thought")` | Same setup. | Call MCP `add_thought` tool handler | Pending task's status updated to "done". MCP response includes `completed_tasks` field listing the task. |

#### US-7: /fix Undo

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-7.1 | `it("TS-7.1: /fix undoes automatic task completion")` | Insert pending task, simulate auto-completion (status = "done"). Insert the new entry that triggered it. | Simulate `/fix that didn't complete the landlord task` via Telegram handler | Task's status restored to "pending" in DB |

### Edge Case Scenarios (in `tests/unit/task-completion.test.ts`)

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-EC-1 | `it("TS-EC-1: already-done task is not a candidate")` | Mock SQL returns task with `fields.status = 'done'` | Call `findPendingTaskCandidates(...)` | Done task not included in results (SQL WHERE clause filters it) |
| TS-EC-2 | `it("TS-EC-2: multiple matches but only one correct")` | Two candidate tasks: "Call landlord about Sendling" and "Call landlord about Schwabing". Second LLM returns high confidence for Sendling, low for Schwabing. | Call `matchCompletedTasks(...)` | Sendling match has high confidence. Schwabing match has low confidence. |
| TS-EC-3 | `it("TS-EC-3: new thought itself classified as task while completing another")` | First LLM returns `category: "tasks"`, `is_task_completion: true`. Second LLM matches existing task. | Call `detectTaskCompletion(...)` | New entry classified as "tasks" (independent). Existing task matched for completion. Both coexist. |
| TS-EC-4 | `it("TS-EC-4: no pending tasks exist")` | Mock SQL returns empty array for pending task query. `is_task_completion: true`. | Call `detectTaskCompletion(...)` | No second LLM call made. Empty matches returned. |
| TS-EC-5 | `it("TS-EC-5: first LLM call fails")` | Mock `classifyText` to return `{category: null, error: "..."}` | Check detection flow | No completion detection attempted. `is_task_completion` not present or false. |
| TS-EC-6 | `it("TS-EC-6: second LLM call fails")` | Mock second `mockChat` to throw an error. Candidates exist. | Call `matchCompletedTasks(...)` | Returns empty matches. Warning logged. No task status changed. |
| TS-EC-7 | `it("TS-EC-7: confirming already-done task is a no-op")` | Task already has `fields.status = 'done'` in DB | Call confirmation handler with "confirm" | No error thrown. Task remains "done". Idempotent. |
| TS-EC-8 | `it("TS-EC-8: ambiguous voice with very low match confidence")` | `is_task_completion: true`. Candidates exist but second LLM returns zero matches (or all below any usable threshold). | Call `detectTaskCompletion(...)` | Empty matches returned. No task status changed. |

### Constraint & Non-Goal Scenarios (in `tests/unit/task-completion.test.ts`)

| Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----------|---------------|---------------|---------------|------------------|
| TS-C-1 | `it("TS-C-1: uses LLM provider abstraction for both calls")` | Mock `createLLMProvider` | Call `detectTaskCompletion(...)` with `is_task_completion: true` and candidates | `createLLMProvider` called. `mockChat` called for second LLM. No direct API calls. |
| TS-NG-1 | `it("TS-NG-1: projects are not affected by completion detection")` | Mock SQL candidate query. Entry has `category: "projects"`. | Call `findPendingTaskCandidates(...)` | SQL query explicitly filters `category = 'tasks'`. Project entries never returned. |
| TS-NG-2 | `it("TS-NG-2: no follow-up tasks auto-created from completion context")` | New thought: "Called the landlord, need to sign lease by Friday". Completion detected. | Call `detectTaskCompletion(...)` | Result only contains matches and completion data. No new entries created by the detection function. |
| TS-NG-3 | `it("TS-NG-3: no retroactive matching of existing entries")` | Existing old entry that semantically matches a new pending task | Verify that `detectTaskCompletion` is only called from capture handlers, not from entry creation | The function signature requires explicit invocation with fresh thought text. No trigger on existing entry scans. |

## Fixtures & Test Data

### Shared Setup (`beforeEach`)

```typescript
beforeEach(() => {
  vi.clearAllMocks();

  // Default LLM config
  mockGetLLMConfig.mockResolvedValue({
    provider: "openai",
    apiKeys: { openai: "test-key" },
    model: "gpt-4",
  });

  // Default confidence threshold
  mockResolveConfigValue.mockImplementation((key: string) => {
    if (key === "confidence_threshold") return Promise.resolve("0.6");
    return Promise.resolve(null);
  });

  // Default embedding
  mockGenerateEmbedding.mockResolvedValue(
    Array.from({ length: 4096 }, (_, i) => Math.sin(i) * 0.5)
  );
});
```

### Mock SQL Pattern

For unit tests, mock SQL as a tagged template function that returns controlled results based on the query pattern:

```typescript
function createMockSql(responses: Map<string, unknown[]>) {
  return Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      for (const [pattern, result] of responses) {
        if (query.includes(pattern)) return Promise.resolve(result);
      }
      return Promise.resolve([]);
    },
    {} // additional properties as needed
  );
}
```

### Integration Test Setup

```typescript
import { startTestDb, runMigrations } from "../helpers/test-db.js";

let testDb: Awaited<ReturnType<typeof startTestDb>>;
let sql: postgres.Sql;

beforeAll(async () => {
  testDb = await startTestDb();
  sql = testDb.sql;
  await runMigrations(testDb.url);
}, 60_000);

afterAll(async () => {
  await testDb?.cleanup();
});

beforeEach(async () => {
  // Clean entries table between tests
  await sql`DELETE FROM entries`;
});
```

### Test Data Factories

Extend `tests/helpers/mock-llm.ts` with:

```typescript
export function createClassificationWithCompletion(
  overrides?: Partial<ClassificationResult & { is_task_completion: boolean }>
): ClassificationResult & { is_task_completion: boolean } {
  return {
    ...DEFAULT_CLASSIFICATION,
    is_task_completion: true,
    ...overrides,
  };
}

export function createTaskCompletionMatchResponse(
  matches: Array<{ entry_id: string; confidence: number }>
): string {
  return JSON.stringify({ matches });
}
```

Add a new helper file `tests/helpers/mock-tasks.ts`:

```typescript
export function createPendingTaskEntry(overrides?: Partial<{
  id: string; name: string; content: string;
}>) {
  return {
    id: overrides?.id ?? crypto.randomUUID(),
    name: overrides?.name ?? "Call landlord about Sendling",
    content: overrides?.content ?? "Call landlord about the Sendling apartment",
    category: "tasks",
    fields: { status: "pending", due_date: null, notes: null },
    tags: ["housing"],
    source: "telegram",
    source_type: "text",
  };
}

export function createDoneTaskEntry(overrides?: Partial<{
  id: string; name: string;
}>) {
  return {
    ...createPendingTaskEntry(overrides),
    fields: { status: "done", due_date: null, notes: null },
  };
}
```

## Alignment Check

**Full alignment.** Every test scenario (TS-1.1 through TS-7.1, TS-EC-1 through TS-EC-8, TS-C-1, TS-NG-1 through TS-NG-3) is mapped to a specific test function with setup, action, and assertion defined. Total: 38 test functions across 3 test files.

**Initial failure guarantee:** All tests reference functions (`detectTaskCompletion`, `findPendingTaskCandidates`, `matchCompletedTasks`, `applyTaskCompletions`) and schema changes (`is_task_completion` field) that do not yet exist. Every test will fail on import or when calling the non-existent functions.

**Design concerns:** None. All tests verify observable behavior (return values, DB state changes, function call counts) rather than internal implementation details. The mock SQL pattern tests query semantics via string matching, which is a pragmatic trade-off that the project already uses.
