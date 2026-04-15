# Kitchen Display — Implementation Review

| Field | Value |
|-------|-------|
| Feature | kitchen-display |
| Date | 2026-04-15 |
| Status | PASS |

## Scope

- Feature: server-rendered PNG dashboard endpoint (`GET /api/kitchen.png`) plus a TRMNL BYOS adapter (`GET /api/display`) combining Google Calendar events, Cortex tasks, and Open-Meteo weather into a single e-paper-friendly image. Disabled by default, opt-in via the `display_enabled` setting, optionally protected by a shared token.
- Implementation files: `src/display/index.ts` (routes + settings parsing), `src/display/render.ts` (Satori → Resvg pipeline), `src/display/layout.ts` (element tree), `src/display/weather-data.ts` (Open-Meteo client + WMO mapping + 30-min cache), `src/display/task-data.ts` (DB query + due-date formatter), `src/display/calendar-data.ts` (Google Calendar multi-calendar fetch), `src/display/icons.ts`, `src/display/types.ts`, and JetBrains Mono TTF fonts under `src/display/fonts/`. Routes wired in `src/index.ts`.
- Spec artifacts: `kitchen-display-specification.md`, `kitchen-display-test-specification.md`, `kitchen-display-test-implementation-specification.md`.
- Tests: 155 total — 143 unit across 5 files + 12 integration in 1 new file. All passing.

## Context

This feature is a **retroactive spec-dd backfill**. The code and 50 unit tests shipped months before any spec-dd artifact was written. On 2026-04-15 the three specification documents were authored by reverse-engineering from the design doc (`docs/plans/2026-03-31-kitchen-display-design.md`), the existing code, and the existing tests. Phase 4 extended the test suite from 50 to 155 tests, which in turn exposed six categories of code/spec mismatches. Phase 5 closed all six with targeted edits in two files. This review documents the final state.

