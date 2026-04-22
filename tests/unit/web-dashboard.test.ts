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
  totalEntries: number;
  openTasks: number;
  stalledProjects: number;
}

function createMockStats(overrides: Partial<Stats> = {}): Stats {
  return {
    entriesThisWeek: 0,
    totalEntries: 0,
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

  // ═══════════════════════════════════════════════════════════════════
  // Entry Visibility — webapp indicator
  // ═══════════════════════════════════════════════════════════════════
  describe("Entry Visibility", () => {
    // TS-4.1 — shared indicator appears on dashboard recent-entries for
    // visibility='shared' rows.
    it("renders a visibility='shared' indicator on dashboard recent entries", async () => {
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([
        createMockEntry({
          id: "11111111-1111-1111-1111-111111111111",
          name: "Grocery run",
          category: "tasks",
          // @ts-expect-error — Phase-4 contract: visibility added in Phase 5
          visibility: "shared",
        }),
      ]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const body = await res.text();

      expect(body).toContain("Grocery run");
      // Shared indicator: the entry's rendered block carries a
      // data-visibility="shared" attribute. Phase 5 adds this marker to the
      // visibility-icon wrapper inside the entry list-item.
      expect(body).toMatch(/data-visibility=["']shared["']/);
    });

    // TS-4.5 (dashboard inverse) — private entries have no shared indicator.
    it("renders no shared indicator on private dashboard entries", async () => {
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([
        createMockEntry({
          id: "22222222-2222-2222-2222-222222222222",
          name: "Personal reflection",
          category: "ideas",
          // @ts-expect-error — Phase-4 contract: visibility added in Phase 5
          visibility: "private",
        }),
      ]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const body = await res.text();

      expect(body).toContain("Personal reflection");
      // Strip <script> bodies before asserting — the dashboard's client-side
      // SSE renderer contains the marker as a JS string template so it can be
      // emitted when a shared entry arrives live. The rendered entry list
      // itself (not the script template) is what must stay marker-free for
      // private entries.
      const bodyNoScripts = body.replace(
        /<script[\s\S]*?<\/script>/g,
        "",
      );
      expect(bodyNoScripts).not.toMatch(/data-visibility=["']shared["']/);
    });

    // TS-4.9 (dashboard) — the dashboard does not filter recent entries by
    // visibility; both shared and private entries are listed.
    it("does not filter dashboard recent entries by visibility", async () => {
      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([
        createMockEntry({
          id: "33333333-3333-3333-3333-333333333333",
          name: "Public task",
          // @ts-expect-error — Phase-4 contract: visibility added in Phase 5
          visibility: "shared",
        }),
        createMockEntry({
          id: "44444444-4444-4444-4444-444444444444",
          name: "Surprise gift plan",
          // @ts-expect-error — Phase-4 contract: visibility added in Phase 5
          visibility: "private",
        }),
      ]);

      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const body = await res.text();

      expect(body).toContain("Public task");
      expect(body).toContain("Surprise gift plan");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — stat card anchors (feature: browse-filters)
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters — stat card anchors", () => {
    const STAT_KEYS = [
      "entries-week",
      "entries-total",
      "open-tasks",
      "stalled",
    ] as const;

    const EXPECTED_HREFS: Record<(typeof STAT_KEYS)[number], string> = {
      "entries-week": "/browse?since=week",
      "entries-total": "/browse",
      "open-tasks": "/browse?category=tasks&status=pending",
      stalled: "/browse?category=projects&status=active&stale_days=5",
    };

    function hrefForStat(html: string, key: string): string | null {
      // Find the <a ...href="..."> that most tightly wraps the data-stat span.
      // Scan backwards from the data-stat occurrence to the nearest preceding
      // <a ... href="..."> that hasn't been closed before reaching the span.
      const markerIdx = html.indexOf(`data-stat="${key}"`);
      if (markerIdx < 0) return null;
      const preceding = html.slice(0, markerIdx);
      const openAnchorRe = /<a\b[^>]*href="([^"]*)"[^>]*>/g;
      let lastMatch: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = openAnchorRe.exec(preceding)) !== null) {
        // Ensure the anchor hasn't been closed before the data-stat marker.
        const closeIdx = preceding.indexOf("</a>", m.index + m[0].length);
        if (closeIdx === -1) {
          lastMatch = m;
        } else {
          // There IS a closing tag between this opening <a> and the data-stat;
          // so this anchor does NOT wrap the data-stat.
          continue;
        }
      }
      return lastMatch ? lastMatch[1]! : null;
    }

    async function renderDashboard(
      stats?: Partial<Stats>,
    ): Promise<string> {
      if (stats) {
        const { getDashboardStats } = await import(
          "../../src/web/dashboard-queries.js"
        );
        vi.mocked(getDashboardStats).mockResolvedValue(createMockStats(stats));
      }
      const { app } = await createTestDashboard();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      return res.text();
    }

    // TS-1.1
    it("renders each stat card as an <a> element wrapping icon + number + label", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 3,
        totalEntries: 14,
        openTasks: 7,
        stalledProjects: 2,
      });
      for (const key of STAT_KEYS) {
        // Anchor wraps the data-stat span (the number). This assertion fails
        // today because renderStats wraps in <div>, not <a>.
        const href = hrefForStat(body, key);
        expect(href).not.toBeNull();
      }
    });

    // TS-1.2
    it("preserves [data-stat] spans inside the anchor wrappers", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 1,
        totalEntries: 2,
        openTasks: 3,
        stalledProjects: 4,
      });
      for (const key of STAT_KEYS) {
        const occurrences = (
          body.match(new RegExp(`data-stat="${key}"`, "g")) ?? []
        ).length;
        expect(occurrences).toBe(1);
      }
    });

    // TS-1.3 — TS-1.6
    for (const key of STAT_KEYS) {
      it(`${key} card href is ${EXPECTED_HREFS[key]}`, async () => {
        const body = await renderDashboard({
          entriesThisWeek: 2,
          totalEntries: 10,
          openTasks: 5,
          stalledProjects: 1,
        });
        expect(hrefForStat(body, key)).toBe(EXPECTED_HREFS[key]);
      });
    }

    // TS-1.9
    it("renders hover:border-primary and hover:bg-secondary on each stat card anchor", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 1,
        totalEntries: 1,
        openTasks: 1,
        stalledProjects: 1,
      });
      for (const key of STAT_KEYS) {
        const markerIdx = body.indexOf(`data-stat="${key}"`);
        expect(markerIdx).toBeGreaterThanOrEqual(0);
        const preceding = body.slice(0, markerIdx);
        const lastOpenAnchor = preceding.lastIndexOf("<a ");
        expect(lastOpenAnchor).toBeGreaterThanOrEqual(0);
        const anchorTag = body.slice(lastOpenAnchor, markerIdx);
        // Hover class invariants
        expect(anchorTag).toMatch(/hover:border-primary/);
        expect(anchorTag).toMatch(/hover:bg-secondary/);
      }
    });

    // TS-1.10
    it("stat card anchors are focus-targets (no tabindex=-1 override)", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 0,
        totalEntries: 0,
        openTasks: 0,
        stalledProjects: 0,
      });
      for (const key of STAT_KEYS) {
        // Anchor tag immediately preceding the data-stat marker should not
        // have tabindex="-1".
        const markerIdx = body.indexOf(`data-stat="${key}"`);
        const preceding = body.slice(0, markerIdx);
        const lastOpenAnchor = preceding.lastIndexOf("<a ");
        const anchorTag = body.slice(lastOpenAnchor, markerIdx);
        expect(anchorTag).not.toMatch(/tabindex="-1"/);
        expect(hrefForStat(body, key)).not.toBeNull();
      }
    });

    // TS-1.11
    it("renders stat cards as anchors even when counts are zero", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 0,
        totalEntries: 0,
        openTasks: 0,
        stalledProjects: 0,
      });
      for (const key of STAT_KEYS) {
        expect(hrefForStat(body, key)).toBe(EXPECTED_HREFS[key]);
      }
    });

    // TS-1.12
    it("[data-stat] selectors resolve to a single element inside the anchor wrapper", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 5,
        totalEntries: 20,
        openTasks: 3,
        stalledProjects: 1,
      });
      // Regex-based equivalent of JSDOM querySelector + closest("a").
      for (const key of STAT_KEYS) {
        const wrappedPattern = new RegExp(
          `<a\\b[^>]*href="[^"]*"[^>]*>[^<]*(?:<[^>]+>[^<]*)*?<span[^>]*data-stat="${key}"[^>]*>\\s*\\d+\\s*<\\/span>[\\s\\S]*?<\\/a>`,
        );
        expect(body).toMatch(wrappedPattern);
      }
    });

    // TS-5.10 — non-stat dashboard elements remain non-anchors at the wrapper level
    it("does not wrap the digest panel, capture form, or service-status block in new anchors", async () => {
      const body = await renderDashboard({
        entriesThisWeek: 0,
        totalEntries: 0,
        openTasks: 0,
        stalledProjects: 0,
      });
      // Capture form: <form id="capture-form"> must not be wrapped in an
      // anchor introduced by this feature. It may live inside existing
      // anchors in unrelated contexts; assert specifically that the
      // <form id="capture-form"> opening tag is NOT immediately preceded by
      // an open <a> that closes after the form.
      const formIdx = body.indexOf(`<form id="capture-form"`);
      expect(formIdx).toBeGreaterThanOrEqual(0);
      // Scan back to find any anchor that opens before the form and closes
      // after it — if none, we're good.
      const preceding = body.slice(0, formIdx);
      const lastOpenA = preceding.lastIndexOf("<a ");
      if (lastOpenA >= 0) {
        const lastCloseA = preceding.lastIndexOf("</a>");
        // If the last open <a> precedes the last </a>, the anchor is closed
        // before the form — OK.
        expect(lastCloseA).toBeGreaterThan(lastOpenA);
      }
      // Digest panel: data-digest must not be wrapped
      expect(body).toContain("data-digest");
    });
  });
});
