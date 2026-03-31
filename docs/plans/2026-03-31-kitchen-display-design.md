# Kitchen Display — Design Specification

| Field | Value |
|-------|-------|
| Date | 2026-03-31 |
| Status | Draft |
| Reference | `design/components/kitchen-dashboard.tsx` (visual prototype) |

## Overview

A server-rendered image endpoint that produces a kitchen dashboard PNG. The image combines Google Calendar events, Cortex tasks, and weather data into a single glanceable display. Designed for e-paper devices (TRMNL X at 1872x1404, 16 grayscale, portrait) but usable anywhere — tablets, digital frames, Home Assistant embeds, or a browser bookmark.

The rendering pipeline lives entirely inside Cortex. No external rendering service.

## Design Direction

**Aesthetic:** "Classified Briefing" — an extension of Cortex's Terminal / Command Center identity, adapted for e-paper. Everything in JetBrains Mono. Dramatic typographic scale (64px temperature vs 14px footer). High contrast black-on-light. Thin 1px rules as section dividers. No decoration, no gradients, no rounded corners beyond 4px. The density of a well-typeset broadsheet, the clarity of a military status board.

**Memorable quality:** The monospace typographic hierarchy. Information arranged with the precision of a train departure board — every character aligned, every pixel of whitespace intentional.

**Visual reference:** `design/components/kitchen-dashboard.tsx` is the exact layout to replicate. The React/Tailwind prototype serves as the pixel reference. Implementation uses Satori (not React).

## Architecture

```
                                    ┌─────────────────────────┐
                                    │   Open-Meteo API        │
                                    │   (weather forecast)    │
                                    └──────────┬──────────────┘
                                               │
┌───────────────┐    GET /api/display    ┌─────┴───────────────┐     GET /api/kitchen.png
│  TRMNL X      │◄───────────────────────│   Cortex Server     │◄────────────────────────  Any client
│  (e-paper)    │    { image_url: ... }  │   (Hono)            │     returns PNG
└───────────────┘                        │                     │
                                         │  ┌───────────────┐  │
                                         │  │ Satori        │  │
                                         │  │ (JSX → SVG)   │  │
                                         │  │       ↓       │  │
                                         │  │ @resvg/wasm   │  │
                                         │  │ (SVG → PNG)   │  │
                                         │  └───────────────┘  │
                                         │                     │
                                         │  Data sources:      │
                                         │  • Google Calendar   │
                                         │  • Cortex DB (tasks) │
                                         │  • Open-Meteo       │
                                         └─────────────────────┘
```

### Endpoints

**`GET /api/kitchen.png`** — Returns the rendered kitchen dashboard as a PNG image.

- Content-Type: `image/png`
- Dimensions: 1872x1404 (configurable via settings for other devices)
- No authentication required (for TRMNL BYOS compatibility — device cannot send cookies)
- Optional: `?token=<secret>` query param for security if the user exposes it to the network
- Cache: generates fresh on each request, no caching (e-paper refreshes infrequently)

**`GET /api/display`** — TRMNL BYOS adapter. Returns JSON the TRMNL device expects.

```json
{
  "image_url": "http://<host>:3000/api/kitchen.png",
  "filename": "cortex-kitchen"
}
```

- The TRMNL device calls this endpoint on wake, gets the image URL, fetches the PNG, displays it, sleeps.
- No authentication (device cannot send cookies).

### Security

Both endpoints are unauthenticated by design — the TRMNL device has no ability to send session cookies or auth headers. Protection options:

1. **Network-level:** Only expose on LAN (default Docker setup, no port forwarding)
2. **Token-based:** Optional `display_token` setting. When set, requests require `?token=<value>`. Configured once in TRMNL's device URL.
3. **Disable:** `display_enabled` setting (default: false). Endpoints return 404 when disabled.

## Data Sources

### 1. Google Calendar Events

Reuse the existing Google Calendar integration (`src/google-calendar.ts`).

**Data needed:**
- Today's events: all events from 00:00 to 23:59 local time
- Tomorrow's events: first 3 events from tomorrow

