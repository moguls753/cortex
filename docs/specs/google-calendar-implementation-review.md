# Google Calendar Integration — Implementation Review

| Field | Value |
|-------|-------|
| Feature | google-calendar |
| Date | 2026-03-28 |
| Status | PASS (2 WARNINGs, 1 INFO) |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec -> Test Spec coverage | PASS | All 27 ACs, 8 ECs, and 3 testable constraints mapped to test scenarios |
| Test Spec -> Spec traceability | PASS | All 47 scenarios trace to spec requirements. No orphan tests |
| Test Spec -> Test Impl Spec coverage | PASS | All 47 scenarios mapped to test functions with setup/action/assertion |
| Test Impl Spec -> Test Spec (no orphans) | PASS | No orphan test implementations |
| Spec constraints respected | PASS | All 6 constraints verified (C-1 through C-6) |
| Non-goals respected | PASS | No read from calendar, no recurring events, no multi-calendar, no attendees, no re-create on restore, no browser OAuth redirect |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Impl Spec | PASS | 38 unit + 9 integration tests match the test impl spec mapping |
| Feature code vs Behavioral Spec | PASS | 45/48 requirements PASS, 3 PARTIAL (see Findings) |
| Undocumented behavior | PASS | No untested code paths in google-calendar.ts |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests | 47 |
| Passed | 47 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/google-calendar.test.ts tests/integration/google-calendar-integration.test.ts` |

### Regression Check

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| Unit (all) | 318 pass / 20 fail | 356 pass / 20 fail | +38 pass, 0 regressions |
| Integration (all) | 109 pass / 13 fail | 118 pass / 13 fail | +9 pass, 0 regressions |

Pre-existing failures (20 unit, 13 integration) unchanged — all in config, digests, and dashboard tests unrelated to this feature.

## Coverage Report

### Gaps
- None — all spec requirements have both test coverage and implementation

### Misalignments
- None between specification documents

### Unresolved Items
- None — no `[NEEDS CLARIFICATION]` markers in specification

## Findings

| # | Severity | Layer | Description |
|---|----------|-------|-------------|
| 1 | WARNING | Feature code | AC-4.4: Calendar failure notification not surfaced to user. `processCalendarEvent` returns `{ error: "..." }` but Telegram/web/MCP handlers don't render failure messages. Errors are logged server-side. |
| 2 | WARNING | Feature code | EC-7: Entry edit route (`POST /entry/:id/edit`) doesn't call `processCalendarEvent` to update linked calendar events when date/time fields change. The function supports updates, but the wiring is missing. |
| 3 | INFO | Feature code | Dashboard JSON API `POST /api/capture` doesn't process calendar events. Only the form-based `POST /` does. This is acceptable for current usage (the dashboard UI uses the form endpoint), but the API endpoint should be updated if JavaScript-based capture is added. |

## Recommendations

- **W-1 (AC-4.4):** Add calendar failure message to handler responses. In `src/telegram.ts`, after the calendar call, if `calendarResult?.error`, add `await reply("⚠️ Entry saved but calendar event creation failed")`. Similar for dashboard and MCP. Low effort, improves UX.
- **W-2 (EC-7):** Wire `processCalendarEvent` into the entry edit handler. After `updateEntry` in `src/web/entry.ts`, check if the entry has a `google_calendar_event_id` and call `processCalendarEvent` with the updated fields. Requires reading the updated entry's fields to extract date/time.
- **I-3 (API):** If the dashboard adds JavaScript-based capture in the future, update `POST /api/capture` to call `processCalendarEvent` and include calendar info in the JSON response. Not needed now.

## Implementation Summary

| File | Changes |
|------|---------|
| `src/google-calendar.ts` | New file — 410 lines. Core calendar client: config resolution, event CRUD, OAuth exchange/refresh, retry logic, orchestrators |
| `src/classify.ts` | Added `calendar_time` field to validation + return type |
| `prompts/classify.md` | Updated to 8-field output with `calendar_time` + examples |
| `src/db/index.ts` | Migration: `ALTER TABLE entries ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT` |
| `src/web/settings.ts` | Google Calendar section (Calendar ID, duration, connect/disconnect, status validation), duration validation, connect/disconnect routes |
| `src/telegram.ts` | `processCalendarEvent` call in handleTextMessage + handleVoiceMessage, calendar confirmation reply |
| `src/web/dashboard.ts` | New `POST /` form handler with calendar support |
| `src/mcp-tools.ts` | `processCalendarEvent` call in handleAddThought, calendar confirmation in result, calendar cleanup in handleDeleteEntry |
| `src/web/entry.ts` | `handleEntryCalendarCleanup` call before soft-delete |
| `tests/helpers/mock-llm.ts` | Added `calendar_time` to ClassificationResult interface |
| `tests/unit/google-calendar.test.ts` | 38 unit tests |
| `tests/integration/google-calendar-integration.test.ts` | 9 integration tests |
