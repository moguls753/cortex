# Kitchen Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-rendered PNG kitchen dashboard endpoint that combines Google Calendar events, Cortex tasks, and Open-Meteo weather into a single image for e-paper displays.

**Architecture:** Satori converts a JSX element tree to SVG, @resvg/resvg-wasm converts SVG to PNG. Data is assembled from three sources (Google Calendar API, Cortex DB, Open-Meteo API) and rendered on each request. A TRMNL BYOS adapter wraps the image URL in the JSON format the device expects.

**Tech Stack:** Satori, @resvg/resvg-wasm, Open-Meteo API, JetBrains Mono TTF fonts, Hono routes, Vitest

**Design spec:** `docs/plans/2026-03-31-kitchen-display-design.md`
**Visual reference:** `design/components/kitchen-dashboard.tsx`

---

## File Structure

```
src/display/
├── index.ts              # Hono routes: GET /api/kitchen.png, GET /api/display
├── render.ts             # Satori + Resvg rendering pipeline
├── layout.ts             # JSX element tree builder (the visual layout)
├── icons.ts              # SVG path data for Satori
├── calendar-data.ts      # Google Calendar event list fetching
├── task-data.ts          # Cortex task querying
├── weather-data.ts       # Open-Meteo API client + 30min cache
├── types.ts              # Shared types (KitchenData, DisplayEvent, DisplayTask, WeatherData)
└── fonts/
    ├── JetBrainsMono-Regular.ttf
    └── JetBrainsMono-Medium.ttf

tests/unit/
├── display-weather.test.ts
├── display-tasks.test.ts
├── display-calendar.test.ts
├── display-render.test.ts
└── display-routes.test.ts
```

---

### Task 1: Install dependencies and download fonts

**Files:**
- Modify: `package.json`
- Create: `src/display/fonts/JetBrainsMono-Regular.ttf`
- Create: `src/display/fonts/JetBrainsMono-Medium.ttf`

- [ ] **Step 1: Install satori and resvg-wasm**

```bash
npm install satori @resvg/resvg-wasm
```

- [ ] **Step 2: Download JetBrains Mono TTF files**

```bash
mkdir -p src/display/fonts
curl -L "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf" -o src/display/fonts/JetBrainsMono-Regular.ttf
curl -L "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Medium.ttf" -o src/display/fonts/JetBrainsMono-Medium.ttf
```

- [ ] **Step 3: Verify fonts exist**

```bash
ls -la src/display/fonts/
```

Expected: Two `.ttf` files, each ~200-300 KB.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/display/fonts/
git commit -m "chore: add satori, resvg-wasm, and JetBrains Mono fonts for kitchen display"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/display/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/display/types.ts

export interface DisplayEvent {
  time: string;       // "08:30"
  name: string;       // "Dentist — Mila"
  calendar: string;   // "FAMILY"
}

export interface DisplayTask {
  name: string;       // "Renew passport"
  due: string | null;  // "due Apr 3", "overdue", or null
  done: boolean;
}

export interface WeatherData {
  current: number;          // 14  (rounded integer °C)
  condition: string;        // "Partly Cloudy"
  weatherCode: number;      // WMO code for icon selection
  high: number;
  low: number;
  hourly: Array<{ time: string; temp: number }>;  // next 4 hours
}

export interface KitchenData {
  date: string;             // "Monday, March 31"
  time: string;             // "07:30"
  weather: WeatherData | null;
  todayEvents: DisplayEvent[];
  tomorrowEvents: DisplayEvent[];
  tasks: DisplayTask[];
  maxTodayEvents: number;   // 8
}
```

- [ ] **Step 2: Commit**

```bash
git add src/display/types.ts
git commit -m "feat(display): add shared types for kitchen display data"
```

---

### Task 3: Weather data module

**Files:**
- Create: `src/display/weather-data.ts`
- Create: `tests/unit/display-weather.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/display-weather.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { getWeather, mapWeatherCode, clearWeatherCache } from "../../src/display/weather-data.js";

afterEach(() => {
  vi.restoreAllMocks();
  clearWeatherCache();
});

describe("mapWeatherCode", () => {
  it("maps code 0 to Clear", () => {
    expect(mapWeatherCode(0)).toEqual({ condition: "Clear", icon: "sun" });
  });

  it("maps code 2 to Partly Cloudy", () => {
    expect(mapWeatherCode(2)).toEqual({ condition: "Partly Cloudy", icon: "cloud" });
  });

  it("maps code 61 to Rain", () => {
    expect(mapWeatherCode(61)).toEqual({ condition: "Rain", icon: "cloud-rain" });
  });

  it("maps code 71 to Snow", () => {
    expect(mapWeatherCode(71)).toEqual({ condition: "Snow", icon: "cloud-snow" });
  });

  it("maps code 95 to Thunderstorm", () => {
    expect(mapWeatherCode(95)).toEqual({ condition: "Thunderstorm", icon: "cloud-lightning" });
  });

  it("maps unknown code to Cloudy", () => {
    expect(mapWeatherCode(999)).toEqual({ condition: "Cloudy", icon: "cloud" });
  });
});

