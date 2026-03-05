/**
 * Integration tests for the web dashboard.
 * Uses testcontainers PostgreSQL for real DB operations.
 * Classification and embedding are mocked (external services).
 *
 * Scenarios: TS-1.3, TS-2.5, TS-3.4, TS-3.5,
 *            TS-4.2, TS-5.2–5.4, TS-7.6
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
import type { SSEBroadcaster } from "../../src/web/sse.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Module Mocks (external services only) ──────────────────────────

vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn().mockResolvedValue({
    category: "tasks",
    name: "Mock Entry",
    confidence: 0.9,
    fields: {},
    tags: [],
    content: "Mock content",
  }),
}));

vi.mock("../../src/embed.js", () => ({
  embedEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/config.js", () => ({
  resolveConfigValue: vi.fn().mockResolvedValue(undefined),
}));

// ─── Factories & Helpers ────────────────────────────────────────────

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
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

async function seedEntry(
  sql: postgres.Sql,
  overrides: EntryData = {},
): Promise<string> {
  const entry = createMockEntry(overrides);
  await sql`
    INSERT INTO entries (id, name, category, content, fields, tags, confidence, source, source_type, deleted_at, created_at, updated_at)
    VALUES (
      ${entry.id}, ${entry.name}, ${entry.category}, ${entry.content},
      ${JSON.stringify(entry.fields)}, ${entry.tags}, ${entry.confidence},
      ${entry.source}, ${entry.source_type}, ${entry.deleted_at},
      ${entry.created_at}, ${entry.updated_at}
    )
  `;
  return entry.id!;
}

async function clearEntries(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM entries`;
}

async function createIntegrationDashboard(
  sql: postgres.Sql,
): Promise<{ app: Hono; broadcaster: SSEBroadcaster }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createDashboardRoutes } = await import(
    "../../src/web/dashboard.js"
  );
  const { createSSEBroadcaster } = await import("../../src/web/sse.js");

  const broadcaster = createSSEBroadcaster();

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createDashboardRoutes(sql, broadcaster));

  return { app, broadcaster };
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

async function readSSEEvent(
  response: Response,
  timeoutMs = 2000,
): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSE read timeout")), timeoutMs),
      ),
    ]);
    return decoder.decode(result.value);
  } finally {
    reader.cancel();
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Web Dashboard Integration", () => {
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
  // Digest SSE
  // ═══════════════════════════════════════════════════════════════════
  describe("Digest SSE", () => {
    // TS-1.3
    it("pushes new digest content via SSE", async () => {
      const { app, broadcaster } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);

      // Allow microtask for handler registration
      await new Promise((r) => setTimeout(r, 0));

      broadcaster.broadcast({
        type: "digest:updated",
        data: { content: "New digest content" },
      });

      const text = await readSSEEvent(res);
      expect(text).toContain("event: digest:updated");
      expect(text).toContain("New digest content");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Entry Filtering
  // ═══════════════════════════════════════════════════════════════════
  describe("Entry Filtering", () => {
    // TS-2.5
    it("excludes soft-deleted entries from results", async () => {
      // Insert 3 active entries
      await seedEntry(db.sql, { name: "Active 1" });
      await seedEntry(db.sql, { name: "Active 2" });
      await seedEntry(db.sql, { name: "Active 3" });

      // Insert 2 soft-deleted entries
      await seedEntry(db.sql, {
        name: "Deleted 1",
        deleted_at: new Date(),
      });
      await seedEntry(db.sql, {
        name: "Deleted 2",
        deleted_at: new Date(),
      });

      const { app } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain("Active 1");
      expect(body).toContain("Active 2");
      expect(body).toContain("Active 3");
      expect(body).not.toContain("Deleted 1");
      expect(body).not.toContain("Deleted 2");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Stats Queries
  // ═══════════════════════════════════════════════════════════════════
  describe("Stats Queries", () => {
    // TS-3.4
    it("reflects current stats on page load after new entry", async () => {
      await seedEntry(db.sql, {
        category: "tasks",
        fields: { status: "pending" },
        deleted_at: null,
      });

      const { app } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      // Should show at least 1 open task
      expect(body).toMatch(
        /[1-9]\d*[\s\S]*?open\s+tasks|open\s+tasks[\s\S]*?[1-9]\d*/i,
      );
    });

    // TS-3.5
    it("updates stats via SSE after data change", async () => {
      const { app, broadcaster } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 0));

      broadcaster.broadcast({
        type: "entry:created",
        data: {
          id: "new-id",
          category: "tasks",
          fields: { status: "pending" },
        },
      });

      const text = await readSSEEvent(res);
      expect(text).toContain("entry:created");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Capture Pipeline
  // ═══════════════════════════════════════════════════════════════════
  describe("Capture Pipeline", () => {
    // TS-4.2
    it("classifies, embeds, and stores captured text", async () => {
      const { classifyText } = await import("../../src/classify.js");
      vi.mocked(classifyText).mockResolvedValue({
        category: "tasks",
        name: "Call dentist",
        confidence: 0.92,
        fields: { status: "pending" },
        tags: [],
        content: "Call dentist tomorrow",
      });

      const { embedEntry } = await import("../../src/embed.js");
      vi.mocked(embedEntry).mockResolvedValue(undefined);

      const { app } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/capture", {
        method: "POST",
        body: JSON.stringify({ text: "Call dentist tomorrow" }),
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.category).toBe("tasks");
      expect(json.name).toBe("Call dentist");
      expect(json.confidence).toBeDefined();

      // Verify classify was called with the submitted text
      expect(classifyText).toHaveBeenCalledWith(
        expect.stringContaining("Call dentist tomorrow"),
        expect.anything(),
      );

      // Verify embed was called with the new entry ID
      expect(embedEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
      );

      // Verify entry was persisted in DB
      const rows = await db.sql`
        SELECT name, category, source FROM entries
        WHERE name = 'Call dentist'
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]!.source).toBe("webapp");
      expect(rows[0]!.category).toBe("tasks");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SSE Events
  // ═══════════════════════════════════════════════════════════════════
  describe("SSE Events", () => {
    // TS-5.2
    it("streams entry:created event when entry is inserted", async () => {
      const { app, broadcaster } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 0));

      const entryId = await seedEntry(db.sql, { name: "SSE test entry" });
      broadcaster.broadcast({
        type: "entry:created",
        data: { id: entryId, name: "SSE test entry" },
      });

      const text = await readSSEEvent(res);
      expect(text).toContain("event: entry:created");
      expect(text).toContain(entryId);
      expect(text).toContain("SSE test entry");
    });

    // TS-5.3
    it("streams entry:updated event when entry is modified", async () => {
      const entryId = await seedEntry(db.sql, { name: "Original name" });

      const { app, broadcaster } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 0));

      await db.sql`UPDATE entries SET name = 'Updated name' WHERE id = ${entryId}`;
      broadcaster.broadcast({
        type: "entry:updated",
        data: { id: entryId, name: "Updated name" },
      });

      const text = await readSSEEvent(res);
      expect(text).toContain("event: entry:updated");
      expect(text).toContain(entryId);
    });

    // TS-5.4
    it("streams entry:deleted event when entry is soft-deleted", async () => {
      const entryId = await seedEntry(db.sql, { name: "To delete" });

      const { app, broadcaster } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 0));

      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${entryId}`;
      broadcaster.broadcast({
        type: "entry:deleted",
        data: { id: entryId },
      });

      const text = await readSSEEvent(res);
      expect(text).toContain("event: entry:deleted");
      expect(text).toContain(entryId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Multiple Connections
  // ═══════════════════════════════════════════════════════════════════
  describe("Multiple Connections", () => {
    // TS-7.6
    it("delivers same event to multiple SSE connections", async () => {
      const { app, broadcaster } = await createIntegrationDashboard(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Open two separate SSE connections
      const res1 = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });
      const res2 = await app.request("/api/events", {
        headers: { Cookie: cookie },
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      await new Promise((r) => setTimeout(r, 0));

      broadcaster.broadcast({
        type: "entry:created",
        data: { id: "multi-tab-test", name: "Shared event" },
      });

      const [text1, text2] = await Promise.all([
        readSSEEvent(res1),
        readSSEEvent(res2),
      ]);

      expect(text1).toContain("event: entry:created");
      expect(text1).toContain("multi-tab-test");
      expect(text2).toContain("event: entry:created");
      expect(text2).toContain("multi-tab-test");
    });
  });
});
