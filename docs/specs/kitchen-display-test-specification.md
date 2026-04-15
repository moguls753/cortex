# Kitchen Display — Test Specification

Test scenarios derived from `kitchen-display-specification.md`. Each scenario traces back to a specific acceptance criterion, constraint, edge case, or non-goal in the behavioral spec. Scenarios are written in Given/When/Then format and describe observable behavior, not implementation mechanics.

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|---|---|
| AC-1.1 | TS-1.1 |
| AC-1.2 | TS-1.2, TS-1.3 |
| AC-1.3 | TS-1.4 |
| AC-2.1 | TS-2.1 |
| AC-2.2 | TS-2.2, TS-2.3 |
| AC-2.3 | TS-2.4, TS-2.5 |
| AC-2.4 | TS-2.6 |
| AC-3.1 | TS-3.1 |
| AC-3.2 | TS-3.2, TS-3.3, TS-3.4 |
| AC-3.3 | TS-3.5 |
| AC-3.4 | TS-3.6 |
| AC-4.1 | TS-4.1 |
| AC-4.2 | TS-4.2 |
| AC-4.3 | TS-4.3, TS-4.4, TS-4.5, TS-4.6 |
| AC-4.4 | TS-4.7, TS-4.8 |
| AC-4.5 | TS-4.9, TS-4.10 |
| AC-4.6 | TS-4.11 |
| AC-5.1 | TS-5.1 |
| AC-5.2 | TS-5.2, TS-5.3, TS-5.4 |
| AC-5.3 | TS-5.5 |
| AC-5.4 | TS-5.6, TS-5.7 |
| AC-5.5 | TS-5.8 |
| AC-5.6 | TS-5.9 |
| AC-5.7 | TS-5.10 |
| AC-6.1 | TS-6.1, TS-6.2 |
| AC-6.2 | TS-6.3, TS-6.4 |
| AC-6.3 | TS-6.5 |
| AC-6.4 | TS-6.6 (decision table) |
| AC-6.5 | TS-6.7, TS-6.8 |
| AC-6.6 | TS-6.9 |
| AC-7.1 | TS-7.1 |
| AC-7.2 | TS-7.2 |
| AC-7.3 | TS-7.3, TS-7.4 |
| AC-7.4 | TS-7.5, TS-7.6, TS-7.7 |
| AC-7.5 | TS-7.8 |
| AC-7.6 | TS-7.9 (decision table) |
| AC-7.7 | TS-7.10 |
| AC-8.1 | TS-8.1 |
| AC-8.2 | TS-8.2 |
| AC-8.3 | TS-8.3, TS-8.4 |
| C-1 | TS-C-1 (structural) |
| C-2 | TS-C-2 |
| C-3 | TS-C-3 |
| C-5 | covered by TS-8.2 |
| C-8 | covered by TS-5.1 |
| C-9 | covered by onboarding spec tests — cross-referenced |
| E-1 | TS-E-1 (= TS-8.2) |
| E-2 | TS-E-2 |
| E-3 | TS-E-3 |
| E-4 | covered by TS-5.7 |
| E-5 | TS-E-5 |
| E-6 | covered by TS-7.10 |
| E-7 | TS-E-7 |
| E-8 | TS-E-8 |
| E-9 | covered by TS-3.2 / TS-3.3 |
| E-10 | covered by TS-3.5 |
| E-11 | covered by TS-7.6 / TS-7.7 |
| E-12 | TS-E-12 |
| NG-1 | TS-NG-1 |
| NG-7 | covered by TS-2.3 |
| NG-8 | TS-NG-8 (negative: no rate limit applied) |

---

## Test Scenarios

### US-1: Feature disabled by default

#### TS-1.1: Default display_enabled value is not "true"
```
Given a freshly initialized Cortex instance with no display-related settings rows
When the settings table is queried for the display_enabled key
Then either the row is absent, or its value is the string "false"
```
_Covers AC-1.1._

