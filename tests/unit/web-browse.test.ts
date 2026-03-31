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
}));

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
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

  // Mock sql as a tagged template function that handles the unclassified count query
  const mockSql = Object.assign(
    vi.fn().mockResolvedValue([{ count: 0 }]),
    { array: vi.fn((a: string[]) => a), json: vi.fn((v: unknown) => v) },
  ) as any;

  const app = new Hono();
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ category: "people", name: "Alice" }),
        createMockEntry({ category: "projects", name: "Project X" }),
        createMockEntry({ category: "tasks", name: "Fix bug" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue(["work", "personal"]);

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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ name: "Task 1", category: "tasks" }),
        createMockEntry({ name: "Task 2", category: "tasks" }),
        createMockEntry({ name: "Task 3", category: "tasks" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue(["urgent"]);

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
      const mockEmbedding = new Array(1024).fill(0);
      vi.mocked(generateEmbedding).mockResolvedValue(mockEmbedding);

      const { semanticSearch, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({ name: "High Match" }),
        createMockEntry({ name: "Medium Match" }),
        createMockEntry({ name: "Low Match" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0));

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
      const { textSearch, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(textSearch).mockResolvedValue([
        createMockEntry({ name: "Text Result 1" }),
        createMockEntry({ name: "Text Result 2" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0));

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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([createMockEntry()]);
      vi.mocked(getFilterTags).mockResolvedValue([
        "work",
        "personal",
        "urgent",
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([
        createMockEntry({ tags: ["personal"] }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue([
        "work",
        "personal",
        "urgent",
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([createMockEntry()]);
      vi.mocked(getFilterTags).mockResolvedValue(["work", "personal"]);

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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0));

      const { semanticSearch, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([
        createMockEntry({ name: "Budget Entry" }),
        createMockEntry({ name: "Budget Plan" }),
      ]);
      vi.mocked(getFilterTags).mockResolvedValue(["work"]);

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
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0));

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
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0));

      const { semanticSearch, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(semanticSearch).mockResolvedValue([createMockEntry()]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([createMockEntry()]);
      const tags = Array.from({ length: 15 }, (_, i) =>
        `tag-${String(i + 1).padStart(2, "0")}`,
      );
      vi.mocked(getFilterTags).mockResolvedValue(tags);

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
});