describe("getWeather", () => {
  const mockApiResponse = {
    current: { temperature_2m: 14.3, weather_code: 2 },
    hourly: {
      time: [
        "2026-03-31T06:00", "2026-03-31T07:00", "2026-03-31T08:00",
        "2026-03-31T09:00", "2026-03-31T10:00", "2026-03-31T11:00",
      ],
      temperature_2m: [11.2, 12.5, 13.1, 14.0, 15.3, 16.1],
    },
    daily: {
      temperature_2m_max: [18.4],
      temperature_2m_min: [8.7],
    },
  };

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    });
  });

  it("fetches weather and returns formatted data", async () => {
    const result = await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(result).not.toBeNull();
    expect(result!.current).toBe(14);
    expect(result!.condition).toBe("Partly Cloudy");
    expect(result!.weatherCode).toBe(2);
    expect(result!.high).toBe(18);
    expect(result!.low).toBe(9);
    expect(result!.hourly).toHaveLength(4);
    expect(result!.hourly[0]).toHaveProperty("time");
    expect(result!.hourly[0]).toHaveProperty("temp");
  });

  it("returns cached data on second call", async () => {
    await getWeather(52.52, 13.41, "Europe/Berlin");
    await getWeather(52.52, 13.41, "Europe/Berlin");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");
    expect(result).toBeNull();
  });

  it("returns null when API returns non-ok status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const result = await getWeather(52.52, 13.41, "Europe/Berlin");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/display-weather.test.ts
```

Expected: FAIL — module `../../src/display/weather-data.js` not found.

- [ ] **Step 3: Implement weather-data.ts**

```typescript
// src/display/weather-data.ts
import type { WeatherData } from "./types.js";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cachedWeather: WeatherData | null = null;
let cacheTimestamp = 0;

export function clearWeatherCache(): void {
  cachedWeather = null;
  cacheTimestamp = 0;
}

export function mapWeatherCode(code: number): { condition: string; icon: string } {
  if (code === 0) return { condition: "Clear", icon: "sun" };
  if (code >= 1 && code <= 3) return { condition: "Partly Cloudy", icon: "cloud" };
  if (code === 45 || code === 48) return { condition: "Fog", icon: "cloud" };
  if (code >= 51 && code <= 57) return { condition: "Drizzle", icon: "cloud-rain" };
  if (code >= 61 && code <= 67) return { condition: "Rain", icon: "cloud-rain" };
  if (code >= 71 && code <= 77) return { condition: "Snow", icon: "cloud-snow" };
  if (code >= 80 && code <= 82) return { condition: "Rain Showers", icon: "cloud-rain" };
  if (code >= 95 && code <= 99) return { condition: "Thunderstorm", icon: "cloud-lightning" };
  return { condition: "Cloudy", icon: "cloud" };
}

export async function getWeather(
  lat: number,
  lng: number,
  timezone: string,
): Promise<WeatherData | null> {
  // Return cached data if fresh
  if (cachedWeather && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedWeather;
  }

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current: "temperature_2m,weather_code",
      hourly: "temperature_2m",
      daily: "temperature_2m_max,temperature_2m_min",
      timezone,
      forecast_days: "1",
    });

    const res = await fetch(`${OPEN_METEO_BASE}?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return cachedWeather; // return stale cache or null

    const data = (await res.json()) as {
      current: { temperature_2m: number; weather_code: number };
      hourly: { time: string[]; temperature_2m: number[] };
      daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };

    // Find the next 4 hours from now
    const now = new Date();
    const currentHour = now.getHours();
    const hourly: Array<{ time: string; temp: number }> = [];

    for (let i = 0; i < data.hourly.time.length && hourly.length < 4; i++) {
      const hourStr = data.hourly.time[i];
      const hour = new Date(hourStr).getHours();
      if (hour > currentHour) {
        hourly.push({
          time: hourStr.split("T")[1].substring(0, 5), // "HH:MM"
          temp: Math.round(data.hourly.temperature_2m[i]),
        });
      }
    }

    const { condition } = mapWeatherCode(data.current.weather_code);

    const weather: WeatherData = {
      current: Math.round(data.current.temperature_2m),
      condition,
      weatherCode: data.current.weather_code,
      high: Math.round(data.daily.temperature_2m_max[0]),
      low: Math.round(data.daily.temperature_2m_min[0]),
      hourly,
    };

    cachedWeather = weather;
    cacheTimestamp = Date.now();
    return weather;
  } catch {
    return cachedWeather; // return stale cache or null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/display-weather.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/display/weather-data.ts tests/unit/display-weather.test.ts
git commit -m "feat(display): add Open-Meteo weather data module with 30min cache"
```

---

### Task 4: Task data module

**Files:**
- Create: `src/display/task-data.ts`
- Create: `tests/unit/display-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/display-tasks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDisplayTasks, formatDueDate } from "../../src/display/task-data.js";

describe("formatDueDate", () => {
  it("returns null when no due date", () => {
    expect(formatDueDate(null, new Date("2026-03-31"))).toBeNull();
  });

  it("formats a future date", () => {
    expect(formatDueDate("2026-04-03", new Date("2026-03-31"))).toBe("due Apr 3");
  });

  it("returns 'today' for same day", () => {
    expect(formatDueDate("2026-03-31", new Date("2026-03-31"))).toBe("due today");
  });

  it("returns 'tomorrow' for next day", () => {
    expect(formatDueDate("2026-04-01", new Date("2026-03-31"))).toBe("due tomorrow");
  });

  it("returns 'overdue' for past date", () => {
    expect(formatDueDate("2026-03-28", new Date("2026-03-31"))).toBe("overdue");
  });
});

describe("getDisplayTasks", () => {
  it("queries pending tasks and recently completed tasks", async () => {
    const mockRows = [
      { name: "Renew passport", fields: { status: "pending", due_date: "2026-04-03" }, updated_at: new Date() },
      { name: "Buy milk", fields: { status: "pending", due_date: null }, updated_at: new Date() },
      { name: "Call dentist", fields: { status: "done", due_date: null }, updated_at: new Date() },
    ];

    // Create a mock sql tagged template function
    const sql = vi.fn().mockResolvedValue(mockRows) as any;
    sql.unsafe = vi.fn().mockResolvedValue(mockRows);

    const result = await getDisplayTasks(sql, 7);

    expect(result.length).toBe(3);
    expect(result[0].name).toBe("Renew passport");
    expect(result[0].done).toBe(false);
    expect(result[2].name).toBe("Call dentist");
    expect(result[2].done).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/display-tasks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement task-data.ts**

```typescript
// src/display/task-data.ts
import type postgres from "postgres";
import type { DisplayTask } from "./types.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDueDate(dueDate: string | null, now: Date): string | null {
  if (!dueDate) return null;

  const due = new Date(dueDate + "T00:00:00");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "due today";
  if (diffDays === 1) return "due tomorrow";

  return `due ${MONTHS[due.getMonth()]} ${due.getDate()}`;
}