#### TS-1.2: PNG endpoint returns 404 when feature is disabled
```
Given the display_enabled setting is absent or set to "false"
When a GET request is made to /api/kitchen.png
Then the response status is 404
And the response body is "Not Found"
And no rendering is attempted
```
_Covers AC-1.2._

#### TS-1.3: Display adapter returns 404 when feature is disabled
```
Given the display_enabled setting is absent or set to "false"
When a GET request is made to /api/display
Then the response status is 404
And the response body is "Not Found"
```
_Covers AC-1.2._

#### TS-1.4: Enabling the feature makes both endpoints reachable immediately
```
Given the display_enabled setting is "false"
And a GET to /api/kitchen.png has just returned 404
When the display_enabled setting is updated to "true"
And a new GET request is made to /api/kitchen.png
Then the response status is 200
And the server process was not restarted between the two requests
```
_Covers AC-1.3._

---

### US-2: PNG endpoint

#### TS-2.1: Enabled endpoint returns a PNG image
```
Given the display_enabled setting is "true"
And no display_token is set
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the response body is a non-empty binary payload
```
_Covers AC-2.1._

#### TS-2.2: Response declares image/png Content-Type
```
Given the display_enabled setting is "true"
When a GET request is made to /api/kitchen.png
Then the response Content-Type header is "image/png"
```
_Covers AC-2.2._

#### TS-2.3: Response declares Cache-Control no-cache
```
Given the display_enabled setting is "true"
When a GET request is made to /api/kitchen.png
Then the response Cache-Control header is "no-cache"
```
_Covers AC-2.2 and NG-7 (no HTTP-level caching)._

#### TS-2.4: Rendered image uses dimensions from settings
```
Given display_enabled is "true"
And display_width is "1200"
And display_height is "800"
When a GET request is made to /api/kitchen.png
Then the renderer is invoked with width 1200 and height 800
```
_Covers AC-2.3._

#### TS-2.5: Default dimensions used when settings are absent
```
Given display_enabled is "true"
And display_width and display_height are absent
When a GET request is made to /api/kitchen.png
Then the renderer is invoked with width 1872 and height 1404
```
_Covers AC-2.3._

#### TS-2.6: Rendering exception returns HTTP 500
```
Given display_enabled is "true"
And the rendering pipeline throws an exception on the next call
When a GET request is made to /api/kitchen.png
Then the response status is 500
And the response body is "Internal Server Error"
And an error-level log entry is emitted from the "display" module with the exception message
```
_Covers AC-2.4._

---

### US-3: Optional token authentication

#### TS-3.1: No token required when display_token is empty
```
Given display_enabled is "true"
And display_token is absent or an empty string
When a GET request to /api/kitchen.png is made with no token query parameter
Then the response status is 200
```
_Covers AC-3.1._

#### TS-3.2: Missing token returns 403 when token is required
```
Given display_enabled is "true"
And display_token is set to a non-empty string
When a GET request to /api/kitchen.png is made with no token query parameter
Then the response status is 403
And the response body is "Forbidden"
```
_Covers AC-3.2 and E-9._

#### TS-3.3: Wrong token returns 403
```
Given display_enabled is "true"
And display_token is set to "correct-secret"
When a GET request to /api/kitchen.png?token=wrong-secret is made
Then the response status is 403
And the response body is "Forbidden"
```
_Covers AC-3.2._

#### TS-3.4: Correct token returns 200
```
Given display_enabled is "true"
And display_token is set to "correct-secret"
When a GET request to /api/kitchen.png?token=correct-secret is made
Then the response status is 200
```
_Covers AC-3.2._

