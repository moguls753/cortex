/**
 * Integration tests for the web settings page.
 * Uses testcontainers PostgreSQL for real DB operations.
 * Only mocks globalThis.fetch for Ollama connectivity check.
 *
 * Scenarios: TS-5.1, TS-5.2, TS-5.3, TS-7.7, INT-1, INT-2, INT-3
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
import { withEnv } from "../helpers/env.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Helpers ────────────────────────────────────────────────────────

async function createIntegrationSettings(
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

function buildFormData(
  overrides: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    chat_ids: "123456",
    llm_model: "claude-sonnet-4-20250514",
    daily_digest_cron: "30 7 * * *",
    weekly_digest_cron: "0 16 * * 0",
    timezone: "Europe/Berlin",
    confidence_threshold: "0.6",
    digest_email_to: "",
    ollama_url: "http://ollama:11434",
    ...overrides,
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Web Settings Integration", () => {
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
    vi.clearAllMocks();
    // Mock fetch for Ollama check (Ollama not available in test)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Persistence (US-5)
  // ═══════════════════════════════════════════════════════════════════
  describe("Persistence (US-5)", () => {
    // TS-5.1
    it("persists setting as key-value pair with updated_at", async () => {
      const { app } = await createIntegrationSettings(db.sql);
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ llm_model: "claude-haiku-4-5-20251001" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);

      const rows =
        await db.sql`SELECT * FROM settings WHERE key = 'llm_model'`;
      expect(rows.length).toBe(1);
      expect(rows[0].value).toBe("claude-haiku-4-5-20251001");
      expect(rows[0].updated_at).toBeInstanceOf(Date);
      // Check updated_at is recent (within last 10 seconds)
      const diff = Date.now() - new Date(rows[0].updated_at).getTime();
      expect(diff).toBeLessThan(10_000);
    });

    // TS-5.2
    it("settings page shows DB value over env var", async () => {
      // Insert a DB setting
      await db.sql`INSERT INTO settings (key, value) VALUES ('llm_model', 'db-model')`;

      const restore = withEnv({ LLM_MODEL: "env-model" });

      try {
        const { app } = await createIntegrationSettings(db.sql);
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/settings", {
          headers: { Cookie: cookie },
        });

        const body = await res.text();
        expect(body).toContain("db-model");
        expect(body).not.toContain("env-model");
      } finally {
        restore();
      }
    });

    // TS-5.3
    it("settings page shows env var when no DB setting exists", async () => {
      // Ensure no llm_model row in settings table (already truncated in beforeEach)
      const restore = withEnv({ LLM_MODEL: "env-model" });

      try {
        const { app } = await createIntegrationSettings(db.sql);
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/settings", {
          headers: { Cookie: cookie },
        });

        const body = await res.text();
        expect(body).toContain("env-model");
      } finally {
        restore();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Save and Read Back
  // ═══════════════════════════════════════════════════════════════════
  describe("Save and Read Back", () => {
    // INT-1
    it("saves and reads back all settings through the page", async () => {
      const { app } = await createIntegrationSettings(db.sql);
      const cookie = await loginAndGetCookie(app);

      // POST with non-default values
      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({
          chat_ids: "555555",
          llm_model: "gpt-4o",
          daily_digest_cron: "0 9 * * *",
          weekly_digest_cron: "0 18 * * 5",
          timezone: "America/New_York",
          confidence_threshold: "0.8",
          digest_email_to: "test@example.com",
          ollama_url: "http://custom:11434",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);

      // GET and verify all values are shown
      const getRes = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await getRes.text();
      expect(body).toContain("555555");
      expect(body).toContain("gpt-4o");
      expect(body).toContain("0 9 * * *");
      expect(body).toContain("0 18 * * 5");
      expect(body).toContain("America/New_York");
      expect(body).toContain("0.8");
      expect(body).toContain("test@example.com");
      expect(body).toContain("http://custom:11434");
    });

    // INT-2
    it("validation errors do not change existing settings", async () => {
      const { app } = await createIntegrationSettings(db.sql);
      const cookie = await loginAndGetCookie(app);

      // First: save valid settings
      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "0.7" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Second: try to save with invalid confidence_threshold
      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "2.0" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Third: GET and verify original values are still shown
      const getRes = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await getRes.text();
      expect(body).toContain("0.7");
      expect(body).not.toContain("2.0");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Concurrent Writes
  // ═══════════════════════════════════════════════════════════════════
  describe("Concurrent Writes", () => {
    // TS-7.7
    it("last write wins on concurrent saves", async () => {
      const { app } = await createIntegrationSettings(db.sql);
      const cookie = await loginAndGetCookie(app);

      // First save
      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "0.7" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Second save
      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "0.8" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Verify DB has the last value
      const rows =
        await db.sql`SELECT value FROM settings WHERE key = 'confidence_threshold'`;
      expect(rows.length).toBe(1);
      expect(rows[0].value).toBe("0.8");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Telegram Chat IDs Persistence
  // ═══════════════════════════════════════════════════════════════════
  describe("Telegram Chat IDs Persistence", () => {
    // INT-3
    it("adds and removes Telegram chat IDs through the page", async () => {
      const { app } = await createIntegrationSettings(db.sql);
      const cookie = await loginAndGetCookie(app);

      // Add two chat IDs
      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ chat_ids: "111,222" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Remove one
      await app.request("/settings", {
        method: "POST",
        body: buildFormData({ chat_ids: "111" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      // Verify via GET
      const getRes = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await getRes.text();
      expect(body).toContain("111");
      expect(body).not.toContain("222");

      // Verify DB
      const rows =
        await db.sql`SELECT value FROM settings WHERE key = 'telegram_chat_ids'`;
      expect(rows.length).toBe(1);
      expect(rows[0].value).toBe("111");
    });
  });
});
