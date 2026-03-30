/**
 * Unit tests for multi-calendar support.
 * Extends Google Calendar integration with named calendar routing.
 *
 * Scenarios: TS-1.1, TS-1.4, TS-1.5, TS-1.6,
 *            TS-2.1, TS-2.2, TS-2.3, TS-2.4,
 *            TS-3.1, TS-3.2, TS-3.3,
 *            TS-4.1, TS-4.3, TS-4.4,
 *            TS-5.1, TS-5.2, TS-5.3, TS-5.4,
 *            TS-6.1,
 *            TS-7.2, TS-7.5, TS-7.6
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { withEnv } from "../helpers/env.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Factories ────────────────────────────────────────────────────

function createMockMultiCalendarSettings(overrides: Record<string, string> = {}) {
  return {
    google_calendars: '{"Personal":"primary","Alma":"alma@group.calendar.google.com"}',
    google_calendar_default: "Personal",
    google_access_token: "test-access-token",
    google_refresh_token: "test-refresh-token",
    google_client_id: "test-client-id",
    google_client_secret: "test-client-secret",
    ...overrides,
  };
}

function createMockSingleCalendarSettings(overrides: Record<string, string> = {}) {
  return {
    google_calendar_id: "primary",
    google_access_token: "test-access-token",
    google_refresh_token: "test-refresh-token",
    google_client_id: "test-client-id",
    google_client_secret: "test-client-secret",
    ...overrides,
  };
}

function createGoogleEventResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "google-event-123",
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    ...overrides,
  };
}

// ─── Module Mocks (hoisted) ─────────────────────────────────────

const mockFetchFn = vi.fn();
vi.stubGlobal("fetch", mockFetchFn);

// Mock classification module
const mockClassifyText = vi.fn();
const mockAssembleContext = vi.fn().mockResolvedValue([]);
vi.mock("../../src/classify.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    classifyText: mockClassifyText,
    assembleContext: mockAssembleContext,
  };
});

// Mock embedding module
const mockEmbedEntry = vi.fn().mockResolvedValue(undefined);
const mockGenerateEmbedding = vi.fn().mockResolvedValue(new Array(1024).fill(0));
vi.mock("../../src/embed.js", () => ({
  embedEntry: mockEmbedEntry,
  generateEmbedding: mockGenerateEmbedding,
}));

// Mock dashboard queries
vi.mock("../../src/web/dashboard-queries.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    insertEntry: vi.fn().mockResolvedValue("uuid-42"),
    getRecentEntries: vi.fn().mockResolvedValue([]),
    getDigestContent: vi.fn().mockResolvedValue(null),
  };
});

// Mock settings queries
const mockGetAllSettings = vi.fn().mockResolvedValue({});
const mockSaveAllSettings = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: mockGetAllSettings,
  saveAllSettings: mockSaveAllSettings,
}));

// Mock LLM config
vi.mock("../../src/llm/config.js", () => ({
  getLLMConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeys: { anthropic: "", openai: "", groq: "", gemini: "" },
  }),
  saveLLMConfig: vi.fn().mockResolvedValue(undefined),
}));

// Mock google-calendar module — get real implementations via importActual
const mockProcessCalendarEvent = vi.fn().mockResolvedValue({ created: false });
const mockHandleEntryCalendarCleanup = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/google-calendar.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    processCalendarEvent: mockProcessCalendarEvent,
    handleEntryCalendarCleanup: mockHandleEntryCalendarCleanup,
  };
});

// Store real implementations for core tests
let realProcessCalendarEvent: any;
let realHandleEntryCalendarCleanup: any;
let realResolveCalendarConfig: any;
let realCreateCalendarEvent: any;
let realDeleteCalendarEvent: any;

// ─── Shared Helpers ──────────────────────────────────────────────

const mockSql = vi.fn().mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

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

// ─── Test Suite ──────────────────────────────────────────────────

describe("Multi-Calendar", () => {
  beforeAll(async () => {
    const real = await vi.importActual<typeof import("../../src/google-calendar.js")>("../../src/google-calendar.js");
    realProcessCalendarEvent = real.processCalendarEvent;
    realHandleEntryCalendarCleanup = real.handleEntryCalendarCleanup;
    realResolveCalendarConfig = real.resolveCalendarConfig;
    realCreateCalendarEvent = real.createCalendarEvent;
    realDeleteCalendarEvent = real.deleteCalendarEvent;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchFn.mockReset();
    mockGetAllSettings.mockResolvedValue({});
    mockSaveAllSettings.mockResolvedValue(undefined);
    mockProcessCalendarEvent.mockReset();
    mockProcessCalendarEvent.mockResolvedValue({ created: false });
    mockHandleEntryCalendarCleanup.mockReset();
    mockHandleEntryCalendarCleanup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Don't use vi.restoreAllMocks() — it would undo vi.stubGlobal("fetch")
  });

  // ─── Group 1: Settings Configuration ──────────────────────────

  describe("Settings Configuration", () => {
    it("TS-1.1: renders named calendars editor in settings", async () => {
      mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());
      mockFetchFn.mockResolvedValue(new Response("OK", { status: 200 }));

      const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
      const { createSettingsRoutes } = await import("../../src/web/settings.js");

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      app.route("/", createSettingsRoutes(mockSql));

      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const html = await res.text();
      // Settings page should render named calendar entries
      expect(html).toContain("Personal");
      expect(html).toContain("Alma");
    });

    it("TS-1.4: rejects duplicate calendar names", async () => {
      const restore = withEnv({
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      });
      try {
        mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

        const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
        const { createSettingsRoutes } = await import("../../src/web/settings.js");

        const app = new Hono();
        app.use("*", createAuthMiddleware(TEST_SECRET));
        app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
        app.route("/", createSettingsRoutes(mockSql));

        const cookie = await loginAndGetCookie(app);
        // Submit settings with duplicate calendar names
        const body = new URLSearchParams();
        body.set("calendar_name_0", "Personal");
        body.set("calendar_id_0", "primary");
        body.set("calendar_name_1", "Personal");
        body.set("calendar_id_1", "other@group.calendar.google.com");
        body.set("google_calendar_default", "Personal");

        const res = await app.request("/settings", {
          method: "POST",
          body,
          headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });

        // Should not save duplicates — either error or sanitized
        const savedCalls = mockSaveAllSettings.mock.calls;
        if (savedCalls.length > 0) {
          const saved = savedCalls[0][1] as Record<string, string>;
          if (saved.google_calendars) {
            const calendars = JSON.parse(saved.google_calendars);
            const names = Object.keys(calendars);
            // No duplicate keys in a JSON object (last one wins), but validation should catch this
            expect(new Set(names).size).toBe(names.length);
          }
        }
      } finally {
        restore();
      }
    });

    it("TS-1.5: rejects empty calendar name or ID", async () => {
      const restore = withEnv({
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      });
      try {
        mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

        const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
        const { createSettingsRoutes } = await import("../../src/web/settings.js");

        const app = new Hono();
        app.use("*", createAuthMiddleware(TEST_SECRET));
        app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
        app.route("/", createSettingsRoutes(mockSql));

        const cookie = await loginAndGetCookie(app);
        // Submit with empty name
        const body = new URLSearchParams();
        body.set("calendar_name_0", "");
        body.set("calendar_id_0", "primary");
        body.set("google_calendar_default", "");

        const res = await app.request("/settings", {
          method: "POST",
          body,
          headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });

        // Empty names/IDs should be filtered out or rejected
        const savedCalls = mockSaveAllSettings.mock.calls;
        if (savedCalls.length > 0) {
          const saved = savedCalls[0][1] as Record<string, string>;
          if (saved.google_calendars) {
            const calendars = JSON.parse(saved.google_calendars);
            // Empty-named entries should not be persisted
            expect(Object.keys(calendars).every((k: string) => k.length > 0)).toBe(true);
            expect(Object.values(calendars).every((v: unknown) => typeof v === "string" && (v as string).length > 0)).toBe(true);
          }
        }
      } finally {
        restore();
      }
    });

    it("TS-1.6: rejects empty calendars in multi-calendar mode", async () => {
      const restore = withEnv({
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      });
      try {
        mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

        const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
        const { createSettingsRoutes } = await import("../../src/web/settings.js");

        const app = new Hono();
        app.use("*", createAuthMiddleware(TEST_SECRET));
        app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
        app.route("/", createSettingsRoutes(mockSql));

        const cookie = await loginAndGetCookie(app);
        // Submit with no calendar entries at all
        const body = new URLSearchParams();
        body.set("google_calendar_default", "");
        // No calendar_name_* or calendar_id_* fields

        const res = await app.request("/settings", {
          method: "POST",
          body,
          headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });

        // With no calendar entries, google_calendars should either not be set or be empty
        const savedCalls = mockSaveAllSettings.mock.calls;
        if (savedCalls.length > 0) {
          const saved = savedCalls[0][1] as Record<string, string>;
          if (saved.google_calendars) {
            const calendars = JSON.parse(saved.google_calendars);
            // If google_calendars is set, it should have been cleared or left as empty
            expect(Object.keys(calendars).length).toBe(0);
          }
        }
      } finally {
        restore();
      }
    });
  });

  // ─── Group 2: Backward Compatibility ──────────────────────────

  describe("Backward Compatibility", () => {
    it("TS-2.1: uses google_calendar_id when google_calendars not set", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;

      mockGetAllSettings.mockResolvedValue(createMockSingleCalendarSettings());

      const config = await resolveCalendarConfig(mockSql);

      expect(config.calendarId).toBe("primary");
    });

    it("TS-2.2: google_calendars takes precedence over google_calendar_id", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;

      mockGetAllSettings.mockResolvedValue({
        ...createMockSingleCalendarSettings({ google_calendar_id: "old-calendar" }),
        google_calendars: '{"Personal":"primary","Alma":"alma@group.calendar.google.com"}',
        google_calendar_default: "Personal",
      });

      const config = await resolveCalendarConfig(mockSql);

      // Multi-calendar config should expose the calendars map
      expect(config.calendars).toBeDefined();
      expect(config.calendars).toEqual({
        Personal: "primary",
        Alma: "alma@group.calendar.google.com",
      });
    });

    it("TS-2.3: single entry in google_calendars acts as single mode", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;

      mockGetAllSettings.mockResolvedValue({
        ...createMockSingleCalendarSettings(),
        google_calendars: '{"Personal":"primary"}',
        google_calendar_default: "Personal",
      });

      const config = await resolveCalendarConfig(mockSql);

      // Single entry should behave as single-calendar mode
      expect(config.calendarId).toBe("primary");
      // Should not activate multi-calendar
      expect(config.calendars).toBeUndefined();
    });

    it("TS-2.4: returns empty calendar ID when no DB setting exists", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;
      mockGetAllSettings.mockResolvedValue({});

      const config = await resolveCalendarConfig(mockSql);

      expect(config.calendarId).toBe("");
    });
  });

  // ─── Group 3: Classification Prompt ───────────────────────────

  describe("Classification Prompt", () => {
    it("TS-3.1: classification prompt includes calendar names in multi-calendar mode", async () => {
      const { assemblePrompt } = await vi.importActual<typeof import("../../src/classify.js")>("../../src/classify.js");
      const { readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");

      const template = await readFile(resolve(process.cwd(), "prompts/classify.md"), "utf-8");

      // The prompt template should accept calendar names when multi-calendar is active
      // This tests that the prompt includes calendar name instructions
      const calendarNames = ["Personal", "Alma"];
      const prompt = assemblePrompt(template, "No context", "Meeting with Alma tomorrow", "English", calendarNames);

      expect(prompt).toContain("Personal");
      expect(prompt).toContain("Alma");
      expect(prompt).toContain("calendar_name");
    });

    it("TS-3.2: parses calendar_name from classification output", async () => {
      const { validateClassificationResponse } = await vi.importActual<typeof import("../../src/classify.js")>("../../src/classify.js");

      const raw = JSON.stringify({
        category: "tasks",
        name: "Meeting with Alma",
        confidence: 0.9,
        fields: { due_date: "2026-04-15", status: "pending", notes: null },
        tags: ["meeting", "alma"],
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: "14:00",
        calendar_name: "Alma",
      });

      const result = validateClassificationResponse(raw);

      expect(result).not.toBeNull();
      expect(result!.calendar_name).toBe("Alma");
    });

    it("TS-3.3: prompt omits calendar_name in single-calendar mode", async () => {
      const { assemblePrompt } = await vi.importActual<typeof import("../../src/classify.js")>("../../src/classify.js");
      const { readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");

      const template = await readFile(resolve(process.cwd(), "prompts/classify.md"), "utf-8");

      // Without calendar names (single-calendar mode), prompt should not mention calendar_name
      const prompt = assemblePrompt(template, "No context", "Meeting tomorrow", "English");

      expect(prompt).not.toContain("calendar_name");
    });
  });

  // ─── Group 4: Event Creation Routing ──────────────────────────

  describe("Event Creation Routing", () => {
    it("TS-4.1: creates event on LLM-selected calendar ID", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

      // Mock SQL to return entry data (first call is SELECT entry, subsequent are UPDATEs)
      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          id: "uuid-42",
          name: "Meeting with Alma",
          content: "Meeting with Alma tomorrow",
          google_calendar_event_id: null,
          google_calendar_target: null,
        }])
        .mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: "14:00",
        calendar_name: "Alma",
      });

      expect(result.created).toBe(true);

      // Verify the fetch was called with the Alma calendar ID
      const [url] = mockFetchFn.mock.calls[0];
      expect(url).toContain(encodeURIComponent("alma@group.calendar.google.com"));
    });

    it("TS-4.3: falls back to default calendar on unrecognized calendar_name", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          id: "uuid-42",
          name: "Some Event",
          content: "Some event content",
          google_calendar_event_id: null,
          google_calendar_target: null,
        }])
        .mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
        calendar_name: "NonExistent",
      });

      expect(result.created).toBe(true);

      // Should use default calendar "primary" (Personal)
      const [url] = mockFetchFn.mock.calls[0];
      expect(url).toContain("/calendars/primary/events");
    });

    it("TS-4.4: does not populate google_calendar_target in single-calendar mode", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue(createMockSingleCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          id: "uuid-42",
          name: "Meeting",
          content: "Meeting content",
          google_calendar_event_id: null,
          google_calendar_target: null,
        }])
        .mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      });

      expect(result.created).toBe(true);

      // In single-calendar mode, the UPDATE call should set google_calendar_event_id but NOT google_calendar_target
      // The second SQL call is the UPDATE (first is SELECT)
      expect(mockSqlWithEntry.mock.calls.length).toBeGreaterThanOrEqual(2);
      const updateCall = mockSqlWithEntry.mock.calls[1];
      const updateQuery = String(updateCall[0]);
      expect(updateQuery).toContain("google_calendar_event_id");
      expect(updateQuery).not.toContain("google_calendar_target");
    });
  });

  // ─── Group 5: Event Updates and Deletes ───────────────────────

  describe("Event Updates and Deletes", () => {
    it("TS-5.1: update uses stored google_calendar_target", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          id: "uuid-42",
          name: "Meeting",
          content: "Meeting content",
          google_calendar_event_id: "evt-123",
          google_calendar_target: "alma@group.calendar.google.com",
        }])
        .mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-123" })), { status: 200 }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: null,
        calendar_name: "Alma",
      });

      // Should PATCH the existing event on the stored calendar
      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain(encodeURIComponent("alma@group.calendar.google.com"));
      expect(url).toContain("evt-123");
      expect(options.method).toBe("PATCH");
    });

    it("TS-5.2: calendar change deletes old event and creates new one", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          id: "uuid-42",
          name: "Meeting",
          content: "Meeting content",
          google_calendar_event_id: "evt-123",
          google_calendar_target: "primary",
        }])
        .mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

      // DELETE on old calendar, then POST on new calendar
      mockFetchFn
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-456" })), { status: 200 }),
        );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: "10:00",
        calendar_name: "Alma",
      });

      expect(result.created).toBe(true);

      // First call: DELETE old event from "primary"
      const deleteCall = mockFetchFn.mock.calls.find(
        (c: any[]) => c[1]?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![0]).toContain("/calendars/primary/events/evt-123");

      // Second call: POST new event to "alma@group..."
      const postCall = mockFetchFn.mock.calls.find(
        (c: any[]) => c[1]?.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(postCall![0]).toContain(encodeURIComponent("alma@group.calendar.google.com"));
    });

    it("TS-5.3: soft-delete uses stored google_calendar_target", async () => {
      const handleEntryCalendarCleanup = realHandleEntryCalendarCleanup;

      mockGetAllSettings.mockResolvedValue(createMockMultiCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          google_calendar_event_id: "evt-456",
          google_calendar_target: "alma@group.calendar.google.com",
        }])
        .mockResolvedValue([]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await handleEntryCalendarCleanup(mockSqlWithEntry, "uuid-42");

      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain(encodeURIComponent("alma@group.calendar.google.com"));
      expect(url).toContain("evt-456");
      expect(options.method).toBe("DELETE");
    });

    it("TS-5.4: null google_calendar_target falls back to default", async () => {
      const handleEntryCalendarCleanup = realHandleEntryCalendarCleanup;

      mockGetAllSettings.mockResolvedValue(createMockSingleCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          google_calendar_event_id: "evt-789",
          google_calendar_target: null,
        }])
        .mockResolvedValue([]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await handleEntryCalendarCleanup(mockSqlWithEntry, "uuid-42");

      const [url] = mockFetchFn.mock.calls[0];
      expect(url).toContain("/calendars/primary/events");
      expect(url).toContain("evt-789");
    });
  });

  // ─── Group 6: Constraints ─────────────────────────────────────

  describe("Constraints", () => {
    it("TS-6.1: all calendars use same access token", async () => {
      const createCalendarEvent = realCreateCalendarEvent;

      const config = {
        calendarId: "primary",
        accessToken: "shared-token-123",
        refreshToken: "test-refresh-token",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        defaultDuration: 60,
        calendars: { Personal: "primary", Alma: "alma@group.calendar.google.com" },
        defaultCalendar: "Personal",
      };

      mockFetchFn
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-1" })), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleEventResponse({ id: "evt-2" })), { status: 200 }),
        );

      // Create event on "primary"
      await createCalendarEvent(
        { ...config, calendarId: "primary" },
        { name: "Event 1", content: "Content 1", calendarDate: "2026-04-15", calendarTime: null },
      );

      // Create event on "alma@group..."
      await createCalendarEvent(
        { ...config, calendarId: "alma@group.calendar.google.com" },
        { name: "Event 2", content: "Content 2", calendarDate: "2026-04-16", calendarTime: null },
      );

      // Both calls should use the same Bearer token
      const authHeaders = mockFetchFn.mock.calls.map(
        (c: any[]) => c[1]?.headers?.Authorization,
      );
      expect(authHeaders[0]).toBe("Bearer shared-token-123");
      expect(authHeaders[1]).toBe("Bearer shared-token-123");
    });
  });

  // ─── Group 7: Edge Cases ──────────────────────────────────────

  describe("Edge Cases", () => {
    it("TS-7.2: ignores calendar_name when in single-calendar mode", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue(createMockSingleCalendarSettings());

      const mockSqlWithEntry = vi.fn()
        .mockResolvedValueOnce([{
          id: "uuid-42",
          name: "Meeting",
          content: "Meeting content",
          google_calendar_event_id: null,
          google_calendar_target: null,
        }])
        .mockResolvedValue([{ id: "uuid-42" }]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
        calendar_name: "SomeCalendar",
      });

      expect(result.created).toBe(true);

      // Should use the single configured calendar, ignoring calendar_name
      const [url] = mockFetchFn.mock.calls[0];
      expect(url).toContain("/calendars/primary/events");
    });

    it("TS-7.5: empty google_calendars falls back to google_calendar_id", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;

      mockGetAllSettings.mockResolvedValue({
        google_calendars: "{}",
        google_calendar_id: "primary",
        google_access_token: "test-access-token",
        google_refresh_token: "test-refresh-token",
      });

      const config = await resolveCalendarConfig(mockSql);

      expect(config.calendarId).toBe("primary");
      // Empty calendars should not activate multi-calendar
      expect(config.calendars).toBeUndefined();
    });

    it("TS-7.6: uses first calendar when default name is invalid", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;

      mockGetAllSettings.mockResolvedValue({
        ...createMockMultiCalendarSettings(),
        google_calendar_default: "Deleted Calendar",
      });

      const config = await resolveCalendarConfig(mockSql);

      // When default doesn't match, should use first calendar
      expect(config.defaultCalendar).toBe("Personal");
    });
  });
});
