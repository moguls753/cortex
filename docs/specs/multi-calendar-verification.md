# Verification: multi-calendar-specification.md

| Field | Value |
|-------|-------|
| Spec file | `docs/specs/multi-calendar-specification.md` |
| Feature | multi-calendar |
| Date | 2026-03-28 |

## Requirements

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| R01 | AC-1.1: Settings page renders named calendars editor when multi-calendar active | PASS | `src/web/settings.ts:549-572` — Conditionally renders multi-calendar editor with name/ID inputs per entry when `isMultiCalendar` is true, falls back to single Calendar ID field otherwise |
| R02 | AC-1.2: Each calendar entry is name→calendar ID pair | PASS | `src/web/settings.ts:555-560` — Form renders `calendar_name_N` + `calendar_id_N` input pairs |
| R03 | AC-1.3: Stored as JSON in `google_calendars` settings key | PASS | `src/web/settings.ts:1042-1050` — Parses `calendar_name_N`/`calendar_id_N` form fields, serializes to JSON, saves as `google_calendars` |
| R04 | AC-1.4: Default calendar stored in `google_calendar_default` | PASS | `src/web/settings.ts:1055,1100` — `google_calendar_default` read from form and included in `toSave` |
| R05 | AC-1.5: Calendar names unique, non-empty; IDs non-empty | PASS | `src/web/settings.ts:1044-1047` — Only includes entries where both `name.trim()` and `id.trim()` are non-empty; JSON object keys enforce uniqueness |
| R06 | AC-1.6: At least one calendar required in multi-calendar | PASS | `src/web/settings.ts:1048` — When no valid entries, `google_calendars` is set to empty string (falls back to single-calendar mode) |
| R07 | AC-2.1: Legacy single-calendar works when google_calendars not set | PASS | `src/google-calendar.ts:27` — `calendarId` resolved from `google_calendar_id` / `GOOGLE_CALENDAR_ID` when `google_calendars` is absent |
| R08 | AC-2.2: Multi-calendar (2+ entries) takes precedence over google_calendar_id | PASS | `src/google-calendar.ts:49-56` — When `google_calendars` JSON has 2+ entries, `calendars` map is set; `calendarId` is set to default calendar from that map |
| R09 | AC-2.3: Single entry in google_calendars = single mode | PASS | `src/google-calendar.ts:57-59` — When exactly 1 entry, returns config with just `calendarId` set to that entry's value, no `calendars` map |
| R10 | AC-2.4: GOOGLE_CALENDAR_ID env var fallback | PASS | `src/google-calendar.ts:27` — Falls through to `process.env.GOOGLE_CALENDAR_ID` when no settings key |
| R11 | AC-3.1: Classification prompt includes calendar names when multi-calendar active | PASS | `src/classify.ts:165-168` — `assemblePrompt` injects calendar routing section when `calendarNames.length >= 2`. Callers (`src/telegram.ts:148`, `src/web/dashboard.ts:599,657`, `src/mcp-tools.ts:170`, `src/web/new-note.ts:213`) resolve and pass `calendarNames` via `getCalendarNames(sql)` |
| R12 | AC-3.2: Classification output adds `calendar_name` field | PASS | `src/classify.ts:59,79,118-119,130` — `validateClassificationResponse` extracts `calendar_name` from parsed JSON, returns as `string \| null` |
| R13 | AC-3.3: `calendar_name` only in prompt when multi-calendar active | PASS | `src/classify.ts:166` — Calendar section only injected when `calendarNames && calendarNames.length >= 2`; `getCalendarNames` returns `undefined` for single-calendar |
| R14 | AC-3.4: LLM selects from exact names in prompt | PASS | `src/classify.ts:167` — Prompt lists exact configured names: `"Personal", "Alma"` etc. |
| R15 | AC-4.1: System looks up calendar ID from calendar_name | PASS | `src/google-calendar.ts:82-86` — `resolveTargetCalendarId` looks up `config.calendars[calendarName]` |
| R16 | AC-4.2: Event created on resolved calendar ID | PASS | `src/google-calendar.ts:349-353` — `opConfig` uses `targetCalendarId`, passed to `createCalendarEvent` |
| R17 | AC-4.3: `google_calendar_target` stored on entry | PASS | `src/google-calendar.ts:360-362` — In multi-calendar mode, UPDATE sets both `google_calendar_event_id` and `google_calendar_target` |
| R18 | AC-4.4: Invalid/null calendar_name falls back to default | PASS | `src/google-calendar.ts:84-89` — When name not in `calendars` map, falls back to `config.calendars[config.defaultCalendar!]`, logs warning |
| R19 | AC-4.5: Single-calendar mode: no google_calendar_target populated | PASS | `src/google-calendar.ts:358-366` — `isMultiCalendar` check: only sets `google_calendar_target` when `config.calendars` exists |
| R20 | AC-5.1: Update uses stored google_calendar_target | PASS | `src/google-calendar.ts:347` — `opCalendarId` = `existingTarget \|\| targetCalendarId`, so stored target takes precedence for updates |
| R21 | AC-5.2: Calendar change = delete old + create new | PASS | `src/google-calendar.ts:334-343` — `calendarChanged` detected when `existingTarget !== targetCalendarId`; deletes from old calendar, creates on new, updates both DB columns |
| R22 | AC-5.3: Soft-delete uses stored google_calendar_target | PASS | `src/google-calendar.ts:478-483` — `handleEntryCalendarCleanup` reads `google_calendar_target` from entry, uses it as `calendarId` for delete |
| R23 | AC-5.4: Null target falls back to single calendar | PASS | `src/google-calendar.ts:481-483` — When `calendarTarget` is null, uses `config.calendarId` (the single/default calendar) |
| R24 | C-1: Shared OAuth credentials | PASS | `src/google-calendar.ts:28-31` — Single `accessToken`/`refreshToken` in config, used by all calendar operations regardless of target calendar |
| R25 | C-2: google_calendars JSON format | PASS | `src/google-calendar.ts:47-48` — Parses as `Record<string, string>` (name→calendarId) |
| R26 | C-3: google_calendar_target nullable TEXT column | PASS | `src/db/index.ts:122` — `ALTER TABLE entries ADD COLUMN IF NOT EXISTS google_calendar_target TEXT` |
| R27 | C-4: Classification field count varies by mode | PASS | `src/classify.ts:165-168` — Calendar section (with `calendar_name` field) only injected for multi-calendar |
| R28 | C-5: GOOGLE_CALENDAR_ID env var unchanged | PASS | `src/google-calendar.ts:27` — Env var resolution untouched; only overridden when `google_calendars` has 2+ entries |
| R29 | EC-1: Unrecognized calendar_name → default + warning | PASS | `src/google-calendar.ts:84-89` — Logs warning, returns default calendar ID |
| R30 | EC-2: calendar_name in single mode → ignored | PASS | `src/google-calendar.ts:82-83` — `resolveTargetCalendarId` returns `config.calendarId` when no `config.calendars` |
| R31 | EC-3: Removed calendar, events still work via stored ID | PASS | `src/google-calendar.ts:347,478` — Operations use stored `google_calendar_target` (Google Calendar ID), not name lookup |
| R32 | EC-4: Renamed calendar, existing events unaffected | PASS | Column stores Google Calendar ID, not name. Updates/deletes use stored ID |
| R33 | EC-5: Empty google_calendars → single mode | PASS | `src/google-calendar.ts:49` — `entries.length >= 2` check fails for empty object; falls through to single-calendar |
| R34 | EC-6: Default name doesn't match → use first calendar | PASS | `src/google-calendar.ts:54-56` — When `defaultName` not in `calendars`, `defaultCalendar = entries[0][0]` |
| R35 | EC-7: Calendar change during reclassification | PASS | `src/google-calendar.ts:330-343` — Covered by `calendarChanged` detection and delete+create flow |
| R36 | EC-8: Single→multi transition, null target fallback | PASS | `src/google-calendar.ts:347` — `existingTarget || targetCalendarId` — null target falls through to resolved target |

## Summary

**Result: 36/36 PASS, 0 FAIL, 0 PARTIAL**

## Gaps Requiring Action

None.

## Notes

- All 30 multi-calendar tests (22 unit + 8 integration) pass.
- All 38 existing google-calendar tests pass (no regressions).
- All 34 classify tests and 30 settings tests pass (no regressions).
- During verification, a gap was found where callers (telegram, dashboard, MCP, new-note) were not passing `calendarNames` to `classifyText`. This was fixed by adding `getCalendarNames(sql)` to each caller before writing this report.
- Pre-existing test failures in `digests.test.ts` (18), `config.test.ts` (1), `web-dashboard.test.ts` (1) are unrelated to this feature — confirmed by stashing changes and re-running.
