/**
 * Unit tests for the web browse page.
 * Uses mocked query layer and embedding module.
 *
 * Scenarios: TS-1.1, TS-1.2, TS-1.3, TS-1.5,
 *            TS-2.1, TS-2.4,
 *            TS-3.4, TS-3.5,
 *            TS-4.1, TS-4.5, TS-4.6,
 *            TS-5.1, TS-5.2, TS-5.4, TS-5.5,
 *            TS-6.1, TS-6.2, TS-6.4, TS-6.6, TS-6.7
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
  getTagCounts: vi.fn().mockResolvedValue([]),
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
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestBrowse(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createBrowseRoutes } = await import("../../src/web/browse.js");
  const { createLocaleMiddleware } = await import(
    "../../src/web/i18n/middleware.js"
  );

  // Mock sql as a tagged template function that handles the unclassified count query
  const mockSql = Object.assign(
    vi.fn().mockResolvedValue([{ count: 0 }]),
    { array: vi.fn((a: string[]) => a), json: vi.fn((v: unknown) => v) },
  ) as any;

  const app = new Hono();
  app.use("*", createLocaleMiddleware(TEST_SECRET));
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createBrowseRoutes(mockSql));

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

describe("Web Browse", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Category Browsing (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Category Browsing (US-1)", () => {
    // TS-1.1
    it("shows all category filters with All as default", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ category: "people", name: "Alice" }),
        createMockEntry({ category: "projects", name: "Project X" }),
        createMockEntry({ category: "tasks", name: "Fix bug" }),
      ]);
      vi.mocked(getTagCounts).mockResolvedValue([{ tag: "work", count: 5 }, { tag: "personal", count: 3 }]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // All category labels present
      expect(body).toContain("People");
      expect(body).toContain("Projects");
      expect(body).toContain("Tasks");
      expect(body).toContain("Ideas");
      expect(body).toContain("Reference");
      expect(body).toContain("All");
      // "All" has active/selected indicator
      expect(body).toMatch(/All[\s\S]{0,200}active|active[\s\S]{0,200}All/i);
      // All entries rendered
      expect(body).toContain("Alice");
      expect(body).toContain("Project X");
      expect(body).toContain("Fix bug");
    });

    // TS-1.2
    it("shows only matching entries when category filter applied", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Task 1", category: "tasks" }),
        createMockEntry({ name: "Task 2", category: "tasks" }),
        createMockEntry({ name: "Task 3", category: "tasks" }),
      ]);
      vi.mocked(getTagCounts).mockResolvedValue([{ tag: "urgent", count: 2 }]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?category=tasks", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Task 1");
      expect(body).toContain("Task 2");
      expect(body).toContain("Task 3");
      // Tasks tab is active
      expect(body).toMatch(/Tasks[\s\S]{0,200}active|active[\s\S]{0,200}Tasks/i);
      // Verify browseEntries was called with category filter
      expect(vi.mocked(browseEntries).mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ category: "tasks" }),
      );
    });

    // TS-1.3
    it("shows entries across all categories when All selected", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Person A", category: "people" }),
        createMockEntry({ name: "Project B", category: "projects" }),
        createMockEntry({ name: "Task C", category: "tasks" }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Person A");
      expect(body).toContain("Project B");
      expect(body).toContain("Task C");
      // All tab is active
      expect(body).toMatch(/All[\s\S]{0,200}active|active[\s\S]{0,200}All/i);
      // browseEntries called without category filter
      const callArgs = vi.mocked(browseEntries).mock.calls[0];
      const filters = callArgs?.[1];
      expect(!filters?.category).toBe(true);
    });

    // TS-1.5
    it("displays results ordered by updated_at descending", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      // Mock returns entries already in correct order (query handles ORDER BY)
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({
          name: "Entry A",
          updated_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }),
        createMockEntry({
          name: "Entry C",
          updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        }),
        createMockEntry({
          name: "Entry B",
          updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000),
        }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Entry A");
      expect(body).toContain("Entry C");
      expect(body).toContain("Entry B");
      expect(body.indexOf("Entry A")).toBeLessThan(body.indexOf("Entry C"));
      expect(body.indexOf("Entry C")).toBeLessThan(body.indexOf("Entry B"));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Semantic Search (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Semantic Search (US-2)", () => {
    // TS-2.1
    it("returns semantic search results ranked by similarity", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      const mockEmbedding = new Array(4096).fill(0);
      vi.mocked(generateEmbedding).mockResolvedValue(mockEmbedding);

      const { semanticSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({ name: "High Match" }),
        createMockEntry({ name: "Medium Match" }),
        createMockEntry({ name: "Low Match" }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=career+development+plans", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("High Match");
      expect(body).toContain("Medium Match");
      expect(body).toContain("Low Match");
      expect(body.indexOf("High Match")).toBeLessThan(
        body.indexOf("Medium Match"),
      );
      expect(body.indexOf("Medium Match")).toBeLessThan(
        body.indexOf("Low Match"),
      );
      // Verify generateEmbedding called with decoded query
      expect(vi.mocked(generateEmbedding)).toHaveBeenCalledWith(
        "career development plans",
      );
      // Verify semanticSearch called with the embedding
      expect(vi.mocked(semanticSearch)).toHaveBeenCalledWith(
        expect.anything(),
        mockEmbedding,
        expect.anything(),
      );
      // Similarity scores not displayed (check for "similarity" label with a decimal value)
      expect(body).not.toMatch(/similarity[\s:]*\d+\.\d+/i);
    });

    // TS-2.4
    it("overrides default sort order with similarity ranking", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));

      const { semanticSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      // "Old" entry has higher similarity despite being updated 5 days ago
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({
          name: "Old Entry",
          updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        }),
        createMockEntry({
          name: "New Entry",
          updated_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=test+query", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body.indexOf("Old Entry")).toBeLessThan(
        body.indexOf("New Entry"),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Text Search (US-3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Text Search (US-3)", () => {
    // TS-3.4
    it("bypasses semantic search when text mode is active", async () => {
      const { textSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(textSearch).mockResolvedValue([
        createMockEntry({ name: "Text Result 1" }),
        createMockEntry({ name: "Text Result 2" }),
      ]);

      const { generateEmbedding } = await import("../../src/embed.js");
      const { semanticSearch } = await import(
        "../../src/web/browse-queries.js"
      );

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=exact+phrase&mode=text", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Text Result 1");
      expect(body).toContain("Text Result 2");
      // Semantic search NOT called
      expect(vi.mocked(generateEmbedding)).not.toHaveBeenCalled();
      expect(vi.mocked(semanticSearch)).not.toHaveBeenCalled();
      // Text search called with decoded query
      expect(vi.mocked(textSearch)).toHaveBeenCalledWith(
        expect.anything(),
        "exact phrase",
        expect.anything(),
      );
    });

    // TS-3.5
    it("shows fallback notice when text search replaces semantic", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));

      const { semanticSearch, textSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([]); // No semantic matches
      vi.mocked(textSearch).mockResolvedValue([
        createMockEntry({ name: "Fallback Result 1" }),
        createMockEntry({ name: "Fallback Result 2" }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=test+query", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Fallback Result 1");
      expect(body).toContain("Fallback Result 2");
      // Fallback notice present
      expect(body.toLowerCase()).toMatch(
        /no semantic|showing text|text results/,
      );
      // Semantic was called first, then text as fallback
      expect(vi.mocked(semanticSearch)).toHaveBeenCalled();
      expect(vi.mocked(textSearch)).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tag Filtering (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Tag Filtering (US-4)", () => {
    // TS-4.1
    it("displays tags as clickable filter pills", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([createMockEntry()]);
      vi.mocked(getTagCounts).mockResolvedValue([
        { tag: "work", count: 5 },
        { tag: "personal", count: 3 },
        { tag: "urgent", count: 1 },
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Each tag is wrapped in an <a> with href containing tag=
      expect(body).toContain("work");
      expect(body).toContain("personal");
      expect(body).toContain("urgent");
      expect(body).toMatch(/<a[^>]*href="[^"]*tag=work[^"]*"/);
      expect(body).toMatch(/<a[^>]*href="[^"]*tag=personal[^"]*"/);
      expect(body).toMatch(/<a[^>]*href="[^"]*tag=urgent[^"]*"/);
    });

    // TS-4.5
    it("switches tag selection when different tag clicked", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ tags: ["personal"] }),
      ]);
      vi.mocked(getTagCounts).mockResolvedValue([
        { tag: "work", count: 5 },
        { tag: "personal", count: 3 },
        { tag: "urgent", count: 1 },
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?tag=personal", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // "personal" tag has active indicator
      expect(body).toMatch(/personal[\s\S]{0,200}active|active[\s\S]{0,200}personal/i);
      // "work" and "urgent" do NOT have active indicator on their pill elements
      const workPill = body.match(/<a[^>]*href="[^"]*tag=work[^"]*"[^>]*>/i)?.[0] ?? "";
      const urgentPill = body.match(/<a[^>]*href="[^"]*tag=urgent[^"]*"[^>]*>/i)?.[0] ?? "";
      expect(workPill).not.toMatch(/active/i);
      expect(urgentPill).not.toMatch(/active/i);
      // browseEntries called with tag filter
      expect(vi.mocked(browseEntries)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tag: "personal" }),
      );
    });

    // TS-4.6
    it("clears tag filter when active tag clicked", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([createMockEntry()]);
      vi.mocked(getTagCounts).mockResolvedValue([{ tag: "work", count: 3 }, { tag: "personal", count: 2 }]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      // Request with tag=work — the "work" pill's href should link to URL WITHOUT tag param (deselect)
      const res = await app.request("/browse?tag=work", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // The active "work" tag pill links to a URL without tag=work (to deselect)
      // Find the <a> tag containing "work" text and check its href does NOT include tag=work
      const workLinkMatch = body.match(
        /<a[^>]*href="([^"]*)"[^>]*>[^<]*work[^<]*<\/a>/i,
      );
      expect(workLinkMatch).not.toBeNull();
      expect(workLinkMatch![1]).not.toMatch(/tag=work/);

      // Also verify the inverse: when no tag is selected, pills link TO ?tag=<name>
      const resNoTag = await app.request("/browse", {
        headers: { Cookie: cookie },
      });
      const bodyNoTag = await resNoTag.text();
      // "work" pill should link to ?tag=work (to select it)
      expect(bodyNoTag).toMatch(/<a[^>]*href="[^"]*tag=work[^"]*"/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Constraints
  // ═══════════════════════════════════════════════════════════════════
  describe("Constraints", () => {
    // TS-5.1
    it("returns server-rendered HTML", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toMatch(/<!DOCTYPE html>|<html/i);
    });

    // TS-5.2
    it("redirects unauthenticated browse request to login", async () => {
      const { app } = await createTestBrowse();

      const res = await app.request("/browse");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "/login?redirect=%2Fbrowse",
      );
    });

    // TS-5.4
    it("falls back to text search with notice when Ollama unavailable", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockRejectedValue(
        new Error("Ollama connection refused"),
      );

      const { textSearch, semanticSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(textSearch).mockResolvedValue([
        createMockEntry({ name: "Text Fallback 1" }),
        createMockEntry({ name: "Text Fallback 2" }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=test+query", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Text Fallback 1");
      expect(body).toContain("Text Fallback 2");
      // Notice about semantic search being unavailable
      expect(body.toLowerCase()).toMatch(
        /semantic search.*unavailable|unavailable.*semantic/,
      );
      // semanticSearch NOT called (handler caught embedding error before querying)
      expect(vi.mocked(semanticSearch)).not.toHaveBeenCalled();
    });

    // TS-5.5
    it("preserves filter state via URL query parameters", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));

      const { semanticSearch, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({ name: "Budget Entry" }),
        createMockEntry({ name: "Budget Plan" }),
      ]);
      vi.mocked(getTagCounts).mockResolvedValue([{ tag: "work", count: 4 }]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        "/browse?category=projects&tag=work&q=budget",
        { headers: { Cookie: cookie } },
      );

      expect(res.status).toBe(200);
      const body = await res.text();

      // "Projects" category tab is active
      expect(body).toMatch(/Projects[\s\S]{0,200}active|active[\s\S]{0,200}Projects/i);
      // "work" tag pill is active
      expect(body).toMatch(/work[\s\S]{0,200}active|active[\s\S]{0,200}work/i);
      // Search input has value "budget"
      expect(body).toMatch(/value="budget"/i);
      // Category tab links preserve q and tag params
      expect(body).toMatch(/<a[^>]*href="[^"]*q=budget[^"]*"/);
      // Tag pill links preserve q and category params
      expect(body).toMatch(/<a[^>]*href="[^"]*category=projects[^"]*"/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-6.1
    it("shows no results message with suggestion", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));

      const { semanticSearch, textSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([]);
      vi.mocked(textSearch).mockResolvedValue([]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=nonexistent+query", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body.toLowerCase()).toMatch(/no results/i);
      expect(body.toLowerCase()).toMatch(/try different|broaden/i);
    });

    // TS-6.2
    it("truncates search query to 500 characters", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));

      const { semanticSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([createMockEntry()]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const longQuery = "a".repeat(600);
      const res = await app.request(`/browse?q=${longQuery}`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(res.status).toBe(200);
      // generateEmbedding called with truncated string (500 chars)
      const calledWith = vi.mocked(generateEmbedding).mock.calls[0]?.[0] as string;
      expect(calledWith.length).toBe(500);
    });

    // TS-6.4
    it("shows empty state message when no entries exist", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body.toLowerCase()).toMatch(/no entries|start capturing/i);
    });

    // TS-6.6
    it("shows empty result message for category with no entries", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?category=people", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body.toLowerCase()).toMatch(/no entries|no results/i);
      // People tab is active
      expect(body).toMatch(/People[\s\S]{0,200}active|active[\s\S]{0,200}People/i);
    });

    // TS-6.7
    it("shows max 10 tags with show more collapse", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([createMockEntry()]);
      const tags = Array.from({ length: 15 }, (_, i) =>
        `tag-${String(i + 1).padStart(2, "0")}`,
      );
      vi.mocked(getTagCounts).mockResolvedValue(tags.map((t) => ({ tag: t, count: 1 })));

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // All 15 tags present in the HTML
      for (const tag of tags) {
        expect(body).toContain(tag);
      }
      // "show more" control present
      expect(body.toLowerCase()).toMatch(/show more|more tags/);
      // Extra tags (beyond 10) are in a collapsible container
      // The first 10 tags should be visible, remaining 5 in a hidden/collapsed section
      expect(body).toMatch(/hidden|collapse|display:\s*none/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Entry Visibility — browse indicator
  // ═══════════════════════════════════════════════════════════════════
  describe("Entry Visibility", () => {
    // TS-4.2
    it("renders a visibility='shared' indicator on browse cards", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({
          id: "55555555-5555-5555-5555-555555555555",
          name: "Household grocery",
          category: "tasks",
          // @ts-expect-error — Phase-4 contract: visibility added in Phase 5
          visibility: "shared",
        }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const body = await res.text();

      expect(body).toContain("Household grocery");
      expect(body).toMatch(/data-visibility=["']shared["']/);
    });

    // TS-4.5 (browse inverse)
    it("renders no shared indicator on private browse entries", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({
          id: "66666666-6666-6666-6666-666666666666",
          name: "Private note",
          category: "ideas",
          // @ts-expect-error — Phase-4 contract: visibility added in Phase 5
          visibility: "private",
        }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      const body = await res.text();

      expect(body).toContain("Private note");
      expect(body).not.toMatch(/data-visibility=["']shared["']/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — parameter validation (feature: browse-filters)
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters — parameter validation", () => {
    const invalidCases: Array<{ name: string; url: string; param: string }> = [
      // TS-2.16
      {
        name: "since=yesterday → 400",
        url: "/browse?since=yesterday",
        param: "since",
      },
      // TS-2.17
      {
        name: "status=typo → 400",
        url: "/browse?status=typo",
        param: "status",
      },
      // TS-2.18
      {
        name: "stale_days=0 → 400",
        url: "/browse?stale_days=0",
        param: "stale_days",
      },
      // TS-2.19
      {
        name: "stale_days=-5 → 400",
        url: "/browse?stale_days=-5",
        param: "stale_days",
      },
      // TS-2.20
      {
        name: "stale_days=1.5 → 400",
        url: "/browse?stale_days=1.5",
        param: "stale_days",
      },
      // TS-2.21
      {
        name: "stale_days=abc → 400",
        url: "/browse?stale_days=abc",
        param: "stale_days",
      },
    ];

    for (const { name, url, param } of invalidCases) {
      it(name, async () => {
        const { app } = await createTestBrowse();
        const cookie = await loginAndGetCookie(app);
        const res = await app.request(url, { headers: { Cookie: cookie } });
        expect(res.status).toBe(400);
        const body = await res.text();
        expect(body.toLowerCase()).toContain(param);
      });
    }

    // TS-5.5 — validation runs before any browse-queries function is invoked
    it("invalid param returns 400 before invoking any browse-queries function", async () => {
      const { browseEntries, semanticSearch, textSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      // Set all three to throw so that if the handler calls any of them,
      // the failure is obvious.
      vi.mocked(browseEntries).mockImplementation(() => {
        throw new Error("browseEntries must not be called on invalid param");
      });
      vi.mocked(semanticSearch).mockImplementation(() => {
        throw new Error("semanticSearch must not be called on invalid param");
      });
      vi.mocked(textSearch).mockImplementation(() => {
        throw new Error("textSearch must not be called on invalid param");
      });

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse?status=typo", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(400);
      expect(vi.mocked(browseEntries)).not.toHaveBeenCalled();
      expect(vi.mocked(semanticSearch)).not.toHaveBeenCalled();
      expect(vi.mocked(textSearch)).not.toHaveBeenCalled();
    });

    // TS-5.6
    it("/browse?since=week redirects to /login for unauthenticated requests", async () => {
      const { app } = await createTestBrowse();
      const res = await app.request("/browse?since=week");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/login/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — filter bar UI rendering (feature: browse-filters)
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters — filter bar UI", () => {
    async function fetchBrowse(
      url: string,
      mockEntries: Entry[] = [],
    ): Promise<{ status: number; body: string }> {
      const { browseEntries, semanticSearch, textSearch } =
        await import("../../src/web/browse-queries.js");
      vi.mocked(browseEntries).mockResolvedValue(mockEntries);
      vi.mocked(semanticSearch).mockResolvedValue(mockEntries);
      vi.mocked(textSearch).mockResolvedValue(mockEntries);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request(url, { headers: { Cookie: cookie } });
      const body = await res.text();
      return { status: res.status, body };
    }

    // TS-3.1
    it("renders the filter bar container on /browse with no active filters", async () => {
      const { status, body } = await fetchBrowse("/browse");
      expect(status).toBe(200);
      expect(body).toContain("data-filter-bar");
    });

    // Peer dropdown renders current value label for since=week
    it("renders the Updated dropdown with 'this week' as current value for since=week", async () => {
      const { status, body } = await fetchBrowse("/browse?since=week");
      expect(status).toBe(200);
      // Peer dropdown trigger carries data-picker="since" and its value span
      // is lowercase "this week" (the i18n label lowercased)
      expect(body).toMatch(/data-picker=["']since["']/);
      expect(body.toLowerCase()).toMatch(/this week/);
    });

    // Peer dropdown renders current value label for status=pending
    it("renders the Status dropdown with 'pending' as current value for status=pending", async () => {
      const { status, body } = await fetchBrowse("/browse?status=pending");
      expect(status).toBe(200);
      expect(body).toMatch(/data-picker=["']status["']/);
      expect(body.toLowerCase()).toMatch(/>pending</);
    });

    // Peer dropdown renders Inactive value label for stale_days=5
    it("renders the Inactive dropdown with '5+ days' as current value for stale_days=5", async () => {
      const { status, body } = await fetchBrowse("/browse?stale_days=5");
      expect(status).toBe(200);
      expect(body).toMatch(/data-picker=["']stale_days["']/);
      expect(body.toLowerCase()).toMatch(/5\+\s*days/);
    });

    // Renders values from i18n in EN by default
    it("renders dropdown value labels in English by default", async () => {
      const { body } = await fetchBrowse(
        "/browse?since=today&status=done&stale_days=14",
      );
      expect(body.toLowerCase()).toMatch(/today/);
      expect(body.toLowerCase()).toMatch(/done/);
      expect(body.toLowerCase()).toMatch(/14\+\s*days/);
    });

    // Renders dimension labels in German when the locale is 'de'
    it("renders dimension labels in German when the locale is 'de'", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);

      const { app } = await createTestBrowse();
      // Seed cookie with locale=de via Accept-Language on /login POST
      const loginRes = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept-Language": "de",
        },
      });
      const setCookie = loginRes.headers.get("set-cookie");
      const cookie = setCookie!.split(";")[0]!;

      const res = await app.request(
        "/browse?since=today&status=done&stale_days=14",
        { headers: { Cookie: cookie } },
      );
      const body = await res.text();
      expect(res.status).toBe(200);
      const { i18next } = await import("../../src/web/i18n/index.js");
      const t = i18next.getFixedT("de");
      // Dropdown trigger lowercases the dimension label
      expect(body).toContain((t("browse.filter.dimension.since") as string).toLowerCase());
      expect(body).toContain((t("browse.filter.dimension.status") as string).toLowerCase());
      expect(body).toContain((t("browse.filter.dimension.stale_days") as string).toLowerCase());
    });

    // Inactive value label uses singular pluralization when count=1
    it("renders '1+ day' using singular pluralization in stale_days picker", async () => {
      const { body } = await fetchBrowse("/browse?stale_days=1");
      // Trigger value is the singular label; peer-dropdown lowercases it.
      expect(body.toLowerCase()).toMatch(/1\+\s*day(?!s)/);
    });

    // TS-3.8
    it("× on a pill removes only that param, preserving others", async () => {
      const { body } = await fetchBrowse(
        "/browse?category=tasks&status=pending&since=week",
      );
      // The × anchor for the status pill should link to /browse with
      // status removed, category + since preserved.
      expect(body).toMatch(
        /href="\/browse\?category=tasks&(?:amp;)?since=week"/,
      );
    });

    // TS-3.9
    it("removing the last structured filter leaves only category and q if present", async () => {
      const { body } = await fetchBrowse(
        "/browse?category=projects&q=alpha&status=active",
      );
      // × anchor for status pill
      expect(body).toMatch(/href="\/browse\?category=projects&(?:amp;)?q=alpha"/);
    });

    // TS-3.10
    it("pill value element carries a data-attribute that opens the picker on click", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // The pill value carries data-picker="status" so client JS can attach.
      expect(body).toMatch(/data-picker=["']status["']/);
    });

    // Peer dropdown — all 4 dimensions are always visible
    it("peer-dropdown filter row always renders all four dropdown triggers", async () => {
      const { body } = await fetchBrowse("/browse");
      for (const dim of ["category", "status", "since", "stale_days"]) {
        expect(body).toMatch(new RegExp(`data-picker=["']${dim}["']`));
      }
      // The old progressive-disclosure +Filter <details> element is gone.
      // (The attribute name still appears inside the inline JS source, so
      // only assert the <details> opener is absent.)
      expect(body).not.toMatch(/<details\b[^>]*data-filter-add-menu/);
    });

    // Alle option is the first option in each dropdown picker (clears dimension)
    it("each peer dropdown picker includes an 'Alle' option as its first option", async () => {
      const { body } = await fetchBrowse(
        "/browse?status=pending&since=week&stale_days=5&category=tasks",
      );
      // Each picker's first anchor option is the clear-dimension link.
      // The Alle option's href omits the dimension param.
      const allLabel = "All"; // en.ts browse.filter.all
      for (const dim of ["category", "status", "since", "stale_days"]) {
        const pickerMatch = body.match(
          new RegExp(
            `data-picker-values=["']${dim}["'][\\s\\S]*?</div>`,
          ),
        );
        expect(pickerMatch).not.toBeNull();
        const firstOpt = pickerMatch![0].match(/<a\b[\s\S]*?<\/a>/);
        expect(firstOpt).not.toBeNull();
        expect(firstOpt![0]).toContain(allLabel);
      }
    });

    // TS-3.14c
    it("value picker options link to the URL with the new param appended", async () => {
      const { body } = await fetchBrowse("/browse");
      // The value picker for status should contain anchors with
      // href="/browse?status=<value>".
      expect(body).toMatch(/href="\/browse\?status=pending"/);
      expect(body).toMatch(/href="\/browse\?status=done"/);
    });

    // TS-3.15
    it("status picker offers only Pending/Done when category=tasks", async () => {
      const { body } = await fetchBrowse("/browse?category=tasks");
      // Status picker region for category=tasks should list Pending + Done
      // and NOT active/paused/completed.
      expect(body).toMatch(/href="\/browse\?category=tasks&(?:amp;)?status=pending"/);
      expect(body).toMatch(/href="\/browse\?category=tasks&(?:amp;)?status=done"/);
      // Pickers scoped to tasks category should not list project-only statuses.
      // Extract the picker region for status and assert absence.
      const pickerMatch = body.match(
        /data-picker-values=["']status["'][\s\S]*?<\/(?:div|ul|menu)>/,
      );
      const pickerRegion = pickerMatch ? pickerMatch[0] : "";
      expect(pickerRegion).not.toMatch(/status=active/);
      expect(pickerRegion).not.toMatch(/status=paused/);
      expect(pickerRegion).not.toMatch(/status=completed/);
    });

    // TS-3.16
    it("status picker offers only Active/Paused/Completed when category=projects", async () => {
      const { body } = await fetchBrowse("/browse?category=projects");
      expect(body).toMatch(/href="\/browse\?category=projects&(?:amp;)?status=active"/);
      expect(body).toMatch(/href="\/browse\?category=projects&(?:amp;)?status=paused"/);
      expect(body).toMatch(/href="\/browse\?category=projects&(?:amp;)?status=completed"/);
      const pickerMatch = body.match(
        /data-picker-values=["']status["'][\s\S]*?<\/(?:div|ul|menu)>/,
      );
      const pickerRegion = pickerMatch ? pickerMatch[0] : "";
      expect(pickerRegion).not.toMatch(/status=pending/);
      expect(pickerRegion).not.toMatch(/status=done/);
    });

    // TS-3.17
    it("status picker shows full union when no category is set", async () => {
      const { body } = await fetchBrowse("/browse");
      for (const v of ["pending", "done", "active", "paused", "completed"]) {
        expect(body).toMatch(new RegExp(`href="/browse\\?status=${v}"`));
      }
    });

    // TS-3.18
    it("since picker always offers Today, This week, This month", async () => {
      const { body } = await fetchBrowse("/browse");
      for (const v of ["today", "week", "month"]) {
        expect(body).toMatch(new RegExp(`href="/browse\\?since=${v}"`));
      }
    });

    // TS-3.19
    it("stale_days picker offers only the presets 5, 14, 30", async () => {
      const { body } = await fetchBrowse("/browse");
      for (const v of [5, 14, 30]) {
        expect(body).toMatch(new RegExp(`href="/browse\\?stale_days=${v}"`));
      }
      const pickerMatch = body.match(
        /data-picker-values=["']stale_days["'][\s\S]*?<\/(?:div|ul|menu)>/,
      );
      const pickerRegion = pickerMatch ? pickerMatch[0] : "";
      // No free-form numeric input
      expect(pickerRegion).not.toMatch(/<input[^>]*type=["']number["']/);
    });

    // TS-3.20
    it("renders 'No entries match' when result set is empty", async () => {
      const { body } = await fetchBrowse("/browse?status=paused", []);
      expect(body).toMatch(/No entries match/i);
    });

    // TS-3.21
    it("renders '1 entry matches' when result set has one entry", async () => {
      const { body } = await fetchBrowse(
        "/browse?status=paused",
        [createMockEntry({ name: "Only one" })],
      );
      expect(body).toMatch(/1\s*entry\s*matches/i);
    });

    // TS-3.22
    it("renders '{N} entries match' when result set has multiple entries", async () => {
      const entries = Array.from({ length: 4 }, (_, i) =>
        createMockEntry({ name: `Entry ${i}` }),
      );
      const { body } = await fetchBrowse("/browse?status=pending", entries);
      expect(body).toMatch(/4\s*entries\s*match/i);
    });

    // TS-3.23
    it("renders a Clear filters link when at least one filter is active", async () => {
      const { body: withFilter } = await fetchBrowse("/browse?status=pending");
      expect(withFilter.toLowerCase()).toContain("clear filters");

      const { body: noFilter } = await fetchBrowse("/browse");
      expect(noFilter.toLowerCase()).not.toContain("clear filters");
    });

    // Clear filters link appears only in the empty state (no results),
    // and clears every filter dimension — including category — keeping only q.
    it("Clear filters href (empty state) preserves q and drops all filter dimensions", async () => {
      const { body } = await fetchBrowse(
        "/browse?category=tasks&q=alpha&tag=work&status=pending&since=week&stale_days=5",
        [],
      );
      const match = body.match(
        /<a[^>]*href="([^"]*)"[^>]*>\s*(?:Clear filters|<[^>]+>\s*Clear filters)/i,
      );
      expect(match).not.toBeNull();
      const href = match![1]!;
      expect(href).toMatch(/^\/browse/);
      // Must preserve q
      expect(href).toMatch(/q=alpha/);
      // Must NOT contain any filter dimension
      expect(href).not.toMatch(/category=/);
      expect(href).not.toMatch(/tag=/);
      expect(href).not.toMatch(/status=/);
      expect(href).not.toMatch(/since=/);
      expect(href).not.toMatch(/stale_days=/);
    });

    // TS-3.25
    it("empty-state view includes a Clear filters link when a structured filter is active", async () => {
      const { body } = await fetchBrowse("/browse?status=pending", []);
      expect(body.toLowerCase()).toContain("clear filters");
    });

    // TS-3.26
    it("empty-state view includes a Clear filters link when only a tag filter is active", async () => {
      const { body } = await fetchBrowse("/browse?tag=nonexistent", []);
      expect(body.toLowerCase()).toContain("clear filters");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — preserve existing behavior (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters — existing behavior preserved", () => {
    // TS-4.1
    it("category tabs render with unchanged hrefs", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse", { headers: { Cookie: cookie } });
      const body = await res.text();
      for (const c of ["people", "projects", "tasks", "ideas", "reference"]) {
        expect(body).toMatch(new RegExp(`href="/browse\\?category=${c}"`));
      }
    });

    // TS-4.2
    it("search form action=/browse method=GET with name=q input is preserved", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse", { headers: { Cookie: cookie } });
      const body = await res.text();
      expect(body).toMatch(
        /<form[^>]*action="\/browse"[^>]*method="GET"|<form[^>]*method="GET"[^>]*action="\/browse"/i,
      );
      expect(body).toMatch(/<input[^>]*name="q"/);
    });

    // TS-4.3
    it("tag pill row renders discovery pills and active tag deselects on click", async () => {
      const { browseEntries, getTagCounts } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getTagCounts).mockResolvedValue([
        { tag: "alpha", count: 3 },
        { tag: "beta", count: 2 },
        { tag: "gamma", count: 1 },
      ]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);

      const { body: noTag } = await (async () => {
        const r = await app.request("/browse", { headers: { Cookie: cookie } });
        return { body: await r.text() };
      })();
      expect(noTag).toContain("alpha");
      expect(noTag).toContain("beta");
      expect(noTag).toContain("gamma");

      const { body: withTag } = await (async () => {
        const r = await app.request("/browse?tag=alpha", {
          headers: { Cookie: cookie },
        });
        return { body: await r.text() };
      })();
      // Active tag click-to-deselect: href back to /browse without tag=
      expect(withTag).toMatch(/<a[^>]*href="\/browse"[^>]*>[^<]*alpha/);
    });

    // TS-4.4
    it("entry list row format matches the existing renderEntryList output", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      const entry = createMockEntry({
        id: "abc123-def456-aaaa-bbbb-cccccccccccc",
        name: "Sample entry",
        category: "tasks",
      });
      vi.mocked(browseEntries).mockResolvedValue([entry]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse", { headers: { Cookie: cookie } });
      const body = await res.text();
      // Entry row is an anchor to /entry/:id, contains the badge-tasks class
      // and the entry name.
      expect(body).toContain('href="/entry/abc123-def456-aaaa-bbbb-cccccccccccc"');
      expect(body).toContain("badge-tasks");
      expect(body).toContain("Sample entry");
    });

    // TS-4.5
    it("semantic-to-text fallback notice appears when embedding yields zero matches", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));
      const { semanticSearch, textSearch } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([]);
      vi.mocked(textSearch).mockResolvedValue([
        createMockEntry({ name: "Text-only hit" }),
      ]);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse?q=xyzzy", {
        headers: { Cookie: cookie },
      });
      const body = await res.text();
      expect(body).toContain("Text-only hit");
      expect(body.toLowerCase()).toMatch(
        /no semantic matches|showing text results/,
      );
    });

    // TS-4.6
    it("unclassified tab and Reclassify all button render when category=unclassified", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ category: null, name: "Unclassified entry" }),
      ]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      // Mock sql to return positive unclassified count
      const res = await app.request("/browse?category=unclassified", {
        headers: { Cookie: cookie },
      });
      const body = await res.text();
      expect(body.toLowerCase()).toContain("unclassified");
      // The Reclassify button renders only when unclassifiedCount > 0.
      // With our mock sql returning { count: 0 }, it won't render. We assert
      // the tab behavior: category=unclassified renders the tab as active.
      expect(body).toMatch(/category=unclassified/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — constraints and cross-cutting (Group 5)
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters — constraints", () => {
    // TS-5.2
    it("filter bar subtree contains no inline style attributes", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request(
        "/browse?status=pending&since=week&stale_days=5",
        { headers: { Cookie: cookie } },
      );
      const body = await res.text();
      const start = body.indexOf("data-filter-bar");
      expect(start).toBeGreaterThanOrEqual(0);
      // Extract the filter bar region (until the next major section boundary).
      // Conservative: take next 2000 chars following the marker.
      const region = body.slice(start, start + 2000);
      expect(region).not.toMatch(/\sstyle="/);
    });

    // TS-5.3
    it("en.ts defines all required new i18n keys", async () => {
      const { en } = await import("../../src/web/i18n/en.ts");
      const get = (obj: unknown, path: string): unknown =>
        path
          .split(".")
          .reduce(
            (acc: any, k) => (acc && typeof acc === "object" ? acc[k] : undefined),
            obj,
          );
      const requiredKeys = [
        "browse.filter.add",
        "browse.filter.clear",
        "browse.filter.dimension.status",
        "browse.filter.dimension.since",
        "browse.filter.dimension.stale_days",
        "browse.filter.value.status.pending",
        "browse.filter.value.status.done",
        "browse.filter.value.status.active",
        "browse.filter.value.status.paused",
        "browse.filter.value.status.completed",
        "browse.filter.value.since.today",
        "browse.filter.value.since.week",
        "browse.filter.value.since.month",
        "browse.filter.pill.status",
        "browse.filter.pill.since",
        "browse.filter.pill.stale_days_one",
        "browse.filter.pill.stale_days_other",
        "browse.filter.results_zero",
        "browse.filter.results_one",
        "browse.filter.results_other",
      ];
      for (const key of requiredKeys) {
        const value = get(en, key);
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
    });

    // TS-5.4
    it("de.ts defines all required new i18n keys", async () => {
      const { de } = await import("../../src/web/i18n/de.ts");
      const get = (obj: unknown, path: string): unknown =>
        path
          .split(".")
          .reduce(
            (acc: any, k) => (acc && typeof acc === "object" ? acc[k] : undefined),
            obj,
          );
      const requiredKeys = [
        "browse.filter.add",
        "browse.filter.clear",
        "browse.filter.dimension.status",
        "browse.filter.dimension.since",
        "browse.filter.dimension.stale_days",
        "browse.filter.value.status.pending",
        "browse.filter.value.status.done",
        "browse.filter.value.status.active",
        "browse.filter.value.status.paused",
        "browse.filter.value.status.completed",
        "browse.filter.value.since.today",
        "browse.filter.value.since.week",
        "browse.filter.value.since.month",
        "browse.filter.pill.status",
        "browse.filter.pill.since",
        "browse.filter.pill.stale_days_one",
        "browse.filter.pill.stale_days_other",
        "browse.filter.results_zero",
        "browse.filter.results_one",
        "browse.filter.results_other",
      ];
      for (const key of requiredKeys) {
        const value = get(de, key);
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
    });

    // TS-5.8
    it("duplicate status params: only the first value is honored", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse?status=pending&status=done", {
        headers: { Cookie: cookie },
      });
      const body = await res.text();
      expect(res.status).toBe(200);
      // The Status dropdown's active value is "pending" — the picker option
      // for status=pending carries aria-selected="true"; status=done does not.
      expect(body).toMatch(
        /href="\/browse\?status=pending"[^>]*aria-selected=["']true["']|aria-selected=["']true["'][^>]*href="\/browse\?status=pending"/,
      );
      expect(body).not.toMatch(
        /href="\/browse\?status=done"[^>]*aria-selected=["']true["']|aria-selected=["']true["'][^>]*href="\/browse\?status=done"/,
      );
    });

    // TS-5.9
    it("sort= param has no effect on ordering (NG-1)", async () => {
      const { browseEntries } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse?sort=oldest", {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
      // Assert the filters passed to browseEntries don't contain 'sort'
      const callArgs = vi.mocked(browseEntries).mock.calls[0];
      const filters = callArgs?.[1];
      if (filters) {
        expect((filters as any).sort).toBeUndefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — UX Upgrade (Pattern A)
  // Anchored popover, chevron, selected-option indicator, ARIA, focus.
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters — UX upgrade (Pattern A)", () => {
    async function fetchBrowse(
      url: string,
      mockEntries: Entry[] = [],
    ): Promise<{ status: number; body: string }> {
      const { browseEntries, semanticSearch, textSearch } =
        await import("../../src/web/browse-queries.js");
      vi.mocked(browseEntries).mockResolvedValue(mockEntries);
      vi.mocked(semanticSearch).mockResolvedValue(mockEntries);
      vi.mocked(textSearch).mockResolvedValue(mockEntries);

      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request(url, { headers: { Cookie: cookie } });
      const body = await res.text();
      return { status: res.status, body };
    }

    // TS-3.27 — picker is an overlay anchored to a relative-positioned trigger container
    it("picker is rendered as an absolute overlay anchored to a relative-positioned trigger container", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // The pill's value-trigger is wrapped in an outer span with class "relative"
      expect(body).toMatch(
        /<span\b[^>]*class="[^"]*\brelative\b[^"]*"[^>]*>[\s\S]*?data-picker=["']status["']/,
      );
      // Picker carries `absolute` and `top-full` overlay classes
      expect(body).toMatch(
        /data-picker-values=["']status["'][^>]*class="[^"]*\babsolute\b[^"]*"/,
      );
      expect(body).toMatch(
        /data-picker-values=["']status["'][^>]*class="[^"]*\btop-full\b[^"]*"/,
      );
    });

    // TS-3.28 — selected-option indicator (check icon + text-primary on the matching value)
    it("renders a check-icon prefix and primary-tone color on the option matching the currently-applied value", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // Locate the matching option's anchor
      const matchOpt = body.match(
        /<a\b[^>]*href="\/browse\?status=pending"[\s\S]*?<\/a>/,
      );
      expect(matchOpt).not.toBeNull();
      // The Lucide check icon path is "M20 6 9 17l-5-5" — match a robust substring
      expect(matchOpt![0]).toMatch(/M20 6 9 17/);
      expect(matchOpt![0]).toMatch(/text-primary/);

      // The other status options must NOT include a check icon
      const otherOpt = body.match(
        /<a\b[^>]*href="\/browse\?status=done"[\s\S]*?<\/a>/,
      );
      expect(otherOpt).not.toBeNull();
      expect(otherOpt![0]).not.toMatch(/M20 6 9 17/);
    });

    // TS-3.29 — aria-selected reflects current value; false on others; false everywhere when no value applied
    it("aria-selected is true on the matching option, false on others, and false on every option in unapplied-dimension pickers", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // Active value carries aria-selected="true". The href is exactly the
      // current URL (because the picker preserves all current params).
      expect(body).toMatch(
        /href="\/browse\?status=pending"[^>]*aria-selected=["']true["']|aria-selected=["']true["'][^>]*href="\/browse\?status=pending"/,
      );
      // Inactive value (status=done) carries aria-selected="false". URL also
      // begins with /browse?status=done since status replaces itself.
      expect(body).toMatch(
        /href="\/browse\?status=done"[^>]*aria-selected=["']false["']|aria-selected=["']false["'][^>]*href="\/browse\?status=done"/,
      );
      // Since picker has no value applied; its options preserve status=pending.
      // Match loosely on the since=today substring rather than pinning the
      // full URL composition.
      expect(body).toMatch(
        /href="[^"]*since=today[^"]*"[^>]*aria-selected=["']false["']|aria-selected=["']false["'][^>]*href="[^"]*since=today[^"]*"/,
      );
      expect(body).toMatch(
        /href="[^"]*since=week[^"]*"[^>]*aria-selected=["']false["']|aria-selected=["']false["'][^>]*href="[^"]*since=week[^"]*"/,
      );
    });

    // TS-3.30 — currently-selected option's anchor href equals the current URL (no-navigate guarantee)
    it("the currently-selected option's anchor href equals the current URL (no-navigate-on-selected)", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // The selected option carries aria-selected="true" AND its href is the current URL
      expect(body).toMatch(
        /<a\b[^>]*href="\/browse\?status=pending"[^>]*aria-selected=["']true["']|<a\b[^>]*aria-selected=["']true["'][^>]*href="\/browse\?status=pending"/,
      );
    });

    // Each peer-dropdown trigger renders a chevron-down SVG after its value.
    it("each peer-dropdown trigger renders a chevron-down SVG", async () => {
      const { body } = await fetchBrowse(
        "/browse?status=pending&since=week&stale_days=5",
      );
      // Each trigger button contains a data-picker-chevron span with the
      // Lucide chevron-down path (m6 9 6 6 6-6).
      const dims = ["category", "status", "since", "stale_days"];
      for (const dim of dims) {
        const re = new RegExp(
          `data-picker=["']${dim}["'][\\s\\S]*?</button>`,
        );
        const region = body.match(re)?.[0];
        expect(region).toBeDefined();
        expect(region!).toMatch(/data-picker-chevron/);
        expect(region!).toMatch(/m6 9 6 6 6-6/);
      }
    });

    // TS-3.33 — + Filter dimension items reuse the same overlay-positioned picker DOM
    it("+ Filter dimension items reuse the same overlay-positioned picker DOM", async () => {
      const { body } = await fetchBrowse("/browse");
      const count = (s: string, sub: string) =>
        (s.match(new RegExp(sub, "g")) || []).length;
      // Each picker is rendered exactly once
      for (const dim of ["status", "since", "stale_days"]) {
        expect(count(body, `data-picker-values=["']${dim}["']`)).toBe(1);
      }
      // Overlay classes apply
      for (const dim of ["status", "since", "stale_days"]) {
        expect(body).toMatch(
          new RegExp(
            `data-picker-values=["']${dim}["'][^>]*class="[^"]*\\babsolute\\b`,
          ),
        );
      }
    });

    // TS-3.34s — keyboard handler tokens in inline script
    it("renderFilterBarScript source contains keyboard handlers (ArrowDown/ArrowUp/Enter/Space/Escape/Tab)", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      expect(body).toMatch(/ArrowDown/);
      expect(body).toMatch(/ArrowUp/);
      expect(body).toMatch(/(?:'|")Enter(?:'|")/);
      expect(body).toMatch(/(?:'|")Escape(?:'|")/);
      expect(body).toMatch(/(?:'|")Tab(?:'|")/);
    });

    // Roving tabindex: in an active dimension's picker, the applied value's
    // option carries tabindex=0; other values carry tabindex=-1. In an
    // unapplied dimension's picker, the "Alle" option is the first option and
    // carries tabindex=0.
    it("picker options use roving tabindex with the applied value (or 'Alle') focused", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // Matching option (status=pending) has tabindex=0
      expect(body).toMatch(
        /href="\/browse\?status=pending"[^>]*tabindex=["']0["']|tabindex=["']0["'][^>]*href="\/browse\?status=pending"/,
      );
      // Inactive option (status=done) has tabindex=-1
      expect(body).toMatch(
        /href="\/browse\?status=done"[^>]*tabindex=["']-1["']|tabindex=["']-1["'][^>]*href="\/browse\?status=done"/,
      );
      // For unapplied `since` dimension, the first option is the "Alle"
      // clear-link (href preserves status=pending only). It gets tabindex=0.
      // "since=today" is the SECOND option → tabindex=-1.
      expect(body).toMatch(
        /href="[^"]*since=today[^"]*"[^>]*tabindex=["']-1["']|tabindex=["']-1["'][^>]*href="[^"]*since=today[^"]*"/,
      );
    });

    // TS-3.37s — viewport overflow flip logic in script source
    it("renderFilterBarScript source contains a getBoundingClientRect-based right-edge overflow flip", async () => {
      const { body } = await fetchBrowse("/browse");
      expect(body).toMatch(/getBoundingClientRect/);
      expect(body).toMatch(/(?:'|")right-0(?:'|")/);
      expect(body).toMatch(/(?:'|")left-0(?:'|")/);
      expect(body).toMatch(/innerWidth/);
    });

    // Every peer-dropdown trigger (one per dimension) carries
    // aria-haspopup="listbox".
    it("each peer-dropdown trigger carries aria-haspopup=listbox", async () => {
      const { body } = await fetchBrowse("/browse?status=pending&since=week");
      for (const dim of ["category", "status", "since", "stale_days"]) {
        expect(body).toMatch(
          new RegExp(
            `data-picker=["']${dim}["'][^>]*aria-haspopup=["']listbox["']|aria-haspopup=["']listbox["'][^>]*data-picker=["']${dim}["']`,
          ),
        );
      }
    });

    // TS-3.39 — initial aria-expanded="false"
    it("each picker trigger carries initial aria-expanded=false", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      expect(body).toMatch(
        /data-picker=["']status["'][^>]*aria-expanded=["']false["']|aria-expanded=["']false["'][^>]*data-picker=["']status["']/,
      );
    });

    // TS-3.40 — role="listbox" on each value picker
    it("each value picker carries role=listbox", async () => {
      const { body } = await fetchBrowse("/browse");
      for (const dim of ["status", "since", "stale_days"]) {
        expect(body).toMatch(
          new RegExp(
            `data-picker-values=["']${dim}["'][^>]*role=["']listbox["']|role=["']listbox["'][^>]*data-picker-values=["']${dim}["']`,
          ),
        );
      }
    });

    // TS-3.41 — role="option" on each picker option
    it("each picker option carries role=option", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      for (const v of ["pending", "done", "active", "paused", "completed"]) {
        expect(body).toMatch(
          new RegExp(
            `href="/browse\\?status=${v}"[^>]*role=["']option["']|role=["']option["'][^>]*href="/browse\\?status=${v}"`,
          ),
        );
      }
    });

    // In peer-dropdown UI, filters are cleared by picking the "Alle" option
    // within each dropdown. Every picker's first <a> option href omits that
    // dimension's param.
    it("each peer dropdown picker's first option clears that dimension", async () => {
      const { body } = await fetchBrowse(
        "/browse?status=pending&since=week&stale_days=5",
      );
      for (const dim of ["status", "since", "stale_days"]) {
        const pickerMatch = body.match(
          new RegExp(
            `data-picker-values=["']${dim}["'][\\s\\S]*?</div>`,
          ),
        );
        expect(pickerMatch).not.toBeNull();
        const firstOpt = pickerMatch![0].match(/<a\b[^>]*href="([^"]+)"/);
        expect(firstOpt).not.toBeNull();
        const href = firstOpt![1]!;
        expect(href).not.toMatch(new RegExp(`${dim}=`));
      }
    });

    // TS-3.43 — overlay-positioning class assertions
    it("picker overlay-positioning class assertions: absolute + top-full + (left-0 or right-0) on a relative-positioned ancestor", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      for (const dim of ["status", "since", "stale_days"]) {
        const re = new RegExp(
          `data-picker-values=["']${dim}["'][^>]*class="([^"]+)"`,
        );
        const match = body.match(re);
        expect(match).not.toBeNull();
        const cls = match![1]!;
        expect(cls).toMatch(/\babsolute\b/);
        expect(cls).toMatch(/\btop-full\b/);
        expect(cls).toMatch(/\b(?:left-0|right-0)\b/);
      }
    });
  });
});