#### TS-3.5: Token comparison is constant-time
```
Given display_enabled is "true"
And display_token is set to a non-empty string
When the token comparison path is exercised with a mismatching provided token
Then the comparison uses a constant-time primitive (e.g., a crypto-standard timingSafeEqual)
And no short-circuit branching occurs on the first differing byte
```
_Covers AC-3.3 and E-10._
_Verification note: this scenario is structural — verified in Phase 6 review by inspecting the comparison call site, not by an observable timing assertion in a unit test (which would be flaky)._

#### TS-3.6: /api/display does not enforce the token
```
Given display_enabled is "true"
And display_token is set to a non-empty string
When a GET request to /api/display is made with no token query parameter
Then the response status is 200
And the response body contains an image_url field
```
_Covers AC-3.4._

---

### US-4: TRMNL BYOS adapter

#### TS-4.1: Adapter returns JSON with image_url and filename
```
Given display_enabled is "true"
When a GET request is made to /api/display
Then the response status is 200
And the response Content-Type is "application/json"
And the response body parses as JSON with exactly the keys "image_url" and "filename"
```
_Covers AC-4.1._

#### TS-4.2: filename is the literal "cortex-kitchen"
```
Given display_enabled is "true"
When a GET request is made to /api/display
Then the filename field in the response body is "cortex-kitchen"
```
_Covers AC-4.2._

#### TS-4.3: image_url uses the Host header and /api/kitchen.png path
```
Given display_enabled is "true"
And the request carries Host "cortex.local:3000"
And no X-Forwarded-Proto header is present
When a GET request is made to /api/display
Then image_url is "http://cortex.local:3000/api/kitchen.png"
```
_Covers AC-4.3._

#### TS-4.4: image_url honors X-Forwarded-Proto when present
```
Given display_enabled is "true"
And the request carries Host "cortex.example.com"
And the request carries X-Forwarded-Proto "https"
When a GET request is made to /api/display
Then image_url starts with "https://cortex.example.com/api/kitchen.png"
```
_Covers AC-4.3._

#### TS-4.5: image_url defaults to http scheme when no X-Forwarded-Proto
```
Given display_enabled is "true"
And the request carries Host "cortex.local"
And no X-Forwarded-Proto header is present
When a GET request is made to /api/display
Then image_url starts with "http://"
```
_Covers AC-4.3._

#### TS-4.6: image_url falls back to localhost when Host is absent
```
Given display_enabled is "true"
And no Host header is present on the request
When a GET request is made to /api/display
Then image_url is "http://localhost/api/kitchen.png"
```
_Covers AC-4.3._

#### TS-4.7: image_url includes ?token= when display_token is set
```
Given display_enabled is "true"
And display_token is "secret-123"
When a GET request is made to /api/display
Then image_url ends with "?token=secret-123"
```
_Covers AC-4.4._

#### TS-4.8: image_url omits ?token= when display_token is empty
```
Given display_enabled is "true"
And display_token is absent or empty
When a GET request is made to /api/display
Then image_url does not contain a "token=" query parameter
```
_Covers AC-4.4._

#### TS-4.9: display_base_url overrides the header-derived prefix
```
Given display_enabled is "true"
And display_base_url is "https://proxy.example.com"
And the request carries Host "internal-container:3000"
When a GET request is made to /api/display
Then image_url is "https://proxy.example.com/api/kitchen.png"
And the Host header is ignored
```
_Covers AC-4.5._

#### TS-4.10: display_base_url tolerates a trailing slash
```
Given display_enabled is "true"
And display_base_url is "https://proxy.example.com/"
When a GET request is made to /api/display
Then image_url is "https://proxy.example.com/api/kitchen.png"
And there is exactly one "/" between the base and "api/kitchen.png"
```
_Covers AC-4.5._

#### TS-4.11: Adapter returns 404 when feature is disabled
```
Given display_enabled is "false"
When a GET request is made to /api/display
Then the response status is 404
```
_Covers AC-4.6._

---

### US-5: Calendar events

