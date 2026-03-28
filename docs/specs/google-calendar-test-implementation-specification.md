# Google Calendar Integration - Test Implementation Specification

## Test Framework & Conventions

- **Stack:** TypeScript / Node.js
- **Test framework:** Vitest (already used across all features)
- **Assertion style:** `expect()` from Vitest
- **Mocking:** `vi.mock()` hoisted pattern, `vi.fn()` for mock functions, `vi.spyOn()` for spies
- **Env isolation:** `withEnv()` from `tests/helpers/env.ts`
- **Integration DB:** Testcontainers with `pgvector/pgvector:pg16` via `tests/helpers/test-db.ts`
- **Globals:** `false` — import `describe`, `it`, `expect`, `vi`, `beforeAll`, `beforeEach`, `afterEach`, `afterAll` from `vitest`
- **Fake timers:** Available via `vi.useFakeTimers()` for retry delay testing

## Test Structure

### Files

| File | Type | Scenarios |
|------|------|-----------|
| `tests/unit/google-calendar.test.ts` | Unit | 37 tests — calendar client, config, retry, settings UI, confirmations, duration, edge cases, constraints |
| `tests/integration/google-calendar-integration.test.ts` | Integration | 10 tests — DB flows (token storage, entry event_id, soft-delete, restore, edit) |

### Grouping

Tests are grouped by `describe` blocks matching the test specification groups:

```
describe("Google Calendar")
  describe("Event Creation")           // TS-1.x
  describe("OAuth Settings")           // TS-2.x
  describe("Confirmation Messages")    // TS-3.x
  describe("Failure Handling")         // TS-4.x
  describe("Reclassification")         // TS-5.x
  describe("Entry Deletion")           // TS-6.x (integration only)
  describe("Duration Configuration")   // TS-7.x
  describe("Edge Cases")               // TS-8.x
  describe("Constraints")              // TS-9.x
```

### Naming Convention

Test names follow: `TS-X.Y: <behavior description>` matching the test specification IDs.

## Module Architecture (for mocking)

The implementation will provide these modules (referenced in mocking setup below):

- **`src/google-calendar.ts`** — Core calendar client:
  - `resolveCalendarConfig(sql?)` — Resolve config from settings table + env vars
  - `isCalendarConfigured(sql?)` — Quick check if tokens + calendar ID exist
  - `createCalendarEvent(config, params)` — Google Calendar API: insert event
  - `updateCalendarEvent(config, eventId, params)` — Google Calendar API: patch event
  - `deleteCalendarEvent(config, eventId)` — Google Calendar API: delete event
  - `refreshAccessToken(refreshToken, clientId, clientSecret)` — OAuth2 token refresh
  - `exchangeAuthCode(code, clientId, clientSecret)` — OAuth2 auth code exchange
  - `processCalendarEvent(sql, entryId, classificationResult)` — Orchestrator: create/update/delete with retry + error handling
  - `handleEntryCalendarCleanup(sql, entryId)` — Called on soft-delete to delete linked calendar event

- **`src/google-calendar-settings.ts`** — Settings page section (or integrated into existing `src/web/settings.ts`):
  - Renders Google Calendar section in settings page
  - Handles connect/disconnect/save actions

## Fixtures & Test Data

### Shared Helpers

**`createMockCalendarConfig(overrides?)`** — Factory for calendar config object:
```typescript
{
  calendarId: "test@group.calendar.google.com",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  defaultDuration: 60,
}
```

**`createCalendarEventParams(overrides?)`** — Factory for event creation params:
```typescript
{
  name: "Meeting with Katja",
  content: "Meeting with Katja at the café",
  calendarDate: "2026-04-15",
  calendarTime: "14:00" | null,
}
```

**`createGoogleEventResponse(overrides?)`** — Factory for Google API success response:
```typescript
{ id: "google-event-123", status: "confirmed", htmlLink: "..." }
```

**`createGoogleTokenResponse(overrides?)`** — Factory for OAuth token response:
```typescript
{ access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 3600 }
```

