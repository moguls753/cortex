# Web New Note - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Web New Note |
| Phase | 3 |
| Date | 2026-03-06 |
| Derives From | `web-new-note-test-specification.md` |

## Test Framework & Conventions

- **Framework:** Vitest (project standard)
- **Style:** `describe`/`it` blocks with explicit imports (`import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`)
- **HTTP testing:** Hono's built-in `app.request(url, init?)` — no real server needed
- **Module mocking:** `vi.mock()` for query functions, classification, and embedding modules
- **DB testing:** testcontainers with `pgvector/pgvector:pg16` for integration tests (existing `tests/helpers/test-db.ts`)
- **Auth reuse:** Login helper pattern from web-entry tests — POST `/login` and extract `Set-Cookie`

## Test Structure

### File Organization

```
tests/unit/web-new-note.test.ts                    # 20 unit tests (mocked queries)
tests/integration/web-new-note-integration.test.ts  # 4 integration tests (testcontainers)
```

**Unit tests** mock the data layer (`insertEntry`, `getAllTags`), classification (`classifyText`, `assembleContext`), and embedding (`embedEntry`). They test HTTP handler behavior — form rendering, API responses, validation, auth enforcement, edge cases.

**Integration tests** use testcontainers with real PostgreSQL + pgvector, seed data via SQL, and verify actual insert correctness (entry creation, tag storage, duplicate names, long content).

### Test Grouping

```typescript
// Unit tests
describe("Web New Note", () => {
  describe("Form Display (US-1)", () => { /* TS-1.1, TS-1.2 */ });
  describe("AI Suggest (US-2)", () => { /* TS-2.1, TS-2.2, TS-2.3, TS-2.4 */ });
  describe("Save Note (US-3)", () => { /* TS-3.2, TS-3.3, TS-3.4 */ });
  describe("Constraints", () => { /* TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5 */ });
  describe("Edge Cases", () => { /* TS-5.1, TS-5.2, TS-5.4, TS-5.6, TS-5.8, TS-5.9 */ });
});

// Integration tests
describe("Web New Note Integration", () => {
  describe("Save Note", () => { /* TS-3.1 */ });
  describe("Edge Cases", () => { /* TS-5.3, TS-5.5, TS-5.7 */ });
});
```

### Naming Convention

```typescript
it("shows new note form with all fields")                          // TS-1.1
it("includes existing tags for autocomplete")                       // TS-1.2
it("returns category and tags from classification API")             // TS-2.1
it("returns tags as array in API response")                         // TS-2.2
it("saves note with user-overridden values")                        // TS-2.3
it("returns fresh classification on re-invocation")                 // TS-2.4
it("saves entry with source webapp and confidence null")             // TS-3.2
it("populates default fields for selected category")                // TS-3.3
it("saves note with null embedding when Ollama is down")            // TS-3.4
it("returns server-rendered HTML")                                   // TS-4.1
it("redirects unauthenticated GET to login")                        // TS-4.2
it("redirects unauthenticated POST to login")                       // TS-4.3
it("rejects save with empty name")                                   // TS-4.4
it("saves note with title only and no content")                      // TS-5.1
it("saves note with no category as null")                            // TS-5.2
it("rejects AI Suggest with empty content")                          // TS-5.4
it("returns error when classification service is down")              // TS-5.6
it("includes beforeunload script in page")                           // TS-5.8
it("classifies with name only when content is empty")                // TS-5.9
it("redirects unauthenticated API classify to login")                // TS-4.5
it("creates entry with embedding and redirects to entry page")       // TS-3.1
it("saves very long content")                                        // TS-5.3
it("allows duplicate entry names")                                   // TS-5.5
it("normalizes tags to lowercase and trimmed")                       // TS-5.7
```

## Expected Module API

### New Note Routes (`src/web/new-note.ts`)

```typescript
export function createNewNoteRoutes(sql: Sql): Hono;
```

The factory returns a Hono sub-app with:
- `GET /new` — renders new note form (name, category dropdown, tags with `<datalist>` autocomplete, content textarea, Save button, AI Suggest button)
- `POST /new` — validates, inserts entry via `insertEntry`, generates embedding via `embedEntry`, redirects to `/entry/:id`
- `POST /api/classify` — AI Suggest JSON endpoint: accepts `{ name, content }`, calls `classifyText` + `assembleContext`, returns `{ category, tags }` as JSON

### Reused Modules

No new query module needed. The handler reuses:

- **`insertEntry(sql, data)`** from `src/web/dashboard-queries.ts` — inserts entry, returns ID
- **`getAllTags(sql)`** from `src/web/entry-queries.ts` — returns distinct tags for autocomplete
- **`classifyText(text, options?)`** from `src/classify.ts` — classification pipeline, returns `{ category, tags, ... }`
- **`assembleContext(sql, text)`** from `src/classify.ts` — gathers context entries for classification
- **`embedEntry(sql, entryId)`** from `src/embed.ts` — generates and stores embedding
- **`CATEGORY_FIELDS`** — reused from `src/web/entry.ts` or extracted to a shared constant. Maps category to default field names.
- **`migrateFields()`** — reused or inline: populates category-specific default fields on save

### Tag Autocomplete

Consistent with web-entry: tags are rendered inline as `<datalist>` options in the HTML. The `GET /new` handler calls `getAllTags(sql)` and passes the result to the template. No separate `/api/tags` endpoint.

### AI Suggest Endpoint

`POST /api/classify` accepts form-encoded or JSON body with `name` and `content` fields. The handler:
1. Validates that at least `name` is non-empty (rejects with error JSON if both empty)
2. Combines `name + "\n\n" + content` as input text
3. Calls `assembleContext(sql, text)` for context
4. Calls `classifyText(text, { contextEntries })` for classification
5. Returns JSON: `{ category: string, tags: string[] }` on success
6. Returns JSON: `{ error: string }` on failure (API down, invalid response)

### Tag Normalization

Tags are submitted as a comma-separated string. The handler uses the same `parseTags()` pattern from entry.ts, with additional normalization: `toLowerCase()` and `trim()`.

### Category Default Fields

When saving with a category, the handler populates default fields using `CATEGORY_FIELDS`:
```typescript
function defaultFields(category: string | null): Record<string, unknown> {
  if (!category || !CATEGORY_FIELDS[category]) return {};
  const result: Record<string, unknown> = {};
  for (const field of CATEGORY_FIELDS[category]) {
    result[field] = null;
  }
  return result;
}
```

For tasks, this produces `{ due_date: null, status: null, notes: null }`. Note: AC-3.3 says "e.g., `status: 'active'` for projects, `status: 'pending'` for tasks" — but looking at the existing `migrateFields` pattern, all defaults are `null`. The classification pipeline (`classifyText`) can return non-null defaults in its `fields`, but manual note creation uses null defaults. Tests should verify null defaults, matching `migrateFields` behavior.

## Test App Factory

### Unit Test Factory

```typescript
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestNewNote(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createNewNoteRoutes } = await import("../../src/web/new-note.js");

  const mockSql = {} as any; // Query functions are mocked via vi.mock()

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createNewNoteRoutes(mockSql));

  return { app };
}
```

### Login Helper (reused pattern)

```typescript
async function loginAndGetCookie(
  app: Hono,
  password = TEST_PASSWORD
): Promise<string> {
  const res = await app.request("/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
```

### Integration Test Factory

```typescript
import { startTestDb, runMigrations } from "../helpers/test-db.js";

let sql: Sql;
let container: StartedTestContainer;

beforeAll(async () => {
  const db = await startTestDb();
  container = db.container;
  sql = db.sql;
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

async function createIntegrationNewNote(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createNewNoteRoutes } = await import("../../src/web/new-note.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createNewNoteRoutes(sql));

  return { app };
}
```

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test File | Test Function |
|------------------|----------------|-----------|---------------|
| TS-1.1 | New note form shows all expected fields | unit | `it("shows new note form with all fields")` |
| TS-1.2 | Tag autocomplete provides existing tags | unit | `it("includes existing tags for autocomplete")` |
| TS-2.1 | AI Suggest returns category and tags | unit | `it("returns category and tags from classification API")` |
| TS-2.2 | AI Suggest appends tags to existing user tags | unit | `it("returns tags as array in API response")` |
| TS-2.3 | User can override AI suggestions | unit | `it("saves note with user-overridden values")` |
| TS-2.4 | Re-invoking AI Suggest replaces previous suggestions | unit | `it("returns fresh classification on re-invocation")` |
| TS-3.1 | Save creates entry with embedding and redirects | integration | `it("creates entry with embedding and redirects to entry page")` |
| TS-3.2 | Saved entry has source "webapp" and confidence null | unit | `it("saves entry with source webapp and confidence null")` |
| TS-3.3 | Save with category populates default fields | unit | `it("populates default fields for selected category")` |
| TS-3.4 | Save succeeds when Ollama is down | unit | `it("saves note with null embedding when Ollama is down")` |
| TS-4.1 | New note page returns server-rendered HTML | unit | `it("returns server-rendered HTML")` |
| TS-4.2 | Unauthenticated GET request redirected to login | unit | `it("redirects unauthenticated GET to login")` |
| TS-4.3 | Unauthenticated POST request redirected to login | unit | `it("redirects unauthenticated POST to login")` |
| TS-4.4 | Save with empty name returns validation error | unit | `it("rejects save with empty name")` |
| TS-4.5 | Unauthenticated API classify redirected to login | unit | `it("redirects unauthenticated API classify to login")` |
| TS-5.1 | Save note with title only (no content) | unit | `it("saves note with title only and no content")` |
| TS-5.2 | Save note with no category | unit | `it("saves note with no category as null")` |
| TS-5.3 | Very long note saves and generates embedding | integration | `it("saves very long content")` |
| TS-5.4 | AI Suggest with empty content shows warning | unit | `it("rejects AI Suggest with empty content")` |
| TS-5.5 | Duplicate name is allowed | integration | `it("allows duplicate entry names")` |
| TS-5.6 | AI Suggest when classification service is down | unit | `it("returns error when classification service is down")` |
| TS-5.7 | Tags are normalized on save | integration | `it("normalizes tags to lowercase and trimmed")` |
| TS-5.8 | Unsaved changes warning on navigation | unit | `it("includes beforeunload script in page")` |
| TS-5.9 | AI Suggest with name only succeeds | unit | `it("classifies with name only when content is empty")` |