#### TS-5.1: Today events queried in configured timezone
```
Given display_enabled is "true"
And a Google Calendar is configured with an OAuth refresh token
And the timezone setting is "America/Los_Angeles"
When a GET request is made to /api/kitchen.png
Then the Google Calendar events.list query uses timeMin at 00:00 local time in America/Los_Angeles
And uses timeMax at 23:59 local time in America/Los_Angeles
```
_Covers AC-5.1 and C-8._

#### TS-5.2: display_calendars filter restricts the result set
```
Given display_enabled is "true"
And two Google Calendars are configured with display names "FAMILY" and "WORK"
And display_calendars is the JSON string '["FAMILY"]'
When a GET request is made to /api/kitchen.png
Then only events from the "FAMILY" calendar appear in the rendered output
And no events from the "WORK" calendar are fetched or rendered
```
_Covers AC-5.2._

#### TS-5.3: Empty display_calendars array means all calendars
```
Given display_enabled is "true"
And two Google Calendars are configured
And display_calendars is the JSON string "[]"
When a GET request is made to /api/kitchen.png
Then events from both calendars appear in the rendered output
```
_Covers AC-5.2._

#### TS-5.4: Absent display_calendars setting means all calendars
```
Given display_enabled is "true"
And two Google Calendars are configured
And display_calendars is absent from the settings table
When a GET request is made to /api/kitchen.png
Then events from both calendars appear in the rendered output
```
_Covers AC-5.2._

#### TS-5.5: Each event row shows HH:MM, name, and calendar badge
```
Given display_enabled is "true"
And a single event exists today at 09:30 named "Standup" on the "WORK" calendar
When a GET request is made to /api/kitchen.png
Then the rendered today-section contains a row with time "09:30", name "Standup", and a calendar badge labeled "WORK"
```
_Covers AC-5.3._

#### TS-5.6: display_max_today_events caps the rendered count
```
Given display_enabled is "true"
And display_max_today_events is "5"
And 12 events exist for today
When a GET request is made to /api/kitchen.png
Then the rendered today-section contains exactly 5 event rows
```
_Covers AC-5.4._

#### TS-5.7: Overflow line reads "+N more"
```
Given display_enabled is "true"
And display_max_today_events is "5"
And 8 events exist for today
When a GET request is made to /api/kitchen.png
Then the rendered today-section contains an overflow line reading "+3 more"
```
_Covers AC-5.4 and E-4._

#### TS-5.8: Tomorrow subsection renders up to 3 events
```
Given display_enabled is "true"
And 7 events exist for tomorrow
When a GET request is made to /api/kitchen.png
Then the rendered tomorrow subsection contains exactly 3 event rows
```
_Covers AC-5.5._

#### TS-5.9: "No events today" empty state
```
Given display_enabled is "true"
And zero events exist for today
When a GET request is made to /api/kitchen.png
Then the rendered today-section shows a centered "No events today" empty state
And no event rows are rendered
```
_Covers AC-5.6._

#### TS-5.10: Tomorrow subsection omitted entirely when empty
```
Given display_enabled is "true"
And zero events exist for tomorrow
When a GET request is made to /api/kitchen.png
Then the rendered layout does not contain any "TOMORROW" heading
And no tomorrow event rows are rendered
```
_Covers AC-5.7._

---

### US-6: Tasks

#### TS-6.1: Pending tasks appear on the display
```
Given display_enabled is "true"
And an entry exists with category "tasks", fields.status "pending", and deleted_at null
When a GET request is made to /api/kitchen.png
Then the task appears in the rendered tasks section
```
_Covers AC-6.1._

#### TS-6.2: Recently-done tasks (within 24h) appear on the display
```
Given display_enabled is "true"
And an entry exists with category "tasks", fields.status "done", and updated_at 2 hours ago
When a GET request is made to /api/kitchen.png
Then the task appears in the rendered tasks section in the done state
```
_Covers AC-6.1._
_Note: a done task with updated_at 48 hours ago does NOT appear._

