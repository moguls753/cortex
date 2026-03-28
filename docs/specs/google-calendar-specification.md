# Google Calendar Integration - Behavioral Specification

## Objective

Automatically create Google Calendar events from entries that the classification pipeline identifies as calendar-worthy (meetings, deadlines, appointments). This closes the loop between capturing a thought and having it appear on the user's calendar — without manual entry duplication. The integration is optional: if not configured, the system behaves identically to today.

## User Stories & Acceptance Criteria

### US-1: As a user, I want entries with dates/times to automatically appear on my Google Calendar, so that I don't have to manually create calendar events for things I capture.

**AC-1.1:** When classification returns `create_calendar_event: true` and `calendar_date` is non-null, and Google Calendar is configured, a Google Calendar event is created.

**AC-1.2:** The calendar event title is the entry's `name` field.

**AC-1.3:** The calendar event description contains the original input text.

**AC-1.4:** If `calendar_time` is non-null (HH:MM format), a timed event is created starting at that time with the configured default duration.

**AC-1.5:** If `calendar_time` is null, an all-day event is created on `calendar_date`.

**AC-1.6:** The Google Calendar event ID is stored on the entry (`google_calendar_event_id` column) after successful creation.

**AC-1.7:** This applies to entries from any source that runs through the classification pipeline (Telegram text, Telegram voice, web dashboard capture, MCP `add_thought`).

### US-2: As a user, I want to connect my Google Calendar via the settings page, so that I don't have to manually obtain OAuth tokens.

**AC-2.1:** The settings page has a "Google Calendar" section with a Calendar ID text input field.

**AC-2.2:** A "Connect Google Calendar" button opens a Google OAuth consent URL (constructed from the configured client ID and redirect URI).

**AC-2.3:** The user pastes the authorization code returned by Google into a text field on the settings page.

**AC-2.4:** The app exchanges the authorization code for access and refresh tokens via the Google OAuth2 token endpoint.

**AC-2.5:** The refresh token and access token are stored in the settings table (`google_refresh_token`, `google_access_token` keys).

**AC-2.6:** The settings page shows connection status: "Connected" (with a disconnect button) or "Not connected" (with the connect button).

**AC-2.7:** A "Disconnect" button clears all stored Google tokens from the settings table.

