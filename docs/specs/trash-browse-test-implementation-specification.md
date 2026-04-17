# Trash Browse - Test Implementation Specification

## Test Framework & Conventions

- **Framework:** Vitest (`describe`/`it` blocks, `expect` assertions)
- **Module mocking:** `vi.mock()` hoisted at top of file, `vi.mocked()` for type-safe mock access
- **Lifecycle:** `beforeEach` → `vi.resetModules()` + `vi.clearAllMocks()`, `afterEach` → `vi.restoreAllMocks()`
- **Unit tests:** Mock query layer and external services. Test Hono route handlers via `app.request()`.
- **Integration tests:** testcontainers with `pgvector/pgvector:pg16`. Mock only external services (embedding generation). Real DB queries.
- **Auth pattern:** `createAuthMiddleware` + `loginAndGetCookie` helper for authenticated requests.
- **Entry factory:** `createMockEntry(overrides)` with sensible defaults.

## Test Structure

| File | Type | Scenarios |
|------|------|-----------|
| `tests/unit/web-trash.test.ts` | unit | TS-1.1–1.4, TS-2.1–2.8, TS-5.1–5.5, TS-6.1–6.2, TS-7.2–7.5 |
| `tests/unit/web-entry-trash.test.ts` | unit | TS-4.1–4.6 |
| `tests/integration/web-trash-integration.test.ts` | integration | TS-2.1, TS-2.2, TS-2.4, TS-3.2, TS-4.3, TS-4.4, TS-5.3, TS-5.4, TS-7.1 |

**Rationale for split:**
- `web-trash.test.ts` covers the new `/trash` route handler (mirrors `web-browse.test.ts` structure)
- `web-entry-trash.test.ts` covers additions to the entry detail page (permanent delete button + route) — separate from existing `web-entry.test.ts` to avoid bloating that file
- Integration tests verify real DB behavior: sorting, filtering, hard delete, concurrent operations

## Test Scenario Mapping

### Unit: `tests/unit/web-trash.test.ts`

Mocks: `src/web/browse-queries.js` (all 4 functions), `src/embed.js` (`generateEmbedding`). The trash route handler reuses browse query functions with `deleted: true` in filters.

The `mockSql` must handle both the unclassified count query (existing browse pattern) and a trash count query (for "Empty Trash" button count and confirmation dialog count).