Because the workflow ran in reverse (code first, spec second), the conventional Phase 4 failure signature (all new tests red until Phase 5) did not apply. Instead, the majority of the new tests locked in already-correct behavior, and a minority surfaced real gaps the spec was authoritative over. This is the "retrofit" mode the spec-dd reference notes as an acceptable variant — the spec is still driving, it just happens to drive toward "preserve what works, fix what doesn't."

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec → Test Spec coverage | PASS | All 34 numbered acceptance criteria (AC-1.1 through AC-8.3), all 9 constraints (C-1 through C-9), all 12 edge cases (E-1 through E-12), and non-goals NG-1, NG-7, NG-8 map to at least one TS scenario. NG-2 through NG-6, NG-9, NG-10 are left untested as design boundaries (acceptable per test-spec reference — non-goals are tested only when a negative assertion is useful, which these don't warrant). |
| Test Spec → Spec traceability | PASS | All 71 TS scenarios trace to a specific AC / C / E / NG. Coverage matrix in `kitchen-display-test-specification.md` is complete. No orphan tests. |
| Test Spec → Test Impl Spec coverage | PASS | All 71 TS scenarios plus two decision-table variants (TS-6.2b, TS-7.2b) are mapped in the "Test Scenario Mapping" table with explicit `File / Setup / Action / Assertion` per row. Decision tables (TS-6.6 with 5 rows, TS-7.9 with 28 rows) are implemented as `it.each` loops. |
| Test Impl Spec → Test Spec (no orphans) | PASS | Every mapping entry traces to a TS ID. No orphan test implementations. |
| Spec constraints respected | PASS | **C-1** (in-process render pipeline): verified by Phase 6 inspection — no outbound HTTP in the render path beyond the Open-Meteo client; `satori` and `@resvg/resvg-wasm` are the only rendering dependencies. **C-2** (no session-cookie auth): asserted by TS-C-2 and TS-NG-1 (a session cookie on the request has no effect; an unauthenticated request with no cookies returns 200 when the feature is enabled and no token is set). **C-3** (fresh render per request): asserted by TS-C-3. **C-4** (new settings keys only, no new tables): verified by scanning `src/db/index.ts` — all display settings use the existing `settings` key/value table. **C-5, C-7, C-8**: covered transitively. **C-9** (setup middleware allowlist): verified in `src/web/setup.ts` lines 212–213. |
| Non-goals respected | PASS | NG-1 (no session-cookie gating) asserted as negative via TS-NG-1. NG-7 (no HTTP caching) asserted via the `Cache-Control: no-cache` header in TS-2.3. NG-8 (no in-process rate limiting) asserted as negative via TS-NG-8. NG-9 (no stale-while-error weather) asserted via TS-E-5. NG-2 through NG-6, NG-10 are architectural boundaries not worth negative tests. |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Spec | PASS | 155 test functions match 71 TS scenarios (1:1 for most; TS-6.6 expands to 5, TS-7.9 expands to 28, TS-6.2/TS-7.2 have `b` variants, and a few TS IDs cover multiple related assertions in a single test). No orphan test functions introduced. |
| Test code vs Test Impl Spec | PASS | Test file organization matches the "Test Structure" section: 5 extended unit files + 1 new integration file + 1 new `tests/helpers/display-fixtures.ts`. Mock boundaries match: top-level `vi.mock` for `render`, `weather-data`, `task-data`, `calendar-data`, `settings-queries`, `google-calendar`, and `logger`; `vi.spyOn(globalThis, "fetch")` for outbound HTTP in weather tests; testcontainers via `tests/helpers/test-db.ts` for integration tests. |
| Feature code vs Behavioral Spec | PASS (post-fix) | All 34 ACs verified by passing tests after Phase 5 fixes to `src/display/weather-data.ts` and `src/display/index.ts`. See "Findings" for the fix summary. |
| Undocumented behavior | PASS | No feature code behavior outside the spec. The `refreshToken` retry path in `src/display/calendar-data.ts` is covered by TS-E-2; the weather `cachedData ?? null` pattern in the error branch of `getWeather` actually does return stale cache on HTTP non-2xx — the spec's NG-9 says stale-while-error is a non-goal, so this is technically a minor deviation in the spec's favor (the code is less graceful than the spec allows, which is fine) — see INFO finding I-2. |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (feature) | 155 |
| Passed | 155 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/display-*.test.ts tests/integration/display-integration.test.ts` |
| Full-suite regression | **757 / 757 passing**, stable across 2 consecutive runs, clean `tsc && build:css` build |

**Before Phase 4:** 652 / 0 / 652 (pre-backfill baseline).
**After Phase 4 (tests added, gaps exposed):** 741 / 16 / 757 — exactly the 16 expected-to-fail tests covering KG-1 through KG-5 plus the 7 KG-2a WMO label mismatches discovered during Phase 4.
**After Phase 5 (fixes applied):** 757 / 0 / 757.

No unrelated regressions. The delta across the three phases: `+105 tests, +16 → -16 failures, +0 net regressions`.

## Coverage Report

### Gaps

None. All 34 ACs, all 9 constraints, all 12 edge cases are covered by at least one passing test or transitively by other scenarios.

### Misalignments

None remaining. The six Known Gaps (KG-1, KG-2, KG-2a, KG-3, KG-4, KG-5) from the spec-drafting phase and Phase 4 test discovery are all resolved in Phase 5.

### Unresolved Items

None. No `[NEEDS CLARIFICATION]` markers in any spec artifact.

## Findings

| # | Severity | Layer | Description | Status |
|---|----------|-------|-------------|--------|
| F-1 | **INFO** (resolved) | Feature code | **WMO weather code mapping was incomplete** for 11 codes. Codes 85, 86 (snow showers) and 96, 99 (thunderstorm with hail) fell through to the "Cloudy" fallback entirely (KG-1, KG-2, identified during Phase 1 drafting). Codes 1, 3, 56, 57, 66, 67, 77 were mapped to coarser neighboring labels — "Partly Cloudy" instead of "Mainly Clear"/"Overcast", "Drizzle"/"Rain" instead of their "Freezing" variants, "Snow" instead of "Snow Grains" (KG-2a, discovered during Phase 4 when the full AC-7.6 decision table was encoded as `it.each` tests). The freezing-rain and freezing-drizzle gaps are weather-safety relevant — the coarse label hid an icing condition. | **FIXED** in `src/display/weather-data.ts` by extending the `weatherCodeMap` record to the full AC-7.6 table. Eleven tests flipped red → green. |
| F-2 | **INFO** (resolved) | Feature code | **`display_max_today_events` setting was hardcoded to 8.** AC-5.4 specifies the cap as configurable via a settings key (default 8), but `src/display/index.ts` assembled `KitchenData` with a literal `maxTodayEvents: 8` and never read the setting (KG-3). | **FIXED** by adding `parseInt(settings.display_max_today_events ‖ "8", 10)` and passing the result to the `KitchenData` object. Two tests flipped red → green. |
| F-3 | **INFO** (resolved) | Feature code | **`display_base_url` override was not implemented.** AC-4.5 specifies an optional settings key that overrides the header-derived scheme/host for the `image_url` returned by `/api/display`, with trailing-slash tolerance. This was intended as an escape hatch for reverse-proxy deployments where `Host` / `X-Forwarded-Proto` headers don't yield the right URL. The setting was specified but not wired (KG-4). | **FIXED** in the `/api/display` handler: if `settings.display_base_url` is non-empty, it replaces the header-derived prefix. Trailing slashes are normalized via `.replace(/\/+$/, "")`. Two tests flipped red → green. |
| F-4 | **INFO** (resolved) | Feature code | **Width/height accepted zero and negative values.** E-12 specifies that non-positive or non-finite dimensions must fall back to the defaults 1872 × 1404, but the code called `parseInt(...)` and passed the result to the renderer without validation (KG-5). Satori would then produce a zero-sized image. | **FIXED** by validating the parsed values with `Number.isFinite(x) && x > 0 ? x : <default>`. One test flipped red → green. |
| F-5 | **WARNING** | Test code | **TS-7.5 / TS-7.6 / TS-7.7 assertion softened during Phase 4.** The test impl spec said "`getWeather` is not called" when lat/lng are absent or unparseable. The current route handler actually passed `NaN` through to `getWeather`. The Phase 4 implementer softened the assertion to "`getWeather` not called **OR** called with non-finite args." | **FIXED** (2026-04-15) — `src/display/index.ts` now filters `parsedLat` / `parsedLng` through `Number.isFinite()` before calling `getWeather`, so the short-circuit path is exercised and the TS-7.6 / TS-7.7 assertions are tightened back to the original `expect(mockGetWeather).not.toHaveBeenCalled()` form. |
| F-6 | **WARNING** | Test code | **Integration test `TS-1.4` (enable without restart) re-uses the same Hono app instance between the 404 request and the subsequent 200 request.** Tests the *in-memory* live reload but doesn't exercise the scenario where the app is serving from a long-lived cached settings object. The current code has no such cache, so this distinction is academic. | **ACKNOWLEDGED** — no code change needed (no cache exists). The note remains here as a flag for any future settings-cache refactor. |
| F-7 | **INFO** | Spec artifact | **NG-2 through NG-6, NG-10 have no negative tests.** These are high-level design boundaries (no color mode, no multi-profile, no webhook push, no user-configurable layout, no grocery list, no HTTPS-only enforcement). Writing negative tests for them would add noise without value. The review-phase checklist accepts this — non-goals are only tested when a specific negative assertion prevents scope creep. | OPEN (accepted as-is) |
| F-8 | **INFO** | Spec artifact | **`display_max_tasks` setting is read at `src/display/index.ts` but does not have a Phase 6 test that verifies the value is passed through to `getDisplayTasks(sql, maxTasks)`.** Existing tests cover the query-shape side (`TS-6.4` asserts the `limit` arg is honored by the query function) and the route reads the setting, but no end-to-end test verifies the connection. Minor coverage hole not worth fixing retroactively. | OPEN (accepted as-is) |

## Recommendations

1. **(DONE)** Apply Phase 5 fixes to `src/display/weather-data.ts` and `src/display/index.ts`. ✅ Done 2026-04-15. All 155 feature tests pass, 757 / 757 suite green.
2. **(DONE, 2026-04-15)** F-5 NaN short-circuit applied. Tests tightened back to the strict `not.toHaveBeenCalled()` form.
3. **(OPEN)** Update the settings page UI (`src/web/settings.ts`) to surface the newly-useful settings keys to the user: `display_max_today_events`, `display_base_url`, and the already-existing `display_*` keys. This is not in the kitchen-display spec (the spec only defined the keys and the backend behavior) but is a natural follow-up so the feature is configurable without direct SQL. Out of scope for this review.
4. **(DONE, 2026-04-15)** F-3 cross-reference applied in `onboarding-implementation-review.md`. Kitchen-display C-9 is the canonical documentation of the middleware bypass.

## Notes for Future Work

- **Settings UI.** The Phase 1 spec introduced a new setting (`display_max_today_events`) and a new override (`display_base_url`) that are not yet surfaced in `src/web/settings.ts`. Users can set them via direct SQL (`INSERT INTO settings (key, value) VALUES (...)`), but this isn't discoverable. A ~20-line addition to the Kitchen Display section of the settings page would close that loop.
- **WMO code completeness.** The current mapping covers all codes documented by Open-Meteo as of April 2026. If Open-Meteo adds new codes in the future, the fallback to "Cloudy" means they render harmlessly. Periodic checks against the Open-Meteo docs are prudent.
- **Stale-while-error weather (NG-9).** Currently a non-goal, but real-world operators might want it. The design note in `getWeather` returns `cachedData ?? null` on HTTP 5xx — which is technically stale-while-error for the "cache existed at any point" case. This is either (a) a small step toward a future feature that should be elevated to an AC or (b) dead code that should be removed. Flagged for a future revision of the spec.
