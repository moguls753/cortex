# Web Entry - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Web Entry |
| Phase | 3 |
| Date | 2026-03-06 |
| Derives From | `web-entry-test-specification.md` |

## Test Framework & Conventions

- **Framework:** Vitest (project standard)
- **Style:** `describe`/`it` blocks with explicit imports (`import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`)
- **HTTP testing:** Hono's built-in `app.request(url, init?)` — no real server needed
- **Module mocking:** `vi.mock()` for query functions and embedding module
- **Env var control:** `tests/helpers/env.ts` (`withEnv`, `setRequiredEnvVars`, `clearAllConfigEnvVars`)
- **DB testing:** testcontainers with `pgvector/pgvector:pg16` for integration tests (existing `tests/helpers/test-db.ts`)
- **Auth reuse:** Login helper pattern from `web-auth.test.ts` — POST `/login` and extract `Set-Cookie`
- **Markdown:** Server-side rendering via a lightweight library (e.g., marked, markdown-it)

## Test Structure

### File Organization

```
tests/unit/web-entry.test.ts                    # 20 unit tests (mocked queries)
tests/integration/web-entry-integration.test.ts  # 7 integration tests (testcontainers)
```

**Unit tests** mock the data layer (entry query functions, `generateEmbedding`) and test HTTP handler behavior — HTML rendering, form display, validation, auth enforcement, edge case rendering.

**Integration tests** use testcontainers with real PostgreSQL + pgvector, seed data via SQL, and verify actual query correctness (entry CRUD, embedding re-generation, confidence nulling, category field migration, soft-delete + restore).

### Test Grouping

```typescript
// Unit tests
describe("Web Entry", () => {
  describe("View Entry (US-1)", () => { /* TS-1.1, TS-1.2, TS-1.3, TS-1.4, TS-1.5 */ });
  describe("Edit Entry (US-2)", () => { /* TS-2.1, TS-2.2, TS-2.4 */ });
  describe("Delete Entry (US-3)", () => { /* TS-3.1, TS-3.2, TS-3.3 */ });
  describe("Constraints", () => { /* TS-4.1, TS-4.2, TS-4.3 */ });
  describe("Edge Cases", () => { /* TS-5.1, TS-5.2, TS-5.5, TS-5.6, TS-5.7, TS-5.9 */ });
});

// Integration tests
describe("Web Entry Integration", () => {
  describe("Save Entry", () => { /* TS-2.3, TS-2.5, TS-2.6 */ });
  describe("Restore", () => { /* TS-1.6 */ });
  describe("Edge Cases", () => { /* TS-5.3, TS-5.4, TS-5.8 */ });
});
```

### Naming Convention

Test names mirror scenario titles from the test specification:

```typescript
it("displays all entry fields")                                    // TS-1.1
it("renders markdown content to HTML")                              // TS-1.2
it("returns 404 for invalid UUID")                                  // TS-1.3
it("returns 404 for valid UUID with no matching row")               // TS-1.4
it("shows deleted badge and restore option for soft-deleted entry") // TS-1.5
it("clears deleted_at when restoring entry")                        // TS-1.6
it("shows edit form with pre-populated values")                     // TS-2.1
it("shows category-specific fields in edit form")                   // TS-2.2
it("updates entry and changes updated_at")                          // TS-2.3
it("rejects save with empty name")                                  // TS-2.4
it("re-generates embedding on save")                                // TS-2.5
it("sets confidence to null on save")                               // TS-2.6
it("shows delete button with confirmation dialog")                  // TS-3.1
it("redirects to referrer after deletion")                          // TS-3.2
it("redirects to dashboard after deletion without referrer")        // TS-3.3
```

## Expected Module API

### Entry Routes (`src/web/entry.ts`)

```typescript
export function createEntryRoutes(sql: Sql): Hono;
```

The factory returns a Hono sub-app with:
- `GET /entry/:id` — renders entry view page
- `GET /entry/:id/edit` — renders edit form
- `POST /entry/:id/edit` — saves edits
- `POST /entry/:id/delete` — soft-deletes entry
- `POST /entry/:id/restore` — restores soft-deleted entry

### Entry Queries (`src/web/entry-queries.ts`)

