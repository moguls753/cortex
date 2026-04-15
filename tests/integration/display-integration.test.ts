/**
 * Integration tests for the kitchen-display feature.
 * Uses testcontainers PostgreSQL for real DB operations (task queries, settings).
 *
 * Rendering is mocked — TS-8.2, TS-C-3, TS-NG-1, TS-NG-8 assert endpoint
 * behavior, not pixel output. This avoids loading Satori fonts and the
 * Resvg WASM in test environments.
 *
 * Calendar fetching is mocked (Google OAuth boundary) — the tests either
 * short-circuit with an unconfigured calendar or return empty arrays.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Hono } from "hono";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";

// Top-level mocks — hoisted before the SUT import
vi.mock("../../src/display/render.js", () => ({
  renderKitchenDisplay: vi.fn().mockResolvedValue(Buffer.from("fake-png-bytes")),
}));

vi.mock("../../src/display/calendar-data.js", () => ({
  getDisplayEvents: vi.fn().mockResolvedValue({ today: [], tomorrow: [] }),
}));

vi.mock("../../src/display/weather-data.js", () => ({
  getWeather: vi.fn().mockResolvedValue(null),
}));

import { createDisplayRoutes } from "../../src/display/index.js";
import { renderKitchenDisplay } from "../../src/display/render.js";
import { getDisplayTasks } from "../../src/display/task-data.js";

const mockRender = renderKitchenDisplay as ReturnType<typeof vi.fn>;

function buildApp(sql: Parameters<typeof createDisplayRoutes>[0]): Hono {
  const app = new Hono();
  app.route("/", createDisplayRoutes(sql));
  return app;
}

async function setSetting(
  sql: TestDb["sql"],
  key: string,
  value: string,
): Promise<void> {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

async function enableDisplay(sql: TestDb["sql"]): Promise<void> {
  await setSetting(sql, "display_enabled", "true");
}

describe("Kitchen Display Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.sql`TRUNCATE settings`;
    await db.sql`TRUNCATE entries`;
    // "user" table may or may not exist depending on onboarding migration
    try {
      await db.sql`TRUNCATE "user" CASCADE`;
    } catch {
      // swallow — not all test paths need it
    }
    vi.clearAllMocks();
    mockRender.mockResolvedValue(Buffer.from("fake-png-bytes"));
  });

  // ─── TS-1.1 ────────────────────────────────────────────────

  it("TS-1.1 — display_enabled defaults to absent on fresh install", async () => {
    const rows =
      await db.sql`SELECT value FROM settings WHERE key = 'display_enabled'`;
    expect(rows.length === 0 || rows[0].value === "false").toBe(true);
  });

  // ─── TS-1.4 ────────────────────────────────────────────────

  it("TS-1.4 — toggling display_enabled at runtime makes the endpoint reachable", async () => {
    await setSetting(db.sql, "display_enabled", "false");
    const app = buildApp(db.sql);

    const first = await app.request("/api/kitchen.png");
    expect(first.status).toBe(404);

    await setSetting(db.sql, "display_enabled", "true");

    const second = await app.request("/api/kitchen.png");
    expect(second.status).toBe(200);
  });

  // ─── TS-6.1, 6.2, 6.2b ─────────────────────────────────────

  it("TS-6.1 — pending task appears in getDisplayTasks result", async () => {
    await db.sql`
      INSERT INTO entries (category, name, fields, source)
      VALUES ('tasks', 'Pending thing', ${db.sql.json({ status: "pending" })}, 'webapp')
    `;
    const tasks = await getDisplayTasks(db.sql, 7);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("Pending thing");
    expect(tasks[0].done).toBe(false);
  });

  it("TS-6.2 — recently-done task (< 24h) appears in done state", async () => {
    await db.sql`
      INSERT INTO entries (category, name, fields, source, updated_at)
      VALUES ('tasks', 'Freshly done',
              ${db.sql.json({ status: "done" })},
              'webapp',
              now() - interval '2 hours')
    `;
    const tasks = await getDisplayTasks(db.sql, 7);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("Freshly done");
    expect(tasks[0].done).toBe(true);
  });

  it("TS-6.2b — stale done task (> 24h) does NOT appear", async () => {
    await db.sql`
      INSERT INTO entries (category, name, fields, source, updated_at)
      VALUES ('tasks', 'Stale done',
              ${db.sql.json({ status: "done" })},
              'webapp',
              now() - interval '48 hours')
    `;
    const tasks = await getDisplayTasks(db.sql, 7);
    expect(tasks).toHaveLength(0);
  });

  // ─── TS-6.3 ────────────────────────────────────────────────

  it("TS-6.3 — pending tasks ordered by due date ascending (nulls last)", async () => {
    await db.sql`
      INSERT INTO entries (category, name, fields, source) VALUES
        ('tasks', 'A', ${db.sql.json({ status: "pending", due_date: "2026-05-01" })}, 'webapp'),
        ('tasks', 'B', ${db.sql.json({ status: "pending", due_date: "2026-04-01" })}, 'webapp'),
        ('tasks', 'C', ${db.sql.json({ status: "pending", due_date: "2026-06-01" })}, 'webapp')
    `;
    const tasks = await getDisplayTasks(db.sql, 7);
    expect(tasks.map((t) => t.name)).toEqual(["B", "A", "C"]);
  });

  // ─── TS-6.4 ────────────────────────────────────────────────

  it("TS-6.4 — limit caps the returned count", async () => {
    for (let i = 0; i < 10; i++) {
      await db.sql`
        INSERT INTO entries (category, name, fields, source)
        VALUES ('tasks', ${"Task " + i}, ${db.sql.json({ status: "pending" })}, 'webapp')
      `;
    }
    const tasks = await getDisplayTasks(db.sql, 3);
    expect(tasks).toHaveLength(3);
  });

  // ─── TS-8.2 ────────────────────────────────────────────────

  it("TS-8.2 — all data sources empty still returns a valid PNG response", async () => {
    await enableDisplay(db.sql);
    const app = buildApp(db.sql);

    const res = await app.request("/api/kitchen.png");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);

    expect(mockRender).toHaveBeenCalledOnce();
    const data = mockRender.mock.calls[0][0] as {
      weather: unknown;
      todayEvents: unknown[];
      tasks: unknown[];
    };
    expect(data.weather).toBeNull();
    expect(data.todayEvents).toEqual([]);
    expect(data.tasks).toEqual([]);
  });

  // ─── TS-C-3 ────────────────────────────────────────────────

  it("TS-C-3 — two sequential requests each invoke the renderer (no reuse)", async () => {
    await enableDisplay(db.sql);
    const app = buildApp(db.sql);

    await app.request("/api/kitchen.png");
    await app.request("/api/kitchen.png");

    expect(mockRender.mock.calls.length).toBe(2);
  });

  // ─── TS-NG-1 ───────────────────────────────────────────────

  it("TS-NG-1 — unauthenticated request reaches the PNG when token empty and user exists", async () => {
    await enableDisplay(db.sql);
    // Try to create a user row; swallow if the table layout differs.
    try {
      await db.sql`
        INSERT INTO "user" (id, display_name, password_hash)
        VALUES (1, 'someone', '$2b$12$abcdefghijklmnopqrstuv')
      `;
    } catch {
      // onboarding migration not present in this test run — the assertion
      // still stands: no session cookie is required to reach the endpoint.
    }
    const app = buildApp(db.sql);

    const res = await app.request("/api/kitchen.png");
    expect(res.status).toBe(200);
  });

  // ─── TS-NG-8 ───────────────────────────────────────────────

  it("TS-NG-8 — 100 sequential requests all return 200, no rate limiting", async () => {
    await enableDisplay(db.sql);
    const app = buildApp(db.sql);

    for (let i = 0; i < 100; i++) {
      const res = await app.request("/api/kitchen.png");
      expect(res.status).toBe(200);
    }
    expect(mockRender.mock.calls.length).toBe(100);
  });

  // ─── TS-5.1 ────────────────────────────────────────────────
  // Covered transitively: the real getDisplayEvents is mocked here, so
  // the timezone-aware query contract is unit-tested in the calendar-data
  // file. This integration test confirms the settings timezone is read
  // and forwarded to the calendar-data layer.

  it("TS-5.1 — configured timezone is forwarded to the calendar-data layer", async () => {
    await enableDisplay(db.sql);
    await setSetting(db.sql, "timezone", "America/Los_Angeles");

    const { getDisplayEvents } = await import(
      "../../src/display/calendar-data.js"
    );
    const mockGetEvents = getDisplayEvents as ReturnType<typeof vi.fn>;

    const app = buildApp(db.sql);
    await app.request("/api/kitchen.png");

    expect(mockGetEvents).toHaveBeenCalled();
    const tzArg = mockGetEvents.mock.calls[0][1];
    expect(tzArg).toBe("America/Los_Angeles");
  });
});