**`mockFetch()`** — `global.fetch` mock setup for Google API calls. Returns a `vi.fn()` that can be configured per test to return specific responses for specific URLs.

### Unit Test Setup

```typescript
// Hoisted mocks
const mockFetchFn = vi.fn();
vi.stubGlobal("fetch", mockFetchFn);

// Mock settings/config resolution for unit tests
vi.mock("../../src/google-calendar.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };  // Selective mocking as needed
});

beforeEach(() => {
  mockFetchFn.mockReset();
});
```

For tests of Telegram/dashboard/MCP integration (TS-1.3–1.6, TS-3.x), mock the `src/google-calendar.js` module entirely and assert `processCalendarEvent` was called with the right args.

### Integration Test Setup

```typescript
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => { await db?.stop(); });

afterEach(async () => {
  await db.sql`DELETE FROM entries WHERE source = 'test'`;
  await db.sql`DELETE FROM settings WHERE key LIKE 'google_%'`;
});
```

Integration tests use `vi.stubGlobal("fetch", mockFetchFn)` to mock Google API calls while using real DB.

### Existing Helper Reuse

- `createClassificationResult()` from `tests/helpers/mock-llm.ts` — Already has `create_calendar_event` and `calendar_date` fields. Will need `calendar_time` added.
- `createMockContext()` from `tests/helpers/mock-telegram.ts` — For Telegram handler tests.
- `withEnv()` from `tests/helpers/env.ts` — For env var override tests.

## Test Scenario Mapping

### Group 1: Event Creation (Unit)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-1.1 | `creates timed calendar event with date and time` | unit |
| TS-1.2 | `creates all-day calendar event when no time` | unit |
| TS-1.3 | `Telegram text handler triggers calendar creation` | unit |
| TS-1.4 | `Telegram voice handler triggers calendar creation` | unit |
| TS-1.5 | `web dashboard capture triggers calendar creation` | unit |
| TS-1.6 | `MCP add_thought triggers calendar creation` | unit |
| TS-1.7 | `skips calendar when create_calendar_event is false` | unit |

**TS-1.1: creates timed calendar event with date and time**
- **Setup:** Mock `fetch` to return `createGoogleEventResponse()` for `POST .../events`. Configure calendar config with valid tokens.
- **Action:** Call `createCalendarEvent(config, { name, content, calendarDate: "2026-04-15", calendarTime: "14:00" })`.
- **Assert:** `fetch` was called with Google Calendar API URL. Request body contains `start.dateTime` with time component `T14:00:00`, `end.dateTime` with duration offset, `summary` = name, `description` = content. Returns the event ID.

**TS-1.2: creates all-day calendar event when no time**
- **Setup:** Mock `fetch` to return `createGoogleEventResponse()`.
- **Action:** Call `createCalendarEvent(config, { name, content, calendarDate: "2026-04-15", calendarTime: null })`.
- **Assert:** Request body contains `start.date` = `"2026-04-15"` and `end.date` = `"2026-04-16"` (all-day uses date, not dateTime). No `dateTime` fields present.

**TS-1.3: Telegram text handler triggers calendar creation**
- **Setup:** Mock `src/google-calendar.js` module. Mock `processCalendarEvent` as `vi.fn()`. Mock classification to return `create_calendar_event: true`. Create mock Telegram context.
- **Action:** Call `handleTextMessage(ctx, mockSql)`.
- **Assert:** `processCalendarEvent` was called with the entry ID and classification result.

**TS-1.4: Telegram voice handler triggers calendar creation**
- **Setup:** Same as TS-1.3 but with voice message context. Mock whisper transcription.
- **Action:** Call `handleVoiceMessage(ctx, mockSql)`.
- **Assert:** `processCalendarEvent` was called.

**TS-1.5: web dashboard capture triggers calendar creation**
- **Setup:** Mock `src/google-calendar.js` module. Create test Hono app with dashboard routes. Mock classification to return `create_calendar_event: true`.
- **Action:** `POST /` with note text (authenticated).
- **Assert:** `processCalendarEvent` was called.

