# Kitchen Display — Behavioral Specification

## Objective

Serve a server-rendered PNG dashboard that combines today's calendar events, Cortex tasks, and weather into a single glanceable image, plus a JSON adapter endpoint compatible with the TRMNL BYOS (Bring Your Own Server) e-paper device protocol. The feature exists so a user can mount an e-paper display in the kitchen (or embed the image anywhere) and see their day at a glance without opening an app. The rendering pipeline runs entirely inside the Cortex process — no external rendering service, no headless browser, no client-side JavaScript.

The feature is **disabled by default**. A user explicitly opts in via a settings toggle, at which point both HTTP endpoints become reachable.

## User Stories & Acceptance Criteria

### US-1: As a user, I want the kitchen display feature to be off by default, so that a fresh Cortex install does not expose unauthenticated image endpoints.

**AC-1.1:** The `display_enabled` setting defaults to `false` (stored as the string `"false"`). A freshly installed Cortex instance has this setting absent or `"false"`.

**AC-1.2:** When `display_enabled` is not the exact string `"true"`, both `GET /api/kitchen.png` and `GET /api/display` return HTTP 404 with body `"Not Found"`. The endpoints are indistinguishable from non-existent routes.

**AC-1.3:** When `display_enabled` is set to `"true"` via the settings UI or the settings table, both endpoints become reachable on the next request without a process restart.

### US-2: As a TRMNL device or browser client, I want to request a rendered kitchen dashboard PNG, so that I can display the current day's information.

**AC-2.1:** `GET /api/kitchen.png` returns HTTP 200 with `Content-Type: image/png` and a binary PNG body, provided the feature is enabled and any required token is valid.

**AC-2.2:** The response includes a `Cache-Control: no-cache` header. A fresh image is generated per request — the server does not cache the PNG bytes across requests. (Internal data-source caches — notably the weather cache — are permitted and covered by US-7.)

**AC-2.3:** The image dimensions come from the `display_width` and `display_height` settings (integers, in pixels). Defaults: `1872` wide, `1404` tall (TRMNL X portrait). The renderer receives these dimensions and produces an image of exactly that size.

**AC-2.4:** If any uncaught exception occurs during rendering, the endpoint returns HTTP 500 with body `"Internal Server Error"`. The error is logged at `ERROR` level with the error message and a module tag of `display`. The endpoint does not return a partially-rendered or corrupt image.

### US-3: As a user exposing Cortex beyond a trusted LAN, I want to protect the PNG endpoint with a shared token, so that only my TRMNL device can fetch it.

**AC-3.1:** When the `display_token` setting is empty (empty string or absent), `GET /api/kitchen.png` is reachable without any token parameter, subject to US-1.

**AC-3.2:** When `display_token` is a non-empty string, `GET /api/kitchen.png` requires a `?token=<value>` query parameter. A missing or mismatched token returns HTTP 403 with body `"Forbidden"`.

**AC-3.3:** The token comparison is **constant-time**: the time taken to reject a wrong token does not depend on the position of the first mismatching byte. This property is required to prevent the server from leaking the token value via response-timing side channels.

**AC-3.4:** `GET /api/display` (the JSON adapter, see US-4) does not itself check the token. It surfaces the token in the `image_url` it returns (see AC-4.4), so a caller that successfully reaches `/api/display` can always reach the PNG endpoint.

### US-4: As a TRMNL BYOS device, I want to poll a JSON endpoint that tells me where to fetch the current image, so that I can integrate with Cortex without custom firmware.

**AC-4.1:** `GET /api/display` returns HTTP 200 with `Content-Type: application/json` and a body of the form `{ "image_url": <string>, "filename": <string> }` when the feature is enabled.

**AC-4.2:** `filename` is always the literal string `"cortex-kitchen"`.

**AC-4.3:** `image_url` is an absolute URL. By default the scheme is taken from the `X-Forwarded-Proto` request header if present, otherwise `http`. The authority (host and optional port) is taken from the `Host` request header, or `localhost` if the header is absent. The path is `/api/kitchen.png`.

