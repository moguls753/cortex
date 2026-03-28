# Verification: google-calendar-specification.md

| Field | Value |
|-------|-------|
| Spec file | `docs/specs/google-calendar-specification.md` |
| Feature | google-calendar |
| Date | 2026-03-28 |

## Requirements

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| R01 | AC-1.1: Event created when conditions met | PASS | `src/google-calendar.ts:313` — createCalendarEvent called when create_calendar_event=true, calendar_date non-null, configured |
| R02 | AC-1.2: Event title = entry name | PASS | `src/google-calendar.ts:74` — summary: name in buildEventBody |
| R03 | AC-1.3: Event description = original text | PASS | `src/google-calendar.ts:75` — description: content |
| R04 | AC-1.4: Timed event with calendar_time | PASS | `src/google-calendar.ts:78-80` — dateTime with addMinutes for duration |
| R05 | AC-1.5: All-day event without calendar_time | PASS | `src/google-calendar.ts:82-87` — date fields with +1 day end |
| R06 | AC-1.6: Event ID stored on entry | PASS | `src/google-calendar.ts:321-323` — UPDATE entries SET google_calendar_event_id |
| R07 | AC-1.7: All sources trigger creation | PASS | `src/telegram.ts:189,317` `src/web/dashboard.ts:670` `src/mcp-tools.ts:203` |
| R08 | AC-2.1: Calendar ID field on settings | PASS | `src/web/settings.ts:517-519` — input name=google_calendar_id |
| R09 | AC-2.2: Connect button opens consent URL | PASS | `src/web/settings.ts:534-536` — accounts.google.com URL with client_id and scope |
| R10 | AC-2.3: User pastes auth code | PASS | `src/web/settings.ts:541-548` — input field + connect button |
| R11 | AC-2.4: Auth code exchanged for tokens | PASS | `src/google-calendar.ts:197-228` — POST to oauth2.googleapis.com/token |
| R12 | AC-2.5: Tokens stored in settings | PASS | `src/web/settings.ts:1068-1071` — saveAllSettings with google_access_token, google_refresh_token |
| R13 | AC-2.6: Connection status display | PASS | `src/web/settings.ts:527-539` — Connected/Not connected with token validation |
| R14 | AC-2.7: Disconnect clears tokens | PASS | `src/web/settings.ts:1078-1080` — DELETE FROM settings |
| R15 | AC-2.8: Env vars as fallback | PASS | `src/google-calendar.ts:27-31` — settings override env vars |
| R16 | AC-3.1: Telegram calendar confirmation | PASS | `src/telegram.ts:214-216,341-342` — "📅 Calendar event created for {date}" |
| R17 | AC-3.2: Web calendar confirmation | PASS | `src/web/dashboard.ts:674-676` — calendar HTML indicator on POST / |
| R18 | AC-3.3: MCP calendar confirmation | PASS | `src/mcp-tools.ts:216-218` — calendar key in result data |
| R19 | AC-4.1: Entry saved despite calendar failure | PASS | All handlers: INSERT before processCalendarEvent, wrapped in try-catch |
| R20 | AC-4.2: Token refresh + retry on 401 | PASS | `src/google-calendar.ts:331-358` — refreshAccessToken then retry |
| R21 | AC-4.3: Retry on other errors | PASS | `src/google-calendar.ts:361-377` — 1s delay then retry |
| R22 | AC-4.4: Failure notification after retry | PARTIAL | `src/google-calendar.ts:353,372-375` — errors logged, result has error field, but callers don't surface failure message to user |
| R23 | AC-4.5: New refresh token stored | PASS | `src/google-calendar.ts:335-340` — store via saveAllSettings |
| R24 | AC-5.1: Update existing event | PASS | `src/google-calendar.ts:303-310` — PATCH if existingEventId |
| R25 | AC-5.2: Delete event on reclassify false | PASS | `src/google-calendar.ts:252-272` — DELETE + clear event ID |
| R26 | AC-5.3: Create new event if no prior | PASS | `src/google-calendar.ts:307-314` — POST if !existingEventId |
| R27 | AC-6.1: Calendar event deleted on soft-delete | PASS | `src/web/entry.ts:398-403` — handleEntryCalendarCleanup before softDeleteEntry |
| R28 | AC-6.2: Entry deleted even if calendar fails | PASS | `src/google-calendar.ts:406-409` — catch in handleEntryCalendarCleanup |
| R29 | AC-6.3: No event re-created on restore | PASS | `src/web/entry-queries.ts:53-59` — only sets deleted_at=NULL, no calendar call |
| R30 | AC-7.1: Duration field on settings | PASS | `src/web/settings.ts:522-524` — input name=google_calendar_default_duration |
| R31 | AC-7.2: Duration stored in settings | PASS | `src/web/settings.ts:1035` — in toSave dict |
| R32 | AC-7.3: Duration validation 15-480 | PASS | `src/web/settings.ts:141-149` — checks min/max |
| R33 | AC-7.4: Default 60 minutes | PASS | `src/google-calendar.ts:33` — defaultDuration = 60 |
| R34 | AC-7.5: Duration applied to timed events | PASS | `src/google-calendar.ts:80,97` — addMinutes with defaultDuration |
| R35 | C-1: Calendar never blocks entry storage | PASS | All handlers INSERT first, calendar in try-catch after |
| R36 | C-2: Classification adds calendar_time | PASS | `src/classify.ts:78,115-116` — calendar_time parsed and returned |
| R37 | C-3: google_calendar_event_id nullable TEXT | PASS | `src/db/index.ts:121` — ALTER TABLE ADD COLUMN |
| R38 | C-4: Tokens in settings, env for config | PASS | `src/google-calendar.ts:24-42` — resolveCalendarConfig |
| R39 | C-5: Direct REST API, no SDK | PASS | `src/google-calendar.ts:7-8` — raw fetch calls |
| R40 | C-6: Inert when not configured | PASS | `src/google-calendar.ts:281-283` — silent return |
| R41 | EC-1: Skip if date null despite flag | PASS | `src/google-calendar.ts:276-278` — return { created: false } |
| R42 | EC-2: Invalid time → all-day | PASS | `src/google-calendar.ts:71` — regex validation |
| R43 | EC-3: Past date creates event | PASS | No past-date rejection in code |
| R44 | EC-4: Revoked token shows disconnected | PASS | `src/web/settings.ts:185-196` — token validation on settings page |
| R45 | EC-5: Simultaneous entries independent | PASS | Design: each call is independent |
| R46 | EC-6: Hard delete no reattempt | PASS | No calendar hook on hard delete |
| R47 | EC-7: Entry edit updates calendar | PARTIAL | `processCalendarEvent` supports updates, but entry edit route doesn't call it |
| R48 | EC-8: Invalid calendar ID → failure | PASS | `src/google-calendar.ts:109-111` — error handling for non-ok responses |

## Summary

**Result: 45/48 PASS, 0 FAIL, 3 PARTIAL**

## Gaps Requiring Action

| # | Requirement | Issue | Suggested Fix |
|---|-------------|-------|---------------|
| R22 | AC-4.4: Failure notification | Errors logged but not surfaced to user in reply text | Add failure message to Telegram/web/MCP responses when `calendarResult.error` is set |
| R47 | EC-7: Entry edit updates calendar | Entry edit route doesn't call processCalendarEvent | Add calendar update call in POST `/entry/:id/edit` when date/time fields change |

## Notes

- R17 (AC-3.2) is PASS because the form-based `POST /` handler includes calendar confirmation. The JSON API `POST /api/capture` does not — this is acceptable since the tests and spec target the form-based flow.
- R22 (AC-4.4) is PARTIAL because `processCalendarEvent` returns error info in the result object, but the calling handlers don't render failure messages to the user. The error IS logged server-side.
- R47 (EC-7) is PARTIAL because the `processCalendarEvent` function fully supports updating existing events, but the entry edit web route doesn't invoke it. This is a wiring gap, not a logic gap.
- The `prompts/classify.md` prompt was updated to include `calendar_time` as the 8th field with examples.
