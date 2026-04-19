/**
 * Unit tests for src/web/auth.ts after the auth-refactor.
 *
 * Groups: login (4.*), logout (5.*), session payload & locale (7.*),
 * regression coverage for the existing middleware contracts (expiry, tampering,
 * rotation, redirect-to-login).
 *
 * Scenarios from auth-refactor-test-specification.md:
 *   TS-4.1, TS-4.2, TS-4.3, TS-4.3b, TS-4.4, TS-4.5, TS-4.6, TS-4.7,
 *   TS-5.1,
 *   TS-7.1, TS-7.2, TS-7.3, TS-7.4.
 *
 * Plus regression tests preserved from the pre-refactor suite (mapped to AC-3.1
 * "existing test suite continues to pass").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

// ─── Module mocks (hoisted) ────────────────────────────────────────

// bcrypt hash of "test-password" (cost 10). Inlined constant; avoids running
// bcrypt for every test. Exposed so individual tests can override it.
const TEST_PASSWORD_HASH =
  "$2b$10$fT48FucaYsd.UewWh8yHfeSSuDImEjthP.X2wLVChUyMOGwVtm6..";

// `vi.restoreAllMocks()` wipes `mockResolvedValue` from `vi.fn()` instances
// created inside `vi.mock` factories. Stable defaults therefore live as
// plain async closures; only the mocks tests need to override or assert on
// via `.toHaveBeenCalled` stay as `vi.fn`.
vi.mock("../../src/web/setup-queries.js", () => ({
  getUserCount: vi.fn().mockResolvedValue(1),
  getUserPasswordHash: async () => TEST_PASSWORD_HASH,
  getDisplayName: async () => null,
  createUser: async () => ({ id: 1 }),
  getSetupSummary: async () => ({
    hasUser: true,
    hasLLM: false,
    hasTelegram: false,
  }),
}));

vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
  saveAllSettings: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Build a Hono app that mounts the refactored auth middleware + routes. The
 * factory now takes `sql` (used for bcrypt password lookup and ui_language
 * seeding) plus the signing secret.
 */
async function createTestApp(secret: string = TEST_SECRET): Promise<Hono> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );

  const mockSql = {} as any;

  const app = new Hono();
  app.use("*", createAuthMiddleware(secret));
  app.route("/", createAuthRoutes(mockSql, secret));

  // Protected stubs for middleware assertions.
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/dashboard", (c) => c.text("Dashboard"));
  app.get("/browse", (c) => c.text("Browse"));
  app.get("/api/entries", (c) => c.json({ entries: [] }));
  app.get("/whoami", (c) => c.json({ locale: c.get("locale") }));

  return app;
}

async function postLogin(
  app: Hono,
  password = TEST_PASSWORD,
  opts: {
    acceptLanguage?: string;
    redirectTo?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (opts.acceptLanguage) headers["Accept-Language"] = opts.acceptLanguage;

  const path = opts.redirectTo
    ? `/login?redirect=${encodeURIComponent(opts.redirectTo)}`
    : "/login";

  return app.request(path, {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers,
  });
}

async function loginAndGetCookie(
  app: Hono,
  password = TEST_PASSWORD,
): Promise<string> {
  const res = await postLogin(app, password);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("No Set-Cookie header in login response");
  }
  return setCookie.split(";")[0]!;
}

function extractSetCookieSession(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/cortex_session=([^;]+)/);
  if (!match || !match[1]) return null;
  return decodeURIComponent(match[1]);
}