**AC-4.4:** When the `display_token` setting is non-empty, `image_url` includes a `?token=<value>` query parameter where the value is the current token, URL-encoded. When the setting is empty, no `token` query parameter is present.

**AC-4.5:** An optional `display_base_url` setting, when set to a non-empty string, overrides the header-based scheme/host derivation. `image_url` is then constructed as `<display_base_url>/api/kitchen.png` with the token parameter appended as above. Trailing slashes on `display_base_url` are tolerated (one or zero). This override exists so a user with an unusual deployment (reverse proxy, mixed hostnames, split-horizon DNS) can pin the URL explicitly.

**AC-4.6:** When `display_enabled` is not `"true"`, `GET /api/display` returns HTTP 404 per AC-1.2.

### US-5: As a user, I want the dashboard to show today's and tomorrow's calendar events, so that I see my day at a glance.

**AC-5.1:** The display queries today's events between 00:00 and 23:59 in the configured timezone (settings key `timezone`, default `Europe/Berlin`), reusing the existing Google Calendar integration.

**AC-5.2:** When more than one Google Calendar is configured, the `display_calendars` setting filters which calendars contribute to the display. The setting holds a JSON array of calendar display names. An empty array, an absent setting, or invalid JSON means "all configured calendars." The filter is applied by display name, not calendar ID.

**AC-5.3:** Each event rendered on the display includes: a start time formatted as `HH:MM` (24-hour, zero-padded), the event summary (title), and the source calendar's display name (rendered as a small badge).

**AC-5.4:** The number of today events actually rendered is capped by the `display_max_today_events` setting (integer, default `8`). When more events exist than this cap, the first `max` events (in chronological order) are rendered and a single overflow line reading `+N more` is appended, where `N` is the number of suppressed events.

**AC-5.5:** A separate "Tomorrow" subsection lists up to **3** of tomorrow's events (fixed cap, not configurable in this feature). Each tomorrow event shows the same fields as AC-5.3 but in a de-emphasized style.

**AC-5.6:** When no events exist today after all filters and fetches, the Today section shows the centered empty-state text `"No events today"` instead of an event list.

**AC-5.7:** When `tomorrowEvents` is empty after filtering, the Tomorrow subsection is **omitted entirely** from the layout (no empty heading).

### US-6: As a user, I want the dashboard to show my outstanding Cortex tasks, so that I'm reminded of them passively throughout the day.

**AC-6.1:** The display queries entries where `category = 'tasks'`, `deleted_at IS NULL`, and the `fields.status` JSON path is either `'pending'` or is `'done'` with an `updated_at` within the last 24 hours. The "recently done" carve-out exists so a user gets the satisfaction of seeing a checked-off task on the next refresh.

**AC-6.2:** The query is ordered by `fields.due_date` ascending (nulls last), then by `created_at` ascending. The result is capped by the `display_max_tasks` setting (integer, default `7`).

**AC-6.3:** Each task rendered on the display includes: the entry `name`, a due-date label (see AC-6.4), and a checkbox rendered in one of three states: `pending`, `done`, or `overdue`.

**AC-6.4:** The due-date label is derived from `fields.due_date` using the configured timezone:
  - null or missing → no label
  - a date strictly in the past → the literal string `"overdue"` (task is also rendered in the `overdue` checkbox state)
  - today's date → `"due today"`
  - tomorrow's date → `"due tomorrow"`
  - any other future date → `"due <Month Abbrev> <day>"` (e.g., `"due Apr 3"`), using English month abbreviations

**AC-6.5:** Tasks in the `done` state are rendered with a filled checkbox containing a checkmark, with `text-decoration: line-through` applied to the task name. Tasks in the `overdue` state are rendered with the due-date label in bold.

**AC-6.6:** When no tasks match the query, the Tasks section shows the centered empty-state text `"All clear"` with a check icon instead of a task list.

### US-7: As a user, I want the dashboard to show the current weather and a 4-hour forecast, so that I can plan for the day.