**TS-1.6: MCP add_thought triggers calendar creation**
- **Setup:** Mock `src/google-calendar.js` module. Import `handleAddThought` from MCP tools.
- **Action:** Call `handleAddThought({ content: "Meeting tomorrow at 3pm" })`.
- **Assert:** `processCalendarEvent` was called.

**TS-1.7: skips calendar when create_calendar_event is false**
- **Setup:** Mock `fetch`. Classification result has `create_calendar_event: false`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` was NOT called with Google Calendar API URL. Entry's `google_calendar_event_id` remains null.

### Group 2: OAuth Settings (Unit: 4, Integration: 4)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-2.1 | `settings page displays Google Calendar section` | unit |
| TS-2.2 | `connect button generates OAuth consent URL` | unit |
| TS-2.3 | `authorization code exchange stores tokens` | integration |
| TS-2.4 | `connected status shown when tokens exist` | integration |
| TS-2.5 | `not connected status when no tokens` | unit |
| TS-2.6 | `disconnect clears stored tokens` | integration |
| TS-2.7 | `env var provides fallback calendar ID` | unit |
| TS-2.8 | `settings table value overrides env var` | unit |

**TS-2.1: settings page displays Google Calendar section**
- **Setup:** Create test Hono app with settings routes. Authenticate.
- **Action:** `GET /settings` with auth cookie.
- **Assert:** Response HTML contains "Google Calendar" section, Calendar ID input field, default duration input field.

**TS-2.2: connect button generates OAuth consent URL**
- **Setup:** `withEnv({ GOOGLE_CLIENT_ID: "test-client-id" })`. No tokens in settings (mocked).
- **Action:** `GET /settings` with auth cookie.
- **Assert:** Response HTML contains a link/button with `href` pointing to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id=test-client-id`, `scope` containing `calendar`, and `response_type=code`.

**TS-2.3: authorization code exchange stores tokens** (Integration)
- **Setup:** Start test DB. Insert `google_client_id` and `google_client_secret` in settings. Mock `fetch` to return `createGoogleTokenResponse()` for the Google token endpoint.
- **Action:** `POST /settings/google-calendar/connect` with `code=test-auth-code`.
- **Assert:** Settings table contains `google_refresh_token` and `google_access_token` with values from the token response.

**TS-2.4: connected status shown when tokens exist** (Integration)
- **Setup:** Start test DB. Insert `google_refresh_token` in settings table.
- **Action:** `GET /settings` with auth cookie.
- **Assert:** Response HTML contains "Connected" status text. "Disconnect" button is visible.

**TS-2.5: not connected status when no tokens**
- **Setup:** Mock settings query to return no Google tokens. No `GOOGLE_REFRESH_TOKEN` env var.
- **Action:** `GET /settings` with auth cookie.
- **Assert:** Response HTML contains "Not connected" status. "Connect Google Calendar" button is visible.

**TS-2.6: disconnect clears stored tokens** (Integration)
- **Setup:** Start test DB. Insert `google_refresh_token` and `google_access_token` in settings.
- **Action:** `POST /settings/google-calendar/disconnect`.
- **Assert:** Settings table no longer contains `google_refresh_token` or `google_access_token`.

**TS-2.7: env var provides fallback calendar ID**
- **Setup:** `withEnv({ GOOGLE_CALENDAR_ID: "env@group.calendar.google.com" })`. Mock settings query to return no `google_calendar_id`.
- **Action:** Call `resolveCalendarConfig(mockSql)`.
- **Assert:** Returned config has `calendarId` = `"env@group.calendar.google.com"`.

**TS-2.8: settings table value overrides env var**
- **Setup:** `withEnv({ GOOGLE_CALENDAR_ID: "env@group.calendar.google.com" })`. Mock settings query to return `google_calendar_id` = `"settings@group.calendar.google.com"`.
- **Action:** Call `resolveCalendarConfig(mockSql)`.
- **Assert:** Returned config has `calendarId` = `"settings@group.calendar.google.com"`.

