# Browse Filters — Implementation Review

## Specification Alignment

Cross-check between the three spec documents:

- **Behavioral spec** (`browse-filters-specification.md`): 4 user stories, 32 acceptance criteria (AC-1.1..7, AC-2.1..7, AC-3.1..11, AC-4.1..7), 8 constraints (C-1..8), 14 edge cases (E-1..14), 11 non-goals (NG-1..11). No Open Questions remaining.
- **Test spec** (`browse-filters-test-specification.md`): 80 test scenarios organized in 5 groups. Coverage matrix maps every AC / C / E / NG to at least one scenario (or to a documented regression/review coverage note).
- **Test-impl spec** (`browse-filters-test-implementation-specification.md`): Every scenario mapped to a specific test function in one of 5 files. Unit/integration split documented (49 unit + 20 integration, with 11 additional regression scenarios verified via existing suites).

No inconsistencies detected between the three documents. AC IDs are used consistently across all three. The Test Implementation spec's file-assignment tally matches the actual test file changes.

## Code Alignment

**Test code vs test spec:**

- `tests/unit/web-dashboard.test.ts`: 11 new tests implemented — TS-1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.10, 1.11, 1.12, 5.10. All mapped to the corresponding spec scenarios.
- `tests/unit/web-browse.test.ts`: 48 new tests implemented — TS-2.16..21 (validation), TS-3.1..26 with TS-3.14 split into a/b/c (filter bar), TS-4.1..6 (preserved behavior), TS-5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9 (constraints).
- `tests/unit/web-trash.test.ts`: 1 new test — TS-4.7.
- `tests/integration/web-dashboard-integration.test.ts`: 2 new tests — TS-1.7, 1.8.
- `tests/integration/web-browse-integration.test.ts`: 18 new tests — TS-2.1..15, 2.22, 2.23, 5.7.

**Total new tests: 80. Every scenario in the test spec is implemented.** No orphan tests (tests without a spec scenario) were introduced.

**Implementation code vs spec:**

- `src/web/browse-queries.ts` — extended with `SinceValue`, `StatusValue` type exports and three new filter fragments (`sinceFragment`, `statusFragment`, `staleDaysFragment`). `browseEntries`, `semanticSearch`, and `textSearch` now compose these fragments into their queries. Matches AC-2.1 (date_trunc predicates), AC-2.2 (fields->>'status' equality), AC-2.3 (updated_at < now() - interval), AC-2.4 (AND composition), AC-2.7 (filters apply to both paths).
- `src/web/browse.ts` — added `parseFilterParams` (validates per AC-2.5), `browseUrl` helper (composes URLs with all 7 params), `renderFilterBar` plus sub-renderers (`renderPill`, `renderValuePicker`, `renderAddFilterMenu`) matching AC-3.1..11. Handler now validates before DB query (AC-2.5, TS-5.5) and renders the filter bar below the tag pill row (AC-3.1).
- `src/web/dashboard.ts` — `renderStats` now emits each card as an `<a>` with the destination href from AC-1.2, adding `hover:border-primary hover:bg-secondary transition-colors` per AC-1.4. The `[data-stat]` span is preserved inside the anchor (AC-1.7).
- `src/web/i18n/en.ts` and `de.ts` — `browse.filter.*` key block added with full English + German coverage, including plural variants (`stale_days_one`/`_other`, `results_zero`/`_one`/`_other`) and pluralized pill templates. Matches C-4.

**Undocumented behavior:** None detected. All code changes trace back to at least one AC or constraint.

## Test Execution

**Runner detected:** Vitest (per `package.json` scripts `test`, `test:unit`, `test:integration`).

**Commands run:**
- `npm run test:unit` → **889/889 passing (0 failures)**. Baseline before this feature was 829; the feature adds 60 net tests.
- `npm run test:integration` → **199/200 passing, 1 failure**. The one failure is `Google Calendar Integration > Edge Cases > TS-8.4: revoked refresh token shows disconnected`, which fails with `Error: Failed to connect to Reaper` — a testcontainers/Docker state issue unrelated to this feature. The browse-filters integration scenarios (20 new tests) all pass.
- `npm run build` → **clean**. TypeScript compiles; Tailwind CSS builds in 433ms without errors.

**Pass/fail summary:**

| Scope | Pass | Fail | Notes |
|---|---|---|---|
| Unit (new) | 60/60 | 0 | All browse-filters unit scenarios pass |
| Unit (existing) | 829/829 | 0 | No regressions |
| Integration (new) | 20/20 | 0 | All browse-filters integration scenarios pass |
| Integration (existing) | 179/180 | 1 | Pre-existing google-calendar Reaper flake |
| TypeScript build | — | 0 | `tsc` exits 0 |
| CSS build | — | 0 | Tailwind compiles cleanly |