## Detailed Scenario Implementation

### Group 1: Form Display (US-1)

#### TS-1.1: New note form shows all expected fields (unit)

- **Setup (Given):** Mock `getAllTags` to return `["work", "personal"]`. Create test app. Login.
- **Action (When):** `app.request("/new", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains:
  - An `<input` for name (type text)
  - A `<select` for category with options: empty/unselected, People, Projects, Tasks, Ideas, Reference
  - An `<input` for tags with a `<datalist`
  - A `<textarea` for content
  - A submit button (Save)
  - An "AI Suggest" button or element

#### TS-1.2: Tag autocomplete provides existing tags (unit)

- **Setup (Given):** Mock `getAllTags` to return `["work", "personal", "urgent"]`. Create test app. Login.
- **Action (When):** `app.request("/new", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains `<datalist` with `<option` elements for "work", "personal", "urgent".

---

### Group 2: AI Suggest (US-2)

#### TS-2.1: AI Suggest returns category and tags (unit)

- **Setup (Given):** Mock `assembleContext` to return `[]`. Mock `classifyText` to return `{ category: "ideas", name: "Test", confidence: 0.9, fields: {}, tags: ["ai-tag"], content: "test" }`. Create test app. Login.
- **Action (When):** `app.request("/api/classify", { method: "POST", body: new URLSearchParams({ name: "Test Note", content: "Some content" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 200. Content-Type is JSON. Body contains `{ category: "ideas", tags: ["ai-tag"] }`. Verify `classifyText` was called with text containing "Test Note" and "Some content". Verify `assembleContext` was called.

#### TS-2.2: AI Suggest returns tags as array in API response (unit)

- **Setup (Given):** Mock `assembleContext` to return `[]`. Mock `classifyText` to return `{ category: "projects", name: "P", confidence: 0.8, fields: {}, tags: ["tag-1", "tag-2", "tag-3"], content: "text" }`. Create test app. Login.
- **Action (When):** `app.request("/api/classify", { method: "POST", body: new URLSearchParams({ name: "Project", content: "Details" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response JSON has `tags` as an array containing exactly `["tag-1", "tag-2", "tag-3"]`.

Note: The "appending to existing user tags" behavior is client-side JavaScript. The server returns the AI-suggested tags; the client-side script merges them with user-entered tags. This test verifies the API returns the correct format for the client to consume.

#### TS-2.3: User can override AI suggestions (unit)

- **Setup (Given):** Mock `insertEntry` to return a UUID. Mock `embedEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "My Note", category: "projects", tags: "manual-tag", content: "stuff" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Verify `insertEntry` was called with `category: "projects"` and `tags: ["manual-tag"]` — i.e., whatever the user submitted, not any AI suggestion. The form submission is a standard POST; the server saves what the user sends.

Note: AI suggestions only pre-fill form fields client-side. The server has no notion of "AI-suggested vs user-entered" — it saves whatever the form submits. This test confirms that server-side save is agnostic to the suggestion source.

#### TS-2.4: Re-invoking AI Suggest returns fresh classification (unit)

- **Setup (Given):** Mock `assembleContext` to return `[]`. Mock `classifyText` to return different results on sequential calls: first `{ category: "ideas", tags: ["first-tag"] }`, then `{ category: "projects", tags: ["second-tag"] }`. Create test app. Login.
- **Action (When):** Call `POST /api/classify` twice with different content.
- **Assertion (Then):** First response has `category: "ideas"`, `tags: ["first-tag"]`. Second response has `category: "projects"`, `tags: ["second-tag"]`. Each invocation returns a fresh result.

Note: The "replacing previous AI suggestions but preserving user tags" is client-side JavaScript behavior. The server simply returns fresh classification each time. This test confirms the API is stateless — each call independently classifies.

---

### Group 3: Save Note (US-3)

#### TS-3.1: Save creates entry with embedding and redirects (integration)

- **Setup (Given):** Mock `embedEntry` to resolve (embedding generation). Create integration app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Integration Note", category: "ideas", tags: "test,integration", content: "Full integration save" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect (302/303). `Location` header matches `/entry/<uuid>` pattern. Query the DB: an entry exists with name "Integration Note", category "ideas", tags `["test", "integration"]`, content "Full integration save", source "webapp", confidence null. Verify `embedEntry` was called with the entry's ID.

#### TS-3.2: Saved entry has source "webapp" and confidence null (unit)

- **Setup (Given):** Mock `insertEntry` to return a UUID. Mock `embedEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Quick Note", content: "some text" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Verify `insertEntry` was called with an object containing `source: "webapp"` and `confidence: null`.

#### TS-3.3: Save with category populates default fields (unit)

- **Setup (Given):** Mock `insertEntry` to return a UUID. Mock `embedEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Project Alpha", category: "projects", content: "details" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Verify `insertEntry` was called with `fields` containing `{ status: null, next_action: null, notes: null }` (the projects schema defaults, all null for manual creation).

#### TS-3.4: Save succeeds when Ollama is down (unit)

- **Setup (Given):** Mock `insertEntry` to return a UUID. Mock `embedEntry` to throw an error (connection refused). Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Offline Note", content: "saved anyway" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect to `/entry/<uuid>` (save succeeded). Verify `insertEntry` was called (entry saved). Verify `embedEntry` was called and its error was caught (not propagated).

Note: The entry is saved first via `insertEntry`, then `embedEntry` is called afterward. If `embedEntry` throws, the entry is already in the DB with `embedding: null`. The handler catches the error and proceeds with the redirect.

---

### Group 4: Constraints

#### TS-4.1: New note page returns server-rendered HTML (unit)

- **Setup (Given):** Mock `getAllTags` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/new", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. `Content-Type` contains `text/html`. Body starts with `<!DOCTYPE html>` or `<html`.

#### TS-4.2: Unauthenticated GET request redirected to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/new")`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`.

#### TS-4.3: Unauthenticated POST request redirected to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Sneaky" }), headers: { "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`. Verify `insertEntry` was NOT called.

#### TS-4.5: Unauthenticated API classify redirected to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/api/classify", { method: "POST", body: new URLSearchParams({ name: "Test", content: "stuff" }), headers: { "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`. Verify `classifyText` was NOT called.

#### TS-4.4: Save with empty name returns validation error (unit)

- **Setup (Given):** Mock `insertEntry`. Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "", category: "tasks", content: "stuff" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status is not a redirect (stays on page or returns 400/422). Body contains a validation error message (matching "name" and "required" — case-insensitive). Verify `insertEntry` was NOT called.

---

### Group 5: Edge Cases

#### TS-5.1: Save note with title only (unit)

- **Setup (Given):** Mock `insertEntry` to return a UUID. Mock `embedEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Quick thought" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect. Verify `insertEntry` was called with `content: null` (or empty string). Verify `embedEntry` was called (embedding generated from name alone).

#### TS-5.2: Save note with no category (unit)

- **Setup (Given):** Mock `insertEntry` to return a UUID. Mock `embedEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Uncategorized", content: "no category selected" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Verify `insertEntry` was called with `category: null` and `fields: {}`.

#### TS-5.3: Very long note saves and generates embedding (integration)

- **Setup (Given):** Mock `embedEntry` to resolve. Create integration app. Login. Generate 10,000+ character content string.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Long Note", category: "reference", content: longContent }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect. Query the DB: the entry exists with the full content (length matches). Verify `embedEntry` was called.

#### TS-5.4: AI Suggest with empty content rejects (unit)

- **Setup (Given):** Create test app. Login.
- **Action (When):** `app.request("/api/classify", { method: "POST", body: new URLSearchParams({ name: "", content: "" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 400 (or 422). Response JSON contains an error message (e.g., `"Write some content first"`). Verify `classifyText` was NOT called.

#### TS-5.5: Duplicate name is allowed (integration)

- **Setup (Given):** Mock `embedEntry` to resolve. Create integration app. Login. Seed an entry with name "Meeting Notes".
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Meeting Notes", content: "different content" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect. Query the DB: two entries exist with name "Meeting Notes", each with a different UUID.

#### TS-5.6: AI Suggest when classification service is down (unit)

- **Setup (Given):** Mock `assembleContext` to return `[]`. Mock `classifyText` to return `null` (API failure). Create test app. Login.
- **Action (When):** `app.request("/api/classify", { method: "POST", body: new URLSearchParams({ name: "Test", content: "Some content" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 200 (or 503). Response JSON contains `{ error: "..." }` with a user-friendly message (e.g., "Classification service unavailable"). The response does NOT contain a stack trace.

#### TS-5.7: Tags are normalized on save (integration)

- **Setup (Given):** Mock `embedEntry` to resolve. Create integration app. Login.
- **Action (When):** `app.request("/new", { method: "POST", body: new URLSearchParams({ name: "Tag Test", tags: " Work , URGENT, my tag " }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Query the DB: the entry's tags are `["work", "urgent", "my tag"]` (lowercase, trimmed, whitespace-only segments removed).

#### TS-5.9: AI Suggest with name only succeeds (unit)

- **Setup (Given):** Mock `assembleContext` to return `[]`. Mock `classifyText` to return `{ category: "tasks", name: "Meeting", confidence: 0.8, fields: {}, tags: ["meeting"], content: "Meeting with team" }`. Create test app. Login.
- **Action (When):** `app.request("/api/classify", { method: "POST", body: new URLSearchParams({ name: "Meeting with team", content: "" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 200. Response JSON contains `{ category: "tasks", tags: ["meeting"] }`. Verify `classifyText` was called with text containing "Meeting with team".

Note: EC-4 says "If only the name is filled, AI Suggest can still classify based on the name." This test verifies that an empty content field does not trigger the "both empty" rejection (TS-5.4), and the API successfully classifies using the name alone.

#### TS-5.8: Unsaved changes warning on navigation (unit)

- **Setup (Given):** Mock `getAllTags` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/new", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains `beforeunload` in a `<script` block, confirming the page includes the unsaved changes warning JavaScript.

---

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
```

### Entry Factory (integration only)

Reuses `createMockEntry` pattern from web-entry tests for seeding existing entries (needed for TS-5.5 duplicate name):

```typescript
function createMockEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: crypto.randomUUID(),
    name: "Test Entry",
    category: "tasks",
    content: "Test content",
    fields: {},
    tags: [],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    deleted_at: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}
```

### Integration Test Data Seeding

```typescript
async function seedEntry(
  sql: Sql,
  overrides: Partial<EntryRow> = {}
): Promise<string> {
  const entry = createMockEntry(overrides);
  await sql`
    INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                         source, source_type, deleted_at, created_at, updated_at)
    VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
            ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
            ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
            ${entry.created_at}, ${entry.updated_at})
  `;
  return entry.id;
}

async function clearEntries(sql: Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}
```

### Shared Helpers

| Helper | Purpose | Scope |
|--------|---------|-------|
| `createTestNewNote()` | Unit: Hono app with mocked data layer + auth | Per-test |
| `createIntegrationNewNote()` | Integration: Hono app with real DB + auth | Per-test |
| `loginAndGetCookie(app, password?)` | Authenticates and returns session cookie string | Per-test |
| `createMockEntry(overrides?)` | Produces an entry object for seeding | Per-test |
| `seedEntry(sql, overrides?)` | Integration: inserts an entry into real DB | Per-test |
| `clearEntries(sql)` | Integration: deletes all entries between tests | Per-test |

### Mocking Strategy

**Unit tests mock three layers:**

1. **Insert + Tags** — Via `vi.mock()` on dashboard-queries and entry-queries:
   ```typescript
   vi.mock("../../src/web/dashboard-queries.js", () => ({
     insertEntry: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
     getRecentEntries: vi.fn().mockResolvedValue([]),
     getDashboardStats: vi.fn().mockResolvedValue({ entriesThisWeek: 0, openTasks: 0, stalledProjects: 0 }),
     getLatestDigest: vi.fn().mockResolvedValue(null),
   }));

   vi.mock("../../src/web/entry-queries.js", () => ({
     getAllTags: vi.fn().mockResolvedValue([]),
     getEntry: vi.fn().mockResolvedValue(null),
     updateEntry: vi.fn().mockResolvedValue(undefined),
     softDeleteEntry: vi.fn().mockResolvedValue(undefined),
     restoreEntry: vi.fn().mockResolvedValue(undefined),
   }));
   ```

2. **Classification** — Via `vi.mock()` on classify module:
   ```typescript
   vi.mock("../../src/classify.js", () => ({
     classifyText: vi.fn().mockResolvedValue(null),
     assembleContext: vi.fn().mockResolvedValue([]),
     classifyEntry: vi.fn().mockResolvedValue(undefined),
     reclassifyEntry: vi.fn().mockResolvedValue(null),
   }));
   ```

3. **Embedding** — Via `vi.mock()` on embed module:
   ```typescript
   vi.mock("../../src/embed.js", () => ({
     embedEntry: vi.fn().mockResolvedValue(undefined),
     generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
   }));
   ```

Each test overrides return values via `mockResolvedValue()` or `mockResolvedValueOnce()`.

**Integration tests mock only the embedding service:**
- `embedEntry` — mocked via `vi.mock()` (Ollama not available in CI)
- Database — real testcontainers PostgreSQL + pgvector, no mocks
- Classification — not used in save flow (only in AI Suggest endpoint), not mocked

### Setup / Teardown

```typescript
// Unit tests
beforeEach(async () => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Integration tests
beforeEach(async () => {
  await clearEntries(sql);
  vi.clearAllMocks();
});
```

## Client-Side Behavior Notes

Several test scenarios (TS-2.2 tag appending, TS-2.4 replacing previous suggestions, TS-5.4 empty content warning, TS-5.8 beforeunload) describe **client-side JavaScript behavior** that cannot be fully tested via server-side HTTP request/response testing.

The test implementation strategy for these is:

| Scenario | Server-Side Test | Client-Side Behavior |
|----------|-----------------|---------------------|
| TS-2.2 | Verify API returns `tags` array format | Client JS appends to existing tags |
| TS-2.4 | Verify API returns fresh result per call | Client JS replaces previous AI tags |
| TS-5.4 | Verify API rejects empty name+content (400) | Client JS can also prevent call pre-submit |
| TS-5.8 | Verify page HTML contains `beforeunload` script | Browser handles the dialog |

This approach tests the server contract that the client depends on, plus verifies the client-side scripts are present in the rendered HTML. Full client-side interaction testing would require a browser-based tool (e.g., Playwright), which is out of scope for this feature.

## Alignment Check

**Status: Full alignment.**

All 24 test scenarios from the test specification (TS-1.1 through TS-5.9) are mapped to test functions with setup, action, and assertion strategies defined. Split: 20 unit tests + 4 integration tests.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (24/24) |
| One behavior per test | Yes |
| All tests will initially fail | Yes (see notes below) |
| Test isolation verified | Yes (per-test factory, `clearEntries` between integration tests) |
| No implementation coupling | Yes (tests verify observable HTTP behavior + mock call verification) |

### Notes

1. **TS-4.2 / TS-4.3** (auth enforcement) may pass early if auth middleware is already wired but will fail if the route is not mounted — the test checks for 302 redirect to `/login`, which requires the route to exist and be handled by auth middleware.

2. **TS-2.3** (user override) is essentially a standard save test. It confirms the server saves whatever the user submits, regardless of any prior AI suggestion. The "override" is a client-side concern — the server is agnostic.

3. **TS-3.4** (Ollama down) — the handler must call `embedEntry` after `insertEntry` and catch any error from `embedEntry`. The entry is already saved before embedding is attempted, so the redirect should still happen. The test mocks `embedEntry` to throw and verifies the redirect occurs.

4. **TS-5.4** (empty content) — the `POST /api/classify` endpoint validates that at least `name` is non-empty before calling `classifyText`. If both are empty, it returns 400 with an error message. The client-side can also prevent the call, but server-side validation is the authoritative check.

5. **Null guard pattern** — consistent with web-entry and web-browse: `(await getAllTags(sql)) ?? []` to handle `vi.clearAllMocks()` resetting mock implementations from `vi.mock()` factory.