#### TS-6.3: Tasks ordered by due date ascending
```
Given display_enabled is "true"
And three tasks exist: "A" due tomorrow, "B" due yesterday, "C" due in one week
When a GET request is made to /api/kitchen.png
Then the rendered order is "B", "A", "C"
```
_Covers AC-6.2._

#### TS-6.4: display_max_tasks caps the rendered count
```
Given display_enabled is "true"
And display_max_tasks is "3"
And 10 pending tasks exist
When a GET request is made to /api/kitchen.png
Then the rendered tasks section contains exactly 3 task rows
```
_Covers AC-6.2._

#### TS-6.5: Each task row shows name, due label, and checkbox
```
Given display_enabled is "true"
And a task "Buy milk" exists with fields.due_date set to 5 days in the future
When a GET request is made to /api/kitchen.png
Then the rendered task row contains the name "Buy milk", a due label, and a checkbox element
```
_Covers AC-6.3._

#### TS-6.6: Due date label decision table
```
Given display_enabled is "true"
When a task is rendered with fields.due_date set to each of the following values
Then the due label matches the expected text:

| due_date               | Expected label  |
|------------------------|-----------------|
| (null / absent)        | (no label)      |
| yesterday (past)       | "overdue"       |
| today                  | "due today"     |
| tomorrow               | "due tomorrow"  |
| 5 days from now (Apr 3)| "due Apr 3"     |
```
_Covers AC-6.4._
_Each row becomes a separate test function in Phase 3._

#### TS-6.7: Done task has line-through and filled checkbox
```
Given display_enabled is "true"
And a task with fields.status "done" and updated_at 1 hour ago
When a GET request is made to /api/kitchen.png
Then the rendered task row has text-decoration line-through on the task name
And the checkbox element is in the filled state
```
_Covers AC-6.5._

#### TS-6.8: Overdue task has bold due label
```
Given display_enabled is "true"
And a task with fields.due_date set to 3 days in the past and fields.status "pending"
When a GET request is made to /api/kitchen.png
Then the rendered task row has the due label in bold
```
_Covers AC-6.5._

#### TS-6.9: "All clear" empty state
```
Given display_enabled is "true"
And zero tasks match the query (no pending, no recently-done)
When a GET request is made to /api/kitchen.png
Then the rendered tasks section shows the centered "All clear" empty state
```
_Covers AC-6.6._

---

### US-7: Weather

#### TS-7.1: Weather fetched when lat/lng both set
```
Given display_enabled is "true"
And display_weather_lat is "52.52"
And display_weather_lng is "13.41"
When a GET request is made to /api/kitchen.png
Then a single HTTP request is made to https://api.open-meteo.com/v1/forecast
And the query string includes latitude=52.52, longitude=13.41, forecast_days=1
```
_Covers AC-7.1._

#### TS-7.2: Weather responses cached for 30 minutes
```
Given display_enabled is "true"
And lat/lng are set
And a previous GET to /api/kitchen.png completed 10 minutes ago using fresh Open-Meteo data
When a new GET request is made to /api/kitchen.png
Then no HTTP request to api.open-meteo.com is made during this second request
And the rendered weather strip uses the cached data
```
_Covers AC-7.2._

#### TS-7.3: Network error yields null and omits weather strip
```
Given display_enabled is "true"
And lat/lng are set
And the next Open-Meteo fetch throws a network error
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the rendered layout does not contain a weather strip
```
_Covers AC-7.3 and AC-7.4._

#### TS-7.4: Non-2xx response yields null and omits weather strip
```
Given display_enabled is "true"
And lat/lng are set
And the next Open-Meteo fetch returns HTTP 500
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the rendered layout does not contain a weather strip
```
_Covers AC-7.3 and AC-7.4._

#### TS-7.5: Weather strip omitted when lat is absent
```
Given display_enabled is "true"
And display_weather_lat is absent
And display_weather_lng is "13.41"
When a GET request is made to /api/kitchen.png
Then no HTTP request to api.open-meteo.com is made
And the rendered layout does not contain a weather strip
```
_Covers AC-7.4._