**Fields per event:**
- `time` — start time formatted as HH:MM (24h)
- `name` — event summary/title
- `calendar` — calendar display name (from multi-calendar config, e.g., "FAMILY", "WORK")

**Source:** Google Calendar API `events.list` with `timeMin`/`timeMax` filters. Uses the existing OAuth2 token refresh logic.

**New code:** `src/display/calendar-data.ts` — a function `getDisplayEvents(sql): Promise<{ today: Event[], tomorrow: Event[] }>` that fetches events from all configured calendars, merges, and sorts by time.

**When no calendars are configured:** The "TODAY" section shows a centered message: "No calendars configured. Add in Settings."

### 2. Cortex Tasks

Query the entries table for pending tasks.

**Data needed:**
- Tasks with `category = 'tasks'` and `fields->>'status' = 'pending'` and `deleted_at IS NULL`
- Ordered by due date (soonest first), then by `created_at`
- Limit: 7 tasks (configurable via `display_max_tasks` setting, default 7)

**Fields per task:**
- `name` — entry name
- `due` — formatted relative date from `fields->>'due_date'` (e.g., "due Apr 3", "overdue", or null)
- `done` — boolean, true when `fields->>'status' = 'done'`

**Also include:** recently completed tasks (status = 'done', updated in last 24h) — shown with a filled checkbox. This gives the satisfying "checked off" feeling on the display.

**Source:** Direct SQL query against entries table. No new table needed.

**New code:** `src/display/task-data.ts` — a function `getDisplayTasks(sql, limit): Promise<Task[]>`.

### 3. Weather (Open-Meteo)

**API:** `https://api.open-meteo.com/v1/forecast`

**Request parameters:**
```
latitude=<from settings>
longitude=<from settings>
current=temperature_2m,weather_code
hourly=temperature_2m,weather_code
daily=temperature_2m_max,temperature_2m_min
timezone=<from settings>
forecast_days=1
```

**Data needed:**
- `current.temperature` — current temperature (rounded to integer)
- `current.condition` — human-readable condition derived from WMO weather code
- `daily.high` / `daily.low` — today's high and low
- `hourly` — next 4 hours from now (time + temp)

**WMO weather code mapping** (subset for display):

| Code | Condition | Icon |
|------|-----------|------|
| 0 | Clear | sun |
| 1-3 | Partly Cloudy / Cloudy | cloud |
| 45, 48 | Fog | cloud |
| 51-57 | Drizzle | cloud-rain |
| 61-67 | Rain | cloud-rain |
| 71-77 | Snow | cloud-snow |
| 80-82 | Rain showers | cloud-rain |
| 95-99 | Thunderstorm | cloud-lightning |

**Caching:** Weather data is cached in memory for 30 minutes. No point hitting the API on every image request — weather doesn't change that fast, and the e-paper only refreshes every 15-60 minutes anyway.

**New code:** `src/display/weather-data.ts` — a function `getWeather(lat, lng, timezone): Promise<WeatherData>` with in-memory TTL cache.

**When weather is not configured (no lat/lng):** The weather strip is omitted entirely. The layout adjusts — calendar section gets more vertical space.

## Rendering Pipeline

### Technology

- **Satori** (`satori` npm package) — converts a JSX-like element tree to SVG. Supports flexbox layout, text styling, borders, backgrounds. Does not require React at runtime.
- **@resvg/resvg-wasm** — converts SVG to PNG. Pure WebAssembly, no native dependencies, runs in Node.js.
- **JetBrains Mono** — font loaded as ArrayBuffer at startup, passed to Satori. Both weights 400 and 500.

### Render function

```typescript
// src/display/render.ts
export async function renderKitchenDisplay(data: KitchenData): Promise<Buffer>
```

1. Assemble the JSX element tree from `data` (calendar events, tasks, weather)
2. Pass to Satori with font config → SVG string
3. Pass SVG to Resvg → PNG buffer
4. Return buffer

