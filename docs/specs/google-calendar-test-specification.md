# Google Calendar Integration - Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|-----------------|-------------------|
| AC-1.1 Event created when conditions met | TS-1.1, TS-1.2 |
| AC-1.2 Title = entry name | TS-1.1, TS-1.2 |
| AC-1.3 Description = original text | TS-1.1, TS-1.2 |
| AC-1.4 Timed event with calendar_time | TS-1.1 |
| AC-1.5 All-day event without calendar_time | TS-1.2 |
| AC-1.6 Event ID stored on entry | TS-1.1, TS-1.2 |
| AC-1.7 Any source triggers creation | TS-1.3, TS-1.4, TS-1.5, TS-1.6 |
| AC-2.1 Calendar ID field on settings | TS-2.1 |
| AC-2.2 Connect button opens consent URL | TS-2.2 |
| AC-2.3 User pastes auth code | TS-2.3 |
| AC-2.4 Auth code exchanged for tokens | TS-2.3 |
| AC-2.5 Tokens stored in settings | TS-2.3 |
| AC-2.6 Connection status display | TS-2.4, TS-2.5 |
| AC-2.7 Disconnect clears tokens | TS-2.6 |
| AC-2.8 Env vars as fallback | TS-2.7, TS-2.8 |
| AC-3.1 Telegram calendar confirmation | TS-3.1 |
| AC-3.2 Web calendar confirmation | TS-3.2 |
| AC-3.3 MCP calendar confirmation | TS-3.3 |
| AC-4.1 Entry saved despite calendar failure | TS-4.1 |
| AC-4.2 Token refresh + retry on 401 | TS-4.2 |
| AC-4.3 Retry on other errors | TS-4.3 |
| AC-4.4 Failure notification after retry | TS-4.4 |
| AC-4.5 New refresh token stored | TS-4.5 |
| AC-5.1 Update event on reclassification | TS-5.1 |
| AC-5.2 Delete event when reclassified no-calendar | TS-5.2 |
| AC-5.3 Create event when no prior event | TS-5.3 |
| AC-6.1 Calendar event deleted on soft-delete | TS-6.1 |
| AC-6.2 Entry deleted even if calendar delete fails | TS-6.2 |
| AC-6.3 No event re-created on restore | TS-6.3 |
| AC-7.1 Duration field on settings page | TS-7.1 |
| AC-7.2 Duration stored in settings | TS-7.1b |
| AC-7.3 Duration validation 15-480 | TS-7.2, TS-7.3 |
| AC-7.4 Default 60 minutes | TS-7.4 |
| AC-7.5 Duration applied to timed events | TS-7.5 |
| C-1 Calendar never blocks entry storage | TS-4.1, TS-9.1 |
| C-2 Classification adds calendar_time field | TS-9.2 |
| C-6 Silently inert when not configured | TS-9.3 |
| EC-1 create_calendar_event true but date null | TS-8.1 |
| EC-2 Invalid calendar_time format | TS-8.2 |
| EC-3 Past date creates event | TS-8.3 |
| EC-4 Revoked refresh token | TS-8.4 |
| EC-5 Simultaneous entries | TS-8.5 |
| EC-6 Hard delete after failed soft-delete cleanup | TS-8.6 |
| EC-7 Entry edit updates calendar event | TS-8.7 |
| EC-8 Invalid calendar ID | TS-8.8 |

## Test Scenarios

### Group 1: Calendar Event Creation

**TS-1.1: Create timed calendar event from classified entry**

```
Given Google Calendar is configured with valid tokens
And classification returns create_calendar_event: true, calendar_date: "2026-04-15", calendar_time: "14:00"
When an entry is processed through the classification pipeline
Then a timed Google Calendar event is created on 2026-04-15 at 14:00
And the event title is the entry's name
And the event description contains the original input text
And the entry's google_calendar_event_id is set to the returned event ID
```

**TS-1.2: Create all-day calendar event when no time provided**

```
Given Google Calendar is configured with valid tokens
And classification returns create_calendar_event: true, calendar_date: "2026-04-15", calendar_time: null
When an entry is processed through the classification pipeline
Then an all-day Google Calendar event is created on 2026-04-15
And the event title is the entry's name
And the event description contains the original input text
And the entry's google_calendar_event_id is set to the returned event ID
```

**TS-1.3: Telegram text message triggers calendar event creation**

```
Given Google Calendar is configured with valid tokens
And an authorized Telegram user sends a text message that classifies with create_calendar_event: true
When the Telegram text handler processes the message
Then the entry is saved to the database
And a Google Calendar event is created
```

