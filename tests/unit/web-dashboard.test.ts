/**
 * Unit tests for the web dashboard.
 * Uses mocked query layer, classification, and embedding modules.
 *
 * Scenarios: TS-1.1, TS-1.2, TS-2.1–2.4, TS-2.6, TS-3.1–3.3,
 *            TS-4.1, TS-4.3, TS-4.4, TS-5.1, TS-6.1–6.3,
 *            TS-7.1–7.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { SSEBroadcaster } from "../../src/web/sse.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/dashboard-queries.js", () => ({
  getRecentEntries: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi
    .fn()
    .mockResolvedValue({ entriesThisWeek: 0, openTasks: 0, stalledProjects: 0 }),
  getLatestDigest: vi.fn().mockResolvedValue(null),
  insertEntry: vi.fn().mockResolvedValue("test-entry-id"),
}));

vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn().mockResolvedValue({
    category: "tasks",
    name: "Mock Entry",
    confidence: 0.9,
    fields: {},
    tags: [],
    content: "Mock content",
  }),
}));

vi.mock("../../src/embed.js", () => ({
  embedEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/config.js", () => ({
  resolveConfigValue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/google-calendar.js", () => ({
  getCalendarNames: vi.fn().mockResolvedValue(undefined),
  processCalendarEvent: vi.fn().mockResolvedValue({ created: false }),
  handleEntryCalendarCleanup: vi.fn().mockResolvedValue(undefined),
}));

// ─── Types & Factories ─────────────────────────────────────────────

interface Entry {
  id: string;
  name: string;
  category: string | null;
  content: string | null;
  fields: Record<string, unknown>;
  tags: string[];
  confidence: number | null;
  source: string;
  source_type: string;
  embedding: number[] | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function createMockEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: crypto.randomUUID(),
    name: "Test Entry",
    category: "tasks",
    content: "Test content",
    fields: {},
    tags: [],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    embedding: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

interface Stats {
  entriesThisWeek: number;
  openTasks: number;
  stalledProjects: number;
}

function createMockStats(overrides: Partial<Stats> = {}): Stats {
  return {
    entriesThisWeek: 0,
    openTasks: 0,
    stalledProjects: 0,
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestDashboard(): Promise<{
  app: Hono;
  broadcaster: SSEBroadcaster;
}> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createDashboardRoutes } = await import(
    "../../src/web/dashboard.js"
  );
  const { createSSEBroadcaster } = await import("../../src/web/sse.js");

  const broadcaster = createSSEBroadcaster();
  const mockSql = {} as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createDashboardRoutes(mockSql, broadcaster));

  return { app, broadcaster };
}

async function loginAndGetCookie(
  app: Hono,
  password = TEST_PASSWORD,
): Promise<string> {
  const res = await app.request("/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("No Set-Cookie header in login response");
  }
  return setCookie.split(";")[0]!;
}

async function readSSEEvent(
  response: Response,
  timeoutMs = 2000,
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSE read timeout")), timeoutMs),
      ),
    ]);
    return decoder.decode(result.value);
  } finally {
    reader.cancel();
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Web Dashboard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Digest (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Digest (US-1)", () => {
    // TS-1.1
    it("shows today's digest content", async () => {
      const { getLatestDigest } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getLatestDigest).mockResolvedValue({
        content: "## Daily Summary\nYou had 5 entries today.",
        created_at: new Date(),
      });

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Daily Summary");
      expect(body).toContain("5 entries today");
    });

    // TS-1.2
    it("shows placeholder when no digest exists", async () => {
      const { getLatestDigest } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getLatestDigest).mockResolvedValue(null);

      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockResolvedValue("0 7 * * *");

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.toLowerCase()).toContain("no daily digest yet");
      expect(body).toContain("7:00");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Recent Entries (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Recent Entries (US-2)", () => {
    // TS-2.1
    it("displays 5 most recent entries when more exist", async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        createMockEntry({ name: `Entry ${i + 1}` }),
      );
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue(entries);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      for (const entry of entries) {
        expect(body).toContain(entry.name);
      }
    });

    // TS-2.2
    it("groups entries by date with most recent first", async () => {
      const today = new Date();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const entries = [
        createMockEntry({ name: "Today 1", created_at: today }),
        createMockEntry({ name: "Today 2", created_at: today }),
        createMockEntry({ name: "Yesterday 1", created_at: yesterday }),
        createMockEntry({ name: "Yesterday 2", created_at: yesterday }),
        createMockEntry({ name: "Yesterday 3", created_at: yesterday }),
      ];
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue(entries);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      const todayLabel = "Today";
      const yesterdayLabel = "Yesterday";
      expect(body).toContain(todayLabel);
      expect(body).toContain(yesterdayLabel);
      expect(body.indexOf(todayLabel)).toBeLessThan(
        body.indexOf(yesterdayLabel),
      );
    });

    // TS-2.3
    it("renders entry with category badge, name, and relative time", async () => {
      const entry = createMockEntry({
        id: "abc-123",
        name: "Buy groceries",
        category: "tasks",
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([entry]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain("tasks");
      expect(body).toContain("Buy groceries");
      expect(body).toMatch(/2\s*h(ours?)?\s*ago/i);
    });

    // TS-2.4
    it("links entry name to /entry/:id", async () => {
      const entryId = "550e8400-e29b-41d4-a716-446655440000";
      const entry = createMockEntry({ id: entryId });
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([entry]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain(`href="/entry/${entryId}"`);
    });

    // TS-2.6
    it("includes a View all link to /browse", async () => {
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([createMockEntry()]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain('href="/browse"');
      expect(body.toLowerCase()).toContain("view all");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Stats (US-3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Stats (US-3)", () => {
    // TS-3.1
    it("displays entries this week count", async () => {
      const { getDashboardStats } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getDashboardStats).mockResolvedValue(
        createMockStats({ entriesThisWeek: 4 }),
      );

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toMatch(
        /4[\s\S]*?entries\s+this\s+week|entries\s+this\s+week[\s\S]*?4/i,
      );
    });

    // TS-3.2
    it("displays open tasks count", async () => {
      const { getDashboardStats } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getDashboardStats).mockResolvedValue(
        createMockStats({ openTasks: 3 }),
      );

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toMatch(
        /3[\s\S]*?open\s+tasks|open\s+tasks[\s\S]*?3/i,
      );
    });

    // TS-3.3
    it("displays stalled projects count", async () => {
      const { getDashboardStats } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getDashboardStats).mockResolvedValue(
        createMockStats({ stalledProjects: 2 }),
      );

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toMatch(
        /2[\s\S]*?stalled\s+projects|stalled\s+projects[\s\S]*?2/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Quick Capture (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Quick Capture (US-4)", () => {
    // TS-4.1
    it("renders capture input on dashboard", async () => {
      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toMatch(/<input[^>]*|<textarea/i);
      expect(body.toLowerCase()).toMatch(
        /what's on your mind|capture|quick/,
      );
    });

    // TS-4.3
    it("returns success response for client to clear input", async () => {
      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/capture", {
        method: "POST",
        body: JSON.stringify({ text: "Test note" }),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      });

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    });

    // TS-4.4
    it("returns category, name, and confidence in capture response", async () => {
      const { classifyText } = await import("../../src/classify.js");
      vi.mocked(classifyText).mockResolvedValue({
        category: "ideas",
        name: "App for plant watering",
        confidence: 0.87,
        fields: {},
        tags: [],
        content: "App idea for plant watering",
      });

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/capture", {
        method: "POST",
        body: JSON.stringify({ text: "App idea for plant watering" }),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.category).toBe("ideas");
      expect(json.name).toBe("App for plant watering");
      expect(json.confidence).toBe(0.87);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SSE (US-5)
  // ═══════════════════════════════════════════════════════════════════
  describe("SSE (US-5)", () => {
    // TS-5.1
    it("returns event-stream content-type for SSE endpoint", async () => {
      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("cache-control")).toContain("no-cache");
      expect(res.body).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Constraints
  // ═══════════════════════════════════════════════════════════════════
  describe("Constraints", () => {
    // TS-6.1
    it("returns HTML content-type for dashboard", async () => {
      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toMatch(/<!DOCTYPE html>|<html/i);
    });

    // TS-6.2
    it("redirects unauthenticated dashboard request to /login", async () => {
      const { app } = await createTestDashboard();

      const res = await app.request("/");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login?redirect=%2F");
    });

    // TS-6.3
    it("returns 401 for unauthenticated SSE request", async () => {
      const { app } = await createTestDashboard();

      const res = await app.request("/api/events");

      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-7.1
    it("shows empty state message and zero stats", async () => {
      const { getRecentEntries, getDashboardStats, getLatestDigest } =
        await import("../../src/web/dashboard-queries.js");
      vi.mocked(getRecentEntries).mockResolvedValue([]);
      vi.mocked(getDashboardStats).mockResolvedValue(
        createMockStats({ entriesThisWeek: 0, openTasks: 0, stalledProjects: 0 }),
      );
      vi.mocked(getLatestDigest).mockResolvedValue(null);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body.toLowerCase()).toMatch(/no entries|empty|nothing/);
      // All three stats should show 0
      const zeroMatches = body.match(/\b0\b/g);
      expect(zeroMatches).not.toBeNull();
      expect(zeroMatches!.length).toBeGreaterThanOrEqual(3);
    });

    // TS-7.2
    it("includes retry field in SSE stream", async () => {
      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const text = await readSSEEvent(res);
      expect(text).toMatch(/retry:\s*\d+/);
    });

    // TS-7.3
    it("renders unclassified badge for entry with null category", async () => {
      const entry = createMockEntry({
        name: "Uncategorized thought",
        category: null,
      });
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([entry]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain("Uncategorized thought");
      expect(body.toLowerCase()).toContain("unclassified");
    });

    // TS-7.4
    it("saves entry without embedding when Ollama fails", async () => {
      const { classifyText } = await import("../../src/classify.js");
      vi.mocked(classifyText).mockResolvedValue({
        category: "tasks",
        name: "Test",
        confidence: 0.9,
        fields: {},
        tags: [],
        content: "Test note",
      });

      const { embedEntry } = await import("../../src/embed.js");
      vi.mocked(embedEntry).mockRejectedValue(
        new Error("Ollama unavailable"),
      );

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/capture", {
        method: "POST",
        body: JSON.stringify({ text: "Test note" }),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.category).toBe("tasks");
      expect(json.name).toBe("Test");
      expect(json.confidence).toBe(0.9);

      expect(embedEntry).toHaveBeenCalled();
    });

    // TS-7.5
    it("saves entry with null category when classification fails", async () => {
      const { classifyText } = await import("../../src/classify.js");
      vi.mocked(classifyText).mockRejectedValue(
        new Error("LLM unavailable"),
      );

      const { embedEntry } = await import("../../src/embed.js");
      vi.mocked(embedEntry).mockRejectedValue(
        new Error("Ollama unavailable"),
      );

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/capture", {
        method: "POST",
        body: JSON.stringify({ text: "Test note" }),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.category).toBeNull();
      expect(json.confidence).toBeNull();
    });
  });
});
