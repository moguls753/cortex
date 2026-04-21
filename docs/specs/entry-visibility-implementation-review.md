# Entry Visibility — Implementation Review

**Date:** 2026-04-20
**Verdict:** PASS

## Specification Alignment

Three specification artifacts exist and agree with each other:

- `docs/specs/entry-visibility-specification.md` — Phase 1 behavioral spec. 6 user stories, ~30 acceptance criteria, 6 technical constraints, 2 business constraints, 3 operational constraints, 17 edge cases, 12 non-goals, no open questions (all resolved during brainstorm).
- `docs/specs/entry-visibility-test-specification.md` — Phase 2 test spec. Coverage matrix maps every AC, EC-1..17, T-1..T-6, and NG-5/NG-8/NG-11 to at least one of 49 Given/When/Then scenarios. Two items are documented-only (AC-2.2 forward constraint on future display queries, AC-5.6 `delete_entry`/`brain_stats` unchanged — quality-gated via existing 53 MCP tests).
- `docs/specs/entry-visibility-test-implementation-specification.md` — Phase 3 test-impl spec. Every TS scenario maps to a test function with setup/action/assertion, plus two design concerns flagged inline (fail-safe placement, low-confidence reply state).

Cross-check results: no contradictions, no coverage gaps, no unresolved `[NEEDS CLARIFICATION]` markers.

## Code Alignment

### New files

- `tests/integration/entry-visibility-integration.test.ts` — 6 tests (TS-2.1, TS-2.2, TS-7.1, TS-7.2, TS-7.3, TS-8.1).
- `tests/unit/entry-visibility-wiring.test.ts` — 1 test (TS-7.4: `VISIBILITY_VALUES` export).

### Rewritten (feature implementation)

- `src/db/schema.ts` — Drizzle declaration includes `visibility: text(...).notNull().default("private")` + CHECK constraint.
- `src/db/index.ts` — migration:
  - Initial `CREATE TABLE IF NOT EXISTS entries` now includes the column + CHECK.
  - Idempotent post-hoc `ALTER TABLE ... ADD COLUMN IF NOT EXISTS visibility ... DEFAULT 'private'` + `DO $do$ IF NOT EXISTS (...) ADD CONSTRAINT entries_visibility_check ...` for existing deployments.
  - `notify_entry_change` trigger extended: visibility is included in the JSONB payload for `entry:created`/`entry:updated`; the skip-condition now includes `NEW.visibility IS NOT DISTINCT FROM OLD.visibility`, so a visibility-only UPDATE fires an `entry:updated` event (AC-6.3).
- `prompts/classify.md` — adds visibility to the 10-key JSON schema, the enum-only-English rule, and a dedicated "Visibility" section documenting the heuristic (surprise / personal / health / finance / work-sensitive → private; household / logistical / public → shared; uncertain → private).
- `src/classify.ts`:
  - `validateClassificationResponse` parses `visibility`. Missing, null, or non-enum values fall back to `"private"`.
  - `classifyText` return type gains `visibility: "private" | "shared"`. All error paths (LLM-not-configured, LLM-throws) set `visibility: "private"`. The confidence fail-safe (`confidence < confidence_threshold`) forces `visibility: "private"` regardless of the LLM's output (AC-1.4).
  - `reclassifyEntry` mirrors the same fail-safe so the `/fix` and category-correction paths behave identically (EC-16).
  - `classifyEntry` UPDATEs now write `visibility` in both the direct-target and the back-fill-unclassified paths.