**TS-1.4: Telegram voice message triggers calendar event creation**

```
Given Google Calendar is configured with valid tokens
And an authorized Telegram user sends a voice message that classifies with create_calendar_event: true
When the Telegram voice handler processes the message
Then the entry is saved to the database
And a Google Calendar event is created
```

**TS-1.5: Web dashboard capture triggers calendar event creation**

```
Given Google Calendar is configured with valid tokens
And a user submits a note via the web dashboard that classifies with create_calendar_event: true
When the dashboard capture handler processes the note
Then the entry is saved to the database
And a Google Calendar event is created
```

**TS-1.6: MCP add_thought triggers calendar event creation**

```
Given Google Calendar is configured with valid tokens
And a thought is added via MCP that classifies with create_calendar_event: true
When the MCP add_thought handler processes the thought
Then the entry is saved to the database
And a Google Calendar event is created
```

**TS-1.7: No calendar event when create_calendar_event is false**

```
Given Google Calendar is configured with valid tokens
And classification returns create_calendar_event: false
When an entry is processed through the classification pipeline
Then the entry is saved to the database
And no Google Calendar API call is made
And the entry's google_calendar_event_id is null
```

### Group 2: OAuth Settings Page

**TS-2.1: Settings page displays Google Calendar section**

```
Given an authenticated user
When the user loads the settings page
Then a "Google Calendar" section is displayed
And it contains a Calendar ID text input field
And it contains a default event duration field
```

**TS-2.2: Connect button generates OAuth consent URL**

```
Given an authenticated user
And GOOGLE_CLIENT_ID is configured
And Google Calendar is not connected
When the user views the Google Calendar settings section
Then a "Connect Google Calendar" link or button is displayed
And the link points to Google's OAuth2 authorization endpoint
And the URL includes the configured client ID and calendar scope
```

**TS-2.3: Authorization code exchange stores tokens**

```
Given an authenticated user
And GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured
When the user submits a valid Google authorization code
Then the app exchanges the code for access and refresh tokens via the Google token endpoint
And the refresh token is stored in the settings table as google_refresh_token
And the access token is stored in the settings table as google_access_token
```

**TS-2.4: Connected status shown when tokens exist**

```
Given an authenticated user
And google_refresh_token exists in the settings table
When the user loads the settings page
Then the Google Calendar section shows "Connected" status
And a "Disconnect" button is visible
```

**TS-2.5: Not connected status shown when no tokens**

```
Given an authenticated user
And no google_refresh_token exists in the settings table or env vars
When the user loads the settings page
Then the Google Calendar section shows "Not connected" status
And the "Connect Google Calendar" button is visible
```

**TS-2.6: Disconnect clears stored tokens**

```
Given an authenticated user
And Google Calendar is connected (tokens in settings table)
When the user clicks the "Disconnect" button
Then google_refresh_token is removed from the settings table
And google_access_token is removed from the settings table
And the settings page shows "Not connected" status
```

**TS-2.7: Environment variable provides fallback calendar ID**

```
Given GOOGLE_CALENDAR_ID env var is set to "test@group.calendar.google.com"
And no google_calendar_id exists in the settings table
When the calendar configuration is resolved
Then the calendar ID "test@group.calendar.google.com" is used
```

**TS-2.8: Settings table value overrides environment variable**

```
Given GOOGLE_CALENDAR_ID env var is set to "env@group.calendar.google.com"
And google_calendar_id is set to "settings@group.calendar.google.com" in the settings table
When the calendar configuration is resolved
Then the calendar ID "settings@group.calendar.google.com" is used
```

### Group 3: Confirmation Messages

**TS-3.1: Telegram reply includes calendar confirmation**

```
Given Google Calendar is configured with valid tokens
And a Telegram message classifies with create_calendar_event: true, calendar_date: "2026-04-15"
When the calendar event is successfully created
Then the Telegram reply includes "📅 Calendar event created for 2026-04-15"
```

**TS-3.2: Web capture response includes calendar confirmation**

```
Given Google Calendar is configured with valid tokens
And a web dashboard note classifies with create_calendar_event: true
When the calendar event is successfully created
Then the web response includes a calendar confirmation indicator
```

**TS-3.3: MCP add_thought result includes calendar confirmation**

```
Given Google Calendar is configured with valid tokens
And an MCP add_thought call classifies with create_calendar_event: true
When the calendar event is successfully created
Then the MCP result text includes a calendar confirmation line
```

### Group 4: Failure Handling & Retry

**TS-4.1: Entry saved when calendar API fails**

