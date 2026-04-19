/**
 * Unit tests for the onboarding wizard & setup flow.
 * Tests setup detection, account creation, step flow, login rewrite, and edge cases.
 *
 * Scenarios: TS-1.1, TS-1.2, TS-1.3, TS-1.4a, TS-1.4b,
 *            TS-2.1, TS-2.5,
 *            TS-3.1, TS-3.2, TS-3.3,
 *            TS-4.1, TS-4.2, TS-4.3,
 *            TS-5.1, TS-5.2, TS-5.3,
 *            TS-6.1, TS-6.2, TS-6.3a, TS-6.3b, TS-6.4,
 *            TS-E1, TS-E2, TS-E3, TS-E4, TS-E5, TS-E6, TS-E10, TS-E11
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// ─── Module Mocks (hoisted) ─────────────────────────────────────────

vi.mock("../../src/web/setup-queries.js", () => ({
  getUserCount: vi.fn().mockResolvedValue(0),
  getUserPasswordHash: vi.fn().mockResolvedValue(null),
  createUser: vi.fn().mockResolvedValue({ id: 1 }),
  getSetupSummary: vi.fn().mockResolvedValue({
    hasUser: true,
    hasLLM: false,
    hasTelegram: false,
  }),
}));

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

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2b$12$mockedhashvalue"),
    compare: vi.fn().mockImplementation(
      (password: string, hash: string) =>
        Promise.resolve(password === "correct-password"),
    ),
  },
  hash: vi.fn().mockResolvedValue("$2b$12$mockedhashvalue"),
  compare: vi.fn().mockImplementation(
    (password: string, hash: string) =>
      Promise.resolve(password === "correct-password"),
  ),
}));

// ─── Constants ──────────────────────────────────────────────────────

const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Creates a Hono app with setup/auth middleware and routes.
 * Accepts optional overrides for mock behavior.
 */
async function createSetupApp(
  overrides?: {
    getUserCount?: number;
    getUserPasswordHash?: string | null;
    createUser?: { id: number } | Error;
    getSetupSummary?: {
      hasUser: boolean;
      hasLLM: boolean;
      hasTelegram: boolean;
    };
  },
): Promise<Hono> {
  // Apply overrides to mocks
  const {
    getUserCount,
    getUserPasswordHash,
    createUser,
    getSetupSummary,
  } = await import("../../src/web/setup-queries.js");

  if (overrides?.getUserCount !== undefined) {
    (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(
      overrides.getUserCount,
    );
  }
  if (overrides?.getUserPasswordHash !== undefined) {
    (getUserPasswordHash as ReturnType<typeof vi.fn>).mockResolvedValue(
      overrides.getUserPasswordHash,
    );
  }
  if (overrides?.createUser !== undefined) {
    if (overrides.createUser instanceof Error) {
      (createUser as ReturnType<typeof vi.fn>).mockRejectedValue(
        overrides.createUser,
      );
    } else {
      (createUser as ReturnType<typeof vi.fn>).mockResolvedValue(
        overrides.createUser,
      );
    }
  }
  if (overrides?.getSetupSummary !== undefined) {
    (getSetupSummary as ReturnType<typeof vi.fn>).mockResolvedValue(
      overrides.getSetupSummary,
    );
  }

  const { createSetupRoutes, createSetupMiddleware } = await import(
    "../../src/web/setup.js"
  );

  const mockSql = {} as any;

  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );

  const app = new Hono();
  app.use("*", createSetupMiddleware(mockSql));
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(mockSql, TEST_SECRET));
  app.route("/", createSetupRoutes(mockSql, TEST_SECRET));

  // Stub protected routes for testing redirects
  app.get("/", (c) => c.text("Dashboard"));
  app.get("/browse", (c) => c.text("Browse"));

  return app;
}

/**
 * Posts valid account data to step 1 and returns the session cookie.
 * Used as setup for step 2/3/4 tests that require authentication.
 */
