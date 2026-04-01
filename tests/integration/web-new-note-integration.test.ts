/**
 * Integration tests for the web new note page.
 * Uses testcontainers PostgreSQL + pgvector for real DB operations.
 * Only mocks external services (embedding generation).
 *
 * Scenarios: TS-3.1, TS-5.3, TS-5.5, TS-5.7
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

  await sql`
    INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                         source, source_type, deleted_at, created_at, updated_at)
    VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
            ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
            ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
            ${entry.created_at}, ${entry.updated_at})
  `;

  return entry.id!;
}

async function clearEntries(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}

async function createIntegrationNewNote(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createNewNoteRoutes } = await import("../../src/web/new-note.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createNewNoteRoutes(sql));

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

describe("Web New Note Integration", () => {
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
  // Save Note
  // ═══════════════════════════════════════════════════════════════════
  describe("Save Note", () => {
    // TS-3.1
    it("creates entry with embedding and redirects to entry page", async () => {
      const { embedEntry } = await import("../../src/embed.js");

      const { app } = await createIntegrationNewNote(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Integration Note",
          category: "ideas",
          tags: "test,integration",
          content: "Full integration save",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Should redirect to /entry/:uuid
      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toMatch(
        /\/entry\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );

      // Verify entry in DB
      const uuid = location.split("/entry/")[1];
      const rows = await db.sql`
        SELECT name, category, content, tags, source, confidence
        FROM entries WHERE id = ${uuid}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Integration Note");
      expect(rows[0].category).toBe("ideas");
      expect(rows[0].content).toBe("Full integration save");
      expect(rows[0].tags).toEqual(["test", "integration"]);
      expect(rows[0].source).toBe("webapp");
      expect(rows[0].confidence).toBeNull();

      // Verify embedEntry was called
      expect(embedEntry).toHaveBeenCalledWith(expect.anything(), uuid);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-5.3
    it("saves very long content", async () => {
      const { embedEntry } = await import("../../src/embed.js");

      const { app } = await createIntegrationNewNote(db.sql);
      const cookie = await loginAndGetCookie(app);

      const longContent = "A".repeat(15_000);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Long Note",
          category: "reference",
          content: longContent,
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      const uuid = location.split("/entry/")[1];

      const rows = await db.sql`
        SELECT content FROM entries WHERE id = ${uuid}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].content.length).toBe(15_000);

      expect(embedEntry).toHaveBeenCalled();
    });

    // TS-5.5
    it("allows duplicate entry names", async () => {
      const { app } = await createIntegrationNewNote(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Seed an existing entry with the same name
      await seedEntry(db.sql, { name: "Meeting Notes" });

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Meeting Notes",
          content: "different content",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);

      // Two entries with the same name
      const rows = await db.sql`
        SELECT id FROM entries WHERE name = 'Meeting Notes'
      `;
      expect(rows.length).toBe(2);
      expect(rows[0].id).not.toBe(rows[1].id);
    });

    // TS-5.7
    it("normalizes tags to lowercase and trimmed", async () => {
      const { app } = await createIntegrationNewNote(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", {
        method: "POST",
        body: new URLSearchParams({
          name: "Tag Test",
          tags: " Work , URGENT, my tag ",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      const uuid = location.split("/entry/")[1];

      const rows = await db.sql`
        SELECT tags FROM entries WHERE id = ${uuid}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].tags).toEqual(["work", "urgent", "my tag"]);
    });
  });
});