### Group 3: Confirmation Messages (Unit)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-3.1 | `Telegram reply includes calendar confirmation` | unit |
| TS-3.2 | `web capture response includes calendar confirmation` | unit |
| TS-3.3 | `MCP result includes calendar confirmation` | unit |

**TS-3.1: Telegram reply includes calendar confirmation**
- **Setup:** Mock `processCalendarEvent` to resolve with `{ created: true, date: "2026-04-15" }`. Mock classification with `create_calendar_event: true`. Create mock Telegram context.
- **Action:** Call `handleTextMessage(ctx, mockSql)`.
- **Assert:** `ctx.reply` was called with a string containing `"📅 Calendar event created for 2026-04-15"`.

**TS-3.2: web capture response includes calendar confirmation**
- **Setup:** Mock `processCalendarEvent` to resolve with `{ created: true }`. Create test Hono app with dashboard routes.
- **Action:** `POST /` with note text (authenticated).
- **Assert:** Response contains a calendar confirmation indicator (e.g., text or HTML element).

**TS-3.3: MCP result includes calendar confirmation**
- **Setup:** Mock `processCalendarEvent` to resolve with `{ created: true }`.
- **Action:** Call `handleAddThought({ content: "Meeting at 3pm" })`.
- **Assert:** Result text contains a calendar confirmation line.

### Group 4: Failure Handling (Unit)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-4.1 | `entry saved when calendar API fails` | unit |
| TS-4.2 | `token refresh and retry on 401` | unit |
| TS-4.3 | `retry on server error` | unit |
| TS-4.4 | `failure notification after retry exhausted` | unit |
| TS-4.5 | `new refresh token stored after refresh` | unit |

**TS-4.1: entry saved when calendar API fails**
- **Setup:** Mock `fetch` to reject (network error) for Google Calendar API. Mock DB insert to succeed.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)` where result has `create_calendar_event: true`.
- **Assert:** Function does not throw. Entry's `google_calendar_event_id` is not set (no event created). The error is logged (spy on logger).

**TS-4.2: token refresh and retry on 401**
- **Setup:** Mock `fetch` to: (1) return 401 for first Calendar API call, (2) return `createGoogleTokenResponse()` for token endpoint, (3) return `createGoogleEventResponse()` for second Calendar API call.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` was called 3 times (initial call, token refresh, retry). Event created successfully. New access token used in retry.

**TS-4.3: retry on server error**
- **Setup:** Mock `fetch` to return 500 on first call, then `createGoogleEventResponse()` on second call. Use `vi.useFakeTimers()`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`. Advance timers by 1000ms.
- **Assert:** `fetch` was called twice. 1-second delay between calls. Event created successfully on retry.

**TS-4.4: failure notification after retry exhausted**
- **Setup:** Mock `fetch` to return 500 on both first call and retry.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** Function returns a failure result (e.g., `{ created: false, error: "..." }`). Error is logged.

**TS-4.5: new refresh token stored after refresh**
- **Setup:** Mock `fetch` to: (1) return 401 for Calendar API, (2) return token response with a NEW `refresh_token` value.
- **Action:** Call `refreshAccessToken(refreshToken, clientId, clientSecret)` or trigger via `processCalendarEvent`.
- **Assert:** The mock sql is called to update `google_refresh_token` in settings with the new value. `google_access_token` is also updated.

### Group 5: Reclassification (Unit)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-5.1 | `updates existing calendar event on reclassification` | unit |
| TS-5.2 | `deletes event when reclassified to no-calendar` | unit |
| TS-5.3 | `creates new event when no prior event` | unit |
| TS-5.4 | `no action when no-calendar and no prior event` | unit |

**TS-5.1: updates existing calendar event on reclassification**
- **Setup:** Mock DB to return entry with `google_calendar_event_id: "event123"`. Mock `fetch` to return 200 for `PATCH .../events/event123`. Classification result: `create_calendar_event: true`, `calendar_date: "2026-05-01"`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` was called with PATCH (or PUT) to update event `event123`. Request body contains updated date. Entry's `google_calendar_event_id` remains `"event123"`.

