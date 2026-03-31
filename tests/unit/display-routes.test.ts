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

vi.mock("../../src/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createDisplayRoutes, formatDate, formatTime } from "../../src/display/index.js";
import { getAllSettings } from "../../src/web/settings-queries.js";
import { renderKitchenDisplay } from "../../src/display/render.js";

const mockGetAllSettings = getAllSettings as ReturnType<typeof vi.fn>;
const mockRender = renderKitchenDisplay as ReturnType<typeof vi.fn>;

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
});