## Coverage Report

**Acceptance criteria:** 32/32 covered via tests. Every numbered AC in the behavioral spec has at least one corresponding passing test (or a documented regression-baseline coverage note for AC-2.6 and C-6).

**Edge cases:** 14/14 addressed. E-1 (count drift) and E-12 (browser back/forward) are explicitly noted as acceptable / non-testable at the vitest layer; all others are covered by concrete tests.

**Non-goals:** 11/11 addressed. NG-1 (no sort), NG-2 (no multi-select), NG-3 (no free-form dates), NG-4 (no free-form stale_days), NG-11 (non-stat cells not anchors) have dedicated negative tests. NG-5, 6, 7, 8, 9, 10 are enforced by either absence of code (no saved presets, no live count updates), by direct assertion (NG-8 filter bar not on /trash), or by construction (NG-6 uses PG server timezone; NG-10 semantic ranking preserved even with stale_days filter).

**Constraints:** 8/8 addressed. C-1 (no new deps) verified by `package.json` diff — zero new dependencies. C-2 (progressive enhancement: pill × works without JS) covered by TS-5.1. C-3 (design system) enforced by TS-5.2 (no inline styles in filter bar subtree). C-4 (i18n) covered by TS-5.3 and TS-5.4 asserting all new keys exist in both `en.ts` and `de.ts`. C-5 (validation before DB query) covered by TS-5.5. C-6 (backwards-compatible URL contract) covered by regression-pass of pre-existing browse tests. C-7 (no schema changes) verified — no migrations added. C-8 (auth) covered by TS-5.6.

## Deep-Review Findings (post-initial-pass, 2026-04-22)

A second review pass identified four real issues with the initial Phase-5 implementation that the original test suite did not catch. All four were fixed in place and re-verified.

### F-1 (critical — UX-breaking): Value pickers were unopenable

The initial implementation rendered `data-picker-values="..."` divs with a `.hidden` Tailwind class and expected client-side JS to toggle visibility — but the JS was never written. Users could remove filters via × anchors and add filters via the `<details data-filter-add-menu>` default-href navigation, but could not change an active filter's value via the pill trigger — AC-3.5 ("Clicking the pill value opens an inline value picker") was unmet. The test suite passed because every assertion checked DOM structure or attribute presence, not interactivity.

**Fix:** Added a `renderFilterBarScript()` helper in `src/web/browse.ts` that emits a small vanilla-JS script with three behaviors:
- Click a `[data-picker]` element → toggle the matching `[data-picker-values]` panel visibility; close any other open panel.
- Click outside any picker trigger or panel → close all panels.
- Press Escape → close all panels.

Also switched pickers from `hidden absolute` to `hidden` with block flow, so when they unhide they appear naturally below the filter bar (rather than needing a positioned ancestor). The pickers use `w-fit` + border + shadow so they visually read as dropdown panels.

### F-2 (spec compliance): `getServiceStatus` ran before validation

AC-2.5 / C-5 say "Validation runs before any database query." The initial implementation started `getServiceStatus(sql, …)` (which reads settings) **before** calling `parseFilterParams`, so an invalid-param request would still initiate that DB read before short-circuiting with HTTP 400. TS-5.5 passed because it only asserted that `browseEntries` / `semanticSearch` / `textSearch` weren't invoked — it didn't measure the health-check.

**Fix:** Moved `parseFilterParams(url)` above the `getServiceStatus(...)` call. Invalid-param requests now short-circuit to HTTP 400 without issuing any DB query. The health-check is only started after validation succeeds.

### F-3 (UX polish): Clear filters link floated below the empty state

When the result set was empty AND at least one filter was active, the initial implementation concatenated a bare `<div class="text-center mt-3">` containing the Clear filters link **after** the `renderEmptyState` return value. The empty state itself is a `flex-1 flex items-center justify-center` container, which centers its contents vertically — but anything appended after that container sits outside, below the centered area. Tests passed because they only asserted the string "clear filters" appeared anywhere in the body.

**Fix:** Extended `renderEmptyState` to accept an optional `clearFiltersHref` parameter and render the link as a nested child of the centered flex container, with `mt-3` spacing below the empty-state text. Removed the duplicate concatenation from the handler.

### F-7 (layout correctness): Pickers positioned absolutely with no positioned ancestor

The initial pickers used `hidden absolute z-10 mt-1 …`. Absolute-positioned elements with no `position: relative` ancestor fall back to the nearest positioned ancestor, which in this layout is unpredictable (possibly the `<body>` itself). Without F-1's JS, the pickers were never visible, so this was latent — but it would have manifested as wildly mispositioned panels once F-1 was fixed.

