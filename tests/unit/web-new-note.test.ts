/**
 * Unit tests for the web new note page.
 * Uses mocked query layer, classification, and embedding modules.
 *
 * Scenarios: TS-1.1, TS-1.2,
 *            TS-2.1, TS-2.2, TS-2.3, TS-2.4,
 *            TS-3.2, TS-3.3, TS-3.4,
 *            TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5,
 *            TS-5.1, TS-5.2, TS-5.4, TS-5.6, TS-5.8, TS-5.9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const TEST_UUID = "11111111-1111-1111-1111-111111111111";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/dashboard-queries.js", () => ({
  insertEntry: vi.fn().mockResolvedValue(TEST_UUID),
  getRecentEntries: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi
    .fn()
    .mockResolvedValue({
      entriesThisWeek: 0,
      openTasks: 0,
      stalledProjects: 0,
    }),
  getLatestDigest: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/web/entry-queries.js", () => ({
  getAllTags: vi.fn().mockResolvedValue([]),
  getEntry: vi.fn().mockResolvedValue(null),
  updateEntry: vi.fn().mockResolvedValue(undefined),
  softDeleteEntry: vi.fn().mockResolvedValue(undefined),
  restoreEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn().mockResolvedValue(null),
  assembleContext: vi.fn().mockResolvedValue([]),
  classifyEntry: vi.fn().mockResolvedValue(undefined),
  reclassifyEntry: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/embed.js", () => ({
  embedEntry: vi.fn().mockResolvedValue(undefined),
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock("../../src/google-calendar.js", () => ({
  getCalendarNames: vi.fn().mockResolvedValue(undefined),
  processCalendarEvent: vi.fn().mockResolvedValue({ created: false }),
  handleEntryCalendarCleanup: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestNewNote(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createNewNoteRoutes } = await import("../../src/web/new-note.js");

  const mockSql = {} as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createNewNoteRoutes(mockSql));

  return { app };
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

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Web New Note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Form Display (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Form Display (US-1)", () => {
    // TS-1.1
    it("shows new note form with all fields", async () => {
      const { getAllTags } = await import("../../src/web/entry-queries.js");
      (getAllTags as ReturnType<typeof vi.fn>).mockResolvedValue([
        "work",
        "personal",
      ]);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Name input
      expect(body).toMatch(/<input[^>]*name/i);
      // Category dropdown
      expect(body).toMatch(/<select/i);
      expect(body).toMatch(/people/i);
      expect(body).toMatch(/projects/i);
      expect(body).toMatch(/tasks/i);
      expect(body).toMatch(/ideas/i);
      expect(body).toMatch(/reference/i);
      // Tags input with datalist
      expect(body).toMatch(/<input[^>]*tag/i);
      expect(body).toMatch(/<datalist/i);
      // Content textarea
      expect(body).toMatch(/<textarea/i);
      // Save button
      expect(body).toMatch(/save/i);
    });

    // TS-1.2
    it("includes existing tags for autocomplete", async () => {
      const { getAllTags } = await import("../../src/web/entry-queries.js");
      (getAllTags as ReturnType<typeof vi.fn>).mockResolvedValue([
        "work",
        "personal",
        "urgent",
      ]);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toMatch(/<datalist/i);
      expect(body).toContain("work");
      expect(body).toContain("personal");
      expect(body).toContain("urgent");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // AI Suggest (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("AI Suggest (US-2)", () => {
    // TS-2.1
    it("returns category and tags from classification API", async () => {
      const { classifyText, assembleContext } = await import(
        "../../src/classify.js"
      );
      (assembleContext as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (classifyText as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "ideas",
        name: "Test",
        confidence: 0.9,
        fields: {},
        tags: ["ai-tag"],
        content: "test",
      });

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({
          name: "Test Note",
          content: "Some content",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/json/);
      const json = await res.json();
      expect(json.category).toBe("ideas");
      expect(json.tags).toContain("ai-tag");
      // Verify classifyText was called with text containing name and content
      expect(classifyText).toHaveBeenCalledWith(
        expect.stringContaining("Test Note"),
        expect.anything(),
      );
      const callText = (classifyText as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(callText).toContain("Some content");
      expect(assembleContext).toHaveBeenCalled();
    });

    // TS-2.2
    it("returns tags as array in API response", async () => {
      const { classifyText, assembleContext } = await import(
        "../../src/classify.js"
      );
      (assembleContext as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (classifyText as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "projects",
        name: "P",
        confidence: 0.8,
        fields: {},
        tags: ["tag-1", "tag-2", "tag-3"],
        content: "text",
      });

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({
          name: "Project",
          content: "Details",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const json = await res.json();
      expect(json.tags).toEqual(["tag-1", "tag-2", "tag-3"]);
    });

    // TS-2.3
    it("saves note with user-overridden values", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      (insertEntry as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_UUID);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "My Note",
          category: "projects",
          tags: "manual-tag",
          content: "stuff",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(insertEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          category: "projects",
          tags: ["manual-tag"],
        }),
      );
    });

    // TS-2.4
    it("returns fresh classification on re-invocation", async () => {
      const { classifyText, assembleContext } = await import(
        "../../src/classify.js"
      );
      (assembleContext as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (classifyText as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          category: "ideas",
          name: "A",
          confidence: 0.9,
          fields: {},
          tags: ["first-tag"],
          content: "a",
        })
        .mockResolvedValueOnce({
          category: "projects",
          name: "B",
          confidence: 0.8,
          fields: {},
          tags: ["second-tag"],
          content: "b",
        });

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res1 = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({ name: "Note A", content: "Content A" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const json1 = await res1.json();
      expect(json1.category).toBe("ideas");
      expect(json1.tags).toEqual(["first-tag"]);

      const res2 = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({ name: "Note B", content: "Content B" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const json2 = await res2.json();
      expect(json2.category).toBe("projects");
      expect(json2.tags).toEqual(["second-tag"]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Save Note (US-3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Save Note (US-3)", () => {
    // TS-3.2
    it("saves entry with source webapp and confidence null", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      (insertEntry as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_UUID);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Quick Note",
          content: "some text",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(insertEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          source: "webapp",
          confidence: null,
        }),
      );
    });

    // TS-3.3
    it("populates default fields for selected category", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      (insertEntry as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_UUID);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Project Alpha",
          category: "projects",
          content: "details",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(insertEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fields: { status: null, next_action: null, notes: null },
        }),
      );
    });

    // TS-3.4
    it("saves note with null embedding when Ollama is down", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      const { embedEntry } = await import("../../src/embed.js");
      (insertEntry as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_UUID);
      (embedEntry as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Connection refused"),
      );

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Offline Note",
          content: "saved anyway",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Should redirect despite embed failure
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(new RegExp(`/entry/${TEST_UUID}`));
      expect(insertEntry).toHaveBeenCalled();
      expect(embedEntry).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Constraints
  // ═══════════════════════════════════════════════════════════════════
  describe("Constraints", () => {
    // TS-4.1
    it("returns server-rendered HTML", async () => {
      const { getAllTags } = await import("../../src/web/entry-queries.js");
      (getAllTags as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toMatch(/<!DOCTYPE html>|<html/i);
    });

    // TS-4.2
    it("redirects unauthenticated GET to login", async () => {
      const { app } = await createTestNewNote();

      const res = await app.request("/new");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/\/login/);
    });

    // TS-4.3
    it("redirects unauthenticated POST to login", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );

      const { app } = await createTestNewNote();

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({ name: "Sneaky" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/\/login/);
      expect(insertEntry).not.toHaveBeenCalled();
    });

    // TS-4.4
    it("rejects save with empty name", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "",
          category: "tasks",
          content: "stuff",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Should not redirect — stays on page or returns error
      expect(res.status).not.toBe(302);
      const body = await res.text();
      expect(body).toMatch(/name/i);
      expect(body).toMatch(/required/i);
      expect(insertEntry).not.toHaveBeenCalled();
    });

    // TS-4.5
    it("rejects unauthenticated API classify", async () => {
      const { classifyText } = await import("../../src/classify.js");

      const { app } = await createTestNewNote();

      const res = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({ name: "Test", content: "stuff" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      // Auth middleware returns 401 for /api/ paths (not 302 redirect)
      expect(res.status).toBe(401);
      expect(classifyText).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-5.1
    it("saves note with title only and no content", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      const { embedEntry } = await import("../../src/embed.js");
      (insertEntry as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_UUID);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({ name: "Quick thought" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(insertEntry).toHaveBeenCalled();
      const callArgs = (insertEntry as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // Content should be empty string or null
      expect(callArgs.content === null || callArgs.content === "").toBe(true);
      expect(embedEntry).toHaveBeenCalled();
    });

    // TS-5.2
    it("saves note with no category as null", async () => {
      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      (insertEntry as ReturnType<typeof vi.fn>).mockResolvedValue(TEST_UUID);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Uncategorized",
          content: "no category selected",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(insertEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          category: null,
          fields: {},
        }),
      );
    });

    // TS-5.4
    it("rejects AI Suggest with empty content", async () => {
      const { classifyText } = await import("../../src/classify.js");

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({ name: "", content: "" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(classifyText).not.toHaveBeenCalled();
    });

    // TS-5.6
    it("returns error when classification service is down", async () => {
      const { classifyText, assembleContext } = await import(
        "../../src/classify.js"
      );
      (assembleContext as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (classifyText as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({ name: "Test", content: "Some content" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const json = await res.json();
      expect(json.error).toBeDefined();
      // Should not contain a stack trace
      expect(JSON.stringify(json)).not.toMatch(/at\s+\w+\s+\(/);
    });

    // TS-5.8
    it("includes beforeunload script in page", async () => {
      const { getAllTags } = await import("../../src/web/entry-queries.js");
      (getAllTags as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toMatch(/<script/i);
      expect(body).toMatch(/beforeunload/i);
    });

    // TS-5.9
    it("classifies with name only when content is empty", async () => {
      const { classifyText, assembleContext } = await import(
        "../../src/classify.js"
      );
      (assembleContext as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (classifyText as ReturnType<typeof vi.fn>).mockResolvedValue({
        category: "tasks",
        name: "Meeting",
        confidence: 0.8,
        fields: {},
        tags: ["meeting"],
        content: "Meeting with team",
      });

      const { app } = await createTestNewNote();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/classify", {
        method: "POST",
        body: new URLSearchParams({
          name: "Meeting with team",
          content: "",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.category).toBe("tasks");
      expect(json.tags).toEqual(["meeting"]);
      expect(classifyText).toHaveBeenCalledWith(
        expect.stringContaining("Meeting with team"),
        expect.anything(),
      );
    });
  });
});
