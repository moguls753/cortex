# Web Browse — Implementation Review

| Field | Value |
|-------|-------|
| Feature | Web Browse |
| Date | 2026-03-06 |
| Status | ISSUES FOUND |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 18 ACs, 6 constraints, 8 edge cases, 4 resolved questions mapped to 33 test scenarios |
| Test Spec -> Spec traceability | PASS | All 33 scenarios trace to spec requirements, no orphans |
| Test Spec -> Test Impl Spec coverage | PASS | All 33 scenarios mapped to test functions (20 unit + 13 integration) |
| Test Impl Spec -> Test Spec (no orphans) | PASS | No orphan test implementations |
| Spec constraints respected | PASS | Server-rendered HTML, auth required, cosine >= 0.5 at DB level, filter state in URL |
| Non-goals respected | PASS | No pagination, no saved searches, no search history, no export, no tsvector, no advanced query syntax, no sort options |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Impl Spec | PASS | All 33 test functions match spec (20 in `tests/unit/web-browse.test.ts`, 13 in `tests/integration/web-browse-integration.test.ts`) |
| Feature code vs Behavioral Spec | PASS | `src/web/browse.ts` and `src/web/browse-queries.ts` implement all specified behaviors |
| Undocumented behavior | PASS | No untested code paths found |

### Module API vs Test Impl Spec

| Specified API | Implemented | Match |
|--------------|-------------|-------|
| `createBrowseRoutes(sql: Sql): Hono` | `browse.ts:206` | Yes |
| `browseEntries(sql, filters?)` | `browse-queries.ts:11` | Yes |
| `semanticSearch(sql, queryEmbedding, filters?)` | `browse-queries.ts:30` | Yes |
| `textSearch(sql, query, filters?)` | `browse-queries.ts:54` | Yes |
| `getFilterTags(sql, options?)` | `browse-queries.ts:76` | Yes |
| `BrowseFilters { category?, tag? }` | `browse-queries.ts:6` | Yes |

### Handler Logic vs Spec

| Behavior | Specified | Implemented | Match |
|----------|-----------|-------------|-------|
| Parse q, category, tag, mode from URL | Yes | `browse.ts:210-214` | Yes |
| Truncate q to 500 chars | Yes | `browse.ts:216` | Yes |
| No q: call browseEntries | Yes | `browse.ts:244-245` | Yes |
| mode=text: call textSearch directly | Yes | `browse.ts:226-227` | Yes |
| Default: generateEmbedding + semanticSearch | Yes | `browse.ts:230-232` | Yes |
| Semantic empty -> textSearch fallback + notice | Yes | `browse.ts:233-237` | Yes |
| Ollama error -> textSearch fallback + notice | Yes | `browse.ts:239-241` | Yes |
| getFilterTags scoped to category | Yes | `browse.ts:248` | Yes |
| Render via renderLayout("Browse", ..., "/browse") | Yes | `browse.ts:267` | Yes |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests | 267 |
| Passed | 267 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run` |

Web-browse specific: 33 tests (20 unit + 13 integration), all passing.

## Coverage Report

### Gaps
- None

### Misalignments
- None

### Unresolved Items
- None (no `[NEEDS CLARIFICATION]` markers in spec)

## Findings

| # | Severity | Layer | Description |
|---|----------|-------|-------------|
| 1 | WARNING | Deployment | Browse routes not wired in `src/index.ts`. The `createBrowseRoutes` function is not imported or mounted in the main app entry point. Tests pass because they wire their own Hono apps. The route won't be accessible in production until wired. |
| 2 | INFO | Code quality | `textSearch` ILIKE pattern `%${query}%` does not escape SQL ILIKE wildcards (`%`, `_`) in user input. A search for `100%` would match any content. Acceptable for a personal knowledge base; address if multi-user. |
| 3 | INFO | Code quality | Helper functions (`escapeHtml`, `categoryBadgeClass`, `categoryAbbr`, `relativeTime`) are duplicated between `browse.ts` and `dashboard.ts`. Could be extracted to a shared module in a future refactor. |

## Recommendations

1. **Wire browse routes in `src/index.ts`** — add `import { createBrowseRoutes } from "./web/browse.js"` and `app.route("/", createBrowseRoutes(sql))` after the dashboard route mount. This is the only action needed to make the feature available in production.
2. Findings #2 and #3 are non-blocking and can be addressed in a future pass.
