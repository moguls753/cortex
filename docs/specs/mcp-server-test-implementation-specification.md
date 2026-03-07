# MCP Server - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | MCP Server |
| Phase | 3 |
| Date | 2026-03-07 |
| Status | Draft |
| Source | `mcp-server-test-specification.md` |

## Test Framework & Conventions

- **Framework:** Vitest 3.x (project standard)
- **Style:** `describe`/`it` blocks with `expect` assertions
- **Mocking:** `vi.mock()` for module mocks (hoisted), `vi.fn()` for individual functions
- **Test layout:** `tests/unit/` and `tests/integration/` (project convention)
- **Helpers:** Existing `tests/helpers/` (test-db.ts, mock-ollama.ts, mock-llm.ts, env.ts)
- **New dependency:** `@modelcontextprotocol/sdk` (install in Phase 4)

## Test Structure

### Files

| File | Scenarios | Count |
|------|-----------|-------|
| `tests/unit/mcp-server.test.ts` | TS-1.1, 1.3, 1.4, 1.6–1.10, TS-2.1–2.5, TS-3.1–3.3, 3.5, TS-4.1–4.4, TS-5.1–5.2b, 5.3–5.10, TS-6.1–6.4, TS-8.1–8.2, TS-9.3–9.4, TS-10.1–10.3 | 43 |
| `tests/integration/mcp-server-integration.test.ts` | TS-1.2, 1.5, TS-3.4, TS-6.5, TS-7.1–7.3, TS-8.3, TS-9.1–9.2 | 10 |

**Total: 53 test functions** (43 unit + 10 integration) covering all 53 scenarios.

### Grouping

Unit tests are organized in `describe` blocks mirroring the test specification groups:

```
describe("MCP Server")
  describe("search_brain")     — TS-1.1, 1.3, 1.4, 1.6–1.10
  describe("add_thought")      — TS-2.1–2.5
  describe("list_recent")      — TS-3.1–3.3, 3.5
  describe("get_entry")        — TS-4.1–4.4
  describe("update_entry")     — TS-5.1–5.2b, 5.3–5.10
  describe("delete_entry")     — TS-6.1–6.4
  describe("stdio transport")  — TS-8.1, 8.2
  describe("HTTP transport")   — TS-9.3, 9.4
  describe("constraints")      — TS-10.1–10.3
```

Integration tests:

```
describe("MCP Server Integration")
  describe("search_brain")     — TS-1.2, 1.5
  describe("list_recent")      — TS-3.4
  describe("delete_entry")     — TS-6.5
  describe("brain_stats")      — TS-7.1–7.3
  describe("stdio transport")  — TS-8.3
  describe("HTTP transport")   — TS-9.1, 9.2
```

## Expected Source Modules

These modules do not exist yet. Tests will fail with `ERR_MODULE_NOT_FOUND` until Phase 5.

| Module | Exports | Purpose |
|--------|---------|---------|
| `src/mcp-tools.ts` | `createMcpServer(sql)`, `handleSearchBrain(sql, params)`, `handleAddThought(sql, params)`, `handleListRecent(sql, params)`, `handleGetEntry(sql, params)`, `handleUpdateEntry(sql, params)`, `handleDeleteEntry(sql, params)`, `handleBrainStats(sql)` | MCP server factory + exported handler functions for direct testing |
| `src/mcp-queries.ts` | `searchBySimilarity(sql, embedding, limit)`, `insertMcpEntry(sql, data)`, `listRecentEntries(sql, days, category?)`, `getEntryById(sql, id)`, `updateEntryFields(sql, id, updates)`, `softDeleteEntry(sql, id)`, `getBrainStats(sql)` | DB query layer (mockable) |
| `src/mcp.ts` | Side-effect entrypoint (stdio) | `node dist/mcp.js` entrypoint |

### Handler Function Signature

Each `handle*` function returns an MCP-compatible result:

```ts
interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
```

Success results: `{ content: [{ type: "text", text: JSON.stringify(data) }] }`
Error results: `{ content: [{ type: "text", text: "Error message" }], isError: true }`

Unit tests call handler functions directly. Integration tests call through the MCP `Server` via `Client` + in-memory transport.

## Test Scenario Mapping

### Unit Tests — `tests/unit/mcp-server.test.ts`