**AC-2.8:** The Calendar ID and Google Client ID / Client Secret can also be provided via environment variables (`GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). Settings table values override env vars.

### US-3: As a user, I want to see confirmation when a calendar event is created, so that I know my entry made it to the calendar.

**AC-3.1:** When a calendar event is successfully created via Telegram, the reply includes an additional line: "📅 Calendar event created for {date}" (where date is the `calendar_date` value).

**AC-3.2:** When a calendar event is successfully created via web dashboard capture, the response includes a calendar confirmation indicator.

**AC-3.3:** When a calendar event is successfully created via MCP `add_thought`, the result text includes a calendar confirmation line.

### US-4: As a user, I want calendar event creation to be resilient to transient failures, so that I don't lose entries because of a temporary Google API issue.

**AC-4.1:** If the Google Calendar API returns an error, the entry is still saved to the database (calendar event creation never blocks entry storage).

**AC-4.2:** On a 401 response (expired access token), the app refreshes the access token using the stored refresh token, then retries the calendar API call once.

**AC-4.3:** On other errors (network, 5xx, quota), the app retries once after a 1-second delay.

**AC-4.4:** If the retry also fails, the error is logged and the user is notified: "Entry saved but calendar event creation failed" (in the appropriate channel — Telegram reply, web response, MCP result).

**AC-4.5:** When a token refresh produces a new refresh token, it is stored in the settings table, replacing the previous one.

### US-5: As a user, I want reclassified entries to update (not duplicate) calendar events, so that my calendar stays clean.

**AC-5.1:** If an entry already has a `google_calendar_event_id` and reclassification returns `create_calendar_event: true`, the existing calendar event is updated (title, description, date/time) instead of creating a new one.

**AC-5.2:** If an entry already has a `google_calendar_event_id` and reclassification returns `create_calendar_event: false`, the existing calendar event is deleted from Google Calendar and the `google_calendar_event_id` is cleared from the entry.

**AC-5.3:** If an entry has no `google_calendar_event_id` and reclassification returns `create_calendar_event: true`, a new calendar event is created (same as US-1).

### US-6: As a user, I want calendar events to be cleaned up when I delete entries, so that my calendar doesn't have orphaned events.

**AC-6.1:** When an entry with a non-null `google_calendar_event_id` is soft-deleted, the corresponding Google Calendar event is also deleted.

**AC-6.2:** If the Google Calendar event deletion fails (API error), the entry is still soft-deleted and the error is logged. The calendar event becomes orphaned.

**AC-6.3:** When a soft-deleted entry is restored from trash, no calendar event is re-created automatically.

### US-7: As a user, I want to configure the default event duration for timed events, so that my calendar events match my typical meeting length.

**AC-7.1:** The settings page has a "Default event duration" field in the Google Calendar section.

**AC-7.2:** The value is stored in the settings table under the key `google_calendar_default_duration`.

**AC-7.3:** The value is an integer representing minutes. Valid range: 15-480 (15 minutes to 8 hours).

**AC-7.4:** The default value (when not configured) is 60 minutes.

**AC-7.5:** The configured duration is used as the event length for all timed calendar events (events where `calendar_time` is non-null).

## Constraints

**C-1:** Google Calendar API calls are asynchronous — they must never block entry storage. The entry is saved first, then the calendar event is created.

**C-2:** The classification schema adds one new field (`calendar_time: "HH:MM" | null`) to the existing 7-field JSON output, making it 8 fields. The `calendar_date` and `create_calendar_event` fields remain unchanged.

**C-3:** The `google_calendar_event_id` is a nullable TEXT column on the `entries` table. No separate linking table.

**C-4:** OAuth2 tokens are stored in the settings table, not in environment variables. Env vars provide `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `GOOGLE_CALENDAR_ID` for initial configuration. A `GOOGLE_REFRESH_TOKEN` env var is also accepted for backward compatibility with the architecture spec, but the settings page flow is the primary setup method.

**C-5:** The Google Calendar API client uses Google's OAuth2 REST endpoints directly (token endpoint: `https://oauth2.googleapis.com/token`, calendar API: `https://www.googleapis.com/calendar/v3`). No Google SDK dependency required.

**C-6:** When Google Calendar is not configured (no tokens in settings, no `GOOGLE_REFRESH_TOKEN` env var), the feature is completely inert — `create_calendar_event: true` in classification output is silently ignored with no errors or log messages.

## Edge Cases

**EC-1:** Classification returns `create_calendar_event: true` but `calendar_date` is null — treat as no calendar event (skip creation, no error).

**EC-2:** Classification returns `calendar_time` in an invalid format (not HH:MM) — ignore the time, create an all-day event using `calendar_date` only.

**EC-3:** `calendar_date` is in the past — create the event anyway (user may be logging something retroactively).

**EC-4:** Google refresh token has been revoked by the user in Google's security settings — token refresh returns an error. Log the error, notify via AC-4.4, and mark the connection as failed. Next settings page load should show "Not connected" if the stored tokens can no longer obtain a valid access token.

**EC-5:** Multiple entries classified simultaneously (e.g., bulk import) — each creates its own calendar event independently. No deduplication across entries.

**EC-6:** Entry is soft-deleted and then trash is emptied (hard delete) — if the calendar event was already deleted on soft-delete (AC-6.1), no further action. If soft-delete calendar deletion failed (AC-6.2), the orphaned calendar event remains.

**EC-7:** Entry is edited via the web entry page and the edit changes `calendar_date` or `calendar_time` — the linked calendar event should be updated if the entry has a `google_calendar_event_id`. Manual edits to date/time fields in the entry form trigger a calendar event update.

**EC-8:** Calendar ID is invalid or the user doesn't have write access — Google API returns 404 or 403. Handle as a normal API failure (AC-4.3/AC-4.4).

## Non-Goals

**NG-1:** No reading from Google Calendar. This is write-only (create, update, delete events). No calendar sync or display of upcoming events.

**NG-2:** No support for recurring events. Each entry creates a single event.

**NG-3:** No support for multiple calendars. One calendar ID, one set of credentials.

**NG-4:** No support for calendar invitees/attendees. Events are created for the user only.

**NG-5:** No re-creation of calendar events on entry restore from trash (AC-6.3). The user can trigger reclassification manually if needed.

**NG-6:** No browser-based OAuth redirect flow. The settings page uses a paste-code approach (AC-2.2/AC-2.3).

## Open Questions

None — all questions resolved during specification interview.
