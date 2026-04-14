# Web Browse - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Web Browse |
| Phase | 3 |
| Date | 2026-03-05 |
| Derives From | `web-browse-test-specification.md` |

## Test Framework & Conventions

- **Framework:** Vitest (project standard)
- **Style:** `describe`/`it` blocks with explicit imports (`import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`)
- **HTTP testing:** Hono's built-in `app.request(url, init?)` — no real server needed
- **Module mocking:** `vi.mock()` for query functions and embedding module
- **Env var control:** `tests/helpers/env.ts` (`withEnv`, `setRequiredEnvVars`, `clearAllConfigEnvVars`)
- **DB testing:** testcontainers with `pgvector/pgvector:pg16` for integration tests (existing `tests/helpers/test-db.ts`)
- **Auth reuse:** Login helper pattern from `web-auth.test.ts` — POST `/login` and extract `Set-Cookie`

## Test Structure

### File Organization

```
tests/unit/web-browse.test.ts                    # 20 unit tests (mocked queries)
tests/integration/web-browse-integration.test.ts  # 13 integration tests (testcontainers)
```

**Unit tests** mock the data layer (query functions, `generateEmbedding`) and test HTTP handler behavior — HTML rendering, filter handling, fallback logic, auth enforcement.

**Integration tests** use testcontainers with real PostgreSQL + pgvector, seed data via SQL, and verify actual query correctness (category filtering, tag containment, semantic similarity threshold, text search ILIKE, combined AND filters).

### Test Grouping

```typescript
// Unit tests
describe("Web Browse", () => {
  describe("Category Browsing (US-1)", () => { /* TS-1.1, TS-1.2, TS-1.3, TS-1.5 */ });
  describe("Semantic Search (US-2)", () => { /* TS-2.1, TS-2.4 */ });
  describe("Text Search (US-3)", () => { /* TS-3.4, TS-3.5 */ });
  describe("Tag Filtering (US-4)", () => { /* TS-4.1, TS-4.5, TS-4.6 */ });
  describe("Constraints", () => { /* TS-5.1, TS-5.2, TS-5.4, TS-5.5 */ });
  describe("Edge Cases", () => { /* TS-6.1, TS-6.2, TS-6.4, TS-6.6, TS-6.7 */ });
});

// Integration tests
describe("Web Browse Integration", () => {
  describe("Category Browsing", () => { /* TS-1.4 */ });
  describe("Semantic Search", () => { /* TS-2.2, TS-2.3 */ });
  describe("Text Search", () => { /* TS-3.1, TS-3.2, TS-3.3 */ });
  describe("Tag Filtering", () => { /* TS-4.2, TS-4.3, TS-4.4 */ });
  describe("Embedding Constraints", () => { /* TS-5.3, TS-5.6 */ });
  describe("Edge Cases", () => { /* TS-6.3, TS-6.5 */ });
});
```

### Naming Convention

Test names mirror scenario titles from the test specification:

```typescript
it("shows all category filters with All as default")              // TS-1.1
it("shows only matching entries when category filter applied")    // TS-1.2
it("excludes results below similarity threshold")                 // TS-2.2
it("shows fallback notice when text search replaces semantic")    // TS-3.5
it("displays tags as clickable filter pills")                     // TS-4.1
it("redirects unauthenticated browse request to login")           // TS-5.2
it("shows no results message with suggestion")                    // TS-6.1
```

## Expected Module API

### Browse Routes (`src/web/browse.ts`)

```typescript
export function createBrowseRoutes(sql: Sql): Hono;
```

The factory returns a Hono sub-app with:
- `GET /browse` — renders browse page HTML (entry list, category tabs, tag pills, search bar)

The handler:
1. Parses query params: `q` (search query), `category` (filter), `tag` (filter), `mode` (`text` to force text search)
2. Truncates `q` to 500 characters if present
3. Determines search strategy:
   - No `q`: calls `browseEntries(sql, filters)`, ordered by `updated_at DESC`
   - `mode=text`: calls `textSearch(sql, q, filters)` directly
   - Default: calls `generateEmbedding(q)` then `semanticSearch(sql, embedding, filters)`.
     If Ollama fails: catches error, falls back to `textSearch`, sets `ollamaNotice`.
     If semantic returns empty: falls back to `textSearch`, sets `fallbackNotice`.