#### search_brain

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-1.1 | `it("returns ranked results with correct shape")` | Mock `generateEmbedding` → fake vector. Mock `searchBySimilarity` → 3 entries with similarity scores (0.95, 0.8, 0.6), one with content > 500 chars. | `handleSearchBrain(sql, { query: "machine learning" })` | Result is not error. Parsed JSON is array of 3. Each has `id`, `category`, `name`, `content`, `tags`, `similarity`, `created_at`. Content is truncated to 500 chars. Order is by similarity desc. |
| TS-1.3 | `it("respects custom limit")` | Mock `generateEmbedding` → fake vector. Mock `searchBySimilarity` → 3 results. | `handleSearchBrain(sql, { query: "test", limit: 3 })` | `searchBySimilarity` called with limit=3. |
| TS-1.4 | `it("clamps limit above 50 to 50")` | Mock `generateEmbedding` → fake vector. Mock `searchBySimilarity` → []. | `handleSearchBrain(sql, { query: "test", limit: 100 })` | `searchBySimilarity` called with limit=50. |
| TS-1.6 | `it("returns error for empty query")` | No mocks needed. | `handleSearchBrain(sql, { query: "" })` then `{ query: "   " }` | Result `isError: true`, text is "Query cannot be empty" for both empty string and whitespace-only. |
| TS-1.7 | `it("returns error when Ollama is unavailable")` | Mock `generateEmbedding` → throws Error. | `handleSearchBrain(sql, { query: "test" })` | Result `isError: true`, text is "Embedding service unavailable". |
| TS-1.8 | `it("returns empty array when no matches above threshold")` | Mock `generateEmbedding` → fake vector. Mock `searchBySimilarity` → []. | `handleSearchBrain(sql, { query: "niche topic" })` | Result is not error. Parsed JSON is empty array. |
| TS-1.9 | `it("returns empty array for empty database")` | Mock `generateEmbedding` → fake vector. Mock `searchBySimilarity` → []. | `handleSearchBrain(sql, { query: "anything" })` | Result is not error. Parsed JSON is empty array. |
| TS-1.10 | `it("uses default limit for zero or negative values")` | Mock `generateEmbedding` → fake vector. Mock `searchBySimilarity` → []. | `handleSearchBrain(sql, { query: "test", limit: 0 })` then `limit: -5` | `searchBySimilarity` called with limit=10 both times. |

#### add_thought

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-2.1 | `it("captures thought with classification and embedding")` | Mock `classifyText` → `{ category: "people", name: "Sarah Meeting", confidence: 0.9, fields: {}, tags: ["work"] }`. Mock `assembleContext` → context string. Mock `generateEmbedding` → fake vector. Mock `insertMcpEntry` → entry with UUID. | `handleAddThought(sql, { text: "Met with Sarah about Q3" })` | Result is not error. Parsed JSON has `id` (UUID), `category: "people"`, `name: "Sarah Meeting"`, `confidence: 0.9`, `tags: ["work"]`. `insertMcpEntry` called with `source: "mcp"`, `source_type: "text"`. `assembleContext` called (context-aware pipeline). |
| TS-2.2 | `it("returns error for empty text")` | No mocks needed. | `handleAddThought(sql, { text: "" })` | Result `isError: true`, text is "Text cannot be empty". Also test whitespace-only: `{ text: "   " }`. |
| TS-2.3 | `it("stores unclassified entry when Claude is unavailable")` | Mock `classifyText` → throws Error. Mock `generateEmbedding` → fake vector. Mock `insertMcpEntry` → entry. | `handleAddThought(sql, { text: "Some thought" })` | Result is not error. Parsed JSON has `category: null`, `confidence: null`. `insertMcpEntry` called with `category: null`, `confidence: null`, `fields: {}`. Embedding still generated. |
| TS-2.4 | `it("stores unclassified entry when Claude returns malformed JSON")` | Mock `classifyText` → throws SyntaxError (or returns null). Mock `generateEmbedding` → fake vector. Mock `insertMcpEntry` → entry. | `handleAddThought(sql, { text: "Some thought" })` | Same as TS-2.3: `category: null`, `confidence: null`. |
| TS-2.5 | `it("stores entry without embedding when Ollama is unavailable")` | Mock `classifyText` → valid classification. Mock `generateEmbedding` → throws Error (or returns null). Mock `insertMcpEntry` → entry. | `handleAddThought(sql, { text: "Some thought" })` | Result is not error. Has valid `category`, `name`, `confidence`, `tags`. `insertMcpEntry` called with `embedding: null`. |