```
Given Google Calendar is configured with valid tokens
And the Google Calendar API is unreachable
And classification returns create_calendar_event: true
When an entry is processed through the classification pipeline
Then the entry is saved to the database
And the entry's google_calendar_event_id is null
```

**TS-4.2: Token refresh and retry on 401**

```
Given Google Calendar is configured
And the stored access token has expired
When a calendar event creation is attempted
Then the Google Calendar API returns 401
And the app refreshes the access token using the stored refresh token
And the calendar event creation is retried with the new access token
And the event is created successfully
```

**TS-4.3: Retry on server error**

```
Given Google Calendar is configured with valid tokens
And the Google Calendar API returns a 500 error on the first attempt
When a calendar event creation is attempted
Then the app waits 1 second
And retries the calendar event creation
And the event is created successfully on the second attempt
```

**TS-4.4: Failure notification after retry exhausted**

```
Given Google Calendar is configured with valid tokens
And the Google Calendar API returns errors on both the first attempt and retry
When a calendar event creation is attempted
Then the error is logged
And the user is notified that the entry was saved but calendar event creation failed
```

**TS-4.5: New refresh token stored after token refresh**

```
Given Google Calendar is configured
And the stored access token has expired
When the app refreshes the access token
And the token response includes a new refresh token
Then the new refresh token replaces the old one in the settings table
And the new access token is stored in the settings table
```

### Group 5: Reclassification & Update

**TS-5.1: Update existing calendar event on reclassification**

```
Given an entry exists with google_calendar_event_id "event123"
And Google Calendar is configured with valid tokens
When the entry is reclassified with create_calendar_event: true, calendar_date: "2026-05-01"
Then the existing Google Calendar event "event123" is updated with the new date
And the event title and description are updated
And the entry's google_calendar_event_id remains "event123"
```

**TS-5.2: Delete calendar event when reclassified to no-calendar**

```
Given an entry exists with google_calendar_event_id "event123"
And Google Calendar is configured with valid tokens
When the entry is reclassified with create_calendar_event: false
Then the Google Calendar event "event123" is deleted
And the entry's google_calendar_event_id is set to null
```

**TS-5.3: Create new event when reclassified entry has no prior event**

```
Given an entry exists with google_calendar_event_id null
And Google Calendar is configured with valid tokens
When the entry is reclassified with create_calendar_event: true, calendar_date: "2026-05-01"
Then a new Google Calendar event is created
And the entry's google_calendar_event_id is set to the new event ID
```

**TS-5.4: No action when reclassified to no-calendar and no prior event**

```
Given an entry exists with google_calendar_event_id null
When the entry is reclassified with create_calendar_event: false
Then no Google Calendar API call is made
And the entry's google_calendar_event_id remains null
```

### Group 6: Entry Deletion

**TS-6.1: Calendar event deleted on entry soft-delete**

```
Given an entry exists with google_calendar_event_id "event123"
And Google Calendar is configured with valid tokens
When the entry is soft-deleted
Then the Google Calendar event "event123" is deleted
And the entry's deleted_at is set
```

**TS-6.2: Entry soft-deleted even if calendar deletion fails**

```
Given an entry exists with google_calendar_event_id "event123"
And Google Calendar is configured but the API returns an error
When the entry is soft-deleted
Then the entry's deleted_at is set (soft-delete succeeds)
And the error is logged
And the entry's google_calendar_event_id is not cleared
```

**TS-6.3: No calendar event re-created on restore**

```
Given an entry was soft-deleted and its calendar event was deleted (AC-6.1)
And the entry's google_calendar_event_id is still set to "event123"
When the entry is restored from trash
Then no Google Calendar API call is made to create an event
And the entry's google_calendar_event_id is cleared (the old event no longer exists)
```

### Group 7: Duration Configuration

**TS-7.1: Duration field displayed on settings page**

```
Given an authenticated user
When the user loads the settings page
Then the Google Calendar section contains a "Default event duration" input field
```

**TS-7.1b: Duration value saved to settings table**

```
Given an authenticated user
When the user sets the default event duration to 45 and saves
Then google_calendar_default_duration is stored as "45" in the settings table
```

**TS-7.2: Duration validation rejects below minimum**

```
Given an authenticated user
When the user sets the default event duration to 10 and saves
Then a validation error is shown indicating the minimum is 15 minutes
And the value is not saved
```

**TS-7.3: Duration validation rejects above maximum**

```
Given an authenticated user
When the user sets the default event duration to 500 and saves
Then a validation error is shown indicating the maximum is 480 minutes
And the value is not saved
```