4. Calls `getFilterTags(sql, { category })` for tag pills
5. Renders via `renderLayout("Browse", browseContent, "/browse")`

The handler imports:
- `generateEmbedding` from `src/embed.ts`
- Query functions from `src/web/browse-queries.ts`
- `renderLayout` from `src/web/layout.ts`

### Browse Queries (`src/web/browse-queries.ts`)

```typescript
export interface BrowseFilters {
  category?: string;
  tag?: string;
}

export async function browseEntries(sql: Sql, filters?: BrowseFilters): Promise<EntryRow[]>;
// SELECT * FROM entries WHERE deleted_at IS NULL
//   [AND category = $category] [AND $tag = ANY(tags)]
// ORDER BY updated_at DESC

export async function semanticSearch(
  sql: Sql, queryEmbedding: number[], filters?: BrowseFilters
): Promise<EntryRow[]>;
// SELECT *, 1 - (embedding <=> $queryEmbedding) AS similarity FROM entries
// WHERE deleted_at IS NULL AND embedding IS NOT NULL
//   AND 1 - (embedding <=> $queryEmbedding) >= 0.5
//   [AND category = $category] [AND $tag = ANY(tags)]
// ORDER BY similarity DESC

export async function textSearch(
  sql: Sql, query: string, filters?: BrowseFilters
): Promise<EntryRow[]>;
// SELECT * FROM entries WHERE deleted_at IS NULL
//   AND (name ILIKE '%query%' OR content ILIKE '%query%')
//   [AND category = $category] [AND $tag = ANY(tags)]
// ORDER BY updated_at DESC

export async function getFilterTags(
  sql: Sql, options?: { category?: string }
): Promise<string[]>;
// SELECT DISTINCT unnest(tags) AS tag FROM entries WHERE deleted_at IS NULL
//   [AND category = $category]
// ORDER BY tag
```

Reuses `EntryRow` type from `src/web/dashboard-queries.ts` (or a shared type).

## Test App Factory

### Unit Test Factory

