# Multi-Calendar Support - Test Implementation Specification

## Test Framework & Conventions

- **Stack:** TypeScript / Node.js
- **Test framework:** Vitest (project standard)
- **Assertion style:** `expect()` from Vitest
- **Mocking:** `vi.mock()` hoisted pattern, `vi.fn()` for mock functions, `vi.stubGlobal("fetch", mockFetchFn)` for Google API calls
- **Env isolation:** `withEnv()` from `tests/helpers/env.ts`
- **Integration DB:** Testcontainers with `pgvector/pgvector:pg16` via `tests/helpers/test-db.ts`
- **Globals:** `false` — import `describe`, `it`, `expect`, `vi`, `beforeAll`, `beforeEach`, `afterEach`, `afterAll` from `vitest`
- **Naming:** `TS-X.Y: <behavior description>` matching the test specification IDs

## Test Structure

### Files

| File | Type | Scenarios |
|------|------|-----------|
| `tests/unit/multi-calendar.test.ts` | Unit | 22 tests — config resolution, calendar routing, prompt construction, event creation/update/delete with multi-calendar, settings UI validation, edge cases |
| `tests/integration/multi-calendar-integration.test.ts` | Integration | 5 tests — DB persistence of `google_calendar_target`, settings JSON storage, soft-delete with target, calendar change with real DB |

### Grouping

```
// Unit file
describe("Multi-Calendar")
  describe("Settings Configuration")        // TS-1.x
  describe("Backward Compatibility")        // TS-2.x
  describe("Classification Prompt")         // TS-3.x
  describe("Event Creation Routing")        // TS-4.x
  describe("Event Updates and Deletes")     // TS-5.x
  describe("Constraints")                   // TS-6.x
  describe("Edge Cases")                    // TS-7.x

// Integration file
describe("Multi-Calendar Integration")
  describe("Settings Persistence")          // TS-1.2, TS-1.3
  describe("Event Target Tracking")         // TS-4.2, TS-5.2, TS-5.3
```

## Module Architecture (for mocking)

The multi-calendar feature extends existing modules. Key functions to test:

- **`src/google-calendar.ts`** — Extended:
  - `resolveCalendarConfig(sql?)` — Now also resolves `google_calendars` JSON and `google_calendar_default`
  - `resolveCalendarId(config, calendarName?)` — New: looks up calendar ID from name, with fallback to default
  - `processCalendarEvent(sql, entryId, classificationResult)` — Extended: accepts `calendar_name`, stores `google_calendar_target`
  - `handleEntryCalendarCleanup(sql, entryId)` — Extended: uses `google_calendar_target` to identify correct calendar

- **`src/classify.ts`** — Extended:
  - `buildPrompt()` or prompt template — conditionally includes calendar name instructions when multi-calendar active
  - `parseClassificationResponse()` — Extracts `calendar_name` when present

- **`src/web/settings.ts`** — Extended:
  - Renders multi-calendar editor in Google Calendar section
  - Validates and persists `google_calendars` JSON and `google_calendar_default`

## Test Scenario Mapping

### Unit Tests (`tests/unit/multi-calendar.test.ts`)