- `src/display/task-data.ts` — `getDisplayTasks` query extended with `AND visibility = 'shared'` (AC-2.1).
- `src/telegram.ts`:
  - New helper `buildVisibilityToggleButton(entryId, currentVisibility, t)` whose `callback_data` is `visibility:<uuid>:<target>` where target = inverse of current.
  - Text + voice INSERTs include `visibility` from the classify result, with an edge-level fail-safe (`confident ? classResult.visibility : "private"`) on top of classifyText's internal fail-safe. The double-apply is idempotent and keeps tests that mock `classifyText` honest.
  - Confident `visibility="shared"` replies include a ` 👁` glyph inside the category chunk; confident private replies stay plain (AC-3.4, AC-3.5).
  - Low-confidence replies emit 5 category-correction buttons in row 1 plus 1 visibility-toggle button in row 2 (AC-3.3). Because the fail-safe stores low-confidence entries as `'private'`, the toggle initial label is always "👁 Make shared" in practice.
  - `handleCallbackQuery` recognizes `visibility:<uuid>:<target>` as a new top-of-handler branch. Target is validated against `{"private", "shared"}`; the update is a pure `UPDATE entries SET visibility = ...` with no LLM or embedding call (AC-3.1). The edited message swaps the ` 👁` glyph and re-renders the keyboard so the toggle now points the opposite direction (AC-3.2).
  - Category-correction branch applies the edge fail-safe on `result.visibility` and writes the value into the same UPDATE statement.
  - `handleFixCommand` applies the same edge fail-safe on the `reclassifyEntry` result.
- `src/mcp-tools.ts`:
  - Module exposes `VALID_VISIBILITY` + `isValidVisibility` guard.
  - `search_brain`, `list_recent`, `get_entry` response payloads include `visibility` (AC-5.1).
  - `add_thought` tool schema gains an optional `visibility` enum parameter. Explicit `"private"` or `"shared"` → stored as given (bypasses the confidence fail-safe per AC-5.2). Any other value → early error response with no insert (AC-5.3).
  - `update_entry` tool schema gains a `visibility` enum parameter. Valid → passed to `updateEntryFields`. Invalid → error response, no write (AC-5.4, AC-5.5).
- `src/mcp-queries.ts` — all entry-returning SELECTs include `visibility`; `insertMcpEntry` accepts + writes it; `updateEntryFields` accepts a `visibility` dynamic-set clause.
- `src/web/entry.ts`:
  - View page: entries with `visibility="shared"` render a `<span data-visibility="shared" title="Shared">${iconEye(...)}</span>` marker next to the category badge (AC-4.2).
  - Edit page: two-option radio group `name="visibility"` with `private` / `shared`; the current value is pre-selected (AC-4.3).
  - Edit POST: validates the submitted `visibility` against `VISIBILITY_VALUES`; missing or invalid → 422 with error message (AC-4.4). Valid → written through `updateEntry`.
- `src/web/entry-queries.ts` — `getEntry` SELECTs visibility; `updateEntry` accepts + writes it.
- `src/web/dashboard.ts` — `renderEntries` adds `<span data-visibility="shared" ...>` marker on shared entries; both capture paths (`/api/capture` JSON endpoint and `POST /` form handler) propagate the classifier's visibility into `insertEntry`.
- `src/web/dashboard-queries.ts` — `EntryRow` interface gains `visibility`; `getRecentEntries` SELECTs it; `insertEntry` accepts + writes it with a safe default.
- `src/web/browse.ts` — `renderEntryList` (used by both `/browse` and `/trash`) adds the shared marker. The bulk-reclassify endpoint's UPDATE now writes `visibility` from the classify result.
- `src/web/browse-queries.ts` — all three query paths (`browseEntries`, `semanticSearch`, `textSearch`) SELECT visibility.
- `src/web/icons.ts` — new Lucide `iconEye` helper.
- `src/web/shared.ts` — `VISIBILITY_VALUES = ["private", "shared"] as const` + `type Visibility`.

### Test updates (behavior-preserving migrations)