**TS-5.2: deletes event when reclassified to no-calendar**
- **Setup:** Mock DB to return entry with `google_calendar_event_id: "event123"`. Mock `fetch` to return 204 for `DELETE .../events/event123`. Classification result: `create_calendar_event: false`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` was called with DELETE for event `event123`. SQL updates entry's `google_calendar_event_id` to null.

**TS-5.3: creates new event when no prior event**
- **Setup:** Mock DB to return entry with `google_calendar_event_id: null`. Mock `fetch` to return `createGoogleEventResponse({ id: "new-event-456" })`. Classification result: `create_calendar_event: true`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` was called with POST (insert, not update). SQL updates entry's `google_calendar_event_id` to `"new-event-456"`.

**TS-5.4: no action when no-calendar and no prior event**
- **Setup:** Mock DB to return entry with `google_calendar_event_id: null`. Classification result: `create_calendar_event: false`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` was NOT called. No SQL updates to entry.

### Group 6: Entry Deletion (Integration)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-6.1 | `calendar event deleted on entry soft-delete` | integration |
| TS-6.2 | `entry soft-deleted even if calendar deletion fails` | integration |
| TS-6.3 | `no calendar event re-created on restore` | integration |

**TS-6.1: calendar event deleted on entry soft-delete**
- **Setup:** Insert entry with `google_calendar_event_id = 'event123'` in test DB. Mock `fetch` to return 204 for `DELETE .../events/event123`. Wire delete handler.
- **Action:** Soft-delete the entry (via entry routes or direct handler call).
- **Assert:** `fetch` was called with DELETE for event `event123`. Entry has `deleted_at` set. `google_calendar_event_id` is cleared (or retained — per AC-6.1, the event is deleted from Google; the column can be cleared or kept for audit).

**TS-6.2: entry soft-deleted even if calendar deletion fails**
- **Setup:** Insert entry with `google_calendar_event_id = 'event123'`. Mock `fetch` to return 500 for DELETE.
- **Action:** Soft-delete the entry.
- **Assert:** Entry has `deleted_at` set (soft-delete succeeded). Error is logged. `google_calendar_event_id` is NOT cleared (event is orphaned).

**TS-6.3: no calendar event re-created on restore**
- **Setup:** Insert soft-deleted entry with `google_calendar_event_id = 'event123'`. Mock `fetch`.
- **Action:** Restore the entry (set `deleted_at = null`).
- **Assert:** `fetch` was NOT called with POST to create a new event. Entry's `google_calendar_event_id` is cleared (the old event was deleted when entry was soft-deleted; stale ID is removed).

### Group 7: Duration Configuration (Unit)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-7.1 | `settings page displays duration field` | unit |
| TS-7.1b | `duration value saved to settings table` | unit |
| TS-7.2 | `duration validation rejects below minimum` | unit |
| TS-7.3 | `duration validation rejects above maximum` | unit |
| TS-7.4 | `default duration is 60 minutes` | unit |
| TS-7.5 | `configured duration applied to timed events` | unit |

**TS-7.1: settings page displays duration field**
- **Setup:** Create test Hono app with settings routes. Authenticate.
- **Action:** `GET /settings`.
- **Assert:** Response HTML contains a "Default event duration" input field within the Google Calendar section.

**TS-7.1b: duration value saved to settings table**
- **Setup:** Create test Hono app with settings routes. Mock settings query layer.
- **Action:** `POST /settings` with `google_calendar_default_duration=45` in form body.
- **Assert:** `saveAllSettings` (or equivalent) is called with `google_calendar_default_duration: "45"`.

**TS-7.2: duration validation rejects below minimum**
- **Setup:** Create test Hono app with settings routes.
- **Action:** `POST /settings` with `google_calendar_default_duration=10`.
- **Assert:** Response indicates validation error. Value is not saved.

**TS-7.3: duration validation rejects above maximum**
- **Setup:** Create test Hono app with settings routes.
- **Action:** `POST /settings` with `google_calendar_default_duration=500`.
- **Assert:** Response indicates validation error. Value is not saved.

**TS-7.4: default duration is 60 minutes**
- **Setup:** Mock settings query to return no `google_calendar_default_duration`.
- **Action:** Call `resolveCalendarConfig(mockSql)`.
- **Assert:** Returned config has `defaultDuration` = `60`.

**TS-7.5: configured duration applied to timed events**
- **Setup:** Mock settings to return `google_calendar_default_duration: "30"`. Mock `fetch` to return `createGoogleEventResponse()`.
- **Action:** Call `createCalendarEvent(config, { calendarDate: "2026-04-15", calendarTime: "09:00" })` with config.defaultDuration = 30.
- **Assert:** Request body has `start.dateTime` at 09:00 and `end.dateTime` at 09:30.

### Group 8: Edge Cases (Unit: 5, Integration: 3)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-8.1 | `skips creation when calendar_date is null` | unit |
| TS-8.2 | `creates all-day event when calendar_time has invalid format` | unit |
| TS-8.3 | `past date still creates event` | unit |
| TS-8.4 | `revoked refresh token shows disconnected` | integration |
| TS-8.5 | `multiple simultaneous entries create independent events` | integration |
| TS-8.6 | `hard delete does not reattempt calendar deletion` | integration |
| TS-8.7 | `entry edit updates linked calendar event` | unit |
| TS-8.8 | `invalid calendar ID returns failure` | unit |

**TS-8.1: skips creation when calendar_date is null**
- **Setup:** Classification result: `create_calendar_event: true`, `calendar_date: null`.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** `fetch` NOT called. No error logged. Returns `{ created: false }` (or similar no-op result).

**TS-8.2: creates all-day event when calendar_time has invalid format**
- **Setup:** Classification result: `calendar_time: "afternoon"` (not HH:MM). Mock `fetch` for Calendar API.
- **Action:** Call `createCalendarEvent(config, { calendarDate: "2026-04-15", calendarTime: "afternoon" })`.
- **Assert:** Request body uses `start.date` / `end.date` (all-day format), NOT `dateTime`.

**TS-8.3: past date still creates event**
- **Setup:** Mock `fetch` for Calendar API. `calendarDate: "2025-01-01"`.
- **Action:** Call `createCalendarEvent(config, { calendarDate: "2025-01-01", calendarTime: null })`.
- **Assert:** `fetch` was called. Event created normally with date 2025-01-01.

**TS-8.4: revoked refresh token shows disconnected** (Integration)
- **Setup:** Insert `google_refresh_token` in settings table. Mock `fetch` to return `{ error: "invalid_grant" }` with 400 for token endpoint.
- **Action:** Attempt `refreshAccessToken()`. Then `GET /settings`.
- **Assert:** Token refresh fails. Settings page shows "Not connected" (the stale tokens cannot produce a valid access token).

**TS-8.5: multiple simultaneous entries create independent events** (Integration)
- **Setup:** Insert two entries in test DB. Mock `fetch` to return different event IDs for each POST.
- **Action:** Call `processCalendarEvent` for both entries concurrently (via `Promise.all`).
- **Assert:** Two separate `fetch` POST calls made. Each entry has a unique `google_calendar_event_id`.

**TS-8.6: hard delete does not reattempt calendar deletion** (Integration)
- **Setup:** Insert soft-deleted entry with `google_calendar_event_id = 'event123'` (calendar delete previously failed — orphaned). Mock `fetch`.
- **Action:** Hard-delete the entry (`DELETE FROM entries`).
- **Assert:** `fetch` was NOT called. Entry is permanently removed.

**TS-8.7: entry edit updates linked calendar event**
- **Setup:** Mock DB to return entry with `google_calendar_event_id: "event123"`. Mock `fetch` for PATCH. New `calendar_date` or `calendar_time` in edit data.
- **Action:** Trigger entry save/update handler with changed date/time fields.
- **Assert:** `fetch` was called with PATCH to update event `event123` with new date/time.

**TS-8.8: invalid calendar ID returns failure**
- **Setup:** Mock `fetch` to return 404 for Calendar API (invalid calendar ID).
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)`.
- **Assert:** Returns failure result. Error is logged. Entry's `google_calendar_event_id` is not set.