| TS ID | Scenario Title | Test Function | Setup/Action/Assert |
|-------|---------------|---------------|---------------------|
| TS-1.1 | Configure multiple named calendars | `it("TS-1.1: renders named calendars editor in settings")` | **Setup:** Mock settings with `google_calendars` JSON. Build settings app. **Action:** GET /settings. **Assert:** Response HTML contains calendar name inputs for each configured calendar. |
| TS-1.4 | Reject duplicate calendar names | `it("TS-1.4: rejects duplicate calendar names")` | **Setup:** Build settings app. **Action:** POST /settings with duplicate names in form. **Assert:** Response indicates validation error; settings not saved. |
| TS-1.5 | Reject empty calendar name or ID | `it("TS-1.5: rejects empty calendar name or ID")` | **Setup:** Build settings app. **Action:** POST /settings with empty name, then empty ID. **Assert:** Validation error for each case. |
| TS-1.6 | At least one calendar required | `it("TS-1.6: rejects empty calendars in multi-calendar mode")` | **Setup:** Build settings app with existing multi-calendar config. **Action:** POST /settings with empty calendars JSON. **Assert:** Validation error. |
| TS-2.1 | Legacy single-calendar config | `it("TS-2.1: uses google_calendar_id when google_calendars not set")` | **Setup:** `mockGetAllSettings` returns `{ google_calendar_id: "primary" }`. **Action:** Call `resolveCalendarConfig(sql)`. **Assert:** `config.calendarId === "primary"`, no multi-calendar behavior. |
| TS-2.2 | Multi-calendar takes precedence | `it("TS-2.2: google_calendars takes precedence over google_calendar_id")` | **Setup:** Settings have both `google_calendar_id: "old"` and `google_calendars: '{"Personal":"primary"}'`. **Action:** Resolve config. **Assert:** Multi-calendar config is used, `google_calendar_id` ignored. |
| TS-2.3 | Single entry = single mode | `it("TS-2.3: single entry in google_calendars acts as single mode")` | **Setup:** Settings have `google_calendars: '{"Personal":"primary"}'` (1 entry). **Action:** Construct classification prompt. **Assert:** Prompt does not include calendar name instructions. Event created on "primary". |
| TS-2.4 | GOOGLE_CALENDAR_ID env var fallback | `it("TS-2.4: falls back to GOOGLE_CALENDAR_ID env var")` | **Setup:** `withEnv({ GOOGLE_CALENDAR_ID: "env-cal" })`. No settings. **Action:** Resolve config. **Assert:** `calendarId === "env-cal"`. |
| TS-3.1 | Prompt includes calendar names | `it("TS-3.1: classification prompt includes calendar names in multi-calendar mode")` | **Setup:** Settings with `google_calendars: '{"Personal":"primary","Alma":"alma@group..."}'`. **Action:** Build classification prompt. **Assert:** Prompt text contains "Personal" and "Alma" as calendar choices. |
| TS-3.2 | Classification output includes calendar_name | `it("TS-3.2: parses calendar_name from classification output")` | **Setup:** Raw classification JSON including `"calendar_name":"Alma"`. **Action:** Parse classification response. **Assert:** Result has `calendar_name: "Alma"`. |
| TS-3.3 | calendar_name not in single mode prompt | `it("TS-3.3: prompt omits calendar_name in single-calendar mode")` | **Setup:** Settings with only `google_calendar_id: "primary"`. **Action:** Build classification prompt. **Assert:** Prompt does not mention calendar name selection. Output expects 8 fields. |
| TS-4.1 | Event on LLM-selected calendar | `it("TS-4.1: creates event on LLM-selected calendar ID")` | **Setup:** Multi-calendar config. Mock fetch for Google Calendar API. **Action:** Call `processCalendarEvent` with `calendar_name: "Alma"`. **Assert:** Fetch called with URL containing `alma@group...` calendar ID. |
| TS-4.3 | Fallback to default on invalid name | `it("TS-4.3: falls back to default calendar on unrecognized calendar_name")` | **Setup:** Multi-calendar with default "Personal". **Action:** `processCalendarEvent` with `calendar_name: "NonExistent"`. **Assert:** Event created on "primary" (default calendar ID). Warning logged. |
| TS-4.4 | Single mode: no target stored | `it("TS-4.4: does not populate google_calendar_target in single-calendar mode")` | **Setup:** Single-calendar config. Mock SQL and fetch. **Action:** `processCalendarEvent`. **Assert:** SQL UPDATE sets `google_calendar_event_id` but not `google_calendar_target`. |
| TS-5.1 | Update uses stored target | `it("TS-5.1: update uses stored google_calendar_target")` | **Setup:** Mock SQL returns entry with `google_calendar_target: "alma@group..."`. Mock fetch. **Action:** `processCalendarEvent` (reclassification, same calendar). **Assert:** PATCH request targets `alma@group...` calendar ID. |
| TS-5.2 | Calendar change = delete + create | `it("TS-5.2: calendar change deletes old event and creates new one")` | **Setup:** Entry has `google_calendar_target: "primary"`, `google_calendar_event_id: "evt-123"`. **Action:** `processCalendarEvent` with `calendar_name: "Alma"`. **Assert:** DELETE for "evt-123" on "primary", POST on "alma@group...", SQL updates both columns. |
| TS-5.3 | Soft-delete uses stored target | `it("TS-5.3: soft-delete uses stored google_calendar_target")` | **Setup:** Mock SQL returns entry with `google_calendar_target: "alma@group..."` and `google_calendar_event_id: "evt-456"`. **Action:** `handleEntryCalendarCleanup`. **Assert:** DELETE request targets `alma@group...` calendar. |
| TS-5.4 | Null target falls back | `it("TS-5.4: null google_calendar_target falls back to default")` | **Setup:** Entry with `google_calendar_target: null`, `google_calendar_event_id: "evt-789"`. Config has `calendarId: "primary"`. **Action:** `handleEntryCalendarCleanup`. **Assert:** DELETE request targets "primary". |
| TS-6.1 | Shared OAuth credentials | `it("TS-6.1: all calendars use same access token")` | **Setup:** Multi-calendar config. Mock fetch. **Action:** Create events on two different calendars. **Assert:** Both requests use same `Authorization: Bearer` token. |
| TS-7.1 | Unrecognized name → default | Same as TS-4.3 (alias) | Covered by TS-4.3. |
| TS-7.2 | calendar_name in single mode ignored | `it("TS-7.2: ignores calendar_name when in single-calendar mode")` | **Setup:** Single-calendar config. **Action:** `processCalendarEvent` with `calendar_name: "SomeCalendar"`. **Assert:** Event created on single calendar. `calendar_name` ignored. |
| TS-7.5 | Empty google_calendars = single mode | `it("TS-7.5: empty google_calendars falls back to google_calendar_id")` | **Setup:** Settings `google_calendars: '{}'`, `google_calendar_id: "primary"`. **Action:** Resolve config. **Assert:** Single-calendar mode with "primary". |
| TS-7.6 | Default doesn't match → first | `it("TS-7.6: uses first calendar when default name is invalid")` | **Setup:** Multi-calendar with `google_calendar_default: "Deleted"`. **Action:** Resolve default calendar. **Assert:** Returns first entry from `google_calendars`. |

