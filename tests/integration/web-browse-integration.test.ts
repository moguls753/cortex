/**
 * Integration tests for the web browse page.
 * Uses testcontainers PostgreSQL + pgvector for real DB operations.
 * Only mocks external services (embedding generation).
 *
 * Scenarios: TS-1.4,
 *            TS-2.2, TS-2.3,
 *            TS-3.1, TS-3.2, TS-3.3,
 *            TS-4.2, TS-4.3, TS-4.4,
 *            TS-5.3, TS-5.6,
 *            TS-6.3, TS-6.5
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

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Module Mocks (external services only) ──────────────────────────

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(4096).fill(0)),
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

// ─── Embedding Factories ────────────────────────────────────────────

function createQueryEmbedding(): number[] {
  // Unit vector in first dimension: [1, 0, 0, ..., 0]
  const vec = new Array(4096).fill(0);
  vec[0] = 1;
  return vec;
}

function createSimilarEmbedding(): number[] {
  // Cosine similarity ~0.8 to query embedding
  const vec = new Array(4096).fill(0);
  vec[0] = 0.8;
  vec[1] = 0.6;
  return vec;
}

function createDissimilarEmbedding(): number[] {
  // Cosine similarity ~0.3 to query embedding (below 0.5 threshold)
  const vec = new Array(4096).fill(0);
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
    // Cast embedding array to pgvector via string literal + ::vector(4096)
    const embeddingLiteral = `[${embedding.join(",")}]`;
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, embedding, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type},
              ${embeddingLiteral}::vector(4096),
              ${entry.deleted_at}, ${entry.created_at}, ${entry.updated_at})
    `;
  } else {
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, deleted_at, created_at, updated_at)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
              ${entry.created_at}, ${entry.updated_at})
    `;
  }

  return entry.id!;
}

async function clearEntries(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}

async function createIntegrationBrowse(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createBrowseRoutes } = await import("../../src/web/browse.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createBrowseRoutes(sql));

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

describe("Web Browse Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await clearEntries(db.sql);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Category Browsing
  // ═══════════════════════════════════════════════════════════════════
  describe("Category Browsing", () => {
    // TS-1.4
    it("excludes soft-deleted entries from browse results", async () => {
      await seedEntry(db.sql, { name: "Active 1" });
      await seedEntry(db.sql, { name: "Active 2" });
      await seedEntry(db.sql, { name: "Active 3" });
      await seedEntry(db.sql, { name: "Deleted 1", deleted_at: new Date() });
      await seedEntry(db.sql, { name: "Deleted 2", deleted_at: new Date() });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Active 1");
      expect(body).toContain("Active 2");
      expect(body).toContain("Active 3");
      expect(body).not.toContain("Deleted 1");
      expect(body).not.toContain("Deleted 2");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Semantic Search
  // ═══════════════════════════════════════════════════════════════════
  describe("Semantic Search", () => {
    // TS-2.2
    it("excludes results below similarity threshold", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(createQueryEmbedding());

      // Entry A: similar (cosine ~0.8 to query)
      await seedEntry(db.sql, {
        name: "Similar Entry A",
        embedding: createSimilarEmbedding(),
      });
      // Entry B: dissimilar (cosine ~0.3 to query, below 0.5 threshold)
      await seedEntry(db.sql, {
        name: "Dissimilar Entry B",
        embedding: createDissimilarEmbedding(),
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=test+query", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Similar Entry A");
      expect(body).not.toContain("Dissimilar Entry B");
    });

    // TS-2.3
    it("combines semantic search with category filter", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(createQueryEmbedding());

      await seedEntry(db.sql, {
        name: "Projects Budget",
        category: "projects",
        embedding: createSimilarEmbedding(),
      });
      await seedEntry(db.sql, {
        name: "Ideas Budget",
        category: "ideas",
        embedding: createSimilarEmbedding(),
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        "/browse?q=budget+planning&category=projects",
        { headers: { Cookie: cookie } },
      );

      const body = await res.text();
      expect(body).toContain("Projects Budget");
      expect(body).not.toContain("Ideas Budget");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Text Search
  // ═══════════════════════════════════════════════════════════════════
  describe("Text Search", () => {
    // TS-3.1
    it("falls back to text search when semantic has no results", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(createQueryEmbedding());

      // Seed entries WITHOUT embeddings so semantic returns nothing
      await seedEntry(db.sql, {
        name: "Quarterly Report",
        content: "quarterly budget review",
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=quarterly+budget", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Quarterly Report");
      // Fallback notice present
      expect(body.toLowerCase()).toMatch(
        /no semantic|showing text|text results/,
      );
    });

    // TS-3.2
    it("matches text search against name and content fields", async () => {
      await seedEntry(db.sql, {
        name: "Weekly standup notes",
        content: "General discussion topics",
      });
      await seedEntry(db.sql, {
        name: "Meeting agenda",
        content: "standup meeting agenda items",
      });
      await seedEntry(db.sql, {
        name: "Random thoughts",
        content: "Unrelated stuff",
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=standup&mode=text", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Weekly standup notes");
      expect(body).toContain("Meeting agenda");
      expect(body).not.toContain("Random thoughts");
    });

    // TS-3.3
    it("performs case-insensitive text search", async () => {
      await seedEntry(db.sql, {
        name: "Project Alpha",
        content: "Important project details",
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=project+alpha&mode=text", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Project Alpha");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tag Filtering
  // ═══════════════════════════════════════════════════════════════════
  describe("Tag Filtering", () => {
    // TS-4.2
    it("shows only entries with the selected tag", async () => {
      await seedEntry(db.sql, { name: "Entry A", tags: ["work"] });
      await seedEntry(db.sql, { name: "Entry B", tags: ["personal"] });
      await seedEntry(db.sql, {
        name: "Entry C",
        tags: ["work", "personal"],
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?tag=work", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Entry A");
      expect(body).toContain("Entry C");
      expect(body).not.toContain("Entry B");
    });

    // TS-4.3
    it("combines tag category and search with AND logic", async () => {
      await seedEntry(db.sql, {
        name: "Review Report",
        category: "tasks",
        tags: ["urgent"],
        content: "review quarterly report",
      });
      await seedEntry(db.sql, {
        name: "Other Task",
        category: "tasks",
        tags: ["urgent"],
        content: "unrelated content here",
      });
      await seedEntry(db.sql, {
        name: "Idea Review",
        category: "ideas",
        tags: ["urgent"],
        content: "review process improvement",
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        "/browse?category=tasks&tag=urgent&q=review&mode=text",
        { headers: { Cookie: cookie } },
      );

      const body = await res.text();
      expect(body).toContain("Review Report");
      expect(body).not.toContain("Other Task");
      expect(body).not.toContain("Idea Review");
    });

    // TS-4.4
    it("dynamically shows only tags in the current filtered set", async () => {
      await seedEntry(db.sql, {
        category: "projects",
        tags: ["work"],
        name: "Proj 1",
      });
      await seedEntry(db.sql, {
        category: "projects",
        tags: ["client"],
        name: "Proj 2",
      });
      await seedEntry(db.sql, {
        category: "tasks",
        tags: ["work"],
        name: "Task 1",
      });
      await seedEntry(db.sql, {
        category: "tasks",
        tags: ["personal"],
        name: "Task 2",
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?category=projects", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Tags scoped to projects only
      expect(body).toMatch(/<a[^>]*href="[^"]*tag=work[^"]*"/);
      expect(body).toMatch(/<a[^>]*href="[^"]*tag=client[^"]*"/);
      // "personal" tag should NOT appear in tag filter area
      expect(body).not.toMatch(/<a[^>]*href="[^"]*tag=personal[^"]*"/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Embedding Constraints
  // ═══════════════════════════════════════════════════════════════════
  describe("Embedding Constraints", () => {
    // TS-5.3
    it("includes entries without embeddings in category browsing", async () => {
      await seedEntry(db.sql, {
        name: "With Embedding",
        embedding: createSimilarEmbedding(),
      });
      await seedEntry(db.sql, {
        name: "Without Embedding",
        embedding: null,
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("With Embedding");
      expect(body).toContain("Without Embedding");
    });

    // TS-5.6
    it("excludes entries without embeddings from semantic search", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(createQueryEmbedding());

      // Entry A: has embedding with high similarity
      await seedEntry(db.sql, {
        name: "Embedded Entry A",
        embedding: createSimilarEmbedding(),
      });
      // Entry B: no embedding but content matches query text
      await seedEntry(db.sql, {
        name: "No Embedding Entry B",
        content: "test query content match",
        embedding: null,
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?q=test+query", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Entry A appears via semantic search
      expect(body).toContain("Embedded Entry A");
      // Entry B does NOT appear because semantic returned results (no fallback)
      expect(body).not.toContain("No Embedding Entry B");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-6.3
    it("finds entries with German content via text search", async () => {
      await seedEntry(db.sql, {
        name: "Projektbesprechung morgen",
        content: "Wir müssen den Bericht fertigstellen",
      });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(
        "/browse?q=Projektbesprechung&mode=text",
        { headers: { Cookie: cookie } },
      );

      const body = await res.text();
      expect(body).toContain("Projektbesprechung morgen");
    });

    // TS-6.5
    it("excludes entries with no tags when tag filter active", async () => {
      await seedEntry(db.sql, { name: "Tagged Entry", tags: ["work"] });
      await seedEntry(db.sql, { name: "Untagged Entry", tags: [] });

      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse?tag=work", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Tagged Entry");
      expect(body).not.toContain("Untagged Entry");
    });
  });
});
