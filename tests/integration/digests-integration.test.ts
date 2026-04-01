import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { Sql } from "postgres";
import type { StartedTestContainer } from "testcontainers";
import { startTestDb, runMigrations } from "../helpers/test-db.js";
import crypto from "crypto";

// --- Test DB Setup ---

let sql: Sql;
let container: StartedTestContainer;

beforeAll(async () => {
  const db = await startTestDb();
  container = db.container;
  sql = db.sql;
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

beforeEach(async () => {
  await sql`TRUNCATE entries CASCADE`;
  await sql`TRUNCATE digests`;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helpers ---

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function yesterday(): Date {
  return daysAgo(1);
}

async function seedEntry(
  sqlConn: Sql,
  overrides: Partial<{
    id: string;
    name: string;
    content: string | null;
    category: string | null;
    fields: Record<string, unknown>;
    embedding: number[] | null;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
    source: string;
  }>,
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const fields = overrides.fields ?? {};
  const embeddingLiteral = overrides.embedding
    ? `[${overrides.embedding.join(",")}]`
    : null;
  await sqlConn`
    INSERT INTO entries (id, name, content, category, fields, embedding, deleted_at, created_at, updated_at, source)
    VALUES (
      ${id},
      ${overrides.name ?? "Test Entry"},
      ${overrides.content ?? null},
      ${overrides.category ?? null},
      ${sqlConn.json(fields)},
      ${embeddingLiteral}::vector(4096),
      ${overrides.deleted_at ?? null},
      ${overrides.created_at ?? new Date()},
      ${overrides.updated_at ?? overrides.created_at ?? new Date()},
      ${overrides.source ?? "webapp"}
    )
  `;
  return id;
}


// --- Tests ---

describe("Digests Integration", () => {
  // ============================================================
  // Daily Data Assembly
  // ============================================================
  describe("Daily Data Assembly", () => {
    it("assembles correct daily data from database", async () => {
      // TS-1.1
      const { getDailyDigestData } = await import("../../src/digests-queries.js");

      // Active project with next_action (included)
      await seedEntry(sql, {
        name: "Project Alpha",
        category: "projects",
        fields: { status: "active", next_action: "Ship v2" },
      });

      // Active project without next_action (excluded from activeProjects)
      await seedEntry(sql, {
        name: "Project Beta",
        category: "projects",
        fields: { status: "active", next_action: null },
      });

      // Archived project (excluded)
      await seedEntry(sql, {
        name: "Project Gamma",
        category: "projects",
        fields: { status: "archived", next_action: "Do thing" },
      });

      // Person with follow-ups (included)
      await seedEntry(sql, {
        name: "Alice",
        category: "people",
        fields: { follow_ups: "Call back Monday" },
      });

      // Person without follow-ups (excluded from pendingFollowUps)
      await seedEntry(sql, {
        name: "Bob",
        category: "people",
        fields: { follow_ups: null },
      });

      // Task due in 3 days, pending (included)
      await seedEntry(sql, {
        name: "Review PR",
        category: "tasks",
        fields: { status: "pending", due_date: daysFromNow(3).toISOString().slice(0, 10) },
      });

      // Task due in 10 days (excluded — outside 7-day window)
      await seedEntry(sql, {
        name: "Write docs",
        category: "tasks",
        fields: { status: "pending", due_date: daysFromNow(10).toISOString().slice(0, 10) },
      });

      // Task completed (excluded — not pending)
      await seedEntry(sql, {
        name: "Done task",
        category: "tasks",
        fields: { status: "completed", due_date: daysFromNow(3).toISOString().slice(0, 10) },
      });

      // Entry captured yesterday (included)
      await seedEntry(sql, {
        name: "Yesterday Note",
        category: "ideas",
        created_at: yesterday(),
      });

      // Entry captured 2 days ago (excluded from yesterday's entries)
      await seedEntry(sql, {
        name: "Old Note",
        category: "reference",
        created_at: daysAgo(2),
      });

      // Soft-deleted entry from yesterday (excluded from all)
      await seedEntry(sql, {
        name: "Deleted Note",
        category: "ideas",
        created_at: yesterday(),
        deleted_at: new Date(),
      });

      const result = await getDailyDigestData(sql);

      expect(result.activeProjects).toHaveLength(1);
      expect(result.activeProjects[0].name).toBe("Project Alpha");

      expect(result.pendingFollowUps).toHaveLength(1);
      expect(result.pendingFollowUps[0].name).toBe("Alice");

      expect(result.upcomingTasks).toHaveLength(1);
      expect(result.upcomingTasks[0].name).toBe("Review PR");

      expect(result.yesterdayEntries).toHaveLength(1);
      expect(result.yesterdayEntries[0].name).toBe("Yesterday Note");
    });
  });

  // ============================================================
  // Weekly Data Assembly
  // ============================================================
  describe("Weekly Data Assembly", () => {
    it("assembles correct weekly data from database", async () => {
      // TS-2.1
      const { getWeeklyReviewData } = await import("../../src/digests-queries.js");

      // 3 entries created today
      await seedEntry(sql, { name: "Today 1", category: "ideas", created_at: new Date() });
      await seedEntry(sql, { name: "Today 2", category: "tasks", created_at: new Date() });
      await seedEntry(sql, { name: "Today 3", category: "ideas", created_at: new Date() });

      // 2 entries created 5 days ago
      await seedEntry(sql, { name: "Five days 1", category: "reference", created_at: daysAgo(5) });
      await seedEntry(sql, { name: "Five days 2", category: "people", created_at: daysAgo(5) });

      // 1 entry created 8 days ago (excluded)
      await seedEntry(sql, { name: "Old entry", category: "ideas", created_at: daysAgo(8) });

      // Stalled project: active, updated 6 days ago
      await seedEntry(sql, {
        name: "Stalled project",
        category: "projects",
        fields: { status: "active" },
        created_at: daysAgo(30),
        updated_at: daysAgo(6),
      });

      // Active project updated today (not stalled)
      await seedEntry(sql, {
        name: "Active project",
        category: "projects",
        fields: { status: "active" },
        created_at: daysAgo(10),
        updated_at: new Date(),
      });

      // Soft-deleted entry from today (excluded)
      await seedEntry(sql, {
        name: "Deleted",
        category: "ideas",
        created_at: new Date(),
        deleted_at: new Date(),
      });

      const result = await getWeeklyReviewData(sql);

      // 5 entries from past 7 days (3 today + 2 five days ago), not 8-day or deleted
      expect(result.weekEntries).toHaveLength(5);

      // Daily counts should have entries for days with activity
      expect(result.dailyCounts.length).toBeGreaterThanOrEqual(2);

      // Category counts
      expect(result.categoryCounts.length).toBeGreaterThanOrEqual(1);

      // Stalled projects: only the one updated 6 days ago
      expect(result.stalledProjects).toHaveLength(1);
      expect(result.stalledProjects[0].name).toBe("Stalled project");
    });
  });

  // ============================================================
  // Digest Caching
  // ============================================================
  describe("Digest Caching", () => {
    it("caches latest daily digest, overwriting previous", async () => {
      // TS-1.4
      const { cacheDigest, getLatestDigest } = await import("../../src/digests-queries.js");

      await cacheDigest(sql, "daily", "First digest");
      await cacheDigest(sql, "daily", "Second digest");

      const result = await getLatestDigest(sql, "daily");
      expect(result).not.toBeNull();
      expect(result!.content).toBe("Second digest");
      expect(result!.generated_at).toBeInstanceOf(Date);

      // Only one row for daily
      const rows = await sql`SELECT * FROM digests WHERE type = 'daily'`;
      expect(rows).toHaveLength(1);
    });

    it("caches weekly review separately from daily digest", async () => {
      // TS-2.4
      const { cacheDigest, getLatestDigest } = await import("../../src/digests-queries.js");

      await cacheDigest(sql, "daily", "Daily content");
      await cacheDigest(sql, "weekly", "Weekly content");

      const daily = await getLatestDigest(sql, "daily");
      const weekly = await getLatestDigest(sql, "weekly");

      expect(daily!.content).toBe("Daily content");
      expect(weekly!.content).toBe("Weekly content");

      // Both coexist
      const rows = await sql`SELECT * FROM digests`;
      expect(rows).toHaveLength(2);
    });
  });

});
