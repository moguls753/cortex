/**
 * Integration tests for the web trash page.
 * Uses testcontainers PostgreSQL + pgvector for real DB operations.
 * Only mocks external services (embedding generation).
 *
 * Scenarios: TS-2.1, TS-2.2, TS-2.4,
 *            TS-3.2,
 *            TS-4.3, TS-4.4,
 *            TS-5.3, TS-5.4,
 *            TS-7.1
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
  google_calendar_event_id?: string | null;
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
    google_calendar_event_id: null,
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
                           source, source_type, embedding, deleted_at, created_at, updated_at,
                           google_calendar_event_id)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type},
              ${embeddingLiteral}::vector(4096),
              ${entry.deleted_at}, ${entry.created_at}, ${entry.updated_at},
              ${entry.google_calendar_event_id})
    `;
  } else {
    await sql`
      INSERT INTO entries (id, name, category, content, fields, tags, confidence,
                           source, source_type, deleted_at, created_at, updated_at,
                           google_calendar_event_id)
      VALUES (${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
              ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
              ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
              ${entry.created_at}, ${entry.updated_at},
              ${entry.google_calendar_event_id})
    `;
  }

  return entry.id!;
}

async function clearEntries(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}

async function createIntegrationTrash(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createTrashRoutes } = await import("../../src/web/trash.js");
  const { createEntryRoutes } = await import("../../src/web/entry.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createTrashRoutes(sql));
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

describe("Web Trash Integration", () => {
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
  // Trash Listing
  // ═══════════════════════════════════════════════════════════════════
  describe("Trash Listing", () => {
    // TS-2.1
    it("lists deleted entries sorted by deleted_at descending", async () => {
      // Seed 3 deleted entries with different deleted_at times
      await seedEntry(db.sql, {
        name: "Entry A",
        deleted_at: new Date("2026-04-10T00:00:00Z"),
      });
      await seedEntry(db.sql, {
        name: "Entry B",
        deleted_at: new Date("2026-04-15T00:00:00Z"),
      });
      await seedEntry(db.sql, {
        name: "Entry C",
        deleted_at: new Date("2026-04-12T00:00:00Z"),
      });
      // Seed 2 active (non-deleted) entries
      await seedEntry(db.sql, { name: "Active 1", deleted_at: null });
      await seedEntry(db.sql, { name: "Active 2", deleted_at: null });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();

      // All 3 deleted entries present
      expect(body).toContain("Entry A");
      expect(body).toContain("Entry B");
      expect(body).toContain("Entry C");

      // Active entries NOT present
      expect(body).not.toContain("Active 1");
      expect(body).not.toContain("Active 2");

      // Order: B (Apr 15) before C (Apr 12) before A (Apr 10)
      const idxB = body.indexOf("Entry B");
      const idxC = body.indexOf("Entry C");
      const idxA = body.indexOf("Entry A");
      expect(idxB).toBeLessThan(idxC);
      expect(idxC).toBeLessThan(idxA);
    });

    // TS-2.2
    it("filters deleted entries by category", async () => {
      await seedEntry(db.sql, {
        name: "Deleted Task 1",
        category: "tasks",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Deleted Task 2",
        category: "tasks",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Deleted Idea",
        category: "ideas",
        deleted_at: new Date(),
      });
      // Active task — should not appear
      await seedEntry(db.sql, {
        name: "Active Task",
        category: "tasks",
        deleted_at: null,
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?category=tasks", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Deleted Task 1");
      expect(body).toContain("Deleted Task 2");
      expect(body).not.toContain("Deleted Idea");
      expect(body).not.toContain("Active Task");
    });

    // TS-2.4
    it("combines category and tag filters", async () => {
      await seedEntry(db.sql, {
        name: "Urgent Task",
        category: "tasks",
        tags: ["urgent"],
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Normal Task",
        category: "tasks",
        tags: ["normal"],
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Urgent Idea",
        category: "ideas",
        tags: ["urgent"],
        deleted_at: new Date(),
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash?category=tasks&tag=urgent", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("Urgent Task");
      expect(body).not.toContain("Normal Task");
      expect(body).not.toContain("Urgent Idea");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Restore
  // ═══════════════════════════════════════════════════════════════════
  describe("Restore", () => {
    // TS-3.2
    it("restored entry disappears from trash and appears in browse", async () => {
      const entryId = await seedEntry(db.sql, {
        name: "Restore Me",
        deleted_at: new Date(),
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Restore the entry
      await app.request(`/entry/${entryId}/restore`, {
        method: "POST",
        headers: { Cookie: cookie },
        redirect: "manual",
      });

      // Verify gone from trash
      const trashRes = await app.request("/trash", {
        headers: { Cookie: cookie },
      });
      const trashBody = await trashRes.text();
      expect(trashBody).not.toContain("Restore Me");

      // Verify in DB: deleted_at is null
      const [row] =
        await db.sql`SELECT deleted_at FROM entries WHERE id = ${entryId}`;
      expect(row.deleted_at).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Permanent Delete
  // ═══════════════════════════════════════════════════════════════════
  describe("Permanent Delete", () => {
    // TS-4.3
    it("permanent delete removes entry from database", async () => {
      const entryId = await seedEntry(db.sql, {
        name: "Delete Forever",
        deleted_at: new Date(),
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}/permanent-delete`, {
        method: "POST",
        headers: { Cookie: cookie },
        redirect: "manual",
      });

      // Redirect to /trash
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/trash");

      // Entry gone from database
      const rows =
        await db.sql`SELECT id FROM entries WHERE id = ${entryId}`;
      expect(rows.length).toBe(0);
    });

    // TS-4.4
    it("permanent delete does not call calendar API", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const entryId = await seedEntry(db.sql, {
        name: "Calendar Orphan",
        deleted_at: new Date(),
        google_calendar_event_id: "orphaned-event-123",
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      await app.request(`/entry/${entryId}/permanent-delete`, {
        method: "POST",
        headers: { Cookie: cookie },
        redirect: "manual",
      });

      // No Google Calendar API calls
      const calendarCalls = fetchSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("googleapis.com/calendar"),
      );
      expect(calendarCalls.length).toBe(0);

      // Entry gone from database
      const rows =
        await db.sql`SELECT id FROM entries WHERE id = ${entryId}`;
      expect(rows.length).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Empty Trash
  // ═══════════════════════════════════════════════════════════════════
  describe("Empty Trash", () => {
    // TS-5.3
    it("empty trash removes all deleted entries", async () => {
      // 3 deleted entries (some with calendar IDs)
      await seedEntry(db.sql, {
        name: "Del 1",
        deleted_at: new Date(),
        google_calendar_event_id: "event-1",
      });
      await seedEntry(db.sql, {
        name: "Del 2",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Del 3",
        deleted_at: new Date(),
      });
      // 2 active entries
      await seedEntry(db.sql, { name: "Keep 1", deleted_at: null });
      await seedEntry(db.sql, { name: "Keep 2", deleted_at: null });

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/empty-trash", {
        method: "POST",
        headers: { Cookie: cookie },
      });

      expect(res.ok).toBe(true);
      const data = (await res.json()) as { deleted: number };
      expect(data.deleted).toBe(3);

      // Verify: only active entries remain
      const remaining = await db.sql`SELECT name FROM entries ORDER BY name`;
      expect(remaining.length).toBe(2);
      expect(remaining[0].name).toBe("Keep 1");
      expect(remaining[1].name).toBe("Keep 2");

      // No Google Calendar API calls
      const calendarCalls = fetchSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("googleapis.com/calendar"),
      );
      expect(calendarCalls.length).toBe(0);
    });

    // TS-5.4
    it("empty trash ignores active filters", async () => {
      // 2 tasks + 3 ideas, all deleted
      await seedEntry(db.sql, {
        name: "Task 1",
        category: "tasks",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Task 2",
        category: "tasks",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Idea 1",
        category: "ideas",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Idea 2",
        category: "ideas",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Idea 3",
        category: "ideas",
        deleted_at: new Date(),
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Empty trash — the endpoint is NOT scoped by filters
      const res = await app.request("/api/empty-trash", {
        method: "POST",
        headers: { Cookie: cookie },
      });

      expect(res.ok).toBe(true);
      const data = (await res.json()) as { deleted: number };
      // All 5 deleted, not just the 2 tasks
      expect(data.deleted).toBe(5);

      const remaining = await db.sql`SELECT id FROM entries`;
      expect(remaining.length).toBe(0);
    });

    // TS-7.1
    it("concurrent empty trash is safe", async () => {
      await seedEntry(db.sql, {
        name: "Del 1",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Del 2",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Del 3",
        deleted_at: new Date(),
      });

      const { app } = await createIntegrationTrash(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Fire two concurrent requests
      const [res1, res2] = await Promise.all([
        app.request("/api/empty-trash", {
          method: "POST",
          headers: { Cookie: cookie },
        }),
        app.request("/api/empty-trash", {
          method: "POST",
          headers: { Cookie: cookie },
        }),
      ]);

      // Both succeed
      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);

      const data1 = (await res1.json()) as { deleted: number };
      const data2 = (await res2.json()) as { deleted: number };

      // One deletes 3, the other deletes 0 (or they split — total is 3)
      expect(data1.deleted + data2.deleted).toBe(3);

      // All entries gone
      const remaining = await db.sql`SELECT id FROM entries`;
      expect(remaining.length).toBe(0);
    });
  });
});