**TS-7.4: Default duration is 60 minutes when not configured**

```
Given no google_calendar_default_duration exists in the settings table
When a timed calendar event is created
Then the event duration is 60 minutes
```

**TS-7.5: Configured duration applied to timed events**

```
Given google_calendar_default_duration is set to 30 in the settings table
And classification returns create_calendar_event: true, calendar_date: "2026-04-15", calendar_time: "09:00"
When a timed calendar event is created
Then the event starts at 09:00 and ends at 09:30
```

### Group 8: Edge Cases

**TS-8.1: Skip creation when calendar_date is null despite flag**

```
Given Google Calendar is configured with valid tokens
And classification returns create_calendar_event: true, calendar_date: null
When an entry is processed through the classification pipeline
Then no Google Calendar event is created
And no error is logged
And the entry is saved normally
```

**TS-8.2: All-day event when calendar_time has invalid format**

```
Given Google Calendar is configured with valid tokens
And classification returns create_calendar_event: true, calendar_date: "2026-04-15", calendar_time: "afternoon"
When an entry is processed through the classification pipeline
Then an all-day Google Calendar event is created on 2026-04-15 (time is ignored)
```

**TS-8.3: Past date still creates event**

```
Given Google Calendar is configured with valid tokens
And classification returns create_calendar_event: true, calendar_date: "2025-01-01"
When an entry is processed through the classification pipeline
Then a Google Calendar event is created on 2025-01-01
```

**TS-8.4: Revoked refresh token shows disconnected**

```
Given Google Calendar was previously connected
And the user has revoked the app's access in Google security settings
When the app attempts to refresh the access token
Then the token refresh fails with an error
And the failure is logged
And the next settings page load shows "Not connected" status
```

**TS-8.5: Multiple simultaneous entries create independent events**

```
Given Google Calendar is configured with valid tokens
And two entries are classified concurrently, both with create_calendar_event: true
When both entries are processed
Then two separate Google Calendar events are created
And each entry has its own google_calendar_event_id
```

**TS-8.6: Hard delete does not reattempt calendar deletion**

```
Given an entry was soft-deleted and calendar event deletion failed (orphaned)
When the trash is emptied (hard delete)
Then no Google Calendar API call is made
And the entry is permanently removed from the database
```

**TS-8.7: Entry edit updates linked calendar event**

```
Given an entry exists with google_calendar_event_id "event123"
And Google Calendar is configured with valid tokens
When the entry is edited via the web entry page with a new calendar_date or calendar_time
Then the Google Calendar event "event123" is updated with the new date/time
```

**TS-8.8: Invalid calendar ID returns failure**

```
Given Google Calendar is configured with an invalid calendar ID
And classification returns create_calendar_event: true
When a calendar event creation is attempted
Then the Google API returns 404
And the entry is saved normally
And the user is notified that calendar event creation failed (per AC-4.4)
```

### Group 9: Constraints

**TS-9.1: Calendar API call does not block entry storage**

```
Given Google Calendar is configured with valid tokens
And the Google Calendar API has high latency (slow response)
When an entry is processed through the classification pipeline
Then the entry is saved to the database before the calendar API call completes
```

**TS-9.2: Classification schema includes calendar_time field**

```
Given a text input with a date and time reference (e.g., "Meeting tomorrow at 3pm")
When the text is classified
Then the classification result includes create_calendar_event, calendar_date, and calendar_time fields
And calendar_time is in HH:MM format when a time is detected
```

**TS-9.3: Feature is inert when not configured**

```
Given no Google Calendar tokens exist in settings or env vars
And classification returns create_calendar_event: true, calendar_date: "2026-04-15"
When an entry is processed through the classification pipeline
Then no Google Calendar API call is made
And no error is logged
And the entry is saved normally with google_calendar_event_id null
```

## Traceability

All 27 acceptance criteria are covered by at least one test scenario. All 8 edge cases have corresponding scenarios. Constraints C-1, C-2, and C-6 are verified directly; C-3, C-4, and C-5 are implementation details verified implicitly through the behavioral scenarios.

**Total: 47 test scenarios** across 9 groups.

| Group | Count |
|-------|-------|
| 1. Event Creation | 7 |
| 2. OAuth Settings | 8 |
| 3. Confirmation | 3 |
| 4. Failure Handling | 5 |
| 5. Reclassification | 4 |
| 6. Deletion | 3 |
| 7. Duration Config | 6 |
| 8. Edge Cases | 8 |
| 9. Constraints | 3 |
