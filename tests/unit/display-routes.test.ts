import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../src/display/render.js", () => ({
  renderKitchenDisplay: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
}));

vi.mock("../../src/display/weather-data.js", () => ({
  getWeather: vi.fn().mockResolvedValue({
    current: 14,
    condition: "Partly Cloudy",
    weatherCode: 2,
    high: 18,
    low: 9,
    hourly: [],
  }),
}));

vi.mock("../../src/display/task-data.js", () => ({
  getDisplayTasks: vi.fn().mockResolvedValue([
    { name: "Test task", due: null, done: false },
  ]),
}));

vi.mock("../../src/display/calendar-data.js", () => ({
  getDisplayEvents: vi.fn().mockResolvedValue({
    today: [{ time: "09:00", name: "Meeting", calendar: "WORK" }],
    tomorrow: [],
  }),
}));

vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: vi.fn().mockResolvedValue({
    display_enabled: "true",
    timezone: "Europe/Berlin",
  }),
}));

const { mockLoggerInstance } = vi.hoisted(() => ({
  mockLoggerInstance: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/logger.js", () => ({
  createLogger: () => mockLoggerInstance,
}));

import { createDisplayRoutes, formatDate, formatTime } from "../../src/display/index.js";
import { getAllSettings } from "../../src/web/settings-queries.js";
import { renderKitchenDisplay } from "../../src/display/render.js";
import { getWeather } from "../../src/display/weather-data.js";
import { getDisplayEvents } from "../../src/display/calendar-data.js";
import { getDisplayTasks } from "../../src/display/task-data.js";

const mockGetAllSettings = getAllSettings as ReturnType<typeof vi.fn>;
const mockRender = renderKitchenDisplay as ReturnType<typeof vi.fn>;
const mockGetWeather = getWeather as ReturnType<typeof vi.fn>;
const mockGetEvents = getDisplayEvents as ReturnType<typeof vi.fn>;
const mockGetTasks = getDisplayTasks as ReturnType<typeof vi.fn>;

// Fake sql object (not actually called — queries are mocked)
const fakeSql = {} as any;

function buildApp() {
  const app = new Hono();
  app.route("/", createDisplayRoutes(fakeSql));
  return app;
}