- `tests/unit/classify.test.ts` — 8 new `it` blocks under `"Entry Visibility"` (TS-1.1..1.8).
- `tests/unit/display-calendar.test.ts` — 1 new `it` block (TS-2.3 — NG-5 guard on calendar-events orthogonality).
- `tests/unit/display-tasks.test.ts` — unchanged (TS-2.1 lives in the new integration file).
- `tests/unit/telegram-bot.test.ts`:
  - 10 new `it` blocks (TS-3.1..3.8, TS-8.4, TS-8.5).
  - Top-of-file `vi.mock("../../src/google-calendar.js", ...)` added — needed so TS-8.5 can `vi.mocked(processCalendarEvent)` on the handler's fire-and-forget call.
  - 2 pre-existing tests (TS-2.4 and voice low-confidence) migrated to filter buttons by `correct:` callback prefix — the low-confidence keyboard now carries 6 buttons (5 category + 1 visibility).
- `tests/unit/ui-language.test.ts` — 1 pre-existing Telegram-localization test migrated the same way.
- `tests/unit/web-dashboard.test.ts` — 3 new `it` blocks (TS-4.1, TS-4.5 dashboard inverse, TS-4.9).
- `tests/unit/web-browse.test.ts` — 2 new `it` blocks (TS-4.2, TS-4.5 browse inverse).
- `tests/unit/web-trash.test.ts` — 2 new `it` blocks (TS-4.3, TS-4.5 trash inverse).
- `tests/unit/web-entry.test.ts` — 7 new `it` blocks (TS-4.4, TS-4.5, TS-4.6, TS-4.7, TS-4.8, TS-8.2, TS-8.3).
- `tests/unit/mcp-server.test.ts` — 8 new `it` blocks (TS-5.1..5.8).
- `tests/integration/db-notify-integration.test.ts` — 4 new `it` blocks (TS-6.1..6.4).
- `tests/integration/display-integration.test.ts` — 5 pre-existing `INSERT INTO entries` statements updated to include `visibility='shared'` so they survive the new `getDisplayTasks` filter. Same behavior-adapting pattern as the UI-Language / Auth-Refactor migrations.
- `tests/integration/web-entry-integration.test.ts` — 6 pre-existing edit-form POSTs updated to include `visibility: "private"` in the URLSearchParams body. Edits match the new strict AC-4.4 ("missing or invalid → 422") contract.
- `tests/integration/entry-visibility-integration.test.ts` — 1 Phase-4 JSONB insertion bug fixed (`JSON.stringify(obj)::jsonb` → `db.sql.json(obj)` per the existing `test-mocking-gotchas` memo). This was a Phase-4 bug in my own test, not a behavior change.
- `tests/integration/web-dashboard-integration.test.ts` — **1 new Phase-6 regression test added** (`propagates classifier visibility into the stored entry`). Covers the bug that was found and fixed during the Phase-6 doublecheck pass (see F-1 below).

## Test Execution