```typescript
export async function getEntry(sql: Sql, id: string): Promise<EntryRow | null>;
// SELECT * FROM entries WHERE id = $id

export async function updateEntry(
  sql: Sql,
  id: string,
  data: { name: string; category: string | null; content: string | null; fields: Record<string, unknown>; tags: string[] }
): Promise<void>;
// UPDATE entries SET name=$name, category=$category, content=$content,
//   fields=$fields, tags=$tags, confidence=NULL WHERE id=$id

export async function softDeleteEntry(sql: Sql, id: string): Promise<void>;
// UPDATE entries SET deleted_at = NOW() WHERE id = $id

export async function restoreEntry(sql: Sql, id: string): Promise<void>;
// UPDATE entries SET deleted_at = NULL WHERE id = $id

export async function getAllTags(sql: Sql): Promise<string[]>;
// SELECT DISTINCT unnest(tags) AS tag FROM entries WHERE deleted_at IS NULL ORDER BY tag
```

Reuses `EntryRow` type from `src/web/dashboard-queries.ts`.

### Tag Autocomplete Endpoint

The edit form needs tag autocomplete. Two options:
1. Render all existing tags into the page as a `<datalist>` or JS array — simpler, no extra endpoint
2. `GET /api/tags` JSON endpoint

Recommend option 1 (inline into edit page template) for simplicity. `getAllTags(sql)` is called by the edit route handler and passed to the template.

### Markdown Rendering

The view route uses a markdown library (e.g., `marked`) to render `entry.content` to HTML. Install as a dependency. The rendered HTML is embedded in the template via `renderLayout`.

## Test App Factory

### Unit Test Factory

```typescript
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestEntry(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createEntryRoutes } = await import("../../src/web/entry.js");

  const mockSql = {} as any; // Query functions are mocked via vi.mock()

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createEntryRoutes(mockSql));

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

async function createIntegrationEntry(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createEntryRoutes } = await import("../../src/web/entry.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createEntryRoutes(sql));

  return { app };
}
```

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test File | Test Function |
|------------------|----------------|-----------|---------------|
| TS-1.1 | Entry view displays all fields | unit | `it("displays all entry fields")` |
| TS-1.2 | Markdown content rendered to HTML | unit | `it("renders markdown content to HTML")` |
| TS-1.3 | Invalid UUID returns 404 page | unit | `it("returns 404 for invalid UUID")` |
| TS-1.4 | Valid UUID with no matching row returns 404 | unit | `it("returns 404 for valid UUID with no matching row")` |
| TS-1.5 | Soft-deleted entry shows deleted badge and restore | unit | `it("shows deleted badge and restore option for soft-deleted entry")` |
| TS-1.6 | Restoring a soft-deleted entry clears deleted_at | integration | `it("clears deleted_at when restoring entry")` |
| TS-2.1 | Edit page loads with pre-populated form | unit | `it("shows edit form with pre-populated values")` |
| TS-2.2 | Edit form shows category-specific fields | unit | `it("shows category-specific fields in edit form")` |
| TS-2.3 | Save updates entry and updated_at changes | integration | `it("updates entry and changes updated_at")` |
| TS-2.4 | Save with empty name returns validation error | unit | `it("rejects save with empty name")` |
| TS-2.5 | Save re-generates embedding | integration | `it("re-generates embedding on save")` |
| TS-2.6 | Save sets confidence to null | integration | `it("sets confidence to null on save")` |
| TS-3.1 | Soft-delete sets deleted_at timestamp | unit | `it("sets deleted_at on soft-delete")` |
| TS-3.2 | After deletion, redirect to referrer | unit | `it("redirects to referrer after deletion")` |
| TS-3.3 | After deletion without referrer, redirect to dashboard | unit | `it("redirects to dashboard after deletion without referrer")` |
| TS-4.1 | Entry page returns server-rendered HTML | unit | `it("returns server-rendered HTML")` |
| TS-4.2 | Unauthenticated view request redirected to login | unit | `it("redirects unauthenticated view request to login")` |
| TS-4.3 | Unauthenticated edit request redirected to login | unit | `it("redirects unauthenticated edit request to login")` |
| TS-5.1 | Entry with null category shows unclassified badge | unit | `it("shows unclassified badge for null category")` |
| TS-5.2 | Null category in edit mode has no selection | unit | `it("shows no category selected for null category in edit mode")` |
| TS-5.3 | Category change replaces fields with new defaults | integration | `it("replaces fields with new category defaults on category change")` |
| TS-5.4 | Save with Ollama down preserves previous embedding | integration | `it("preserves previous embedding when Ollama is down")` |
| TS-5.5 | Voice source entry shows voice indicator | unit | `it("shows voice indicator for voice source entry")` |
| TS-5.6 | Very long content renders without layout breaks | unit | `it("renders very long content without layout breaks")` |
| TS-5.7 | Tag autocomplete suggests existing tags | unit | `it("includes existing tags for autocomplete in edit form")` |
| TS-5.8 | New tags can be entered beyond autocomplete | integration | `it("saves entry with new tag not previously in database")` |
| TS-5.9 | Entry with null embedding is viewable and editable | unit | `it("displays entry with null embedding normally")` |

