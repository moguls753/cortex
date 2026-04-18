/**
 * Integration tests for the UI language feature.
 * Uses testcontainers PostgreSQL for real DB persistence; mocks only
 * globalThis.fetch (Ollama connectivity check) and the LLM classify path.
 *
 * Scenarios: INT-1, INT-2, INT-3
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
import {
  startTestDb,
  runMigrations,
  type TestDb,
} from "../helpers/test-db.js";
import { createMockContext } from "../helpers/mock-telegram.js";
import { en } from "../../src/web/i18n/en.js";
import { de } from "../../src/web/i18n/de.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Helpers ─────────────────────────────────────────────────────────

function cat(value: unknown, fallback: string): string {
  return (value as string | undefined) ?? fallback;
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

async function createIntegrationApp(
  sql: postgres.Sql,
): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createLocaleMiddleware } = await import(
    "../../src/web/i18n/middleware.js"
  );
  const { createSettingsRoutes } = await import(
    "../../src/web/settings.js"
  );
  const { createDashboardRoutes } = await import(
    "../../src/web/dashboard.js"
  );
  const { createSetupRoutes, createSetupMiddleware } = await import(
    "../../src/web/setup.js"
  );
  const { createSSEBroadcaster } = await import("../../src/web/sse.js");
  const { initI18n } = await import("../../src/web/i18n/index.js");

  await initI18n();

  const broadcaster = createSSEBroadcaster();

  const app = new Hono();
  app.use("*", createLocaleMiddleware(sql));
  app.use("*", createSetupMiddleware(sql, TEST_SECRET));
  app.route("/", createSetupRoutes(sql, TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createDashboardRoutes(sql, broadcaster));
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

// ─── Test Suite ──────────────────────────────────────────────────────

describe("UI Language Integration", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await runMigrations(db.url);
    // Initialize i18next (Phase 4 stub throws; swallowed here so the
    // integration assertions surface their own failures)
    try {
      const { initI18n } = await import("../../src/web/i18n/index.js");
      await initI18n();
    } catch {
      // No-op in Phase 4
    }
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.sql`TRUNCATE settings`;
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // INT-1: Settings persistence round-trip
  // ═══════════════════════════════════════════════════════════════════
  describe("Settings persistence round-trip", () => {
    it("saves ui_language to real DB and renders the redirect in the new locale", async () => {
      const { app } = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      const postRes = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "de" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(postRes.status).toBe(302);

      const rows =
        await db.sql`SELECT value FROM settings WHERE key = 'ui_language'`;
      expect(rows.length).toBe(1);
      expect(rows[0].value).toBe("de");

      // Follow redirect — dashboard GET renders German nav labels
      const getRes = await app.request("/", {
        headers: { Cookie: cookie },
      });
      const body = await getRes.text();
      expect(body).toContain('<html lang="de"');
      expect(body).toContain(
        cat((de as any).nav?.browse, "nav.browse"),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // INT-2: Accept-Language fallback from real DB
  // ═══════════════════════════════════════════════════════════════════
  describe("Accept-Language fallback from real DB", () => {
    it("empty ui_language row falls back to Accept-Language with real DB", async () => {
      const { app } = await createIntegrationApp(db.sql);
      const cookie = await loginAndGetCookie(app);

      // No ui_language row in the settings table (beforeEach truncates)
      const rowsBefore =
        await db.sql`SELECT value FROM settings WHERE key = 'ui_language'`;
      expect(rowsBefore.length).toBe(0);

      const res = await app.request("/", {
        headers: { Cookie: cookie, "Accept-Language": "de" },
      });

      const body = await res.text();
      expect(body).toContain('<html lang="de"');
      expect(body).toContain(
        cat((de as any).nav?.browse, "nav.browse"),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // INT-3: Telegram reads ui_language from real DB
  // ═══════════════════════════════════════════════════════════════════
  describe("Telegram reply reads ui_language from real DB", () => {
    it("Telegram handler reads ui_language from real DB per reply", async () => {
      // Seed the DB with ui_language = de and authorized chat id
      await db.sql`INSERT INTO settings (key, value) VALUES ('ui_language', 'de')`;
      await db.sql`INSERT INTO settings (key, value) VALUES ('telegram_chat_ids', ${'["123456"]'})`;
      await db.sql`INSERT INTO settings (key, value) VALUES ('confidence_threshold', '0.6')`;

      // Mock classify + insert paths; rely on real sql for ui_language
      const classifyMod = await import("../../src/classify.js");
      vi.spyOn(classifyMod, "classifyText").mockResolvedValue({
        category: "tasks",
        name: "Milch kaufen",
        confidence: 0.9,
        fields: {},
        tags: [],
        content: "Milch kaufen",
      } as any);
      vi.spyOn(classifyMod, "isConfident").mockReturnValue(true);
      vi.spyOn(classifyMod, "assembleContext").mockResolvedValue([]);
      vi.spyOn(classifyMod, "resolveConfidenceThreshold").mockReturnValue(
        0.6,
      );

      const embedMod = await import("../../src/embed.js");
      vi.spyOn(embedMod, "embedEntry").mockResolvedValue(undefined);
      vi.spyOn(embedMod, "generateEmbedding").mockResolvedValue(null);

      const { handleTextMessage } = await import("../../src/telegram.js");
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        text: "Milch kaufen",
      });

      await handleTextMessage(ctx as any, db.sql as any);

      expect(mocks.reply).toHaveBeenCalled();
      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain(
        cat((de as any).telegram?.saved_as, "telegram.saved_as"),
      );
    });
  });
});