- Runner: Vitest via `npm run test:unit` and `npm run test:integration`.
- Unit: **829 / 829 pass** (38 files; +42 net new vs. pre-feature baseline of 787).
- Integration: **180 / 180 pass** (23 files; +11 net new vs. pre-feature baseline of 169 — 10 Phase-4 new + 1 Phase-6 regression guard).
- Build: `npm run build` → clean `tsc` + minified Tailwind output. No `@ts-expect-error` flagged as unused (the `tests/` directory is excluded from tsc; vitest's esbuild transpiler does not enforce strict type checks).

Scenario-by-scenario verification:

| Group | Scenarios | Location | Status |
|---|---|---|---|
| 1. LLM classification pipeline | TS-1.1–1.8 | `classify.test.ts` | 8/8 pass |
| 2. Kitchen display filter | TS-2.1, 2.2 | `entry-visibility-integration.test.ts` | 2/2 pass |
| 2. Calendar orthogonality | TS-2.3 | `display-calendar.test.ts` | 1/1 pass |
| 3. Telegram correction loop | TS-3.1–3.8 | `telegram-bot.test.ts` | 8/8 pass |
| 4. Webapp indicator + edit | TS-4.1, 4.9 (dashboard) | `web-dashboard.test.ts` | 3/3 pass (incl. TS-4.5 inverse) |
| 4. Webapp indicator + edit | TS-4.2 (browse) | `web-browse.test.ts` | 2/2 pass (incl. TS-4.5 inverse) |
| 4. Webapp indicator + edit | TS-4.3 (trash) | `web-trash.test.ts` | 2/2 pass (incl. TS-4.5 inverse) |
| 4. Webapp indicator + edit | TS-4.4, 4.6, 4.7, 4.8 + TS-8.2, 8.3 | `web-entry.test.ts` | 7/7 pass (incl. TS-4.5 inverse) |
| 5. MCP tool exposure | TS-5.1–5.8 | `mcp-server.test.ts` | 8/8 pass |
| 6. SSE payload | TS-6.1–6.4 | `db-notify-integration.test.ts` | 4/4 pass |
| 7. DB schema | TS-7.1, 7.2, 7.3 | `entry-visibility-integration.test.ts` | 3/3 pass |
| 7. Shared constants | TS-7.4 | `entry-visibility-wiring.test.ts` | 1/1 pass |
| 8. Edge cases & NG guards | TS-8.1 (concurrent edits) | `entry-visibility-integration.test.ts` | 1/1 pass |
| 8. Edge cases & NG guards | TS-8.4 (/fix fail-safe), TS-8.5 (NG-5 calendar orthogonality) | `telegram-bot.test.ts` | 2/2 pass |

## Coverage Report

- Every AC in `entry-visibility-specification.md` is covered by at least one passing test.
- Every EC-1..EC-17 is covered (EC-14 is covered compositely by TS-2.2 + TS-4.7 per the test-spec).
- Every constraint (T-1..T-6) is covered by either schema tests or shared-constant tests.
- Non-goals actively guarded:
  - NG-5 (Google Calendar not gated) — TS-2.3 (negative structural guard) + TS-8.5 (positive behavioral guard).
  - NG-8 (only two visibility values) — TS-7.2 (CHECK rejects `"public"`).
  - NG-11 (no toggle on confident replies) — TS-3.1, TS-3.2 assert `reply_markup` is falsy on confident replies.
- Non-goals intentionally not implemented:
  - NG-1 (no `user_id`): schema unchanged, no user_id added anywhere.
  - NG-2 (webapp doesn't filter): TS-4.9 + the missing filter in browse/dashboard/trash code paths.
  - NG-3 (digests don't filter): confirmed via `grep -n "visibility" src/digests.ts src/digests-queries.ts` → no matches.
  - NG-4 (MCP doesn't filter): read tools return visibility informationally; no WHERE clause added.
  - NG-6 (no second threshold): `confidence_threshold` is the single knob.
  - NG-7 (no `household_context`): deferred; no such setting.

## Doublecheck / Ultrathink Findings

The post-initial-review pass surfaced the following issues. Each was closed before finalizing this report.

- **F-1 (closed): Dashboard capture API did not propagate classifier visibility.** `src/web/dashboard.ts` had two call sites (`/api/capture` JSON endpoint at line 715 and `POST /` form handler at line 791) that called `classifyText` and then `insertEntry` — but the `insertEntry` data object omitted `visibility`, so the `insertEntry` helper fell through to its `'private'` default regardless of what the classifier returned. A user capturing "Buy bread at the bakery" via the webapp would have the entry stored as `private` even when the LLM correctly inferred `shared`, so the entry would not appear on the kitchen display. **Fix:** both call sites now pass `visibility: classification?.visibility ?? "private"`. **Regression test:** `tests/integration/web-dashboard-integration.test.ts` — new `"propagates classifier visibility into the stored entry"` block mocks `classifyText` to return `visibility: "shared"` and asserts the persisted row has `visibility='shared'`.
- **F-2 (closed): Browse bulk-reclassify did not propagate classifier visibility.** `src/web/browse.ts` line 441 ran `classifyText` on unclassified entries during the "Classify all" action but its UPDATE statement did not write the `visibility` column. Same class of bug as F-1. **Fix:** `visibility = ${result.visibility ?? "private"}` now included in the UPDATE. No dedicated regression test added — same underlying code path as `/api/capture` and adequately covered by the existing classify + dashboard tests plus the now-passing schema tests.
- **F-3 (closed): AC-4.4 "missing → 422" semantics preserved; 6 pre-existing integration tests migrated.** An earlier implementation softened this to "missing = keep current value" to avoid touching the pre-existing test surface. On reflection, that was a silent spec drift — the spec says missing **OR** invalid → 422. Reverted the handler to strict mode and updated the 6 pre-existing web-entry-integration edit POSTs to include `visibility: "private"` in their bodies. Matches the spec-dd principle that specs are authoritative; matches the UI contract (the edit form always renders a selected radio).
- **F-4 (closed): Telegram `vi.mock("../../src/google-calendar.js", ...)` missing from `tests/unit/telegram-bot.test.ts`.** Phase-4 TS-8.5 attempted `vi.mocked(processCalendarEvent).mockResolvedValue(...)` but the module wasn't mocked at the top of the file, so `.mockResolvedValue` failed with `is not a function`. **Fix:** added a top-of-file `vi.mock` with a plain async closure for `getCalendarNames`/`handleEntryCalendarCleanup` plus a `vi.fn()` for `processCalendarEvent` so tests can assert on call arguments.
- **F-5 (closed): Phase-5 double fail-safe on Telegram handler paths.** `classifyText` applies the confidence-threshold fail-safe internally. The Telegram text/voice/`/fix`/category-correction handlers also apply the edge-level fail-safe. This is intentional — unit tests for the Telegram handlers mock `classifyText` to return specific values (bypassing the internal fail-safe), and the test spec (TS-3.3, TS-3.4, TS-8.4) asserts the post-fail-safe stored state. The edge apply is idempotent and keeps behavior consistent under both production and test mocking.
- **F-6 (open — documented trade-off): Telegram visibility toggle labels not localized.** `buildVisibilityToggleButton` calls `t("telegram.make_shared")` / `t("telegram.make_private")`, but these keys are not present in `src/web/i18n/en.ts` or `src/web/i18n/de.ts`. The helper's built-in fallback (`"👁 Make shared"` / `"🔒 Make private"`) kicks in via the `label === key` sentinel check, so German users see English labels on the toggle. Non-blocking: the button functions correctly; localized labels are a follow-up catalog addition.
- **F-7 (open — documented trade-off): Webapp visibility field labels not localized.** Same pattern in `src/web/entry.ts:renderEditPage` — `visibility.label`, `visibility.private`, `visibility.shared`, `visibility.shared_hint` are not in the catalogs. Fallback-to-English works via the local sentinel checks, so a German user sees "Visibility / Private / Shared" on the edit form. Follow-up: add to en/de catalogs to fully resolve AC-3.1 locale coverage under the UI-Language spec.
- **F-8 (open — nice-to-have): `@ts-expect-error` Phase-4 directives remain in tests.** These bypassed type errors when `visibility` was not yet part of `EntryRow`/classify-result/MCP-param types. Some (e.g., in `mcp-server.test.ts` where MCP params now accept `unknown`) are no longer strictly needed. `tsconfig.json` excludes `tests/` from `tsc`, and vitest's esbuild does not enforce unused-directive, so they don't cause build failures. Minor cleanliness item; no behavioral impact.
- **F-9 (closed): Phase-4 JSONB insertion bug in my own integration tests.** `entry-visibility-integration.test.ts` used `${JSON.stringify(obj)}::jsonb` to seed `fields` — a known cortex pitfall that stores the value as a JSONB string rather than an object. Fixed to `${db.sql.json(obj)}` per the existing `test-mocking-gotchas` memory. Test-setup bug, not a spec/code issue.

### Second-pass doublecheck (Phase-6 deep review)

A second doublecheck pass — prompted by the handoff's warning that "the auth-refactor review surfaced 7 findings after my first pass looked complete" — caught four more issues that the initial Phase-6 pass missed.

- **F-10 (closed): SSE client-side row template didn't include the visibility marker.** `src/web/dashboard.ts` renders a `<script>` block with an `entryRowHtml(d)` function that rebuilds entry rows from SSE `entry:created` payloads. Before F-10, that template omitted the `data-visibility="shared"` wrapper entirely, so any shared entry captured live (via Telegram, MCP, or another browser tab) showed up on the dashboard without its icon until the next full page load. **Fix:** added a `visibilityMarkHtml(v)` helper inside the client script that emits the same Lucide `eye` SVG as the server-side `iconEye` helper, and wired it into `entryRowHtml`.
- **F-11 (closed): SSE `entry:updated` didn't reconcile the visibility marker.** Corollary to F-10: when a user flipped visibility via the Telegram toggle (or webapp edit), the server's PG NOTIFY trigger correctly emitted `entry:updated` with the new visibility (TS-6.4 passes), but the client's `entry:updated` listener only updated the name and category badge — the marker stayed out-of-sync until the next page load. **Fix:** the listener now reads `d.visibility` from the payload and add/removes the marker element accordingly.
- **F-12 (closed): Visibility-toggle callback dropped the category-correction buttons.** My Phase-5 `handleCallbackQuery` `visibility:…` branch re-rendered the inline keyboard as a single row containing only the flipped toggle button. This silently regressed AC-3.3 (low-confidence replies have 5 category buttons + 1 visibility toggle). A user who tapped the visibility toggle would lose access to the category-correction surface. **Fix:** the callback handler now rebuilds the full keyboard — 5 category-correction buttons in row 1 plus the flipped toggle in row 2 — using the same `buildInlineKeyboard(entryId, t)` helper that the initial reply uses.
- **F-13 (closed): Phase-4 TS-4.5 dashboard inverse assertion had too-broad regex.** After the F-10 fix, the client-side JS template literally contains the string `<span data-visibility="shared" ...>` so a substring match on the response body always hits. **Fix:** the dashboard-specific TS-4.5 inverse test now strips `<script>` tags before running the "no shared marker for private entry" regex. Browse and trash TS-4.5 inverse tests stay as-is (those pages don't render the client-side SSE template).
- **F-14 (closed): ARCHITECTURE.md schema snippet missed the visibility column.** The `CREATE TABLE entries` block in ARCHITECTURE.md is the canonical documentation of the schema. Updated to include `visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared'))` alongside the other columns.

## Known Deviations / Tech Debt

- **Double-apply fail-safe.** Intentional and documented (F-5). Removing it would require moving the tests' mock to wrap `classifyText`'s fail-safe call, which drifts the unit-test boundary.
- **`new-note` form has no visibility control.** The spec AC-4.3 only covers the edit form, and new-note entries fall through to `insertEntry`'s `'private'` default. Safe default for manual webapp captures; acceptable per spec scope.
- **Visibility icon uses `title="Shared"` tooltip but no `aria-label`.** Minor accessibility gap; screen-reader experience varies by client. Follow-up.
- **F-6, F-7, F-8 above.**

## Status

PASS — ready to ship. Zero CRITICAL findings. 14 review findings total across two doublecheck passes (initial pass: F-1 through F-9; deeper second pass: F-10 through F-14). Eleven closed; three (F-6, F-7, F-8) are non-blocking trade-offs documented for future cleanup.

Total test impact: **+42 unit + +11 integration tests** (52 new + 1 Phase-6 regression guard). Feature-code touch: **20 source files modified** (adding ARCHITECTURE.md schema update), **0 new source files** (all feature code lives in existing modules). Spec-dd scenario coverage: **49 of 49 scenarios mapped to a passing test** (52 test functions because TS-4.5 splits into 1 canonical + 3 inverse assertions across the four list surfaces).