describe("display routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllSettings.mockResolvedValue({
      display_enabled: "true",
      timezone: "Europe/Berlin",
    });
    mockRender.mockResolvedValue(Buffer.from("fake-png"));
  });

  // ─── GET /api/kitchen.png ────────────────────────────────────

  describe("GET /api/kitchen.png", () => {
    it("returns PNG when enabled", async () => {
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("no-cache");

      const body = await res.arrayBuffer();
      expect(Buffer.from(body).toString()).toBe("fake-png");
    });

    it("returns 404 when disabled", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "false",
      });

      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(404);
    });

    it("returns 403 when token required but missing", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "secret123",
        timezone: "Europe/Berlin",
      });

      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(403);
    });

    it("returns 403 when token required but wrong", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "secret123",
        timezone: "Europe/Berlin",
      });

      const app = buildApp();
      const res = await app.request("/api/kitchen.png?token=wrong");

      expect(res.status).toBe(403);
    });

    it("returns 200 when correct token provided", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "secret123",
        timezone: "Europe/Berlin",
      });

      const app = buildApp();
      const res = await app.request("/api/kitchen.png?token=secret123");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("calls renderKitchenDisplay with correct dimensions from settings", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_width: "800",
        display_height: "480",
        timezone: "Europe/Berlin",
      });

      const app = buildApp();
      await app.request("/api/kitchen.png");

      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          date: expect.any(String),
          time: expect.any(String),
        }),
        800,
        480,
      );
    });

    it("returns 500 on internal error", async () => {
      mockGetAllSettings.mockRejectedValue(new Error("DB down"));

      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(500);
    });
  });

  // ─── GET /api/display ────────────────────────────────────────

  describe("GET /api/display", () => {
    it("returns TRMNL JSON when enabled", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local:3000" },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("image_url");
      expect(json).toHaveProperty("filename", "cortex-kitchen");
      expect(json.image_url).toContain("/api/kitchen.png");
      expect(json.image_url).toContain("cortex.local:3000");
    });

    it("returns 404 when disabled", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "false",
      });

      const app = buildApp();
      const res = await app.request("/api/display");

      expect(res.status).toBe(404);
    });

    it("includes token param in image_url when token is set", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "mytoken",
        timezone: "Europe/Berlin",
      });

      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });

      const json = await res.json();
      expect(json.image_url).toContain("?token=mytoken");
    });

    it("does not include token param when no token is set", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });

      const json = await res.json();
      expect(json.image_url).not.toContain("?token=");
    });
  });

  // ─── Helper functions ────────────────────────────────────────

  describe("formatDate", () => {
    it("formats date as weekday, month day", () => {
      // March 31, 2026 is a Tuesday
      const date = new Date(2026, 2, 31);
      expect(formatDate(date)).toBe("Tuesday, March 31");
    });
  });

  describe("formatTime", () => {
    it("formats time as HH:MM with zero-padding", () => {
      const date = new Date(2026, 2, 31, 7, 5);
      expect(formatTime(date)).toBe("07:05");
    });

    it("formats afternoon time correctly", () => {
      const date = new Date(2026, 2, 31, 14, 30);
      expect(formatTime(date)).toBe("14:30");
    });
  });

  // ────────────────────────────────────────────────────────────
  // Explicit TS-labeled scenarios
  // ────────────────────────────────────────────────────────────

  describe("TS-1.x: feature flag", () => {
    it("TS-1.2 — PNG returns 404 'Not Found' when disabled, renderer not called", async () => {
      mockGetAllSettings.mockResolvedValue({ display_enabled: "false" });
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
      expect(mockRender).not.toHaveBeenCalled();
    });

    it("TS-1.3 — /api/display returns 404 'Not Found' when disabled", async () => {
      mockGetAllSettings.mockResolvedValue({ display_enabled: "false" });
      const app = buildApp();
      const res = await app.request("/api/display");

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });
  });

  describe("TS-2.x: PNG endpoint", () => {
    it("TS-2.1 — returns a non-empty binary PNG payload when enabled", async () => {
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.length).toBeGreaterThan(0);
    });

    it("TS-2.2 — Content-Type is image/png", async () => {
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("TS-2.3 — Cache-Control is no-cache", async () => {
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    });

    it("TS-2.4 — renderer invoked with width/height from settings", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_width: "1200",
        display_height: "800",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      await app.request("/api/kitchen.png");

      expect(mockRender).toHaveBeenCalled();
      const call = mockRender.mock.calls[0];
      expect(call[1]).toBe(1200);
      expect(call[2]).toBe(800);
    });

    it("TS-2.5 — default dimensions 1872 x 1404 when settings absent", async () => {
      const app = buildApp();
      await app.request("/api/kitchen.png");

      const call = mockRender.mock.calls[0];
      expect(call[1]).toBe(1872);
      expect(call[2]).toBe(1404);
    });

    it("TS-2.6 — rendering exception returns 500 and logs at error level", async () => {
      mockRender.mockRejectedValueOnce(new Error("boom"));
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Internal Server Error");
      expect(mockLoggerInstance.error).toHaveBeenCalled();
      const errCall = mockLoggerInstance.error.mock.calls[0];
      expect(errCall[1]).toMatchObject({ error: "boom" });
    });
  });

  describe("TS-3.x: token auth", () => {
    it("TS-3.1 — no token required when display_token is absent", async () => {
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");
      expect(res.status).toBe(200);
    });

    it("TS-3.2 — missing token returns 403 'Forbidden'", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "correct",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Forbidden");
    });

    it("TS-3.3 — wrong token returns 403", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "correct",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/kitchen.png?token=wrong");

      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Forbidden");
    });

    it("TS-3.4 — correct token returns 200", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "correct",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/kitchen.png?token=correct");
      expect(res.status).toBe(200);
    });

    it("TS-3.5 — token comparison uses crypto.timingSafeEqual (source inspection)", async () => {
      const fs = await import("node:fs/promises");
      const source = await fs.readFile(
        new URL("../../src/display/index.ts", import.meta.url),
        "utf-8",
      );
      expect(source).toContain("timingSafeEqual");
      expect(source).toContain('from "node:crypto"');
    });

    it("TS-3.6 — /api/display does not enforce the token", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "correct",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toHaveProperty("image_url");
    });
  });

  describe("TS-4.x: TRMNL BYOS adapter", () => {
    it("TS-4.1 — 200, application/json, body has exactly image_url and filename", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const json = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(json).sort()).toEqual(["filename", "image_url"]);
    });

    it("TS-4.2 — filename is the literal 'cortex-kitchen'", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });
      const json = (await res.json()) as { filename: string };
      expect(json.filename).toBe("cortex-kitchen");
    });

    it("TS-4.3 — image_url uses Host header and /api/kitchen.png path", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local:3000" },
      });
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url).toBe("http://cortex.local:3000/api/kitchen.png");
    });

    it("TS-4.4 — image_url honors X-Forwarded-Proto: https", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: {
          host: "cortex.example.com",
          "x-forwarded-proto": "https",
        },
      });
      const json = (await res.json()) as { image_url: string };
      expect(
        json.image_url.startsWith("https://cortex.example.com/api/kitchen.png"),
      ).toBe(true);
    });

    it("TS-4.5 — image_url defaults to http:// when no X-Forwarded-Proto", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url.startsWith("http://")).toBe(true);
    });

    it("TS-4.6 — image_url falls back to localhost when Host header is absent", async () => {
      const app = buildApp();
      // Hono's app.request auto-populates Host from the URL; use app.fetch
      // with a raw Request so we can omit the header.
      const req = new Request("http://placeholder/api/display");
      // Remove the auto-generated host header entry to simulate "absent".
      req.headers.delete("host");
      const res = await app.fetch(req);
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url).toBe("http://localhost/api/kitchen.png");
    });

    it("TS-4.7 — image_url ends with ?token=<value> when display_token set", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_token: "secret-123",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url.endsWith("?token=secret-123")).toBe(true);
    });

    it("TS-4.8 — image_url omits ?token= when display_token is absent", async () => {
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "cortex.local" },
      });
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url.includes("token=")).toBe(false);
    });

    it("TS-4.9 — display_base_url overrides header-derived prefix (KG-4: expected FAIL)", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_base_url: "https://proxy.example.com",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "internal-container:3000" },
      });
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url).toBe("https://proxy.example.com/api/kitchen.png");
    });

    it("TS-4.10 — display_base_url tolerates a trailing slash (KG-4: expected FAIL)", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_base_url: "https://proxy.example.com/",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/display", {
        headers: { host: "internal:3000" },
      });
      const json = (await res.json()) as { image_url: string };
      expect(json.image_url).toBe("https://proxy.example.com/api/kitchen.png");
    });

    it("TS-4.11 — adapter returns 404 when feature is disabled", async () => {
      mockGetAllSettings.mockResolvedValue({ display_enabled: "false" });
      const app = buildApp();
      const res = await app.request("/api/display");
      expect(res.status).toBe(404);
    });
  });

  describe("TS-5.x: today-events routing", () => {
    it("TS-5.6 — display_max_today_events caps the rendered count (KG-3: expected FAIL)", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_max_today_events: "5",
        timezone: "Europe/Berlin",
      });
      const events = Array.from({ length: 12 }, (_, i) => ({
        time: `${String(8 + i).padStart(2, "0")}:00`,
        name: `E${i + 1}`,
        calendar: "WORK",
      }));
      mockGetEvents.mockResolvedValue({ today: events, tomorrow: [] });

      const app = buildApp();
      await app.request("/api/kitchen.png");

      expect(mockRender).toHaveBeenCalled();
      const data = mockRender.mock.calls[0][0] as {
        maxTodayEvents: number;
      };
      expect(data.maxTodayEvents).toBe(5);
    });

    it("TS-5.7 — overflow line '+3 more' for 8 events with cap 5 (KG-3: expected FAIL)", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_max_today_events: "5",
        timezone: "Europe/Berlin",
      });
      const events = Array.from({ length: 8 }, (_, i) => ({
        time: `${String(8 + i).padStart(2, "0")}:00`,
        name: `E${i + 1}`,
        calendar: "WORK",
      }));
      mockGetEvents.mockResolvedValue({ today: events, tomorrow: [] });

      const app = buildApp();
      await app.request("/api/kitchen.png");

      const data = mockRender.mock.calls[0][0] as {
        maxTodayEvents: number;
      };
      expect(data.maxTodayEvents).toBe(5);
    });
  });

  describe("TS-7.x: weather gating", () => {
    it("TS-7.5 — weather strip omitted when lat is absent; getWeather not called", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_weather_lng: "13.41",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      await app.request("/api/kitchen.png");

      expect(mockGetWeather).not.toHaveBeenCalled();
      const data = mockRender.mock.calls[0][0] as { weather: unknown };
      expect(data.weather).toBeNull();
    });

    it("TS-7.6 — weather strip omitted when lat is unparseable; getWeather not called", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_weather_lat: "not-a-number",
        display_weather_lng: "13.41",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      await app.request("/api/kitchen.png");

      expect(mockGetWeather).not.toHaveBeenCalled();
      const data = mockRender.mock.calls[0][0] as { weather: unknown };
      expect(data.weather).toBeNull();
    });

    it("TS-7.7 — weather strip omitted when lng is unparseable; getWeather not called", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_weather_lat: "52.52",
        display_weather_lng: "abc",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      await app.request("/api/kitchen.png");

      expect(mockGetWeather).not.toHaveBeenCalled();
      const data = mockRender.mock.calls[0][0] as { weather: unknown };
      expect(data.weather).toBeNull();
    });
  });

  describe("TS-8.x: graceful degradation", () => {
    it("TS-8.3 — weather fetch failure still renders calendar and tasks", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_weather_lat: "52.52",
        display_weather_lng: "13.41",
        timezone: "Europe/Berlin",
      });
      mockGetWeather.mockResolvedValue(null);
      mockGetEvents.mockResolvedValue({
        today: [{ time: "09:00", name: "Standup", calendar: "WORK" }],
        tomorrow: [],
      });
      mockGetTasks.mockResolvedValue([
        { name: "Buy milk", due: null, done: false },
      ]);

      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(200);
      const data = mockRender.mock.calls[0][0] as {
        weather: unknown;
        todayEvents: unknown[];
        tasks: unknown[];
      };
      expect(data.weather).toBeNull();
      expect(data.todayEvents).toHaveLength(1);
      expect(data.tasks).toHaveLength(1);
    });

    it("TS-8.4 — calendar fetch failure still renders tasks and weather", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_weather_lat: "52.52",
        display_weather_lng: "13.41",
        timezone: "Europe/Berlin",
      });
      mockGetWeather.mockResolvedValue({
        current: 14,
        condition: "Clear",
        weatherCode: 0,
        high: 18,
        low: 9,
        hourly: [],
      });
      mockGetEvents.mockResolvedValue({ today: [], tomorrow: [] });
      mockGetTasks.mockResolvedValue([
        { name: "Buy milk", due: null, done: false },
      ]);

      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(200);
      const data = mockRender.mock.calls[0][0] as {
        weather: unknown;
        todayEvents: unknown[];
        tasks: unknown[];
      };
      expect(data.weather).not.toBeNull();
      expect(data.todayEvents).toHaveLength(0);
      expect(data.tasks).toHaveLength(1);
    });
  });

  describe("TS-E-x: edge cases", () => {
    it("TS-E-7 — invalid JSON in display_calendars → all calendars (passed as undefined)", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_calendars: "not valid json {",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(200);
      expect(mockGetEvents).toHaveBeenCalled();
      const selected = mockGetEvents.mock.calls[0][2];
      // Invalid JSON is silently tolerated → pass undefined (no filter)
      expect(selected).toBeUndefined();
    });

    it("TS-E-12 — zero/negative width and height fall back to defaults (KG-5: expected FAIL)", async () => {
      mockGetAllSettings.mockResolvedValue({
        display_enabled: "true",
        display_width: "0",
        display_height: "-50",
        timezone: "Europe/Berlin",
      });
      const app = buildApp();
      const res = await app.request("/api/kitchen.png");

      expect(res.status).toBe(200);
      const call = mockRender.mock.calls[0];
      expect(call[1]).toBe(1872);
      expect(call[2]).toBe(1404);
    });
  });

  describe("TS-C-x: constraints", () => {
    it("TS-C-2 — session cookie has no effect on the PNG endpoint", async () => {
      const app = buildApp();
      const res = await app.request("/api/kitchen.png", {
        headers: { cookie: "cortex_session=anything" },
      });
      expect(res.status).toBe(200);
    });
  });
});