The JSX tree is written as plain `satori`-compatible markup (no React dependency). Satori uses a React-like `createElement` syntax but does not require React.

### Layout specification

Matches `design/components/kitchen-dashboard.tsx` exactly. All values in pixels at the native 1872x1404 resolution.

**Container:** 1872x1404, background `#f5f5f5`, text `#1a1a1a`, padding 48px (p-12), flex column.

**1. Header bar** (flex, justify-between, padding-bottom 24px, border-bottom 1px `#1a1a1a`)
- Left: Brain icon (32x32, stroke-width 1.5) + "cortex" (32px, weight 500, tracking wide)
- Right: Date string (24px, "Monday, March 31") + time (24px, weight 500, "07:30")

**2. Weather strip** (padding-y 32px, border-bottom 1px `#1a1a1a`)
- Left group: weather icon (48x48) + temperature (64px, weight 300, leading none) + condition (20px, `#888`) + high/low (20px, `#888`, left border 1px `#ccc`, padding-left 40px)
- Right group: 4 hourly slots, each: time (18px, `#888`) + temp (22px), gap 32px between slots
- When weather not configured: entire section omitted

**3. Main content area** (flex-1, flex row, gap 48px, padding-top 32px)

- **Left: Today's schedule** (flex-2)
  - Section header: Calendar icon (24x24) + "TODAY" (24px, weight 500, tracking 0.15em, uppercase) + 1px rule below
  - Event rows: time (22px, `#888`, width 100px) + name (26px) + calendar badge (14px, border 1px `#888`, text `#888`, padding 1px 8px, rounded 2px, tracking wider)
  - Spacing: 20px between event rows
  - Tomorrow subsection: top border 1px `#ccc`, margin-top 40px, padding-top 32px
    - "TOMORROW" label (20px, weight 500, tracking 0.15em, `#888`)
    - Events: time (18px, `#888`) + name (20px, `#555`) + calendar badge
  - When no events today: centered "No events today" (22px, `#888`, italic)

- **Right: Tasks** (flex-1, left border 1px `#ccc`, padding-left 48px)
  - Section header: CheckSquare icon (24x24) + "DON'T FORGET" (24px, weight 500, tracking 0.15em, uppercase) + 1px rule below
  - Task rows: checkbox (24x24, border 2px `#1a1a1a`, rounded 2px) + name (22px) + due (16px, `#888`)
  - Checkbox states:
    - `pending`: empty box (border only)
    - `done`: filled box (`#1a1a1a` background) with white checkmark, name has line-through, text `#888`
    - `overdue`: empty box with border `#1a1a1a`, due text is bold
  - Spacing: 20px between task rows
  - When no tasks: centered "All clear" (22px, `#888`, italic) with a check icon

**4. Footer** (padding-top 24px, border-top 1px `#1a1a1a`, flex justify-between)
- Left: "Last updated HH:MM" (14px, `#888`)
- Right: "cortex v0.1" (14px, `#888`)

### Icons

Satori renders SVG path data directly. The icons needed are:

| Icon | Source | Usage |
|------|--------|-------|
| Brain | Lucide | Header logo |
| Calendar | Lucide | Today section header |
| CheckSquare | Lucide | Tasks section header |
| Check | Lucide | Filled checkbox checkmark |
| Sun | Lucide | Weather: clear |
| Cloud | Lucide | Weather: cloudy/fog |
| CloudRain | Lucide | Weather: rain/drizzle |
| CloudSnow | Lucide | Weather: snow |
| CloudLightning | Lucide | Weather: thunderstorm |

Icons are defined as SVG path strings in `src/display/icons.ts` (separate from `src/web/icons.ts` — Satori needs raw path data, not HTML strings).

### Font loading

JetBrains Mono `.ttf` files (weights 400, 500) are bundled in `src/display/fonts/`. Loaded as `ArrayBuffer` at startup and passed to Satori's `fonts` option. Downloaded once at build time or first startup from Google Fonts CDN.

## Settings

