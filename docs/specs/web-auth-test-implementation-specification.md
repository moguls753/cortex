# Web Auth - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Web Auth |
| Phase | 4 |
| Date | 2026-03-05 |
| Derives From | `web-auth-test-specification.md` |

## Test Framework & Conventions

- **Framework:** Vitest (already used project-wide)
- **Style:** `describe`/`it` blocks with explicit imports (`import { describe, it, expect, vi } from "vitest"`)
- **Module isolation:** `vi.resetModules()` + dynamic `import()` for config-dependent tests
- **HTTP testing:** Hono's built-in `app.request(url, init?)` — no real server needed
- **Assertion library:** Vitest `expect` (project standard)
- **Env var control:** `tests/helpers/env.ts` (`withEnv`, `setRequiredEnvVars`, `clearAllConfigEnvVars`)
- **Fake timers:** Vitest fake timers configured in `vitest.config.ts` for `Date` — usable for expiry tests
- **Logging spy:** `vi.spyOn(process.stdout, 'write')` to capture structured JSON log output (existing pattern from logger.test.ts)

## Test Structure

### File Organization

All tests are **unit tests**. Web-auth involves no database, no external services — only cookie signing, password comparison, and redirect logic. All testable in-process via Hono's test client.

```
tests/unit/web-auth.test.ts    # All 25 scenarios
tests/helpers/env.ts           # Existing — env var manipulation
```

No integration tests needed for this feature.

### Test Grouping

Matches the test specification's groups:

```typescript
describe("Web Auth", () => {
  describe("Login (US-1)", () => { /* TS-1.1 through TS-1.8 */ });
  describe("Route Protection (US-2)", () => { /* TS-2.1 through TS-2.9 */ });
  describe("Logout (US-3)", () => { /* TS-3.1 */ });
  describe("Startup Validation", () => { /* TS-4.1, TS-4.2 */ });
  describe("Edge Cases", () => { /* TS-5.1 through TS-5.5 */ });
});
```

### Naming Convention

Test names mirror the scenario titles from the test specification:

```typescript
it("renders a login page with a password form")          // TS-1.1
it("redirects to home on correct password")              // TS-1.2
it("re-renders login with error on incorrect password")  // TS-1.3
```

## Expected Module API

The auth module (`src/web/auth.ts`) should export:

- **`createAuthMiddleware(sessionSecret: string): MiddlewareHandler`** — Hono middleware that checks for a valid signed session cookie. Skips `/health` and `/login` (GET). Returns 401 for `/api/*` routes when unauthenticated. Redirects all other unauthenticated requests to `/login?redirect=<originalUrl>`.

- **`createAuthRoutes(webappPassword: string, sessionSecret: string): Hono`** — Returns a Hono sub-app with:
  - `GET /login` — renders login form (redirects to `/` if already authenticated)
  - `POST /login` — validates password, sets session cookie on success
  - `POST /logout` — clears session cookie, redirects to `/login`

This factory pattern is consistent with `createHealthRoute(checkers)` in `src/web/health.ts`.

## Test App Factory

