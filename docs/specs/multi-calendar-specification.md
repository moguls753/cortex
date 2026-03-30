# Multi-Calendar Support - Behavioral Specification

## Objective

Extend the Google Calendar integration to support multiple named calendars, where the LLM decides which calendar to route each event to during classification. Users configure named calendars in settings (e.g., "Personal" → primary, "Alma" → alma@group.calendar.google.com). The classification prompt receives the available calendar names, and the LLM returns a `calendar_name` field alongside the existing calendar fields. Event creation looks up the calendar ID from the name. The feature is fully backward-compatible: a single calendar (or no calendars) works exactly like today.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to configure multiple named calendars in settings, so that events can be routed to different calendars.

**AC-1.1:** The settings page Google Calendar section replaces the single "Calendar ID" field with a named calendars editor when multi-calendar mode is active.

**AC-1.2:** Each calendar entry is a name→calendar ID pair (e.g., "Personal" → "primary").

**AC-1.3:** The calendars configuration is stored as a JSON object in a single settings key `google_calendars` (e.g., `{"Personal": "primary", "Alma": "alma@group.calendar.google.com"}`).

**AC-1.4:** One calendar is designated as the default. The default calendar name is stored in settings key `google_calendar_default`.

**AC-1.5:** Calendar names must be unique and non-empty. Calendar IDs must be non-empty.

**AC-1.6:** At least one calendar must be present when using the `google_calendars` setting.

### US-2: As a user, I want single-calendar configuration to keep working exactly as today, so that nothing breaks for existing setups.

**AC-2.1:** When `google_calendars` is not set (or is empty `{}`), the system uses the existing `google_calendar_id` setting / `GOOGLE_CALENDAR_ID` env var — identical to current behavior.

**AC-2.2:** When `google_calendars` is set with 2+ entries, it takes precedence over `google_calendar_id`.

**AC-2.3:** When `google_calendars` is set with exactly 1 entry, that entry's calendar ID is used as the single calendar. No `calendar_name` field appears in the classification prompt.

**AC-2.4:** The `GOOGLE_CALENDAR_ID` env var continues to work as the single-calendar fallback.

### US-3: As a user, I want the LLM to decide which calendar an event belongs to, so that events automatically go to the right calendar.

**AC-3.1:** When multi-calendar is active (2+ calendars configured in `google_calendars`), the classification prompt includes the list of available calendar names.

**AC-3.2:** The classification output adds a `calendar_name` field (string or null) alongside the existing `create_calendar_event`, `calendar_date`, and `calendar_time` fields.

**AC-3.3:** The `calendar_name` field is only added to the classification prompt and expected output when multi-calendar is active.

**AC-3.4:** The LLM selects from the exact calendar names provided in the prompt.

### US-4: As a user, I want events to be created on the calendar the LLM selected, so that my different calendars stay organized.

**AC-4.1:** When `calendar_name` is returned by classification, the system looks up the corresponding calendar ID from the `google_calendars` setting.

**AC-4.2:** The event is created on the resolved calendar ID.

**AC-4.3:** The Google Calendar ID used for event creation is stored on the entry in a new `google_calendar_target` column (nullable TEXT on the entries table).

**AC-4.4:** When `calendar_name` is null, empty, or does not match any configured calendar name, the event is created on the default calendar.

**AC-4.5:** In single-calendar mode, `google_calendar_target` is not populated — the system continues to use `config.calendarId` directly (identical to current behavior).

### US-5: As a user, I want event updates and deletes to target the correct calendar, so that reclassification and deletion work correctly across multiple calendars.

**AC-5.1:** When updating an existing calendar event (reclassification with `create_calendar_event: true`), the system uses the `google_calendar_target` stored on the entry to find the event's calendar.

**AC-5.2:** If reclassification routes the event to a different calendar (different `calendar_name`), the old event is deleted from the old calendar and a new event is created on the new calendar. Both `google_calendar_event_id` and `google_calendar_target` are updated.

**AC-5.3:** When deleting a calendar event (entry soft-delete), the system uses `google_calendar_target` to target the correct calendar.

**AC-5.4:** If `google_calendar_target` is null (legacy entries or single-calendar mode), the system falls back to the configured single calendar ID — same as current behavior.

## Constraints

**C-1:** All calendars share a single set of OAuth credentials. Multi-calendar does not add any new OAuth flows — one Google account, one token set.

**C-2:** The `google_calendars` JSON format is `{"DisplayName": "googleCalendarId", ...}`. Names are display labels used in the classification prompt; values are Google Calendar API calendar IDs.

**C-3:** The `google_calendar_target` column is nullable TEXT on the entries table. Existing entries have null (backward compatible). It stores the Google Calendar ID (not the display name), so it remains valid even if the user renames a calendar in settings.

**C-4:** The classification schema adds one optional field (`calendar_name: string | null`) only when multi-calendar is active. Total fields: 9 when multi-calendar, 8 in single-calendar mode.

**C-5:** The `GOOGLE_CALENDAR_ID` env var and `google_calendar_id` settings key continue to work unchanged for single-calendar setups.

## Edge Cases

**EC-1:** LLM returns a `calendar_name` that doesn't match any configured calendar → use default calendar, log a warning.

**EC-2:** LLM returns `calendar_name` when only one calendar is configured (shouldn't happen since it's not in the prompt) → ignore the field, use the single calendar.

**EC-3:** A calendar is removed from the `google_calendars` setting after events were created on it → existing events still have the Google Calendar ID in `google_calendar_target`, so updates/deletes still work via the API. The name is irrelevant for API calls.

**EC-4:** A calendar is renamed in settings (name changed, same calendar ID) → no impact on existing events. New events use the new name in classification. The stored `google_calendar_target` (which is the calendar ID, not the name) remains valid.

**EC-5:** `google_calendars` is set to an empty object `{}` → treat as not configured, fall back to `google_calendar_id`.

**EC-6:** `google_calendar_default` doesn't match any entry in `google_calendars` → use the first calendar in the JSON object.

**EC-7:** Reclassification changes `calendar_name` from "Personal" to "Alma" for an entry with an existing event → delete from "Personal"'s calendar ID, create on "Alma"'s calendar ID, update both `google_calendar_event_id` and `google_calendar_target`.

**EC-8:** Entry created in single-calendar mode, then user switches to multi-calendar → entry has `google_calendar_target` = null. Updates/deletes fall back to default calendar (AC-5.4), which should be the same calendar used originally.

## Non-Goals

**NG-1:** No per-calendar OAuth credentials. All calendars use the same Google account.

**NG-2:** No per-calendar default durations. The `google_calendar_default_duration` setting applies to all calendars.

**NG-3:** No calendar color coding or visual differentiation in the dashboard.

**NG-4:** No automatic discovery of available Google calendars from the API (e.g., listing the user's calendars). Calendar IDs are entered manually.

**NG-5:** No migration of existing entries — legacy entries keep `google_calendar_target` as null and use fallback behavior (AC-5.4).

**NG-6:** No calendar selection in manual entry creation (web "New Note" form). Calendar routing is always decided by the LLM during classification.

## Open Questions

None — all questions resolved during specification interview.