New settings keys stored in the `settings` table, configured via the Settings page (`/settings`):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `display_enabled` | boolean | `false` | Enable the kitchen display endpoints |
| `display_token` | string | (empty) | Optional auth token for `/api/kitchen.png?token=` |
| `display_weather_lat` | string | (empty) | Latitude for weather (e.g., "52.52") |
| `display_weather_lng` | string | (empty) | Longitude for weather (e.g., "13.41") |
| `display_max_tasks` | number | `7` | Maximum tasks to show |
| `display_calendars` | JSON | `[]` | Which Google Calendar names to include (empty = all) |
| `display_width` | number | `1872` | Image width in pixels |
| `display_height` | number | `1404` | Image height in pixels |

### Settings UI

New section on the Settings page: **"Kitchen Display"** — placed after the Google Calendar section.

Fields:
- **Enable display** — toggle switch
- **Security token** — text input (optional, shown when enabled)
- **Weather location** — two text inputs: latitude, longitude. Helper text: "Find your coordinates at open-meteo.com"
- **Max tasks** — number input
- **Calendars** — checkboxes for each configured Google Calendar name. "All" checkbox for convenience.
- **Display size** — two number inputs: width, height. Preset buttons: "TRMNL X (1872x1404)", "TRMNL OG (800x480)"

The settings section is always visible. Calendar checkboxes are only shown when Google Calendars are configured. The display works with any subset of data sources — tasks-only or weather-only are valid configurations.

## File Structure

```
src/display/
├── index.ts              # Hono routes: GET /api/kitchen.png, GET /api/display
├── render.ts             # Satori + Resvg rendering pipeline
├── layout.ts             # JSX element tree builder (the visual layout)
├── icons.ts              # SVG path data for Satori (Brain, Calendar, weather icons)
├── calendar-data.ts      # Google Calendar event fetching
├── task-data.ts          # Cortex task querying
├── weather-data.ts       # Open-Meteo API + 30min cache
└── fonts/
    ├── JetBrainsMono-Regular.ttf
    └── JetBrainsMono-Medium.ttf
```

Routes wired in `src/index.ts`:

```typescript
import { createDisplayRoutes } from "./display/index.js";
// ...
app.route("/", createDisplayRoutes(sql));
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `satori` | JSX → SVG rendering |
| `@resvg/resvg-wasm` | SVG → PNG conversion (WASM, no native deps) |

No new runtime services. No headless browser. No Docker image changes.

## TRMNL BYOS Setup

User instructions (for docs/README):

1. Enable "Kitchen Display" in Cortex Settings
2. During TRMNL device WiFi setup, change the server URL from `trmnl.com` to `http://<cortex-ip>:3000`
3. The device will call `GET /api/display`, receive the image URL, and render it
4. Refresh interval is controlled by the TRMNL device firmware settings

## Edge Cases

**Google Calendar token expired:** Show events section with message "Calendar unavailable — check Settings". Do not fail the entire render.

**Open-Meteo unreachable:** Use cached weather if available (even if stale). If no cache, omit weather strip entirely.

**No tasks, no events, no weather:** Show the header, an empty state message ("Your day is clear"), and the footer. Still a valid PNG.

**Very long event names:** Truncate with ellipsis at the container boundary. Satori supports `textOverflow: 'ellipsis'` with `overflow: 'hidden'`.

**Many events (>8):** Show first 8 today events. Add a "+N more" line at the bottom of the list.

**Timezone:** All times formatted in the configured timezone from settings (`timezone` key). This is already resolved by the existing `config.timezone` pattern.

## Future Extensions (not in scope now)

- **Color mode:** Settings toggle for color vs grayscale. Swap the palette at render time (same layout).
- **Multiple display profiles:** Different layouts for different devices (kitchen, office, bedside).
- **Webhook push:** Proactively POST to TRMNL cloud for users who don't want BYOS.
- **Custom sections:** User-configurable layout (which sections, in what order).
- **Grocery list / shared notes:** A family-writable section synced via Telegram or webapp.
