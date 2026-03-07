/**
 * Integration tests for the MCP server.
 * Uses testcontainers PostgreSQL + pgvector for real DB operations.
 * Mocks: classify (no real LLM), embed (controlled vectors via mock fetch).
 *
 * Scenarios: TS-1.2, 1.5,
 *            TS-3.4,
 *            TS-6.5,
 *            TS-7.1–7.3,
 *            TS-8.3,
 *            TS-9.1–9.2
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Hono } from "hono";
import type postgres from "postgres";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// Mock classify (no real LLM in tests)
vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn(),
  assembleContext: vi.fn().mockResolvedValue(""),
}));

// ─── Types & Factories ─────────────────────────────────────────────

interface EntryData {
  id?: string;
  name?: string;
  category?: string | null;
  content?: string | null;
  fields?: Record<string, unknown>;
  tags?: string[];
  confidence?: number | null;
  source?: string;
  source_type?: string;
  embedding?: number[] | null;
  deleted_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

function createMockEntry(overrides: EntryData = {}): Required<EntryData> {
  return {
    id: crypto.randomUUID(),
    name: "Test Entry",
    category: "people",
    content: "Test content",
    fields: {},
    tags: ["test"],
    confidence: 0.9,
    source: "mcp",
    source_type: "text",
    embedding: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ─── Embedding Factories ────────────────────────────────────────────

function createQueryEmbedding(): number[] {
  // Unit vector in first dimension: [1, 0, 0, ..., 0]
  const vec = new Array(1024).fill(0);
  vec[0] = 1;
  return vec;
}

function createSimilarEmbedding(): number[] {
  // Cosine similarity ~0.8 to query embedding
  const vec = new Array(1024).fill(0);
  vec[0] = 0.8;
  vec[1] = 0.6;
  return vec;
}

function createDissimilarEmbedding(): number[] {
  // Cosine similarity ~0.3 to query embedding (below 0.5 threshold)
  const vec = new Array(1024).fill(0);
  vec[0] = 0.3;
  vec[1] = 0.954;
  return vec;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function seedEntry(
  sql: postgres.Sql,
  overrides: EntryData = {},
): Promise<string> {
  const entry = createMockEntry(overrides);
  const embedding = entry.embedding;

  if (embedding) {
    const embeddingLiteral = `[${embedding.join(",")}]`;
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, embedding, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${sql.json(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type},
              ${embeddingLiteral}::vector(1024),
              ${entry.deleted_at}, ${entry.created_at}, ${entry.updated_at})
    `;
  } else {
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${sql.json(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
              ${entry.created_at}, ${entry.updated_at})
    `;
  }

  return entry.id!;
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
  if (!setCookie) throw new Error("No Set-Cookie header in login response");
  return setCookie.split(";")[0]!;
}

async function createIntegrationApp(sql: postgres.Sql): Promise<Hono> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createMcpHttpHandler } = await import("../../src/mcp-tools.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));

  const mcpHandler = createMcpHttpHandler(sql);
  app.post("/mcp", async (c) => {
    const body = await c.req.json();
    const result = await mcpHandler(body);
    return c.json(result);
  });

  return app;
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("MCP Server Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.sql`DELETE FROM entries`;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // search_brain
  // ═══════════════════════════════════════════════════════════════════
  describe("search_brain", () => {
    // TS-1.2
    it("excludes results below similarity threshold", async () => {
      const { searchBySimilarity } = await import(
        "../../src/mcp-queries.js"
      );

      // Seed entry A: similar (cosine ~0.8 to query, above 0.5 threshold)
      await seedEntry(db.sql, {
        name: "Similar Entry A",
        embedding: createSimilarEmbedding(),
      });

      // Seed entry B: dissimilar (cosine ~0.3, below 0.5 threshold)
      await seedEntry(db.sql, {
        name: "Dissimilar Entry B",
        embedding: createDissimilarEmbedding(),
      });

      // Seed entry C: borderline (cosine ~0.45 — below 0.5 threshold)
      const borderlineEmbedding = new Array(1024).fill(0);
      borderlineEmbedding[0] = 0.45;
      borderlineEmbedding[1] = 0.893; // cosine to [1,0,...] ≈ 0.45
      await seedEntry(db.sql, {
        name: "Borderline Entry C",
        embedding: borderlineEmbedding,
      });

      const results = await searchBySimilarity(
        db.sql,
        createQueryEmbedding(),
        10,
      );

      // Only the similar entry should be returned (above 0.5 threshold)
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Similar Entry A");
    });

    // TS-1.5
    it("excludes soft-deleted entries from search results", async () => {
      const { searchBySimilarity } = await import(
        "../../src/mcp-queries.js"
      );

      // Seed 2 entries with similar embeddings (both above threshold)
      const activeId = await seedEntry(db.sql, {
        name: "Active Entry",
        embedding: createSimilarEmbedding(),
      });

      const deletedId = await seedEntry(db.sql, {
        name: "Deleted Entry",
        embedding: createSimilarEmbedding(),
      });

      // Soft-delete one entry
      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${deletedId}`;

      const results = await searchBySimilarity(
        db.sql,
        createQueryEmbedding(),
        10,
      );

      // Only the active entry should be returned
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Active Entry");
      expect(results[0].id).toBe(activeId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // list_recent
  // ═══════════════════════════════════════════════════════════════════
  describe("list_recent", () => {
    // TS-3.4
    it("excludes soft-deleted entries from listing", async () => {
      const { listRecentEntries } = await import(
        "../../src/mcp-queries.js"
      );

      // Seed 3 recent entries
      await seedEntry(db.sql, { name: "Entry One" });
      await seedEntry(db.sql, { name: "Entry Two" });
      const deletedId = await seedEntry(db.sql, { name: "Deleted Entry" });

      // Soft-delete one
      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${deletedId}`;

      const results = await listRecentEntries(db.sql, 7);

      // Only 2 entries returned
      expect(results).toHaveLength(2);
      const names = results.map((r: any) => r.name);
      expect(names).toContain("Entry One");
      expect(names).toContain("Entry Two");
      expect(names).not.toContain("Deleted Entry");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // delete_entry
  // ═══════════════════════════════════════════════════════════════════
  describe("delete_entry", () => {
    // TS-6.5
    it("deletes just-created entry successfully", async () => {
      const { softDeleteEntry } = await import(
        "../../src/mcp-queries.js"
      );

      // Insert an entry, immediately soft-delete it
      const entryId = await seedEntry(db.sql, {
        name: "Fresh Entry",
      });

      await softDeleteEntry(db.sql, entryId);

      // Verify: entry has deleted_at set
      const [row] = await db.sql`
        SELECT deleted_at FROM entries WHERE id = ${entryId}
      `;
      expect(row).toBeDefined();
      expect(row.deleted_at).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // brain_stats
  // ═══════════════════════════════════════════════════════════════════
  describe("brain_stats", () => {
    // TS-7.1
    it("computes statistics from populated database", async () => {
      const { getBrainStats } = await import(
        "../../src/mcp-queries.js"
      );

      // Seed entries: 3 people
      await seedEntry(db.sql, { name: "Person A", category: "people" });
      await seedEntry(db.sql, { name: "Person B", category: "people" });
      await seedEntry(db.sql, { name: "Person C", category: "people" });

      // 2 tasks: 1 with status "pending" (open task)
      await seedEntry(db.sql, {
        name: "Task Open",
        category: "tasks",
        fields: { status: "pending" },
      });
      await seedEntry(db.sql, {
        name: "Task Done",
        category: "tasks",
        fields: { status: "done" },
      });

      // 1 project: active, updated > 5 days ago (stalled)
      const stalledUpdatedAt = new Date();
      stalledUpdatedAt.setDate(stalledUpdatedAt.getDate() - 6);
      await seedEntry(db.sql, {
        name: "Stalled Project",
        category: "projects",
        fields: { status: "active" },
        updated_at: stalledUpdatedAt,
      });

      // 1 soft-deleted idea (should be excluded from all counts)
      const deletedId = await seedEntry(db.sql, {
        name: "Deleted Idea",
        category: "ideas",
      });
      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${deletedId}`;

      const stats = await getBrainStats(db.sql);

      // total_entries: 6 (excludes deleted)
      expect(stats.total_entries).toBe(6);

      // by_category: all 5 categories with correct counts
      expect(stats.by_category).toBeDefined();
      expect(stats.by_category.people).toBe(3);
      expect(stats.by_category.tasks).toBe(2);
      expect(stats.by_category.projects).toBe(1);
      expect(stats.by_category.ideas).toBe(0);
      expect(stats.by_category.reference).toBe(0);

      // open_tasks: 1 (status "pending")
      expect(stats.open_tasks).toBe(1);

      // stalled_projects: 1 (active but updated > 5 days ago)
      expect(stats.stalled_projects).toBe(1);

      // entries_this_week: should include the entries created today
      expect(stats.entries_this_week).toBeGreaterThanOrEqual(6);

      // recent_activity: array of 7 daily counts
      expect(stats.recent_activity).toHaveLength(7);
    });

    // TS-7.2
    it("excludes soft-deleted entries from all stats", async () => {
      const { getBrainStats } = await import(
        "../../src/mcp-queries.js"
      );

      // Seed 3 entries, soft-delete 2
      await seedEntry(db.sql, { name: "Survivor", category: "people" });

      const del1 = await seedEntry(db.sql, {
        name: "Deleted 1",
        category: "tasks",
      });
      const del2 = await seedEntry(db.sql, {
        name: "Deleted 2",
        category: "ideas",
      });

      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${del1}`;
      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${del2}`;

      const stats = await getBrainStats(db.sql);

      expect(stats.total_entries).toBe(1);
      // Deleted entries should not appear in any category count
      expect(stats.by_category.tasks).toBe(0);
      expect(stats.by_category.ideas).toBe(0);
      expect(stats.by_category.people).toBe(1);
    });

    // TS-7.3
    it("returns all zeros for empty database", async () => {
      const { getBrainStats } = await import(
        "../../src/mcp-queries.js"
      );

      // Empty DB (beforeEach clears entries)
      const stats = await getBrainStats(db.sql);

      expect(stats.total_entries).toBe(0);
      expect(stats.by_category.people).toBe(0);
      expect(stats.by_category.tasks).toBe(0);
      expect(stats.by_category.projects).toBe(0);
      expect(stats.by_category.ideas).toBe(0);
      expect(stats.by_category.reference).toBe(0);
      expect(stats.entries_this_week).toBe(0);
      expect(stats.open_tasks).toBe(0);
      expect(stats.stalled_projects).toBe(0);
      expect(stats.recent_activity).toHaveLength(7);
      for (const day of stats.recent_activity) {
        expect(day.count).toBe(0);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // stdio transport
  // ═══════════════════════════════════════════════════════════════════
  describe("stdio transport", () => {
    // TS-8.3
    it("returns tool-level error when database is unavailable", async () => {
      const { default: postgresCtor } = await import("postgres");
      const { handleBrainStats } = await import(
        "../../src/mcp-tools.js"
      );

      // Create a broken sql connection pointing to a non-existent database
      const brokenSql = postgresCtor(
        "postgresql://localhost:1/nonexistent",
        { connect_timeout: 2, idle_timeout: 1, max: 1 },
      );

      try {
        const result = await handleBrainStats(brokenSql);

        // Should return an error result, not crash
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");

        // Error message should be user-facing, not raw DB error
        const errorText = result.content[0].text.toLowerCase();
        expect(errorText).toMatch(/database|unavailable|error/);
        // Should NOT contain raw database internals
        expect(errorText).not.toMatch(/econnrefused/i);
        expect(errorText).not.toMatch(/pg_/i);
      } finally {
        // Clean up the broken connection
        await brokenSql.end().catch(() => {});
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // HTTP transport
  // ═══════════════════════════════════════════════════════════════════
  describe("HTTP transport", () => {
    // TS-9.1
    it("serves MCP endpoint at /mcp with Streamable HTTP transport", async () => {
      const app = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Send a valid MCP JSON-RPC request to list tools
      const jsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      };

      const res = await app.request("/mcp", {
        method: "POST",
        body: JSON.stringify(jsonRpcRequest),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
      });

      // Should get a valid response (not a redirect or auth error)
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(302);

      const body = await res.json();

      // Should be a valid JSON-RPC response listing 7 tools
      expect(body.result).toBeDefined();
      expect(body.result.tools).toBeDefined();
      expect(body.result.tools).toHaveLength(7);

      const toolNames = body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("search_brain");
      expect(toolNames).toContain("add_thought");
      expect(toolNames).toContain("list_recent");
      expect(toolNames).toContain("get_entry");
      expect(toolNames).toContain("update_entry");
      expect(toolNames).toContain("delete_entry");
      expect(toolNames).toContain("brain_stats");
    });

    // TS-9.2
    it("processes authenticated MCP tool call", async () => {
      const app = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Seed an entry so stats have data
      await seedEntry(db.sql, { name: "Stats Entry", category: "people" });

      // Send a valid MCP JSON-RPC callTool request for brain_stats
      const jsonRpcRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "brain_stats",
          arguments: {},
        },
      };

      const res = await app.request("/mcp", {
        method: "POST",
        body: JSON.stringify(jsonRpcRequest),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
      });

      // Should get a valid response
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(302);

      const body = await res.json();

      // Should be a valid JSON-RPC response with tool result
      expect(body.result).toBeDefined();
      expect(body.result.content).toBeDefined();
      expect(body.result.content).toHaveLength(1);
      expect(body.result.content[0].type).toBe("text");

      // Parse the stats from the text content
      const stats = JSON.parse(body.result.content[0].text);
      expect(stats.total_entries).toBe(1);
      expect(stats.by_category.people).toBe(1);
    });
  });
});
