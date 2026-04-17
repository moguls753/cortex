# Trash Browse — Implementation Review

| Field | Value |
|-------|-------|
| Feature | trash-browse |
| Date | 2026-04-15 |
| Status | PASS |

## Scope

- Feature: dedicated `/trash` page with browse-like filtering, permanent delete, and empty-trash. Closes the gap where soft-deleted entries were invisible without direct DB access.
- Implementation files: `src/web/trash.ts` (route handler, 181 lines), additions to `src/web/browse-queries.ts` (`deleted` flag on `BrowseFilters`), `src/web/browse.ts` (exported rendering functions + `basePath` parameter), `src/web/entry-queries.ts` (`permanentDeleteEntry`), `src/web/entry.ts` (permanent delete button + route), `src/web/layout.ts` (Trash nav item). Mounted in `src/index.ts` via `createTrashRoutes(sql)`.
- Spec artifacts: `trash-browse-specification.md` (116 lines), `trash-browse-test-specification.md` (373 lines), `trash-browse-test-implementation-specification.md` (220 lines).
- Tests: 36 total -- 21 unit (`tests/unit/web-trash.test.ts`) + 6 unit (`tests/unit/web-entry-trash.test.ts`) + 9 integration (`tests/integration/web-trash-integration.test.ts`). All passing.

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 23 acceptance criteria (AC-1.1 through AC-6.3) map to at least one TS scenario. All 6 edge cases (EC-1 through EC-6) are covered. Non-goals NG-1 and NG-4 verified by TS-7.5 and TS-5.4. Coverage matrix at test-spec lines 1-43 is complete. |
| Test Spec -> Spec traceability | PASS | All 25 TS scenarios trace to a specific AC / US / edge case / non-goal. No orphan scenarios. The Traceability Summary (test-spec lines 362-372) explicitly asserts completeness. |
| Test Spec -> Test Impl Spec coverage | PASS | Every TS-x.x has a dedicated row in the test impl spec tables with Setup/Action/Assertion. File assignments are complete: unit split across `web-trash.test.ts` (20 scenarios) and `web-entry-trash.test.ts` (6 scenarios), integration covers 9 scenarios. |
| Test Impl Spec -> Test Spec (no orphans) | PASS | All test impl entries use exact TS IDs. No extraneous entries. |
| Spec constraints respected | PASS | Design system layout followed (Tailwind only, no inline styles). Server-rendered via Hono. Shared query infrastructure via `BrowseFilters.deleted`. `iconTrash2` reused from `src/web/icons.ts`. Vanilla JS only for Empty Trash confirmation. |
| Non-goals respected | PASS | NG-1 (no auto-purge): entries persist indefinitely, verified by TS-7.5. NG-2 (no undo): confirmation dialog is the only safety net. NG-3 (no per-user scoping): single-user model. NG-4 (no multi-select): only single permanent delete or empty-all. NG-5 (no SSE): no SSE subscription on trash page. |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Spec | PASS | 27 test functions cover all 25 TS scenarios. TS-4.1 split into TS-4.1a + TS-4.1b (2 tests for 1 scenario) as specified in the test impl spec. TS-3.1 is implicitly covered via `renderEntryList` which generates `href="/entry/${id}"` links -- the test impl spec notes "TS-3.1 is implicit via entry link rendering". |
| Test code vs Test Impl Spec | PASS | Test functions follow the setup/action/assertion patterns specified. Factory patterns (`createTestTrash`, `createTestEntry`, `createIntegrationTrash`) match the test impl spec decisions. Mock strategies align: `vi.mock()` for browse-queries and embed in unit tests, `vi.spyOn(globalThis, 'fetch')` for calendar API assertion in integration. |
| Feature code vs Behavioral Spec | PASS | All ACs implemented. See detailed walkthrough in Coverage Report below. |
| Undocumented behavior | PASS (minor) | The `MAX_QUERY_LENGTH = 500` truncation in `trash.ts` mirrors the browse page but is not called out in the trash spec. This is inherited behavior from the shared search infrastructure and is consistent. |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (feature) | 36 |
| Passed | 36 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/web-trash.test.ts tests/unit/web-entry-trash.test.ts tests/integration/web-trash-integration.test.ts` |
| Full-suite regression | 695 unit + all integration passing, zero regressions |

## Coverage Report

### AC-by-AC Walkthrough

| AC | Implementation | Test Coverage | Status |
|----|---------------|---------------|--------|
| AC-1.1 Trash in nav between Browse and Settings | `layout.ts:163-167` nav array: Browse, Trash, Settings | TS-1.1: checks href order (browseIdx < trashIdx < settingsIdx) | PASS |
| AC-1.2 Trash2 icon at size-3.5 | `layout.ts:165` `iconTrash2("size-3.5")` | TS-1.1: checks SVG path `M3 6h18` | PASS |
| AC-1.3 Trash highlighted on /trash | `trash.ts:168` passes `"/trash"` as activePage; `layout.ts:170` exact match | TS-1.2, TS-1.3: regex match on active class | PASS |
| AC-1.4 Trash always visible | `layout.ts:163-167` unconditional in nav array | TS-1.4: checks href present with trashCount=0 | PASS |
| AC-2.1 Lists deleted, sorted by deleted_at DESC | `browse-queries.ts:27-28` conditional ORDER BY | TS-2.1 (unit + integration): integration verifies B > C > A order | PASS |
| AC-2.2 Category filter | `trash.ts:51` sets `deleted: true` on filters | TS-2.2 (unit + integration): mock call args + real DB | PASS |
| AC-2.3 Tag filter | `trash.ts:51` sets `deleted: true` on filters | TS-2.3: mock call args with `tag: "meeting"` | PASS |
| AC-2.4 Combined filters | filters object accumulates both | TS-2.4 (unit + integration): both category + tag + deleted | PASS |
| AC-2.5 Semantic search in trash | `trash.ts:62-69` semantic path with `deleted: true` filters | TS-2.5: checks semanticSearch call filters | PASS |
| AC-2.6 Search + filters combined | Same path as AC-2.5 with accumulated filters | TS-2.7: checks all three params in call | PASS |
| AC-2.7 Entry row shows deleted_at time | `browse.ts:169` `renderEntryList` accepts `timeField` param; `trash.ts:117` passes `"deleted_at"` | TS-2.8: entry with deleted_at 2h ago shows "2h ago" | PASS |
| AC-3.1 Entry links to /entry/:id | `browse.ts:179` `renderEntryList` generates `href="/entry/${entry.id}"` | Implicit via renderEntryList (see F-2 note) | PASS |
| AC-3.2 Restore removes from trash | Existing `POST /entry/:id/restore` in entry.ts | TS-3.2 (integration): restore + verify absent from trash + DB check | PASS |
| AC-4.1 Delete permanently button | `entry.ts:115-117` renders form + button for deleted entries | TS-4.1a: checks button text + form action + destructive class | PASS |
| AC-4.2 Destructive styling | `entry.ts:116` `text-destructive border border-destructive` | TS-4.1a: checks `text-destructive` | PASS |
| AC-4.3 Browser confirmation | `entry.ts:115` `onsubmit="return confirm('Permanently delete...')"` | TS-4.2: regex on onsubmit attribute | PASS |
| AC-4.4 Hard delete via POST | `entry.ts:432` calls `permanentDeleteEntry(sql, id)` | TS-4.3 (unit + integration): mock call + DB verification | PASS |
| AC-4.5 No calendar API on permanent delete | `trash.ts` and permanent delete route do not import google-calendar | TS-4.4 (integration): `vi.spyOn(globalThis, 'fetch')` asserts no googleapis calls | PASS |
| AC-4.6 Redirect to /trash | `entry.ts:433` `c.redirect("/trash", 302)` | TS-4.3: checks status 302 + location header | PASS |
| AC-4.7 404 for invalid entries | `entry.ts:429` guards on `!entry \|\| !entry.deleted_at` | TS-4.5 (null entry), TS-4.6 (active entry): both check 404 | PASS |
| AC-5.1 Empty Trash button | `trash.ts:99-108` conditional on `trashCount > 0` | TS-5.1: regex match on "Empty Trash" | PASS |
| AC-5.2 Confirmation shows total count | `trash.ts:141` includes `${trashCount}` in confirm text | TS-5.2: trashCount=5, filtered to 2, checks "5" in body | PASS |
| AC-5.3 Hard delete all | `trash.ts:173-175` `DELETE FROM entries WHERE deleted_at IS NOT NULL` | TS-5.3 (integration): 3 deleted + 2 active, verifies 3 deleted, 2 remain | PASS |
| AC-5.4 Not scoped by filters | Endpoint has no filter params | TS-5.4 (integration): 5 deleted across categories, all 5 deleted | PASS |
| AC-5.5 Page reloads empty | Client JS calls `window.location.reload()` after success | TS-5.5 (unit): verifies endpoint returns success JSON | PASS |
| AC-5.6 No calendar on empty trash | `trash.ts` does not import google-calendar | TS-5.3 (integration): asserts no googleapis fetch calls | PASS |
| AC-6.1 Empty state | `trash.ts:112-113` renders "Trash is empty." when no results and trashCount=0 | TS-6.1: checks text + absence of Empty Trash button | PASS |
| AC-6.2 No results with filters | `trash.ts:114-115` falls through to `renderEmptyState` | TS-6.2: checks "No entries in this category" | PASS |
| AC-6.3 Empty Trash hidden when empty | `trash.ts:99` conditional on `trashCount > 0` | TS-6.1: `not.toMatch(/empty\s*trash/i)` | PASS |

### Gaps

None. All 23 acceptance criteria have test coverage.

### Misalignments

None found between spec artifacts.

### Unresolved Items

None. The behavioral spec has no open questions.

## Findings

| # | Severity | Layer | Description | Status |
|---|----------|-------|-------------|--------|
| F-1 | WARNING | Feature code | **`textSearch` sorts by `updated_at DESC` instead of `deleted_at DESC` when `deleted: true`.** `browseEntries` correctly uses conditional `ORDER BY` (`deleted_at DESC` when `deleted: true`, `updated_at DESC` otherwise), but `textSearch` at `browse-queries.ts:75` always uses `ORDER BY updated_at DESC` regardless of the `deleted` flag. When a trash user's semantic search falls back to text search, results will be sorted by last-update time rather than deletion time. AC-2.1 says "sorted by `deleted_at DESC`" and AC-2.5 says search uses "the same semantic-then-text-fallback search as browse, scoped to deleted entries". The sort order requirement is stated for the listing (AC-2.1), not explicitly for search results. `semanticSearch` sorts by `similarity DESC` (relevance), which is correct for search. `textSearch` sorting by `updated_at` is arguably acceptable for a fallback search (relevance over recency), but it is inconsistent with `browseEntries`. | OPEN |
| F-2 | INFO | Test code | **TS-3.1 (entry links to `/entry/:id`) has no explicit test assertion.** The test impl spec notes "TS-3.1 is implicit via entry link rendering" -- the `renderEntryList` function always generates `<a href="/entry/${id}">` links, so any test that renders entries implicitly covers this. However, no test explicitly asserts that an entry link in the trash page points to `/entry/{id}`. The integration TS-2.1 test could add a simple `expect(body).toContain(\`/entry/${entryId}\`)` check. | OPEN |
| F-3 | INFO | Feature code | **Permanent delete redirect uses 302 instead of 303.** At `entry.ts:433`, `c.redirect("/trash", 302)` is used, while all other POST redirects in the same file use 303 (soft delete at line 403/409, restore at line 419, edit save at line 379). Per HTTP semantics, 303 (See Other) is the correct status for a POST-Redirect-GET pattern. 302 works identically in all modern browsers, so this is cosmetic, but it breaks the local convention. | OPEN |
| F-4 | INFO | Test code | **TS-3.2 integration test does not verify entry appears in `/browse`.** The test spec says "the entry appears in `/browse`" but the integration test at `web-trash-integration.test.ts:326-328` verifies the DB state (`deleted_at IS NULL`) instead of rendering the browse page. This is a weaker assertion -- it proves the entry is restorable but does not exercise the browse rendering path. The `createIntegrationTrash` helper does not mount browse routes, so a `GET /browse` request would 404. Acceptable because the DB check is equivalent (browse queries filter on `deleted_at IS NULL`), but the test deviates from the test spec's stated assertion. | OPEN |
| F-5 | INFO | Feature code | **`escapeHtml` applied to numeric `trashCount` in client-side JS string.** At `trash.ts:141`, the confirmation dialog text uses `${escapeHtml(String(trashCount))}`. Since `trashCount` is always an integer from `COUNT(*)::int`, the escapeHtml call is defensive but unnecessary. Not a bug -- just redundant defense. | OPEN |

## Positive Observations

1. **Excellent query reuse.** The `BrowseFilters.deleted` flag elegantly extends all four browse query functions (`browseEntries`, `semanticSearch`, `textSearch`, `getFilterTags`) without duplicating any SQL. The conditional `WHERE` and `ORDER BY` clauses are clean.

2. **Clean rendering function extraction.** The `browse.ts` refactor to export `buildUrl`, `renderCategoryTabs`, `renderTagPills`, `renderSearchBar`, `renderEntryList`, `renderNotice`, and `renderEmptyState` with a `basePath` parameter is well-designed. No code duplication between browse and trash.

3. **Robust guard on permanent delete.** The `entry.ts:429` guard checks both `!entry` and `!entry.deleted_at` before allowing permanent delete, preventing accidental hard-deletion of active entries. The `permanentDeleteEntry` query at `entry-queries.ts:67` also has a `AND deleted_at IS NOT NULL` clause as a belt-and-suspenders defense.

4. **Correct Empty Trash scope.** The `POST /api/empty-trash` endpoint at `trash.ts:172-176` is intentionally filter-agnostic (no query parameters accepted), and the confirmation dialog correctly shows the total count, not the filtered count. This matches AC-5.4 exactly.

5. **No Google Calendar import in trash module.** The trash route handler (`trash.ts`) and the permanent delete route handler do not import `google-calendar.js` at all, which is the strongest possible guarantee for AC-4.5 and AC-5.6. The integration tests verify this with `fetch` spy assertions.

6. **Test infrastructure is clean and consistent.** Factory functions (`createTestTrash`, `createTestEntry`, `createIntegrationTrash`) follow the established project patterns. Mock setup is correct with `vi.resetModules()` in `beforeEach`. The `mockSql` tagged-template mock pattern handles both count queries and delete operations.

## Recommendations

1. **(F-1, recommended)** Add conditional `ORDER BY` to `textSearch` in `browse-queries.ts:75`: `ORDER BY ${deleted ? sql\`deleted_at DESC\` : sql\`updated_at DESC\`}`. This aligns with `browseEntries` and ensures consistency when text search fallback fires in the trash context.

2. **(F-3, optional)** Change `entry.ts:433` from `c.redirect("/trash", 302)` to `c.redirect("/trash", 303)` for consistency with other POST redirect patterns in the file.

3. **(F-2 + F-4, optional)** Add an explicit `href="/entry/${id}"` assertion in the TS-2.1 integration test, and consider mounting `createBrowseRoutes(sql)` in `createIntegrationTrash` so TS-3.2 can verify the full roundtrip.

4. **Update `progress.md`** to add the trash-browse feature row and record Phase 6 completion.