### Integration Tests (`tests/integration/multi-calendar-integration.test.ts`)

| TS ID | Scenario Title | Test Function | Setup/Action/Assert |
|-------|---------------|---------------|---------------------|
| TS-1.2 | Calendars stored as JSON | `it("TS-1.2: persists google_calendars as JSON in settings table")` | **Setup:** Start testcontainer, run migrations, login. **Action:** POST /settings with calendars form data. **Assert:** Query `settings` table for `google_calendars` key, verify JSON content. |
| TS-1.3 | Default calendar designation | `it("TS-1.3: persists google_calendar_default in settings table")` | **Setup:** Same as TS-1.2. **Action:** POST /settings with default designation. **Assert:** Query `settings` for `google_calendar_default` key. |
| TS-4.2 | google_calendar_target stored on entry | `it("TS-4.2: stores google_calendar_target on entry after creation")` | **Setup:** Insert entry, insert multi-calendar settings, mock fetch for Google API. **Action:** Call `processCalendarEvent` with `calendar_name`. **Assert:** Query entry row, verify `google_calendar_target` column set to resolved calendar ID. |
| TS-5.2b | Calendar change with real DB | `it("TS-5.2: calendar change updates both columns in DB")` | **Setup:** Insert entry with `google_calendar_event_id` and `google_calendar_target`. Mock fetch for delete + create. **Action:** `processCalendarEvent` with different `calendar_name`. **Assert:** Query entry row, verify both columns updated. |
| TS-5.3b | Soft-delete with target | `it("TS-5.3: soft-delete uses google_calendar_target from DB")` | **Setup:** Insert entry with `google_calendar_target`. Mock fetch. **Action:** `handleEntryCalendarCleanup`. **Assert:** Delete API called with correct calendar ID from `google_calendar_target`. |
| TS-7.3 | Removed calendar existing events | `it("TS-7.3: events on removed calendar still manageable via stored target")` | **Setup:** Insert entry with `google_calendar_target: "alma@group..."`. Remove "Alma" from settings. Mock fetch. **Action:** Reclassify or delete. **Assert:** API call uses stored target ID, not resolved from settings. |
| TS-7.4 | Renamed calendar existing events | `it("TS-7.4: renamed calendar resolves same ID, updates not delete+create")` | **Setup:** Insert entry with `google_calendar_target: "alma@group..."`. Rename "Alma" → "Alma Shared" in settings (same calendar ID). Mock fetch. **Action:** `processCalendarEvent` with `calendar_name: "Alma Shared"`. **Assert:** PATCH (update), not DELETE+POST, since resolved ID matches stored target. |
| TS-7.7 | Single→multi transition | `it("TS-7.7: legacy entry with null target falls back correctly after multi-calendar switch")` | **Setup:** Insert entry with `google_calendar_event_id` set, `google_calendar_target: null`. Configure multi-calendar settings. **Action:** Reclassify. **Assert:** Fallback to default calendar for the update. |

## Fixtures & Test Data

### Shared Factories (unit file)