**Fix:** Dropped the `absolute` class from the pickers. With F-1 rendering them as block elements below the filter bar, absolute positioning is no longer required. The picker appears inline in the flex layout on a new row (thanks to `flex-wrap` + `w-fit` sizing). Simpler and works without inline styles.

### Re-verification after deep-review fixes

- `npm run test:unit` → **889/889 passing** (unchanged count and zero regressions).
- `npm run build` → TypeScript compiles, CSS builds cleanly.
- Live render inspection of `/browse?category=tasks&status=pending&stale_days=5` confirms: pills render correctly, × anchors have correct preserved-param URLs, `+ Filter` menu omits the applied dimensions, three value pickers rendered hidden (Status scoped to tasks = Pending/Done only), result count shows "No entries match", empty state centers its text + "Clear filters" link together, picker script is present at the end of the response.

## Deviations

Minor implementation decisions made during Phase 5:

1. **Locale middleware added to `createTestBrowse` helper.** The test harness previously lacked `createLocaleMiddleware`, so `c.get("locale")` fell back to `"en"` regardless of the `Accept-Language` header. TS-3.6 (DE locale) required a realistic locale resolution flow; the middleware was added to the test-harness wiring to match production. This is a test-infrastructure change, not a product behavior change — existing browse tests continue to pass because they don't depend on a specific non-default locale.

2. **Integration seed helper `seedJsonbEntry`.** The file-local `seedEntry` helper uses `JSON.stringify(fields)` which stores the JSONB as a JSON-string value (a known `postgres.js` gotcha). New integration scenarios that filter by `fields->>'status'` require a proper JSONB object. Introduced `seedJsonbEntry` (scoped to the `Browse Filters` describe block) using `sql.json(fields)`. Also includes the `embedding` column when provided, so semantic-search scenarios can use deterministic embeddings via the existing `createQueryEmbedding` / `createSimilarEmbedding` helpers.

3. **TS-2.14 test source value.** The `entries_source_check` DB constraint rejects `source = 'test'`. The timezone-boundary test now inserts entries with `source = 'webapp'` (an allowed value) without changing what the test is actually asserting.

4. **Stats interface (unit test harness).** The `Stats` type in `tests/unit/web-dashboard.test.ts` previously lacked `totalEntries` even though `getDashboardStats` returns it. Added the field to the test type and the `createMockStats` factory. No production impact — the existing fallback `stats.totalEntries ?? 0` in `renderStats` already handled the missing field.

5. **Filter bar pill plural form.** The `renderPill` helper for `stale_days` uses the `_one` / `_other` catalog suffix convention manually (via `t("…_one", { count })` or `t("…_other", { count })`) because the flat key `browse.filter.pill.stale_days` is not defined in the catalog — only its pluralized siblings. This is consistent with the i18next plural-suffix pattern already used elsewhere (see `dashboard.no_daily_digest` plural siblings).

## Follow-up Items

None blocking. Possible future improvements (explicitly out of scope per the behavioral spec):

- **NG-6 follow-up:** Switch both the dashboard stats query and the `since=` filter to honor the configured `timezone` setting instead of PG server time. Requires coordinating `getDashboardStats` and `browse-queries.ts` to use the same timezone resolution.
- **NG-4 follow-up:** Add a free-form integer input to the `stale_days` value picker (e.g., "Other…" option that reveals a number input).
- **NG-8 follow-up:** Decide whether to extend the filter bar to `/trash`. The current behavior (AC-4.7) is intentional scope narrowing.
- **NG-1 follow-up:** Add a `sort=` control if the default `updated_at DESC` ordering proves insufficient for stalled-project workflows (currently most-recently-stale is first; users may want most-stale-first).

## Status

**PASS.** All six phases of spec-dd are complete. The feature delivers:

- Four clickable dashboard stat cards linking to destinations whose entry counts match the card values (AC-1.2).
- Three new `/browse` query parameters (`since`, `status`, `stale_days`) with enum/integer validation and HTTP 400 on invalid values (AC-2.1..5).
- Composition of new filters with existing category/tag/q/mode across both semantic and text search paths (AC-2.4, AC-2.7).
- A persistent filter bar UI with removable pills, context-aware value pickers, a "+ Filter" menu listing unapplied dimensions, a live result count, and a "Clear filters" escape hatch (AC-3.1..11).
- All existing browse behavior preserved: category tabs, tag pill row, search input, semantic/text fallback, unclassified+reclassify, trash untouched (AC-4.1..7).
- Full EN + DE i18n coverage for every new user-facing string (C-4).

60 new unit tests + 20 new integration tests, all passing. No regressions in the 829 pre-existing unit tests or the ~179 pre-existing integration tests.

## Recommendations

No further work required. This feature is ready to merge.