**AC-7.1:** When both `display_weather_lat` and `display_weather_lng` settings are non-empty and parse as finite numbers, the display fetches weather from the Open-Meteo forecast API (`https://api.open-meteo.com/v1/forecast`) with the following parameters: `latitude`, `longitude`, `current=temperature_2m,weather_code`, `hourly=temperature_2m,weather_code`, `daily=temperature_2m_max,temperature_2m_min`, `timezone=<configured timezone>`, `forecast_days=1`.

**AC-7.2:** Successful responses are cached in memory for **30 minutes** keyed by `(lat, lng, timezone)`. Subsequent requests within the TTL reuse the cached value without contacting Open-Meteo.

**AC-7.3:** A network error, a non-2xx HTTP response, a timeout, or a JSON parse failure results in `getWeather()` returning `null` for the current request.

**AC-7.4:** When weather is unavailable (lat/lng not configured, not parseable, or fetch returned null), the entire weather strip is **omitted** from the rendered layout. The remaining sections expand to fill the available space.

**AC-7.5:** When weather is available, the rendered strip shows: the current temperature rounded to the nearest integer in degrees (no unit suffix in this version), a human-readable condition label, today's daily high and low, and the next 4 hourly slots (time + temperature) starting from the current hour.

**AC-7.6:** The condition label and icon are derived from the current WMO weather code using this mapping (Open-Meteo returns WMO codes directly):

| WMO code(s) | Condition label | Icon name |
|------|---|---|
| 0 | Clear | sun |
| 1 | Mainly Clear | cloud |
| 2 | Partly Cloudy | cloud |
| 3 | Overcast | cloud |
| 45, 48 | Fog | cloud |
| 51, 53, 55 | Drizzle | cloud-rain |
| 56, 57 | Freezing Drizzle | cloud-rain |
| 61, 63, 65 | Rain | cloud-rain |
| 66, 67 | Freezing Rain | cloud-rain |
| 71, 73, 75 | Snow | cloud-snow |
| 77 | Snow Grains | cloud-snow |
| 80, 81, 82 | Rain Showers | cloud-rain |
| 85, 86 | Snow Showers | cloud-snow |
| 95 | Thunderstorm | cloud-lightning |
| 96, 99 | Thunderstorm with Hail | cloud-lightning |
| any other value | Cloudy | cloud |

**AC-7.7:** Any WMO code not listed above (including unknown, future, or out-of-range values such as `999` or negative numbers) falls back to the `"Cloudy"` / `cloud` row. The fallback never throws.

### US-8: As a user with partial configuration, I want the display to render something useful even when one or more data sources are missing, so that I can adopt the feature incrementally.

**AC-8.1:** The header (Cortex branding, date, time) and the footer ("Last updated HH:MM", version label) are rendered on every successful response regardless of which data sources are configured.

**AC-8.2:** Any combination of `{weather, today events, tomorrow events, tasks}` may be empty without causing the endpoint to fail. A request with zero events, zero tasks, and no weather still returns a valid PNG with the header, footer, and empty-state messages for each section.

**AC-8.3:** A transient failure in one data source does not prevent the other sections from rendering. Specifically:
  - Weather fetch failure (AC-7.3) → weather strip omitted, calendar and tasks still render.
  - Google Calendar fetch failure → today/tomorrow events render as empty (empty state message for today, tomorrow section omitted), weather and tasks still render. A single OAuth token refresh attempt is permitted before treating the fetch as failed.
  - Task query failure (DB error) → not a graceful-degradation case; returns 500 per AC-2.4 because the Cortex DB is considered a hard dependency.

## Constraints

**C-1:** The rendering pipeline runs entirely inside the Cortex Node.js process. No external rendering service, no headless browser, no Docker service additions. The image is produced from a JSX-like element tree and converted to PNG via in-process code.

**C-2:** The only authentication mechanism is the optional `display_token` query parameter (US-3). Neither endpoint consults session cookies, HTTP basic auth, or the login middleware that protects the rest of the web UI. This is a deliberate trade-off — the TRMNL device cannot send cookies — and is the reason the feature is disabled by default.

**C-3:** The PNG endpoint produces fresh output per request (AC-2.2). Caching is delegated to the consuming client (the TRMNL device already refreshes infrequently, and any HTTP reverse proxy is free to add its own cache layer).

