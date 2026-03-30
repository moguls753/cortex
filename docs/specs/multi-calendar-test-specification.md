# Multi-Calendar Support - Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|-----------------|-------------------|
| AC-1.1 Named calendars editor in settings | TS-1.1 |
| AC-1.2 Name→calendar ID pairs | TS-1.1 |
| AC-1.3 Stored as JSON in `google_calendars` key | TS-1.2 |
| AC-1.4 Default calendar designation | TS-1.3 |
| AC-1.5 Unique non-empty names and IDs | TS-1.4, TS-1.5 |
| AC-1.6 At least one calendar required | TS-1.6 |
| AC-2.1 Legacy single-calendar still works | TS-2.1 |
| AC-2.2 Multi-calendar takes precedence | TS-2.2 |
| AC-2.3 Single entry in google_calendars = single mode | TS-2.3 |
| AC-2.4 GOOGLE_CALENDAR_ID env var fallback | TS-2.4 |
| AC-3.1 Prompt includes calendar names when multi | TS-3.1 |
| AC-3.2 Classification output includes calendar_name | TS-3.2 |
| AC-3.3 calendar_name only when multi-calendar active | TS-3.3 |
| AC-3.4 LLM selects from exact names | TS-3.1, TS-3.2 |
| AC-4.1 Calendar ID looked up from name | TS-4.1 |
| AC-4.2 Event created on resolved calendar ID | TS-4.1 |
| AC-4.3 google_calendar_target stored on entry | TS-4.2 |
| AC-4.4 Fallback to default on invalid name | TS-4.3 |
| AC-4.5 Single-calendar mode: no target stored | TS-4.4 |
| AC-5.1 Update uses stored target calendar | TS-5.1 |
| AC-5.2 Calendar change = delete old + create new | TS-5.2 |
| AC-5.3 Soft-delete uses stored target calendar | TS-5.3 |
| AC-5.4 Null target falls back to single calendar | TS-5.4 |
| C-1 Shared OAuth credentials | TS-6.1 |
| C-3 google_calendar_target nullable on entries | TS-4.2, TS-4.4 |
| C-4 Classification field count varies by mode | TS-3.3 |
| EC-1 Unrecognized calendar_name → default | TS-7.1 |
| EC-2 calendar_name in single mode → ignored | TS-7.2 |
| EC-3 Removed calendar, existing events still work | TS-7.3 |
| EC-4 Renamed calendar, existing events unaffected | TS-7.4 |
| EC-5 Empty google_calendars → single mode | TS-7.5 |
| EC-6 Default name doesn't match → use first | TS-7.6 |
| EC-7 Reclassification changes calendar | TS-5.2 |
| EC-8 Single→multi mode transition | TS-7.7 |

## Test Scenarios

### Group 1: Settings Configuration

**TS-1.1: Configure multiple named calendars**

```
Given the user is on the settings page
And Google Calendar is connected
When the user adds calendar entries: "Personal" → "primary", "Alma" → "alma@group.calendar.google.com"
Then the settings page shows two named calendar entries
And each entry displays its name and calendar ID
```

**TS-1.2: Calendars stored as JSON in settings**

```
Given the user saves calendar configuration with "Personal" → "primary" and "Alma" → "alma@group.calendar.google.com"
When the settings are persisted
Then the `google_calendars` settings key contains '{"Personal":"primary","Alma":"alma@group.calendar.google.com"}'
```

**TS-1.3: Default calendar designation**

```
Given multiple calendars are configured: "Personal" → "primary", "Alma" → "alma@group.calendar.google.com"
When the user designates "Personal" as the default
Then the `google_calendar_default` settings key contains "Personal"
```

**TS-1.4: Reject duplicate calendar names**

```
Given the user attempts to save calendars with two entries named "Personal"
When the settings form is submitted
Then the save is rejected with a validation error
And the duplicate names are not persisted
```

**TS-1.5: Reject empty calendar name or ID**

```
Given the user attempts to save a calendar with an empty name
When the settings form is submitted
Then the save is rejected with a validation error
And given the user attempts to save a calendar with a non-empty name but empty calendar ID
When the settings form is submitted
Then the save is rejected with a validation error
```

**TS-1.6: At least one calendar required in multi-calendar mode**

```
Given multi-calendar mode is active
When the user removes all calendar entries and submits
Then the save is rejected with a validation error
```

### Group 2: Backward Compatibility

**TS-2.1: Legacy single-calendar config works unchanged**