```typescript
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestBrowse(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createBrowseRoutes } = await import("../../src/web/browse.js");

  const mockSql = {} as any; // Query functions are mocked via vi.mock()

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createBrowseRoutes(mockSql));

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

async function createIntegrationBrowse(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createBrowseRoutes } = await import("../../src/web/browse.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createBrowseRoutes(sql));

  return { app };
}
```

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test File | Test Function |
|------------------|----------------|-----------|---------------|
| TS-1.1 | Browse page shows all category filters with "All" as default | unit | `it("shows all category filters with All as default")` |
| TS-1.2 | Filtering by category shows only matching entries | unit | `it("shows only matching entries when category filter applied")` |
| TS-1.3 | "All" category shows entries across all categories | unit | `it("shows entries across all categories when All selected")` |
| TS-1.4 | Soft-deleted entries excluded from browse results | integration | `it("excludes soft-deleted entries from browse results")` |
| TS-1.5 | Results ordered by updated_at descending | unit | `it("displays results ordered by updated_at descending")` |
| TS-2.1 | Semantic search returns results ranked by similarity | unit | `it("returns semantic search results ranked by similarity")` |
| TS-2.2 | Semantic search excludes results below similarity threshold | integration | `it("excludes results below similarity threshold")` |
| TS-2.3 | Semantic search combined with category filter | integration | `it("combines semantic search with category filter")` |
| TS-2.4 | Semantic search results override default sort order | unit | `it("overrides default sort order with similarity ranking")` |
| TS-3.1 | Text search runs as fallback when semantic has no results | integration | `it("falls back to text search when semantic has no results")` |
| TS-3.2 | Text search matches against name and content fields | integration | `it("matches text search against name and content fields")` |
| TS-3.3 | Text search is case-insensitive | integration | `it("performs case-insensitive text search")` |
| TS-3.4 | Explicit text search mode bypasses semantic search | unit | `it("bypasses semantic search when text mode is active")` |
| TS-3.5 | Fallback notice shown when text search replaces semantic | unit | `it("shows fallback notice when text search replaces semantic")` |
| TS-4.1 | Tags shown as clickable filter pills | unit | `it("displays tags as clickable filter pills")` |
| TS-4.2 | Clicking a tag shows only entries with that tag | integration | `it("shows only entries with the selected tag")` |
| TS-4.3 | Tag + category + search filters combined with AND logic | integration | `it("combines tag category and search with AND logic")` |
| TS-4.4 | Tag list dynamically reflects current filtered set | integration | `it("dynamically shows only tags in the current filtered set")` |
| TS-4.5 | Clicking a different tag switches the selection | unit | `it("switches tag selection when different tag clicked")` |
| TS-4.6 | Clicking the active tag deselects it | unit | `it("clears tag filter when active tag clicked")` |
| TS-5.1 | Browse page returns server-rendered HTML | unit | `it("returns server-rendered HTML")` |
| TS-5.2 | Unauthenticated browse request redirected to login | unit | `it("redirects unauthenticated browse request to login")` |
| TS-5.3 | Entries without embeddings included in category browsing | integration | `it("includes entries without embeddings in category browsing")` |
| TS-5.4 | Ollama unavailable falls back to text search with notice | unit | `it("falls back to text search with notice when Ollama unavailable")` |
| TS-5.5 | Filter state reflected in URL query parameters | unit | `it("preserves filter state via URL query parameters")` |
| TS-5.6 | Entries without embeddings excluded from semantic search | integration | `it("excludes entries without embeddings from semantic search")` |
| TS-6.1 | Search with no results shows "no results" message | unit | `it("shows no results message with suggestion")` |
| TS-6.2 | Very long search query truncated to 500 characters | unit | `it("truncates search query to 500 characters")` |
| TS-6.3 | German language search works | integration | `it("finds entries with German content via text search")` |
| TS-6.4 | Empty database shows empty state message | unit | `it("shows empty state message when no entries exist")` |
| TS-6.5 | Entries with no tags excluded when tag filter active | integration | `it("excludes entries with no tags when tag filter active")` |
| TS-6.6 | Category with zero entries shows empty result | unit | `it("shows empty result message for category with no entries")` |
| TS-6.7 | Max 10 tags displayed with "show more" collapse | unit | `it("shows max 10 tags with show more collapse")` |

## Detailed Scenario Implementation

### Group 1: Category Browsing (US-1)

#### TS-1.1: Browse page shows all category filters with "All" as default (unit)

- **Setup (Given):** Mock `browseEntries` to return entries across multiple categories. Mock `getFilterTags` to return `["work", "personal"]`. Create test app via `createTestBrowse()`. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains the category labels "People", "Projects", "Tasks", "Ideas", "Reference", and "All". The "All" option has a selected/active indicator (CSS class or attribute). All returned entries are rendered.

#### TS-1.2: Filtering by category shows only matching entries (unit)

- **Setup (Given):** Mock `browseEntries` to return 3 task entries when called with `{ category: "tasks" }`. Mock `getFilterTags` to return `["urgent"]`. Create test app. Login.
- **Action (When):** `app.request("/browse?category=tasks", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains the 3 task entry names. The "Tasks" category tab has a selected/active indicator. Verify `browseEntries` was called with `{ category: "tasks" }` (via `vi.mocked(browseEntries).mock.calls`).

#### TS-1.3: "All" category shows entries across all categories (unit)

- **Setup (Given):** Mock `browseEntries` to return entries from categories "people", "projects", and "tasks". Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })` (no category param = "All").
- **Assertion (Then):** Response status 200. Body contains entry names from all three categories. The "All" tab has a selected indicator. Verify `browseEntries` was called without a category filter.

#### TS-1.4: Soft-deleted entries excluded from browse results (integration)

- **Setup (Given):** Seed 3 active entries and 2 soft-deleted entries (with `deleted_at` set) via `seedEntry()`. Create integration app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the 3 active entry names. The 2 soft-deleted entry names do NOT appear.

