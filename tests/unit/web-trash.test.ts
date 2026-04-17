/**
 * Unit tests for the web trash page.
 * Uses mocked query layer and embedding module.
 *
 * Scenarios: TS-1.1, TS-1.2, TS-1.3, TS-1.4,
 *            TS-2.1, TS-2.2, TS-2.3, TS-2.4, TS-2.5, TS-2.6, TS-2.7, TS-2.8,
 *            TS-5.1, TS-5.2, TS-5.5,
 *            TS-6.1, TS-6.2,
 *            TS-7.2, TS-7.3, TS-7.4, TS-7.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/browse-queries.js", () => ({
  browseEntries: vi.fn().mockResolvedValue([]),
  semanticSearch: vi.fn().mockResolvedValue([]),
  textSearch: vi.fn().mockResolvedValue([]),
  getFilterTags: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(4096).fill(0)),
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
    id: crypto.randomUUID(),
    name: "Test Entry",
    category: "tasks",
    content: "Test content",
    fields: {},
    tags: [],
    confidence: 0.85,
    source: "telegram",
    source_type: "text",
    deleted_at: new Date(),
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestTrash(
  trashCount = 0,
): Promise<{ app: Hono; mockSql: any }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createTrashRoutes } = await import("../../src/web/trash.js");

  // Mock sql as a tagged template function
  // Handles: unclassified count, trash count, empty trash delete
  const mockSql = Object.assign(
    vi.fn().mockImplementation(() => {
      // Default: return trash count for count queries
      return Promise.resolve([{ count: trashCount }]);
    }),
    { array: vi.fn((a: string[]) => a), json: vi.fn((v: unknown) => v) },
  ) as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createTrashRoutes(mockSql));

  return { app, mockSql };
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

describe("Web Trash", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Navigation (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Navigation (US-1)", () => {
    // TS-1.1
    it("renders Trash nav item with icon and correct position", async () => {
      const { app } = await createTestTrash();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Trash link present in nav
      expect(body).toContain('href="/trash"');
      // Trash2 icon SVG (path from iconTrash2)
      expect(body).toContain("M3 6h18");
      // Verify order: Browse appears before Trash, Trash before Settings
      const browseIdx = body.indexOf('href="/browse"');
      const trashIdx = body.indexOf('href="/trash"');
      const settingsIdx = body.indexOf('href="/settings"');
      expect(browseIdx).toBeLessThan(trashIdx);
      expect(trashIdx).toBeLessThan(settingsIdx);
    });

    // TS-1.2
    it("highlights Trash nav item on /trash", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestTrash();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Trash nav item has active styling ("text-foreground bg-secondary")
      const trashLinkMatch = body.match(
        /<a[^>]*href="\/trash"[^>]*class="([^"]*)"/,
      );
      expect(trashLinkMatch).not.toBeNull();
      expect(trashLinkMatch![1]).toContain("text-foreground");

      // Browse nav item should NOT have active styling
      const browseLinkMatch = body.match(
        /<a[^>]*href="\/browse"[^>]*class="([^"]*)"/,
      );
      expect(browseLinkMatch).not.toBeNull();
      // "text-foreground" is only added for active state; inactive has "text-muted-foreground"
      expect(browseLinkMatch![1]).not.toMatch(/(?<![:-])text-foreground/);
    });

    // TS-1.3
    it("highlights Trash nav item with query params", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestTrash();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?category=tasks&tag=meeting", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      const trashLinkMatch = body.match(
        /<a[^>]*href="\/trash"[^>]*class="([^"]*)"/,
      );
      expect(trashLinkMatch).not.toBeNull();
      expect(trashLinkMatch![1]).toContain("bg-secondary");
    });

    // TS-1.4
    it("shows Trash nav when no deleted entries exist", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestTrash(0);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain('href="/trash"');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Trash Listing & Filtering (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Trash Listing & Filtering (US-2)", () => {
    // TS-2.1
    it("lists deleted entries", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Deleted A" }),
        createMockEntry({ name: "Deleted B" }),
        createMockEntry({ name: "Deleted C" }),
      ]);

      const { app } = await createTestTrash(3);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Deleted A");
      expect(body).toContain("Deleted B");
      expect(body).toContain("Deleted C");
    });

    // TS-2.2
    it("filters by category", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );

      const { app } = await createTestTrash(3);
      const cookie = await loginAndGetCookie(app);

      await app.request("/trash?category=tasks", {
        headers: { Cookie: cookie },
      });

      // browseEntries called with deleted: true and category filter
      expect(vi.mocked(browseEntries).mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ category: "tasks", deleted: true }),
      );
    });

    // TS-2.3
    it("filters by tag", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );

      const { app } = await createTestTrash(3);
      const cookie = await loginAndGetCookie(app);

      await app.request("/trash?tag=meeting", {
        headers: { Cookie: cookie },
      });

      expect(vi.mocked(browseEntries).mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ tag: "meeting", deleted: true }),
      );
    });

    // TS-2.4
    it("filters by category and tag", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );

      const { app } = await createTestTrash(3);
      const cookie = await loginAndGetCookie(app);

      await app.request("/trash?category=tasks&tag=urgent", {
        headers: { Cookie: cookie },
      });

      expect(vi.mocked(browseEntries).mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          category: "tasks",
          tag: "urgent",
          deleted: true,
        }),
      );
    });

    // TS-2.5
    it("performs semantic search in trash", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));
      const { semanticSearch, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({ name: "Semantic Match" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?q=search+term", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Semantic Match");
      // semanticSearch called with deleted: true in filters
      const callFilters = vi.mocked(semanticSearch).mock.calls[0]?.[2];
      expect(callFilters).toEqual(
        expect.objectContaining({ deleted: true }),
      );
    });

    // TS-2.6
    it("falls back to text search in trash", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const { textSearch } = await import("../../src/web/browse-queries.js");
      vi.mocked(generateEmbedding).mockRejectedValue(
        new Error("Ollama unavailable"),
      );
      vi.mocked(textSearch).mockResolvedValue([
        createMockEntry({ name: "Text Match" }),
      ]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?q=search+term", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Text Match");
      // Notice about fallback
      expect(body).toMatch(/text.*results|unavailable/i);
      // textSearch called with deleted: true
      expect(vi.mocked(textSearch).mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({ deleted: true }),
      );
    });

    // TS-2.7
    it("combines search with category and tag", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));
      const { semanticSearch, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({ name: "Combined Match" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      await app.request("/trash?q=term&category=tasks&tag=urgent", {
        headers: { Cookie: cookie },
      });

      const callFilters = vi.mocked(semanticSearch).mock.calls[0]?.[2];
      expect(callFilters).toEqual(
        expect.objectContaining({
          category: "tasks",
          tag: "urgent",
          deleted: true,
        }),
      );
    });

    // TS-2.8
    it("displays deleted_at relative time", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      // Entry updated long ago, deleted recently
      const deletedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      const updatedAt = new Date("2026-01-01T00:00:00Z"); // months ago
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({
          name: "Recently Deleted",
          updated_at: updatedAt,
          deleted_at: deletedAt,
        }),
      ]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Should show "2h ago" (based on deleted_at), not months-old time (updated_at)
      expect(body).toContain("2h ago");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Empty Trash (US-5)
  // ═══════════════════════════════════════════════════════════════════
  describe("Empty Trash (US-5)", () => {
    // TS-5.1
    it("shows Empty Trash button when entries exist", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Trashed" }),
      ]);

      const { app } = await createTestTrash(3);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toMatch(/empty\s*trash/i);
    });

    // TS-5.2
    it("Empty Trash confirmation includes total count", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      // Viewing filtered page, only 2 results shown
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Task 1", category: "tasks" }),
        createMockEntry({ name: "Task 2", category: "tasks" }),
      ]);

      // But total trash count is 5
      const { app } = await createTestTrash(5);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?category=tasks", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Confirmation text should mention 5 (total), not 2 (filtered)
      expect(body).toContain("5");
    });

    // TS-5.5
    it("returns success from empty trash endpoint", async () => {
      const { app, mockSql } = await createTestTrash(3);
      // Mock the delete query to return a result with count property
      mockSql.mockResolvedValue(Object.assign([], { count: 3 }));
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/empty-trash", {
        method: "POST",
        headers: { Cookie: cookie },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("deleted");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Empty State (US-6)
  // ═══════════════════════════════════════════════════════════════════
  describe("Empty State (US-6)", () => {
    // TS-6.1
    it("shows empty state when trash is empty", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestTrash(0);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toMatch(/trash is empty/i);
      // Empty Trash button should NOT be present
      expect(body).not.toMatch(/empty\s*trash/i);
    });

    // TS-6.2
    it("shows no results with active filters", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      // Trash has entries (count > 0), but filter yields nothing
      const { app } = await createTestTrash(3);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?category=people", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toMatch(/no entries in this category/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases & Guardrails (US-7)
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases & Guardrails", () => {
    // TS-7.2
    it("category tabs use /trash base path", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Trashed" }),
      ]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Category tabs should link to /trash?category=X, not /browse?category=X
      expect(body).toContain("/trash?category=");
      expect(body).not.toMatch(/\/browse\?category=/);
    });

    // TS-7.3
    it("tag pills use /trash base path", async () => {
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Trashed", tags: ["work"] }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue(["work", "personal"]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Tag pills should link to /trash?tag=X, not /browse?tag=X
      expect(body).toContain("/trash?tag=");
      expect(body).not.toMatch(/\/browse\?tag=/);
    });

    // TS-7.4
    it("search form submits to /trash", async () => {
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

      const { app } = await createTestTrash(0);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Search form action should be /trash, not /browse
      expect(body).toMatch(/action="\/trash"/);
    });

    // TS-7.5
    it("old deleted entries still appear", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      // Entry deleted 30 days ago
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Ancient Entry", deleted_at: oldDate }),
      ]);

      const { app } = await createTestTrash(1);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Ancient Entry");
    });
  });
});