#### list_recent

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-3.1 | `it("lists recent entries with defaults")` | Mock `listRecentEntries` → 3 entries with varied dates. | `handleListRecent(sql, {})` | Result is not error. Parsed JSON is array of 3. Each has `id`, `category`, `name`, `tags`, `created_at`, `updated_at`. Does NOT include `content` or `fields`. `listRecentEntries` called with `days=7`, `category=undefined`. |
| TS-3.2 | `it("filters by category")` | Mock `listRecentEntries` → 2 task entries. | `handleListRecent(sql, { category: "tasks" })` | `listRecentEntries` called with `category="tasks"`. All returned entries have `category: "tasks"`. |
| TS-3.3 | `it("returns error for invalid category")` | No mocks needed. | `handleListRecent(sql, { category: "invalid_category" })` | Result `isError: true`, text is "Invalid category". |
| TS-3.5 | `it("accepts custom days parameter")` | Mock `listRecentEntries` → entries. | `handleListRecent(sql, { days: 5 })` | `listRecentEntries` called with `days=5`. |

#### get_entry

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-4.1 | `it("returns full entry")` | Mock `getEntryById` → full entry object. | `handleGetEntry(sql, { id: "<valid-uuid>" })` | Result is not error. Parsed JSON has all fields: `id`, `category`, `name`, `content`, `fields`, `tags`, `confidence`, `source`, `source_type`, `created_at`, `updated_at`. |
| TS-4.2 | `it("returns error for nonexistent entry")` | Mock `getEntryById` → null. | `handleGetEntry(sql, { id: "<valid-uuid>" })` | Result `isError: true`, text is "Entry not found". |
| TS-4.3 | `it("returns error for soft-deleted entry")` | Mock `getEntryById` → entry with `deleted_at` set. | `handleGetEntry(sql, { id: "<valid-uuid>" })` | Result `isError: true`, text is "Entry has been deleted". |
| TS-4.4 | `it("returns error for invalid UUID format")` | No mocks needed. | `handleGetEntry(sql, { id: "not-a-uuid" })` | Result `isError: true`, text is "Invalid entry ID". |

#### update_entry

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-5.1 | `it("updates only provided fields")` | Mock `getEntryById` → entry with name "Old Name", content "Old content". Mock `updateEntryFields` → updated entry. | `handleUpdateEntry(sql, { id: "<uuid>", name: "New Name" })` | `updateEntryFields` called with `{ name: "New Name" }` only (no content). Result includes all entry fields. |
| TS-5.2 | `it("re-embeds on content change")` | Mock `getEntryById` → entry. Mock `generateEmbedding` → new vector. Mock `updateEntryFields` → updated entry. | `handleUpdateEntry(sql, { id: "<uuid>", content: "New content" })` | `generateEmbedding` called with "New content". `updateEntryFields` called with updated embedding. |
| TS-5.2b | `it("re-embeds on name change")` | Mock `getEntryById` → entry with name "Old Name". Mock `generateEmbedding` → new vector. Mock `updateEntryFields` → updated entry. | `handleUpdateEntry(sql, { id: "<uuid>", name: "New Name" })` | `generateEmbedding` called. `updateEntryFields` called with updated embedding. Content unchanged. |
| TS-5.3 | `it("preserves existing fields on category change without fields")` | Mock `getEntryById` → entry with `category: "tasks"`, `fields: { status: "pending" }`. Mock `updateEntryFields` → updated entry. | `handleUpdateEntry(sql, { id: "<uuid>", category: "ideas" })` | `updateEntryFields` called with `category: "ideas"` but fields NOT cleared — existing fields preserved. |
| TS-5.4 | `it("returns error for nonexistent entry")` | Mock `getEntryById` → null. | `handleUpdateEntry(sql, { id: "<valid-uuid>", name: "Test" })` | Result `isError: true`, text is "Entry not found". |
| TS-5.5 | `it("returns error for soft-deleted entry")` | Mock `getEntryById` → entry with `deleted_at` set. | `handleUpdateEntry(sql, { id: "<uuid>", name: "Test" })` | Result `isError: true`, text is "Entry has been deleted". `updateEntryFields` NOT called. |
| TS-5.6 | `it("returns error for invalid UUID")` | No mocks needed. | `handleUpdateEntry(sql, { id: "not-a-uuid", name: "Test" })` | Result `isError: true`, text is "Invalid entry ID". |
| TS-5.7 | `it("returns error for invalid category")` | Mock `getEntryById` → entry. | `handleUpdateEntry(sql, { id: "<uuid>", category: "invalid" })` | Result `isError: true`, text is "Invalid category". |
| TS-5.8 | `it("does not re-embed when only tags change")` | Mock `getEntryById` → entry. Mock `updateEntryFields` → updated entry. | `handleUpdateEntry(sql, { id: "<uuid>", tags: ["new-tag"] })` | `generateEmbedding` NOT called. Tags updated in result. |
| TS-5.9 | `it("returns entry unchanged for empty update")` | Mock `getEntryById` → entry. | `handleUpdateEntry(sql, { id: "<uuid>" })` | Result is not error. Entry returned as-is. `updateEntryFields` NOT called (or called with empty update). |
| TS-5.10 | `it("updates content but nullifies embedding when Ollama is down")` | Mock `getEntryById` → entry. Mock `generateEmbedding` → throws Error. Mock `updateEntryFields` → updated entry. | `handleUpdateEntry(sql, { id: "<uuid>", content: "New content" })` | Content updated. `updateEntryFields` called with `embedding: null`. Result is not error. |

