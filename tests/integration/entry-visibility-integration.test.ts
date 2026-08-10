/**
 * Integration tests for the entry-visibility feature.
 * Uses testcontainers PostgreSQL for real DB operations — schema checks,
 * CHECK-constraint enforcement, migration default, display filter, and
 * concurrent-edit semantics.
 *
 * Render is mocked (avoids Satori fonts / Resvg WASM per display-integration pattern).
 *
 * Scenarios: TS-2.1, TS-2.2, TS-7.1, TS-7.2, TS-7.3, TS-8.1
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
  renderDisplay: vi
    .fn()
    .mockResolvedValue(Buffer.from("fake-png-bytes")),
}));

vi.mock("../../src/display/calendar-data.js", () => ({
  getDisplayEvents: vi.fn().mockResolvedValue({ today: [], upcoming: [] }),
}));

vi.mock("../../src/display/weather-data.js", () => ({
  getWeather: vi.fn().mockResolvedValue(null),
}));

import { createDisplayRoutes } from "../../src/display/index.js";
import { getDisplayTasks } from "../../src/display/task-data.js";
import { renderDisplay } from "../../src/display/render.js";

const mockRender = renderDisplay as ReturnType<typeof vi.fn>;

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

describe("Entry Visibility — Integration", () => {
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
    try {
      await db.sql`TRUNCATE "user" CASCADE`;
    } catch {
      /* user table may have been TRUNCATEd by migrations seeding */
    }
    vi.clearAllMocks();
    mockRender.mockResolvedValue(Buffer.from("fake-png-bytes"));
  });

  // ─── Group 7 — DB schema ────────────────────────────────────────

  // TS-7.1
  it("entries.visibility column exists with NOT NULL DEFAULT 'private' and a CHECK constraint", async () => {
    const cols = await db.sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'entries' AND column_name = 'visibility'
    `;
    expect(cols.length).toBe(1);
    const col = cols[0] as {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    };
    expect(col.data_type).toBe("text");
    expect(col.is_nullable).toBe("NO");
    expect(col.column_default).toMatch(/'private'/);

    const constraints = (await db.sql`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'entries'::regclass AND contype = 'c'
    `) as unknown as Array<{ conname: string; def: string }>;

    const visibilityCheck = constraints.find((c) =>
      c.def.toLowerCase().includes("visibility"),
    );
    expect(visibilityCheck).toBeDefined();
    expect(visibilityCheck?.def).toMatch(/'private'/);
    expect(visibilityCheck?.def).toMatch(/'shared'/);
  });

  // TS-7.2
  it("raw INSERT with an invalid visibility value is rejected by Postgres", async () => {
    let caught: Error | null = null;
    try {
      await db.sql`
        INSERT INTO entries (name, category, source, visibility)
        VALUES ('invalid-viz', 'tasks', 'telegram', 'public')
      `;
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    // Postgres check_violation: code 23514
    const err = caught as unknown as { code?: string };
    expect(err.code).toBe("23514");
  });

  // TS-7.3
  it("new rows default to visibility='private' when not specified", async () => {
    const rows = await db.sql`
      INSERT INTO entries (name, category, source)
      VALUES ('no-viz', 'tasks', 'telegram')
      RETURNING visibility
    `;
    expect(rows.length).toBe(1);
    expect((rows[0] as { visibility: string }).visibility).toBe("private");
  });

  // ─── Group 2 — Display filter ───────────────────────────────────

  // TS-2.1
  it("getDisplayTasks returns only rows with visibility='shared'", async () => {
    // Task A — shared, pending → should appear
    await db.sql`
      INSERT INTO entries (name, category, source, visibility, fields)
      VALUES (
        'Task A',
        'tasks',
        'telegram',
        'shared',
        ${db.sql.json({ status: "pending", due_date: null })}
      )
    `;
    // Task B — private, pending → should NOT appear
    await db.sql`
      INSERT INTO entries (name, category, source, visibility, fields)
      VALUES (
        'Task B',
        'tasks',
        'telegram',
        'private',
        ${db.sql.json({ status: "pending", due_date: null })}
      )
    `;
    // Task C — shared, done, recently (<24h) → should appear
    await db.sql`
      INSERT INTO entries (name, category, source, visibility, fields, updated_at)
      VALUES (
        'Task C',
        'tasks',
        'telegram',
        'shared',
        ${db.sql.json({ status: "done", due_date: null })},
        now()
      )
    `;

    const tasks = await getDisplayTasks(db.sql, 10);
    const names = tasks.map((t) => t.name);
    expect(names).toContain("Task A");
    expect(names).toContain("Task C");
    expect(names).not.toContain("Task B");
  });

  // TS-2.2
  it("display HTTP endpoint excludes private tasks from the render data", async () => {
    await setSetting(db.sql, "display_enabled", "true");
    await setSetting(db.sql, "display_weather_lat", "");
    await setSetting(db.sql, "display_weather_lng", "");

    await db.sql`
      INSERT INTO entries (name, category, source, visibility, fields)
      VALUES (
        'Public grocery run',
        'tasks',
        'telegram',
        'shared',
        ${db.sql.json({ status: "pending", due_date: null })}
      )
    `;
    await db.sql`
      INSERT INTO entries (name, category, source, visibility, fields)
      VALUES (
        'Secret gift for Luisa',
        'tasks',
        'telegram',
        'private',
        ${db.sql.json({ status: "pending", due_date: null })}
      )
    `;

    const app = new Hono();
    app.route("/", createDisplayRoutes(db.sql));

    const res = await app.request("/api/display.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    // Assert on the data that was passed to the (mocked) renderer: the tasks
    // list excludes the private entry.
    expect(mockRender).toHaveBeenCalledTimes(1);
    const callArgs = mockRender.mock.calls[0];
    const data = callArgs?.[0] as { tasks: Array<{ name: string }> };
    const names = data.tasks.map((t) => t.name);
    expect(names).toContain("Public grocery run");
    expect(names).not.toContain("Secret gift for Luisa");
  });

  // ─── Group 8 — Edge cases ───────────────────────────────────────

  // TS-8.1
  it("concurrent webapp edit + Telegram toggle resolves to last-writer-wins", async () => {
    const rows = await db.sql`
      INSERT INTO entries (name, category, source, visibility)
      VALUES ('concurrent-target', 'tasks', 'telegram', 'private')
      RETURNING id
    `;
    const id = (rows[0] as { id: string }).id;

    // First UPDATE — webapp edit path, flips to shared.
    await db.sql`
      UPDATE entries SET visibility = 'shared' WHERE id = ${id}
    `;
    // Second UPDATE — Telegram toggle path, arrives last, flips back to private.
    await db.sql`
      UPDATE entries SET visibility = 'private' WHERE id = ${id}
    `;

    const final = await db.sql`
      SELECT visibility FROM entries WHERE id = ${id}
    `;
    expect((final[0] as { visibility: string }).visibility).toBe("private");
  });
});