**`createMockMultiCalendarSettings(overrides?)`** — Factory for settings with multi-calendar config:
```typescript
{
  google_calendars: '{"Personal":"primary","Alma":"alma@group.calendar.google.com"}',
  google_calendar_default: "Personal",
  google_access_token: "test-access-token",
  google_refresh_token: "test-refresh-token",
  google_client_id: "test-client-id",
  google_client_secret: "test-client-secret",
}
```

**`createMockSingleCalendarSettings(overrides?)`** — Factory for legacy single-calendar settings:
```typescript
{
  google_calendar_id: "primary",
  google_access_token: "test-access-token",
  google_refresh_token: "test-refresh-token",
  google_client_id: "test-client-id",
  google_client_secret: "test-client-secret",
}
```

**Reuse existing factories** from the google-calendar unit tests:
- `createMockCalendarConfig(overrides?)` — extended to optionally include `calendars` map
- `createCalendarEventParams(overrides?)` — unchanged
- `createGoogleEventResponse(overrides?)` — unchanged

### Mock Setup (unit file)

Same hoisted mock pattern as the existing google-calendar tests:

```
vi.stubGlobal("fetch", mockFetchFn)

vi.mock("../../src/web/settings-queries.js", ...)
vi.mock("../../src/classify.js", ...)         // For prompt construction tests
vi.mock("../../src/embed.js", ...)
```

For tests that need to call real functions (config resolution, calendar routing):
```
const real = await vi.importActual<typeof import("../../src/google-calendar.js")>("../../src/google-calendar.js");
```

### Mock SQL (unit file)

`mockSql` configured per test to return entry rows with `google_calendar_target` and `google_calendar_event_id` as needed. Example for TS-5.2:
```typescript
mockSql.mockResolvedValueOnce([{
  id: "uuid-42",
  name: "Meeting",
  content: "Meeting content",
  google_calendar_event_id: "evt-123",
  google_calendar_target: "primary",
}]);
```

### Integration Helpers

**`insertSetting(sql, key, value)`** — Reuse from existing integration tests.

**`insertEntry(sql, overrides)`** — Extended to accept `google_calendar_target` in overrides:
```typescript
const entryId = await insertEntry(sql, {
  google_calendar_event_id: "evt-123",
  google_calendar_target: "alma@group.calendar.google.com",
});
```

This requires the DB migration adding `google_calendar_target` to the entries table to have run. The `runMigrations(sql)` helper handles this.

### Fetch Mock Patterns

For multi-calendar tests, the URL includes the calendar ID. Assert the correct calendar ID in the URL:
```typescript
expect(mockFetchFn).toHaveBeenCalledWith(
  expect.stringContaining(`/calendars/${encodeURIComponent("alma@group.calendar.google.com")}/events`),
  expect.objectContaining({ method: "POST" }),
);
```

For TS-5.2 (calendar change), assert two calls: DELETE on old calendar, POST on new:
```typescript
const calls = mockFetchFn.mock.calls;
const deleteCall = calls.find(c => c[1]?.method === "DELETE");
const postCall = calls.find(c => c[1]?.method === "POST");
expect(deleteCall[0]).toContain("/calendars/primary/events/evt-123");
expect(postCall[0]).toContain(`/calendars/${encodeURIComponent("alma@group.calendar.google.com")}/events`);
```

## Alignment Check

**Full alignment.** Every test scenario from the test specification is mapped:

- TS-1.1 through TS-1.6: 4 unit tests + 2 integration tests (TS-1.4/1.5/1.6 are unit validation; TS-1.2/1.3 are integration DB persistence; TS-1.1 is unit settings rendering)
- TS-2.1 through TS-2.4: 4 unit tests (config resolution logic)
- TS-3.1 through TS-3.3: 3 unit tests (prompt construction and parsing)
- TS-4.1 through TS-4.4: 3 unit tests + 1 integration test (routing and target storage)
- TS-5.1 through TS-5.4: 4 unit tests + 3 integration tests (update/delete with target)
- TS-6.1: 1 unit test (shared credentials)
- TS-7.1 through TS-7.7: 4 unit tests + 3 integration tests (TS-7.1 covered by TS-4.3; TS-7.2/7.5/7.6 unit; TS-7.3/7.4/7.7 integration)

**Total: 22 unit tests + 8 integration tests = 30 tests**

All tests will fail initially because:
- The `google_calendar_target` column does not exist yet
- `resolveCalendarConfig` does not read `google_calendars` yet
- `processCalendarEvent` does not accept `calendar_name` yet
- The classification prompt does not include calendar names
- Settings UI has no multi-calendar editor