### Group 9: Constraints (Unit)

| Scenario | Test Function | File |
|----------|---------------|------|
| TS-9.1 | `calendar API call does not block entry storage` | unit |
| TS-9.2 | `classification includes calendar_time field` | unit |
| TS-9.3 | `feature is inert when not configured` | unit |

**TS-9.1: calendar API call does not block entry storage**
- **Setup:** Mock `fetch` to delay (using `vi.useFakeTimers()` or a slow mock). Mock DB insert.
- **Action:** Run the full capture pipeline (classify → save entry → calendar event).
- **Assert:** Entry insert SQL is executed BEFORE `fetch` call to Google Calendar API. The pipeline does not `await` the calendar call before saving.

**TS-9.2: classification includes calendar_time field**
- **Setup:** Mock LLM to return a classification JSON with `calendar_time: "14:00"`.
- **Action:** Call `classifyText("Meeting at 2pm")`.
- **Assert:** Result object has `calendar_time` field with value `"14:00"`. Result has all 8 expected keys.

**TS-9.3: feature is inert when not configured**
- **Setup:** `withEnv({})` — clear all Google-related env vars. Mock settings to return no Google tokens.
- **Action:** Call `processCalendarEvent(sql, entryId, classificationResult)` with `create_calendar_event: true`.
- **Assert:** `fetch` NOT called. No error logged. No error thrown. Function returns cleanly.