#### delete_entry

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-6.1 | `it("soft deletes an active entry")` | Mock `getEntryById` → active entry (no `deleted_at`). Mock `softDeleteEntry` → success. | `handleDeleteEntry(sql, { id: "<uuid>" })` | Result is not error. Text is "Entry deleted". `softDeleteEntry` called with the UUID. |
| TS-6.2 | `it("returns error for nonexistent entry")` | Mock `getEntryById` → null. | `handleDeleteEntry(sql, { id: "<valid-uuid>" })` | Result `isError: true`, text is "Entry not found". |
| TS-6.3 | `it("returns error for already-deleted entry")` | Mock `getEntryById` → entry with `deleted_at` set. | `handleDeleteEntry(sql, { id: "<uuid>" })` | Result `isError: true`, text is "Entry is already deleted". `softDeleteEntry` NOT called. |
| TS-6.4 | `it("returns error for invalid UUID")` | No mocks needed. | `handleDeleteEntry(sql, { id: "not-a-uuid" })` | Result `isError: true`, text is "Invalid entry ID". |

#### stdio transport

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-8.1 | `it("creates MCP server configured for stdio")` | None — test module import. | `import { createMcpServer }` and call it with mock sql. | Returns an MCP `Server` instance. |
| TS-8.2 | `it("registers all 7 tools with descriptions and schemas")` | Create server via `createMcpServer(mockSql)`. | Inspect registered tools (via server's tool listing or `listTools` request). | Exactly 7 tools: `search_brain`, `add_thought`, `list_recent`, `get_entry`, `update_entry`, `delete_entry`, `brain_stats`. Each has a non-empty description and input schema. |

#### HTTP transport

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-9.3 | `it("returns 401 for unauthenticated request")` | Create Hono app with auth middleware and MCP route at `/mcp`. | `app.request("/mcp", { method: "POST" })` with no cookie. | Response status is 401. |
| TS-9.4 | `it("returns 401 for expired session cookie")` | Create Hono app. Generate an expired session cookie (issued_at > 30 days ago). | `app.request("/mcp", { method: "POST", headers: { cookie: expiredCookie } })` | Response status is 401. |

#### constraints

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-10.1 | `it("does not expose database internals in error messages")` | Mock `getEntryById` → throws Error("connection refused"). Mock other queries to throw various DB errors. | Call each handler that can produce errors. | No error text contains SQL keywords (`SELECT`, `INSERT`, `FROM`, `WHERE`, `entries`, `pg_`, `ECONNREFUSED`). All errors are user-facing strings from the spec. |
| TS-10.2 | `it("advertises tools capability only")` | Create server via `createMcpServer(mockSql)`. | Inspect server capabilities. | `tools` capability is present. No `resources`, `prompts`, or `sampling` capabilities. |
| TS-10.3 | `it("uses snake_case tool names")` | Create server via `createMcpServer(mockSql)`. | List tool names. | All names match: `search_brain`, `add_thought`, `list_recent`, `get_entry`, `update_entry`, `delete_entry`, `brain_stats`. All pass `/^[a-z_]+$/` regex. |

### Integration Tests — `tests/integration/mcp-server-integration.test.ts`

All integration tests use testcontainers (`pgvector/pgvector:pg16`) with real DB and mocked external services (Ollama via `vi.spyOn(globalThis, 'fetch')`, LLM via `vi.mock`).

| ID | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|----|--------------|---------------|---------------|------------------|
| TS-1.2 | `it("excludes results below similarity threshold")` | Seed 3 entries with controlled embeddings: one similar (cosine >= 0.5), one dissimilar (cosine < 0.5), one borderline. Mock fetch for Ollama embed → query vector. | Call `searchBySimilarity` (or full tool via handler). | Only the similar entry is returned. Dissimilar entry excluded. |
| TS-1.5 | `it("excludes soft-deleted entries from search results")` | Seed 2 entries with similar embeddings. Soft-delete one. Mock fetch for Ollama embed → query vector. | Call `searchBySimilarity`. | Only the non-deleted entry is returned. |
| TS-3.4 | `it("excludes soft-deleted entries from listing")` | Seed 3 recent entries. Soft-delete one. | Call `listRecentEntries`. | Only 2 entries returned. Deleted entry excluded. |
| TS-6.5 | `it("deletes just-created entry successfully")` | Insert an entry, immediately call soft delete. | Call `softDeleteEntry` on the just-inserted entry. | Entry has `deleted_at` set. No error. |
| TS-7.1 | `it("computes statistics from populated database")` | Seed entries: 3 people, 2 tasks (1 pending), 1 project (active, updated > 5 days ago), 1 soft-deleted idea. | Call `getBrainStats`. | `total_entries: 6` (excludes deleted). `by_category` has all 5 categories with correct counts. `open_tasks: 1`. `stalled_projects: 1`. `entries_this_week` correct. `recent_activity` has 7 entries. |
| TS-7.2 | `it("excludes soft-deleted entries from all stats")` | Seed 3 entries. Soft-delete 2. | Call `getBrainStats`. | `total_entries: 1`. Deleted entries not in any count. |
| TS-7.3 | `it("returns all zeros for empty database")` | Empty database (no entries). | Call `getBrainStats`. | `total_entries: 0`, all categories 0, `entries_this_week: 0`, `open_tasks: 0`, `stalled_projects: 0`, `recent_activity` has 7 days each with `count: 0`. |
| TS-8.3 | `it("returns tool-level error when database is unavailable")` | Create MCP server with a broken sql connection (closed/invalid). | Call any tool handler (e.g., `handleBrainStats`). | Returns error result (not a crash). Error message is user-facing (e.g., "Database unavailable"). MCP server remains functional. |
| TS-9.1 | `it("serves MCP endpoint at /mcp with Streamable HTTP transport")` | Create full Hono app with auth and MCP routes. Log in to get session cookie. | Send valid MCP protocol request (e.g., `listTools`) to `/mcp` with session cookie. | Response is valid MCP protocol response listing 7 tools. |
| TS-9.2 | `it("processes authenticated MCP tool call")` | Create full Hono app with DB. Log in to get session cookie. Seed an entry. | Send MCP `callTool` request for `brain_stats` to `/mcp` with session cookie. | Response contains valid stats result. |

## Fixtures & Test Data

### Shared Helpers

**`createMockEntry(overrides?)`** — Factory for entry objects used in unit test mocks:
```ts
function createMockEntry(overrides?: Partial<EntryRow>): EntryRow {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    category: "people",
    name: "Test Entry",
    content: "Test content",
    fields: {},
    tags: ["test"],
    confidence: 0.9,
    source: "mcp",
    source_type: "text",
    deleted_at: null,
    created_at: new Date("2026-03-01T10:00:00Z"),
    updated_at: new Date("2026-03-01T10:00:00Z"),
    ...overrides,
  };
}
```

**`createMockSearchResult(overrides?)`** — Factory for search results (includes `similarity`):
```ts
function createMockSearchResult(overrides?) {
  return {
    ...createMockEntry(overrides),
    similarity: 0.85,
    ...overrides,
  };
}
```

**`VALID_UUID`** / **`NONEXISTENT_UUID`** — Constants for test UUIDs:
```ts
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const NONEXISTENT_UUID = "00000000-0000-0000-0000-000000000000";
```

### Unit Test Setup

```ts
// Module mocks (hoisted)
vi.mock("../../src/mcp-queries.js", () => ({
  searchBySimilarity: vi.fn().mockResolvedValue([]),
  insertMcpEntry: vi.fn(),
  listRecentEntries: vi.fn().mockResolvedValue([]),
  getEntryById: vi.fn().mockResolvedValue(null),
  updateEntryFields: vi.fn(),
  softDeleteEntry: vi.fn(),
  getBrainStats: vi.fn(),
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn(),
  assembleContext: vi.fn().mockResolvedValue(""),
}));

const mockSql = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
});
```

### Integration Test Setup

```ts
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
  await runMigrations(db.url);
}, 60_000);

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.sql`DELETE FROM entries`;
});
```

**`seedEntry(sql, overrides?)`** — Insert a test entry directly into the database:
```ts
async function seedEntry(sql, overrides = {}) {
  const defaults = {
    name: "Test Entry",
    content: "Test content",
    category: "people",
    fields: JSON.stringify({}),
    tags: ["test"],
    source: "mcp",
    source_type: "text",
    confidence: 0.9,
    ...overrides,
  };
  const [row] = await sql`
    INSERT INTO entries (name, content, category, fields, tags, source, source_type, confidence)
    VALUES (${defaults.name}, ${defaults.content}, ${defaults.category},
            ${defaults.fields}::jsonb, ${defaults.tags}, ${defaults.source},
            ${defaults.source_type}, ${defaults.confidence})
    RETURNING *
  `;
  return row;
}
```

**Controlled embeddings** for cosine similarity tests — reuse pattern from web-browse:
```ts
// Unit vector pointing in one direction (similar to query)
function createSimilarEmbedding(): number[] {
  const v = new Array(1024).fill(0);
  v[0] = 1.0;
  return v;
}

// Unit vector pointing in orthogonal direction (dissimilar)
function createDissimilarEmbedding(): number[] {
  const v = new Array(1024).fill(0);
  v[512] = 1.0;
  return v;
}
```

### Mocking Strategy

| Dependency | Unit Approach | Integration Approach |
|-----------|--------------|---------------------|
| PostgreSQL (sql) | `mockSql = {} as any` — query module is fully mocked | Real DB via testcontainers |
| mcp-queries | `vi.mock()` — all functions mocked | Real implementations against test DB |
| embed.ts (`generateEmbedding`) | `vi.mock()` — returns fake vector or throws | `vi.spyOn(globalThis, 'fetch')` — mock Ollama HTTP |
| classify.ts (`classifyText`, `assembleContext`) | `vi.mock()` — returns classification or throws | `vi.mock()` — still mocked (no real LLM in tests) |
| MCP SDK | Direct handler calls (unit), Client+transport (integration) | In-memory transport for TS-9.1/9.2 |
| Auth (Hono middleware) | Hono `app.request()` with/without cookies | Same pattern |

### HTTP Transport Test Helper

For TS-9.3/9.4 (unit) and TS-9.1/9.2 (integration), a helper creates the full Hono app:

```ts
async function createTestApp(sql?) {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  // MCP HTTP route import — exact module TBD in Phase 5
  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  // Mount MCP HTTP endpoint at /mcp
  return app;
}
```

Login + cookie helper reuses the established pattern from other web tests (`loginAndGetCookie`).

## Open Decisions for Phase 5

1. **MCP SDK tool inspection API:** How to list registered tools from a `Server` instance for TS-8.2, TS-10.2, TS-10.3. The SDK may expose this via `server.listTools()` or we may need to connect a `Client` via in-memory transport and call `client.listTools()`.

2. **HTTP transport wiring:** How `StreamableHTTPServerTransport` integrates with Hono routes. May be a single POST handler at `/mcp` or multiple routes. Tests for TS-9.1/9.2 need to send valid MCP protocol messages — the exact message format depends on the SDK version.

3. **`getEntryById` return contract:** Whether it returns the entry with `deleted_at` included (letting handlers check it) or returns null for deleted entries with a separate `getEntryIncludingDeleted` function. The handler tests assume the query returns entries regardless of deletion status, and the handler checks `deleted_at`.

4. **`handleBrainStats` signature:** Takes `sql` only (no params) vs `(sql, {})` for consistency. Tests assume `handleBrainStats(sql)`.

These decisions affect test setup details but not scenario coverage. They will be resolved during Phase 5 implementation.

## Alignment Check

**Full alignment achieved.** Every test scenario from the test specification maps to exactly one test function:

- 43 unit test functions in `tests/unit/mcp-server.test.ts`
- 10 integration test functions in `tests/integration/mcp-server-integration.test.ts`
- Total: 53 test functions covering all 53 scenarios

**No gaps.** All scenarios have setup, action, and assertion defined.

**No implementation coupling.** All tests verify observable behavior (return values, error messages, function call arguments). No tests assert internal data structures or private methods.

**Initial failure guarantee.** All tests import from `src/mcp-tools.ts`, `src/mcp-queries.ts`, or `src/mcp.ts` which do not exist yet. Tests will fail with `ERR_MODULE_NOT_FOUND` until Phase 5.
