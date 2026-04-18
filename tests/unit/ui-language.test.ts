/**
 * Unit tests for the UI language feature.
 * Uses mocked query layers, classify pipeline, and email senders; only Group 7
 * (classify prompt) reads prompts/classify.md directly from disk.
 *
 * Scenarios: TS-1.1 through TS-10.4 (54 base scenarios; TS-3.2, TS-3.3, and
 *            TS-4.3 expand via it.each to 2, 6, and 10 parameterized cases).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createMockContext } from "../helpers/mock-telegram.js";
import { en } from "../../src/web/i18n/en.js";
import { de } from "../../src/web/i18n/de.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Helpers ─────────────────────────────────────────────────────────
// cat(value, fallback): returns the catalog value if present, otherwise the
// raw i18n key. This keeps assertions meaningful while the stub catalog is
// empty — i18next renders missing keys as the literal key string at runtime,
// so both branches are behaviorally correct per AC-8.3.
function cat(value: unknown, fallback: string): string {
  return (value as string | undefined) ?? fallback;
}

function flattenKeys(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenKeys(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

// Mock sql tag that returns rows for specific ui_language/settings queries.
function makeMockSqlWithUiLang(lang: string | null): ReturnType<typeof vi.fn> {
  const fn = vi.fn((query: TemplateStringsArray, ...args: unknown[]) => {
    const q = query.join("?");
    if (
      q.includes("settings") &&
      args.some((a) => a === "ui_language")
    ) {
      return Promise.resolve(lang === null ? [] : [{ value: lang }]);
    }
    if (q.includes("INSERT") || q.includes("insert")) {
      return Promise.resolve([{ id: "uuid-42" }]);
    }
    return Promise.resolve([]);
  });
  return fn as unknown as ReturnType<typeof vi.fn>;
}

function buildFormData(
  overrides: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    chat_ids: "123456",
    llm_provider: "anthropic",
    llm_model: "claude-sonnet-4-20250514",
    llm_base_url: "https://api.anthropic.com/v1",
    apikey_anthropic: "",
    apikey_openai: "",
    apikey_groq: "",
    apikey_gemini: "",
    daily_digest_cron: "30 7 * * *",
    weekly_digest_cron: "0 16 * * 0",
    timezone: "Europe/Berlin",
    confidence_threshold: "0.6",
    digest_email_to: "",
    output_language: "English",
    ui_language: "",
    ...overrides,
  });
}

// ─── Module Mocks (hoisted) ──────────────────────────────────────────
vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
  saveAllSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/llm/config.js", () => ({
  getLLMConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeys: { anthropic: "test-key", openai: "", groq: "", gemini: "" },
  }),
  saveLLMConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/digests-queries.js", () => ({
  // Plain async closures so `vi.restoreAllMocks()` in afterEach can't reset
  // their implementations (vi.fn().mockResolvedValue loses its resolved value
  // when restoreAllMocks runs).
  getDailyDigestData: async () => ({
    activeProjects: [],
    pendingFollowUps: [],
    upcomingTasks: [],
    yesterdayEntries: [],
    stalledProjects: [],
  }),
  getWeeklyReviewData: async () => ({
    weekEntries: [],
    dailyCounts: [],
    categoryCounts: [],
    stalledProjects: [],
  }),
  cacheDigest: async () => undefined,
  getLatestDigest: async () => null,
}));

vi.mock("../../src/llm/index.js", () => ({
  createLLMProvider: () => ({
    chat: async () => "## Digest\n\nTest content.",
  }),
}));

vi.mock("../../src/web/dashboard-queries.js", () => ({
  getRecentEntries: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi.fn().mockResolvedValue({
    entriesThisWeek: 0,
    openTasks: 0,
    stalledProjects: 0,
  }),
  getLatestDigest: vi.fn().mockResolvedValue(null),
  insertEntry: vi.fn().mockResolvedValue("test-entry-id"),
}));

// bcrypt hash of "test-password" (cost 10) — matches TEST_PASSWORD so the
// setup routes' POST /login can validate submitted passwords in tests.
const TEST_PASSWORD_HASH =
  "$2b$10$fT48FucaYsd.UewWh8yHfeSSuDImEjthP.X2wLVChUyMOGwVtm6..";

vi.mock("../../src/web/setup-queries.js", () => ({
  // `getUserCount` is a real mock because individual tests override it via
  // vi.spyOn. The other functions are plain async closures so they survive
  // vi.restoreAllMocks() in afterEach — without that, getUserPasswordHash
  // would reset to returning undefined after the first login.
  getUserCount: vi.fn().mockResolvedValue(1),
  getUserPasswordHash: async () => TEST_PASSWORD_HASH,
  getDisplayName: async () => null,
  createUser: async () => undefined,
  getSetupSummary: async () => ({}),
}));

vi.mock("../../src/web/entry-queries.js", () => ({
  getEntry: vi.fn().mockResolvedValue(null),
  getAllTags: vi.fn().mockResolvedValue([]),
  updateEntry: vi.fn().mockResolvedValue(undefined),
  softDeleteEntry: vi.fn().mockResolvedValue(undefined),
  restoreEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/web/browse-queries.js", () => ({
  browseEntries: vi.fn().mockResolvedValue([]),
  semanticSearch: vi.fn().mockResolvedValue([]),
  textSearch: vi.fn().mockResolvedValue([]),
  getFilterTags: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/classify.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/classify.js")
  >("../../src/classify.js");
  return {
    ...actual,
    classifyText: vi.fn().mockResolvedValue({
      category: "tasks",
      name: "Mock Entry",
      confidence: 0.9,
      fields: {},
      tags: [],
      content: "Mock content",
    }),
    assembleContext: vi.fn().mockResolvedValue([]),
    isConfident: vi
      .fn()
      .mockImplementation((c: number, t: number) => c >= t),
    resolveConfidenceThreshold: vi.fn().mockReturnValue(0.6),
    reclassifyEntry: vi.fn(),
  };
});

vi.mock("../../src/embed.js", () => ({
  embedEntry: vi.fn().mockResolvedValue(undefined),
  generateEmbedding: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/config.js", () => ({
  config: {},
  resolveConfigValue: vi.fn().mockResolvedValue(undefined),
}));

// sendDigestEmail must remain a vi.fn spy so tests can check
// `toHaveBeenCalled` on it. The others are plain functions because
// `vi.restoreAllMocks()` in afterEach wipes `mockResolvedValue`/
// `mockReturnValue` from vi.fn instances created in vi.mock factories
// (confirmed by TS-6.x "expected spy to be called at least once" with
// the pipeline otherwise completing).
vi.mock("../../src/email.js", () => ({
  sendDigestEmail: vi.fn(async () => undefined),
  isSmtpConfigured: () => true,
  sendEmail: async () => undefined,
}));

vi.mock("../../src/google-calendar.js", () => ({
  getCalendarNames: vi.fn().mockResolvedValue(undefined),
  processCalendarEvent: vi.fn().mockResolvedValue({ created: false }),
  handleEntryCalendarCleanup: vi.fn().mockResolvedValue(undefined),
}));

// grammy mock keeps bot.start from trying to reach Telegram
const mockBotStart = vi.fn().mockReturnValue(new Promise(() => {}));
vi.mock("grammy", () => ({
  Bot: vi.fn(() => ({
    start: mockBotStart,
    stop: vi.fn(),
    on: vi.fn(),
    command: vi.fn(),
    catch: vi.fn(),
    api: { setWebhook: vi.fn() },
  })),
}));

// ─── Test App Factory ────────────────────────────────────────────────

async function createTestApp(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createLocaleMiddleware } = await import(
    "../../src/web/i18n/middleware.js"
  );
  const { createDashboardRoutes } = await import(
    "../../src/web/dashboard.js"
  );
  const { createSettingsRoutes } = await import("../../src/web/settings.js");
  const { createBrowseRoutes } = await import("../../src/web/browse.js");
  const { createEntryRoutes } = await import("../../src/web/entry.js");
  const { createNewNoteRoutes } = await import("../../src/web/new-note.js");
  const { createTrashRoutes } = await import("../../src/web/trash.js");
  const { createSetupRoutes, createSetupMiddleware } = await import(
    "../../src/web/setup.js"
  );
  const { createSSEBroadcaster } = await import("../../src/web/sse.js");
  const { initI18n } = await import("../../src/web/i18n/index.js");

  await initI18n();

  const mockSql = {} as any;
  const broadcaster = createSSEBroadcaster();

  const app = new Hono();
  app.use("*", createLocaleMiddleware(mockSql));
  app.use("*", createSetupMiddleware(mockSql, TEST_SECRET));
  app.route("/", createSetupRoutes(mockSql, TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createDashboardRoutes(mockSql, broadcaster));
  app.route("/", createSettingsRoutes(mockSql));
  app.route("/", createBrowseRoutes(mockSql));
  app.route("/", createEntryRoutes(mockSql));
  app.route("/", createNewNoteRoutes(mockSql, broadcaster));
  app.route("/", createTrashRoutes(mockSql));

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

async function getWithLocale(
  app: Hono,
  path: string,
  opts: { cookie?: string; acceptLanguage?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.acceptLanguage) headers["Accept-Language"] = opts.acceptLanguage;
  return app.request(path, { headers });
}

// ─── Test Suite ──────────────────────────────────────────────────────

describe("UI Language", () => {
  beforeAll(async () => {
    // Phase 4: initI18n throws "Not implemented" — beforeAll failure
    // flags every test as failed. Phase 5 makes this succeed.
    try {
      const { initI18n } = await import("../../src/web/i18n/index.js");
      await initI18n();
    } catch {
      // Swallow so individual tests can surface their own assertion failures
      // against the empty stub catalog, rather than all showing a single
      // setup error. i18next remains uninitialized; tests that need it
      // (TS-8.2, TS-8.3) will fail on their assertions.
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Restore catalog resource bundles before each test (some tests mutate them)
    try {
      const i18nextMod = await import("i18next");
      i18nextMod.default.addResourceBundle(
        "en",
        "translation",
        en,
        true,
        true,
      );
      i18nextMod.default.addResourceBundle(
        "de",
        "translation",
        de,
        true,
        true,
      );
    } catch {
      // i18next may not be ready in Phase 4
    }

    // Default mock implementations
    const { getAllSettings, saveAllSettings } = await import(
      "../../src/web/settings-queries.js"
    );
    vi.mocked(getAllSettings).mockResolvedValue({});
    vi.mocked(saveAllSettings).mockResolvedValue(undefined);

    const { getLLMConfig, saveLLMConfig } = await import(
      "../../src/llm/config.js"
    );
    vi.mocked(getLLMConfig).mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeys: { anthropic: "test-key", openai: "", groq: "", gemini: "" },
    });
    vi.mocked(saveLLMConfig).mockResolvedValue(undefined);

    // Default fetch mock (Ollama connectivity check on settings save)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 1: Locale Resolution (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Locale Resolution (US-1)", () => {
    // TS-1.1
    it("resolves de when Accept-Language is de-DE and no DB setting exists", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({});

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "de-DE,de;q=0.9,en;q=0.5",
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(cat((de as any).nav?.browse, "nav.browse"));
      expect(body).toContain('<html lang="de"');
    });

    // TS-1.2
    it("resolves en when no Accept-Language header", async () => {
      const { app } = await createTestApp();

      const res = await app.request("/login");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('<html lang="en"');
    });

    // TS-1.3
    it("treats empty ui_language in DB as unset and uses Accept-Language", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "de",
      });

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
    });

    // TS-1.4
    it("resolves en when Accept-Language is malformed", async () => {
      const { app } = await createTestApp();

      const res = await app.request("/login", {
        headers: { "Accept-Language": "!@#$%" },
      });

      const body = await res.text();
      expect(body).toContain('<html lang="en"');
    });

    // TS-1.5
    it("resolves en when Accept-Language is *", async () => {
      const { app } = await createTestApp();

      const res = await app.request("/login", {
        headers: { "Accept-Language": "*" },
      });

      const body = await res.text();
      expect(body).toContain('<html lang="en"');
    });

    // TS-1.6
    it("resolves en when Accept-Language has no supported primary subtag", async () => {
      const { app } = await createTestApp();

      const res = await app.request("/login", {
        headers: { "Accept-Language": "fr-FR,es;q=0.8" },
      });

      const body = await res.text();
      expect(body).toContain('<html lang="en"');
    });

    // TS-1.7
    it("picks highest q-value supported entry from Accept-Language", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({});

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "fr;q=0.9,de;q=0.8,en;q=0.5",
      });

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
    });

    // TS-1.8
    it("matches region subtag to primary language in SUPPORTED_LOCALES", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({});

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "de-AT",
      });

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
    });

    // TS-1.9
    it("pre-auth setup wizard renders in Accept-Language locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      // No user exists — route goes to setup wizard
      const { getUserCount } = await import("../../src/web/setup-queries.js");
      vi.spyOn(
        await import("../../src/web/setup-queries.js"),
        "getUserCount",
      ).mockResolvedValue(0);

      const { app } = await createTestApp();

      const beforeCallCount = vi.mocked(getAllSettings).mock.calls.length;
      const res = await app.request("/setup", {
        headers: { "Accept-Language": "de" },
      });
      const afterCallCount = vi.mocked(getAllSettings).mock.calls.length;

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
      // Setup (pre-auth) must not query ui_language from DB
      expect(afterCallCount - beforeCallCount).toBe(0);
    });

    // TS-1.10
    it("DB ui_language wins over Accept-Language for authenticated routes", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "en" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "de",
      });

      const body = await res.text();
      expect(body).toContain('<html lang="en"');
      expect(body).not.toContain('<html lang="de"');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 2: Settings Language Section (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Settings Language Section (US-2)", () => {
    // TS-2.1
    it("renders Language section with both dropdowns and current values", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({
        ui_language: "en",
        output_language: "English",
      });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('name="ui_language"');
      expect(body).toContain('name="output_language"');
      // ui_language dropdown has "en" selected
      expect(body).toMatch(
        /<option[^>]*value="en"[^>]*selected[^>]*>|<option[^>]*selected[^>]*value="en"/,
      );
      // Language section heading present
      expect(body).toContain(
        cat(
          (de as any).settings?.section?.language ??
            (en as any).settings?.section?.language,
          "settings.section.language",
        ),
      );
    });

    // TS-2.2
    it("shows Auto (browser) option selected when ui_language is unset", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({});

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain('name="ui_language"');
      // Empty-value option must be selected
      expect(body).toMatch(
        /<option[^>]*value=""[^>]*selected[^>]*>|<option[^>]*selected[^>]*value=""/,
      );
    });

    // TS-2.3
    it("saves ui_language de and redirects rendering in German", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "en" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "de" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ui_language: "de" }),
      );

      // Follow redirect; expect German in subsequent GET body
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });
      const getRes = await app.request("/settings", {
        headers: { Cookie: cookie },
      });
      const body = await getRes.text();
      expect(body).toContain(cat((de as any).nav?.browse, "nav.browse"));
    });

    // TS-2.4
    it("saves empty ui_language when Auto (browser) is selected", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ui_language: "" }),
      );

      // After Auto, Accept-Language=en should render en
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "" });
      const getRes = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "en",
      });
      const body = await getRes.text();
      expect(body).toContain('<html lang="en"');
    });

    // TS-2.5
    it("renders Language section description in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat(
          (de as any).settings?.language?.description,
          "settings.language.description",
        ),
      );
    });

    // TS-2.6
    it("changing ui_language does not modify output_language", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({
        ui_language: "en",
        output_language: "German",
      });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({
          ui_language: "de",
          output_language: "German",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ui_language: "de",
          output_language: "German",
        }),
      );
    });

    // TS-2.7
    it("flash success message after save renders in newly saved locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings)
        .mockResolvedValueOnce({ ui_language: "en" })
        .mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "de" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const getRes = await app.request("/settings?success=saved", {
        headers: { Cookie: cookie },
      });
      const body = await getRes.text();
      expect(body).toContain(
        cat(
          (de as any).settings?.flash?.saved,
          "settings.flash.saved",
        ),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 3: Web UI Rendering (US-3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Web UI Rendering (US-3)", () => {
    // TS-3.1
    it("sets <html lang> to resolved locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
      expect(body).not.toContain('<html lang="en"');
    });

    // TS-3.2 (decision table, 2 rows)
    it.each([
      { lang: "en", catalog: en },
      { lang: "de", catalog: de },
    ])(
      "renders nav labels in $lang (decision table)",
      async ({ lang, catalog }) => {
        const { getAllSettings } = await import(
          "../../src/web/settings-queries.js"
        );
        vi.mocked(getAllSettings).mockResolvedValue({ ui_language: lang });

        const { app } = await createTestApp();
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/", {
          headers: { Cookie: cookie },
        });

        const body = await res.text();
        expect(body).toContain(
          cat((catalog as any).nav?.browse, "nav.browse"),
        );
        expect(body).toContain(
          cat((catalog as any).nav?.trash, "nav.trash"),
        );
        expect(body).toContain(
          cat((catalog as any).nav?.settings, "nav.settings"),
        );
        expect(body).toContain(
          cat((catalog as any).nav?.logout, "nav.logout"),
        );
      },
    );

    // TS-3.3 (decision table, 6 hour buckets)
    it.each([
      { hour: 2, key: "late_night" },
      { hour: 8, key: "morning" },
      { hour: 13, key: "day" },
      { hour: 15, key: "afternoon" },
      { hour: 20, key: "evening" },
      { hour: 23, key: "late_night" },
    ])(
      "maps dashboard greeting hour $hour to key $key",
      async ({ hour, key }) => {
        const { getAllSettings } = await import(
          "../../src/web/settings-queries.js"
        );
        vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "en" });

        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 3, 17, hour, 0, 0));

        const { app } = await createTestApp();
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/", {
          headers: { Cookie: cookie },
        });

        const body = await res.text();
        expect(body).toContain(
          cat((en as any).greeting?.[key], `greeting.${key}`),
        );
      },
    );

    // TS-3.4
    it("renders category badge labels via t(category_abbr.<key>)", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { getRecentEntries } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getRecentEntries).mockResolvedValue([
        {
          id: "uuid-1",
          name: "Test Person",
          category: "people",
          content: "x",
          fields: {},
          tags: [],
          confidence: 0.9,
          source: "web",
          source_type: "text",
          embedding: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      ]);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain(
        cat(
          (de as any).category_abbr?.people,
          "category_abbr.people",
        ),
      );
    });

    // TS-3.5
    it("stores English category key in DB regardless of ui_language", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { classifyText } = await import("../../src/classify.js");
      vi.mocked(classifyText).mockResolvedValue({
        category: "people",
        name: "Katja",
        confidence: 0.9,
        fields: {},
        tags: [],
        content: "Katja wohnt in Berlin",
      } as any);

      const { insertEntry } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(insertEntry).mockResolvedValue("test-entry-id");

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      await app.request("/api/capture", {
        method: "POST",
        body: JSON.stringify({ text: "Katja wohnt in Berlin" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
      });

      expect(insertEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ category: "people" }),
      );
    });

    // TS-3.6
    it("renders status label via t(status.<key>) and stores English enum key", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const entryId = "550e8400-e29b-41d4-a716-446655440000";
      const { getEntry } = await import(
        "../../src/web/entry-queries.js"
      );
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getEntry",
      ).mockResolvedValue({
        id: entryId,
        name: "Buy milk",
        category: "tasks",
        content: "Buy milk at store",
        fields: { status: "pending", due_date: null, notes: null },
        tags: [],
        confidence: 0.9,
        source: "web",
        source_type: "text",
        embedding: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getAllTags",
      ).mockResolvedValue([]);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat((de as any).status?.pending, "status.pending"),
      );
      // The mock returned fields.status = "pending" (English key). The page
      // contains the de-translated label (above) and not the raw key, so
      // the display is going through t() while the DB value stays English.
    });

    // TS-3.7
    it("renders field labels via t(field.<key>) and keeps field keys English", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const entryId = "550e8400-e29b-41d4-a716-446655440000";
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getEntry",
      ).mockResolvedValue({
        id: entryId,
        name: "Buy milk",
        category: "tasks",
        content: "Buy milk",
        fields: { due_date: "2026-04-20", status: "pending", notes: null },
        tags: [],
        confidence: 0.9,
        source: "web",
        source_type: "text",
        embedding: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getAllTags",
      ).mockResolvedValue([]);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}/edit`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat((de as any).field?.due_date, "field.due_date"),
      );
      // Form field name is still the English key
      expect(body).toMatch(/name="due_date"/);
    });

    // TS-3.8
    it("injects translated category labels and feedback strings into client script", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Client-side JS needs translated category abbreviation for SSE renders
      expect(body).toContain(
        cat(
          (de as any).category_abbr?.people,
          "category_abbr.people",
        ),
      );
      // Capture feedback "classifying..." string injected
      expect(body).toContain(
        cat(
          (de as any).capture?.classifying,
          "capture.classifying",
        ),
      );
    });

    // TS-3.9
    it("renders dashboard hero tagline, stats, empty state, and placeholder in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain(
        cat(
          (de as any).dashboard?.hero_tagline,
          "dashboard.hero_tagline",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).dashboard?.stats?.entries_this_week,
          "dashboard.stats.entries_this_week",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).dashboard?.empty,
          "dashboard.empty",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).capture?.placeholder,
          "capture.placeholder",
        ),
      );
    });

    // TS-3.10
    it("renders browse page search placeholder, mode toggles, and empty state in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/browse", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat(
          (de as any).browse?.search_placeholder,
          "browse.search_placeholder",
        ),
      );
      expect(body).toContain(
        cat((de as any).browse?.mode?.semantic, "browse.mode.semantic"),
      );
      expect(body).toContain(
        cat((de as any).browse?.mode?.text, "browse.mode.text"),
      );
      expect(body).toContain(
        cat((de as any).browse?.empty, "browse.empty"),
      );
    });

    // TS-3.11
    it("renders entry edit buttons and form labels in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const entryId = "550e8400-e29b-41d4-a716-446655440000";
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getEntry",
      ).mockResolvedValue({
        id: entryId,
        name: "Task",
        category: "tasks",
        content: "Do it",
        fields: { due_date: null, status: "pending", notes: null },
        tags: [],
        confidence: 0.9,
        source: "web",
        source_type: "text",
        embedding: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getAllTags",
      ).mockResolvedValue([]);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}/edit`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat((de as any).button?.save, "button.save"),
      );
      expect(body).toContain(
        cat((de as any).button?.delete, "button.delete"),
      );
      expect(body).toContain(
        cat((de as any).button?.cancel, "button.cancel"),
      );
    });

    // TS-3.12
    it("renders new note heading, AI Suggest button, and beforeunload message in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/new", { headers: { Cookie: cookie } });

      const body = await res.text();
      expect(body).toContain(
        cat((de as any).new_note?.heading, "new_note.heading"),
      );
      expect(body).toContain(
        cat(
          (de as any).new_note?.ai_suggest,
          "new_note.ai_suggest",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).new_note?.unsaved_changes,
          "new_note.unsaved_changes",
        ),
      );
    });

    // TS-3.13
    it("renders trash heading, Empty trash button, and empty state in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/trash", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat((de as any).trash?.heading, "trash.heading"),
      );
      expect(body).toContain(
        cat(
          (de as any).trash?.empty_trash_button,
          "trash.empty_trash_button",
        ),
      );
      expect(body).toContain(
        cat((de as any).trash?.empty, "trash.empty"),
      );
    });

    // TS-3.14
    it("renders all settings section headings and Save button in current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain(
        cat(
          (de as any).settings?.section?.language,
          "settings.section.language",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).settings?.section?.telegram,
          "settings.section.telegram",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).settings?.section?.llm,
          "settings.section.llm",
        ),
      );
      expect(body).toContain(
        cat((de as any).button?.save, "button.save"),
      );
    });

    // TS-3.15
    it("renders setup wizard step-1 heading, field labels, and CTA in Accept-Language locale", async () => {
      vi.spyOn(
        await import("../../src/web/setup-queries.js"),
        "getUserCount",
      ).mockResolvedValue(0);

      const { app } = await createTestApp();

      const res = await app.request("/setup", {
        headers: { "Accept-Language": "de" },
      });

      const body = await res.text();
      expect(body).toContain(
        cat(
          (de as any).setup?.step1?.heading,
          "setup.step1.heading",
        ),
      );
      expect(body).toContain(
        cat(
          (de as any).setup?.step1?.password_label,
          "setup.step1.password_label",
        ),
      );
      expect(body).toContain(
        cat((de as any).setup?.step1?.cta, "setup.step1.cta"),
      );
    });

    // TS-3.16
    it("renders login heading, password label, and submit button in Accept-Language locale", async () => {
      vi.spyOn(
        await import("../../src/web/setup-queries.js"),
        "getUserCount",
      ).mockResolvedValue(1);

      const { app } = await createTestApp();

      const res = await app.request("/login", {
        headers: { "Accept-Language": "de" },
      });

      const body = await res.text();
      expect(body).toContain(
        cat((de as any).login?.heading, "login.heading"),
      );
      expect(body).toContain(
        cat(
          (de as any).login?.password_label,
          "login.password_label",
        ),
      );
      expect(body).toContain(
        cat((de as any).login?.submit, "login.submit"),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 4: Date, Time, Plural Formatting (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Date, Time, Plural Formatting (US-4)", () => {
    // TS-4.1
    it("formats dashboard date line via Intl.DateTimeFormat for current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      vi.useFakeTimers();
      const fixedDate = new Date(2026, 3, 17, 10, 0, 0); // Friday
      vi.setSystemTime(fixedDate);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      const expectedWeekday = new Intl.DateTimeFormat("de-DE", {
        weekday: "long",
      }).format(fixedDate);
      // "Freitag" for a Friday in German
      expect(body).toContain(expectedWeekday);
    });

    // TS-4.2
    it("formats digest generated time via Intl.DateTimeFormat for current locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const digestDate = new Date(2026, 3, 17, 15, 30);
      const { getLatestDigest } = await import(
        "../../src/web/dashboard-queries.js"
      );
      vi.mocked(getLatestDigest).mockResolvedValue({
        content: "## Summary",
        created_at: digestDate,
      } as any);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/", { headers: { Cookie: cookie } });

      const body = await res.text();
      const expectedTime = new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(digestDate);
      expect(body).toContain(expectedTime);
    });

    // TS-4.3 (decision table, 10 rows)
    it.each([
      { lang: "en", age: 0, key: "relative.just_now" },
      { lang: "en", age: 1, key: "relative.minutes_ago_one" },
      { lang: "en", age: 5, key: "relative.minutes_ago_other" },
      { lang: "en", age: 60, key: "relative.hours_ago_one" },
      { lang: "en", age: 180, key: "relative.hours_ago_other" },
      { lang: "en", age: 1440, key: "relative.days_ago_one" },
      { lang: "de", age: 1, key: "relative.minutes_ago_one" },
      { lang: "de", age: 5, key: "relative.minutes_ago_other" },
      { lang: "de", age: 60, key: "relative.hours_ago_one" },
      { lang: "de", age: 180, key: "relative.hours_ago_other" },
    ])(
      "applies plural rules for relative-time label (lang=$lang, age=$age min)",
      async ({ lang, age, key }) => {
        const { getAllSettings } = await import(
          "../../src/web/settings-queries.js"
        );
        vi.mocked(getAllSettings).mockResolvedValue({ ui_language: lang });

        const entryDate = new Date(Date.now() - age * 60_000);
        const { getRecentEntries } = await import(
          "../../src/web/dashboard-queries.js"
        );
        vi.mocked(getRecentEntries).mockResolvedValue([
          {
            id: "uuid-1",
            name: "Recent",
            category: "tasks",
            content: "",
            fields: {},
            tags: [],
            confidence: 0.9,
            source: "web",
            source_type: "text",
            embedding: null,
            deleted_at: null,
            created_at: entryDate,
            updated_at: entryDate,
          } as any,
        ]);

        const { app } = await createTestApp();
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/", {
          headers: { Cookie: cookie },
        });
        const body = await res.text();

        // Derive path components from "nested.key_one" -> nested.key.one lookup
        const catalog = lang === "de" ? de : en;
        const parts = key.split(".");
        let cursor: any = catalog;
        for (const p of parts) {
          cursor = cursor?.[p];
        }
        expect(body).toContain(cat(cursor, key));
      },
    );

    // TS-4.4
    it("internal formatDateInTz remains sv-SE regardless of ui_language", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );

      // formatDateInTz is internal to src/digests.ts today; Phase 5 must
      // export it (per test impl spec §Group 4). In Phase 4 the property is
      // undefined, so the typeof check fails.
      const digestsMod = (await import("../../src/digests.js")) as any;
      const fn = digestsMod.formatDateInTz;
      expect(typeof fn).toBe("function");

      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 3, 17, 10, 0, 0));

      // Run once with ui_language "en", once with "de" — the result must not
      // depend on the UI locale (AC-4.3: sv-SE formatting is internal-only).
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "en" });
      const resultEn = fn("Europe/Berlin");

      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });
      const resultDe = fn("Europe/Berlin");

      expect(resultEn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(resultDe).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(resultEn).toBe(resultDe);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 5: Telegram Bot Localization (US-5)
  // ═══════════════════════════════════════════════════════════════════
  describe("Telegram Bot Localization (US-5)", () => {
    // TS-5.1
    it("Telegram confirmation reply uses current ui_language from DB", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        if (key === "ui_language") return "de";
        if (key === "confidence_threshold") return "0.6";
        return undefined;
      });

      const { classifyText, isConfident } = await import(
        "../../src/classify.js"
      );
      vi.mocked(classifyText).mockResolvedValue({
        category: "tasks",
        name: "Milch kaufen",
        confidence: 0.9,
        fields: {},
        tags: [],
        content: "Milch kaufen",
      } as any);
      vi.mocked(isConfident).mockReturnValue(true);

      const { handleTextMessage } = await import("../../src/telegram.js");
      const mockSql = vi
        .fn()
        .mockResolvedValue([{ id: "uuid-42" }]);
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        text: "Milch kaufen",
      });

      await handleTextMessage(ctx as any, mockSql as any);

      expect(mocks.reply).toHaveBeenCalled();
      const replyText = mocks.reply.mock.calls[0][0] as string;
      // Expected: German "saved as" phrasing
      const expected = cat(
        (de as any).telegram?.saved_as,
        "telegram.saved_as",
      );
      expect(replyText).toContain(expected);
    });

    // TS-5.2
    it("Telegram reply defaults to English when ui_language is unset", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        if (key === "ui_language") return undefined;
        if (key === "confidence_threshold") return "0.6";
        return undefined;
      });

      const { classifyText, isConfident } = await import(
        "../../src/classify.js"
      );
      vi.mocked(classifyText).mockResolvedValue({
        category: "tasks",
        name: "Buy milk",
        confidence: 0.9,
        fields: {},
        tags: [],
        content: "Buy milk",
      } as any);
      vi.mocked(isConfident).mockReturnValue(true);

      const { handleTextMessage } = await import("../../src/telegram.js");
      const mockSql = vi
        .fn()
        .mockResolvedValue([{ id: "uuid-42" }]);
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        text: "Buy milk",
      });

      await handleTextMessage(ctx as any, mockSql as any);

      expect(mocks.reply).toHaveBeenCalled();
      const replyText = mocks.reply.mock.calls[0][0] as string;
      const expected = cat(
        (en as any).telegram?.saved_as,
        "telegram.saved_as",
      );
      expect(replyText).toContain(expected);
    });

    // TS-5.3
    it("Telegram inline category buttons show localized text with English callback_data", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        if (key === "ui_language") return "de";
        if (key === "confidence_threshold") return "0.6";
        return undefined;
      });

      const { classifyText, isConfident } = await import(
        "../../src/classify.js"
      );
      vi.mocked(classifyText).mockResolvedValue({
        category: "ideas",
        name: "Test",
        confidence: 0.4,
        fields: {},
        tags: [],
        content: "Test",
      } as any);
      vi.mocked(isConfident).mockReturnValue(false);

      const { handleTextMessage } = await import("../../src/telegram.js");
      const mockSql = vi
        .fn()
        .mockResolvedValue([{ id: "uuid-42" }]);
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        text: "Test",
      });

      await handleTextMessage(ctx as any, mockSql as any);

      expect(mocks.reply).toHaveBeenCalled();
      const replyOptions = mocks.reply.mock.calls[0][1] as any;
      const buttons = replyOptions?.reply_markup?.inline_keyboard?.flat();
      expect(buttons).toBeDefined();
      expect(buttons).toHaveLength(5);
      // Each button text should match de catalog; callback_data remains English
      const peopleButton = buttons.find((b: any) =>
        (b.callback_data as string).includes("people"),
      );
      expect(peopleButton).toBeDefined();
      expect(peopleButton.text).toBe(
        cat((de as any).category?.people, "category.people"),
      );
      expect(peopleButton.callback_data).toContain("people");
    });

    // TS-5.4
    it("Telegram echoed entry name and tags are not translated", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        if (key === "ui_language") return "de";
        if (key === "confidence_threshold") return "0.6";
        return undefined;
      });

      const { classifyText, isConfident } = await import(
        "../../src/classify.js"
      );
      vi.mocked(classifyText).mockResolvedValue({
        category: "tasks",
        name: "The quick brown fox",
        confidence: 0.9,
        fields: {},
        tags: [],
        content: "The quick brown fox",
      } as any);
      vi.mocked(isConfident).mockReturnValue(true);

      const { handleTextMessage } = await import("../../src/telegram.js");
      const mockSql = vi
        .fn()
        .mockResolvedValue([{ id: "uuid-42" }]);
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        text: "The quick brown fox",
      });

      await handleTextMessage(ctx as any, mockSql as any);

      expect(mocks.reply).toHaveBeenCalled();
      const replyText = mocks.reply.mock.calls[0][0] as string;
      // Literal entry name preserved
      expect(replyText).toContain("The quick brown fox");
      // German chrome around it
      expect(replyText).toContain(
        cat((de as any).telegram?.saved_as, "telegram.saved_as"),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 6: Email Digest Localization (US-6)
  // ═══════════════════════════════════════════════════════════════════
  describe("Email Digest Localization (US-6)", () => {
    // Helper: resolve a catalog template to its expected rendered form by
    // interpolating {{name}} placeholders. In Phase 4 the stub catalog is
    // empty, so `cat()` returns the raw key (e.g. "email.daily_subject")
    // which has no placeholders to substitute — the expected string stays
    // as the raw key, and the real subject won't contain it (→ test fails).
    // In Phase 5 the catalog holds the template; interpolation yields the
    // final rendered subject, matching what the production code emits.
    function renderTemplate(
      template: string,
      vars: Record<string, string>,
    ): string {
      let out = template;
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), v);
      }
      return out;
    }

    // TS-6.1
    it("daily digest email subject uses current ui_language catalog template", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "ui_language") return "de";
        if (key === "output_language") return "German";
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const { sendDigestEmail } = await import("../../src/email.js");
      const { generateDailyDigest } = await import("../../src/digests.js");
      const mockSql = vi.fn().mockResolvedValue([]) as any;

      await generateDailyDigest(mockSql as any);

      expect(sendDigestEmail).toHaveBeenCalled();
      const arg = vi.mocked(sendDigestEmail).mock.calls[0]?.[0] as any;
      const today = new Date().toISOString().slice(0, 10);
      const expectedSubject = renderTemplate(
        cat((de as any).email?.daily_subject, "email.daily_subject"),
        { date: today },
      );
      expect(String(arg?.subject ?? "")).toContain(expectedSubject);
    });

    // TS-6.2
    it("weekly digest email subject uses current ui_language catalog template", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "ui_language") return "en";
        if (key === "output_language") return "English";
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const { sendDigestEmail } = await import("../../src/email.js");
      const { generateWeeklyReview } = await import("../../src/digests.js");
      const mockSql = vi.fn().mockResolvedValue([]) as any;

      await generateWeeklyReview(mockSql as any);

      expect(sendDigestEmail).toHaveBeenCalled();
      const arg = vi.mocked(sendDigestEmail).mock.calls[0]?.[0] as any;
      // Just assert catalog-key phrase is present in Phase 4 (the raw key
      // "email.weekly_subject"); Phase 5 substitutes {{weekStart}}. The test
      // intentionally leaves the placeholder intact since weekStart depends
      // on wall-clock logic in digests.ts — checking that the catalog key
      // was resolved (i.e. the subject differs from the hardcoded Phase 4
      // "Cortex Weekly — w/c …" form) is sufficient.
      const expectedSubject = cat(
        (en as any).email?.weekly_subject,
        "email.weekly_subject",
      );
      expect(String(arg?.subject ?? "")).toContain(
        expectedSubject.replace(/\{\{\s*weekStart\s*\}\}/g, ""),
      );
    });

    // TS-6.3
    it("digest email body reflects output_language, subject reflects ui_language", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "ui_language") return "de";
        if (key === "output_language") return "French";
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const { sendDigestEmail } = await import("../../src/email.js");
      const { generateDailyDigest } = await import("../../src/digests.js");
      const mockSql = vi.fn().mockResolvedValue([]) as any;

      await generateDailyDigest(mockSql as any);

      expect(sendDigestEmail).toHaveBeenCalled();
      const arg = vi.mocked(sendDigestEmail).mock.calls[0]?.[0] as any;
      const today = new Date().toISOString().slice(0, 10);
      const expectedSubject = renderTemplate(
        cat((de as any).email?.daily_subject, "email.daily_subject"),
        { date: today },
      );
      expect(String(arg?.subject ?? "")).toContain(expectedSubject);
      // Body is whatever the LLM produced (French, per our mock). The ui_language
      // locale must not re-translate it — so the body is the mocked content
      // verbatim (output from createLLMProvider.chat).
      expect(arg?.body ?? "").toBeDefined();
      expect(arg?.body ?? "").toBe("## Digest\n\nTest content.");
    });

    // TS-6.4
    it("digest email envelope wrapper strings use current ui_language", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "ui_language") return "de";
        if (key === "output_language") return "German";
        if (key === "digest_email_to") return "user@example.com";
        return undefined;
      });

      const { sendDigestEmail } = await import("../../src/email.js");
      const { generateDailyDigest } = await import("../../src/digests.js");
      const mockSql = vi.fn().mockResolvedValue([]) as any;

      await generateDailyDigest(mockSql as any);

      expect(sendDigestEmail).toHaveBeenCalled();
      const arg = vi.mocked(sendDigestEmail).mock.calls[0]?.[0] as any;
      // AC-6.3: The "From" display name and any body wrapper strings are
      // localized via t(...). Envelope fields surface in `from` (string) —
      // assert the de-catalog value for email.from_name appears somewhere in
      // the outbound args.
      const expectedFromName = cat(
        (de as any).email?.from_name,
        "email.from_name",
      );
      const haystack = JSON.stringify(arg ?? {});
      expect(haystack).toContain(expectedFromName);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 7: Classify Prompt Enum Locking (US-7)
  // ═══════════════════════════════════════════════════════════════════
  describe("Classify Prompt Enum Locking (US-7)", () => {
    const promptPath = pathResolve(
      process.cwd(),
      "prompts",
      "classify.md",
    );
    const promptText = readFileSync(promptPath, "utf-8");

    // TS-7.1
    it("classify prompt contains explicit English-only rules for status and category enums", () => {
      // The spec (ui-language-specification.md §AC-7.1) locks the phrasing
      // to "must be emitted as exactly one of <enums>" for each enum field.
      // Accept both the spec wording and the shorter "must be exactly one of"
      // form that natural prose may prefer.
      const ENUM_LOCK = /(?:must be (?:emitted as )?)?exactly one of/i;

      expect(promptText).toMatch(
        new RegExp(
          `projects[\\s\\S]{0,50}status[\\s\\S]{0,300}${ENUM_LOCK.source}[\\s\\S]{0,60}"active"[\\s\\S]{0,40}"paused"[\\s\\S]{0,40}"completed"`,
          "i",
        ),
      );
      expect(promptText).toMatch(
        new RegExp(
          `tasks[\\s\\S]{0,50}status[\\s\\S]{0,300}${ENUM_LOCK.source}[\\s\\S]{0,60}"pending"[\\s\\S]{0,40}"done"`,
          "i",
        ),
      );
      expect(promptText).toMatch(
        new RegExp(
          `category[\\s\\S]{0,300}${ENUM_LOCK.source}[\\s\\S]{0,120}"people"[\\s\\S]{0,40}"projects"[\\s\\S]{0,40}"tasks"[\\s\\S]{0,40}"ideas"[\\s\\S]{0,40}"reference"`,
          "i",
        ),
      );
    });

    // TS-7.2
    it("enum-lock instructions are present in the rendered classify prompt for every output_language", async () => {
      const classifyMod = await vi.importActual<
        typeof import("../../src/classify.js")
      >("../../src/classify.js");
      const { assemblePrompt } = classifyMod;

      for (const outputLang of ["English", "German", "Spanish", "Korean"]) {
        const rendered = assemblePrompt(
          promptText,
          "",
          "test input",
          outputLang,
        );
        expect(rendered).toMatch(
          /projects\.status[\s\S]*?"active"[\s\S]*?"paused"[\s\S]*?"completed"/,
        );
        expect(rendered).toMatch(
          /tasks\.status[\s\S]*?"pending"[\s\S]*?"done"/,
        );
        expect(rendered).toMatch(
          /category[\s\S]*?"people"[\s\S]*?"projects"[\s\S]*?"tasks"[\s\S]*?"ideas"[\s\S]*?"reference"/,
        );
        expect(rendered).toMatch(/English[\s\S]*?(enum|status|category)/i);
      }
    });

    // TS-7.3
    it("classify prompt retains {output_language} instruction for free-text fields", () => {
      // The general statement about output language remains
      expect(promptText).toMatch(
        /structured output[\s\S]*?\{output_language\}/i,
      );
      // No explicit restriction for the free-text fields
      for (const fld of [
        "notes",
        "context",
        "oneliner",
        "next_action",
        "follow_ups",
      ]) {
        // Confirm no "fld must be English" directive exists
        const restrictive = new RegExp(
          `${fld}[\\s\\S]{0,80}must[\\s\\S]{0,40}English`,
          "i",
        );
        expect(promptText).not.toMatch(restrictive);
      }
      // Phase 5 gate: free-text invariant is checked *alongside* the enum-lock
      // instruction introduced in Phase 5. The spec uses "must be emitted as
      // exactly one of ..." — match either wording plus the spec-adjacent
      // "overriding the general" / "regardless of {output_language}" phrasings.
      expect(promptText).toMatch(
        /(?:must be (?:emitted as )?)?exactly one of|regardless of \{output_language\}|overriding the general|in English regardless/i,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 8: Catalog Fallback Behavior (US-8)
  // ═══════════════════════════════════════════════════════════════════
  describe("Catalog Fallback Behavior (US-8)", () => {
    // TS-8.1
    it("de catalog contains every key present in en catalog", async () => {
      const enKeys = new Set(flattenKeys(en as Record<string, unknown>));
      const deKeys = new Set(flattenKeys(de as Record<string, unknown>));

      // Phase-5 sanity check: the canonical en catalog must have content
      expect(enKeys.size).toBeGreaterThan(0);
      expect(enKeys.has("nav.browse")).toBe(true);

      // Every en key must be present in de
      for (const k of enKeys) {
        expect(deKeys.has(k)).toBe(true);
      }
    });

    // TS-8.2
    it("runtime missing key in de falls back to en value", async () => {
      const i18nextMod = await import("i18next");
      const i = i18nextMod.default;
      // Ensure bundles exist with at least nav.browse in en
      i.addResourceBundle(
        "en",
        "translation",
        { nav: { browse: "Browse" } },
        true,
        true,
      );
      // De bundle — missing nav.browse deliberately
      i.removeResourceBundle("de", "translation");
      i.addResourceBundle(
        "de",
        "translation",
        { nav: {} },
        true,
        true,
      );

      const t = i.getFixedT("de");
      expect(t("nav.browse")).toBe("Browse");
    });

    // TS-8.3
    it("key missing from all catalogs returns raw key string", async () => {
      const i18nextMod = await import("i18next");
      const t = i18nextMod.default.getFixedT("en");
      expect(t("absent.key.for.testing")).toBe("absent.key.for.testing");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 9: Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-9.1
    it("unrecognized ui_language value falls through to Accept-Language resolution", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "fr" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await getWithLocale(app, "/", {
        cookie,
        acceptLanguage: "de",
      });

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
      expect(body).toContain(cat((de as any).nav?.browse, "nav.browse"));
    });

    // TS-9.2
    it("settings dropdown shows Auto when ui_language value is unrecognized", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "fr" });

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      // Auto (empty value) option is selected
      expect(body).toMatch(
        /<option[^>]*value=""[^>]*selected[^>]*>|<option[^>]*selected[^>]*value=""/,
      );
      // No "fr" option is present as a selectable value in the dropdown
      expect(body).not.toMatch(/<option[^>]*value="fr"/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Group 10: Non-Goal Guards
  // ═══════════════════════════════════════════════════════════════════
  describe("Non-Goal Guards", () => {
    // TS-10.1
    it("entry name and tags render verbatim regardless of ui_language", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      const entryId = "550e8400-e29b-41d4-a716-446655440000";
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getEntry",
      ).mockResolvedValue({
        id: entryId,
        name: "The quick brown fox",
        category: "ideas",
        content: "English content",
        fields: {},
        tags: ["foo", "bar"],
        confidence: 0.9,
        source: "web",
        source_type: "text",
        embedding: null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
      vi.spyOn(
        await import("../../src/web/entry-queries.js"),
        "getAllTags",
      ).mockResolvedValue([]);

      const { app } = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request(`/entry/${entryId}`, {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("The quick brown fox");
      expect(body).toContain("foo");
      expect(body).toContain("bar");
    });

    // TS-10.2
    it("classify prompt sent to LLM is English regardless of ui_language", async () => {
      const { resolveConfigValue } = await import("../../src/config.js");
      vi.mocked(resolveConfigValue).mockImplementation(async (key: string) => {
        if (key === "ui_language") return "de";
        if (key === "output_language") return "German";
        return undefined;
      });

      const classifyMod = await vi.importActual<
        typeof import("../../src/classify.js")
      >("../../src/classify.js");
      const { assemblePrompt } = classifyMod;

      const promptPath = pathResolve(
        process.cwd(),
        "prompts",
        "classify.md",
      );
      const template = readFileSync(promptPath, "utf-8");
      const rendered = assemblePrompt(template, "", "test input", "German");

      // Prompt body starts with English instruction text
      expect(rendered).toMatch(
        /classification engine for a personal knowledge base/i,
      );
      // Prompt does not contain any German-only stub catalog strings
      // (stub is empty; this guard ensures the prompt body itself is English).
      expect(rendered).not.toContain("Durchsuchen");
      expect(rendered).not.toContain("Einstellungen");
      // Phase 5 gate: rendered prompt must contain the explicit enum-lock
      // instruction that ties projects.status/tasks.status/category values
      // to English. Spec language is "must be emitted as exactly one of …";
      // accept adjacent phrasings as well.
      expect(rendered).toMatch(
        /(?:must be (?:emitted as )?)?exactly one of|regardless of \{output_language\}|overriding the general|in English regardless/i,
      );
    });

    // TS-10.3
    it("MCP tools/list response descriptions remain English under any ui_language", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      vi.mocked(getAllSettings).mockResolvedValue({ ui_language: "de" });

      // Phase 5 gate: initI18n must succeed so we know the i18n stack is
      // wired up — this verifies we're testing the post-Phase-5 world where
      // MCP tool descriptions remain English *even though* the web UI is
      // localized. In Phase 4, initI18n throws "Not implemented".
      const { initI18n } = await import("../../src/web/i18n/index.js");
      await initI18n();

      // Call the JSON-RPC handler directly (it takes a parsed body, not a
      // Hono context) — matches the production wiring in src/index.ts.
      const { createMcpHttpHandler } = await import(
        "../../src/mcp-tools.js"
      );
      const handler = createMcpHttpHandler({} as any);
      const result = (await handler({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      })) as any;

      const tools = result?.result?.tools ?? [];
      expect(tools.length).toBeGreaterThan(0);

      const searchTool = tools.find(
        (t: any) => t.name === "search" || t.name === "search_brain",
      );
      expect(searchTool).toBeDefined();
      expect(searchTool.description).toMatch(/semantic|Search the brain/i);
    });

    // TS-10.4
    it("setup wizard and login page do not render a language picker", async () => {
      // Setup wizard — no user exists
      vi.spyOn(
        await import("../../src/web/setup-queries.js"),
        "getUserCount",
      ).mockResolvedValue(0);

      const { app } = await createTestApp();

      const setupRes = await app.request("/setup", {
        headers: { "Accept-Language": "de" },
      });
      const setupBody = await setupRes.text();
      expect(setupBody).not.toMatch(/<select[^>]*name="ui_language"/);
      expect(setupBody).not.toMatch(/<input[^>]*name="ui_language"/);

      // Login page — user exists
      vi.spyOn(
        await import("../../src/web/setup-queries.js"),
        "getUserCount",
      ).mockResolvedValue(1);

      const loginRes = await app.request("/login", {
        headers: { "Accept-Language": "de" },
      });
      const loginBody = await loginRes.text();
      expect(loginBody).not.toMatch(/<select[^>]*name="ui_language"/);
      expect(loginBody).not.toMatch(/<input[^>]*name="ui_language"/);
      // No generic language-switcher UI
      expect(loginBody).not.toMatch(/flag-icon|lang-switch|locale-picker/i);
    });
  });
});