export async function getDisplayTasks(
  sql: postgres.Sql,
  limit: number,
): Promise<DisplayTask[]> {
  const now = new Date();

  // Pending tasks + recently completed (last 24h)
  const rows = await sql`
    SELECT name, fields, updated_at
    FROM entries
    WHERE category = 'tasks'
      AND deleted_at IS NULL
      AND (
        (fields->>'status' = 'pending')
        OR (fields->>'status' = 'done' AND updated_at > now() - interval '24 hours')
      )
    ORDER BY
      CASE WHEN fields->>'status' = 'pending' THEN 0 ELSE 1 END,
      CASE WHEN fields->>'due_date' IS NOT NULL THEN 0 ELSE 1 END,
      fields->>'due_date' ASC NULLS LAST,
      created_at ASC
    LIMIT ${limit}
  `;

  return rows.map((row: { name: string; fields: Record<string, unknown> }) => ({
    name: row.name,
    due: formatDueDate((row.fields.due_date as string) || null, now),
    done: row.fields.status === "done",
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/display-tasks.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/display/task-data.ts tests/unit/display-tasks.test.ts
git commit -m "feat(display): add task data module for kitchen display"
```

---

### Task 5: Calendar data module

**Files:**
- Create: `src/display/calendar-data.ts`
- Create: `tests/unit/display-calendar.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/display-calendar.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/google-calendar.js", () => ({
  resolveCalendarConfig: vi.fn().mockResolvedValue({
    calendarId: "primary",
    accessToken: "test-token",
    refreshToken: "test-refresh",
    clientId: "test-client",
    clientSecret: "test-secret",
    defaultDuration: 60,
    calendars: { Personal: "primary", Work: "work@group.calendar.google.com" },
    defaultCalendar: "Personal",
  }),
  refreshAccessToken: vi.fn().mockResolvedValue({
    accessToken: "new-token",
    refreshToken: null,
  }),
}));

vi.mock("../../src/web/settings-queries.js", () => ({
  saveAllSettings: vi.fn().mockResolvedValue(undefined),
  getAllSettings: vi.fn().mockResolvedValue({}),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { getDisplayEvents } from "../../src/display/calendar-data.js";

describe("getDisplayEvents", () => {
  const mockCalendarResponse = {
    items: [
      {
        summary: "Dentist — Mila",
        start: { dateTime: "2026-03-31T08:30:00+02:00" },
      },
      {
        summary: "Sprint Planning",
        start: { dateTime: "2026-03-31T10:00:00+02:00" },
      },
    ],
  };

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCalendarResponse),
    });
  });

  it("fetches today and tomorrow events from all calendars", async () => {
    const sql = vi.fn() as any;
    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today.length).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalled();
    // Verify the fetch URL includes calendar API base
    const firstCallUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain("googleapis.com/calendar/v3");
  });

  it("returns empty arrays when calendar is not configured", async () => {
    const { resolveCalendarConfig } = await import("../../src/google-calendar.js");
    vi.mocked(resolveCalendarConfig).mockResolvedValueOnce({
      calendarId: "",
      accessToken: "",
      refreshToken: "",
      clientId: "",
      clientSecret: "",
      defaultDuration: 60,
    });

    const sql = vi.fn() as any;
    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
  });

  it("returns empty arrays when fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    const sql = vi.fn() as any;
    const result = await getDisplayEvents(sql, "Europe/Berlin");

    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/display-calendar.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement calendar-data.ts**

```typescript
// src/display/calendar-data.ts
import type postgres from "postgres";
import type { DisplayEvent } from "./types.js";
import {
  resolveCalendarConfig,
  refreshAccessToken,
} from "../google-calendar.js";
import { saveAllSettings } from "../web/settings-queries.js";
import { createLogger } from "../logger.js";

const log = createLogger("display-calendar");

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

interface CalendarApiEvent {
  summary?: string;
  start?: { dateTime?: string; date?: string };
}

async function fetchEventsForCalendar(
  calendarId: string,
  calendarName: string,
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<DisplayEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`Calendar API ${res.status}`);

  const data = (await res.json()) as { items?: CalendarApiEvent[] };
  return (data.items || [])
    .filter((e) => e.summary && e.start)
    .map((e) => {
      let time = "";
      if (e.start!.dateTime) {
        const d = new Date(e.start!.dateTime);
        time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      } else {
        time = "all day";
      }
      return {
        time,
        name: e.summary!,
        calendar: calendarName.toUpperCase(),
      };
    });
}

export async function getDisplayEvents(
  sql: postgres.Sql,
  timezone: string,
  selectedCalendars?: string[],
): Promise<{ today: DisplayEvent[]; tomorrow: DisplayEvent[] }> {
  const empty = { today: [], tomorrow: [] };

  try {
    const config = await resolveCalendarConfig(sql);
    if (!config.calendarId || (!config.refreshToken && !config.accessToken)) {
      return empty;
    }

    let accessToken = config.accessToken;

    // Build calendar list: multi-calendar or single
    const calendarList: Array<{ id: string; name: string }> = [];
    if (config.calendars) {
      for (const [name, id] of Object.entries(config.calendars)) {
        if (!selectedCalendars || selectedCalendars.length === 0 || selectedCalendars.includes(name)) {
          calendarList.push({ id, name });
        }
      }
    } else {
      calendarList.push({ id: config.calendarId, name: "Calendar" });
    }

    // Build time ranges for today and tomorrow
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(todayEnd);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    // Fetch events — with one token refresh retry
    const fetchAll = async (token: string) => {
      const todayEvents: DisplayEvent[] = [];
      const tomorrowEvents: DisplayEvent[] = [];

      for (const cal of calendarList) {
        const today = await fetchEventsForCalendar(
          cal.id, cal.name, token,
          todayStart.toISOString(), todayEnd.toISOString(),
        );
        todayEvents.push(...today);

        const tomorrow = await fetchEventsForCalendar(
          cal.id, cal.name, token,
          tomorrowStart.toISOString(), tomorrowEnd.toISOString(),
        );
        tomorrowEvents.push(...tomorrow);
      }

      // Sort by time
      const sortByTime = (a: DisplayEvent, b: DisplayEvent) => a.time.localeCompare(b.time);
      todayEvents.sort(sortByTime);
      tomorrowEvents.sort(sortByTime);

      return { today: todayEvents, tomorrow: tomorrowEvents.slice(0, 3) };
    };

    try {
      return await fetchAll(accessToken);
    } catch (err) {
      // Try token refresh on failure
      if (config.refreshToken) {
        try {
          const tokens = await refreshAccessToken(config.refreshToken, config.clientId, config.clientSecret);
          const toSave: Record<string, string> = { google_access_token: tokens.accessToken };
          if (tokens.refreshToken) toSave.google_refresh_token = tokens.refreshToken;
          await saveAllSettings(sql, toSave);
          return await fetchAll(tokens.accessToken);
        } catch (refreshErr) {
          log.error("Calendar token refresh failed", { error: (refreshErr as Error).message });
        }
      }
      log.error("Calendar fetch failed", { error: (err as Error).message });
      return empty;
    }
  } catch (err) {
    log.error("Calendar data error", { error: (err as Error).message });
    return empty;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/display-calendar.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/display/calendar-data.ts tests/unit/display-calendar.test.ts
git commit -m "feat(display): add Google Calendar event fetching for kitchen display"
```

---

### Task 6: Icons module (SVG paths for Satori)

**Files:**
- Create: `src/display/icons.ts`

- [ ] **Step 1: Create icons module with Lucide SVG path data**

Satori renders SVG elements directly. Each icon is a function returning a Satori-compatible element. The SVG path data comes from Lucide (https://lucide.dev).

```typescript
// src/display/icons.ts
//
// Lucide icon SVG paths for use with Satori.
// Each function returns a Satori-compatible element tree.
// Satori uses React.createElement-style objects: { type, props, children }

type SatoriElement = {
  type: string;
  props: Record<string, unknown>;
  children?: SatoriElement[];
};

function svgIcon(paths: string[], size: number, strokeWidth: number = 1.5): SatoriElement {
  return {
    type: "svg",
    props: {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: { width: size, height: size },
    },
    children: paths.map((d) => ({
      type: "path",
      props: { d },
    })),
  };
}

// Brain icon (Lucide)
export function iconBrain(size: number): SatoriElement {
  return svgIcon([
    "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
    "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
    "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
    "M17.599 6.5a3 3 0 0 0 .399-1.375",
    "M6.003 5.125A3 3 0 0 0 6.401 6.5",
    "M3.477 10.896a4 4 0 0 1 .585-.396",
    "M19.938 10.5a4 4 0 0 1 .585.396",
    "M6 18a4 4 0 0 1-1.967-.516",
    "M19.967 17.484A4 4 0 0 1 18 18",
  ], size);
}

// Calendar icon (Lucide)
export function iconCalendar(size: number): SatoriElement {
  return svgIcon([
    "M16 2v4", "M8 2v4",
    "M3 10h18",
    "M21 8.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5Z",
  ], size);
}

// CheckSquare icon (Lucide)
export function iconCheckSquare(size: number): SatoriElement {
  return svgIcon([
    "m9 11 3 3L22 4",
    "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  ], size);
}

// Check icon (for filled checkbox)
export function iconCheck(size: number): SatoriElement {
  return svgIcon(["M20 6 9 17l-5-5"], size, 2.5);
}

// Sun (Lucide)
export function iconSun(size: number): SatoriElement {
  return svgIcon([
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41",
    "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41",
  ], size);
}

// Cloud (Lucide)
export function iconCloud(size: number): SatoriElement {
  return svgIcon([
    "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
  ], size);
}

// CloudRain (Lucide)
export function iconCloudRain(size: number): SatoriElement {
  return svgIcon([
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M16 14v6", "M8 14v6", "M12 16v6",
  ], size);
}

// CloudSnow (Lucide)
export function iconCloudSnow(size: number): SatoriElement {
  return svgIcon([
    "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
    "M8 15h.01", "M8 19h.01", "M12 17h.01", "M12 21h.01", "M16 15h.01", "M16 19h.01",
  ], size);
}

// CloudLightning (Lucide)
export function iconCloudLightning(size: number): SatoriElement {
  return svgIcon([
    "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973",
    "m13 12-3 5h4l-3 5",
  ], size);
}

export function weatherIcon(code: number, size: number): SatoriElement {
  if (code === 0) return iconSun(size);
  if (code >= 1 && code <= 3) return iconCloud(size);
  if (code === 45 || code === 48) return iconCloud(size);
  if (code >= 51 && code <= 67) return iconCloudRain(size);
  if (code >= 71 && code <= 77) return iconCloudSnow(size);
  if (code >= 80 && code <= 82) return iconCloudRain(size);
  if (code >= 95) return iconCloudLightning(size);
  return iconCloud(size);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/display/icons.ts
git commit -m "feat(display): add Lucide SVG icon paths for Satori rendering"
```

---

### Task 7: Rendering pipeline (Satori + Resvg)

> **MANDATORY:** Invoke the `frontend-design` skill before implementing `layout.ts`. The visual reference is `design/components/kitchen-dashboard.tsx` — replicate it exactly using Satori element trees. Match all font sizes, colors, spacing, and border styles from the prototype.

**Files:**
- Create: `src/display/render.ts`
- Create: `src/display/layout.ts`
- Create: `tests/unit/display-render.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/display-render.test.ts
import { describe, it, expect } from "vitest";
import { buildLayout } from "../../src/display/layout.js";
import type { KitchenData } from "../../src/display/types.js";

const sampleData: KitchenData = {
  date: "Monday, March 31",
  time: "07:30",
  weather: {
    current: 14,
    condition: "Partly Cloudy",
    weatherCode: 2,
    high: 18,
    low: 9,
    hourly: [
      { time: "08:00", temp: 13 },
      { time: "09:00", temp: 14 },
      { time: "10:00", temp: 15 },
      { time: "11:00", temp: 16 },
    ],
  },
  todayEvents: [
    { time: "08:30", name: "Dentist — Mila", calendar: "FAMILY" },
    { time: "10:00", name: "Sprint Planning", calendar: "WORK" },
  ],
  tomorrowEvents: [
    { time: "09:00", name: "Parent-teacher conference", calendar: "FAMILY" },
  ],
  tasks: [
    { name: "Renew passport", due: "due Apr 3", done: false },
    { name: "Call dentist", due: null, done: true },
  ],
  maxTodayEvents: 8,
};

describe("buildLayout", () => {
  it("returns a valid Satori element tree", () => {
    const element = buildLayout(sampleData, 1872, 1404);

    expect(element).toBeDefined();
    expect(element.type).toBe("div");
    expect(element.props.style).toBeDefined();
    expect(element.props.style.width).toBe(1872);
    expect(element.props.style.height).toBe(1404);
  });

  it("omits weather section when weather is null", () => {
    const data = { ...sampleData, weather: null };
    const element = buildLayout(data, 1872, 1404);

    // Flatten children to check weather strip is absent
    const json = JSON.stringify(element);
    expect(json).not.toContain("°C");
    expect(json).toContain("TODAY");
  });

  it("shows empty state when no events and no tasks", () => {
    const data = { ...sampleData, weather: null, todayEvents: [], tomorrowEvents: [], tasks: [] };
    const element = buildLayout(data, 1872, 1404);

    const json = JSON.stringify(element);
    expect(json).toContain("No events today");
    expect(json).toContain("All clear");
  });

  it("truncates today events at maxTodayEvents and shows overflow", () => {
    const manyEvents = Array.from({ length: 12 }, (_, i) => ({
      time: `${String(8 + i).padStart(2, "0")}:00`,
      name: `Event ${i + 1}`,
      calendar: "WORK",
    }));
    const data = { ...sampleData, todayEvents: manyEvents, maxTodayEvents: 8 };
    const element = buildLayout(data, 1872, 1404);

    const json = JSON.stringify(element);
    expect(json).toContain("+4 more");
    expect(json).not.toContain("Event 12");
  });

  it("shows checked checkbox for done tasks", () => {
    const element = buildLayout(sampleData, 1872, 1404);
    const json = JSON.stringify(element);
    // Done task should have line-through style
    expect(json).toContain("line-through");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/display-render.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement layout.ts**

This is the core visual layout. It produces a Satori-compatible element tree that matches `design/components/kitchen-dashboard.tsx`.

```typescript
// src/display/layout.ts
import type { KitchenData, DisplayEvent, DisplayTask } from "./types.js";
import { iconBrain, iconCalendar, iconCheckSquare, weatherIcon } from "./icons.js";

// Satori element type
type El = { type: string; props: Record<string, unknown>; children?: (El | string)[] };

function el(type: string, props: Record<string, unknown>, ...children: (El | string | null | false)[]): El {
  return { type, props, children: children.filter(Boolean) as (El | string)[] };
}

function text(style: Record<string, unknown>, content: string): El {
  return el("span", { style }, content);
}

function divider(color = "#1a1a1a"): El {
  return el("div", { style: { height: 1, backgroundColor: color, width: "100%" } });
}

function sectionHeader(title: string, icon: El): El {
  return el("div", { style: { display: "flex", flexDirection: "column", marginBottom: 24 } },
    el("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } },
      icon,
      text({ fontSize: 24, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase" }, title),
    ),
    divider(),
  );
}

function calendarBadge(label: string): El {
  return text({
    fontSize: 14, color: "#888", border: "1px solid #888",
    borderRadius: 2, padding: "1px 8px", letterSpacing: "0.05em",
  }, label);
}

function eventRow(event: DisplayEvent, large: boolean): El {
  return el("div", { style: { display: "flex", alignItems: "center", gap: 24 } },
    text({ fontSize: large ? 22 : 18, color: "#888", width: 100 }, event.time),
    text({ fontSize: large ? 26 : 20, flex: 1, color: large ? "#1a1a1a" : "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, event.name),
    calendarBadge(event.calendar),
  );
}

function checkbox(done: boolean): El {
  if (done) {
    return el("div", {
      style: {
        width: 24, height: 24, backgroundColor: "#1a1a1a",
        borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      },
    }, text({ fontSize: 16, color: "#f5f5f5", fontWeight: 700 }, "✓"));
  }
  return el("div", {
    style: {
      width: 24, height: 24, border: "2px solid #1a1a1a",
      borderRadius: 2, flexShrink: 0,
    },
  });
}

function taskRow(task: DisplayTask): El {
  return el("div", { style: { display: "flex", alignItems: "flex-start", gap: 16 } },
    checkbox(task.done),
    el("div", { style: { display: "flex", flexDirection: "column", flex: 1 } },
      text({
        fontSize: 22,
        color: task.done ? "#888" : "#1a1a1a",
        textDecoration: task.done ? "line-through" : "none",
      }, task.name),
      task.due ? text({
        fontSize: 16, color: "#888", marginTop: 4,
        fontWeight: task.due === "overdue" ? 700 : 400,
      }, task.due) : false,
    ),
  );
}

export function buildLayout(data: KitchenData, width: number, height: number): El {
  // Header
  const header = el("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 24, borderBottom: "1px solid #1a1a1a" },
  },
    el("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
      iconBrain(32),
      text({ fontSize: 32, fontWeight: 500, letterSpacing: "0.05em" }, "cortex"),
    ),
    el("div", { style: { display: "flex", alignItems: "center", gap: 32, fontSize: 24 } },
      text({}, data.date),
      text({ fontWeight: 500 }, data.time),
    ),
  );

  // Weather strip (optional)
  let weatherStrip: El | false = false;
  if (data.weather) {
    const w = data.weather;
    weatherStrip = el("div", {
      style: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 32, paddingBottom: 32, borderBottom: "1px solid #1a1a1a" },
    },
      el("div", { style: { display: "flex", alignItems: "center", gap: 40 } },
        el("div", { style: { display: "flex", alignItems: "center", gap: 24 } },
          weatherIcon(w.weatherCode, 48),
          el("div", { style: { display: "flex", flexDirection: "column" } },
            text({ fontSize: 64, fontWeight: 300, lineHeight: 1 }, `${w.current}°C`),
            text({ fontSize: 20, color: "#888", marginTop: 4 }, w.condition),
          ),
        ),
        el("div", { style: { display: "flex", flexDirection: "column", paddingLeft: 40, borderLeft: "1px solid #ccc", fontSize: 20, color: "#888" } },
          text({}, `H: ${w.high}°`),
          text({}, `L: ${w.low}°`),
        ),
      ),
      el("div", { style: { display: "flex", gap: 32 } },
        ...w.hourly.map((h) =>
          el("div", { style: { display: "flex", flexDirection: "column", alignItems: "center" } },
            text({ fontSize: 18, color: "#888" }, h.time),
            text({ fontSize: 22, marginTop: 4 }, `${h.temp}°`),
          ),
        ),
      ),
    );
  }

  // Today's events
  const visibleEvents = data.todayEvents.slice(0, data.maxTodayEvents);
  const overflow = data.todayEvents.length - data.maxTodayEvents;

  const todayContent = data.todayEvents.length === 0
    ? [text({ fontSize: 22, color: "#888", fontStyle: "italic", marginTop: 20 }, "No events today")]
    : [
        ...visibleEvents.map((e) => eventRow(e, true)),
        ...(overflow > 0 ? [text({ fontSize: 18, color: "#888", marginTop: 8 }, `+${overflow} more`)] : []),
      ];

  const todaySection = el("div", { style: { flex: 2, display: "flex", flexDirection: "column" } },
    sectionHeader("Today", iconCalendar(24)),
    el("div", { style: { display: "flex", flexDirection: "column", gap: 20 } }, ...todayContent),
    data.tomorrowEvents.length > 0
      ? el("div", { style: { marginTop: 40, paddingTop: 32, borderTop: "1px solid #ccc", display: "flex", flexDirection: "column" } },
          text({ fontSize: 20, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase", color: "#888", marginBottom: 20 }, "Tomorrow"),
          el("div", { style: { display: "flex", flexDirection: "column", gap: 16 } },
            ...data.tomorrowEvents.map((e) => eventRow(e, false)),
          ),
        )
      : false,
  );

  // Tasks
  const taskContent = data.tasks.length === 0
    ? [text({ fontSize: 22, color: "#888", fontStyle: "italic", marginTop: 20 }, "All clear")]
    : data.tasks.map((t) => taskRow(t));

  const taskSection = el("div", { style: { flex: 1, borderLeft: "1px solid #ccc", paddingLeft: 48, display: "flex", flexDirection: "column" } },
    sectionHeader("Don't Forget", iconCheckSquare(24)),
    el("div", { style: { display: "flex", flexDirection: "column", gap: 20 } }, ...taskContent),
  );

  // Main content area
  const mainContent = el("div", {
    style: { flex: 1, display: "flex", gap: 48, paddingTop: 32, overflow: "hidden" },
  }, todaySection, taskSection);

  // Footer
  const footer = el("div", {
    style: { display: "flex", justifyContent: "space-between", paddingTop: 24, borderTop: "1px solid #1a1a1a", fontSize: 14, color: "#888" },
  },
    text({}, `Last updated ${data.time}`),
    text({}, "cortex v0.1"),
  );

  // Root container
  return el("div", {
    style: {
      width, height,
      backgroundColor: "#f5f5f5", color: "#1a1a1a",
      padding: 48, display: "flex", flexDirection: "column",
      fontFamily: "JetBrains Mono",
    },
  }, header, weatherStrip, mainContent, footer);
}
```

- [ ] **Step 4: Implement render.ts**

```typescript
// src/display/render.ts
import satori from "satori";
import { Resvg } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayout } from "./layout.js";
import type { KitchenData } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load fonts once at module init
const fontRegular = readFileSync(join(__dirname, "fonts", "JetBrainsMono-Regular.ttf"));
const fontMedium = readFileSync(join(__dirname, "fonts", "JetBrainsMono-Medium.ttf"));

let resvgInitialized = false;

export async function renderKitchenDisplay(
  data: KitchenData,
  width = 1872,
  height = 1404,
): Promise<Buffer> {
  // Initialize resvg WASM on first call
  if (!resvgInitialized) {
    const { initWasm } = await import("@resvg/resvg-wasm");
    try {
      // initWasm needs the WASM binary — resvg-wasm ships it as a default export
      const wasmModule = await import("@resvg/resvg-wasm/index_bg.wasm");
      await initWasm(wasmModule.default);
    } catch {
      // Already initialized (e.g., in tests or hot reload)
    }
    resvgInitialized = true;
  }

  const element = buildLayout(data, width, height);

  const svg = await satori(element as any, {
    width,
    height,
    fonts: [
      { name: "JetBrains Mono", data: fontRegular, weight: 400, style: "normal" },
      { name: "JetBrains Mono", data: fontMedium, weight: 500, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  });

  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/unit/display-render.test.ts
```

Expected: All tests PASS. (The `buildLayout` tests don't require Satori/Resvg — they only test the element tree structure.)

- [ ] **Step 6: Commit**

```bash
git add src/display/layout.ts src/display/render.ts tests/unit/display-render.test.ts
git commit -m "feat(display): add Satori layout builder and PNG rendering pipeline"
```

---

### Task 8: Route handler and settings

**Files:**
- Create: `src/display/index.ts`
- Create: `tests/unit/display-routes.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/display-routes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../src/display/render.js", () => ({
  renderKitchenDisplay: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
}));

vi.mock("../../src/display/weather-data.js", () => ({
  getWeather: vi.fn().mockResolvedValue({
    current: 14, condition: "Partly Cloudy", weatherCode: 2,
    high: 18, low: 9, hourly: [],
  }),
}));

vi.mock("../../src/display/task-data.js", () => ({
  getDisplayTasks: vi.fn().mockResolvedValue([
    { name: "Test task", due: "due Apr 3", done: false },
  ]),
}));

vi.mock("../../src/display/calendar-data.js", () => ({
  getDisplayEvents: vi.fn().mockResolvedValue({
    today: [{ time: "08:30", name: "Test event", calendar: "WORK" }],
    tomorrow: [],
  }),
}));

vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: vi.fn().mockResolvedValue({
    display_enabled: "true",
    display_weather_lat: "52.52",
    display_weather_lng: "13.41",
    timezone: "Europe/Berlin",
  }),
}));

import { createDisplayRoutes } from "../../src/display/index.js";
import { renderKitchenDisplay } from "../../src/display/render.js";

function createTestApp() {
  const sql = vi.fn() as any;
  const app = new Hono();
  app.route("/", createDisplayRoutes(sql));
  return { app, sql };
}

describe("GET /api/kitchen.png", () => {
  it("returns a PNG when display is enabled", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/kitchen.png");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(renderKitchenDisplay).toHaveBeenCalled();
  });

  it("returns 404 when display is disabled", async () => {
    const { getAllSettings } = await import("../../src/web/settings-queries.js");
    vi.mocked(getAllSettings).mockResolvedValueOnce({});

    const { app } = createTestApp();
    const res = await app.request("/api/kitchen.png");

    expect(res.status).toBe(404);
  });

  it("returns 403 when token is required but missing", async () => {
    const { getAllSettings } = await import("../../src/web/settings-queries.js");
    vi.mocked(getAllSettings).mockResolvedValueOnce({
      display_enabled: "true",
      display_token: "secret123",
    });

    const { app } = createTestApp();
    const res = await app.request("/api/kitchen.png");

    expect(res.status).toBe(403);
  });

  it("returns 200 when correct token is provided", async () => {
    const { getAllSettings } = await import("../../src/web/settings-queries.js");
    vi.mocked(getAllSettings).mockResolvedValueOnce({
      display_enabled: "true",
      display_token: "secret123",
      display_weather_lat: "52.52",
      display_weather_lng: "13.41",
      timezone: "Europe/Berlin",
    });

    const { app } = createTestApp();
    const res = await app.request("/api/kitchen.png?token=secret123");

    expect(res.status).toBe(200);
  });
});

describe("GET /api/display", () => {
  it("returns TRMNL BYOS JSON when enabled", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/display", {
      headers: { Host: "192.168.1.50:3000" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("image_url");
    expect(body.image_url).toContain("/api/kitchen.png");
  });

  it("returns 404 when display is disabled", async () => {
    const { getAllSettings } = await import("../../src/web/settings-queries.js");
    vi.mocked(getAllSettings).mockResolvedValueOnce({});

    const { app } = createTestApp();
    const res = await app.request("/api/display");

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/display-routes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route handler**

```typescript
// src/display/index.ts
import { Hono } from "hono";
import type postgres from "postgres";
import { getAllSettings } from "../web/settings-queries.js";
import { renderKitchenDisplay } from "./render.js";
import { getWeather } from "./weather-data.js";
import { getDisplayTasks } from "./task-data.js";
import { getDisplayEvents } from "./calendar-data.js";
import type { KitchenData } from "./types.js";
import { createLogger } from "../logger.js";

const log = createLogger("display");

type Sql = postgres.Sql;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDate(now: Date): string {
  return `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

function formatTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function createDisplayRoutes(sql: Sql): Hono {
  const app = new Hono();

  // Shared auth/enable check
  async function checkAccess(c: any): Promise<Record<string, string> | null> {
    const settings = await getAllSettings(sql);
    if (settings.display_enabled !== "true") return null;

    const token = settings.display_token;
    if (token) {
      const provided = new URL(c.req.url).searchParams.get("token");
      if (provided !== token) {
        return null; // will be handled per-route (403 vs 404)
      }
    }
    return settings;
  }

  app.get("/api/kitchen.png", async (c) => {
    const settings = await getAllSettings(sql);
    if (settings.display_enabled !== "true") {
      return c.text("Not found", 404);
    }

    // Token check
    const token = settings.display_token;
    if (token) {
      const provided = new URL(c.req.url).searchParams.get("token");
      if (provided !== token) {
        return c.text("Forbidden", 403);
      }
    }

    try {
      const now = new Date();
      const timezone = settings.timezone || "Europe/Berlin";

      // Assemble data from all sources (parallel)
      const lat = parseFloat(settings.display_weather_lat || "");
      const lng = parseFloat(settings.display_weather_lng || "");
      const maxTasks = parseInt(settings.display_max_tasks || "7", 10);
      const width = parseInt(settings.display_width || "1872", 10);
      const height = parseInt(settings.display_height || "1404", 10);
      const selectedCalendars = settings.display_calendars
        ? JSON.parse(settings.display_calendars) as string[]
        : undefined;

      const [weather, events, tasks] = await Promise.all([
        (!isNaN(lat) && !isNaN(lng)) ? getWeather(lat, lng, timezone) : Promise.resolve(null),
        getDisplayEvents(sql, timezone, selectedCalendars),
        getDisplayTasks(sql, maxTasks),
      ]);

      const data: KitchenData = {
        date: formatDate(now),
        time: formatTime(now),
        weather,
        todayEvents: events.today,
        tomorrowEvents: events.tomorrow,
        tasks,
        maxTodayEvents: 8,
      };

      const png = await renderKitchenDisplay(data, width, height);

      return new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      log.error("Kitchen display render failed", { error: (err as Error).message });
      return c.text("Render failed", 500);
    }
  });

  app.get("/api/display", async (c) => {
    const settings = await getAllSettings(sql);
    if (settings.display_enabled !== "true") {
      return c.text("Not found", 404);
    }

    // Build image URL from request host
    const host = c.req.header("host") || "localhost:3000";
    const protocol = c.req.header("x-forwarded-proto") || "http";
    const tokenParam = settings.display_token ? `?token=${settings.display_token}` : "";

    return c.json({
      image_url: `${protocol}://${host}/api/kitchen.png${tokenParam}`,
      filename: "cortex-kitchen",
    });
  });

  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/display-routes.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Wire routes in src/index.ts**

Add the import and route mounting to `src/index.ts`:

At the top with other imports, add:
```typescript
import { createDisplayRoutes } from "./display/index.js";
```

After the MCP handler block (around line 108), add:
```typescript
  // Kitchen display image endpoint (unauthenticated for TRMNL BYOS)
  app.route("/", createDisplayRoutes(sql));
```

**Important:** This must be mounted BEFORE the setup middleware catches it, OR the display routes need to be placed alongside the health route (which is also unauthenticated). Check that the setup middleware in `src/web/setup.ts` allows `/api/kitchen.png` and `/api/display` through without auth — these routes must work without cookies since the TRMNL device can't authenticate.

Review `src/web/setup.ts` `createSetupMiddleware` and add `/api/kitchen.png` and `/api/display` to the passthrough list alongside `/health`.

- [ ] **Step 6: Run all tests to check for regressions**

```bash
npx vitest run tests/unit/
```

Expected: All existing tests still pass, plus the new display tests.

- [ ] **Step 7: Commit**

```bash
git add src/display/index.ts tests/unit/display-routes.test.ts src/index.ts src/web/setup.ts
git commit -m "feat(display): add kitchen display routes and TRMNL BYOS adapter"
```

---

### Task 9: Settings page section

> **MANDATORY:** Invoke the `frontend-design` skill before implementing this section. Follow the existing settings page design patterns exactly — same form classes, label styles, input patterns, section headers. Reference `src/web/settings.ts` and `docs/plans/2026-03-06-web-design-system.md`.

**Files:**
- Modify: `src/web/settings.ts`

- [ ] **Step 1: Add Kitchen Display section to the settings page HTML**

In `src/web/settings.ts`, in the GET handler's HTML template, add a new section after the Google Calendar section. The section should include:

- A heading: "Kitchen Display"
- Enable toggle: checkbox for `display_enabled`
- Security token: text input for `display_token` (shown when enabled)
- Weather location: two text inputs for `display_weather_lat` and `display_weather_lng`
- Max tasks: number input for `display_max_tasks` (default 7)
- Display size: two number inputs for `display_width` and `display_height` with preset buttons
- Preview link: when enabled, show a link to `/api/kitchen.png` that opens in a new tab

Follow the existing settings page patterns — use the same form classes, label styles, and input patterns already used in other sections. All values are submitted with the single Save All form.

- [ ] **Step 2: Add the new setting keys to the POST handler's save logic**

Ensure `display_enabled`, `display_token`, `display_weather_lat`, `display_weather_lng`, `display_max_tasks`, `display_calendars`, `display_width`, `display_height` are read from the form and saved via `saveAllSettings`.

- [ ] **Step 3: Test manually in browser**

```bash
npm run dev
```

Open `http://localhost:3000/settings`, scroll to Kitchen Display section, verify fields render and save correctly.

- [ ] **Step 4: Commit**

```bash
git add src/web/settings.ts
git commit -m "feat(display): add Kitchen Display settings section"
```

---

### Task 10: Auth middleware passthrough for display routes

**Files:**
- Modify: `src/web/setup.ts`

- [ ] **Step 1: Read setup middleware to find the passthrough pattern**

Look at `createSetupMiddleware` in `src/web/setup.ts`. Find where `/health` is allowed through without auth. Add `/api/kitchen.png` and `/api/display` to the same passthrough list.

- [ ] **Step 2: Add display routes to passthrough**

Find the condition that checks if the path should bypass auth (look for `/health` or `public`). Add:

```typescript
if (path === "/api/kitchen.png" || path === "/api/display") {
  return next();
}
```

The display routes handle their own auth (token-based), so they must not be blocked by the cookie-based session auth.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/web/setup.ts
git commit -m "feat(display): allow kitchen display routes through auth middleware"
```

---

### Task 11: End-to-end smoke test

**Files:**
- No new files

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Manual smoke test (if Docker is running)**

```bash
# Enable display in settings or set directly:
# Visit /settings and enable Kitchen Display with weather coords

# Then test the endpoint:
curl -o /tmp/kitchen-test.png http://localhost:3000/api/kitchen.png
file /tmp/kitchen-test.png
```

Expected: `kitchen-test.png: PNG image data, 1872 x 1404`

- [ ] **Step 4: Test TRMNL adapter**

```bash
curl http://localhost:3000/api/display
```

Expected: `{"image_url":"http://localhost:3000/api/kitchen.png","filename":"cortex-kitchen"}`

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(display): address smoke test issues"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| `GET /api/kitchen.png` endpoint | Task 8 |
| `GET /api/display` TRMNL BYOS adapter | Task 8 |
| Google Calendar data fetching | Task 5 |
| Cortex task querying + done checkboxes | Task 4 |
| Open-Meteo weather + 30min cache | Task 3 |
| Satori + Resvg rendering pipeline | Task 7 |
| Layout matching kitchen-dashboard.tsx | Task 7 (layout.ts) |
| Icons (Lucide SVG paths) | Task 6 |
| Settings UI section | Task 9 |
| Token-based security | Task 8 |
| Display enabled/disabled toggle | Task 8 |
| Auth middleware passthrough | Task 10 |
| Edge cases (no weather, no events, overflow) | Task 7 (tests) |
| Font loading (JetBrains Mono) | Task 1, Task 7 |
| Shared types | Task 2 |