This verifies the SQL query includes `WHERE deleted_at IS NULL`.

#### TS-1.5: Results ordered by updated_at descending (unit)

- **Setup (Given):** Mock `browseEntries` to return 3 entries in order: A (updated 1h ago), C (updated 2h ago), B (updated 3h ago). Entries returned by the mock are already in the correct order (the query function handles ordering). Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains all 3 entry names. Use string index comparison: `body.indexOf("A") < body.indexOf("C") < body.indexOf("B")`.

Note: The unit test verifies the handler renders entries in the order returned by the query function. The SQL `ORDER BY updated_at DESC` is a straightforward clause tested indirectly by integration tests that seed and retrieve entries — no dedicated integration test is needed for ordering alone.

---

### Group 2: Semantic Search (US-2)

#### TS-2.1: Semantic search returns results ranked by similarity (unit)

- **Setup (Given):** Mock `generateEmbedding` to return a 4096-dim vector. Mock `semanticSearch` to return 3 entries in similarity-ranked order (highest first): `[entryHigh, entryMed, entryLow]`. Mock `getFilterTags` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/browse?q=career+development+plans", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains all 3 entry names in order (use index comparison). Verify `generateEmbedding` was called with `"career development plans"`. Verify `semanticSearch` was called with the embedding vector. Similarity scores are NOT present in the response body.

#### TS-2.2: Semantic search excludes results below similarity threshold (integration)