**C-4:** All settings keys used by this feature live in the existing `settings` table. No new tables are introduced. New keys: `display_enabled`, `display_token`, `display_weather_lat`, `display_weather_lng`, `display_max_tasks`, `display_max_today_events`, `display_calendars`, `display_width`, `display_height`, `display_base_url`.

**C-5:** Any subset of the data sources (weather, calendar, tasks) may be unconfigured, and the feature still produces a valid PNG for the configured subset plus empty states for the rest. Tasks-only, weather-only, or header-footer-only configurations are all valid.

**C-6:** The endpoints are rate-unlimited. If abuse becomes an observed problem, the user is expected to add rate limiting at the reverse-proxy layer or disable the feature. In-process rate limiting is a non-goal.

**C-7:** The layout is fixed. There is exactly one layout that combines header, optional weather strip, today events, tomorrow events, tasks, and footer. Users cannot configure which sections appear or in what order; the only runtime flex is width/height and which sections are omitted due to missing data.

**C-8:** All time values shown on the display are formatted in the timezone from the existing `timezone` settings key (the same key used by the digest scheduler). If the timezone setting is missing, `Europe/Berlin` is used as the hardcoded default.

**C-9:** Both endpoints must bypass the setup middleware's `no-user → /setup` redirect and the authentication middleware's `not-logged-in → /login` redirect. They are the only endpoints in the Cortex app (besides `/health` and static assets under `/public/`) that are reachable without any session cookie. This bypass is intentional and must be listed in the setup middleware's allowlist alongside `/health` and `/public/`.

## Edge Cases

**E-1:** **All three data sources unconfigured** (no weather lat/lng, no Google Calendar OAuth, no tasks in DB) → endpoint returns HTTP 200 with a valid PNG containing the header, footer, and empty-state messages for the sections that have data (`"No events today"`, `"All clear"`). The weather strip is omitted entirely per AC-7.4.

**E-2:** **Google Calendar access token expired mid-request** → the calendar fetch layer performs exactly one OAuth refresh attempt using the stored refresh token. If the refresh succeeds and the retry succeeds, events are rendered normally. If either step fails, the events list for that calendar is treated as empty and the other sections continue rendering.

**E-3:** **Very long event or task names** → text is truncated at the container boundary with an ellipsis. The overflow must not cause the containing row to wrap, push neighboring elements off-screen, or break the layout dimensions.

**E-4:** **More than `display_max_today_events` today events** (default 8) → the first `max` events in chronological order are rendered and an overflow line reading `+N more` is appended where `N` is the count of suppressed events. `N` is always at least 1 when the overflow line appears.

**E-5:** **Open-Meteo unreachable with no cache entry** → weather is `null` for this request and the weather strip is omitted (AC-7.4). The endpoint still returns 200 with the other sections. A cache entry from a previous successful fetch (even if older than the 30-minute TTL) is **not** used as a stale fallback in the current implementation — stale-while-error is a non-goal and left to a future iteration.

**E-6:** **WMO weather code not in the mapping table** (including values like `4`, `10`, `42`, `100`, `999`, or negative numbers) → falls back to the `"Cloudy"` / `cloud` row. This fallback is reachable and must not throw.

**E-7:** **Invalid JSON in `display_calendars` setting** → the invalid value is treated as "no filter" (all configured calendars are included). A JSON parse error is logged at `WARN` level but the endpoint still returns 200.

**E-8:** **Event with no `summary` field** returned by the Google Calendar API → the event is still included in the list with a fallback name (e.g., empty string or `"(no title)"`). The event must not cause the fetch to crash, nor be silently dropped.

**E-9:** **`display_token` set but request omits or mismatches the `?token=` parameter** → HTTP 403 per AC-3.2. The comparison uses constant-time equality (AC-3.3).

**E-10:** **`display_weather_lat` / `display_weather_lng` set to unparseable strings** (e.g., `"abc"`, `""`) → `parseFloat` returns `NaN` / empty, treated as "not configured," weather strip omitted, no API call made.

