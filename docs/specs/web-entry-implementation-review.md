# Web Entry — Implementation Review

| Field | Value |
|-------|-------|
| Feature | Web Entry |
| Date | 2026-03-06 |
| Status | PASS |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 14 acceptance criteria (AC-1.1–AC-3.4), all testable constraints, and all edge cases (EC-2–EC-7) mapped to test scenarios. EC-1 (concurrent edit) explicitly excluded — standard last-write-wins DB behavior. |
| Test Spec -> Spec traceability | PASS | All 27 test scenarios trace to at least one spec requirement. No orphan scenarios. |
| Test Spec -> Test Impl Spec coverage | PASS | All 27 test scenarios mapped to test functions (20 unit + 7 integration). |
| Test Impl Spec -> Test Spec (no orphans) | PASS | No orphan test implementations. |
| Spec constraints respected | PASS | Server-rendered HTML via Hono, separate edit route, markdown server-side rendering (marked + sanitize-html), auth required, UUID validation, embedding re-gen fallback, updated_at via DB trigger. |
| Non-goals respected | PASS | No collaborative editing, version history, comments, sharing, entry linking, markdown preview, or attachments implemented. |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Impl Spec | PASS | All 27 test functions implemented matching spec IDs (TS-1.1–TS-5.9). Unit: `tests/unit/web-entry.test.ts` (20), Integration: `tests/integration/web-entry-integration.test.ts` (7). |
| Feature code vs Behavioral Spec | PASS | All routes implemented: `GET /entry/:id`, `GET /entry/:id/edit`, `POST /entry/:id/edit`, `POST /entry/:id/delete`, `POST /entry/:id/restore`. All acceptance criteria met. |
| Undocumented behavior | PASS | No significant untested code paths. See INFO items below. |

### Implementation Files

| File | Purpose |
|------|---------|
| `src/web/entry.ts` | Route handlers — view, edit form, save, delete, restore |
| `src/web/entry-queries.ts` | DB queries — `getEntry`, `updateEntry`, `softDeleteEntry`, `restoreEntry`, `getAllTags` |
| `src/index.ts` | Entry routes wired via `createEntryRoutes(sql)` |

### Key Implementation Details

- **Markdown rendering:** `marked` library (server-side) + `sanitize-html` for XSS protection. Renders headings, bold, italic, lists, code, pre, links. Script tags and event handlers are stripped.
- **Category field migration:** `migrateFields()` maps submitted fields to new category schema — carries over overlapping fields, drops inapplicable, adds missing with null defaults. Schema sourced from `CATEGORY_FIELDS` constant matching ARCHITECTURE.md.
- **Embedding re-gen:** `embedEntry(sql, id)` called after save in try/catch — Ollama failure doesn't block save.
- **Confidence:** `updateEntry` SQL sets `confidence = NULL` unconditionally.
- **Delete redirect:** Parses `Referer` header with `new URL(referer, "http://localhost")` for both relative and absolute URLs. Extracts only pathname+search (prevents open redirect to external sites). Falls back to `/`.
- **Tag autocomplete:** `<datalist>` with all existing tags rendered into edit page. Tags submitted as comma-separated string, parsed by `parseTags()`.
- **UUID validation:** Regex check on all 5 route handlers before DB query prevents Postgres cast errors on invalid IDs.
- **HTML escaping:** `escapeHtml` covers `&`, `<`, `>`, `"`, and `'` (single quotes).

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (feature) | 27 |
| Passed | 27 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/web-entry.test.ts tests/integration/web-entry-integration.test.ts` |

| Metric | Value |
|--------|-------|
| Total tests (full suite) | 294 |
| Passed | 294 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run` |

## Coverage Report

### Gaps
- None

### Misalignments
- None

### Unresolved Items
- None

## Findings

### Fixed during review

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| 1 | CRITICAL | `marked.parse()` output injected raw into HTML — XSS via Telegram/MCP content containing `<script>`, event handlers, etc. | Added `sanitize-html` dependency. Markdown output is now sanitized before rendering. Allows safe tags (headings, lists, code, links, images) while stripping scripts and event handlers. |
| 2 | WARNING | `POST /entry/:id/delete` and `POST /entry/:id/restore` did not validate UUID format. Invalid UUID would cause Postgres runtime error (500) instead of clean 404. | Added `UUID_RE.test(id)` guard to both handlers, matching pattern in GET handlers. |
| 3 | WARNING | `escapeHtml` did not escape single quotes. Safe with current double-quoted attributes but fragile for future changes. | Added `.replace(/'/g, "&#39;")` to `escapeHtml`. |
| 4 | WARNING | `getAllTags` on GET edit path (line 354) missing `?? []` null guard, inconsistent with POST validation path. | Added `?? []` guard for consistency. |

### Remaining (non-blocking)

| # | Severity | Layer | Description |
|---|----------|-------|-------------|
| 5 | INFO | Code | Helper functions (`escapeHtml`, `categoryBadgeClass`, `sourceIcon`) are duplicated across `dashboard.ts`, `browse.ts`, and `entry.ts`. Extract to shared utility after all web features are implemented. |
| 6 | INFO | Code | Delete confirmation uses inline `onsubmit="return confirm('...')"`. Functionally correct per AC-3.1. Acceptable given no client-side framework. |
| 7 | INFO | Code | Edit page is not blocked for soft-deleted entries. Spec does not require this (AC-1.4 only mentions view+restore). Minor UX consideration for future iteration. |
| 8 | INFO | Code | `updateEntry` silently succeeds (0 rows affected) if entry was deleted between GET and POST. Consistent with spec's "last write wins" approach. |

## Recommendations

- No action required. All CRITICAL and WARNING findings fixed during this review.
- Utility deduplication (finding #5) is a good candidate for a cleanup pass after all web features are implemented.
