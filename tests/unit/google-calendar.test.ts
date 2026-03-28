/**
 * Unit tests for Google Calendar integration.
 * Uses mocked fetch for Google API calls and mocked modules for dependencies.
 *
 * Scenarios: TS-1.1, TS-1.2, TS-1.3, TS-1.4, TS-1.5, TS-1.6, TS-1.7,
 *            TS-2.1, TS-2.2, TS-2.5, TS-2.7, TS-2.8,
 *            TS-3.1, TS-3.2, TS-3.3,
 *            TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5,
 *            TS-5.1, TS-5.2, TS-5.3, TS-5.4,
 *            TS-7.1, TS-7.1b, TS-7.2, TS-7.3, TS-7.4, TS-7.5,
 *            TS-8.1, TS-8.2, TS-8.3, TS-8.7, TS-8.8,
 *            TS-9.1, TS-9.2, TS-9.3
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from "vitest";
import { Hono } from "hono";
import { withEnv } from "../helpers/env.js";
import { createClassificationJSON } from "../helpers/mock-llm.js";
import { createMockContext } from "../helpers/mock-telegram.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Factories ────────────────────────────────────────────────────

function createMockCalendarConfig(overrides: Record<string, unknown> = {}) {
  return {
    calendarId: "test@group.calendar.google.com",
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    defaultDuration: 60,
    ...overrides,
  };
}

function createCalendarEventParams(overrides: Record<string, unknown> = {}) {
  return {
    name: "Meeting with Katja",
    content: "Meeting with Katja at the café",
    calendarDate: "2026-04-15",
    calendarTime: "14:00" as string | null,
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

function createGoogleTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    expires_in: 3600,
    token_type: "Bearer",
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
const mockInsertDashboardEntry = vi.fn().mockResolvedValue("uuid-42");
vi.mock("../../src/web/dashboard-queries.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    insertEntry: mockInsertDashboardEntry,
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

// Mock google-calendar module (for handler integration tests TS-1.3–1.6, TS-3.x)
// Core tests (TS-1.1, TS-4.x, TS-5.x, etc.) import the real functions via importOriginal
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
let realCreateCalendarEvent: any;
let realUpdateCalendarEvent: any;
let realDeleteCalendarEvent: any;
let realProcessCalendarEvent: any;
let realRefreshAccessToken: any;
let realResolveCalendarConfig: any;
let realExchangeAuthCode: any;

// Mock MCP queries
const mockInsertMcpEntry = vi.fn().mockResolvedValue({
  id: "uuid-42",
  category: "tasks",
  name: "Meeting",
  confidence: 0.9,
  tags: ["meeting"],
});
vi.mock("../../src/mcp-queries.js", () => ({
  insertMcpEntry: mockInsertMcpEntry,
  searchEntries: vi.fn().mockResolvedValue([]),
  listRecentEntries: vi.fn().mockResolvedValue([]),
  getEntryById: vi.fn().mockResolvedValue(null),
  updateMcpEntry: vi.fn().mockResolvedValue(null),
  softDeleteEntry: vi.fn().mockResolvedValue(undefined),
  getBrainStats: vi.fn().mockResolvedValue({ total: 0, categories: {} }),
}));

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

describe("Google Calendar", () => {
  beforeAll(async () => {
    // Get real implementations (bypassing the mock)
    const real = await vi.importActual<typeof import("../../src/google-calendar.js")>("../../src/google-calendar.js");
    realCreateCalendarEvent = real.createCalendarEvent;
    realUpdateCalendarEvent = real.updateCalendarEvent;
    realDeleteCalendarEvent = real.deleteCalendarEvent;
    realProcessCalendarEvent = real.processCalendarEvent;
    realRefreshAccessToken = real.refreshAccessToken;
    realResolveCalendarConfig = real.resolveCalendarConfig;
    realExchangeAuthCode = real.exchangeAuthCode;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchFn.mockReset();
    mockClassifyText.mockReset();
    mockAssembleContext.mockResolvedValue([]);
    mockEmbedEntry.mockResolvedValue(undefined);
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

  // ─── Group 1: Event Creation ───────────────────────────────────

  describe("Event Creation", () => {
    it("TS-1.1: creates timed calendar event with date and time", async () => {
      const createCalendarEvent = realCreateCalendarEvent;

      const config = createMockCalendarConfig();
      const params = createCalendarEventParams({ calendarTime: "14:00" });
      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await createCalendarEvent(config, params);

      expect(mockFetchFn).toHaveBeenCalledOnce();
      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain("googleapis.com/calendar/v3");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.summary).toBe("Meeting with Katja");
      expect(body.description).toBe("Meeting with Katja at the café");
      expect(body.start.dateTime).toContain("T14:00");
      expect(body.end.dateTime).toBeDefined();
      expect(result.id).toBe("google-event-123");
    });

    it("TS-1.2: creates all-day calendar event when no time", async () => {
      const createCalendarEvent = realCreateCalendarEvent;

      const config = createMockCalendarConfig();
      const params = createCalendarEventParams({ calendarTime: null });
      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await createCalendarEvent(config, params);

      expect(mockFetchFn).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetchFn.mock.calls[0][1].body);
      expect(body.start.date).toBe("2026-04-15");
      expect(body.end.date).toBe("2026-04-16");
      expect(body.start.dateTime).toBeUndefined();
      expect(result.id).toBe("google-event-123");
    });

    it("TS-1.3: Telegram text handler triggers calendar creation", async () => {
      const restore = withEnv({ TELEGRAM_CHAT_ID: "123456" });
      try {
        const { handleTextMessage } = await import("../../src/telegram.js");

        const classResult = {
          category: "tasks",
          name: "Meeting",
          confidence: 0.9,
          fields: {},
          tags: ["meeting"],
          create_calendar_event: true,
          calendar_date: "2026-04-15",
          calendar_time: "14:00",
          content: "Meeting tomorrow at 2pm",
        };
        mockClassifyText.mockResolvedValueOnce(classResult);

        const { ctx } = createMockContext({
          chatId: 123456,
          text: "Meeting tomorrow at 2pm",
        });

        await handleTextMessage(ctx, mockSql);

        expect(mockProcessCalendarEvent).toHaveBeenCalledWith(
          mockSql,
          expect.any(String),
          expect.objectContaining({
            create_calendar_event: true,
            calendar_date: "2026-04-15",
          }),
        );
      } finally {
        restore();
      }
    });

    it("TS-1.4: Telegram voice handler triggers calendar creation", async () => {
      const restore = withEnv({ TELEGRAM_CHAT_ID: "123456" });
      try {
      const { handleVoiceMessage } = await import("../../src/telegram.js");

      const classResult = {
        category: "tasks",
        name: "Doctor appointment",
        confidence: 0.9,
        fields: {},
        tags: ["health"],
        create_calendar_event: true,
        calendar_date: "2026-04-20",
        calendar_time: "10:00",
        content: "Doctor appointment next Monday at 10",
      };
      mockClassifyText.mockResolvedValueOnce(classResult);

      // Mock fetch for whisper transcription
      mockFetchFn
        .mockResolvedValueOnce(new Response(Buffer.from("audio"))) // download
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ text: "Doctor appointment next Monday at 10" })),
        ); // whisper

      const { ctx } = createMockContext({
        chatId: 123456,
        voice: { file_id: "voice123", duration: 5 },
      });

      // Mock bot.api.getFile
      (ctx as any).api = {
        getFile: vi.fn().mockResolvedValue({
          file_path: "voice/file_0.oga",
        }),
      };

      await handleVoiceMessage(ctx, mockSql);

      expect(mockProcessCalendarEvent).toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it("TS-1.5: web dashboard capture triggers calendar creation", async () => {
      mockClassifyText.mockResolvedValueOnce({
        category: "tasks",
        name: "Deadline",
        confidence: 0.9,
        fields: {},
        tags: [],
        create_calendar_event: true,
        calendar_date: "2026-04-30",
        calendar_time: null,
        content: "Project deadline April 30",
      });

      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
      const { createDashboardRoutes } = await import("../../src/web/dashboard.js");
      const { createSSEBroadcaster } = await import("../../src/web/sse.js");

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      app.route("/", createDashboardRoutes(mockSql, createSSEBroadcaster()));

      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/", {
        method: "POST",
        body: new URLSearchParams({ note: "Project deadline April 30" }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      expect(mockProcessCalendarEvent).toHaveBeenCalled();
    });

    it("TS-1.6: MCP add_thought triggers calendar creation", async () => {
      const processCalendarEvent = realProcessCalendarEvent;
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      mockClassifyText.mockResolvedValueOnce({
        category: "tasks",
        name: "Standup",
        confidence: 0.92,
        fields: {},
        tags: ["work"],
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: "09:00",
        content: "Daily standup at 9am",
      });

      await handleAddThought(mockSql, { text: "Daily standup at 9am" });

      expect(mockProcessCalendarEvent).toHaveBeenCalled();
    });

    it("TS-1.7: skips calendar when create_calendar_event is false", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      const classResult = {
        create_calendar_event: false,
        calendar_date: null,
        calendar_time: null,
      };

      const result = await processCalendarEvent(mockSql, "uuid-42", classResult);

      expect(mockFetchFn).not.toHaveBeenCalled();
      expect(result.created).toBe(false);
    });
  });

  // ─── Group 2: OAuth Settings ───────────────────────────────────

  describe("OAuth Settings", () => {
    it("TS-2.1: settings page displays Google Calendar section", async () => {
      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
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

      expect(html).toContain("Google Calendar");
      expect(html).toMatch(/google_calendar_id|calendar.id|Calendar ID/i);
      expect(html).toMatch(/duration|Duration/i);
    });

    it("TS-2.2: connect button generates OAuth consent URL", async () => {
      const restore = withEnv({
        GOOGLE_CLIENT_ID: "test-client-id-123",
      });

      try {
        const { createAuthMiddleware, createAuthRoutes } = await import(
          "../../src/web/auth.js"
        );
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

        expect(html).toContain("accounts.google.com");
        expect(html).toContain("test-client-id-123");
        expect(html).toContain("calendar");
      } finally {
        restore();
      }
    });

    it("TS-2.5: not connected status when no tokens", async () => {
      mockGetAllSettings.mockResolvedValue({});

      const restore = withEnv({
        GOOGLE_REFRESH_TOKEN: undefined,
      });

      try {
        const { createAuthMiddleware, createAuthRoutes } = await import(
          "../../src/web/auth.js"
        );
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

        expect(html).toMatch(/not connected|Not Connected/i);
        expect(html).toMatch(/connect.*google.*calendar|Connect/i);
      } finally {
        restore();
      }
    });

    it("TS-2.7: env var provides fallback calendar ID", async () => {
      const restore = withEnv({
        GOOGLE_CALENDAR_ID: "env@group.calendar.google.com",
      });

      try {
        const resolveCalendarConfig = realResolveCalendarConfig;
        mockGetAllSettings.mockResolvedValue({});

        const config = await resolveCalendarConfig(mockSql);

        expect(config.calendarId).toBe("env@group.calendar.google.com");
      } finally {
        restore();
      }
    });

    it("TS-2.8: settings table value overrides env var", async () => {
      const restore = withEnv({
        GOOGLE_CALENDAR_ID: "env@group.calendar.google.com",
      });

      try {
        const resolveCalendarConfig = realResolveCalendarConfig;
        mockGetAllSettings.mockResolvedValue({
          google_calendar_id: "settings@group.calendar.google.com",
        });

        const config = await resolveCalendarConfig(mockSql);

        expect(config.calendarId).toBe("settings@group.calendar.google.com");
      } finally {
        restore();
      }
    });
  });

  // ─── Group 3: Confirmation Messages ────────────────────────────

  describe("Confirmation Messages", () => {
    it("TS-3.1: Telegram reply includes calendar confirmation", async () => {
      const restore = withEnv({ TELEGRAM_CHAT_ID: "123456" });
      try {
      const { handleTextMessage } = await import("../../src/telegram.js");

      mockClassifyText.mockResolvedValueOnce({
        category: "tasks",
        name: "Meeting",
        confidence: 0.9,
        fields: {},
        tags: [],
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: "14:00",
        content: "Meeting at 2pm",
      });

      mockProcessCalendarEvent.mockResolvedValueOnce({
        created: true,
        eventId: "google-event-123",
        date: "2026-04-15",
      } as any);

      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        text: "Meeting at 2pm on April 15",
      });

      await handleTextMessage(ctx, mockSql);

      const replyCall = mocks.reply.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && call[0].includes("📅"),
      );
      expect(replyCall).toBeDefined();
      expect(replyCall![0]).toContain("2026-04-15");
      } finally {
        restore();
      }
    });

    it("TS-3.2: web capture response includes calendar confirmation", async () => {
      mockClassifyText.mockResolvedValueOnce({
        category: "tasks",
        name: "Deadline",
        confidence: 0.9,
        fields: {},
        tags: [],
        create_calendar_event: true,
        calendar_date: "2026-04-30",
        calendar_time: null,
        content: "Project deadline",
      });

      mockProcessCalendarEvent.mockResolvedValueOnce({
        created: true,
        eventId: "google-event-456",
      } as any);

      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
      const { createDashboardRoutes } = await import("../../src/web/dashboard.js");
      const { createSSEBroadcaster } = await import("../../src/web/sse.js");

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      app.route("/", createDashboardRoutes(mockSql, createSSEBroadcaster()));

      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/", {
        method: "POST",
        body: new URLSearchParams({ note: "Project deadline" }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });
      const html = await res.text();

      expect(html).toMatch(/calendar|📅/i);
    });

    it("TS-3.3: MCP result includes calendar confirmation", async () => {
      const processCalendarEvent = realProcessCalendarEvent;
      const { handleAddThought } = await import("../../src/mcp-tools.js");

      mockClassifyText.mockResolvedValueOnce({
        category: "tasks",
        name: "Review",
        confidence: 0.9,
        fields: {},
        tags: [],
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
        content: "Code review Friday",
      });

      mockProcessCalendarEvent.mockResolvedValueOnce({
        created: true,
        eventId: "google-event-789",
      } as any);

      const result = await handleAddThought(mockSql, { text: "Code review Friday" });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toMatch(/calendar|📅/i);
    });
  });

  // ─── Group 4: Failure Handling ─────────────────────────────────

  describe("Failure Handling", () => {
    it("TS-4.1: entry saved when calendar API fails", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      // Configure as if calendar is configured
      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      mockFetchFn.mockRejectedValue(new Error("Network error"));

      const classResult = {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      };

      const result = await processCalendarEvent(mockSql, "uuid-42", classResult);

      // Should not throw — entry is already saved by caller
      expect(result.created).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("TS-4.2: token refresh and retry on 401", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "expired-token",
        google_calendar_id: "test@group.calendar.google.com",
        google_client_id: "test-client-id",
        google_client_secret: "test-client-secret",
      });

      // First call: 401 (expired token)
      // Second call: token refresh succeeds
      // Third call: calendar API succeeds with new token
      mockFetchFn
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleTokenResponse()), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
        );

      const result = await processCalendarEvent(mockSql, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      });

      expect(mockFetchFn).toHaveBeenCalledTimes(3);
      expect(result.created).toBe(true);
    });

    it("TS-4.3: retry on server error", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      // First call: 500 server error
      // Second call: success
      mockFetchFn
        .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
        );

      const result = await processCalendarEvent(mockSql, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      });

      expect(mockFetchFn).toHaveBeenCalledTimes(2);
      expect(result.created).toBe(true);
    });

    it("TS-4.4: failure notification after retry exhausted", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      // Both attempts fail
      mockFetchFn
        .mockResolvedValueOnce(new Response("Error", { status: 500 }))
        .mockResolvedValueOnce(new Response("Error", { status: 500 }));

      const result = await processCalendarEvent(mockSql, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      });

      expect(result.created).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("TS-4.5: new refresh token stored after refresh", async () => {
      const refreshAccessToken = realRefreshAccessToken;

      const tokenResponse = createGoogleTokenResponse({
        access_token: "brand-new-access",
        refresh_token: "brand-new-refresh",
      });
      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(tokenResponse), { status: 200 }),
      );

      const result = await refreshAccessToken(
        "old-refresh-token",
        "test-client-id",
        "test-client-secret",
      );

      expect(result.accessToken).toBe("brand-new-access");
      expect(result.refreshToken).toBe("brand-new-refresh");
    });
  });

  // ─── Group 5: Reclassification ─────────────────────────────────

  describe("Reclassification", () => {
    it("TS-5.1: updates existing calendar event on reclassification", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      // Mock entry with existing calendar event
      const mockSqlWithEntry = vi.fn().mockResolvedValue([
        { id: "uuid-42", google_calendar_event_id: "event123" },
      ]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "event123" })), {
          status: 200,
        }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: null,
      });

      // Should use PATCH/PUT to update, not POST to create
      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain("event123");
      expect(options.method).toMatch(/PATCH|PUT/);
      expect(result.created).toBeTruthy();
    });

    it("TS-5.2: deletes event when reclassified to no-calendar", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      const mockSqlWithEntry = vi.fn().mockResolvedValue([
        { id: "uuid-42", google_calendar_event_id: "event123" },
      ]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: false,
        calendar_date: null,
        calendar_time: null,
      });

      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain("event123");
      expect(options.method).toBe("DELETE");
    });

    it("TS-5.3: creates new event when no prior event", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      const mockSqlWithEntry = vi.fn().mockResolvedValue([
        { id: "uuid-42", google_calendar_event_id: null },
      ]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "new-event-456" })), {
          status: 200,
        }),
      );

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-05-01",
        calendar_time: null,
      });

      const [, options] = mockFetchFn.mock.calls[0];
      expect(options.method).toBe("POST");
      expect(result.eventId).toBe("new-event-456");
    });

    it("TS-5.4: no action when no-calendar and no prior event", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      const mockSqlWithEntry = vi.fn().mockResolvedValue([
        { id: "uuid-42", google_calendar_event_id: null },
      ]) as unknown as any;

      const result = await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: false,
        calendar_date: null,
        calendar_time: null,
      });

      expect(mockFetchFn).not.toHaveBeenCalled();
    });
  });

  // ─── Group 7: Duration Configuration ───────────────────────────

  describe("Duration Configuration", () => {
    it("TS-7.1: settings page displays duration field", async () => {
      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
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

      expect(html).toMatch(/duration|Duration/i);
      expect(html).toMatch(/google_calendar_default_duration/);
    });

    it("TS-7.1b: duration value saved to settings table", async () => {
      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
      const { createSettingsRoutes } = await import("../../src/web/settings.js");

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      app.route("/", createSettingsRoutes(mockSql));

      const cookie = await loginAndGetCookie(app);
      await app.request("/settings", {
        method: "POST",
        body: new URLSearchParams({
          chat_ids: "123456",
          llm_provider: "anthropic",
          llm_model: "claude-sonnet-4-20250514",
          llm_base_url: "",
          apikey_anthropic: "",
          apikey_openai: "",
          apikey_groq: "",
          apikey_gemini: "",
          daily_digest_cron: "30 7 * * *",
          weekly_digest_cron: "0 16 * * 0",
          timezone: "Europe/Berlin",
          confidence_threshold: "0.6",
          digest_email_to: "",
          google_calendar_default_duration: "45",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      expect(mockSaveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          google_calendar_default_duration: "45",
        }),
      );
    });

    it("TS-7.2: duration validation rejects below minimum", async () => {
      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
      const { createSettingsRoutes } = await import("../../src/web/settings.js");

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      app.route("/", createSettingsRoutes(mockSql));

      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/settings", {
        method: "POST",
        body: new URLSearchParams({
          chat_ids: "123456",
          llm_provider: "anthropic",
          llm_model: "claude-sonnet-4-20250514",
          llm_base_url: "",
          apikey_anthropic: "",
          apikey_openai: "",
          apikey_groq: "",
          apikey_gemini: "",
          daily_digest_cron: "30 7 * * *",
          weekly_digest_cron: "0 16 * * 0",
          timezone: "Europe/Berlin",
          confidence_threshold: "0.6",
          digest_email_to: "",
          google_calendar_default_duration: "10",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      // POST redirects with error in query param
      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      expect(location).toMatch(/15|minimum/i);
    });

    it("TS-7.3: duration validation rejects above maximum", async () => {
      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
      const { createSettingsRoutes } = await import("../../src/web/settings.js");

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      app.route("/", createSettingsRoutes(mockSql));

      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/settings", {
        method: "POST",
        body: new URLSearchParams({
          chat_ids: "123456",
          llm_provider: "anthropic",
          llm_model: "claude-sonnet-4-20250514",
          llm_base_url: "",
          apikey_anthropic: "",
          apikey_openai: "",
          apikey_groq: "",
          apikey_gemini: "",
          daily_digest_cron: "30 7 * * *",
          weekly_digest_cron: "0 16 * * 0",
          timezone: "Europe/Berlin",
          confidence_threshold: "0.6",
          digest_email_to: "",
          google_calendar_default_duration: "500",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      expect(location).toMatch(/480|maximum/i);
    });

    it("TS-7.4: default duration is 60 minutes", async () => {
      const resolveCalendarConfig = realResolveCalendarConfig;

      mockGetAllSettings.mockResolvedValue({});

      const config = await resolveCalendarConfig(mockSql);

      expect(config.defaultDuration).toBe(60);
    });

    it("TS-7.5: configured duration applied to timed events", async () => {
      const createCalendarEvent = realCreateCalendarEvent;

      const config = createMockCalendarConfig({ defaultDuration: 30 });
      const params = createCalendarEventParams({
        calendarDate: "2026-04-15",
        calendarTime: "09:00",
      });

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      await createCalendarEvent(config, params);

      const body = JSON.parse(mockFetchFn.mock.calls[0][1].body);
      expect(body.start.dateTime).toContain("T09:00");
      expect(body.end.dateTime).toContain("T09:30");
    });
  });

  // ─── Group 8: Edge Cases ───────────────────────────────────────

  describe("Edge Cases", () => {
    it("TS-8.1: skips creation when calendar_date is null", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      const result = await processCalendarEvent(mockSql, "uuid-42", {
        create_calendar_event: true,
        calendar_date: null,
        calendar_time: null,
      });

      expect(mockFetchFn).not.toHaveBeenCalled();
      expect(result.created).toBe(false);
    });

    it("TS-8.2: creates all-day event when calendar_time has invalid format", async () => {
      const createCalendarEvent = realCreateCalendarEvent;

      const config = createMockCalendarConfig();
      const params = createCalendarEventParams({
        calendarDate: "2026-04-15",
        calendarTime: "afternoon",
      });

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      await createCalendarEvent(config, params);

      const body = JSON.parse(mockFetchFn.mock.calls[0][1].body);
      expect(body.start.date).toBe("2026-04-15");
      expect(body.start.dateTime).toBeUndefined();
    });

    it("TS-8.3: past date still creates event", async () => {
      const createCalendarEvent = realCreateCalendarEvent;

      const config = createMockCalendarConfig();
      const params = createCalendarEventParams({
        calendarDate: "2025-01-01",
        calendarTime: null,
      });

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse()), { status: 200 }),
      );

      const result = await createCalendarEvent(config, params);

      expect(mockFetchFn).toHaveBeenCalledOnce();
      expect(result.id).toBe("google-event-123");
    });

    it("TS-8.7: entry edit updates linked calendar event", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      const mockSqlWithEntry = vi.fn().mockResolvedValue([
        { id: "uuid-42", google_calendar_event_id: "event123" },
      ]) as unknown as any;

      mockFetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify(createGoogleEventResponse({ id: "event123" })), {
          status: 200,
        }),
      );

      await processCalendarEvent(mockSqlWithEntry, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-06-01",
        calendar_time: "15:00",
      });

      const [url, options] = mockFetchFn.mock.calls[0];
      expect(url).toContain("event123");
      expect(options.method).toMatch(/PATCH|PUT/);
      const body = JSON.parse(options.body);
      expect(body.start.dateTime).toContain("T15:00");
    });

    it("TS-8.8: invalid calendar ID returns failure", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "invalid-calendar-id",
      });

      // Both attempts return 404
      mockFetchFn
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
        .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

      const result = await processCalendarEvent(mockSql, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      });

      expect(result.created).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─── Group 9: Constraints ──────────────────────────────────────

  describe("Constraints", () => {
    it("TS-9.1: calendar API call does not block entry storage", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      // processCalendarEvent is called AFTER entry is saved.
      // It should not throw even on failure — it returns a result object.
      mockGetAllSettings.mockResolvedValue({
        google_refresh_token: "test-refresh-token",
        google_access_token: "test-access-token",
        google_calendar_id: "test@group.calendar.google.com",
      });

      mockFetchFn.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(
          new Response("Timeout", { status: 504 }),
        ), 5000)),
      );

      // processCalendarEvent should never throw — it returns a result with error info
      const result = await processCalendarEvent(mockSql, "uuid-42", {
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: null,
      });

      // Must return a result object (not throw), so the caller's entry save is unaffected
      expect(result).toBeDefined();
      expect(result).toHaveProperty("created");
    });

    it("TS-9.2: classification includes calendar_time field", async () => {
      const { validateClassificationResponse } = await import(
        "../../src/classify.js"
      );

      const json = JSON.stringify({
        category: "tasks",
        name: "Meeting at 2pm",
        confidence: 0.9,
        fields: { status: "pending", due_date: "2026-04-15", notes: "" },
        tags: ["meeting"],
        create_calendar_event: true,
        calendar_date: "2026-04-15",
        calendar_time: "14:00",
      });

      const result = validateClassificationResponse(json);

      expect(result).not.toBeNull();
      expect(result!.create_calendar_event).toBe(true);
      expect(result!.calendar_date).toBe("2026-04-15");
      expect((result as any).calendar_time).toBe("14:00");
    });

    it("TS-9.3: feature is inert when not configured", async () => {
      const processCalendarEvent = realProcessCalendarEvent;

      const restore = withEnv({
        GOOGLE_CALENDAR_ID: undefined,
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        GOOGLE_REFRESH_TOKEN: undefined,
      });

      try {
        mockGetAllSettings.mockResolvedValue({});

        const result = await processCalendarEvent(mockSql, "uuid-42", {
          create_calendar_event: true,
          calendar_date: "2026-04-15",
          calendar_time: null,
        });

        expect(mockFetchFn).not.toHaveBeenCalled();
        expect(result.created).toBe(false);
      } finally {
        restore();
      }
    });
  });
});
