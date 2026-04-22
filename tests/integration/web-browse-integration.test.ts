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

  // ═══════════════════════════════════════════════════════════════════
  // Browse Filters — new query params (feature: browse-filters)
  // ═══════════════════════════════════════════════════════════════════
  describe("Browse Filters", () => {
    /**
     * Seed an entry with JSONB fields that are queryable via `fields->>'status'`.
     * Unlike the file-local seedEntry helper which uses JSON.stringify (storing
     * the value as a JSON-string in the JSONB column), this helper uses
     * sql.json() so the JSONB is stored as a proper object — required for
     * the new status= filter to match.
     */
    async function seedJsonbEntry(
      sql: postgres.Sql,
      overrides: EntryData & { fields?: Record<string, unknown> } = {},
    ): Promise<string> {
      const entry = {
        ...createMockEntry(overrides),
        fields: overrides.fields ?? {},
      };
      const embedding = entry.embedding;
      if (embedding) {
        const embeddingLiteral = `[${embedding.join(",")}]`;
        await sql`
          INSERT INTO entries (
            id, name, category, content, fields, tags, confidence,
            source, source_type, embedding, deleted_at, created_at, updated_at
          ) VALUES (
            ${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
            ${sql.json(entry.fields as unknown as Parameters<typeof sql.json>[0])},
            ${entry.tags}, ${entry.confidence},
            ${entry.source}, ${entry.source_type},
            ${embeddingLiteral}::vector(4096),
            ${entry.deleted_at}, ${entry.created_at}, ${entry.updated_at}
          )
        `;
      } else {
        await sql`
          INSERT INTO entries (
            id, name, category, content, fields, tags, confidence,
            source, source_type, deleted_at, created_at, updated_at
          ) VALUES (
            ${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
            ${sql.json(entry.fields as unknown as Parameters<typeof sql.json>[0])},
            ${entry.tags}, ${entry.confidence},
            ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
            ${entry.created_at}, ${entry.updated_at}
          )
        `;
      }
      return entry.id!;
    }

    function countEntryLinks(html: string): number {
      return (html.match(/<a href="\/entry\//g) || []).length;
    }

    async function fetchBrowse(path: string): Promise<{ status: number; body: string }> {
      const { app } = await createIntegrationBrowse(db.sql);
      const cookie = await loginAndGetCookie(app);
      const res = await app.request(path, { headers: { Cookie: cookie } });
      return { status: res.status, body: await res.text() };
    }

    // TS-2.1
    it("since=today returns only entries created today", async () => {
      // Postgres CURRENT_DATE is the server date at query time
      await seedJsonbEntry(db.sql, {
        name: "Today A",
        created_at: new Date(Date.now() + 1000), // clearly today
      });
      await seedJsonbEntry(db.sql, {
        name: "Today B",
        created_at: new Date(Date.now() - 1000),
      });
      await seedJsonbEntry(db.sql, {
        name: "Yesterday",
        created_at: new Date(Date.now() - 26 * 60 * 60 * 1000),
      });
      await seedJsonbEntry(db.sql, {
        name: "Month ago",
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });

      const { status, body } = await fetchBrowse("/browse?since=today");
      expect(status).toBe(200);
      // The two "today" entries should appear; "Yesterday" and "Month ago" should not
      expect(body).toContain("Today A");
      expect(body).toContain("Today B");
      expect(body).not.toContain("Yesterday");
      expect(body).not.toContain("Month ago");
    });

    // TS-2.2
    it("since=week returns only entries created this week", async () => {
      // Insert 3 entries in this week, 2 before.
      // Using absolute timestamps relative to date_trunc('week', CURRENT_DATE).
      const weekStart = await db.sql<{ s: Date }[]>`SELECT date_trunc('week', CURRENT_DATE) AS s`;
      const startTs = weekStart[0]!.s.getTime();
      await seedJsonbEntry(db.sql, { name: "Week 1", created_at: new Date(startTs + 60_000) });
      await seedJsonbEntry(db.sql, { name: "Week 2", created_at: new Date(startTs + 120_000) });
      await seedJsonbEntry(db.sql, { name: "Week 3", created_at: new Date(startTs + 180_000) });
      await seedJsonbEntry(db.sql, { name: "Before 1", created_at: new Date(startTs - 60_000) });
      await seedJsonbEntry(db.sql, { name: "Before 2", created_at: new Date(startTs - 24 * 60 * 60 * 1000) });

      const { status, body } = await fetchBrowse("/browse?since=week");
      expect(status).toBe(200);
      expect(body).toContain("Week 1");
      expect(body).toContain("Week 2");
      expect(body).toContain("Week 3");
      expect(body).not.toContain("Before 1");
      expect(body).not.toContain("Before 2");
    });

    // TS-2.3
    it("since=month returns only entries created this month", async () => {
      const monthStart = await db.sql<{ s: Date }[]>`SELECT date_trunc('month', CURRENT_DATE) AS s`;
      const startTs = monthStart[0]!.s.getTime();
      for (let i = 0; i < 4; i++) {
        await seedJsonbEntry(db.sql, {
          name: `In-month ${i}`,
          created_at: new Date(startTs + (i + 1) * 1000),
        });
      }
      for (let i = 0; i < 3; i++) {
        await seedJsonbEntry(db.sql, {
          name: `Before-month ${i}`,
          created_at: new Date(startTs - (i + 1) * 86_400_000),
        });
      }

      const { status, body } = await fetchBrowse("/browse?since=month");
      expect(status).toBe(200);
      for (let i = 0; i < 4; i++) expect(body).toContain(`In-month ${i}`);
      for (let i = 0; i < 3; i++) expect(body).not.toContain(`Before-month ${i}`);
    });

    // TS-2.4
    it("status=pending returns only entries with fields.status='pending'", async () => {
      await seedJsonbEntry(db.sql, {
        name: "Pending task A",
        category: "tasks",
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Pending task B",
        category: "tasks",
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Done task",
        category: "tasks",
        fields: { status: "done" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Idea with no status",
        category: "ideas",
        fields: { oneliner: "test" },
      });

      const { status, body } = await fetchBrowse("/browse?status=pending");
      expect(status).toBe(200);
      expect(body).toContain("Pending task A");
      expect(body).toContain("Pending task B");
      expect(body).not.toContain("Done task");
      expect(body).not.toContain("Idea with no status");
    });

    // TS-2.5
    it("status=done returns only entries with fields.status='done'", async () => {
      await seedJsonbEntry(db.sql, { name: "Done 1", fields: { status: "done" } });
      await seedJsonbEntry(db.sql, { name: "Done 2", fields: { status: "done" } });
      await seedJsonbEntry(db.sql, { name: "Done 3", fields: { status: "done" } });
      await seedJsonbEntry(db.sql, { name: "Pending 1", fields: { status: "pending" } });
      await seedJsonbEntry(db.sql, { name: "Pending 2", fields: { status: "pending" } });

      const { body } = await fetchBrowse("/browse?status=done");
      expect(body).toContain("Done 1");
      expect(body).toContain("Done 2");
      expect(body).toContain("Done 3");
      expect(body).not.toContain("Pending 1");
      expect(body).not.toContain("Pending 2");
    });

    // TS-2.6
    it("status=active returns only entries with fields.status='active'", async () => {
      for (let i = 0; i < 4; i++) {
        await seedJsonbEntry(db.sql, {
          name: `Active ${i}`,
          category: "projects",
          fields: { status: "active" },
        });
      }
      await seedJsonbEntry(db.sql, {
        name: "Paused p",
        category: "projects",
        fields: { status: "paused" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Completed p",
        category: "projects",
        fields: { status: "completed" },
      });

      const { body } = await fetchBrowse("/browse?status=active");
      for (let i = 0; i < 4; i++) expect(body).toContain(`Active ${i}`);
      expect(body).not.toContain("Paused p");
      expect(body).not.toContain("Completed p");
    });

    // TS-2.7
    it("status=paused returns only entries with fields.status='paused'", async () => {
      await seedJsonbEntry(db.sql, {
        name: "Paused only",
        category: "projects",
        fields: { status: "paused" },
      });
      for (let i = 0; i < 5; i++) {
        await seedJsonbEntry(db.sql, {
          name: `Active ${i}`,
          category: "projects",
          fields: { status: "active" },
        });
      }
      const { body } = await fetchBrowse("/browse?status=paused");
      expect(body).toContain("Paused only");
      for (let i = 0; i < 5; i++) expect(body).not.toContain(`Active ${i}`);
    });

    // TS-2.8
    it("status=completed returns only entries with fields.status='completed'", async () => {
      await seedJsonbEntry(db.sql, {
        name: "Done A",
        category: "projects",
        fields: { status: "completed" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Done B",
        category: "projects",
        fields: { status: "completed" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Active X",
        category: "projects",
        fields: { status: "active" },
      });
      const { body } = await fetchBrowse("/browse?status=completed");
      expect(body).toContain("Done A");
      expect(body).toContain("Done B");
      expect(body).not.toContain("Active X");
    });

    // TS-2.9
    it("stale_days=5 returns only entries updated_at < now() - 5 days", async () => {
      const now = Date.now();
      await seedJsonbEntry(db.sql, {
        name: "Old 1",
        updated_at: new Date(now - 10 * 86_400_000),
      });
      await seedJsonbEntry(db.sql, {
        name: "Old 2",
        updated_at: new Date(now - 8 * 86_400_000),
      });
      await seedJsonbEntry(db.sql, {
        name: "Recent 1",
        updated_at: new Date(now - 2 * 86_400_000),
      });
      await seedJsonbEntry(db.sql, {
        name: "Recent 2",
        updated_at: new Date(now - 1 * 86_400_000),
      });

      const { body } = await fetchBrowse("/browse?stale_days=5");
      expect(body).toContain("Old 1");
      expect(body).toContain("Old 2");
      expect(body).not.toContain("Recent 1");
      expect(body).not.toContain("Recent 2");
    });

    // TS-2.10
    it("stale_days=100000 returns empty list with status 200", async () => {
      await seedJsonbEntry(db.sql, { name: "Recent" });
      const { status, body } = await fetchBrowse("/browse?stale_days=100000");
      expect(status).toBe(200);
      expect(body).not.toContain("Recent");
    });

    // TS-2.11
    it("category=tasks and status=pending compose with AND semantics", async () => {
      await seedJsonbEntry(db.sql, {
        name: "Task pending A",
        category: "tasks",
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Task pending B",
        category: "tasks",
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Task done",
        category: "tasks",
        fields: { status: "done" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Project active",
        category: "projects",
        fields: { status: "active" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Project pending",
        category: "projects",
        fields: { status: "pending" },
      });
      const { body } = await fetchBrowse("/browse?category=tasks&status=pending");
      expect(body).toContain("Task pending A");
      expect(body).toContain("Task pending B");
      expect(body).not.toContain("Task done");
      expect(body).not.toContain("Project active");
      expect(body).not.toContain("Project pending");
    });

    // TS-2.12
    it("status=pending and tag=work compose with AND semantics", async () => {
      await seedJsonbEntry(db.sql, {
        name: "P+work A",
        fields: { status: "pending" },
        tags: ["work"],
      });
      await seedJsonbEntry(db.sql, {
        name: "P+work B",
        fields: { status: "pending" },
        tags: ["work"],
      });
      await seedJsonbEntry(db.sql, {
        name: "P+home",
        fields: { status: "pending" },
        tags: ["home"],
      });
      await seedJsonbEntry(db.sql, {
        name: "Done+work",
        fields: { status: "done" },
        tags: ["work"],
      });
      const { body } = await fetchBrowse("/browse?status=pending&tag=work");
      expect(body).toContain("P+work A");
      expect(body).toContain("P+work B");
      expect(body).not.toContain("P+home");
      expect(body).not.toContain("Done+work");
    });

    // TS-2.13
    it("semantic search with status=pending returns only pending entries ranked by similarity", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(createQueryEmbedding());

      // Pending entries with varying similarity
      const p1 = await seedJsonbEntry(db.sql, {
        name: "P high",
        fields: { status: "pending" },
        embedding: createQueryEmbedding(),
      });
      const p2 = await seedJsonbEntry(db.sql, {
        name: "P medium",
        fields: { status: "pending" },
        embedding: createSimilarEmbedding(),
      });
      // Done entry with high similarity (should be excluded by filter)
      const d1 = await seedJsonbEntry(db.sql, {
        name: "D high",
        fields: { status: "done" },
        embedding: createQueryEmbedding(),
      });

      const { body } = await fetchBrowse("/browse?q=test&status=pending");
      expect(body).toContain("P high");
      expect(body).toContain("P medium");
      expect(body).not.toContain("D high");
      // P high ranks before P medium
      expect(body.indexOf("P high")).toBeLessThan(body.indexOf("P medium"));
      void p1;
      void p2;
      void d1;
    });

    // TS-2.14
    it("since uses date_trunc in PG server timezone", async () => {
      // Insert one entry 1 second after CURRENT_DATE (today) and one 1 second before.
      await db.sql`
        INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                             source, source_type, deleted_at, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Strictly today', null, null,
                ${db.sql.json({})}, ${[] as string[]}, null,
                'webapp', 'text', null,
                CURRENT_DATE + interval '1 second', CURRENT_DATE + interval '1 second')
      `;
      await db.sql`
        INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                             source, source_type, deleted_at, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Strictly yesterday', null, null,
                ${db.sql.json({})}, ${[] as string[]}, null,
                'webapp', 'text', null,
                CURRENT_DATE - interval '1 second', CURRENT_DATE - interval '1 second')
      `;
      const { body } = await fetchBrowse("/browse?since=today");
      expect(body).toContain("Strictly today");
      expect(body).not.toContain("Strictly yesterday");
    });

    // TS-2.15
    it("entries without fields.status are excluded from status= filter", async () => {
      await seedJsonbEntry(db.sql, {
        name: "Idea no status",
        category: "ideas",
        fields: { oneliner: "idea", notes: null },
      });
      await seedJsonbEntry(db.sql, {
        name: "Task pending",
        category: "tasks",
        fields: { status: "pending" },
      });
      const { body } = await fetchBrowse("/browse?status=pending");
      expect(body).toContain("Task pending");
      expect(body).not.toContain("Idea no status");
    });

    // TS-2.22
    it("semantic search with stale_days post-filters by updated_at", async () => {
      const { generateEmbedding } = await import("../../src/embed.js");
      vi.mocked(generateEmbedding).mockResolvedValue(createQueryEmbedding());

      const now = Date.now();
      await seedJsonbEntry(db.sql, {
        name: "A 10d ago",
        updated_at: new Date(now - 10 * 86_400_000),
        embedding: createQueryEmbedding(),
      });
      await seedJsonbEntry(db.sql, {
        name: "B 2d ago",
        updated_at: new Date(now - 2 * 86_400_000),
        embedding: createSimilarEmbedding(),
      });
      await seedJsonbEntry(db.sql, {
        name: "C 20d ago",
        updated_at: new Date(now - 20 * 86_400_000),
        embedding: createSimilarEmbedding(),
      });

      const { body } = await fetchBrowse("/browse?q=test&stale_days=7");
      expect(body).toContain("A 10d ago");
      expect(body).toContain("C 20d ago");
      expect(body).not.toContain("B 2d ago");
      // A (higher similarity to query) before C
      expect(body.indexOf("A 10d ago")).toBeLessThan(body.indexOf("C 20d ago"));
    });

    // TS-2.23
    it("text search (mode=text) with status=pending returns only pending entries matching text", async () => {
      await seedJsonbEntry(db.sql, {
        name: "Launch plan A",
        content: "notes about launch",
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Launch plan B",
        content: null,
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Launch done",
        fields: { status: "done" },
      });
      const { body } = await fetchBrowse("/browse?q=launch&mode=text&status=pending");
      expect(body).toContain("Launch plan A");
      expect(body).toContain("Launch plan B");
      expect(body).not.toContain("Launch done");
    });

    // TS-5.7
    it("category=people with status=pending returns 0 results and empty state with Clear filters", async () => {
      // Seed some non-matching entries
      await seedJsonbEntry(db.sql, {
        name: "Unrelated task",
        category: "tasks",
        fields: { status: "pending" },
      });
      await seedJsonbEntry(db.sql, {
        name: "Alice",
        category: "people",
        fields: { context: "friend" },
      });

      const { status, body } = await fetchBrowse("/browse?category=people&status=pending");
      expect(status).toBe(200);
      expect(countEntryLinks(body)).toBe(0);
      // Clear filters link present
      expect(body.toLowerCase()).toContain("clear filters");
    });
  });
});