```
Given `google_calendars` is not set in settings
And `google_calendar_id` is set to "primary"
When an entry is classified with create_calendar_event: true
Then the event is created on calendar "primary"
And the behavior is identical to the existing single-calendar implementation
```

**TS-2.2: Multi-calendar takes precedence over google_calendar_id**

```
Given `google_calendar_id` is set to "old-calendar"
And `google_calendars` is set to '{"Personal": "primary", "Alma": "alma@group.calendar.google.com"}'
When the system resolves which calendar to use
Then the calendars from `google_calendars` are used
And `google_calendar_id` is ignored
```

**TS-2.3: Single entry in google_calendars treated as single mode**

```
Given `google_calendars` is set to '{"Personal": "primary"}'
When an entry is classified with create_calendar_event: true
Then the event is created on calendar "primary"
And the classification prompt does not include calendar name instructions
And no `calendar_name` field is expected in the classification output
```

**TS-2.4: GOOGLE_CALENDAR_ID env var works as fallback**

```
Given `google_calendars` is not set
And `google_calendar_id` is not set in settings
And GOOGLE_CALENDAR_ID environment variable is set to "env-calendar"
When an entry is classified with create_calendar_event: true
Then the event is created on calendar "env-calendar"
```

### Group 3: Classification Prompt & LLM Routing

**TS-3.1: Classification prompt includes calendar names in multi-calendar mode**

```
Given `google_calendars` is set to '{"Personal": "primary", "Alma": "alma@group.calendar.google.com"}'
When the classification prompt is constructed
Then the prompt includes the available calendar names: "Personal", "Alma"
And the prompt instructs the LLM to select one of these names
```

**TS-3.2: Classification output includes calendar_name field**

```
Given multi-calendar is active with calendars "Personal" and "Alma"
When classification returns create_calendar_event: true, calendar_date: "2026-04-15", calendar_name: "Alma"
Then the calendar_name "Alma" is extracted from the classification result
```

**TS-3.3: calendar_name not in prompt for single-calendar mode**

```
Given `google_calendars` is not set
And `google_calendar_id` is set to "primary"
When the classification prompt is constructed
Then the prompt does not include calendar name instructions
And the classification output has 8 fields (no calendar_name)
```

### Group 4: Event Creation with Calendar Routing

**TS-4.1: Event created on LLM-selected calendar**

```
Given multi-calendar is active with "Personal" → "primary" and "Alma" → "alma@group.calendar.google.com"
And classification returns create_calendar_event: true, calendar_date: "2026-04-15", calendar_name: "Alma"
When the calendar event is created
Then the Google Calendar API is called with calendar ID "alma@group.calendar.google.com"
```

**TS-4.2: google_calendar_target stored on entry after creation**

```
Given multi-calendar is active with "Alma" → "alma@group.calendar.google.com"
And classification returns create_calendar_event: true, calendar_name: "Alma"
When the calendar event is created successfully
Then the entry's google_calendar_target column is set to "alma@group.calendar.google.com"
And the entry's google_calendar_event_id is set to the returned event ID
```

**TS-4.3: Fallback to default calendar on invalid calendar_name**

```
Given multi-calendar is active with "Personal" → "primary" and "Alma" → "alma@group.calendar.google.com"
And the default calendar is "Personal"
And classification returns create_calendar_event: true, calendar_name: "NonExistent"
When the calendar event is created
Then the event is created on calendar "primary" (the default)
And a warning is logged about the unrecognized calendar name
```

**TS-4.4: Single-calendar mode does not populate google_calendar_target**

```
Given `google_calendar_id` is set to "primary"
And `google_calendars` is not set
And classification returns create_calendar_event: true
When the calendar event is created
Then the event is created on calendar "primary"
And the entry's google_calendar_target remains null
```

### Group 5: Event Updates and Deletes

**TS-5.1: Update uses stored google_calendar_target**

```
Given an entry exists with google_calendar_event_id: "evt-123" and google_calendar_target: "alma@group.calendar.google.com"
And multi-calendar is active
When reclassification returns create_calendar_event: true, calendar_name: "Alma"
Then the Google Calendar update API is called with calendar ID "alma@group.calendar.google.com" and event ID "evt-123"
```

**TS-5.2: Calendar change deletes old event and creates new one**

