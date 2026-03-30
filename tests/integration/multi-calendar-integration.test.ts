/**
 * Integration tests for multi-calendar support.
 * Uses testcontainers PostgreSQL for real DB operations.
 * Mocks globalThis.fetch for Google Calendar API calls.
 *
 * Scenarios: TS-1.2, TS-1.3, TS-4.2, TS-5.2, TS-5.3, TS-7.3, TS-7.4, TS-7.7
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
import type postgres from "postgres";
import { startTestDb, runMigrations, type TestDb } from "../helpers/test-db.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";

// ─── Factories ────────────────────────────────────────────────────

function createGoogleEventResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "google-event-123",
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    ...overrides,
  };
}

// ─── Module Mocks ─────────────────────────────────────────────────

const mockFetchFn = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────

async function insertSetting(
  sql: postgres.Sql,
  key: string,
  value: string,
): Promise<void> {
  await sql`
    INSERT INTO settings (key, value)
    VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

async function insertEntry(
  sql: postgres.Sql,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const embedding = createFakeEmbedding();
  const embeddingStr = `[${embedding.join(",")}]`;

  const defaults = {
    name: "Test entry",
    content: "Test content",
    category: "tasks",
    confidence: 0.9,
    fields: JSON.stringify({}),
    tags: ["test"],
    source: "webapp",
    source_type: "text",
    google_calendar_event_id: null,
    google_calendar_target: null,
    deleted_at: null,
  };

  const data = { ...defaults, ...overrides };

  const rows = await sql`
    INSERT INTO entries (
      name, content, category, confidence, fields, tags,
      source, source_type, embedding, google_calendar_event_id, google_calendar_target, deleted_at
    )
    VALUES (
      ${data.name as string},
      ${data.content as string},
      ${data.category as string},
      ${data.confidence as number},
      ${sql.json(data.fields)},
      ${data.tags as string[]},
      ${data.source as string},
      ${data.source_type as string},
      ${embeddingStr}::vector,
      ${data.google_calendar_event_id as string | null},
      ${data.google_calendar_target as string | null},
      ${data.deleted_at as Date | null}
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

async function insertMultiCalendarSettings(sql: postgres.Sql): Promise<void> {
  await insertSetting(sql, "google_calendars", '{"Personal":"primary","Alma":"alma@group.calendar.google.com"}');
  await insertSetting(sql, "google_calendar_default", "Personal");
  await insertSetting(sql, "google_access_token", "test-access-token");
  await insertSetting(sql, "google_refresh_token", "test-refresh-token");
  await insertSetting(sql, "google_client_id", "test-client-id");
  await insertSetting(sql, "google_client_secret", "test-client-secret");
}

// ─── Test Suite ──────────────────────────────────────────────────

describe("Multi-Calendar Integration", { timeout: 60_000 }, () => {
  let testDb: TestDb;
  let sql: postgres.Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.sql;
    await runMigrations(testDb.url);
  });

  afterAll(async () => {
    await testDb?.stop();
  });

  beforeEach(async () => {
    vi.stubGlobal("fetch", mockFetchFn);
    mockFetchFn.mockReset();
    // Clean tables
    await sql`DELETE FROM entries`;
    await sql`DELETE FROM settings`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── Settings Persistence ─────────────────────────────────────

  describe("Settings Persistence", () => {
    it("TS-1.2: persists google_calendars as JSON in settings table", async () => {
      const calendarsJson = '{"Personal":"primary","Alma":"alma@group.calendar.google.com"}';
      await insertSetting(sql, "google_calendars", calendarsJson);

      const rows = await sql`SELECT value FROM settings WHERE key = 'google_calendars'`;
      expect(rows.length).toBe(1);
      expect(JSON.parse(rows[0].value)).toEqual({
        Personal: "primary",
        Alma: "alma@group.calendar.google.com",
      });
    });

    it("TS-1.3: persists google_calendar_default in settings table", async () => {
      await insertSetting(sql, "google_calendar_default", "Personal");

      const rows = await sql`SELECT value FROM settings WHERE key = 'google_calendar_default'`;
      expect(rows.length).toBe(1);
      expect(rows[0].value).toBe("Personal");
    });
  });

  // ─── Event Target Tracking ────────────────────────────────────

  describe("Event Target Tracking", () => {
    it("TS-4.2: stores google_calendar_target on entry after creation", async () => {
      await insertMultiCalendarSettings(sql);
      const entryId = await insertEntry(sql, { name: "Meeting with Alma", content: "Meeting content" });

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-new" })), { status: 200 }),
      );

      const { processCalendarEvent } = await import("../../src/google-calendar.js");
      await processCalendarEvent(sql, entryId, {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: "14:00",
        calendar_name: "Alma",
      });

      const rows = await sql`
        SELECT google_calendar_event_id, google_calendar_target
        FROM entries WHERE id = ${entryId}
      `;
      expect(rows[0].google_calendar_event_id).toBe("evt-new");
      expect(rows[0].google_calendar_target).toBe("alma@group.calendar.google.com");
    });

    it("TS-5.2: calendar change updates both columns in DB", async () => {
      await insertMultiCalendarSettings(sql);
      const entryId = await insertEntry(sql, {
        name: "Meeting",
        content: "Meeting content",
        google_calendar_event_id: "evt-old",
        google_calendar_target: "primary",
      });

      // DELETE old, then POST new
      mockFetchFn
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-new" })), { status: 200 }),
        );

      const { processCalendarEvent } = await import("../../src/google-calendar.js");
      await processCalendarEvent(sql, entryId, {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: null,
        calendar_name: "Alma",
      });

      const rows = await sql`
        SELECT google_calendar_event_id, google_calendar_target
        FROM entries WHERE id = ${entryId}
      `;
      expect(rows[0].google_calendar_event_id).toBe("evt-new");
      expect(rows[0].google_calendar_target).toBe("alma@group.calendar.google.com");
    });

    it("TS-5.3: soft-delete uses google_calendar_target from DB", async () => {
      await insertMultiCalendarSettings(sql);
      const entryId = await insertEntry(sql, {
        name: "Meeting",
        content: "Meeting content",
        google_calendar_event_id: "evt-del",
        google_calendar_target: "alma@group.calendar.google.com",
      });

      mockFetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const { handleEntryCalendarCleanup } = await import("../../src/google-calendar.js");
      await handleEntryCalendarCleanup(sql, entryId);

      // Verify the delete targeted the correct calendar
      expect(mockFetchFn).toHaveBeenCalledOnce();
      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain(encodeURIComponent("alma@group.calendar.google.com"));
      expect(url).toContain("evt-del");
      expect(options.method).toBe("DELETE");
    });

    it("TS-7.3: events on removed calendar still manageable via stored target", async () => {
      // Set up multi-calendar but WITHOUT "Alma" in the calendars anymore
      await insertSetting(sql, "google_calendars", '{"Personal":"primary"}');
      await insertSetting(sql, "google_calendar_default", "Personal");
      await insertSetting(sql, "google_access_token", "test-access-token");
      await insertSetting(sql, "google_refresh_token", "test-refresh-token");
      await insertSetting(sql, "google_client_id", "test-client-id");
      await insertSetting(sql, "google_client_secret", "test-client-secret");

      // Entry was created when "Alma" existed — it still has the Google Calendar ID stored
      const entryId = await insertEntry(sql, {
        name: "Old meeting",
        content: "Old content",
        google_calendar_event_id: "evt-orphan",
        google_calendar_target: "alma@group.calendar.google.com",
      });

      mockFetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const { handleEntryCalendarCleanup } = await import("../../src/google-calendar.js");
      await handleEntryCalendarCleanup(sql, entryId);

      // Should still target alma@group... from the stored column, not from settings
      const [url] = mockFetchFn.mock.calls[0];
      expect(url).toContain(encodeURIComponent("alma@group.calendar.google.com"));
    });

    it("TS-7.4: renamed calendar resolves same ID, updates not delete+create", async () => {
      // "Alma" renamed to "Alma Shared" — same calendar ID
      await insertSetting(sql, "google_calendars", '{"Personal":"primary","Alma Shared":"alma@group.calendar.google.com"}');
      await insertSetting(sql, "google_calendar_default", "Personal");
      await insertSetting(sql, "google_access_token", "test-access-token");
      await insertSetting(sql, "google_refresh_token", "test-refresh-token");
      await insertSetting(sql, "google_client_id", "test-client-id");
      await insertSetting(sql, "google_client_secret", "test-client-secret");

      const entryId = await insertEntry(sql, {
        name: "Meeting with Alma",
        content: "Meeting content",
        google_calendar_event_id: "evt-existing",
        google_calendar_target: "alma@group.calendar.google.com",
      });

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-existing" })), { status: 200 }),
      );

      const { processCalendarEvent } = await import("../../src/google-calendar.js");
      await processCalendarEvent(sql, entryId, {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: "10:00",
        calendar_name: "Alma Shared",
      });

      // Should PATCH (update), not DELETE+POST, since resolved ID matches stored target
      expect(mockFetchFn).toHaveBeenCalledOnce();
      const [url, options] = mockFetchFn.mock.calls[0];
      expect(options.method).toBe("PATCH");
      expect(url).toContain("evt-existing");
      expect(url).toContain(encodeURIComponent("alma@group.calendar.google.com"));
    });

    it("TS-7.7: legacy entry with null target falls back correctly after multi-calendar switch", async () => {
      await insertMultiCalendarSettings(sql);

      // Legacy entry created before multi-calendar — no target stored
      const entryId = await insertEntry(sql, {
        name: "Legacy meeting",
        content: "Legacy content",
        google_calendar_event_id: "evt-legacy",
        google_calendar_target: null,
      });

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-legacy" })), { status: 200 }),
      );

      const { processCalendarEvent } = await import("../../src/google-calendar.js");
      await processCalendarEvent(sql, entryId, {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: null,
        calendar_name: "Personal",
      });

      // Should fall back to default calendar for the update
      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain("/calendars/primary/events");
      // Should be a PATCH (update) since the entry has an existing event ID
      expect(options.method).toBe("PATCH");
    });
  });
});
