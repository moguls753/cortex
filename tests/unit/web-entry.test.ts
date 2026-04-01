/**
 * Unit tests for the web entry page.
 * Uses mocked query layer and embedding module.
 *
 * Scenarios: TS-1.1, TS-1.2, TS-1.3, TS-1.4, TS-1.5,
 *            TS-2.1, TS-2.2, TS-2.4,
 *            TS-3.1, TS-3.2, TS-3.3,
 *            TS-4.1, TS-4.2, TS-4.3,
 *            TS-5.1, TS-5.2, TS-5.5, TS-5.6, TS-5.7, TS-5.9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const TEST_UUID = "11111111-1111-1111-1111-111111111111";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/entry-queries.js", () => ({
  getEntry: vi.fn().mockResolvedValue(null),
  updateEntry: vi.fn().mockResolvedValue(undefined),
  softDeleteEntry: vi.fn().mockResolvedValue(undefined),
  restoreEntry: vi.fn().mockResolvedValue(undefined),
  getAllTags: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(4096).fill(0)),
  embedEntry: vi.fn().mockResolvedValue(undefined),
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
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function createMockEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: TEST_UUID,
    name: "Test Entry",
    category: "tasks",
    content: "Test content",
    fields: {},
    tags: [],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    deleted_at: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestEntry(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createEntryRoutes } = await import("../../src/web/entry.js");

  const mockSql = {} as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createEntryRoutes(mockSql));

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

describe("Web Entry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // View Entry (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("View Entry (US-1)", () => {
    // TS-1.1
    it("displays all entry fields", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          name: "Project Alpha",
          category: "projects",
          tags: ["dev", "backend"],
          content: "Some **markdown** content",
          fields: { status: "active", next_action: "deploy" },
          source: "telegram",
          source_type: "text",
          confidence: 0.85,
          created_at: new Date("2026-01-15T10:00:00Z"),
          updated_at: new Date("2026-01-16T14:30:00Z"),
        }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Project Alpha");
      expect(body).toContain("projects");
      expect(body).toContain("dev");
      expect(body).toContain("backend");
      // Rendered content (not raw markdown)
      expect(body).toContain("<strong");
      expect(body).toContain("status");
      expect(body).toContain("next_action");
      // Edit button
      expect(body).toContain(`/entry/${TEST_UUID}/edit`);
      // Delete button
      expect(body).toMatch(/delete/i);
    });

    // TS-1.2
    it("renders markdown content to HTML", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          content:
            "# Heading\n**bold**\n*italic*\n- list item\n1. ordered\n`inline code`\n```\ncode block\n```\n[link](http://example.com)",
        }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("<h1");
      expect(body).toContain("<strong");
      expect(body).toContain("<em");
      expect(body).toContain("<ul");
      expect(body).toContain("<ol");
      expect(body).toContain("<code");
      expect(body).toContain("<pre");
      expect(body).toContain("<a href");
    });

    // TS-1.3
    it("returns 404 for invalid UUID", async () => {
      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/entry/not-a-uuid", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(404);
      const body = await res.text();
      // Should not contain stack traces or server error details
      expect(body).not.toMatch(/Error:|at\s+\w+\s+\(/);
    });

    // TS-1.4
    it("returns 404 for valid UUID with no matching row", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(null);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        "/entry/00000000-0000-0000-0000-000000000000",
        { headers: { Cookie: cookie } },
      );

      expect(res.status).toBe(404);
    });

    // TS-1.5
    it("shows deleted badge and restore option for soft-deleted entry", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          deleted_at: new Date("2026-01-20T12:00:00Z"),
        }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/deleted/i);
      // Restore form with correct action
      expect(body).toContain(`/entry/${TEST_UUID}/restore`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edit Entry (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Edit Entry (US-2)", () => {
    // TS-2.1
    it("shows edit form with pre-populated values", async () => {
      const { getEntry, getAllTags } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          name: "Meeting Notes",
          category: "projects",
          tags: ["work", "weekly"],
          content: "# Summary\nGood progress",
          fields: { status: "active", next_action: "review", notes: "v2" },
        }),
      );
      vi.mocked(getAllTags).mockResolvedValue(["work", "weekly", "urgent"]);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/edit`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Name input pre-populated
      expect(body).toContain("Meeting Notes");
      // Category selected
      expect(body).toContain("projects");
      // Tags present
      expect(body).toContain("work");
      expect(body).toContain("weekly");
      // Raw markdown in textarea (not rendered)
      expect(body).toContain("# Summary");
      expect(body).toContain("Good progress");
      // Cancel link
      expect(body).toContain(`/entry/${TEST_UUID}`);
    });

    // TS-2.2
    it("shows category-specific fields in edit form", async () => {
      const { getEntry, getAllTags } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({
          category: "tasks",
          fields: {
            due_date: "2026-04-01",
            status: "pending",
            notes: "asap",
          },
        }),
      );
      vi.mocked(getAllTags).mockResolvedValue([]);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/edit`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Category-specific field inputs with pre-populated values
      expect(body).toContain("due_date");
      expect(body).toContain("status");
      expect(body).toContain("notes");
      expect(body).toContain("2026-04-01");
      expect(body).toContain("pending");
      expect(body).toContain("asap");
      // Tasks selected
      expect(body).toContain("tasks");
    });

    // TS-2.4
    it("rejects save with empty name", async () => {
      const { getEntry, updateEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(createMockEntry());

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "",
          category: "tasks",
          content: "stuff",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Should NOT redirect (stays on edit or returns 400/422)
      expect(res.status).not.toBe(302);
      expect(res.status).not.toBe(303);
      const body = await res.text();
      // Validation error about name being required
      expect(body).toMatch(/name|required/i);
      // updateEntry NOT called
      expect(vi.mocked(updateEntry)).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Delete Entry (US-3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Delete Entry (US-3)", () => {
    // TS-3.1
    it("sets deleted_at on soft-delete", async () => {
      const { softDeleteEntry, getEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(createMockEntry());
      vi.mocked(softDeleteEntry).mockResolvedValue(undefined);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/delete`, {
        method: "POST",
        headers: { Cookie: cookie },
      });

      // softDeleteEntry called with entry ID
      expect(vi.mocked(softDeleteEntry)).toHaveBeenCalledWith(
        expect.anything(),
        TEST_UUID,
      );
      // Response is a redirect
      expect([302, 303]).toContain(res.status);
    });

    // TS-3.2
    it("redirects to referrer after deletion", async () => {
      const { softDeleteEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(softDeleteEntry).mockResolvedValue(undefined);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/delete`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Referer: "/browse?category=tasks",
        },
      });

      expect([302, 303]).toContain(res.status);
      expect(res.headers.get("location")).toBe("/browse?category=tasks");
    });

    // TS-3.3
    it("redirects to dashboard after deletion without referrer", async () => {
      const { softDeleteEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(softDeleteEntry).mockResolvedValue(undefined);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/delete`, {
        method: "POST",
        headers: { Cookie: cookie },
      });

      expect([302, 303]).toContain(res.status);
      expect(res.headers.get("location")).toBe("/");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Constraints
  // ═══════════════════════════════════════════════════════════════════
  describe("Constraints", () => {
    // TS-4.1
    it("returns server-rendered HTML", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(createMockEntry());

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toMatch(/<!DOCTYPE html>|<html/i);
    });

    // TS-4.2
    it("redirects unauthenticated view request to login", async () => {
      const { app } = await createTestEntry();

      const res = await app.request(
        "/entry/00000000-0000-0000-0000-000000000000",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/login");
    });

    // TS-4.3
    it("redirects unauthenticated edit request to login", async () => {
      const { app } = await createTestEntry();

      const res = await app.request(
        "/entry/00000000-0000-0000-0000-000000000000/edit",
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/login");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-5.1
    it("shows unclassified badge for null category", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({ category: null }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toMatch(/unclassified/i);
    });

    // TS-5.2
    it("shows no category selected for null category in edit mode", async () => {
      const { getEntry, getAllTags } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({ category: null, fields: {} }),
      );
      vi.mocked(getAllTags).mockResolvedValue([]);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/edit`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // No category option should have "selected" attribute,
      // or a placeholder/empty option is selected
      const categoryOptions = body.match(
        /<option[^>]*selected[^>]*>[^<]*<\/option>/gi,
      );
      if (categoryOptions) {
        // If any option is selected, it should be empty/placeholder, not a real category
        for (const opt of categoryOptions) {
          expect(opt).not.toMatch(
            />(tasks|projects|people|ideas|reference)</i,
          );
        }
      }
      // No category-specific field inputs (since category is null)
      // Fields object is empty so no field inputs expected
    });

    // TS-5.5
    // Voice indicator removed — source info not shown on entry detail page

    // TS-5.6
    it("renders very long content without layout breaks", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      const longContent =
        "# Long Document\n\n" +
        Array.from(
          { length: 200 },
          (_, i) => `Paragraph ${i + 1}: ${"Lorem ipsum dolor sit amet. ".repeat(10)}`,
        ).join("\n\n");
      vi.mocked(getEntry).mockResolvedValue(
        createMockEntry({ content: longContent }),
      );

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Content is rendered (not truncated)
      expect(body).toContain("Paragraph 1");
      expect(body).toContain("Paragraph 200");
      // Response length is proportional to content size
      expect(body.length).toBeGreaterThan(10000);
    });

    // TS-5.7
    it("includes existing tags for autocomplete in edit form", async () => {
      const { getEntry, getAllTags } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.mocked(getEntry).mockResolvedValue(createMockEntry());
      vi.mocked(getAllTags).mockResolvedValue([
        "work",
        "personal",
        "urgent",
        "dev",
      ]);

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}/edit`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // All four tags present for autocomplete (datalist options, JSON array, or data- attributes)
      expect(body).toContain("work");
      expect(body).toContain("personal");
      expect(body).toContain("urgent");
      expect(body).toContain("dev");
    });

    // TS-5.9
    it("displays entry with null embedding normally", async () => {
      const { getEntry } = await import("../../src/web/entry-queries.js");
      // Embedding is not in EntryRow — no special setup needed
      vi.mocked(getEntry).mockResolvedValue(createMockEntry());

      const { app } = await createTestEntry();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${TEST_UUID}`, {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Entry displayed normally
      expect(body).toContain("Test Entry");
      expect(body).toContain("tasks");
    });
  });
});
