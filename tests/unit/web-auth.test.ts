import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60; // 2592000
const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

async function createTestApp(
  password = TEST_PASSWORD,
  secret = TEST_SECRET,
): Promise<Hono> {
  const { createAuthMiddleware, createAuthRoutes } = await import(
    "../../src/web/auth.js"
  );

  const app = new Hono();
  app.use("*", createAuthMiddleware(secret));
  app.route("/", createAuthRoutes(password, secret));

  // Stub protected routes for testing
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/dashboard", (c) => c.text("Dashboard"));
  app.get("/browse", (c) => c.text("Browse"));
  app.get("/api/entries", (c) => c.json({ entries: [] }));

  return app;
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
  // Parse cookie name=value from Set-Cookie header
  return setCookie.split(";")[0]!;
}

describe("Web Auth", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // Group 1: Login (US-1)
  // =========================================================================
  describe("Login (US-1)", () => {
    // TS-1.1
    it("renders a login page with a password form", async () => {
      const app = await createTestApp();
      const res = await app.request("/login");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<input[^>]*type=["']password["']/i);
      expect(body).toMatch(/<button|<input[^>]*type=["']submit["']/i);
    });

    // TS-1.2
    it("redirects to home on correct password", async () => {
      const app = await createTestApp();
      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      expect(res.headers.get("set-cookie")).toBeTruthy();
    });

    // TS-1.3
    it("re-renders login with error on incorrect password", async () => {
      const app = await createTestApp();
      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: "wrong-password" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.toLowerCase()).toContain("invalid password");
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    // TS-1.4
    it("redirects to original URL after login when redirect param present", async () => {
      const app = await createTestApp();
      const res = await app.request("/login?redirect=/browse", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/browse");
    });

    // TS-1.5
    it("sets session cookie with HttpOnly, SameSite=Lax, and signed value", async () => {
      const app = await createTestApp();
      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toBeTruthy();

      const lower = setCookie.toLowerCase();
      expect(lower).toContain("httponly");
      expect(lower).toContain("samesite=lax");

      // Cookie value should not be plaintext — contains a signature separator
      const cookieValue = setCookie.split(";")[0]!.split("=").slice(1).join("=");
      expect(cookieValue).toMatch(/[.:]|%/);
    });

    // TS-1.6
    it("session cookie value does not contain the password", async () => {
      const knownPassword = "my-secret-password-123";
      const app = await createTestApp(knownPassword);
      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: knownPassword }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toBeTruthy();
      expect(setCookie).not.toContain(knownPassword);
      expect(decodeURIComponent(setCookie)).not.toContain(knownPassword);
    });

    // TS-1.7
    it("session cookie has max-age of 30 days", async () => {
      const app = await createTestApp();
      const res = await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toBeTruthy();

      const lower = setCookie.toLowerCase();
      expect(lower).toContain(`max-age=${THIRTY_DAYS_SECONDS}`);
    });

    // TS-1.8
    it("logs failed login attempt with timestamp", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      const app = await createTestApp();
      await app.request("/login", {
        method: "POST",
        body: new URLSearchParams({ password: "wrong-password" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(stdoutSpy).toHaveBeenCalled();

      const logCalls = stdoutSpy.mock.calls
        .map((call) => call[0] as string)
        .filter((s) => {
          try {
            const parsed = JSON.parse(s);
            return parsed.level === "warn" || parsed.level === "error";
          } catch {
            return false;
          }
        });

      expect(logCalls.length).toBeGreaterThan(0);

      const logEntry = JSON.parse(logCalls[0]!);
      expect(logEntry.timestamp).toBeTruthy();
      expect(logEntry.message.toLowerCase()).toMatch(/fail|invalid|unauthori/);
    });
  });

  // =========================================================================
  // Group 2: Route Protection (US-2)
  // =========================================================================
  describe("Route Protection (US-2)", () => {
    // TS-2.1
    it("redirects unauthenticated requests to /login", async () => {
      const app = await createTestApp();
      const res = await app.request("/dashboard");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/login/);
    });

    // TS-2.2
    it("includes original URL as redirect query parameter", async () => {
      const app = await createTestApp();
      const res = await app.request("/dashboard");

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toContain("/login");
      expect(location).toMatch(/redirect=%2Fdashboard|redirect=\/dashboard/);
    });

    // TS-2.3
    it("redirects to original page after successful login via redirect param", async () => {
      const app = await createTestApp();
      const res = await app.request("/login?redirect=%2Fdashboard", {
        method: "POST",
        body: new URLSearchParams({ password: TEST_PASSWORD }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/dashboard");
    });

    // TS-2.4
    it("returns 401 for unauthenticated API requests", async () => {
      const app = await createTestApp();
      const res = await app.request("/api/entries");

      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
    });

    // TS-2.5
    it("allows unauthenticated access to /health", async () => {
      const app = await createTestApp();
      const res = await app.request("/health");

      expect(res.status).toBe(200);
    });

    // TS-2.6
    it("allows unauthenticated access to GET /login", async () => {
      const app = await createTestApp();
      const res = await app.request("/login");

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<input[^>]*type=["']password["']/i);
    });

    // TS-2.7
    it("redirects authenticated user from /login to /", async () => {
      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      const res = await app.request("/login", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    });

    // TS-2.8
    it("allows authenticated access to protected routes", async () => {
      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      const res = await app.request("/dashboard", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Dashboard");
    });

    // TS-2.9
    it("allows authenticated access to API routes", async () => {
      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      const res = await app.request("/api/entries", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("entries");
    });
  });

  // =========================================================================
  // Group 3: Logout (US-3)
  // =========================================================================
  describe("Logout (US-3)", () => {
    // TS-3.1
    it("clears session cookie and redirects to /login on logout", async () => {
      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      const res = await app.request("/logout", {
        method: "POST",
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");

      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toBeTruthy();
      const lower = setCookie.toLowerCase();
      // Cookie should be cleared via Max-Age=0 or Expires in the past
      expect(lower).toMatch(/max-age=0|expires=thu, 01 jan 1970/);
    });
  });

  // Group 4: Startup Validation — removed
  // WEBAPP_PASSWORD and SESSION_SECRET are no longer required env vars.
  // Auth now uses bcrypt + user table via src/web/setup.ts.
  // Session secret is resolved at runtime via resolveSessionSecret().

  // =========================================================================
  // Group 5: Edge Cases
  // =========================================================================
  describe("Edge Cases", () => {
    // TS-5.1
    it("redirects to /login when session cookie is expired", async () => {
      vi.useFakeTimers();

      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      // Advance time by 31 days
      vi.advanceTimersByTime(THIRTY_ONE_DAYS_MS);

      const res = await app.request("/dashboard", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location")!;
      expect(location).toContain("/login");
      expect(location).toMatch(/redirect=%2Fdashboard|redirect=\/dashboard/);
    });

    // TS-5.2
    it("treats tampered cookie as absent and redirects to /login", async () => {
      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      // Tamper with a character in the MIDDLE of the signature, not the last
      // one. The last char of a 32-byte HMAC-SHA256 base64url encoding has 2
      // padding bits — flipping it can collide with the original decoded byte
      // (~6% of the time) and silently produce the same signature buffer.
      const [name, ...valueParts] = sessionCookie.split("=");
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
      expect(res.headers.get("location")).toMatch(/^\/login/);
    });

    // TS-5.3
    it("subsequent requests after logout are unauthenticated", async () => {
      const app = await createTestApp();
      const sessionCookie = await loginAndGetCookie(app);

      // Logout
      await app.request("/logout", {
        method: "POST",
        headers: { Cookie: sessionCookie },
      });

      // Request without cookie (browser cleared it after logout)
      const res = await app.request("/dashboard");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/login/);
    });

    // TS-5.4
    it("rejects cookies signed with old SESSION_SECRET", async () => {
      const originalSecret = "original-secret-at-least-32-characters!!";
      const rotatedSecret = "rotated-secret-at-least-32-characters!!";

      const app1 = await createTestApp(TEST_PASSWORD, originalSecret);
      const sessionCookie = await loginAndGetCookie(app1);

      // Create new app with rotated secret
      const app2 = await createTestApp(TEST_PASSWORD, rotatedSecret);
      const res = await app2.request("/dashboard", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/login/);
    });

    // TS-5.5
    it("accepts valid session cookie after WEBAPP_PASSWORD change", async () => {
      const app1 = await createTestApp("old-password", TEST_SECRET);
      const sessionCookie = await loginAndGetCookie(app1, "old-password");

      // Create new app with new password but same secret
      const app2 = await createTestApp("new-password", TEST_SECRET);
      const res = await app2.request("/dashboard", {
        headers: { Cookie: sessionCookie },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Dashboard");
    });
  });
});
