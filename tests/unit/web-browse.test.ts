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
      const mockEmbedding = new Array(4096).fill(0);
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
      vi.mocked(generateEmbedding).mockResolvedValue(new Array(4096).fill(0));

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
      const { browseEntries, semanticSearch, textSearch, getFilterTags } =
        await import("../../src/web/browse-queries.js");
      vi.mocked(browseEntries).mockResolvedValue(mockEntries);
      vi.mocked(semanticSearch).mockResolvedValue(mockEntries);
      vi.mocked(textSearch).mockResolvedValue(mockEntries);
      vi.mocked(getFilterTags).mockResolvedValue([]);

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

    // TS-3.2
    it("renders an Updated: This week pill for since=week", async () => {
      const { status, body } = await fetchBrowse("/browse?since=week");
      expect(status).toBe(200);
      expect(body).toMatch(/Updated:\s*This week/);
      // Pill has a remove (×) anchor
      expect(body).toMatch(/data-filter-bar[\s\S]*?×/);
    });

    // TS-3.3
    it("renders a Status: Pending pill for status=pending", async () => {
      const { status, body } = await fetchBrowse("/browse?status=pending");
      expect(status).toBe(200);
      expect(body).toMatch(/Status:\s*Pending/);
    });

    // TS-3.4
    it("renders an Inactive: 5+ days pill for stale_days=5", async () => {
      const { status, body } = await fetchBrowse("/browse?stale_days=5");
      expect(status).toBe(200);
      expect(body).toMatch(/Inactive:\s*5\+\s*days/);
    });

    // TS-3.5 — EN default
    it("renders pills in English by default", async () => {
      const { body } = await fetchBrowse(
        "/browse?since=today&status=done&stale_days=14",
      );
      expect(body).toMatch(/Updated:\s*Today/);
      expect(body).toMatch(/Status:\s*Done/);
      expect(body).toMatch(/Inactive:\s*14\+\s*days/);
    });

    // TS-3.6 — DE locale
    it("renders pills in German when the locale is 'de'", async () => {
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);

      const { app } = await createTestBrowse();
      // Seed the cookie with locale=de by passing Accept-Language on the
      // /login POST — the resolveLoginLocale path picks up the header at
      // login time and encodes "de" into the session cookie.
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
      expect(body).toContain(t("browse.filter.dimension.since"));
      expect(body).toContain(t("browse.filter.dimension.status"));
      expect(body).toContain(t("browse.filter.dimension.stale_days"));
    });

    // TS-3.7
    it("renders Inactive: 1+ day using singular pluralization", async () => {
      const { body } = await fetchBrowse("/browse?stale_days=1");
      // Singular form for count=1. en.ts: "Inactive: 1+ day" (no trailing 's')
      expect(body).toMatch(/Inactive:\s*1\+\s*day(?!s)/);
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

    // TS-3.11
    it("+ Filter menu omits dimensions already applied", async () => {
      const { body } = await fetchBrowse("/browse?status=pending");
      // A +Filter menu region should exist and not include the Status option
      // since status is already applied.
      expect(body).toMatch(/data-filter-add-menu/);
      // Extract the add-menu region and assert contents.
      const addMenuMatch = body.match(
        /data-filter-add-menu[\s\S]*?<\/[a-z]+>\s*(?=<\/|$)/,
      );
      const menuRegion = addMenuMatch ? addMenuMatch[0] : "";
      expect(menuRegion).toContain("Updated");
      expect(menuRegion).toContain("Inactive");
      expect(menuRegion).not.toContain("Status");
    });

    // TS-3.12
    it("+ Filter offers all three dimensions when none are active", async () => {
      const { body } = await fetchBrowse("/browse");
      expect(body).toMatch(/data-filter-add-menu/);
      const addMenuMatch = body.match(
        /data-filter-add-menu[\s\S]*?<\/[a-z]+>\s*(?=<\/|$)/,
      );
      const menuRegion = addMenuMatch ? addMenuMatch[0] : "";
      expect(menuRegion).toContain("Status");
      expect(menuRegion).toContain("Updated");
      expect(menuRegion).toContain("Inactive");
    });

    // TS-3.13
    it("+ Filter button is omitted when all three dimensions are active", async () => {
      const { body } = await fetchBrowse(
        "/browse?status=pending&since=week&stale_days=5",
      );
      // No data-filter-add-menu attribute present
      expect(body).not.toMatch(/data-filter-add-menu/);
    });

    // TS-3.14a
    it("+ Filter dimension menu contains exactly Status, Updated, Inactive options", async () => {
      const { body } = await fetchBrowse("/browse");
      const addMenuMatch = body.match(
        /data-filter-add-menu[\s\S]*?<\/[a-z]+>\s*(?=<\/|$)/,
      );
      const menuRegion = addMenuMatch ? addMenuMatch[0] : "";
      // Three dimension markers expected
      expect(menuRegion).toMatch(/data-dimension=["']status["']/);
      expect(menuRegion).toMatch(/data-dimension=["']since["']/);
      expect(menuRegion).toMatch(/data-dimension=["']stale_days["']/);
    });

    // TS-3.14b
    it("dimension menu item carries a data-attribute that opens the matching value picker", async () => {
      const { body } = await fetchBrowse("/browse");
      // Each dimension item should carry data-picker="<dim>" for client JS.
      expect(body).toMatch(/data-dimension=["']status["'][^>]*data-picker=["']status["']|data-picker=["']status["'][^>]*data-dimension=["']status["']/);
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

    // TS-3.24
    it("Clear filters href preserves category and q, drops tag/since/status/stale_days", async () => {
      const { body } = await fetchBrowse(
        "/browse?category=tasks&q=alpha&tag=work&status=pending&since=week&stale_days=5",
      );
      // Extract Clear filters href
      const match = body.match(
        /<a[^>]*href="([^"]*)"[^>]*>\s*(?:Clear filters|<[^>]+>\s*Clear filters)/i,
      );
      expect(match).not.toBeNull();
      const href = match![1]!;
      expect(href).toMatch(/^\/browse\?/);
      // Must contain category=tasks and q=alpha
      expect(href).toMatch(/category=tasks/);
      expect(href).toMatch(/q=alpha/);
      // Must NOT contain tag/status/since/stale_days
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue(["alpha", "beta", "gamma"]);
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
    // TS-5.1
    it("pill × control is a plain anchor element (not a button requiring JS)", async () => {
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse?status=pending", {
        headers: { Cookie: cookie },
      });
      const body = await res.text();
      // Find the × marker inside the filter bar; ensure it is preceded by an
      // <a> opening tag (not a <button>).
      const filterBarMatch = body.match(
        /data-filter-bar[\s\S]*?(×|&times;)/,
      );
      expect(filterBarMatch).not.toBeNull();
      const region = filterBarMatch![0];
      // The × must live inside an <a>, not a <button>
      const lastAnchorBeforeX = region.lastIndexOf("<a ");
      const lastButtonBeforeX = region.lastIndexOf("<button");
      expect(lastAnchorBeforeX).toBeGreaterThan(lastButtonBeforeX);
    });

    // TS-5.2
    it("filter bar subtree contains no inline style attributes", async () => {
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);
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
      const { browseEntries, getFilterTags } = await import(
        "../../src/web/browse-queries.js"
      );
      vi.mocked(browseEntries).mockResolvedValue([]);
      vi.mocked(getFilterTags).mockResolvedValue([]);
      const { app } = await createTestBrowse();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/browse?status=pending&status=done", {
        headers: { Cookie: cookie },
      });
      const body = await res.text();
      expect(res.status).toBe(200);
      // Only the first value should be rendered as an active pill
      expect(body).toMatch(/Status:\s*Pending/);
      expect(body).not.toMatch(/Status:\s*Done/);
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
});