| TS ID | Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|-------|----------|---------------|---------------|---------------|------------------|
| TS-1.1 | Trash link in nav | `renders Trash nav item with icon and correct position` | Auth'd request | `GET /trash` | HTML contains `href="/trash"` with Trash2 SVG, appearing after Browse href and before Settings href in nav |
| TS-1.2 | Trash nav active on /trash | `highlights Trash nav item on /trash` | Auth'd request | `GET /trash` | Trash nav `<a>` has active class (`bg-secondary`), Browse nav does not |
| TS-1.3 | Trash nav active with query params | `highlights Trash nav item with query params` | Auth'd request | `GET /trash?category=tasks&tag=meeting` | Trash nav `<a>` has active class |
| TS-1.4 | Trash nav visible with no deleted entries | `shows Trash nav when no deleted entries exist` | `browseEntries` returns `[]`, trash count = 0 | `GET /trash` | HTML contains `href="/trash"` in nav |
| TS-2.1 | Lists deleted entries sorted by deleted_at DESC | `lists deleted entries` | `browseEntries` returns 3 entries | `GET /trash` | All 3 entries rendered in HTML |
| TS-2.2 | Category filter | `filters by category` | Auth'd request | `GET /trash?category=tasks` | `browseEntries` called with `{ category: "tasks", deleted: true }` |
| TS-2.3 | Tag filter | `filters by tag` | Auth'd request | `GET /trash?tag=meeting` | `browseEntries` called with `{ tag: "meeting", deleted: true }` |
| TS-2.4 | Combined category and tag | `filters by category and tag` | Auth'd request | `GET /trash?category=tasks&tag=urgent` | `browseEntries` called with `{ category: "tasks", tag: "urgent", deleted: true }` |
| TS-2.5 | Semantic search in trash | `performs semantic search in trash` | `generateEmbedding` returns vector, `semanticSearch` returns entries | `GET /trash?q=term` | `semanticSearch` called with embedding and `{ deleted: true }` |
| TS-2.6 | Text search fallback | `falls back to text search in trash` | `generateEmbedding` throws, `textSearch` returns entries | `GET /trash?q=term` | `textSearch` called with query and `{ deleted: true }`, notice shown |
| TS-2.7 | Combined search with filters | `combines search with category and tag` | `semanticSearch` returns entries | `GET /trash?q=term&category=tasks&tag=urgent` | `semanticSearch` called with `{ category: "tasks", tag: "urgent", deleted: true }` |
| TS-2.8 | Entry row shows deleted_at time | `displays deleted_at relative time` | `browseEntries` returns entry with `updated_at: 2026-04-01` and `deleted_at: 2026-04-15` | `GET /trash` | Time shown corresponds to `deleted_at` (not `updated_at`) |
| TS-5.1 | Empty Trash button visible | `shows Empty Trash button when entries exist` | Trash count > 0 | `GET /trash` | HTML contains "Empty Trash" button |
| TS-5.2 | Confirmation shows total count | `Empty Trash confirmation includes total count` | Trash count = 5, viewing filtered `/trash?category=tasks` | `GET /trash?category=tasks` | Confirmation text includes "5" (total, not filtered count) |
| TS-5.5 | Page reloads showing empty state | `returns success from empty trash endpoint` | Mock sql to return delete result | `POST /api/empty-trash` | Response indicates success |
| TS-6.1 | Empty state, no deleted entries | `shows empty state when trash is empty` | `browseEntries` returns `[]`, trash count = 0 | `GET /trash` | HTML contains "Trash is empty", no "Empty Trash" button |
| TS-6.2 | No results with filters | `shows no results with active filters` | `browseEntries` returns `[]` for filtered query, trash count > 0 | `GET /trash?category=people` | HTML contains "No entries in this category" |
| TS-7.2 | Category tabs link to /trash | `category tabs use /trash base path` | `browseEntries` returns entries | `GET /trash` | Category tab hrefs start with `/trash?category=` (not `/browse?category=`) |
| TS-7.3 | Tag pills link to /trash | `tag pills use /trash base path` | `getFilterTags` returns tags | `GET /trash` | Tag pill hrefs start with `/trash?tag=` (not `/browse?tag=`) |
| TS-7.4 | Search form action is /trash | `search form submits to /trash` | Auth'd request | `GET /trash` | `<form>` action is `/trash` (not `/browse`) |
| TS-7.5 | Soft-deleted entries persist | `old deleted entries still appear` | `browseEntries` returns entry with `deleted_at` 30 days ago | `GET /trash` | Entry is rendered in list |

### Unit: `tests/unit/web-entry-trash.test.ts`

Mocks: `src/web/entry-queries.js` (`getEntry`, `softDeleteEntry`, `restoreEntry`, and new `permanentDeleteEntry`).

| TS ID | Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|-------|----------|---------------|---------------|---------------|------------------|
| TS-4.1a | Delete permanently button for deleted entry | `shows Delete permanently button for deleted entry` | `getEntry` returns entry with `deleted_at` set | `GET /entry/{id}` | HTML contains "Delete permanently" button with destructive styling and `onsubmit` confirm |
| TS-4.1b | No button for active entry | `does not show Delete permanently for active entry` | `getEntry` returns entry with `deleted_at: null` | `GET /entry/{id}` | HTML does not contain "Delete permanently" |
| TS-4.2 | Confirmation dialog | `permanent delete button has confirmation` | `getEntry` returns deleted entry | `GET /entry/{id}` | Button's form has `onsubmit` containing "Permanently delete" |
| TS-4.3 | Hard delete + redirect | `permanent delete removes entry and redirects to /trash` | `getEntry` returns deleted entry, `permanentDeleteEntry` resolves | `POST /entry/{id}/permanent-delete` | `permanentDeleteEntry` called with `(sql, id)`, response redirects to `/trash` |
| TS-4.5 | Non-existent entry 404 | `permanent delete returns 404 for missing entry` | `getEntry` returns null | `POST /entry/{id}/permanent-delete` | Response status 404 |
| TS-4.6 | Active entry 404 | `permanent delete returns 404 for non-deleted entry` | `getEntry` returns entry with `deleted_at: null` | `POST /entry/{id}/permanent-delete` | Response status 404, entry unchanged |

### Integration: `tests/integration/web-trash-integration.test.ts`

Uses testcontainers (`startTestDb`, `runMigrations`). Mocks only `src/embed.js`. Seeds entries via direct SQL inserts using `seedEntry` helper (same pattern as `web-browse-integration.test.ts`).

