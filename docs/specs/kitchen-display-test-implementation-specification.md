# Kitchen Display — Test Implementation Specification

Maps every test scenario in `kitchen-display-test-specification.md` to a concrete TypeScript test function, file location, setup strategy, action, and assertion. This is the technical blueprint for writing the tests.

## Test Framework & Conventions

**Stack:** Node.js + TypeScript (ESM), project language confirmed by `package.json`.

**Framework:** [Vitest](https://vitest.dev/) — already the project-wide test runner (`npm test`, `npm run test:unit`, `npm run test:integration`).

**Patterns used elsewhere in this project** (from `tests/unit/display-*.test.ts`, `tests/integration/*`):

- `describe` / `it` nesting for grouping
- `beforeEach` / `afterEach` for per-test setup / cleanup (async allowed)
- `vi.mock("../../src/<path>.js", () => ({...}))` at **top-level** (hoisted) for source-module mocks
- `vi.fn()`, `vi.clearAllMocks()`, `vi.resetAllMocks()` for mock lifecycle
- `vi.spyOn(globalThis, "fetch")` for outbound HTTP mocking (see `tests/helpers/mock-ollama.ts` precedent)
- Hono `app.request(path, init?)` for endpoint-level tests — no actual HTTP server spun up
- Assertion style: `expect(...).toBe(...)`, `.toEqual(...)`, `.toContain(...)`, `.toHaveBeenCalledWith(...)`, `.toBeDefined()`, `.toBeNull()`
- Testcontainers + `pgvector/pgvector:pg16` for integration tests that need a real DB, via `tests/helpers/test-db.ts` (`startTestDb`, `runMigrations`)

**Conventions for this feature:**
- All test files placed under `tests/unit/` for pure-module and handler tests, `tests/integration/` for anything that hits a real database.
- File names follow the existing convention: `tests/unit/display-<module>.test.ts`.
- Test titles match the spec's TS ID as a prefix: `it("TS-2.1 — returns a PNG image when enabled", ...)`.
- Decision-table rows are implemented as `it.each([...])` tables, one `it.each` block per decision table (TS-6.6, TS-7.9).

## Test Structure

### File organization

| File | Purpose | Preserves existing tests? |
|---|---|---|
| `tests/unit/display-routes.test.ts` | Endpoint-level: `GET /api/kitchen.png`, `GET /api/display`. Covers US-1, US-2, US-3, US-4, parts of US-8. Top-level mocks for `render`, `weather-data`, `task-data`, `calendar-data`, `settings-queries`, `logger`. | **Yes** — extend, don't replace. Add ~20 new `it` blocks. |
| `tests/unit/display-weather.test.ts` | `getWeather` + `mapWeatherCode` unit tests. Covers US-7 (WMO mapping, caching, lat/lng gating, fetch failure). `vi.spyOn(globalThis, "fetch")`. | **Yes** — extend with the full 28-row WMO decision table. |
| `tests/unit/display-tasks.test.ts` | `getDisplayTasks` + `formatDueDate` unit tests. Covers US-6 (query shape, ordering, limit, due-date label decision table). Mocks postgres via a callable `sql` fake. | **Yes** — extend with decision table rows. |
| `tests/unit/display-calendar.test.ts` | `getDisplayEvents` unit tests. Covers US-5 (multi-calendar fetch, token refresh, filter, empty state, missing summary). Top-level `vi.mock` for `src/google-calendar.js`. | **Yes** — extend. |
| `tests/unit/display-render.test.ts` | `buildLayout` unit tests. Covers US-7 layout branching (omit weather, tomorrow subsection, empty states, overflow line, done/overdue task styling). The layout function returns a plain element tree; assertions walk the tree. | **Yes** — extend. |
| `tests/integration/display-integration.test.ts` (NEW) | Integration tests that hit a real DB via testcontainers. Covers TS-1.4 (enable without restart), TS-5.1 (timezone-aware query), TS-6.1–6.4 (real DB task queries with ordering and limit), TS-8.2 (fully empty config), TS-C-3 (fresh render per request), TS-NG-1 (no session-cookie gating), TS-NG-8 (no rate limiting). | New file. |

### Naming

- `it("TS-X.Y — <short behavior description>", ...)`
- `describe("kitchen display routes — GET /api/kitchen.png", ...)` etc., grouping by endpoint or user story.
- Decision tables: `it.each(table)("TS-7.9 — WMO code $code maps to $label / $icon", ...)`.

## Test Scenario Mapping

Legend:
- **File**: short code for target file. `R` = `display-routes.test.ts`, `W` = `display-weather.test.ts`, `T` = `display-tasks.test.ts`, `C` = `display-calendar.test.ts`, `L` = `display-render.test.ts`, `I` = `display-integration.test.ts`.
- **Setup**: what fixtures/mocks are arranged.
- **Action**: the single triggering call.
- **Assertion**: the observable check.

### US-1: Feature disabled by default

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-1.1 | I | testcontainers DB, fresh migrations, no settings rows inserted | `SELECT value FROM settings WHERE key = 'display_enabled'` | row is absent OR `value === "false"` |
| TS-1.2 | R | `mockGetAllSettings.mockResolvedValue({ display_enabled: "false" })` | `app.request("/api/kitchen.png")` | `status === 404`, body `"Not Found"`, `mockRender` not called |
| TS-1.3 | R | same as TS-1.2 | `app.request("/api/display")` | `status === 404`, body `"Not Found"` |
| TS-1.4 | I | testcontainers DB, start Hono app with real `createDisplayRoutes(sql)`, initially `display_enabled = "false"`; first GET returns 404 | `UPDATE settings SET value = 'true' WHERE key = 'display_enabled'`, then second `app.request("/api/kitchen.png")` | second response `status === 200` |

### US-2: PNG endpoint

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-2.1 | R | `display_enabled: "true"`, no token, default mock data | `app.request("/api/kitchen.png")` | `status === 200`, body length > 0 |
| TS-2.2 | R | same | same | `headers.get("content-type") === "image/png"` |
| TS-2.3 | R | same | same | `headers.get("cache-control") === "no-cache"` |
| TS-2.4 | R | settings include `display_width: "1200"`, `display_height: "800"` | `app.request("/api/kitchen.png")` | `mockRender.mock.calls[0][1] === 1200`, `calls[0][2] === 800` |
| TS-2.5 | R | settings omit `display_width`/`display_height` | same | `mockRender.mock.calls[0][1] === 1872`, `calls[0][2] === 1404` |
| TS-2.6 | R | `mockRender.mockRejectedValue(new Error("boom"))`, spy on `createLogger().error` | same | `status === 500`, body `"Internal Server Error"`, logger error called with `{ error: "boom" }` |

### US-3: Optional token auth

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-3.1 | R | `display_token` absent | `app.request("/api/kitchen.png")` (no query) | `status === 200` |
| TS-3.2 | R | `display_token: "correct"` | `app.request("/api/kitchen.png")` (no query) | `status === 403`, body `"Forbidden"` |
| TS-3.3 | R | `display_token: "correct"` | `app.request("/api/kitchen.png?token=wrong")` | `status === 403`, body `"Forbidden"` |
| TS-3.4 | R | `display_token: "correct"` | `app.request("/api/kitchen.png?token=correct")` | `status === 200` |
| TS-3.5 | R | `display_token: "correct"` | inspect the module's source via `vi.importActual` to confirm the comparison routes through `crypto.timingSafeEqual` | assertion: the imported source code contains the string `timingSafeEqual` in the token-comparison block. (Phase 6 review double-checks via code reading.) |
| TS-3.6 | R | `display_token: "correct"` | `app.request("/api/display")` (no query) | `status === 200`, body contains `image_url` field |

### US-4: TRMNL BYOS adapter

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-4.1 | R | `display_enabled: "true"` | `app.request("/api/display")` | `status === 200`, content-type `application/json`, parsed body has exactly keys `["image_url", "filename"]` |
| TS-4.2 | R | same | same | `body.filename === "cortex-kitchen"` |
| TS-4.3 | R | same | `app.request("/api/display", { headers: { Host: "cortex.local:3000" } })` | `body.image_url === "http://cortex.local:3000/api/kitchen.png"` |
| TS-4.4 | R | same | request with `Host: "cortex.example.com"` and `X-Forwarded-Proto: "https"` | `body.image_url.startsWith("https://cortex.example.com/api/kitchen.png")` |
| TS-4.5 | R | same | request with `Host: "cortex.local"` and no `X-Forwarded-Proto` | `body.image_url.startsWith("http://")` |
| TS-4.6 | R | same | request with **no Host header** (Hono may synthesize; if so, use `new Request` with explicit empty Host) | `body.image_url === "http://localhost/api/kitchen.png"` |
| TS-4.7 | R | `display_token: "secret-123"` | `app.request("/api/display")` | `body.image_url.endsWith("?token=secret-123")` |
| TS-4.8 | R | `display_token` absent | same | `!body.image_url.includes("token=")` |
| TS-4.9 | R | `display_base_url: "https://proxy.example.com"`, `Host: "internal:3000"` | `app.request("/api/display", { headers: { Host: "internal:3000" } })` | `body.image_url === "https://proxy.example.com/api/kitchen.png"` (the Host is ignored) |
| TS-4.10 | R | `display_base_url: "https://proxy.example.com/"` (trailing slash) | same | `body.image_url === "https://proxy.example.com/api/kitchen.png"` — exactly one slash separates base and path |
| TS-4.11 | R | `display_enabled: "false"` | `app.request("/api/display")` | `status === 404` |

### US-5: Calendar events

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-5.1 | I | testcontainers DB, real `timezone = "America/Los_Angeles"` setting, `vi.mock("../../src/google-calendar.js")` for `listEvents`, one calendar configured | `app.request("/api/kitchen.png")` | mocked `listEvents` was called with `timeMin` at 00:00 and `timeMax` at 23:59 Los Angeles time (dates asserted via `Temporal` or `luxon`-style formatting, project currently uses plain `Date` so assertion is via ISO string comparison with fixed clock) |
| TS-5.2 | C | two calendar configs, `display_calendars: ["FAMILY"]` | `getDisplayEvents(sql, tz, ["FAMILY"])` | only events from FAMILY appear; WORK fetch path not taken (mock not called for WORK) |
| TS-5.3 | C | two calendar configs, `display_calendars: []` | `getDisplayEvents(sql, tz, [])` | events from both calendars appear |
| TS-5.4 | C | two calendar configs, `display_calendars` argument is `undefined` | `getDisplayEvents(sql, tz, undefined)` | events from both calendars appear |
| TS-5.5 | L | `data = { todayEvents: [{ time: "09:30", name: "Standup", calendar: "WORK" }], tomorrowEvents: [], tasks: [], weather: null, ... }` | `buildLayout(data, 1872, 1404)` | element tree includes text nodes for `"09:30"`, `"Standup"`, `"WORK"` |
| TS-5.6 | L | `data.todayEvents` has 12 entries, `data.maxTodayEvents === 5` | `buildLayout(data)` | element tree contains exactly 5 event rows |
| TS-5.7 | L | same as TS-5.6 with 8 entries and `maxTodayEvents === 5` | same | element tree contains the text `"+3 more"` exactly once |
| TS-5.8 | L | `data.tomorrowEvents` has 7 entries (render layer slices to 3 before handoff) | `buildLayout(data)` | element tree contains exactly 3 tomorrow event rows |
| TS-5.9 | L | `data.todayEvents === []` | `buildLayout(data)` | element tree contains text `"No events today"`, no event rows |
| TS-5.10 | L | `data.tomorrowEvents === []` | `buildLayout(data)` | element tree does **not** contain the text `"TOMORROW"` anywhere |

### US-6: Tasks

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-6.1 | I | insert one entry: category `tasks`, `fields: { status: "pending" }`, not deleted | call `getDisplayTasks(sql, 7)` | returned array contains that task |
| TS-6.2 | I | insert one entry: category `tasks`, `fields: { status: "done" }`, `updated_at` 2h ago | same | returned array contains that task in done state |
| TS-6.2b | I | insert one entry: category `tasks`, `fields: { status: "done" }`, `updated_at` 48h ago | same | returned array **does not** contain that task |
| TS-6.3 | I | insert three tasks with due dates today, yesterday, +7d | same | order is [yesterday, today, +7d] |
| TS-6.4 | I | insert 10 pending tasks, call with `limit=3` | `getDisplayTasks(sql, 3)` | returned array has length 3 |
| TS-6.5 | L | `data.tasks` includes one task with `name: "Buy milk"`, `due: "due Apr 3"`, `done: false` | `buildLayout(data)` | element tree contains text `"Buy milk"`, text `"due Apr 3"`, and a checkbox element |
| TS-6.6 (decision table) | T | each row of the decision table, invoked via `it.each([...])` | `formatDueDate(inputDate, now, timezone)` | returned string matches expected label per row |
| TS-6.7 | L | task with `done: true` | `buildLayout(data)` | element tree style includes `text-decoration: line-through` on that row's name element |
| TS-6.8 | L | task with `due: "overdue"` and style flag `overdue: true` | same | element tree style on the due label has `font-weight: 700` or equivalent bold indicator |
| TS-6.9 | L | `data.tasks === []` | same | element tree contains text `"All clear"` |

### US-7: Weather

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-7.1 | W | `vi.spyOn(globalThis, "fetch")` returning a well-formed Open-Meteo JSON | `getWeather(52.52, 13.41, "Europe/Berlin")` | fetch called exactly once with a URL whose query includes `latitude=52.52`, `longitude=13.41`, `forecast_days=1` |
| TS-7.2 | W | `vi.useFakeTimers()`, call once, advance 10 minutes, call again with same args | two sequential `getWeather(52.52, 13.41, "Europe/Berlin")` calls | `fetch.mock.calls.length === 1` (second call served from cache) |
| TS-7.2b | W | same but advance 31 minutes | two calls | `fetch.mock.calls.length === 2` (TTL expired) |
| TS-7.3 | W | `fetch` rejects with network error | `getWeather(...)` | returns `null`, does not throw |
| TS-7.4 | W | `fetch` resolves with `new Response("", { status: 500 })` | same | returns `null` |
| TS-7.5 | R | settings omit `display_weather_lat`/`display_weather_lng` | `app.request("/api/kitchen.png")` | the `getWeather` mock is **not called** (asserted via `expect(getWeather).not.toHaveBeenCalled()`) |
| TS-7.6 | R | `display_weather_lat: "not-a-number"`, `display_weather_lng: "13.41"` | same | `getWeather` not called |
| TS-7.7 | R | `display_weather_lat: "52.52"`, `display_weather_lng: "abc"` | same | `getWeather` not called |
| TS-7.8 | L | `data.weather = { current: 12.7, condition: "Partly Cloudy", high: 15, low: 7, hourly: [4 entries] }` | `buildLayout(data)` | element tree contains text `"13"` (rounded), condition label, high/low, exactly 4 hourly slots |
| TS-7.9 (decision table, 28 rows) | W | `it.each([[0, "Clear", "sun"], [1, "Mainly Clear", "cloud"], ..., [99, "Thunderstorm with Hail", "cloud-lightning"]])` | `mapWeatherCode(code)` | returned `{ condition, icon }` matches expected row |
| TS-7.10 | W | same `it.each` row with `code = 999` | `mapWeatherCode(999)` | `{ condition: "Cloudy", icon: "cloud" }` |

### US-8: Graceful degradation

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-8.1 | L | `data` with empty events, empty tasks, null weather | `buildLayout(data)` | element tree contains brand text `"cortex"`, a date string, a time string, `"Last updated"` text |
| TS-8.2 | I | testcontainers DB, `display_enabled: "true"`, no weather settings, no calendar rows, no task rows | `app.request("/api/kitchen.png")` | `status === 200`, content-type `image/png`, body is a non-empty Buffer, rendered layout (via `buildLayout` invocation count or snapshot) has the expected empty-state messages |
| TS-8.3 | R | `display_weather_lat/lng` set, `getWeather` mock rejects, calendar mock returns one event, tasks mock returns one task | `app.request("/api/kitchen.png")` | `status === 200`, weather strip absent from rendered data, calendar event present, task row present |
| TS-8.4 | R | calendar mock returns `{ today: [], tomorrow: [] }` (simulating refresh failure), weather mock returns data, tasks mock returns one task | same | `status === 200`, today shows empty state, weather strip present, task row present |

### Edge cases

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-E-2 | C | google-calendar mock: first call throws 401, refresh mock succeeds, retry succeeds | `getDisplayEvents(sql, tz, undefined)` | refresh mock called exactly once, final result contains events from the retry |
| TS-E-3 | L | event with 200-char name | `buildLayout(data)` | element tree's event name element has `overflow: hidden` and `textOverflow: ellipsis` in its style object, `white-space: nowrap` or equivalent |
| TS-E-5 | W | empty cache, `fetch` times out via `vi.spyOn` with `AbortController` simulation | `getWeather(...)` | returns `null`, no stale cache used |
| TS-E-7 | R | `display_calendars: "not valid json {"` | `app.request("/api/kitchen.png")` | `status === 200`, `getDisplayEvents` called with `undefined` (or `[]`) as selectedCalendars, logger warn called with JSON parse failure context |
| TS-E-8 | C | google-calendar mock returns an event with no `summary` field | `getDisplayEvents(...)` | returned event still present, name is empty string or `"(no title)"`, no throw |
| TS-E-12 | R | `display_width: "0"`, `display_height: "-50"` | `app.request("/api/kitchen.png")` | `mockRender` called with `(_, 1872, 1404)` (falls back to defaults), `status === 200` |

### Constraints

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-C-1 | — | no runtime test; verified in Phase 6 by reviewing `package.json` display-related dependencies (must be only `satori` + `@resvg/resvg-wasm`) and confirming no outbound HTTP in the render path | — | — |
| TS-C-2 | R | `display_enabled: "true"`, no `display_token`, request carries a plausible session cookie | `app.request("/api/kitchen.png", { headers: { Cookie: "cortex_session=anything" } })` | `status === 200` (session cookie has no effect) |
| TS-C-3 | I | `display_enabled: "true"`, real app | two sequential `app.request("/api/kitchen.png")` calls | `mockRender.mock.calls.length === 2` (no reuse between requests) |

### Non-goals

| TS | File | Setup | Action | Assertion |
|---|---|---|---|---|
| TS-NG-1 | I | testcontainers DB, create a real user row, `display_enabled: "true"`, no display_token | `app.request("/api/kitchen.png")` with **no cookies** | `status === 200` (proves endpoint isn't gated by the setup/auth middleware) |
| TS-NG-8 | I | `display_enabled: "true"` | loop: 100 sequential `app.request("/api/kitchen.png")` calls | all 100 responses have `status === 200`, none are `429` |

## Fixtures & Test Data

### Shared helpers (new file: `tests/helpers/display-fixtures.ts`)

```ts
// Returns a KitchenData object with sensible defaults. Override any field via partial arg.
export function makeKitchenData(overrides?: Partial<KitchenData>): KitchenData;

// Returns a today event with defaults (time "09:00", name "Meeting", calendar "WORK").
export function makeEvent(overrides?: Partial<DisplayEvent>): DisplayEvent;

// Returns a task with defaults (name "Test task", done false, due null).
export function makeTask(overrides?: Partial<DisplayTask>): DisplayTask;

// Returns a weather object with defaults.
export function makeWeather(overrides?: Partial<WeatherData>): WeatherData;

// Returns a fake Open-Meteo JSON response for a given weather_code.
export function makeOpenMeteoResponse(weatherCode: number, temp?: number): object;
```

Rationale: the existing tests hard-code these inline; extracting them into a fixture helper keeps the new test files readable and allows the decision-table tests (`TS-6.6`, `TS-7.9`) to be concise.

### Mock strategy per boundary

| Boundary | Strategy | Test file(s) |
|---|---|---|
| `src/display/render.js` | `vi.mock` at top level; `renderKitchenDisplay` returns a fake Buffer `Buffer.from("fake-png")`; asserting on call args verifies dimensions | `display-routes.test.ts` |
| `src/display/weather-data.js` | `vi.mock` at top level with a default `getWeather` mock; individual tests override via `mockResolvedValue` / `mockRejectedValue` | `display-routes.test.ts` |
| `src/display/task-data.js` | `vi.mock` at top level with a default `getDisplayTasks` mock | `display-routes.test.ts` |
| `src/display/calendar-data.js` | `vi.mock` at top level with a default `getDisplayEvents` mock | `display-routes.test.ts` |
| `src/web/settings-queries.js` | `vi.mock` at top level; `mockGetAllSettings.mockResolvedValue({...})` per test sets the settings view | `display-routes.test.ts` |
| `src/google-calendar.js` | `vi.mock` at top level; provides `listEvents`, `refreshToken`, `getCalendarConfigs` as mocked functions | `display-calendar.test.ts` |
| `globalThis.fetch` | `vi.spyOn(globalThis, "fetch")` | `display-weather.test.ts` |
| PostgreSQL | testcontainers via `tests/helpers/test-db.ts` | `display-integration.test.ts`, and any TS with File = I |
| `src/logger.js` | `vi.mock` with no-op loggers; `mockLogger.warn` / `.error` spied in tests that assert logging | `display-routes.test.ts`, `display-weather.test.ts` |

### Setup / teardown

- **Unit tests:** `beforeEach(vi.clearAllMocks)` resets call history. No `afterEach` beyond what the framework does automatically.
- **Integration tests:** `beforeAll` starts testcontainers and runs migrations. `afterAll` stops the container. `beforeEach` truncates the `settings`, `entries`, and `user` tables to isolate tests. `afterEach` calls `vi.clearAllMocks()`.

### Fake clock strategy (TS-7.2, TS-7.2b)

The 30-minute weather cache TTL is time-sensitive. Use `vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] })` in the two cache-TTL scenarios only, and restore real timers in `afterEach` of that specific `describe` block to avoid leaking fake timers into sibling tests.

## Alignment Check

**Outcome: Full alignment.**

All 71 numbered test scenarios from `kitchen-display-test-specification.md` are mapped to a concrete test file, setup, action, and assertion — plus the two decision tables (TS-6.6 with 5 rows, TS-7.9 with 28 rows) are implemented via `it.each` loops.

### Design concerns flagged

1. **TS-3.5 (constant-time comparison)** is not meaningfully testable via a runtime timing assertion (too flaky). It is implemented as a source-inspection assertion: confirm the comparison site imports `timingSafeEqual` from `node:crypto`. The Phase 6 review also double-checks this at the code level.

2. **TS-C-1 (no external rendering service)** has no runtime test. It is verified in Phase 6 by reading `package.json` display dependencies and grepping the render path for outbound `fetch` calls. This is deliberately structural.

3. **TS-4.6 (no Host header)** may not be reachable through Hono's `app.request(path)` helper because Hono synthesizes a default Host. The test will need to construct a raw `Request` object and pass it via `app.fetch(request)` to bypass the default. Flagged so the Phase 4 implementer doesn't get stuck.

4. **TS-8.2 / TS-C-3 (fresh render per request)** rely on asserting that `renderKitchenDisplay` was called N times. Because TS-8.2 runs as an integration test where `render` is **not** mocked, this assertion needs a hybrid strategy: either partially mock `render` via `vi.mock` inside the integration test (unusual but supported), or assert by checking the output byte length / Content-Length twice and confirming the server did not return an identical cached response. The Phase 4 implementer should pick the simpler of the two.

### Gaps

None. Every test scenario has an implementation approach.

### Initial failure verification

When the Phase 4 tests are implemented against the **current** `src/display/*` code:

- **Expected to FAIL immediately:**
  - TS-7.9 rows 85, 86, 96, 99 (WMO mapping gaps KG-1, KG-2)
  - TS-5.6, TS-5.7 (`display_max_today_events` — KG-3)
  - TS-4.9, TS-4.10 (`display_base_url` override — KG-4)
  - TS-E-12 (width/height validation — KG-5)

- **Expected to PASS against existing code:** the other ~95 scenarios, because they reflect already-implemented behavior. These are a retroactive safety net — the tests now *document and lock in* the existing behavior rather than driving new behavior.

This is unusual for spec-dd (normally all tests fail at Phase 4), but it's the inevitable consequence of backfilling spec-dd onto a feature that already shipped. The spec is still driving — it just happens to drive toward "keep the existing correct behavior unchanged" for most scenarios and "close the 5 real gaps" for the minority.

## Handoff Prompt (ready for Phase 4)

```
Implement the tests for the kitchen-display feature according to the test
implementation specification.

References:
- Behavioral specification: docs/specs/kitchen-display-specification.md
- Test specification:       docs/specs/kitchen-display-test-specification.md
- Test impl specification:  docs/specs/kitchen-display-test-implementation-specification.md

Context: this is a RETROACTIVE spec-dd backfill. The feature code already
exists in src/display/ and 50 tests already live in tests/unit/display-*.test.ts.
Your job is to extend (not replace) those test files plus add one new
integration file (tests/integration/display-integration.test.ts) so that
every TS ID from the test specification has a corresponding test function.

Constraint: FIVE scenarios must fail against current code. These are the
Known Gaps (KG-1 through KG-5) documented in the specification and the
test implementation specification's "Initial failure verification" section:

  KG-1: TS-7.9 rows for WMO codes 85, 86 (snow showers)
  KG-2: TS-7.9 rows for WMO codes 96, 99 (thunderstorm with hail)
  KG-3: TS-5.6, TS-5.7 (display_max_today_events setting)
  KG-4: TS-4.9, TS-4.10 (display_base_url override)
  KG-5: TS-E-12 (width/height validation)

The remaining ~95 scenarios document already-implemented behavior and should
PASS against the current code. DO NOT modify src/display/* to make the five
failing scenarios pass — that is Phase 5 work, after the tests are approved.

Stack: Node.js + TypeScript (ESM), Vitest.
Test framework conventions:
  - vi.mock at top level for source-module mocks
  - beforeEach(vi.clearAllMocks) for unit tests
  - testcontainers via tests/helpers/test-db.ts for integration tests
  - app.request(path, init?) from Hono for endpoint tests
  - Fake fetch via vi.spyOn(globalThis, "fetch") for outbound HTTP

Start by reading the three specification files top to bottom, then work through
the Test Scenario Mapping table in the test impl spec one row at a time.
Finish by running `npm test -- tests/unit/display-*.test.ts tests/integration/display-integration.test.ts`
and confirming: all ~95 non-gap scenarios pass, exactly the 5 known-gap
scenarios fail, and no unrelated tests regress.
```
