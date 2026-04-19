/**
 * Static wiring checks for the auth-refactor.
 *
 * These assertions guard the structural ACs from US-2 of the behavioral spec:
 *  - AC-2.2 auth.ts contains no duplicate session helpers
 *  - AC-2.3 setup.ts contains no duplicate session helpers
 *  - AC-2.4 index.ts uses auth middleware from auth.ts
 *  - AC-2.5 setup.ts does not register /login or /logout handlers
 *
 * Scenarios: TS-3.1, TS-3.2, TS-3.3, TS-3.4
 */

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";

// ─── Mock the DB seams used by createSetupRoutes so we can mount it in isolation
// for the TS-3.4 route-registration check. These mirror the mocks used in
// tests/unit/onboarding.test.ts so the setup module imports cleanly.

vi.mock("../../src/web/setup-queries.js", () => ({
  getUserCount: vi.fn().mockResolvedValue(1),
  getUserPasswordHash: vi.fn().mockResolvedValue(null),
  createUser: vi.fn().mockResolvedValue({ id: 1 }),
  getSetupSummary: vi.fn().mockResolvedValue({
    hasUser: true,
    hasLLM: false,
    hasTelegram: false,
  }),
  getDisplayName: vi.fn().mockResolvedValue(null),
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

const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function readSource(relativePath: string): Promise<string> {
  return readFile(pathResolve(process.cwd(), relativePath), "utf8");
}

describe("auth-refactor wiring", () => {
  // TS-3.1
  it("src/index.ts wires auth middleware and routes from auth.ts", async () => {
    const src = await readSource("src/index.ts");

    expect(src).toMatch(
      /import\s+\{[^}]*createAuthMiddleware[^}]*\}\s+from\s+["']\.\/web\/auth\.js["']/,
    );
    expect(src).toMatch(
      /import\s+\{[^}]*createAuthRoutes[^}]*\}\s+from\s+["']\.\/web\/auth\.js["']/,
    );
    // And index.ts must NOT be importing those two names from setup.ts.
    expect(src).not.toMatch(
      /import\s+\{[^}]*createAuthMiddleware[^}]*\}\s+from\s+["']\.\/web\/setup\.js["']/,
    );
    expect(src).not.toMatch(
      /import\s+\{[^}]*createAuthRoutes[^}]*\}\s+from\s+["']\.\/web\/setup\.js["']/,
    );
  });

  // TS-3.2
  it("src/web/auth.ts contains no duplicate session helpers", async () => {
    const src = await readSource("src/web/auth.ts");

    expect(src).not.toMatch(/^function\s+sign\s*\(/m);
    expect(src).not.toMatch(/^function\s+verify\s*\(/m);
    expect(src).not.toMatch(/^function\s+parseCookies\s*\(/m);
    expect(src).not.toMatch(/^function\s+getSessionPayload\s*\(/m);

    expect(src).toMatch(/from\s+["']\.\/session\.js["']/);
  });

  // TS-3.3
  it("src/web/setup.ts contains no duplicate session helpers", async () => {
    const src = await readSource("src/web/setup.ts");

    expect(src).not.toMatch(/^function\s+sign\s*\(/m);
    expect(src).not.toMatch(/^function\s+verify\s*\(/m);
    expect(src).not.toMatch(/^function\s+parseCookies\s*\(/m);
    expect(src).not.toMatch(/^function\s+getSessionPayload\s*\(/m);
    expect(src).not.toMatch(/^function\s+isAuthenticated\s*\(/m);
    expect(src).not.toMatch(/^function\s+setSessionCookie\s*\(/m);

    expect(src).toMatch(/from\s+["']\.\/session\.js["']/);
  });

  // TS-3.4
  it("createSetupRoutes does not register /login or /logout handlers", async () => {
    const { createSetupRoutes } = await import("../../src/web/setup.js");

    const app = new Hono();
    app.route("/", createSetupRoutes({} as any, TEST_SECRET));

    const loginRes = await app.request("/login", { method: "POST" });
    expect(loginRes.status).toBe(404);

    const logoutRes = await app.request("/logout", { method: "POST" });
    expect(logoutRes.status).toBe(404);
  });
});