## Classification Schema Changes

The existing `ClassificationResult` interface in `tests/helpers/mock-llm.ts` needs one addition:

```typescript
export interface ClassificationResult {
  // ... existing 7 fields ...
  calendar_time: string | null;  // NEW — HH:MM format or null
}
```

The `createClassificationResult()` factory default: `calendar_time: null`.

The `createClassificationJSON()` factory includes `calendar_time` in output.

## Open Decisions (Deferred to Phase 5)

1. **Settings page routes:** Google Calendar connect/disconnect may be separate routes (`/settings/google-calendar/connect`, `/settings/google-calendar/disconnect`) or handled within the existing `POST /settings` flow. Tests use separate routes for clarity; Phase 5 may consolidate.

2. **`processCalendarEvent` return type:** Tests assume it returns `{ created: boolean, eventId?: string, error?: string }`. Phase 5 defines the exact shape.

3. **Entry edit calendar sync (TS-8.7):** The trigger mechanism (explicit handler in entry save route vs. DB trigger) is deferred. Tests verify the behavior regardless of mechanism.

4. **Token validation for "Not connected" (TS-8.4):** Whether the settings page actively validates tokens (by attempting a refresh) or passively shows status based on token presence is deferred. Tests verify the end-user-visible outcome.

## Alignment Check

**Full alignment:** All 47 test scenarios from the test specification are mapped to test functions:
- 37 unit tests in `tests/unit/google-calendar.test.ts`
- 10 integration tests in `tests/integration/google-calendar-integration.test.ts`

No coverage gaps. No orphan tests. All scenarios can be implemented without coupling to internal implementation details — tests verify observable behavior (API calls via mocked fetch, DB state, response content).

**Tests that may pass early:** TS-9.2 (classification `calendar_time` field) — if the field is added to `parseClassificationResponse` before the calendar feature exists, this test passes. This is acceptable because it tests a prerequisite change (classification schema), not the calendar feature itself.