#### TS-7.6: Weather strip omitted when lat is unparseable
```
Given display_enabled is "true"
And display_weather_lat is "not-a-number"
And display_weather_lng is "13.41"
When a GET request is made to /api/kitchen.png
Then no HTTP request to api.open-meteo.com is made
And the rendered layout does not contain a weather strip
```
_Covers AC-7.4 and E-11._

#### TS-7.7: Weather strip omitted when lng is unparseable
```
Given display_enabled is "true"
And display_weather_lat is "52.52"
And display_weather_lng is "abc"
When a GET request is made to /api/kitchen.png
Then no HTTP request to api.open-meteo.com is made
And the rendered layout does not contain a weather strip
```
_Covers AC-7.4 and E-11._

#### TS-7.8: Weather strip shows temperature, condition, high/low, and 4 hourly slots
```
Given display_enabled is "true"
And a successful Open-Meteo response returns current temperature 12.7, daily high 15, daily low 7, and at least 4 hourly entries
When a GET request is made to /api/kitchen.png
Then the rendered weather strip contains the integer "13" (rounded current temperature)
And a condition label
And a daily high and low
And exactly 4 hourly slot rows
```
_Covers AC-7.5._

#### TS-7.9: WMO weather code mapping — decision table
```
Given display_enabled is "true"
And a successful Open-Meteo response with current weather_code set to each value below
When the weather strip is rendered
Then the condition label and icon match the expected row:

| weather_code | Expected label          | Expected icon      |
|--------------|-------------------------|--------------------|
| 0            | Clear                   | sun                |
| 1            | Mainly Clear            | cloud              |
| 2            | Partly Cloudy           | cloud              |
| 3            | Overcast                | cloud              |
| 45           | Fog                     | cloud              |
| 48           | Fog                     | cloud              |
| 51           | Drizzle                 | cloud-rain         |
| 53           | Drizzle                 | cloud-rain         |
| 55           | Drizzle                 | cloud-rain         |
| 56           | Freezing Drizzle        | cloud-rain         |
| 57           | Freezing Drizzle        | cloud-rain         |
| 61           | Rain                    | cloud-rain         |
| 63           | Rain                    | cloud-rain         |
| 65           | Rain                    | cloud-rain         |
| 66           | Freezing Rain           | cloud-rain         |
| 67           | Freezing Rain           | cloud-rain         |
| 71           | Snow                    | cloud-snow         |
| 73           | Snow                    | cloud-snow         |
| 75           | Snow                    | cloud-snow         |
| 77           | Snow Grains             | cloud-snow         |
| 80           | Rain Showers            | cloud-rain         |
| 81           | Rain Showers            | cloud-rain         |
| 82           | Rain Showers            | cloud-rain         |
| 85           | Snow Showers            | cloud-snow         |
| 86           | Snow Showers            | cloud-snow         |
| 95           | Thunderstorm            | cloud-lightning    |
| 96           | Thunderstorm with Hail  | cloud-lightning    |
| 99           | Thunderstorm with Hail  | cloud-lightning    |
```
_Covers AC-7.6. Each row becomes a separate test function in Phase 3._
_Expected gaps: rows 85, 86, 96, 99 will currently fail against existing code — see Known Gaps in the spec._

#### TS-7.10: Unknown WMO code falls back to Cloudy / cloud
```
Given display_enabled is "true"
And a successful Open-Meteo response with weather_code 999
When the weather strip is rendered
Then the condition label is "Cloudy"
And the icon is "cloud"
And the fallback does not throw
```
_Covers AC-7.7 and E-6._

---

### US-8: Graceful degradation

#### TS-8.1: Header and footer always render
```
Given display_enabled is "true"
And no data sources are configured
When a GET request is made to /api/kitchen.png
Then the rendered layout contains the "cortex" header brand text
And a date string
And a time string
And a "Last updated" footer entry
```
_Covers AC-8.1._

