/**
 * Integration tests for the web entry page.
 * Uses testcontainers PostgreSQL + pgvector for real DB operations.
 * Only mocks external services (embedding generation).
 *
 * Scenarios: TS-2.3, TS-2.5, TS-2.6,
 *            TS-1.6,
 *            TS-5.3, TS-5.4, TS-5.8
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
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  embedEntry: vi.fn().mockResolvedValue(undefined),
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
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type},
              ${embeddingLiteral}::vector(1024),
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

async function createIntegrationEntry(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createEntryRoutes } = await import("../../src/web/entry.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createEntryRoutes(sql));

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

describe("Web Entry Integration", () => {
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
  // Save Entry
  // ═══════════════════════════════════════════════════════════════════
  describe("Save Entry", () => {
    // TS-2.3
    it("updates entry and changes updated_at", async () => {
      const entryId = await seedEntry(db.sql, { name: "Old Name" });

      // Record the original updated_at
      const [before] =
        await db.sql`SELECT updated_at FROM entries WHERE id = ${entryId}`;
      const originalUpdatedAt = before.updated_at as Date;

      // Small delay to ensure timestamp difference (DB trigger uses now())
      await new Promise((resolve) => setTimeout(resolve, 50));

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "New Name",
          category: "tasks",
          content: "updated",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Should redirect to the entry page
      expect([302, 303]).toContain(res.status);
      expect(res.headers.get("location")).toContain(`/entry/${entryId}`);

      // Verify DB state
      const [after] =
        await db.sql`SELECT name, content, updated_at FROM entries WHERE id = ${entryId}`;
      expect(after.name).toBe("New Name");
      expect(after.content).toBe("updated");
      expect(new Date(after.updated_at as string) > originalUpdatedAt).toBe(
        true,
      );
    });

    // TS-2.5
    it("re-generates embedding on save", async () => {
      const entryId = await seedEntry(db.sql, { content: "old content" });

      const { embedEntry } = await import("../../src/embed.js");

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      await app.request(`/entry/${entryId}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "Test",
          category: "tasks",
          content: "completely new content",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Verify embedding regeneration was triggered
      expect(vi.mocked(embedEntry)).toHaveBeenCalled();

      // Verify content was saved
      const [entry] =
        await db.sql`SELECT content FROM entries WHERE id = ${entryId}`;
      expect(entry.content).toBe("completely new content");
    });

    // TS-2.6
    it("sets confidence to null on save", async () => {
      const entryId = await seedEntry(db.sql, { confidence: 0.85 });

      // Verify initial confidence
      const [before] =
        await db.sql`SELECT confidence FROM entries WHERE id = ${entryId}`;
      expect(Number(before.confidence)).toBe(0.85);

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      await app.request(`/entry/${entryId}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "Test",
          category: "tasks",
          content: "stuff",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Verify confidence is now null
      const [after] =
        await db.sql`SELECT confidence FROM entries WHERE id = ${entryId}`;
      expect(after.confidence).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Restore
  // ═══════════════════════════════════════════════════════════════════
  describe("Restore", () => {
    // TS-1.6
    it("clears deleted_at when restoring entry", async () => {
      const entryId = await seedEntry(db.sql, {
        deleted_at: new Date(),
      });

      // Verify it is soft-deleted
      const [before] =
        await db.sql`SELECT deleted_at FROM entries WHERE id = ${entryId}`;
      expect(before.deleted_at).not.toBeNull();

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}/restore`, {
        method: "POST",
        headers: {
          Cookie: cookie,
        },
      });

      // Should redirect
      expect([302, 303]).toContain(res.status);

      // Verify deleted_at is now null
      const [after] =
        await db.sql`SELECT deleted_at FROM entries WHERE id = ${entryId}`;
      expect(after.deleted_at).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-5.3
    it("replaces fields with new category defaults on category change", async () => {
      const entryId = await seedEntry(db.sql, {
        category: "projects",
        fields: { status: "active", next_action: "review", notes: "some notes" },
      });

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      await app.request(`/entry/${entryId}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "Test",
          category: "tasks",
          content: "stuff",
          "fields[status]": "active",
          "fields[next_action]": "review",
          "fields[notes]": "some notes",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Verify DB state
      const [entry] =
        await db.sql`SELECT category, fields FROM entries WHERE id = ${entryId}`;
      expect(entry.category).toBe("tasks");

      const fields =
        typeof entry.fields === "string"
          ? JSON.parse(entry.fields)
          : entry.fields;

      // status carried over (exists in task schema)
      expect(fields.status).toBe("active");
      // notes carried over (exists in task schema)
      expect(fields.notes).toBe("some notes");
      // due_date added as task default
      expect(fields).toHaveProperty("due_date");
      // next_action dropped (not in task schema)
      expect(fields).not.toHaveProperty("next_action");
    });

    // TS-5.4
    it("preserves previous embedding when Ollama is down", async () => {
      // Create a known fake embedding
      const fakeEmbedding = new Array(1024).fill(0).map((_, i) => Math.sin(i) * 0.5);

      const entryId = await seedEntry(db.sql, {
        content: "original content",
        embedding: fakeEmbedding,
      });

      // Get the original embedding text representation
      const [before] =
        await db.sql`SELECT embedding::text FROM entries WHERE id = ${entryId}`;
      const originalEmbeddingText = before.embedding as string;

      // Mock embedding to fail (Ollama down)
      const { generateEmbedding, embedEntry } = await import(
        "../../src/embed.js"
      );
      vi.mocked(generateEmbedding).mockRejectedValue(
        new Error("Connection refused"),
      );
      vi.mocked(embedEntry).mockRejectedValue(
        new Error("Connection refused"),
      );

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "Test",
          category: "tasks",
          content: "updated",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Save should succeed despite embedding failure
      expect([302, 303]).toContain(res.status);

      // Verify content was updated
      const [after] =
        await db.sql`SELECT content, embedding::text FROM entries WHERE id = ${entryId}`;
      expect(after.content).toBe("updated");

      // Verify embedding is unchanged
      expect(after.embedding).toBe(originalEmbeddingText);
    });

    // TS-5.8
    it("saves entry with new tag not previously in database", async () => {
      const entryId = await seedEntry(db.sql, {
        tags: ["existing"],
      });

      const { app } = await createIntegrationEntry(db.sql);
      const cookie = await loginAndGetCookie(app);

      await app.request(`/entry/${entryId}/edit`, {
        method: "POST",
        body: new URLSearchParams({
          name: "Test",
          category: "tasks",
          content: "stuff",
          tags: "existing,brand-new-tag",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Verify DB state
      const [entry] =
        await db.sql`SELECT tags FROM entries WHERE id = ${entryId}`;
      const tags = entry.tags as string[];
      expect(tags).toContain("existing");
      expect(tags).toContain("brand-new-tag");
    });
  });
});