## Detailed Scenario Implementation

### Group 1: View Entry (US-1)

#### TS-1.1: Entry view displays all fields (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with name "Project Alpha", category "projects", tags ["dev", "backend"], content "Some **markdown** content", fields `{ status: "active", next_action: "deploy" }`, source "telegram", source_type "text", confidence 0.85, created_at and updated_at timestamps. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains "Project Alpha", a category badge for "projects", tags "dev" and "backend", rendered content (not raw markdown), fields "status" and "next_action", timestamps, source "telegram", confidence "0.85", an Edit button with href `/entry/<uuid>/edit`, and a Delete button.

#### TS-1.2: Markdown content rendered to HTML (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with content containing `# Heading`, `**bold**`, `*italic*`, `- list item`, `1. ordered`, `` `inline code` ``, fenced code block, and `[link](url)`.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains `<h1`, `<strong`, `<em`, `<ul`, `<ol`, `<code`, `<pre`, and `<a href`.

#### TS-1.3: Invalid UUID returns 404 page (unit)

- **Setup (Given):** Create test app. Login.
- **Action (When):** `app.request("/entry/not-a-uuid", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 404. Body does not contain a stack trace or server error.

Note: The route handler should validate the UUID format before querying. Invalid UUIDs never hit the database.

#### TS-1.4: Valid UUID with no matching row returns 404 (unit)

- **Setup (Given):** Mock `getEntry` to return `null`. Create test app. Login.
- **Action (When):** `app.request("/entry/00000000-0000-0000-0000-000000000000", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 404.

#### TS-1.5: Soft-deleted entry shows deleted badge and restore option (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with `deleted_at` set to a date. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains a "deleted" badge (case-insensitive match). Body contains a restore button/form with action pointing to `/entry/<uuid>/restore`.

#### TS-1.6: Restoring a soft-deleted entry clears deleted_at (integration)

- **Setup (Given):** Seed a soft-deleted entry (with `deleted_at` set). Create integration app. Login.
- **Action (When):** `app.request("/entry/<id>/restore", { method: "POST", headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response is a redirect (302/303). Query the DB: the entry's `deleted_at` is now null.

---

### Group 2: Edit Entry (US-2)

#### TS-2.1: Edit page loads with pre-populated form (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with name "Meeting Notes", category "projects", tags ["work", "weekly"], content "# Summary\nGood progress", fields `{ status: "active", next_action: "review", notes: "v2" }`. Mock `getAllTags` to return ["work", "weekly", "urgent"]. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/edit", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains an input with value "Meeting Notes". Category dropdown with "projects" selected. Tags "work" and "weekly" in the tag input. Textarea with raw markdown. Category-specific fields for "projects" pre-populated. A Cancel link pointing to `/entry/<uuid>`.

#### TS-2.2: Edit form shows category-specific fields (unit)

- **Setup (Given):** Mock `getEntry` to return a "tasks" entry with fields `{ due_date: "2026-04-01", status: "pending", notes: "asap" }`. Mock `getAllTags`. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/edit", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Body contains input fields for "due_date", "status", and "notes" with their pre-populated values. The category dropdown shows "tasks" selected.

#### TS-2.3: Save updates entry and updated_at changes (integration)

- **Setup (Given):** Seed an entry with name "Old Name". Record its `updated_at`. Create integration app. Login. Wait briefly (ensure timestamp differs).
- **Action (When):** `app.request("/entry/<id>/edit", { method: "POST", body: new URLSearchParams({ name: "New Name", category: "tasks", content: "updated" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect to `/entry/<id>`. Query the DB: entry name is "New Name", `updated_at` is later than the original.

Note: `updated_at` is handled by the DB trigger, not application code. The test verifies the trigger fires on UPDATE.

#### TS-2.4: Save with empty name returns validation error (unit)

- **Setup (Given):** Mock `getEntry` to return an entry. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/edit", { method: "POST", body: new URLSearchParams({ name: "", category: "tasks", content: "stuff" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status is not a redirect (stays on edit page or returns 400/422). Body contains a validation error message (matching "name" and "required" — case-insensitive). Verify `updateEntry` was NOT called.

#### TS-2.5: Save re-generates embedding (integration)

- **Setup (Given):** Seed an entry with content "old content". Mock `generateEmbedding` to return a new 4096-dim vector when called. Create integration app. Login.
- **Action (When):** `app.request("/entry/<id>/edit", { method: "POST", body: new URLSearchParams({ name: "Test", category: "tasks", content: "completely new content" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Verify `generateEmbedding` was called (or `embedEntry` — whichever the handler uses). The entry is saved with updated content.

Note: The embedding re-generation is async/best-effort. The test verifies the embedding function was invoked, not the exact DB state of the embedding column (Ollama is mocked).

#### TS-2.6: Save sets confidence to null (integration)

- **Setup (Given):** Seed an entry with confidence 0.85. Create integration app. Login.
- **Action (When):** `app.request("/entry/<id>/edit", { method: "POST", body: new URLSearchParams({ name: "Test", category: "tasks", content: "stuff" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Query the DB: the entry's `confidence` is null.

---

### Group 3: Delete Entry (US-3)

#### TS-3.1: Soft-delete sets deleted_at timestamp (unit)

- **Setup (Given):** Mock `softDeleteEntry` to resolve. Mock `getEntry` to return an active entry. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/delete", { method: "POST", headers: { Cookie: cookie } })`.
- **Assertion (Then):** Verify `softDeleteEntry` was called with the entry ID. Response is a redirect.

#### TS-3.2: After deletion, redirect to referrer (unit)

- **Setup (Given):** Mock `softDeleteEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/delete", { method: "POST", headers: { Cookie: cookie, Referer: "/browse?category=tasks" } })`.
- **Assertion (Then):** Response status 302/303. `Location` header is `/browse?category=tasks`.

#### TS-3.3: After deletion without referrer, redirect to dashboard (unit)

- **Setup (Given):** Mock `softDeleteEntry` to resolve. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/delete", { method: "POST", headers: { Cookie: cookie } })` (no Referer header).
- **Assertion (Then):** Response status 302/303. `Location` header is `/`.

---

### Group 4: Constraints

#### TS-4.1: Entry page returns server-rendered HTML (unit)

- **Setup (Given):** Mock `getEntry` to return an entry. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. `Content-Type` contains `text/html`. Body starts with `<!DOCTYPE html>` or `<html`.

#### TS-4.2: Unauthenticated view request redirected to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/entry/00000000-0000-0000-0000-000000000000")`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`.

#### TS-4.3: Unauthenticated edit request redirected to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/entry/00000000-0000-0000-0000-000000000000/edit")`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`.

---

### Group 5: Edge Cases

#### TS-5.1: Entry with null category shows unclassified badge (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with `category: null`. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "unclassified" (case-insensitive) as a badge. No category-specific fields are displayed.

#### TS-5.2: Null category in edit mode has no selection (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with `category: null`, `fields: {}`. Mock `getAllTags`. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/edit", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** The category dropdown has no `selected` attribute on any category option (or has a placeholder option selected). No category-specific field inputs are rendered.

#### TS-5.3: Category change replaces fields with new defaults (integration)

- **Setup (Given):** Seed an entry with category "projects" and fields `{ status: "active", next_action: "review", notes: "some notes" }`. Create integration app. Login.
- **Action (When):** `app.request("/entry/<id>/edit", { method: "POST", body: new URLSearchParams({ name: "Test", category: "tasks", content: "stuff", "fields[status]": "active", "fields[next_action]": "review", "fields[notes]": "some notes" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Query the DB: the entry's category is "tasks". Fields contain `due_date: null` (added by handler as task default), `status: "active"` (carried over — present in both project and task schemas), `notes: "some notes"` (carried over — present in both schemas). The `next_action` field is no longer present (dropped — not in task schema).

Note: The edit form is server-rendered with no client-side JS to swap fields dynamically. When the user changes the category dropdown from "projects" to "tasks", the form still shows the old project fields. On submit, the handler receives the old fields alongside the new category. The handler must perform server-side field migration: map submitted fields to the new category's schema, carry over overlapping fields (`status`, `notes`), drop fields not in the new schema (`next_action`), and add missing fields with null defaults (`due_date`).

#### TS-5.4: Save with Ollama down preserves previous embedding (integration)

- **Setup (Given):** Seed an entry with a known embedding vector. Mock `generateEmbedding` to throw an error (connection refused). Create integration app. Login.
- **Action (When):** `app.request("/entry/<id>/edit", { method: "POST", body: new URLSearchParams({ name: "Test", category: "tasks", content: "updated" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is a redirect (save succeeds). Query the DB: the entry's content is "updated" (save worked). The entry's embedding is unchanged (previous embedding preserved, not set to null).

#### TS-5.5: Voice source entry shows voice indicator (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with `source: "telegram"`, `source_type: "voice"`. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains a "voice" indicator (matching "voice" near the source badge area).

#### TS-5.6: Very long content renders without layout breaks (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with 10,000+ characters of markdown content (paragraphs, headings, code blocks). Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains the rendered content. Response is valid HTML (no unclosed tags that would break layout). The content length is proportional to input (not truncated).

#### TS-5.7: Tag autocomplete suggests existing tags (unit)

- **Setup (Given):** Mock `getEntry` to return an entry. Mock `getAllTags` to return `["work", "personal", "urgent", "dev"]`. Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>/edit", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains all four tags rendered in a way the client can use for autocomplete (e.g., as `<datalist>` options, or a JSON array in a `<script>` tag, or `data-` attributes).

#### TS-5.8: New tags can be entered beyond autocomplete (integration)

- **Setup (Given):** Seed an entry with tags `["existing"]`. Create integration app. Login.
- **Action (When):** `app.request("/entry/<id>/edit", { method: "POST", body: new URLSearchParams({ name: "Test", category: "tasks", content: "stuff", tags: "existing,brand-new-tag" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Query the DB: the entry's tags include both "existing" and "brand-new-tag".

Note: Tags are submitted as a comma-separated string (or repeated form fields). The handler parses them into an array.

#### TS-5.9: Entry with null embedding is viewable and editable (unit)

- **Setup (Given):** Mock `getEntry` to return an entry with `embedding: null` (field not in EntryRow but conceptually — the entry simply has no embedding). Create test app. Login.
- **Action (When):** `app.request("/entry/<uuid>", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Entry is displayed normally. No special indicator for missing embedding.

Note: `EntryRow` does not include `embedding` in the SELECT for view queries (only `id, name, category, content, fields, tags, confidence, source, source_type, deleted_at, created_at, updated_at`). The entry displays fine regardless of embedding state. This test confirms no crash or error when the entry has null embedding.

---

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const TEST_UUID = "11111111-1111-1111-1111-111111111111";
```

### Entry Factory

Reuses pattern from dashboard/browse tests:

```typescript
function createMockEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: TEST_UUID,
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

Reuses `seedEntry` and `clearEntries` from browse tests (or defined locally):

```typescript
async function seedEntry(
  sql: Sql,
  overrides: Partial<EntryRow> & { embedding?: number[] } = {}
): Promise<string> {
  const entry = createMockEntry({ id: crypto.randomUUID(), ...overrides });
  const embedding = overrides.embedding ?? null;

  if (embedding) {
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, embedding, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type}, ${`[${embedding.join(",")}]`}::vector(4096),
              ${entry.deleted_at}, ${entry.created_at}, ${entry.updated_at})
    `;
  } else {
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
              ${entry.created_at}, ${entry.updated_at})
    `;
  }

  return entry.id;
}

async function clearEntries(sql: Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}
```

### Shared Helpers

| Helper | Purpose | Scope |
|--------|---------|-------|
| `createTestEntry()` | Unit: Hono app with mocked data layer + auth | Per-test |
| `createIntegrationEntry()` | Integration: Hono app with real DB + auth | Per-test |
| `loginAndGetCookie(app, password?)` | Authenticates and returns session cookie string | Per-test |
| `createMockEntry(overrides?)` | Produces an entry object with sensible defaults | Per-test |
| `seedEntry(sql, overrides?)` | Integration: inserts an entry into real DB | Per-test |
| `clearEntries(sql)` | Integration: deletes all entries between tests | Per-test |

### Mocking Strategy

**Unit tests mock two layers:**

1. **Entry query functions** — Via `vi.mock()` on the entry query module:
   ```typescript
   vi.mock("../../src/web/entry-queries.js", () => ({
     getEntry: vi.fn().mockResolvedValue(null),
     updateEntry: vi.fn().mockResolvedValue(undefined),
     softDeleteEntry: vi.fn().mockResolvedValue(undefined),
     restoreEntry: vi.fn().mockResolvedValue(undefined),
     getAllTags: vi.fn().mockResolvedValue([]),
   }));
   ```
   Each test overrides return values via `mockResolvedValue()` or `mockResolvedValueOnce()`.

2. **Embedding** — Via `vi.mock()` on `src/embed.ts`:
   ```typescript
   vi.mock("../../src/embed.js", () => ({
     generateEmbedding: vi.fn().mockResolvedValue(new Array(4096).fill(0)),
     embedEntry: vi.fn().mockResolvedValue(undefined),
   }));
   ```

**Integration tests mock only the embedding service** (Ollama), not the DB queries:
- `generateEmbedding` / `embedEntry` — mocked via `vi.mock()` (requires Ollama)
- Database — real testcontainers PostgreSQL + pgvector, no mocks

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

## Alignment Check

**Status: Full alignment.**

All 27 test scenarios from the test specification (TS-1.1 through TS-5.9) are mapped to test functions with setup, action, and assertion strategies defined. Split: 20 unit tests + 7 integration tests.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (27/27) |
| One behavior per test | Yes |
| All tests will initially fail | Yes (see notes below) |
| Test isolation verified | Yes (per-test factory, `clearEntries` between integration tests) |
| No implementation coupling | Yes (tests verify observable HTTP behavior) |

### Notes

1. **TS-4.2 / TS-4.3** (auth enforcement) will pass early because `createAuthMiddleware` already exists. However, until `createEntryRoutes` exists and is wired, the request may get a 404 instead of a 302 redirect. The test checks for 302 + Location header, which requires the route to be mounted.

2. **TS-5.3** (category change field migration) — the edit form has no client-side JS to swap fields dynamically. When the user changes the category dropdown, the form still submits the old category's fields. The handler must perform server-side migration: map submitted fields to the new category's schema, carry over overlapping fields, drop inapplicable fields, and add missing fields with null defaults. The test submits old project fields with `category: "tasks"` and verifies the DB outcome.

3. **TS-2.5** (embedding re-generation) — the handler should call `embedEntry(sql, id)` (or `generateEmbedding` + DB update) after saving. Since Ollama is mocked in integration tests, we verify the function was called, not the actual embedding value.

4. **TS-5.4** (Ollama down) — integration test mocks `generateEmbedding` / `embedEntry` to throw. The handler must catch this error and proceed with the save. The test verifies the entry is saved with updated content but the embedding is unchanged.

5. **TS-5.9** (null embedding) — since `EntryRow` doesn't include the embedding column in its SELECT, this is really testing that the view renders an entry that happens to have no embedding. The mock entry is standard; the test just confirms no crash.

6. **TS-3.2 / TS-3.3** (redirect after deletion) — the handler reads the `Referer` header from the request. In Hono, this is `c.req.header("referer")`. The test sets/omits the `Referer` header accordingly.

7. **Tag submission format** — tags are submitted as a comma-separated string in a single form field (e.g., `tags=work,urgent,new-tag`). The handler splits on commas, trims whitespace, and filters empty strings. Integration test TS-5.8 verifies this parsing.