#### TS-8.2: All data sources empty still produces a valid PNG
```
Given display_enabled is "true"
And lat/lng are absent (no weather)
And no Google Calendars are configured
And zero tasks match the query
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the response Content-Type is "image/png"
And the body is a non-empty binary payload
And the rendered layout shows empty-state messages for today events and tasks
```
_Covers AC-8.2, C-5, E-1._

#### TS-8.3: Weather fetch failure does not prevent calendar or tasks from rendering
```
Given display_enabled is "true"
And lat/lng are set but the Open-Meteo fetch fails
And a calendar event exists for today
And a pending task exists
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the rendered layout does not contain a weather strip
And the rendered layout does contain the calendar event
And the rendered layout does contain the task row
```
_Covers AC-8.3._

#### TS-8.4: Calendar fetch failure does not prevent tasks or weather from rendering
```
Given display_enabled is "true"
And Google Calendar OAuth fails and the refresh also fails
And lat/lng are set and Open-Meteo responds successfully
And a pending task exists
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the rendered today-section shows the "No events today" empty state
And the rendered layout does contain a weather strip
And the rendered layout does contain the task row
```
_Covers AC-8.3._

---

### Edge Cases

#### TS-E-2: Google Calendar token refresh retry
```
Given display_enabled is "true"
And a Google Calendar is configured with expired access token and a valid refresh token
When a GET request is made to /api/kitchen.png
Then the calendar fetch layer performs exactly one OAuth token refresh
And after the refresh succeeds, events are rendered normally
```
_Covers E-2._

#### TS-E-3: Very long event name truncates with ellipsis
```
Given display_enabled is "true"
And a today event exists with a 200-character name
When a GET request is made to /api/kitchen.png
Then the rendered event row name applies overflow clipping with ellipsis
And the row does not wrap onto multiple lines
And the layout dimensions (width, height) are preserved
```
_Covers E-3._

#### TS-E-5: Open-Meteo unreachable with no cache omits weather
```
Given display_enabled is "true"
And the weather cache is empty
And the next Open-Meteo fetch times out
When a GET request is made to /api/kitchen.png
Then the response status is 200
And the rendered layout does not contain a weather strip
And no stale cache value is substituted
```
_Covers E-5 and NG-9._

#### TS-E-7: Invalid JSON in display_calendars is treated as no filter
```
Given display_enabled is "true"
And two Google Calendars are configured
And display_calendars is the string "not valid json {"
When a GET request is made to /api/kitchen.png
Then the response status is 200
And events from both calendars appear in the rendered output
And a warn-level log entry from the "display" module is emitted mentioning the JSON parse failure
```
_Covers E-7._

#### TS-E-8: Event with missing summary is still rendered
```
Given display_enabled is "true"
And a Google Calendar event exists today with no summary field
When a GET request is made to /api/kitchen.png
Then the event still appears in the rendered today-section
And the fetch does not throw
```
_Covers E-8._

#### TS-E-12: Invalid width/height falls back to defaults
```
Given display_enabled is "true"
And display_width is "0"
And display_height is "-50"
When a GET request is made to /api/kitchen.png
Then the renderer is invoked with the default dimensions 1872 x 1404
And the response status is 200
```
_Covers E-12._
_Expected gap: the current implementation does not re-validate the parsed integers; this scenario will fail until the code is hardened._

---

### Constraints

#### TS-C-1: Rendering pipeline uses no external rendering service
```
Given the kitchen-display module source
When dependency usage is inspected
Then no outbound HTTP requests are made to any external rendering service (e.g., Cloudinary, Puppeteer-as-a-service, Browserless)
And the PNG generation happens in-process
```
_Covers C-1. Structural — verified in Phase 6 review by dependency and call-site inspection, not by a runtime test._