| TS ID | Scenario | Test Function | Setup (Given) | Action (When) | Assertion (Then) |
|-------|----------|---------------|---------------|---------------|------------------|
| TS-2.1 | Sorted by deleted_at DESC | `lists deleted entries sorted by deleted_at descending` | Seed 3 entries with different `deleted_at` timestamps + 2 active entries | `GET /trash` | HTML shows entries in `deleted_at` DESC order, active entries absent |
| TS-2.2 | Category filter with real DB | `filters deleted entries by category` | Seed deleted entries: 2 tasks, 1 idea, plus 1 active task | `GET /trash?category=tasks` | Only 2 deleted tasks shown |
| TS-2.4 | Combined filters with real DB | `combines category and tag filters` | Seed deleted entries with various categories and tags | `GET /trash?category=tasks&tag=urgent` | Only matching entries shown |
| TS-3.2 | Restore removes from trash | `restored entry disappears from trash` | Seed deleted entry, restore via `POST /entry/{id}/restore` | `GET /trash` | Entry absent; `GET /browse` → entry present |
| TS-4.3 | Permanent delete with real DB | `permanent delete removes entry from database` | Seed deleted entry | `POST /entry/{id}/permanent-delete`, then `SELECT` | Entry not in database, redirect to `/trash` |
| TS-4.4 | No calendar call on permanent delete | `permanent delete does not call calendar API` | Seed deleted entry with `google_calendar_event_id`, spy on `globalThis.fetch` | `POST /entry/{id}/permanent-delete` | `fetch` not called with googleapis URL, entry gone from DB |
| TS-5.3 | Empty trash hard-deletes all | `empty trash removes all deleted entries` | Seed 3 deleted + 2 active entries | `POST /api/empty-trash`, then `SELECT` | 3 deleted entries gone, 2 active remain |
| TS-5.4 | Not scoped by filters | `empty trash ignores active filters` | Seed 5 deleted entries (2 tasks, 3 ideas) | `POST /api/empty-trash` while viewing `/trash?category=tasks` | All 5 deleted entries gone |
| TS-7.1 | Concurrent empty trash | `concurrent empty trash is safe` | Seed 3 deleted entries | Two concurrent `POST /api/empty-trash` | Both succeed, entries gone, no errors |

## Fixtures & Test Data

### Entry Factory

Reuse the existing `createMockEntry(overrides)` pattern from `web-browse.test.ts` and `web-entry.test.ts`. Key overrides for trash tests:

```typescript
// Deleted entry
createMockEntry({ deleted_at: new Date("2026-04-15T10:00:00Z") })

// Deleted entry with orphaned calendar event
createMockEntry({
  deleted_at: new Date("2026-04-15T10:00:00Z"),
  google_calendar_event_id: "orphaned-event-123",
})

// Deleted entries with staggered deletion times (for sort order tests)
createMockEntry({ name: "Entry A", deleted_at: new Date("2026-04-10") })
createMockEntry({ name: "Entry B", deleted_at: new Date("2026-04-15") })
createMockEntry({ name: "Entry C", deleted_at: new Date("2026-04-12") })
```

### Test App Factory

**Unit (`createTestTrash`):** Follows `createTestBrowse` pattern — creates Hono app with auth middleware + trash routes. `mockSql` is a `vi.fn()` that handles:
- Unclassified count query (existing): returns `[{ count: 0 }]`
- Trash count query (new): returns configurable count
- Empty trash delete: returns `[{ count: N }]`

```typescript
async function createTestTrash(
  trashCount = 0,
): Promise<{ app: Hono; mockSql: any }> {
  // same auth setup pattern as createTestBrowse
  // mockSql returns trashCount for count queries
}
```

**Integration (`createIntegrationTrash`):** Follows `createIntegrationBrowse` pattern — creates Hono app with real SQL and auth middleware. Mounts both trash routes and entry routes (for permanent delete and restore tests).

```typescript
async function createIntegrationTrash(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  // mounts createTrashRoutes(sql) + createEntryRoutes(sql)
}
```

### Seed Helper (Integration)

Reuse the `seedEntry(sql, overrides)` pattern from `web-browse-integration.test.ts`. The existing helper already supports `deleted_at` in overrides.

### Cleanup

- Unit: `vi.clearAllMocks()` in `beforeEach`
- Integration: `await sql\`DELETE FROM entries\`` in `beforeEach` (per existing pattern)

## Mocking Strategy

### Unit Tests