A shared helper creates a minimal Hono app wired with auth middleware and stub routes:

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestApp(
  password = TEST_PASSWORD,
  secret = TEST_SECRET
): Promise<Hono> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");

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
```

A helper to perform login and extract the session cookie:

```typescript
async function loginAndGetCookie(
  app: Hono,
  password = TEST_PASSWORD
): Promise<string> {
  const res = await app.request("/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const setCookie = res.headers.get("set-cookie");
  // Parse cookie name=value from Set-Cookie header
  return setCookie!.split(";")[0]!;
}
```

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test Function |
|------------------|----------------|---------------|
| TS-1.1 | Login page renders a password form | `it("renders a login page with a password form")` |
| TS-1.2 | Successful login with correct password | `it("redirects to home on correct password")` |
| TS-1.3 | Failed login with incorrect password | `it("re-renders login with error on incorrect password")` |
| TS-1.4 | Successful login redirects to original URL | `it("redirects to original URL after login when redirect param present")` |
| TS-1.5 | Session cookie has correct attributes | `it("sets session cookie with HttpOnly, SameSite=Lax, and signed value")` |
| TS-1.6 | Session cookie does not contain the password | `it("session cookie value does not contain the password")` |
| TS-1.7 | Session cookie has 30-day expiration | `it("session cookie has max-age of 30 days")` |
| TS-1.8 | Failed login attempt is logged | `it("logs failed login attempt with timestamp")` |
| TS-2.1 | Unauthenticated request redirects to /login | `it("redirects unauthenticated requests to /login")` |
| TS-2.2 | Redirect preserves original URL | `it("includes original URL as redirect query parameter")` |
| TS-2.3 | After login, user returns to originally requested page | `it("redirects to original page after successful login via redirect param")` |
| TS-2.4 | Unauthenticated API request returns 401 | `it("returns 401 for unauthenticated API requests")` |
| TS-2.5 | Health endpoint is always accessible | `it("allows unauthenticated access to /health")` |
| TS-2.6 | Login page is accessible without authentication | `it("allows unauthenticated access to GET /login")` |
| TS-2.7 | Authenticated user visiting /login redirects to / | `it("redirects authenticated user from /login to /")` |
| TS-2.8 | Authenticated request to protected route succeeds | `it("allows authenticated access to protected routes")` |
| TS-2.9 | Authenticated API request succeeds | `it("allows authenticated access to API routes")` |
| TS-3.1 | Logout clears session and redirects to /login | `it("clears session cookie and redirects to /login on logout")` |
| TS-4.1 | App refuses to start without WEBAPP_PASSWORD | `it("refuses to start without WEBAPP_PASSWORD")` |
| TS-4.2 | App refuses to start without SESSION_SECRET | `it("refuses to start without SESSION_SECRET")` |
| TS-5.1 | Expired session redirects to login | `it("redirects to /login when session cookie is expired")` |
| TS-5.2 | Tampered cookie treated as absent | `it("treats tampered cookie as absent and redirects to /login")` |
| TS-5.3 | Logout invalidates session for subsequent requests | `it("subsequent requests after logout are unauthenticated")` |
| TS-5.4 | SESSION_SECRET rotation invalidates sessions | `it("rejects cookies signed with old SESSION_SECRET")` |
| TS-5.5 | Password change does not invalidate sessions | `it("accepts valid session cookie after WEBAPP_PASSWORD change")` |

## Detailed Scenario Implementation

### Group 1: Login (US-1)

#### TS-1.1: Login page renders a password form

- **Setup (Given):** Create test app via `createTestApp()`.
- **Action (When):** `app.request("/login")` — GET with no cookie.
- **Assertion (Then):** Response status 200. Response body (HTML) contains an `<input` with `type="password"` and a submit `<button` or `<input type="submit"`.

#### TS-1.2: Successful login with correct password

- **Setup (Given):** Create test app with known password.
- **Action (When):** `app.request("/login", { method: "POST", body: URLSearchParams({ password: TEST_PASSWORD }), headers: { "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status is 302. `Location` header is `/`. `Set-Cookie` header is present and non-empty.

#### TS-1.3: Failed login with incorrect password

- **Setup (Given):** Create test app with known password.
- **Action (When):** POST `/login` with `password: "wrong-password"`.
- **Assertion (Then):** Response status is 200 (re-rendered page, not redirect). Body contains "Invalid password" (or similar error text). `Set-Cookie` header is absent (no session created).

#### TS-1.4: Successful login redirects to original URL

- **Setup (Given):** Create test app.
- **Action (When):** POST `/login?redirect=/browse` with correct password.
- **Assertion (Then):** Response status 302. `Location` header is `/browse` (not `/`).

#### TS-1.5: Session cookie has correct attributes

- **Setup (Given):** Create test app.
- **Action (When):** POST `/login` with correct password.
- **Assertion (Then):** Parse `Set-Cookie` header. Verify it contains:
  - `HttpOnly` (case-insensitive check)
  - `SameSite=Lax`
  - Cookie value is not plaintext (contains a signature component, e.g., contains `.` or encoded separator)

Note: `Secure` attribute is conditional on HTTPS. Since test uses `app.request()` (no TLS), we do NOT assert `Secure` is present in this test. The behavioral spec says "Secure (if HTTPS)".

#### TS-1.6: Session cookie does not contain the password

- **Setup (Given):** Create test app with `password = "my-secret-password-123"`.
- **Action (When):** POST `/login` with correct password.
- **Assertion (Then):** Extract `Set-Cookie` header value. Assert the full header string does NOT contain the plaintext password. Also check the URL-decoded value does not contain the password.

#### TS-1.7: Session cookie has 30-day expiration

- **Setup (Given):** Create test app.
- **Action (When):** POST `/login` with correct password.
- **Assertion (Then):** Parse `Set-Cookie` header. Verify `Max-Age=2592000` (30 × 24 × 60 × 60 = 2,592,000 seconds) or an equivalent `Expires` header ~30 days in the future.

#### TS-1.8: Failed login attempt is logged

- **Setup (Given):** Create test app. Spy on `process.stdout.write` with `vi.spyOn(process.stdout, 'write').mockImplementation(() => true)`.
- **Action (When):** POST `/login` with incorrect password.
- **Assertion (Then):** `process.stdout.write` was called. At least one call contains a JSON string with `"level":"warn"` (or `"error"`) and a message indicating failed login. The JSON log entry includes a `timestamp` field.

### Group 2: Route Protection (US-2)

#### TS-2.1: Unauthenticated request redirects to /login

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/dashboard")`.
- **Assertion (Then):** Response status 302. `Location` header starts with `/login`.

#### TS-2.2: Redirect preserves original URL

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/dashboard")`.
- **Assertion (Then):** Response status 302. `Location` header is `/login?redirect=%2Fdashboard` (or equivalent URL-encoded form).

#### TS-2.3: After login, user returns to originally requested page

- **Setup (Given):** Create test app.
- **Action (When):** POST `/login?redirect=%2Fdashboard` with correct password.
- **Assertion (Then):** Response status 302. `Location` header is `/dashboard`.

Note: This is functionally the same flow as TS-1.4 but frames it as the end-to-end redirect cycle. The test asserts that the `redirect` query parameter is honored during login.

#### TS-2.4: Unauthenticated API request returns 401

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/api/entries")`.
- **Assertion (Then):** Response status 401. Response is NOT a redirect (no `Location` header).

#### TS-2.5: Health endpoint is always accessible

- **Setup (Given):** Create test app (factory includes a `/health` stub). No cookie.
- **Action (When):** `app.request("/health")`.
- **Assertion (Then):** Response status 200 (not 302, not 401). The auth middleware skips `/health` before any cookie check.

#### TS-2.6: Login page is accessible without authentication

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/login")`.
- **Assertion (Then):** Response status 200. Body contains a password form (not a redirect loop).

#### TS-2.7: Authenticated user visiting /login is redirected to /

- **Setup (Given):** Create test app. Login via `loginAndGetCookie()` to get a valid session cookie.
- **Action (When):** `app.request("/login", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response status 302. `Location` header is `/`.

#### TS-2.8: Authenticated request to protected route succeeds

- **Setup (Given):** Create test app. Login via `loginAndGetCookie()`.
- **Action (When):** `app.request("/dashboard", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response status 200. Body is "Dashboard" (the stub route content).

#### TS-2.9: Authenticated API request succeeds

- **Setup (Given):** Create test app. Login via `loginAndGetCookie()`.
- **Action (When):** `app.request("/api/entries", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response status 200. Body is JSON (the stub API response).

### Group 3: Logout (US-3)

#### TS-3.1: Logout clears session and redirects to /login

- **Setup (Given):** Create test app. Login via `loginAndGetCookie()`.
- **Action (When):** `app.request("/logout", { method: "POST", headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response status 302. `Location` header is `/login`. `Set-Cookie` header is present and either sets `Max-Age=0` or sets an `Expires` date in the past (clearing the cookie).

### Group 4: Startup Validation

#### TS-4.1: App refuses to start without WEBAPP_PASSWORD

- **Setup (Given):** `vi.resetModules()`. `clearAllConfigEnvVars()`. `setRequiredEnvVars()`. Then `delete process.env.WEBAPP_PASSWORD`.
- **Action (When):** `await import("../../src/config.js")`.
- **Assertion (Then):** Import throws. Error message contains `"WEBAPP_PASSWORD"`.

**TDD exception:** This test will PASS immediately because `src/config.ts` already lists `WEBAPP_PASSWORD` in `REQUIRED_VARS`. This is a **traceability test**, not new behavior. It confirms the web-auth constraint C-1 is enforced and documents it in the web-auth test suite. Existing config tests cover this implicitly, but explicit coverage here maintains the spec→test traceability chain.

#### TS-4.2: App refuses to start without SESSION_SECRET

- **Setup (Given):** `vi.resetModules()`. `clearAllConfigEnvVars()`. `setRequiredEnvVars()`. Then `delete process.env.SESSION_SECRET`.
- **Action (When):** `await import("../../src/config.js")`.
- **Assertion (Then):** Import throws. Error message contains `"SESSION_SECRET"`.

**TDD exception:** Same as TS-4.1 — will pass immediately. Traceability test for constraint C-1.

### Group 5: Edge Cases

#### TS-5.1: Expired session redirects to login with redirect preserved

- **Setup (Given):** `vi.useFakeTimers()`. Create test app. Login via `loginAndGetCookie()`. Advance fake timers by 31 days (`vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)`).
- **Action (When):** Request `/dashboard` on the same app with the old session cookie. Since `Date.now()` is faked, the middleware sees current time as 31 days after the cookie's `issued_at`.
- **Assertion (Then):** Response status 302. `Location` header is `/login?redirect=%2Fdashboard`.

Implementation detail: The session cookie must embed an `issued_at` timestamp in its signed payload. The middleware compares `issued_at + 30 days` against `Date.now()`. Fake timers control `Date.now()`, making this deterministic. No need to create a new app instance — the same app evaluates `Date.now()` on each request.

#### TS-5.2: Tampered cookie treated as absent

- **Setup (Given):** Create test app. Login via `loginAndGetCookie()`. Modify the cookie value (e.g., flip a character in the signature portion).
- **Action (When):** `app.request("/dashboard", { headers: { Cookie: tamperedCookie } })`.
- **Assertion (Then):** Response status 302. `Location` header starts with `/login`.

Implementation: Take the valid cookie string, split on `=`, modify the value (e.g., replace last character), reassemble, and send as `Cookie` header.

#### TS-5.3: Logout invalidates session for subsequent requests

- **Setup (Given):** Create test app. Login via `loginAndGetCookie()`. POST `/logout` to clear the session.
- **Action (When):** Request `/dashboard` WITHOUT the session cookie (simulating the browser having cleared it per the `Set-Cookie` from logout).
- **Assertion (Then):** Response status 302 to `/login`.

Note: With cookie-based sessions (no server-side store), logout works by clearing the cookie client-side. The test verifies that after logout, a request without the cookie is treated as unauthenticated. We do NOT replay the old cookie value — the behavioral contract is that the browser removes the cookie when it receives `Max-Age=0`.

#### TS-5.4: SESSION_SECRET rotation invalidates existing sessions

- **Setup (Given):** Create test app with `secret = "original-secret-at-least-32-characters"`. Login via `loginAndGetCookie()`. Then create a NEW test app with `secret = "rotated-secret-at-least-32-characters"`.
- **Action (When):** Request `/dashboard` on the new app with the old session cookie.
- **Assertion (Then):** Response status 302 to `/login`. The cookie signed with the original secret fails HMAC verification against the new secret.

#### TS-5.5: Password change does not invalidate existing sessions

- **Setup (Given):** Create test app with `password = "old-password"`. Login via `loginAndGetCookie()`. Then create a NEW test app with `password = "new-password"` but the SAME `secret`.
- **Action (When):** Request `/dashboard` on the new app with the existing session cookie.
- **Assertion (Then):** Response status 200. The session cookie is still valid because it was signed with the same secret. Password changes only affect new login attempts.

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60; // 2592000
```

### Shared Helpers

| Helper | Purpose | Scope |
|--------|---------|-------|
| `createTestApp(password?, secret?)` | Creates a Hono app with auth middleware, auth routes, and stub protected routes | Per-test (called fresh each test) |
| `loginAndGetCookie(app, password?)` | POSTs to `/login` and extracts the `Set-Cookie` header value as a `Cookie` header string | Per-test (called after createTestApp) |

### Setup / Teardown

```typescript
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers(); // Only needed if a test used fake timers
});
```

### Mocking Strategy

- **No external mocks needed.** Web-auth has no external dependencies (no DB, no APIs, no Telegram).
- **Logger spying:** `vi.spyOn(process.stdout, 'write').mockImplementation(() => true)` — only for TS-1.8.
- **Fake timers:** `vi.useFakeTimers()` — only for TS-5.1 (expired session).
- **Everything else** is tested via Hono's in-process `app.request()` with real cookie signing logic.

## Alignment Check

**Status: Full alignment.**

All 25 test scenarios from the test specification (TS-1.1 through TS-5.5) are mapped to test functions with setup, action, and assertion strategies defined. No gaps. No design concerns requiring implementation-detail coupling.

Note: The test specification states "Total scenarios: 22" but the actual count is 25 (8+9+1+2+5). The test spec's total is incorrect and should be corrected.

### Notes

1. **TS-4.1 and TS-4.2** are TDD exceptions — they will pass immediately against the existing config module. They are traceability tests (see inline notes above).

2. **TS-5.1 (expired session)** requires the cookie to embed an `issued_at` timestamp that the server validates. Browser-enforced `Max-Age` alone is not testable server-side. The implementation must include server-side expiry checking.

3. **TS-5.3 (post-logout)** tests cookie absence after logout, not cookie replay. This is the correct interpretation for cookie-based sessions without a server-side session store.

4. **TS-2.3 and TS-1.4** test the same behavior (redirect parameter honored on login) from different perspectives. Both are kept for traceability — TS-1.4 traces to AC-1.3/AC-2.2, TS-2.3 traces to AC-2.2 as end-to-end flow.