- **Setup (Given):** Mock `generateEmbedding` to return the query embedding `[1, 0, 0, ..., 0]` (4096-dim). Seed entry "A" with a similar embedding (cosine similarity ~0.8 to query). Seed entry "B" with a dissimilar embedding (cosine similarity ~0.3 to query). Create integration app. Login.
- **Action (When):** `app.request("/browse?q=test+query", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains entry "A" name. Entry "B" name does NOT appear.

Test embeddings:
- Query: `[1, 0, 0, ..., 0]`
- Entry A (similar): `[0.8, 0.6, 0, ..., 0]` — cosine similarity = 0.8
- Entry B (dissimilar): `[0.3, 0.954, 0, ..., 0]` — cosine similarity ~0.3

This verifies the `>= 0.5` threshold is applied at the DB level via pgvector.

#### TS-2.3: Semantic search combined with category filter (integration)

- **Setup (Given):** Mock `generateEmbedding` to return the query embedding. Seed a "projects" entry with a similar embedding. Seed an "ideas" entry with a similar embedding. Create integration app. Login.
- **Action (When):** `app.request("/browse?q=budget+planning&category=projects", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the "projects" entry name. The "ideas" entry name does NOT appear.

#### TS-2.4: Semantic search results override default sort order (unit)

- **Setup (Given):** Mock `generateEmbedding` to return a vector. Mock `semanticSearch` to return `[entryOld, entryNew]` where "Old" (updated 5 days ago) has higher similarity than "New" (updated 1 hour ago). Create test app. Login.
- **Action (When):** `app.request("/browse?q=test+query", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Entry "Old" appears before entry "New" in the response body (sorted by similarity, not recency). Use `body.indexOf("Old") < body.indexOf("New")`.

---

### Group 3: Text Search (US-3)

#### TS-3.1: Text search runs as fallback when semantic has no results (integration)

- **Setup (Given):** Mock `generateEmbedding` to return the query embedding. Seed entries WITHOUT embeddings (so semantic search returns nothing). Seed an entry with content containing "quarterly budget". Create integration app. Login.
- **Action (When):** `app.request("/browse?q=quarterly+budget", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the entry with matching content. A fallback notice is displayed (text indicating semantic search found no matches and text results are shown instead).

Note: Semantic search returns empty because no entries have embeddings. The handler falls back to text search automatically.

#### TS-3.2: Text search matches against name and content fields (integration)

- **Setup (Given):** Seed entry "A" with name "Weekly standup notes" (no "standup" in content). Seed entry "B" with content "standup meeting agenda" (no "standup" in name). Seed entry "C" with neither "standup" in name nor content. Create integration app. Login.
- **Action (When):** `app.request("/browse?q=standup&mode=text", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains entries "A" and "B" names. Entry "C" name does NOT appear.

Uses `mode=text` to force text search directly (bypass semantic).

#### TS-3.3: Text search is case-insensitive (integration)

- **Setup (Given):** Seed an entry with name "Project Alpha". Create integration app. Login.
- **Action (When):** `app.request("/browse?q=project+alpha&mode=text", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "Project Alpha" (ILIKE match despite lowercase query).

#### TS-3.4: Explicit text search mode bypasses semantic search (unit)

- **Setup (Given):** Mock `textSearch` to return 2 matching entries. Mock `getFilterTags` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/browse?q=exact+phrase&mode=text", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the 2 entry names. Verify `generateEmbedding` was NOT called. Verify `semanticSearch` was NOT called. Verify `textSearch` was called with `"exact phrase"`.

#### TS-3.5: Fallback notice shown when text search replaces semantic (unit)

- **Setup (Given):** Mock `generateEmbedding` to return a vector. Mock `semanticSearch` to return `[]` (no matches). Mock `textSearch` to return 2 entries. Create test app. Login.
- **Action (When):** `app.request("/browse?q=test+query", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the 2 text search entry names. Body contains a fallback notice (matching text like "no semantic matches" or "showing text results" — case-insensitive match). Verify `semanticSearch` was called first, then `textSearch` as fallback.

---

### Group 4: Tag Filtering (US-4)

#### TS-4.1: Tags shown as clickable filter pills (unit)

- **Setup (Given):** Mock `browseEntries` to return entries. Mock `getFilterTags` to return `["work", "personal", "urgent"]`. Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "work", "personal", and "urgent" rendered as clickable elements (each wrapped in an `<a` tag with an `href` containing `tag=`).

#### TS-4.2: Clicking a tag shows only entries with that tag (integration)

- **Setup (Given):** Seed entry "A" with tags `["work"]`. Seed entry "B" with tags `["personal"]`. Seed entry "C" with tags `["work", "personal"]`. Create integration app. Login.
- **Action (When):** `app.request("/browse?tag=work", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains entries "A" and "C" names. Entry "B" name does NOT appear.

Verifies the SQL `WHERE $tag = ANY(tags)` array containment.

#### TS-4.3: Tag + category + search combined with AND logic (integration)

- **Setup (Given):** Seed a "tasks" entry with tag "urgent" and content "review quarterly report". Seed a "tasks" entry with tag "urgent" and content "unrelated content". Seed an "ideas" entry with tag "urgent" and content "review process". Create integration app. Login.
- **Action (When):** `app.request("/browse?category=tasks&tag=urgent&q=review&mode=text", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains only the first entry (tasks + urgent + matching "review"). The other two entries do NOT appear.

Uses `mode=text` to avoid needing embeddings while testing AND filter logic.

#### TS-4.4: Tag list dynamically reflects current filtered set (integration)

- **Setup (Given):** Seed "projects" entries with tags `["work"]` and `["client"]`. Seed "tasks" entries with tags `["work"]` and `["personal"]`. Create integration app. Login.
- **Action (When):** `app.request("/browse?category=projects", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains tag pills "work" and "client". Tag "personal" does NOT appear in the tag filter area.

Verifies `getFilterTags` scopes to the active category.

#### TS-4.5: Clicking a different tag switches the selection (unit)

- **Setup (Given):** Mock `browseEntries` to return entries with tag "personal". Mock `getFilterTags` to return `["work", "personal", "urgent"]`. Create test app. Login.
- **Action (When):** `app.request("/browse?tag=personal", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body shows "personal" tag with a selected/active indicator (CSS class). Tags "work" and "urgent" appear without the active indicator. Verify `browseEntries` was called with `{ tag: "personal" }`.

Note: Since the page uses query params + full page reload, "switching" from one tag to another is just a new request with a different `?tag=` param. Each tag pill links to `?tag=<tagname>` (preserving other params).

#### TS-4.6: Clicking the active tag deselects it (unit)

- **Setup (Given):** Mock `browseEntries` to return entries (no tag filter). Mock `getFilterTags` to return `["work", "personal"]`. Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })` (no tag param = deselected).
- **Assertion (Then):** Response body shows all entries (no tag filtering). No tag has a selected/active indicator. The tag pill for "work" links to `?tag=work` (to select it). When the `tag` query param matches the current tag, the pill should link to the URL WITHOUT the `tag` param (to deselect).

Verify this deselect link by requesting `/browse?tag=work` and checking that the "work" tag pill's `href` does NOT include `tag=work` (it links to the URL without the tag param).

---

### Group 5: Constraints

#### TS-5.1: Browse page returns server-rendered HTML (unit)

- **Setup (Given):** Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. `Content-Type` header contains `text/html`. Response body starts with `<!DOCTYPE html>` or `<html` (server-rendered via `renderLayout`).

#### TS-5.2: Unauthenticated browse request redirected to login (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/browse")`.
- **Assertion (Then):** Response status 302. `Location` header is `/login?redirect=%2Fbrowse` (preserves the original URL for post-login redirect).

Note: This behavior is provided by `createAuthMiddleware` (already implemented). This test confirms the browse route is behind the auth middleware.

#### TS-5.3: Entries without embeddings included in category browsing (integration)

- **Setup (Given):** Seed entry "A" with a valid embedding. Seed entry "B" with `embedding: null`. Create integration app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })` (no search query).
- **Assertion (Then):** Response body contains both entry "A" and entry "B" names.

Verifies `browseEntries` does NOT filter on `embedding IS NOT NULL`.

#### TS-5.4: Ollama unavailable falls back to text search with notice (unit)

- **Setup (Given):** Mock `generateEmbedding` to throw an error (Ollama connection refused). Mock `textSearch` to return 2 entries. Create test app. Login.
- **Action (When):** `app.request("/browse?q=test+query", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains the 2 text search entry names. Body contains a notice indicating semantic search is unavailable (matching text like "semantic search is unavailable" — case-insensitive). Verify `semanticSearch` was NOT called (handler caught the embedding error before querying).

#### TS-5.5: Filter state reflected in URL query parameters (unit)

- **Setup (Given):** Mock `generateEmbedding` to return a 4096-dim vector. Mock `semanticSearch` to return 2 entries (so semantic search succeeds — the test is about filter state preservation, not search behavior). Mock `getFilterTags` to return `["work"]`. Create test app. Login.
- **Action (When):** `app.request("/browse?category=projects&tag=work&q=budget", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. The rendered HTML reflects the filter state:
  - The "Projects" category tab is marked as active/selected
  - The "work" tag pill is marked as active/selected
  - The search input contains the value "budget" (via a `value=` attribute)
  - Category tab links preserve the current `q` and `tag` params
  - Tag pill links preserve the current `q` and `category` params

This ensures reloading the page with the same query params reproduces the same view.

Note: Since `q=budget` is present, the handler takes the search path (calling `generateEmbedding` + `semanticSearch`), not the browse path (`browseEntries`). The mocks must match the search code path.

#### TS-5.6: Entries without embeddings excluded from semantic search (integration)

- **Setup (Given):** Mock `generateEmbedding` to return the query embedding. Seed entry "A" with a similar embedding (similarity > 0.5). Seed entry "B" with `embedding: null` but content matching the query text. Create integration app. Login.
- **Action (When):** `app.request("/browse?q=test+query", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains entry "A" name. Entry "B" name does NOT appear in the semantic results.

Note: Entry "B" might appear via text search fallback if semantic results are non-empty (they are — entry A is returned). Since the handler only falls back when semantic returns EMPTY, entry B should NOT appear at all.

---

### Group 6: Edge Cases

#### TS-6.1: Search with no results shows "no results" message (unit)

- **Setup (Given):** Mock `generateEmbedding` to return a vector. Mock `semanticSearch` to return `[]`. Mock `textSearch` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/browse?q=nonexistent+query", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains a "No results found" message. Body contains a suggestion to try different terms (matching text like "try different" or "broaden" — case-insensitive).

#### TS-6.2: Very long search query truncated to 500 characters (unit)

- **Setup (Given):** Mock `generateEmbedding` to return a vector. Mock `semanticSearch` to return entries. Create test app. Login. Construct a query string of 600 characters.
- **Action (When):** `app.request("/browse?q=" + longQuery, { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Verify `generateEmbedding` was called with a string of exactly 500 characters (truncated). Search still executes and returns results.

#### TS-6.3: German language search works (integration)

- **Setup (Given):** Seed an entry with name "Projektbesprechung morgen" and content containing German text. Create integration app. Login.
- **Action (When):** `app.request("/browse?q=Projektbesprechung&mode=text", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains "Projektbesprechung morgen".

Uses `mode=text` to verify ILIKE works with German characters without needing Ollama.

#### TS-6.4: Empty database shows empty state message (unit)

- **Setup (Given):** Mock `browseEntries` to return `[]`. Mock `getFilterTags` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an empty state message (matching text like "No entries yet" or "Start capturing" — case-insensitive).

#### TS-6.5: Entries with no tags excluded when tag filter active (integration)

- **Setup (Given):** Seed entry "A" with tags `["work"]`. Seed entry "B" with tags `[]` (empty array). Create integration app. Login.
- **Action (When):** `app.request("/browse?tag=work", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains entry "A" name. Entry "B" name does NOT appear.

Verifies the SQL array containment query correctly excludes entries with empty tag arrays.

#### TS-6.6: Category with zero entries shows empty result (unit)

- **Setup (Given):** Mock `browseEntries` to return `[]` when called with `{ category: "people" }`. Mock `getFilterTags` to return `[]`. Create test app. Login.
- **Action (When):** `app.request("/browse?category=people", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an empty result message (matching text like "No entries" or "no results" — case-insensitive). The "People" category tab is marked as active.

#### TS-6.7: Max 10 tags displayed with "show more" collapse (unit)

- **Setup (Given):** Mock `browseEntries` to return entries. Mock `getFilterTags` to return 15 tags: `["tag-01", "tag-02", ..., "tag-15"]`. Create test app. Login.
- **Action (When):** `app.request("/browse", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains all 15 tag names. A "show more" control is present in the HTML (matching text like "show more" or "more tags" — case-insensitive). The HTML structure separates the first 10 tags from the remaining 5 (e.g., the extra tags are in a container with a hidden/collapsed class or attribute).

Note: The collapse/expand behavior is client-side JavaScript. The server renders all tags with appropriate markup for the client to toggle visibility. The test verifies the server provides the correct structure.

---

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
```

### Entry Factory

Reuses the pattern from the dashboard tests:

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
    embedding: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}
```

### Embedding Factories

For integration tests that need controlled cosine similarity:

```typescript
function createQueryEmbedding(): number[] {
  // Unit vector in first dimension: [1, 0, 0, ..., 0]
  const vec = new Array(4096).fill(0);
  vec[0] = 1;
  return vec;
}

function createSimilarEmbedding(): number[] {
  // Cosine similarity ~0.8 to query embedding
  const vec = new Array(4096).fill(0);
  vec[0] = 0.8;
  vec[1] = 0.6;
  return vec;
}

function createDissimilarEmbedding(): number[] {
  // Cosine similarity ~0.3 to query embedding (below 0.5 threshold)
  const vec = new Array(4096).fill(0);
  vec[0] = 0.3;
  vec[1] = 0.954;
  return vec;
}
```

### Integration Test Data Seeding

Extended from dashboard to support embeddings:

```typescript
async function seedEntry(
  sql: Sql,
  overrides: Partial<EntryRow> & { embedding?: number[] } = {}
): Promise<string> {
  const entry = createMockEntry(overrides);
  const embedding = overrides.embedding ?? null;

  if (embedding) {
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, embedding, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type}, ${sql`${embedding}::vector`},
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
| `createTestBrowse()` | Unit: Hono app with mocked data layer + auth | Per-test |
| `createIntegrationBrowse()` | Integration: Hono app with real DB + auth | Per-test |
| `loginAndGetCookie(app, password?)` | Authenticates and returns session cookie string | Per-test |
| `createMockEntry(overrides?)` | Produces an entry object with sensible defaults | Per-test |
| `createQueryEmbedding()` | Unit vector for controlled similarity tests | Per-test |
| `createSimilarEmbedding()` | Embedding with ~0.8 cosine similarity to query | Per-test |
| `createDissimilarEmbedding()` | Embedding with ~0.3 cosine similarity to query | Per-test |
| `seedEntry(sql, overrides?)` | Integration: inserts an entry (with optional embedding) into real DB | Per-test |
| `clearEntries(sql)` | Integration: deletes all entries between tests | Per-test |

### Mocking Strategy

**Unit tests mock two layers:**

1. **Query functions** — Via `vi.mock()` on the browse query module:
   ```typescript
   vi.mock("../../src/web/browse-queries.js", () => ({
     browseEntries: vi.fn().mockResolvedValue([]),
     semanticSearch: vi.fn().mockResolvedValue([]),
     textSearch: vi.fn().mockResolvedValue([]),
     getFilterTags: vi.fn().mockResolvedValue([]),
   }));
   ```
   Each test overrides return values via `mockResolvedValue()` or `mockResolvedValueOnce()`.

2. **Embedding** — Via `vi.mock()` on `src/embed.ts`:
   ```typescript
   vi.mock("../../src/embed.js", () => ({
     generateEmbedding: vi.fn().mockResolvedValue(new Array(4096).fill(0)),
   }));
   ```

**Integration tests mock only the embedding service** (Ollama), not the DB queries:
- `generateEmbedding` — mocked via `vi.mock()` (requires Ollama)
- Database — real testcontainers PostgreSQL + pgvector, no mocks

### Setup / Teardown

```typescript
// Unit tests
beforeEach(async () => {
  vi.resetModules();
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

All 33 test scenarios from the test specification (TS-1.1 through TS-6.7) are mapped to test functions with setup, action, and assertion strategies defined. Split: 20 unit tests + 13 integration tests.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (33/33) |
| One behavior per test | Yes |
| All tests will initially fail | Yes (see notes below) |
| Test isolation verified | Yes (per-test factory, `clearEntries` between integration tests) |
| No implementation coupling | Yes (tests verify observable HTTP behavior) |

### Notes

1. **TS-5.2** (auth enforcement) will pass early because `createAuthMiddleware` already exists and the browse route will be behind it. However, until `createBrowseRoutes` exists and is wired, the test may get a 404 instead of a 302 redirect. The test should specifically check for 302 + Location header, which will only work once the browse route is mounted.

2. **TS-4.6** (tag deselect) tests two aspects: (a) no tag is selected when no `?tag` param is present, and (b) the active tag's pill links to a URL without the `tag` param. The second aspect is verified by a separate request with `?tag=work` to check the rendered link.

3. **TS-6.7** (show more collapse) — the show/hide interaction is client-side JavaScript. The server-side test verifies the HTML structure: all 15 tags present, a "show more" control exists, and the extra tags are in a collapsible container. The test does NOT verify the toggle behavior.

4. **TS-3.1 and TS-3.5** (text search fallback) — both test the fallback flow but differ in level. TS-3.5 is a unit test checking the notice is rendered. TS-3.1 is an integration test verifying the full flow with real DB queries.

5. **TS-5.6** (entries without embeddings excluded from semantic) — when semantic search returns results (entry A), the handler does NOT fall back to text search, so entry B (which has matching content but no embedding) never appears. This is correct behavior: fallback only triggers when semantic returns EMPTY.

6. **Embedding vector insertion** — pgvector requires the embedding to be cast to `::vector` type. The `seedEntry` helper uses `sql` template literal with explicit `::vector` cast. If the postgres.js driver doesn't support this syntax directly, an alternative is `sql`INSERT ... VALUES (... ${sql.array(embedding)}::vector(4096))`.

7. **TS-4.3** (AND logic) uses `mode=text` to avoid needing embeddings while testing the combined filter SQL. This is acceptable because the AND filter logic is in the query functions (independent of search mode), and semantic search AND logic is already tested by TS-2.3.