**E-11:** **`display_base_url` points to a different origin than the incoming request** → used as given; the spec does not attempt to validate the override against the request context. Users who set this override are responsible for supplying a reachable URL.

**E-12:** **Invalid `display_width` / `display_height`** (non-numeric, zero, or negative) → the `parseInt` call yields the defaults (1872 / 1404) if the value is missing, but does not validate the parsed result. Implementations should treat any non-positive value as an error and fall back to the default. (Flagged as a hardening item, not a strict contract in this iteration.)

## Non-Goals

**NG-1:** **Session-based authentication on the display endpoints.** The TRMNL device cannot send cookies. The only protection mechanisms are (a) disabled-by-default (US-1), (b) optional token (US-3), and (c) the operator's network perimeter.

**NG-2:** **Color mode.** The current layout targets grayscale e-paper. A color palette toggle is explicitly deferred to a future iteration.

**NG-3:** **Multiple display profiles** (kitchen layout, office layout, bedside layout). Exactly one layout is produced. A future iteration may introduce per-device profiles.

**NG-4:** **Webhook push to an external TRMNL cloud service.** The current model is pull-only: the TRMNL device polls `/api/display` and fetches the PNG. Integrating with the hosted TRMNL service as a push target is out of scope.

**NG-5:** **User-configurable layout** (which sections appear, in what order, with what sizing). The layout is fixed per C-7.

**NG-6:** **Shared family-writable sections** (grocery list, shared notes). A future iteration may add a family-writable section populated via Telegram or the webapp.

**NG-7:** **HTTP-level caching of the rendered PNG.** Per AC-2.2, each request triggers a fresh render. Adding an HTTP cache layer (ETag, Last-Modified, or a server-side bytes cache) is out of scope.

**NG-8:** **In-process rate limiting** per C-6. Abuse protection is delegated to the reverse-proxy layer or to the on/off setting.

**NG-9:** **Stale-while-error fallback for weather.** Per E-5, a failed weather fetch with no fresh cache entry results in the weather strip being omitted for that request rather than reusing a stale cached value.

**NG-10:** **HTTPS-only enforcement.** The endpoints accept plain HTTP. Users who want TLS put Cortex behind a reverse proxy with TLS termination (e.g., Caddy, nginx).

## Open Questions

None.

## Known Gaps — Historical (all RESOLVED in Phase 5 on 2026-04-15)

During Phase 1 drafting, five categories of gap between the spec and the `src/display/` code were flagged for the review phase. Phase 4 test implementation surfaced a sixth (KG-2a, seven additional WMO label mismatches not spotted during drafting). All six categories have since been closed by Phase 5 code fixes. This section is retained for traceability.

| ID | Description | Spec anchor | Resolution |
|---|---|---|---|
| KG-1 | WMO codes 85, 86 (snow showers) fell through to "Cloudy" | AC-7.6 | `src/display/weather-data.ts` mapping extended |
| KG-2 | WMO codes 96, 99 (thunderstorm with hail) fell through to "Cloudy" | AC-7.6 | `src/display/weather-data.ts` mapping extended |
| KG-2a | WMO codes 1, 3, 56, 57, 66, 67, 77 mapped to coarser neighboring labels | AC-7.6 | `src/display/weather-data.ts` mapping corrected to full AC-7.6 table |
| KG-3 | `display_max_today_events` setting not read; hardcoded to 8 | AC-5.4 | `src/display/index.ts` now parses the setting (default 8) |
| KG-4 | `display_base_url` override not implemented | AC-4.5 | `src/display/index.ts` now honors the setting with trailing-slash tolerance |
| KG-5 | Width/height did not validate zero/negative values | E-12 | `src/display/index.ts` now falls back to defaults 1872 × 1404 when parsed values are non-positive or non-finite |

**C-9 setup-middleware allowlist** is implemented in `src/web/setup.ts` for `/api/kitchen.png` and `/api/display`. This satisfies the constraint but the exemption is undocumented in the onboarding spec (tracked separately as onboarding review finding F-3). No action required on the kitchen-display side.