```
Given an entry exists with google_calendar_event_id: "evt-123" and google_calendar_target: "primary"
And multi-calendar is active with "Personal" → "primary" and "Alma" → "alma@group.calendar.google.com"
When reclassification returns create_calendar_event: true, calendar_name: "Alma"
Then the old event "evt-123" is deleted from calendar "primary"
And a new event is created on calendar "alma@group.calendar.google.com"
And the entry's google_calendar_event_id is updated to the new event ID
And the entry's google_calendar_target is updated to "alma@group.calendar.google.com"
```

**TS-5.3: Soft-delete uses stored google_calendar_target**

```
Given an entry exists with google_calendar_event_id: "evt-456" and google_calendar_target: "alma@group.calendar.google.com"
When the entry is soft-deleted
Then the Google Calendar delete API is called with calendar ID "alma@group.calendar.google.com" and event ID "evt-456"
```

**TS-5.4: Null google_calendar_target falls back to default calendar**

```
Given an entry exists with google_calendar_event_id: "evt-789" and google_calendar_target: null
And `google_calendar_id` is set to "primary"
When the entry is soft-deleted
Then the Google Calendar delete API is called with calendar ID "primary" and event ID "evt-789"
```

### Group 6: Constraints

**TS-6.1: All calendars use shared OAuth credentials**

```
Given multi-calendar is active with "Personal" → "primary" and "Alma" → "alma@group.calendar.google.com"
When events are created on both calendars
Then both API calls use the same access token from the shared OAuth credentials
```

### Group 7: Edge Cases

**TS-7.1: Unrecognized calendar_name uses default calendar**

```
Given multi-calendar is active with "Personal" → "primary" and "Alma" → "alma@group.calendar.google.com"
And the default calendar is "Personal"
And classification returns calendar_name: "Unknown"
When the calendar event is created
Then the event is created on calendar "primary"
And a warning is logged
```

**TS-7.2: calendar_name in single-calendar mode is ignored**

```
Given `google_calendar_id` is set to "primary"
And `google_calendars` is not set
And classification somehow returns calendar_name: "SomeCalendar"
When the calendar event is created
Then the event is created on calendar "primary"
And the calendar_name field is ignored
```

**TS-7.3: Removed calendar — existing events still manageable**

```
Given an entry was created with google_calendar_target: "alma@group.calendar.google.com"
And the "Alma" calendar is later removed from google_calendars
When the entry is reclassified with create_calendar_event: true
Then the system uses the stored google_calendar_target to update the event on "alma@group.calendar.google.com"
```

**TS-7.4: Renamed calendar — existing events unaffected**

```
Given an entry was created with google_calendar_target: "alma@group.calendar.google.com"
And the calendar name is changed from "Alma" to "Alma Shared" in settings (same calendar ID)
When the entry is reclassified with create_calendar_event: true, calendar_name: "Alma Shared"
Then the system resolves "Alma Shared" to "alma@group.calendar.google.com"
And the existing event is updated (not deleted and re-created, since it's the same calendar ID)
```

**TS-7.5: Empty google_calendars falls back to single mode**

```
Given `google_calendars` is set to '{}'
And `google_calendar_id` is set to "primary"
When an entry is classified with create_calendar_event: true
Then the event is created on calendar "primary"
And no calendar_name field appears in the classification prompt
```

**TS-7.6: Default calendar name doesn't match — use first calendar**

```
Given `google_calendars` is set to '{"Personal": "primary", "Alma": "alma@group.calendar.google.com"}'
And `google_calendar_default` is set to "Deleted Calendar"
When the system resolves the default calendar
Then "Personal" (the first entry) is used as the default
```

**TS-7.7: Entry created in single mode, user switches to multi-calendar**

```
Given an entry exists with google_calendar_event_id: "evt-old" and google_calendar_target: null
And the user switches from single-calendar to multi-calendar mode
And the default calendar maps to the same calendar ID as the old google_calendar_id
When the entry is reclassified with create_calendar_event: true
Then the system falls back to the default calendar (AC-5.4) for the update
And the update targets the correct Google Calendar
```

## Traceability

All 20 acceptance criteria (AC-1.1 through AC-5.4) are covered by at least one test scenario. All 5 constraints are covered (C-1 by TS-6.1, C-2 by TS-1.2, C-3 by TS-4.2/TS-4.4, C-4 by TS-3.3, C-5 by TS-2.4). All 8 edge cases (EC-1 through EC-8) are covered by scenarios TS-7.1 through TS-7.7, with EC-7 covered by TS-5.2. No orphan scenarios — every test traces to a spec requirement.