async function completeStep1(app: Hono): Promise<string> {
  const res = await app.request("/setup/step/1", {
    method: "POST",
    body: new URLSearchParams({
      display_name: "Eike",
      password: "securepass123",
      confirm_password: "securepass123",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(
      "No Set-Cookie header after step 1 — account creation failed",
    );
  }
  return setCookie.split(";")[0]!;
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Onboarding Wizard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-apply default mock implementations after clearAllMocks
    const { getUserCount, getUserPasswordHash, createUser, getSetupSummary } =
      await import("../../src/web/setup-queries.js");
    (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (getUserPasswordHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (createUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1 });
    (getSetupSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasUser: true,
      hasLLM: false,
      hasTelegram: false,
    });

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

    // Re-apply bcrypt mock defaults
    const bcrypt = (await import("bcryptjs")).default;
    (bcrypt.hash as ReturnType<typeof vi.fn>).mockResolvedValue("$2b$12$mockedhashvalue");
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockImplementation(
      (password: string) => Promise.resolve(password === "correct-password"),
    );

    // Default fetch mock — Ollama check
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Setup Mode Detection
  // ═══════════════════════════════════════════════════════════════════
  describe("Setup Mode Detection", () => {
    // TS-1.1
    it("TS-1.1 — redirects to /setup when no user exists", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup");
    });

    // TS-1.2
    it("TS-1.2 — /setup serves wizard step 1", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/display.?name/i);
      expect(body).toMatch(/<input[^>]*name=["']password["']/i);
      expect(body).toMatch(/<input[^>]*name=["']confirm_password["']/i);
    });

    // TS-1.3
    it("TS-1.3 — wizard steps follow defined order", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );

      const app = await createSetupApp({ getUserCount: 0 });

      // Step 1: POST valid account data -> redirect to step 2
      const step1Res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Eike",
          password: "securepass123",
          confirm_password: "securepass123",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(step1Res.status).toBe(302);
      expect(step1Res.headers.get("location")).toBe("/setup/step/2");

      const sessionCookie = step1Res.headers.get("set-cookie")!.split(";")[0]!;

      // Step 2: POST skip -> redirect to step 3
      const step2Res = await app.request("/setup/step/2", {
        method: "POST",
        body: new URLSearchParams({ action: "skip" }),
        headers: {
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(step2Res.status).toBe(302);
      expect(step2Res.headers.get("location")).toBe("/setup/step/3");

      // Step 3: POST skip -> redirect to step 4
      const step3Res = await app.request("/setup/step/3", {
        method: "POST",
        body: new URLSearchParams({ action: "skip" }),
        headers: {
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(step3Res.status).toBe(302);
      expect(step3Res.headers.get("location")).toBe("/setup/step/4");

      // Step 4: GET -> 200 with summary content
      const step4Res = await app.request("/setup/step/4", {
        headers: { Cookie: sessionCookie },
      });

      expect(step4Res.status).toBe(200);
      const body = await step4Res.text();
      expect(body).toMatch(/account/i);
    });

    // TS-1.4a
    it("TS-1.4a — LLM step can be skipped", async () => {
      const { saveLLMConfig } = await import("../../src/llm/config.js");

      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/2", {
        method: "POST",
        body: new URLSearchParams({ action: "skip" }),
        headers: {
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/3");
      expect(saveLLMConfig).not.toHaveBeenCalled();
    });

    // TS-1.4b
    it("TS-1.4b — Telegram step can be skipped", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );

      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/3", {
        method: "POST",
        body: new URLSearchParams({ action: "skip" }),
        headers: {
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/4");
      // saveAllSettings should NOT have been called with telegram_bot_token
      if ((saveAllSettings as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        for (const call of (saveAllSettings as ReturnType<typeof vi.fn>).mock
          .calls) {
          const settingsArg = call[1] as Record<string, string>;
          expect(settingsArg).not.toHaveProperty("telegram_bot_token");
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Account Creation (Step 1)
  // ═══════════════════════════════════════════════════════════════════
  describe("Account Creation (Step 1)", () => {
    // TS-2.1
    it("TS-2.1 — account step presents required fields", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<input[^>]*name=["']display_name["']/i);
      expect(body).toMatch(
        /<input[^>]*type=["']password["'][^>]*name=["']password["']/i,
      );
      expect(body).toMatch(
        /<input[^>]*name=["']confirm_password["']/i,
      );
    });

    // TS-2.5
    it("TS-2.5 — auto-login after account creation", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Eike",
          password: "securepass123",
          confirm_password: "securepass123",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/2");

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("cortex_session");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Language Model Configuration (Step 2)
  // ═══════════════════════════════════════════════════════════════════
  describe("Language Model Configuration (Step 2)", () => {
    // TS-3.1
    it("TS-3.1 — LLM step presents provider and model fields", async () => {
      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/2", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<select[^>]*name=["']llm_provider["']/i);
      expect(body).toContain("Anthropic");
      expect(body).toContain("OpenAI (ChatGPT)");
      expect(body).toContain("Groq");
      expect(body).toContain("Gemini");
      expect(body).toContain("LM Studio");
      expect(body).toContain("Ollama (Local)");
      expect(body).toMatch(/<input[^>]*name=["']llm_model["']/i);
    });

    // TS-3.2
    it("TS-3.2 — Ollama provider shows Ollama-specific UI", async () => {
      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/2", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Ollama section present in HTML with recommended model chips
      expect(body).toContain("ollama-section");
      expect(body).toContain("qwen2.5:7b");
      expect(body).toContain("qwen2.5:3b");
      expect(body).toMatch(/downloaded.?automatically/i);
    });

    // TS-3.3
    it("TS-3.3 — LLM configuration saved on submit", async () => {
      const { saveLLMConfig } = await import("../../src/llm/config.js");

      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/2", {
        method: "POST",
        body: new URLSearchParams({
          llm_provider: "anthropic",
          llm_model: "claude-sonnet-4-20250514",
          apikey_anthropic: "sk-test",
        }),
        headers: {
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/3");
      expect(saveLLMConfig).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        }),
      );
      // Verify API key was included
      const callArgs = (saveLLMConfig as ReturnType<typeof vi.fn>).mock
        .calls[0]![1] as { apiKeys?: Record<string, string> };
      expect(callArgs.apiKeys?.anthropic).toBe("sk-test");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Telegram Configuration (Step 3)
  // ═══════════════════════════════════════════════════════════════════
  describe("Telegram Configuration (Step 3)", () => {
    // TS-4.1
    it("TS-4.1 — Telegram step presents token and chat ID fields", async () => {
      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/3", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<input[^>]*name=["']telegram_bot_token["']/i);
      expect(body).toMatch(/<input[^>]*name=["']telegram_chat_id["']/i);
    });

    // TS-4.2
    it("TS-4.2 — help text for BotFather", async () => {
      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/3", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/botfather/i);
      expect(body).toMatch(/chat.?id/i);
    });

    // TS-4.3
    it("TS-4.3 — Telegram config saved on submit", async () => {
      const { saveAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );

      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/3", {
        method: "POST",
        body: new URLSearchParams({
          telegram_bot_token: "123:ABC",
          telegram_chat_id: "456789",
        }),
        headers: {
          Cookie: sessionCookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/4");
      expect(saveAllSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          telegram_bot_token: "123:ABC",
          telegram_chat_ids: "456789",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Done Step (Step 4)
  // ═══════════════════════════════════════════════════════════════════
  describe("Done Step (Step 4)", () => {
    // TS-5.1
    it("TS-5.1 — done summary shows configured features", async () => {
      const { getSetupSummary } = await import(
        "../../src/web/setup-queries.js"
      );
      (getSetupSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
        hasUser: true,
        hasLLM: true,
        hasTelegram: true,
      });

      const app = await createSetupApp({
        getUserCount: 0,
        getSetupSummary: { hasUser: true, hasLLM: true, hasTelegram: true },
      });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/4", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/account/i);
      expect(body).toMatch(/configured|✓|complete/i);
      // LLM and Telegram should show as configured
      expect(body).toMatch(/language.?model|llm/i);
      expect(body).toMatch(/telegram/i);
    });

    // TS-5.2
    it("TS-5.2 — done summary shows skipped features with Settings note", async () => {
      const app = await createSetupApp({
        getUserCount: 0,
        getSetupSummary: { hasUser: true, hasLLM: false, hasTelegram: false },
      });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/4", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Skipped steps should mention Settings
      expect(body).toMatch(/settings/i);
      // Should indicate LLM and Telegram are skipped/not configured
      expect(body).toMatch(/skip|not.?configured|later/i);
    });

    // TS-5.3
    it("TS-5.3 — done step has Go to Dashboard button", async () => {
      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/4", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<a[^>]*href=["']\/["']/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Login (Returning User)
  // ═══════════════════════════════════════════════════════════════════
  describe("Login (Returning User)", () => {
    // TS-6.1
    it("TS-6.1 — protected routes redirect to /login when user exists", async () => {
      const app = await createSetupApp({ getUserCount: 1 });

      const res = await app.request("/");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/\/login/);
    });

    // TS-6.2
    it("TS-6.2 — login page presents password field and button", async () => {
      const app = await createSetupApp({ getUserCount: 1 });

      const res = await app.request("/login");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<input[^>]*type=["']password["']/i);
      expect(body).toMatch(/log\s*in/i);
    });

    // TS-6.3a
    it("TS-6.3a — successful login with correct password", async () => {
      const app = await createSetupApp({
        getUserCount: 1,
        getUserPasswordHash: "$2b$12$mockedhashvalue",
      });

      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: "correct-password" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("cortex_session");
    });

    // TS-6.3b
    it("TS-6.3b — failed login with wrong password", async () => {
      const app = await createSetupApp({
        getUserCount: 1,
        getUserPasswordHash: "$2b$12$mockedhashvalue",
      });

      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: "wrong-password" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeNull();

      const body = await res.text();
      expect(body).toMatch(/invalid.?password/i);
    });

    // TS-6.4
    it("TS-6.4 — login page uses design system", async () => {
      const app = await createSetupApp({ getUserCount: 1 });

      const res = await app.request("/login");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("JetBrains");
      expect(body).toContain("style.css");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════
  describe("Edge Cases", () => {
    // TS-E1
    it("TS-E1 — /setup redirects to /login when user exists", async () => {
      const app = await createSetupApp({ getUserCount: 1 });

      const res = await app.request("/setup");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    // TS-E2
    it("TS-E2 — /login redirects to /setup when no user exists", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/login");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup");
    });

    // TS-E3
    it("TS-E3 — password shorter than 8 characters rejected", async () => {
      const { createUser } = await import("../../src/web/setup-queries.js");

      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Eike",
          password: "short",
          confirm_password: "short",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/minimum|at least 8|too short/i);
      expect(createUser).not.toHaveBeenCalled();
    });

    // TS-E4
    it("TS-E4 — mismatched passwords rejected", async () => {
      const { createUser } = await import("../../src/web/setup-queries.js");

      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Eike",
          password: "password123",
          confirm_password: "different456",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/match|do not match|don't match/i);
      expect(createUser).not.toHaveBeenCalled();
    });

    // TS-E5
    it("TS-E5 — direct navigation to later step redirects to step 1", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup/step/3");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup");
    });

    // TS-E6
    it("TS-E6 — refreshing Done page shows summary without side effects", async () => {
      const { getUserCount, createUser } = await import(
        "../../src/web/setup-queries.js"
      );

      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      // After step 1 completes, user exists — reset getUserCount to 1
      (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      // Clear createUser call count from step 1
      (createUser as ReturnType<typeof vi.fn>).mockClear();

      // First GET of step 4
      const res1 = await app.request("/setup/step/4", {
        headers: { Cookie: sessionCookie },
      });

      expect(res1.status).toBe(200);
      const body1 = await res1.text();

      // Second GET of step 4 (refresh)
      const res2 = await app.request("/setup/step/4", {
        headers: { Cookie: sessionCookie },
      });

      expect(res2.status).toBe(200);
      const body2 = await res2.text();

      // Both should contain summary content
      expect(body1).toMatch(/account/i);
      expect(body2).toMatch(/account/i);

      // createUser should NOT have been called again
      expect(createUser).not.toHaveBeenCalled();
    });

    // TS-E10
    it("TS-E10 — Ollama unreachable in step 2 still renders recommended models", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("ECONNREFUSED"),
      );

      const app = await createSetupApp({ getUserCount: 0 });
      const sessionCookie = await completeStep1(app);

      const res = await app.request("/setup/step/2", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      // Recommended models are hardcoded, not fetched — always available
      expect(body).toContain("qwen2.5:7b");
      // Form should still be submittable
      expect(body).toMatch(/<button[^>]*type=["']submit["']/i);
    });

    // TS-E11
    it("TS-E11 — empty display name stored as NULL", async () => {
      const { createUser } = await import("../../src/web/setup-queries.js");

      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "",
          password: "securepass123",
          confirm_password: "securepass123",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/2");

      // createUser should have been called with null display name
      expect(createUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          displayName: null,
        }),
      );
    });
  });

  // =========================================================================
  // Auth-refactor Group 6 — Setup wizard after session.ts refactor
  // Scenarios: TS-6.1 (auto-login cookie carries Accept-Language locale)
  // =========================================================================
  describe("Setup wizard after auth-refactor (Group 6)", () => {
    function extractSessionToken(setCookie: string | null): string | null {
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

    // TS-6.1
    it("auto-issues a session cookie with Accept-Language locale after step-1 user creation", async () => {
      const app = await createSetupApp({ getUserCount: 0 });

      const res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Tester",
          password: "a-password-at-least-8",
          confirm_password: "a-password-at-least-8",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/2");

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toMatch(/cortex_session=/);

      const token = extractSessionToken(setCookie);
      expect(token).not.toBeNull();
      const payload = decodePayload(token!);
      expect(payload).not.toBeNull();
      expect(payload!.locale).toBe("de");
      expect(typeof payload!.issued_at).toBe("number");
    });

    // TS-6.3 — Step 1 same-session double-submit silently advances
    it("advances step-1 double-submit when the caller already holds a valid session", async () => {
      const { getUserCount } = await import(
        "../../src/web/setup-queries.js"
      );

      // First: create a user and obtain a valid session cookie.
      (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(0);
      const app = await createSetupApp();
      const initialRes = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Tester",
          password: "a-password-at-least-8",
          confirm_password: "a-password-at-least-8",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(initialRes.status).toBe(302);
      const sessionCookie =
        initialRes.headers.get("set-cookie")?.split(";")[0] ?? "";
      expect(sessionCookie).toMatch(/^cortex_session=/);

      // Second submit: user now exists and the caller presents the cookie.
      (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      const res = await app.request("/setup/step/1", {
        method: "POST",
        body: new URLSearchParams({
          display_name: "Tester",
          password: "a-password-at-least-8",
          confirm_password: "a-password-at-least-8",
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: sessionCookie,
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup/step/2");
      // No new cookie is minted on the silent-advance path.
      const setCookieOnAdvance = res.headers.get("set-cookie");
      expect(setCookieOnAdvance).toBeNull();
    });

    // TS-6.5 — Steps 2-4 require a valid session
    it("redirects /setup/step/2 to /setup when no session is present", async () => {
      const app = await createSetupApp({ getUserCount: 1 });

      const res = await app.request("/setup/step/2");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup");
    });
  });
});