| Dependency | Mock Strategy | Notes |
|-----------|--------------|-------|
| `src/web/browse-queries.js` | `vi.mock()` all 4 functions | Same as `web-browse.test.ts` — verify calls receive `deleted: true` in filters |
| `src/embed.js` | `vi.mock()` `generateEmbedding` | Returns fake 4096-dim vector or throws (for fallback tests) |
| `src/web/entry-queries.js` | `vi.mock()` existing + new `permanentDeleteEntry` | For `web-entry-trash.test.ts` |
| `src/google-calendar.js` | Not mocked | Permanent delete route must NOT import or call calendar functions — absence of the mock is itself an assertion |
| SQL tagged template | `vi.fn()` with `.array()` and `.json()` | For trash count and empty-trash queries |

### Integration Tests

| Dependency | Mock Strategy | Notes |
|-----------|--------------|-------|
| `src/embed.js` | `vi.mock()` | External service; returns fake embedding or null |
| `globalThis.fetch` | `vi.spyOn` | For TS-4.4 (assert no calendar API call) |
| Database | Real (testcontainers) | `pgvector/pgvector:pg16` |

## Implementation Notes

### New Query Function: `permanentDeleteEntry`

Add to `src/web/entry-queries.ts`:
```typescript
export async function permanentDeleteEntry(sql: Sql, id: string): Promise<boolean>
```
Returns `true` if a row was deleted, `false` if no row matched (entry didn't exist or wasn't soft-deleted). The query: `DELETE FROM entries WHERE id = $1 AND deleted_at IS NOT NULL`.

### Modified: `BrowseFilters`

Add `deleted?: boolean` to the `BrowseFilters` interface in `src/web/browse-queries.ts`. All 4 query functions check this flag:
- `deleted: true` → `WHERE deleted_at IS NOT NULL`
- `deleted: false` or undefined → `WHERE deleted_at IS NULL` (existing behavior, no change)

### Modified: `browseEntries` Sort Order

When `deleted: true`, sort by `deleted_at DESC` instead of `updated_at DESC`.

### Modified: `renderLayout` and `buildUrl`

- `renderLayout` accepts an `activePage` string. Trash passes `"/trash"`. Nav array gains a Trash entry.
- `buildUrl` accepts an optional `basePath` parameter (default `"/browse"`). Trash rendering passes `"/trash"`.
- `renderSearchBar` accepts `basePath` for the form action.
- `renderCategoryTabs` and `renderTagPills` pass `basePath` through to `buildUrl`.

### Modified: Entry Detail Page

The entry detail page (`src/web/entry.ts`) for soft-deleted entries currently shows "Restore". Add "Delete permanently" alongside it:
- Form: `<form method="POST" action="/entry/${id}/permanent-delete" onsubmit="return confirm('...')">`
- New route: `app.post("/entry/:id/permanent-delete", ...)`
- Guard: UUID validation + `getEntry` + check `deleted_at IS NOT NULL`, else 404

### New: Empty Trash Endpoint

`POST /api/empty-trash` in the trash route handler:
- Executes `DELETE FROM entries WHERE deleted_at IS NOT NULL`
- Returns JSON `{ deleted: N }` with count of removed rows
- Client JS: `fetch('/api/empty-trash', { method: 'POST' })`, on success reloads page

## Alignment Check

**Full alignment.** Every test scenario from the test specification is mapped:

- TS-1.1 through TS-1.4 → `web-trash.test.ts` (Navigation group)
- TS-2.1 through TS-2.8 → `web-trash.test.ts` (Listing group) + integration
- TS-3.1, TS-3.2 → `web-trash.test.ts` (TS-3.1 is implicit via entry link rendering) + integration (TS-3.2)
- TS-4.1 through TS-4.6 → `web-entry-trash.test.ts` + integration
- TS-5.1 through TS-5.5 → `web-trash.test.ts` (Empty Trash group) + integration
- TS-6.1, TS-6.2 → `web-trash.test.ts` (Empty State group)
- TS-7.1 through TS-7.5 → `web-trash.test.ts` + integration (TS-7.1)

**Design concerns:** None. All tests verify observable behavior (HTTP responses, HTML content, mock call arguments, database state). No tests depend on internal implementation details.

**Client-side tests:** TS-4.2 (confirmation dialog) and TS-5.2 (confirmation with count) are verified by checking the `onsubmit` attribute in rendered HTML. The actual browser `confirm()` behavior is not testable in Vitest but the presence and text of the attribute is verifiable.
