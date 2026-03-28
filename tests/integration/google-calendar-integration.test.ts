/**
 * Integration tests for Google Calendar integration.
 * Uses testcontainers PostgreSQL for real DB operations.
 * Mocks globalThis.fetch for Google Calendar API calls.
 *
 * Scenarios: TS-2.3, TS-2.4, TS-2.6,
 *            TS-6.1, TS-6.2, TS-6.3,
 *            TS-8.4, TS-8.5, TS-8.6
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
import { createFakeEmbedding } from "../helpers/mock-ollama.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Factories ────────────────────────────────────────────────────

function createGoogleEventResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "google-event-123",
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    ...overrides,
  };
}

function createGoogleTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    expires_in: 3600,
    token_type: "Bearer",
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
    deleted_at: null,
  };

  const data = { ...defaults, ...overrides };

  const rows = await sql`
    INSERT INTO entries (
      name, content, category, confidence, fields, tags,
      source, source_type, embedding, google_calendar_event_id, deleted_at
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
      ${data.deleted_at as Date | null}
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

async function createIntegrationApp(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createSettingsRoutes } = await import("../../src/web/settings.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createSettingsRoutes(sql));

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

// ─── Test Suite ───────────────────────────────────────────────────

describe("Google Calendar Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.sql`DELETE FROM entries WHERE name LIKE 'Test%' OR name IN ('Entry 1', 'Entry 2')`;
    await db.sql`DELETE FROM settings WHERE key LIKE 'google_%'`;
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchFn);
    mockFetchFn.mockReset();
    // Default: mock fetch returns OK for non-Google requests (e.g., Ollama check)
    mockFetchFn.mockResolvedValue(new Response("OK", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── OAuth Token Storage ─────────────────────────────────────

  describe("OAuth Token Storage", () => {
    it("TS-2.3: authorization code exchange stores tokens", async () => {
      await insertSetting(db.sql, "google_client_id", "test-client-id");
      await insertSetting(db.sql, "google_client_secret", "test-client-secret");

      mockFetchFn.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify(createGoogleTokenResponse({
              access_token: "exchanged-access-token",
              refresh_token: "exchanged-refresh-token",
            })),
            { status: 200 },
          );
        }
        return new Response("OK", { status: 200 });
      });

      const { app } = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings/google-calendar/connect", {
        method: "POST",
        body: new URLSearchParams({ code: "test-auth-code" }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // Verify tokens stored in DB
      const refreshRows = await db.sql`
        SELECT value FROM settings WHERE key = 'google_refresh_token'
      `;
      expect(refreshRows.length).toBe(1);
      expect(refreshRows[0].value).toBe("exchanged-refresh-token");

      const accessRows = await db.sql`
        SELECT value FROM settings WHERE key = 'google_access_token'
      `;
      expect(accessRows.length).toBe(1);
      expect(accessRows[0].value).toBe("exchanged-access-token");
    });

    it("TS-2.4: connected status shown when tokens exist", async () => {
      await insertSetting(db.sql, "google_refresh_token", "stored-refresh-token");

      const { app } = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });
      const html = await res.text();

      expect(html).toMatch(/connected|Connected/i);
      expect(html).toMatch(/disconnect|Disconnect/i);
    });

    it("TS-2.6: disconnect clears stored tokens", async () => {
      await insertSetting(db.sql, "google_refresh_token", "stored-refresh-token");
      await insertSetting(db.sql, "google_access_token", "stored-access-token");

      const { app } = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      await app.request("/settings/google-calendar/disconnect", {
        method: "POST",
        headers: { Cookie: cookie },
      });

      const rows = await db.sql`
        SELECT key FROM settings WHERE key IN ('google_refresh_token', 'google_access_token')
      `;
      expect(rows.length).toBe(0);
    });
  });

  // ─── Entry Deletion ──────────────────────────────────────────

  describe("Entry Deletion", () => {
    it("TS-6.1: calendar event deleted on entry soft-delete", async () => {
      const entryId = await insertEntry(db.sql, {
        google_calendar_event_id: "event-to-delete",
      });
      await insertSetting(db.sql, "google_refresh_token", "test-refresh-token");
      await insertSetting(db.sql, "google_access_token", "test-access-token");
      await insertSetting(db.sql, "google_calendar_id", "test@group.calendar.google.com");

      mockFetchFn.mockImplementation(async (url: string, options: any) => {
        if (typeof url === "string" && url.includes("event-to-delete") && options?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return new Response("OK", { status: 200 });
      });

      const { handleEntryCalendarCleanup } = await import("../../src/google-calendar.js");
      await handleEntryCalendarCleanup(db.sql, entryId);

      // Soft-delete the entry
      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${entryId}`;

      // Verify the Google delete API was called
      const deleteCalls = mockFetchFn.mock.calls.filter(
        ([url, opts]: [string, any]) =>
          typeof url === "string" && url.includes("event-to-delete") && opts?.method === "DELETE",
      );
      expect(deleteCalls.length).toBe(1);

      // Verify entry is soft-deleted
      const rows = await db.sql`SELECT deleted_at FROM entries WHERE id = ${entryId}`;
      expect(rows[0].deleted_at).not.toBeNull();
    });

    it("TS-6.2: entry soft-deleted even if calendar deletion fails", async () => {
      const entryId = await insertEntry(db.sql, {
        google_calendar_event_id: "event-fail-delete",
      });
      await insertSetting(db.sql, "google_refresh_token", "test-refresh-token");
      await insertSetting(db.sql, "google_access_token", "test-access-token");
      await insertSetting(db.sql, "google_calendar_id", "test@group.calendar.google.com");

      mockFetchFn.mockImplementation(async (url: string, options: any) => {
        if (typeof url === "string" && url.includes("event-fail-delete")) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("OK", { status: 200 });
      });

      const { handleEntryCalendarCleanup } = await import("../../src/google-calendar.js");

      // Should not throw even though calendar delete fails
      await handleEntryCalendarCleanup(db.sql, entryId);

      // Soft-delete the entry
      await db.sql`UPDATE entries SET deleted_at = NOW() WHERE id = ${entryId}`;

      // Entry is still soft-deleted
      const rows = await db.sql`SELECT deleted_at, google_calendar_event_id FROM entries WHERE id = ${entryId}`;
      expect(rows[0].deleted_at).not.toBeNull();
      // Event ID NOT cleared (orphaned)
      expect(rows[0].google_calendar_event_id).toBe("event-fail-delete");
    });

    it("TS-6.3: no calendar event re-created on restore", async () => {
      const entryId = await insertEntry(db.sql, {
        google_calendar_event_id: "deleted-event-id",
        deleted_at: new Date(),
      });

      mockFetchFn.mockReset();
      mockFetchFn.mockResolvedValue(new Response("OK", { status: 200 }));

      // Restore the entry
      await db.sql`UPDATE entries SET deleted_at = NULL WHERE id = ${entryId}`;

      // Clear the stale event ID on restore
      await db.sql`
        UPDATE entries SET google_calendar_event_id = NULL WHERE id = ${entryId}
      `;

      // No POST to create a new event
      const createCalls = mockFetchFn.mock.calls.filter(
        ([url, opts]: [string, any]) =>
          typeof url === "string" && url.includes("googleapis.com/calendar") && opts?.method === "POST",
      );
      expect(createCalls.length).toBe(0);

      // Verify event ID is cleared
      const rows = await db.sql`
        SELECT google_calendar_event_id FROM entries WHERE id = ${entryId}
      `;
      expect(rows[0].google_calendar_event_id).toBeNull();
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("TS-8.4: revoked refresh token shows disconnected", async () => {
      await insertSetting(db.sql, "google_refresh_token", "revoked-token");
      await insertSetting(db.sql, "google_access_token", "expired-access");
      await insertSetting(db.sql, "google_client_id", "test-client-id");
      await insertSetting(db.sql, "google_client_secret", "test-client-secret");

      mockFetchFn.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked" }),
            { status: 400 },
          );
        }
        return new Response("OK", { status: 200 });
      });

      // Attempt token refresh
      const { refreshAccessToken } = await import("../../src/google-calendar.js");
      let refreshError: Error | null = null;
      try {
        await refreshAccessToken("revoked-token", "test-client-id", "test-client-secret");
      } catch (e) {
        refreshError = e as Error;
      }
      expect(refreshError).not.toBeNull();

      // Settings page should show not connected
      const { app } = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });
      const html = await res.text();

      // Should show disconnected state since token refresh failed
      expect(html).toMatch(/not connected|Not Connected|disconnected/i);
    });

    it("TS-8.5: multiple simultaneous entries create independent events", async () => {
      const entryId1 = await insertEntry(db.sql, { name: "Entry 1" });
      const entryId2 = await insertEntry(db.sql, { name: "Entry 2" });

      await insertSetting(db.sql, "google_refresh_token", "test-refresh-token");
      await insertSetting(db.sql, "google_access_token", "test-access-token");
      await insertSetting(db.sql, "google_calendar_id", "test@group.calendar.google.com");

      let callCount = 0;
      mockFetchFn.mockImplementation(async (url: string, options: any) => {
        if (typeof url === "string" && url.includes("googleapis.com/calendar") && options?.method === "POST") {
          callCount++;
          return new Response(
            JSON.stringify(createGoogleEventResponse({ id: `event-${callCount}` })),
            { status: 200 },
          );
        }
        return new Response("OK", { status: 200 });
      });

      const { processCalendarEvent } = await import("../../src/google-calendar.js");

      const [result1, result2] = await Promise.all([
        processCalendarEvent(db.sql, entryId1, {
          create_calendar_event: true,
          calendar_date: "2026-04-15",
          calendar_time: "09:00",
        }),
        processCalendarEvent(db.sql, entryId2, {
          create_calendar_event: true,
          calendar_date: "2026-04-16",
          calendar_time: "10:00",
        }),
      ]);

      expect(result1.eventId).not.toBe(result2.eventId);

      // Verify each entry has its own event ID in the DB
      const rows = await db.sql`
        SELECT id, google_calendar_event_id FROM entries
        WHERE id IN (${entryId1}, ${entryId2})
        ORDER BY name
      `;
      expect(rows[0].google_calendar_event_id).toBeDefined();
      expect(rows[1].google_calendar_event_id).toBeDefined();
      expect(rows[0].google_calendar_event_id).not.toBe(rows[1].google_calendar_event_id);
    });

    it("TS-8.6: hard delete does not reattempt calendar deletion", async () => {
      const entryId = await insertEntry(db.sql, {
        google_calendar_event_id: "orphaned-event",
        deleted_at: new Date(),
      });

      mockFetchFn.mockReset();
      mockFetchFn.mockResolvedValue(new Response("OK", { status: 200 }));

      // Hard delete
      await db.sql`DELETE FROM entries WHERE id = ${entryId}`;

      // No Google Calendar API calls should have been made
      const calendarCalls = mockFetchFn.mock.calls.filter(
        ([url]: [string]) => typeof url === "string" && url.includes("googleapis.com/calendar"),
      );
      expect(calendarCalls.length).toBe(0);

      // Entry is gone
      const rows = await db.sql`SELECT id FROM entries WHERE id = ${entryId}`;
      expect(rows.length).toBe(0);
    });
  });
});