function decodePayload(token: string): Record<string, unknown> | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;
  try {
    return JSON.parse(token.substring(0, dotIdx)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeSessionPayload(
  setCookie: string | null,
): Record<string, unknown> | null {
  const token = extractSetCookieSession(setCookie);
  if (!token) return null;
  return decodePayload(token);
}

describe("Web Auth (post-refactor)", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Restore default vi.fn return values after any prior test override.
    const { getUserCount } = await import("../../src/web/setup-queries.js");
    (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const { getAllSettings } = await import(
      "../../src/web/settings-queries.js"
    );
    (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // Group 4 — Login
  // =========================================================================
  describe("Login (Group 4)", () => {
    // TS-4.1
    it("issues a session cookie and redirects to / on correct credentials", async () => {
      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD, { acceptLanguage: "en" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toMatch(/cortex_session=/);

      const payload = decodeSessionPayload(setCookie);
      expect(payload).not.toBeNull();
      expect(payload!.locale).toBe("en");
      expect(typeof payload!.issued_at).toBe("number");
    });

    // TS-4.2
    it("seeds cookie locale from ui_language setting when present", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "de",
      });

      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD, { acceptLanguage: "en" });

      const payload = decodeSessionPayload(res.headers.get("set-cookie"));
      expect(payload!.locale).toBe("de");
      expect(getAllSettings).toHaveBeenCalledTimes(1);
    });

    // TS-4.3
    it("falls back to Accept-Language when ui_language is unset", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD, { acceptLanguage: "de" });

      const payload = decodeSessionPayload(res.headers.get("set-cookie"));
      expect(payload!.locale).toBe("de");
    });

    // TS-4.3b
    it("falls back to Accept-Language when ui_language holds an unsupported value", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "xyz",
      });

      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD, { acceptLanguage: "de" });

      const payload = decodeSessionPayload(res.headers.get("set-cookie"));
      expect(payload!.locale).toBe("de");
    });

    // TS-4.4
    it("falls back to en when neither ui_language nor Accept-Language is present", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD);

      const payload = decodeSessionPayload(res.headers.get("set-cookie"));
      expect(payload!.locale).toBe("en");
    });

    // TS-4.5
    it("does not issue a cookie on incorrect credentials", async () => {
      const app = await createTestApp();
      const res = await postLogin(app, "wrong-password");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.toLowerCase()).toMatch(/invalid|wrong|incorrect/);

      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        expect(setCookie).not.toMatch(/cortex_session=[^;]+/);
      }
    });

    // TS-4.6
    it("honours the redirect query parameter after login", async () => {
      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD, { redirectTo: "/browse" });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/browse");
    });

    // TS-4.7
    it("redirects to /setup when no user exists", async () => {
      const { getUserCount } = await import(
        "../../src/web/setup-queries.js"
      );
      (getUserCount as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/setup");
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        expect(setCookie).not.toMatch(/cortex_session=[^;=]+[^;]/);
      }
    });
  });

  // =========================================================================
  // Group 5 — Logout
  // =========================================================================
  describe("Logout (Group 5)", () => {
    // TS-5.1
    it("clears the session cookie and redirects to /login on logout", async () => {
      const app = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/logout", {
        method: "POST",
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");

      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toMatch(/cortex_session=/);
      expect(setCookie.toLowerCase()).toMatch(
        /max-age=0|expires=thu, 01 jan 1970/,
      );
    });
  });

  // =========================================================================
  // Group 7 — Session payload & c.get("locale")
  // =========================================================================
  describe("Session payload and locale (Group 7)", () => {
    // TS-7.1
    it("issues a cookie whose payload has exactly issued_at and locale", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "de",
      });

      const app = await createTestApp();
      const res = await postLogin(app, TEST_PASSWORD);

      const payload = decodeSessionPayload(res.headers.get("set-cookie"))!;
      expect(Object.keys(payload).sort()).toEqual(["issued_at", "locale"]);
      expect(typeof payload.issued_at).toBe("number");
      expect(typeof payload.locale).toBe("string");
      expect(payload.locale).toBe("de");
    });

    // TS-7.2
    it("exposes the cookie locale via c.get(\"locale\") on authenticated requests", async () => {
      const { getAllSettings } = await import(
        "../../src/web/settings-queries.js"
      );
      (getAllSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        ui_language: "de",
      });

      const app = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      // Mount the locale middleware too, since c.get("locale") is set by it.
      const { createLocaleMiddleware } = await import(
        "../../src/web/i18n/middleware.js"
      );
      const authedApp = new Hono();
      authedApp.use("*", createLocaleMiddleware(TEST_SECRET));
      const { createAuthMiddleware } = await import("../../src/web/auth.js");
      authedApp.use("*", createAuthMiddleware(TEST_SECRET));
      authedApp.get("/whoami", (c) => c.json({ locale: c.get("locale") }));

      const res = await authedApp.request("/whoami", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { locale: string };
      expect(body.locale).toBe("de");
    });

    // TS-7.3
    it("falls back to \"en\" in c.get(\"locale\") when the cookie locale is unsupported", async () => {
      const { sign } = await import("../../src/web/session.js");
      const payload = JSON.stringify({
        issued_at: Date.now(),
        locale: "xyz",
      });
      const token = sign(payload, TEST_SECRET);
      const cookie = `cortex_session=${encodeURIComponent(token)}`;

      const { createLocaleMiddleware } = await import(
        "../../src/web/i18n/middleware.js"
      );
      const { createAuthMiddleware } = await import("../../src/web/auth.js");

      const app = new Hono();
      app.use("*", createLocaleMiddleware(TEST_SECRET));
      app.use("*", createAuthMiddleware(TEST_SECRET));
      app.get("/whoami", (c) => c.json({ locale: c.get("locale") }));

      const res = await app.request("/whoami", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { locale: string };
      expect(body.locale).toBe("en");
    });

    // TS-7.4
    it("redirects to /login when the cookie payload lacks a locale field", async () => {
      const { sign } = await import("../../src/web/session.js");
      const payload = JSON.stringify({ issued_at: Date.now() });
      const token = sign(payload, TEST_SECRET);
      const cookie = `cortex_session=${encodeURIComponent(token)}`;

      const app = await createTestApp();
      const res = await app.request("/dashboard", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")!).toMatch(/^\/login/);
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  // =========================================================================
  // Regression coverage — middleware behavior preserved from the pre-refactor
  // test suite. These assertions map to AC-3.1 "existing test suite continues
  // to pass" and are the same observable contracts as before.
  // =========================================================================
  describe("Middleware regression", () => {
    it("redirects unauthenticated requests to /login with redirect param", async () => {
      const app = await createTestApp();
      const res = await app.request("/dashboard");

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toContain("/login");
      expect(location).toMatch(/redirect=%2Fdashboard|redirect=\/dashboard/);
    });

    it("returns 401 for unauthenticated /api/* requests", async () => {
      const app = await createTestApp();
      const res = await app.request("/api/entries");

      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
    });

    it("allows unauthenticated access to /health", async () => {
      const app = await createTestApp();
      const res = await app.request("/health");

      expect(res.status).toBe(200);
    });

    it("allows authenticated access to protected routes", async () => {
      const app = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/dashboard", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Dashboard");
    });

    it("redirects authenticated user from /login to /", async () => {
      const app = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const res = await app.request("/login", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    it("redirects to /login when session cookie is expired", async () => {
      vi.useFakeTimers();

      const app = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      vi.advanceTimersByTime(THIRTY_ONE_DAYS_MS);

      const res = await app.request("/dashboard", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")!).toMatch(/^\/login/);
    });

    it("treats tampered cookie as absent and redirects to /login", async () => {
      const app = await createTestApp();
      const cookie = await loginAndGetCookie(app);

      const [name, ...valueParts] = cookie.split("=");
      const value = valueParts.join("=");
      const dotIdx = value.lastIndexOf(".");
      const victimIdx = dotIdx + 5;
      const victim = value[victimIdx];
      const replacement = victim === "A" ? "B" : "A";
      const tampered =
        value.slice(0, victimIdx) + replacement + value.slice(victimIdx + 1);
      const tamperedCookie = `${name}=${tampered}`;

      const res = await app.request("/dashboard", {
        headers: { Cookie: tamperedCookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")!).toMatch(/^\/login/);
    });

    it("rejects cookies signed with a rotated SESSION_SECRET", async () => {
      const originalSecret = "original-secret-at-least-32-characters!!";
      const rotatedSecret = "rotated-secret-at-least-32-characters!!!";

      const app1 = await createTestApp(originalSecret);
      const cookie = await loginAndGetCookie(app1);

      const app2 = await createTestApp(rotatedSecret);
      const res = await app2.request("/dashboard", {
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")!).toMatch(/^\/login/);
    });

    it("cookie is HttpOnly, SameSite=Lax, 30-day Max-Age", async () => {
      const app = await createTestApp();
      const res = await postLogin(app);

      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain(`Max-Age=${THIRTY_DAYS_SECONDS}`);
    });
  });
});