#### TS-C-2: Session cookie does not gate either endpoint
```
Given display_enabled is "true"
And a session cookie for an authenticated Cortex user is attached to the request
When a GET request is made to /api/kitchen.png without a ?token= parameter, and display_token is empty
Then the response status is 200 (the session cookie is irrelevant)
```
_Covers C-2 and NG-1._
_Reverse scenario: TS-NG-1 confirms the endpoints don't require authentication even when a user exists — a request without any cookie still succeeds when display_enabled is "true" and display_token is empty._

#### TS-C-3: Each request produces a freshly rendered image
```
Given display_enabled is "true"
When two GET requests to /api/kitchen.png are made 1 second apart
Then the renderer is invoked twice
```
_Covers C-3 and NG-7._

---

### Non-Goals

#### TS-NG-1: Unauthenticated request reaches the PNG when display_token is empty and a user exists
```
Given display_enabled is "true"
And display_token is empty
And a Cortex user account exists in the user table
When an unauthenticated GET request (no session cookie) is made to /api/kitchen.png
Then the response status is 200
```
_Covers NG-1. Confirms that session-based auth does not gate display endpoints — the only protection is disabled-by-default plus the optional token._

#### TS-NG-8: No rate limiting applied by the Cortex process
```
Given display_enabled is "true"
When 100 sequential GET requests are made to /api/kitchen.png within a one-minute window
Then all 100 responses return status 200 (no HTTP 429)
And no in-process rate limiting is applied
```
_Covers NG-8 and C-6._
_Note: this is a negative scenario — implementers must NOT add rate limiting here. Rate limiting is intentionally delegated to the reverse-proxy layer._

---

## Traceability Summary

- **8 user stories** from the behavioral spec → **71 test scenarios** (TS-1.x through TS-NG-8), plus two decision tables (TS-6.6 with 5 rows, TS-7.9 with 28 rows) that expand into an additional ~33 concrete test cases in Phase 3 → ~104 total test assertions.
- Every acceptance criterion (AC-1.1 through AC-8.3) maps to at least one test scenario — see Coverage Matrix.
- Every constraint (C-1 through C-9) is either tested directly (C-1, C-2, C-3) or covered transitively by other scenarios (C-5 via TS-8.2, C-8 via TS-5.1, C-9 via the existing onboarding spec).
- Every edge case (E-1 through E-12) is either a dedicated scenario (E-2, E-3, E-5, E-7, E-8, E-12) or covered by a happy/sad-path scenario above.
- Non-goals are asserted negatively: TS-NG-1 (no session-cookie gating), TS-NG-8 (no rate limiting). NG-7 (no HTTP caching) is covered by TS-2.3.
- **No orphan scenarios**: every TS ID traces to a specific spec element.

## Known Discrepancies with Current Code

These scenarios are expected to FAIL against the current `src/display/` implementation when Phase 4 tests are written. Each corresponds to a Known Gap in the behavioral spec:

| Scenario | Reason | Known Gap |
|---|---|---|
| TS-7.9 rows for 85, 86 | Current `mapWeatherCode` has no entry — falls through to "Cloudy" | KG-1 |
| TS-7.9 rows for 96, 99 | Current `mapWeatherCode` has no entry — falls through to "Cloudy" | KG-2 |
| TS-7.9 rows for 1, 3, 56, 57, 66, 67, 77 | Current `mapWeatherCode` maps these to neighboring coarser labels | KG-2a (Phase 4 discovery) |
| TS-5.6, TS-5.7 (display_max_today_events) | Current code hardcodes `maxTodayEvents: 8` — setting doesn't exist | KG-3 |
| TS-4.9, TS-4.10 (display_base_url) | Current code doesn't read the setting | KG-4 |
| TS-E-12 (width/height validation) | Current code accepts zero/negative | KG-5 |

The Phase 6 review will confirm these failures and the implementation will be updated to close each gap.
