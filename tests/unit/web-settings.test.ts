/**
 * Unit tests for the web settings page.
 * Uses mocked query layer and fetch (Ollama connectivity check).
 *
 * Scenarios: TS-1.1, TS-1.2, TS-1.3, TS-1.5,
 *            TS-2.1, TS-2.2,
 *            TS-3.1, TS-3.2, TS-3.2b, TS-3.3, TS-3.4,
 *            TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5,
 *            TS-6.1, TS-6.1b, TS-6.2,
 *            TS-7.1, TS-7.1b, TS-7.1c, TS-7.1d-a, TS-7.1d-b,
 *            TS-7.2, TS-7.3, TS-7.4, TS-7.5, TS-7.6, TS-7.8,
 *            TS-8.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { withEnv } from "../helpers/env.js";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
  saveAllSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/llm/config.js", () => ({
  getLLMConfig: vi.fn().mockResolvedValue({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeys: { anthropic: "", openai: "", groq: "", gemini: "" },
  }),
  saveLLMConfig: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ────────────────────────────────────────────────────────

async function createTestSettings(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );
  const { createSettingsRoutes } = await import("../../src/web/settings.js");

  const mockSql = {} as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createSettingsRoutes(mockSql));

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
    ...overrides,
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Web Settings", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-apply default mock implementations after clearAllMocks
    const { getAllSettings } = await import(
      "../../src/web/settings-queries.js"
    );
    (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { getLLMConfig, saveLLMConfig } = await import(
      "../../src/llm/config.js"
    );
    (getLLMConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com/v1",
      apiKeys: { anthropic: "", openai: "", groq: "", gemini: "" },
    });
    (saveLLMConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // Default fetch mock — Ollama check runs on every POST save
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Telegram Chat IDs (US-1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Telegram Chat IDs (US-1)", () => {
    // TS-1.1
    it("displays current Telegram chat IDs with remove buttons", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        telegram_chat_ids: "123456,789012",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("123456");
      expect(body).toContain("789012");
      // Remove buttons (one per chat ID)
      expect(body).toMatch(/remove/i);
    });

    // TS-1.2
    it("adds a new chat ID to existing list", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        telegram_chat_ids: "123456",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ chat_ids: "123456,789012" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/\/settings/);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          telegram_chat_ids: "123456,789012",
        }),
      );

      // Verify LLM config was also saved
      const { saveLLMConfig } = await import("../../src/llm/config.js");
      expect(saveLLMConfig).toHaveBeenCalled();
    });

    // TS-1.3
    it("removes a chat ID from list", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        telegram_chat_ids: "123456,789012",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ chat_ids: "123456" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          telegram_chat_ids: "123456",
        }),
      );
    });

    // TS-1.5
    it("rejects removing the last chat ID", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        telegram_chat_ids: "123456",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ chat_ids: "" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error/);
      expect(res.headers.get("location")).toMatch(/chat/i);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Classification Model (US-2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Classification Model (US-2)", () => {
    // TS-2.1
    it("displays current LLM model name", async () => {
      const { getLLMConfig } = await import("../../src/llm/config.js");
      (getLLMConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        baseUrl: "https://api.anthropic.com/v1",
        apiKeys: { anthropic: "", openai: "", groq: "", gemini: "" },
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("claude-haiku-4-5-20251001");
    });

    // TS-2.2
    it("saves changed model name", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
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
      expect(res.headers.get("location")).toMatch(/success/);

      const { saveLLMConfig } = await import("../../src/llm/config.js");
      expect(saveLLMConfig).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          model: "claude-haiku-4-5-20251001",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Digest Schedules (US-3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Digest Schedules (US-3)", () => {
    // TS-3.1
    it("displays current digest cron expressions", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        daily_digest_cron: "0 8 * * *",
        weekly_digest_cron: "0 18 * * 5",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("0 8 * * *");
      expect(body).toContain("0 18 * * 5");
    });

    // TS-3.2
    it("saves valid daily cron expression", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ daily_digest_cron: "0 9 * * *" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          daily_digest_cron: "0 9 * * *",
        }),
      );
    });

    // TS-3.2b
    it("saves valid weekly cron expression", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ weekly_digest_cron: "0 18 * * 5" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          weekly_digest_cron: "0 18 * * 5",
        }),
      );
    });

    // TS-3.3
    it("shows default cron values when no settings exist", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("30 7 * * *"); // daily default
      expect(body).toContain("0 16 * * 0"); // weekly default
    });

    // TS-3.4
    it("rejects invalid cron expression", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        daily_digest_cron: "30 7 * * *",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ daily_digest_cron: "not a cron" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error/);
      expect(res.headers.get("location")).toMatch(/cron/i);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Other Preferences (US-4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Other Preferences (US-4)", () => {
    // TS-4.1
    it("displays current timezone", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        timezone: "America/New_York",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("America/New_York");
    });

    // TS-4.2
    it("displays current confidence threshold", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        confidence_threshold: "0.8",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("0.8");
    });

    // TS-4.3
    it("displays current digest email", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        digest_email_to: "user@example.com",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await res.text();
      expect(body).toContain("user@example.com");
    });

    // TS-4.4 — Ollama URL is no longer displayed in UI (env-var only)
    // Infrastructure section was removed; URL is resolved internally for
    // model listing and connectivity checks but not shown to the user.

    // TS-4.5
    it("saves all preferences in one submission", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({
          timezone: "UTC",
          confidence_threshold: "0.7",
          digest_email_to: "new@example.com",
        }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          timezone: "UTC",
          confidence_threshold: "0.7",
          digest_email_to: "new@example.com",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Constraints
  // ═══════════════════════════════════════════════════════════════════
  describe("Constraints", () => {
    // TS-6.1
    it("redirects unauthenticated GET to login", async () => {
      const { app } = await createTestSettings();

      const res = await app.request("/settings");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/\/login/);
    });

    // TS-6.1b
    it("redirects unauthenticated POST to login", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );

      const { app } = await createTestSettings();

      const res = await app.request("/settings", {
        method: "POST",
        body: new URLSearchParams({ llm_model: "test" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/\/login/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    // TS-6.2
    it("returns server-rendered HTML with form", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toMatch(/<!DOCTYPE html>|<html/i);
      expect(body).toMatch(/<form/i);
      expect(body).toMatch(/<input/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-7.1
    it("rejects confidence threshold above 1.0", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        confidence_threshold: "0.6",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "1.5" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    // TS-7.1b
    it("rejects negative confidence threshold", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        confidence_threshold: "0.6",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "-0.1" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    // TS-7.1c
    it("rejects non-numeric confidence threshold", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        confidence_threshold: "0.6",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "abc" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    // TS-7.1d-a
    it("accepts confidence threshold 0.0", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "0.0" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          confidence_threshold: "0.0",
        }),
      );
    });

    // TS-7.1d-b
    it("accepts confidence threshold 1.0", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ confidence_threshold: "1.0" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          confidence_threshold: "1.0",
        }),
      );
    });

    // TS-7.2
    it("saves settings with warning when Ollama is unreachable", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      // Override default fetch mock: Ollama unreachable
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("ECONNREFUSED"),
      );

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData(),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toMatch(/success/);
      expect(location).toMatch(/warning/);
      expect(decodeURIComponent(location)).toMatch(/ollama/i);
      // Settings saved despite unreachable Ollama
      expect(saveAllSettings).toHaveBeenCalled();
    });

    // TS-7.3
    it("saves empty email and shows disabled note", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );

      // First: POST saves empty email successfully
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        digest_email_to: "user@example.com",
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const postRes = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ digest_email_to: "" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(postRes.status).toBe(302);
      expect(postRes.headers.get("location")).toMatch(/success/);

      // Second: GET with empty email shows disabled note
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        digest_email_to: "",
      });

      const getRes = await app.request("/settings", {
        headers: { Cookie: cookie },
      });

      const body = await getRes.text();
      expect(body).toMatch(/disabled/i);
    });

    // TS-7.4
    it("rejects non-numeric Telegram chat ID", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ chat_ids: "123456,not-a-number" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    // TS-7.5
    it("saves timezone change", async () => {
      const { getAllSettings, saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ timezone: "America/New_York" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/success/);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          timezone: "America/New_York",
        }),
      );
    });

    // TS-7.6
    it("shows hardcoded defaults when settings table is empty", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      // Ensure relevant env vars are not set
      const restore = withEnv({
        LLM_MODEL: undefined,
        DAILY_DIGEST_CRON: undefined,
        WEEKLY_DIGEST_CRON: undefined,
        TZ: undefined,
        CONFIDENCE_THRESHOLD: undefined,
        OLLAMA_URL: undefined,
        DIGEST_EMAIL_TO: undefined,
        TELEGRAM_CHAT_ID: undefined,
      });

      try {
        const { app } = await createTestSettings();
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/settings", {
          headers: { Cookie: cookie },
        });

        const body = await res.text();
        // LLM model default
        expect(body).toContain("claude-sonnet-4-20250514");
        // Daily cron default
        expect(body).toContain("30 7 * * *");
        // Weekly cron default
        expect(body).toContain("0 16 * * 0");
        // Timezone default
        expect(body).toContain("Europe/Berlin");
        // Confidence threshold default
        expect(body).toContain("0.6");
        // Ollama URL default
        expect(body).toContain("http://ollama:11434");
      } finally {
        restore();
      }
    });

    // TS-7.8 — removed
    // Env var fallback for Telegram chat ID was removed in the onboarding refactor.
    // Settings now read from DB only.
  });

  // ═══════════════════════════════════════════════════════════════════
  // Kitchen Display settings (spec 2026-04-15 sweep)
  // ═══════════════════════════════════════════════════════════════════
  describe("Kitchen Display settings", () => {
    it("renders the new display_max_today_events, display_base_url, and display_calendars fields", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        display_enabled: "true",
        display_max_today_events: "6",
        display_base_url: "https://cortex.example.com",
        display_calendars: JSON.stringify(["FAMILY", "WORK"]),
      });

      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);
      const res = await app.request("/settings", { headers: { Cookie: cookie } });
      const body = await res.text();

      expect(body).toContain('name="display_max_today_events"');
      expect(body).toContain('value="6"');
      expect(body).toContain('name="display_base_url"');
      expect(body).toContain("https://cortex.example.com");
      expect(body).toContain('name="display_calendars"');
      expect(body).toContain("FAMILY, WORK");
    });

    it("round-trips display_max_today_events through save", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_max_today_events: "12" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ display_max_today_events: "12" }),
      );
    });

    it("round-trips display_base_url through save", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_base_url: "https://proxy.example.com" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ display_base_url: "https://proxy.example.com" }),
      );
    });

    it("normalizes display_calendars from comma-separated to a JSON array", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_calendars: "FAMILY, WORK , PERSONAL" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          display_calendars: JSON.stringify(["FAMILY", "WORK", "PERSONAL"]),
        }),
      );
    });

    it("saves display_calendars as empty string when the input is blank", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_calendars: "  " }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ display_calendars: "" }),
      );
    });

    it("rejects display_max_today_events outside 1..30", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_max_today_events: "99" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error=/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    it("rejects display_base_url that is not a valid http(s) URL", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_base_url: "not a url" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error=/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });

    it("rejects display_base_url with a non-http protocol", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      const { app } = await createTestSettings();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ display_base_url: "ftp://example.com" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/error=/);
      expect(saveAllSettings).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Non-Goal Guards
  // ═══════════════════════════════════════════════════════════════════
  describe("Non-Goal Guards", () => {
    // TS-8.1
    it("does not expose API keys or secrets", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const restore = withEnv({
        LLM_API_KEY: "sk-test-key-123",
        TELEGRAM_BOT_TOKEN: "bot-token-456",
        SESSION_SECRET: "secret-789",
      });

      try {
        const { app } = await createTestSettings();
        const cookie = await loginAndGetCookie(app);

        const res = await app.request("/settings", {
          headers: { Cookie: cookie },
        });

        const body = await res.text();
        expect(body).not.toContain("sk-test-key-123");
        expect(body).not.toContain("bot-token-456");
        expect(body).not.toContain("secret-789");
        // No input fields for secrets
        expect(body).not.toMatch(/name=["']?api_key/i);
        expect(body).not.toMatch(/name=["']?bot_token/i);
        expect(body).not.toMatch(/name=["']?session_secret/i);
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // Auth-refactor Group 8 — Settings re-issue on ui_language change
  // Scenarios: TS-8.1, TS-8.2, TS-8.3, TS-8.4
  // =========================================================================
  describe("Settings re-issue after auth-refactor (Group 8)", () => {
    function extractSessionFromSetCookie(
      setCookie: string | null,
    ): string | null {
      if (!setCookie) return null;
      const match = setCookie.match(/cortex_session=([^;]+)/);
      if (!match || !match[1]) return null;
      return decodeURIComponent(match[1]);
    }

    function decodePayload(
      token: string,
    ): Record<string, unknown> | null {
      const dotIdx = token.lastIndexOf(".");
      if (dotIdx === -1) return null;
      try {
        return JSON.parse(token.substring(0, dotIdx)) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    }

    function decodeSessionPayload(
      setCookie: string | null,
    ): Record<string, unknown> | null {
      const token = extractSessionFromSetCookie(setCookie);
      if (!token) return null;
      return decodePayload(token);
    }

    async function createTestSettingsWithSecret(): Promise<{ app: Hono }> {
      const { createAuthMiddleware, createAuthRoutes } = await import(
        "../../src/web/auth.js"
      );
      const { createSettingsRoutes } = await import(
        "../../src/web/settings.js"
      );

      const mockSql = {} as any;
      const mockBroadcaster = { broadcast: vi.fn() } as any;

      const app = new Hono();
      app.use("*", createAuthMiddleware(TEST_SECRET));
      // Legacy auth mode — tests that only need a signed session cookie and
      // don't care about bcrypt + user-table wiring use the string form.
      app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
      // Settings routes get the real secret so the re-issue path runs.
      app.route(
        "/",
        createSettingsRoutes(mockSql, mockBroadcaster, TEST_SECRET),
      );

      return { app };
    }

    // TS-8.1
    it("re-issues the session cookie when ui_language changes", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "en",
      });

      // Default fetch mock (Ollama check returns ok).
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 }),
      );

      const { app } = await createTestSettingsWithSecret();
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
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toMatch(/cortex_session=/);

      const payload = decodeSessionPayload(setCookie);
      expect(payload).not.toBeNull();
      expect(payload!.locale).toBe("de");
    });

    // TS-8.2
    it("preserves the original issued_at when re-issuing the cookie", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "en",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 }),
      );

      const { app } = await createTestSettingsWithSecret();
      const loginRes = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const loginSetCookie = loginRes.headers.get("set-cookie");
      const loginPayload = decodeSessionPayload(loginSetCookie)!;
      const originalIssuedAt = loginPayload.issued_at as number;

      const cookieValue = extractSessionFromSetCookie(loginSetCookie)!;
      const cookie = `cortex_session=${encodeURIComponent(cookieValue)}`;

      // Wait at least 10ms so Date.now() is guaranteed to have moved on.
      await new Promise((r) => setTimeout(r, 15));

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "de" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const reissuedSetCookie = res.headers.get("set-cookie");
      const reissuedPayload = decodeSessionPayload(reissuedSetCookie);
      expect(reissuedPayload).not.toBeNull();
      expect(reissuedPayload!.issued_at).toBe(originalIssuedAt);
    });

    // TS-8.3
    it("does not re-issue the session cookie when ui_language is unchanged", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "en",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 }),
      );

      const { app } = await createTestSettingsWithSecret();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "en" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).not.toMatch(/cortex_session=[^;]/);
    });

    // TS-8.4
    it("keeps the user authenticated after re-issuing with a new locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "en",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 }),
      );

      const { app } = await createTestSettingsWithSecret();
      const cookie = await loginAndGetCookie(app);

      const postRes = await app.request("/settings", {
        method: "POST",
        body: buildFormData({ ui_language: "de" }),
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const newCookie =
        postRes.headers.get("set-cookie")?.split(";")[0] ?? cookie;

      // Update the mock to reflect the now-persisted new locale so the
      // follow-up GET renders in German.
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "de",
      });

      const getRes = await app.request("/settings", {
        headers: { Cookie: newCookie },
      });

      expect(getRes.status).toBe(200);
    });
  });
});
