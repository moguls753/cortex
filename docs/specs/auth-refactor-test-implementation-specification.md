# Auth Refactor — Test Implementation Specification

## Test Framework & Conventions

- **Runner:** Vitest (already the project test runner, per `package.json`).
- **Conventions observed across the codebase and to be followed here:**
  - `describe`/`it`/`expect` from `vitest`.
  - Module-level `vi.mock("…")` factories to stub database and LLM modules.
  - `vi.resetModules()` in `beforeEach` so dynamic `import()` picks up fresh copies when env-var-sensitive code paths are under test.
  - `vi.restoreAllMocks()` and `vi.useRealTimers()` in `afterEach`.
  - Factory pattern for routes: `createAuthRoutes(sql, secret)`, `createSettingsRoutes(sql, broadcaster, secret)`, `createSetupRoutes(sql, secret)`, `createLocaleMiddleware(secret)`.
  - Helpers in `tests/helpers/`: `test-db.ts` for testcontainers seeding, `mock-sql.ts` for query-recording mock SQL, `env.ts` for `withEnv`.
  - Unit tests mock the DB seam (`getAllSettings`, `getUserPasswordHash`, `getUserCount`, etc.) rather than spin up Postgres.
  - Integration tests (`tests/integration/`) use `pgvector/pgvector:pg16` via testcontainers.
- **Assertion library:** Vitest's built-in `expect`.

## Test Structure

### File organization

Files are named after the module they primarily exercise. The auth-refactor scenarios split across these files:

| File | Purpose | New / Updated |
|---|---|---|
| `tests/unit/session.test.ts` | `src/web/session.ts` public API (`sign`, `verify`, `parseCookies`, `getSessionData`, `issueSessionCookie`, constants) | **New** |
| `tests/unit/web-auth.test.ts` | `src/web/auth.ts` real auth middleware + routes, after refactor | **Rewritten** — current file tests the dead-code API (`createAuthRoutes(password, secret)`); after refactor the signature becomes `createAuthRoutes(sql, secret)` and the handler reads password hash + `ui_language` from DB |
| `tests/unit/auth-refactor-wiring.test.ts` | Static file-content checks for AC-2.1–2.5 | **New** |
| `tests/unit/ui-language.test.ts` | Locale middleware zero-DB behavior (extends existing file) | **Updated** — add scenarios TS-1.1, TS-1.2, TS-1.3; remove tests that assert DB lookup path |
| `tests/unit/onboarding.test.ts` | Setup wizard, with login/logout moved out | **Updated** — remove tests that targeted `/login` or `/logout` when registered through `createSetupRoutes`; retain wizard step tests; add TS-6.1 (auto-login uses Accept-Language locale); adjust for `createSetupRoutes` no longer handling login |
| `tests/unit/web-settings.test.ts` | Settings re-issue behavior | **Updated** — add TS-8.1, TS-8.2, TS-8.3, TS-8.4 |
| `tests/unit/mcp-server.test.ts` | MCP 401 without session (existing assertion preserved) | **Verified unchanged** — TS-9.1 maps to an assertion that already exists; refactor must not break it |

### Test grouping

Each file uses nested `describe` blocks grouped by Phase-2 spec group. The scenario IDs appear in leading `// TS-…` comments on each `it` block, matching the convention already used across the codebase.

### Naming conventions

Test names describe the observable behavior, not the implementation. Match the existing project style:

- `it("does not query the settings table during locale resolution for authenticated requests")`
- `it("seeds cookie locale from ui_language setting when present")`
- `it("re-issues the session cookie when ui_language changes")`

## Test Scenario Mapping

### Group 1 — Locale middleware, zero DB queries (`tests/unit/ui-language.test.ts`)

| TS | Test function |
|---|---|
| TS-1.1 | `it("resolves locale from session cookie without querying settings on authenticated requests")` |
| TS-1.2 | `it("resolves locale from Accept-Language without querying settings on /login")` |
| TS-1.3 | `it("resolves locale from Accept-Language without querying settings on /setup/step/1")` |

**Setup (Given):** `vi.mock("../../src/web/settings-queries.js", () => ({ getAllSettings: vi.fn() }))`. In `beforeEach`, clear the mock and set the `ui_language` value in the mock's resolve. Build a Hono app with `createLocaleMiddleware(TEST_SECRET)` and a bare route that reads `c.get("locale")` and returns it as JSON.

For TS-1.1: seed a valid cookie signed with `TEST_SECRET` carrying `{ issued_at: Date.now(), locale: "de" }`. Attach as `Cookie: cortex_session=<encoded token>` on the request.

For TS-1.2 and TS-1.3: no cookie, set `Accept-Language` header.

**Action (When):** `await app.request("/browse", { headers: { cookie } })` for TS-1.1; `await app.request("/login", { headers: { "accept-language": "de-DE,de;q=0.9,en;q=0.5" } })` for TS-1.2; likewise for TS-1.3.

**Assertion (Then):** `expect(getAllSettings).not.toHaveBeenCalled()` and `expect(await res.text()).toContain('"de"')` (for TS-1.1/TS-1.2) / `"de"` for TS-1.3.

### Group 2 — `session.ts` module contract (`tests/unit/session.test.ts`)

| TS | Test function |
|---|---|
| TS-2.1 | `it("exports the documented public API")` |
| TS-2.2 | `it("sign and verify round-trip a payload with the same secret")` |
| TS-2.3 | `it("verify returns null when the signing secret differs")` |
| TS-2.4 | `it("getSessionData returns issuedAt and locale from a valid cookie header")` |
| TS-2.5 | `it("getSessionData returns null when the session cookie is absent")` |
| TS-2.6 | `it("issueSessionCookie writes a Set-Cookie header with HttpOnly, SameSite=Lax, Path=/, and 30-day Max-Age")` |
| TS-2.7 | `it("issueSessionCookie preserves an existing issued_at when provided")` |

**Setup (Given):** Import `* as session` from `../../src/web/session.js`. No mocks required — `session.ts` is a pure module.

**Action (When):**

- TS-2.1: `Object.keys(session)` inspected for the expected names.
- TS-2.2: `const token = session.sign(payload, SECRET); const decoded = session.verify(token, SECRET);`.
- TS-2.3: `session.verify(session.sign(payload, "A"), "B")`.
- TS-2.4: Construct a signed token manually with a URL-encoded cookie header containing it. Call `session.getSessionData(header, SECRET)`.
- TS-2.5: `session.getSessionData("other=value", SECRET)`.
- TS-2.6: Mount a minimal Hono app, call `session.issueSessionCookie(c, SECRET, { locale: "en" })` inside a handler. Inspect `res.headers.get("set-cookie")`.
- TS-2.7: `session.issueSessionCookie(c, SECRET, { locale: "de", issuedAt: 1_700_000_000_000 })`. Decode and verify.

**Assertion (Then):** direct `expect(…).toBe(…)` / `.toMatch(…)` / `.toContain(…)` on return values and the Set-Cookie header. TS-2.1 asserts `typeof session.sign === "function"` for each name and `session.COOKIE_NAME === "cortex_session"`, `session.THIRTY_DAYS_SECONDS === 2_592_000`.

### Group 3 — Wiring & no duplication (`tests/unit/auth-refactor-wiring.test.ts`)

| TS | Test function |
|---|---|
| TS-3.1 | `it("src/index.ts wires auth middleware and routes from auth.ts")` |
| TS-3.2 | `it("src/web/auth.ts contains no duplicate session helpers")` |
| TS-3.3 | `it("src/web/setup.ts contains no duplicate session helpers")` |
| TS-3.4 | `it("createSetupRoutes does not register /login or /logout handlers")` |

**Setup (Given):** Read the source files with `fs/promises.readFile`. Path relative to `process.cwd()` or `import.meta.url`.

**Action (When):**

- TS-3.1: Parse `src/index.ts` as text; search for import lines.
- TS-3.2: Parse `src/web/auth.ts` as text; search for local function declarations named `function sign(`, `function verify(`, `function parseCookies(`, `function getSessionPayload(`.
- TS-3.3: Same pattern applied to `src/web/setup.ts` with the extended set.
- TS-3.4: Dynamically import `createSetupRoutes`. Mount it on a fresh Hono app with `{} as Sql` stubbed. Issue `POST /login` and `POST /logout` with `app.request(…)`.

**Assertion (Then):**

- TS-3.1: `expect(src).toMatch(/import\s+\{[^}]*createAuthMiddleware[^}]*\}\s+from\s+["']\.\/web\/auth\.js["']/);` (same for `createAuthRoutes`). `expect(src).not.toMatch(/createAuthMiddleware.*from\s+["']\.\/web\/setup\.js["']/);`
- TS-3.2: `expect(src).not.toMatch(/^function\s+(sign|verify|parseCookies|getSessionPayload)\s*\(/m);` and `expect(src).toMatch(/from\s+["']\.\/session\.js["']/);`
- TS-3.3: Same pattern with the extended name set including `isAuthenticated` and `setSessionCookie`.
- TS-3.4: `expect(res.status).toBe(404);`

### Group 4 — Login behavior (`tests/unit/web-auth.test.ts`)

| TS | Test function |
|---|---|
| TS-4.1 | `it("issues a session cookie and redirects to / on correct credentials")` |
| TS-4.2 | `it("seeds cookie locale from ui_language setting when present")` |
| TS-4.3 | `it("falls back to Accept-Language when ui_language is unset")` |
| TS-4.3b | `it("falls back to Accept-Language when ui_language holds an unsupported value")` |
| TS-4.4 | `it("falls back to en when neither ui_language nor Accept-Language is present")` |
| TS-4.5 | `it("does not issue a cookie on incorrect credentials")` |
| TS-4.6 | `it("honours the redirect query parameter after login")` |
| TS-4.7 | `it("redirects to /setup when no user exists")` |

**Setup (Given):**

- Module mocks at top of file:
  - `vi.mock("../../src/web/setup-queries.js", () => ({ getUserCount: vi.fn(), getUserPasswordHash: vi.fn(), getDisplayName: vi.fn() }))`
  - `vi.mock("../../src/web/settings-queries.js", () => ({ getAllSettings: vi.fn() }))`
- `beforeEach`: reset all mocks; set default return values (`getUserCount` → 1, `getUserPasswordHash` → bcrypt hash of `TEST_PASSWORD`, `getAllSettings` → `{}`).
- Helper `createTestApp()` that mounts `createAuthRoutes(sql, TEST_SECRET)` with `sql = {} as Sql`.
- Helper `postLogin(app, password, opts)` that submits the form and returns the response.

**Action (When):** `app.request("/login", { method: "POST", body: new URLSearchParams({ password: "correct-password" }) })` plus optional `Accept-Language` header or `?redirect=` path.

**Assertion (Then):**

- TS-4.1: `res.status === 302`, `res.headers.get("location") === "/"`, `res.headers.get("set-cookie")` matches `cortex_session=…`, decoded token's `locale` equals `"en"`.
- TS-4.2: Override `getAllSettings.mockResolvedValue({ ui_language: "de" })` and set Accept-Language to `en`; decoded token's locale is `"de"`; `expect(getAllSettings).toHaveBeenCalledTimes(1)`.
- TS-4.3: `getAllSettings.mockResolvedValue({})`, Accept-Language `de`; decoded locale `"de"`.
- TS-4.3b: `getAllSettings.mockResolvedValue({ ui_language: "xyz" })`, Accept-Language `de`; decoded locale `"de"`.
- TS-4.4: `getAllSettings.mockResolvedValue({})`, no Accept-Language; decoded locale `"en"`.
- TS-4.5: `getUserPasswordHash` returns hash of `"correct-password"`; submit `"wrong-password"`; expect `res.status === 200`, body contains "invalid", no `Set-Cookie` with `cortex_session`.
- TS-4.6: Submit to `/login?redirect=/browse`; `res.headers.get("location") === "/browse"`.
- TS-4.7: `getUserCount` → `0`; `res.status === 302`, `res.headers.get("location") === "/setup"`, no cookie issued.

**Token-decoding helper:** `decodeSession(cookieHeader)` extracts the `cortex_session` value, URL-decodes, splits on the last dot, base64url-decodes the payload, JSON-parses. Lives in `tests/helpers/` alongside other session helpers (new file `tests/helpers/session.ts`).

### Group 5 — Logout (`tests/unit/web-auth.test.ts`)

| TS | Test function |
|---|---|
| TS-5.1 | `it("clears the session cookie and redirects to /login on logout")` |

**Setup (Given):** authenticated app from Group 4 helper; login first to acquire a cookie.

**Action (When):** `app.request("/logout", { method: "POST", headers: { cookie } })`.

**Assertion (Then):** `res.status === 302`, `res.headers.get("location") === "/login"`, Set-Cookie header contains `cortex_session=` and `Max-Age=0`.

### Group 6 — Setup wizard (`tests/unit/onboarding.test.ts`)

| TS | Test function |
|---|---|
| TS-6.1 | `it("auto-issues a session cookie with Accept-Language locale after step-1 user creation")` |
| TS-6.2 | `it("redirects to /login after PK-conflict and does not mint a cookie")` |
| TS-6.3 | `it("advances step-1 double-submit when the caller already holds a valid session")` |
| TS-6.4 | `it("redirects step-1 to /login when a user exists and the caller has no session")` |
| TS-6.5 | `it("redirects /setup/step/2 to /setup when no session is present")` |
| TS-6.6 | `it("returns 401 on /setup/api/models when a user exists and the caller has no session")` |

**Setup (Given):** `vi.mock("../../src/web/setup-queries.js", () => ({ getUserCount: vi.fn(), createUser: vi.fn(), getUserPasswordHash: vi.fn(), getSetupSummary: vi.fn(), getDisplayName: vi.fn() }))`. `vi.mock("../../src/web/settings-queries.js", …)` and `vi.mock("../../src/llm/config.js", …)`.

For each scenario, configure `getUserCount` (0 or 1) and `createUser` (resolve or throw a PK-conflict error) appropriately.

Helper `createTestApp()` mounts `createSetupMiddleware(sql, SECRET)`, then `createAuthRoutes(sql, SECRET)` (for post-setup auth behavior), then `createSetupRoutes(sql, SECRET)`.

**Action (When):** `app.request("/setup/step/1", { method: "POST", body, headers })` and similar per scenario.

**Assertion (Then):**

- TS-6.1: `res.status === 302`, `location === "/setup/step/2"`, Set-Cookie present with decoded locale `"de"` (from Accept-Language).
- TS-6.2: `createUser.mockRejectedValueOnce(new Error("pk conflict"))`, `getUserCount` returns 0 then 1; `res.status === 302`, `location === "/login"`, no Set-Cookie.
- TS-6.3: `getUserCount.mockResolvedValue(1)`; attach a valid session cookie on the request; expect 302 to `/setup/step/2`, no new Set-Cookie.
- TS-6.4: `getUserCount.mockResolvedValue(1)`, no cookie; expect 302 to `/login`.
- TS-6.5: `getUserCount` returns 1; GET `/setup/step/2` without cookie; expect 302 to `/setup`.
- TS-6.6: `getUserCount` returns 1; POST to `/setup/api/models` without cookie; expect `res.status === 401`.

### Group 7 — Session payload & `c.get("locale")` (`tests/unit/web-auth.test.ts`)

| TS | Test function |
|---|---|
| TS-7.1 | `it("issues a cookie whose payload has exactly issued_at and locale")` |
| TS-7.2 | `it("exposes the cookie locale via c.get(\"locale\") on authenticated requests")` |
| TS-7.3 | `it("falls back to \"en\" in c.get(\"locale\") when the cookie locale is unsupported")` |
| TS-7.4 | `it("redirects to /login when the cookie payload lacks a locale field")` |

**Setup (Given):** Same app harness as Group 4, plus a protected route `app.get("/whoami", c => c.json({ locale: c.get("locale") }))`.

For TS-7.4: manually sign a token with `{ issued_at: Date.now() }` (no locale) using `session.sign`. Construct the cookie header from it.

**Action (When):** Login (TS-7.1, TS-7.2) or GET /whoami (TS-7.2, TS-7.3, TS-7.4).

**Assertion (Then):**

- TS-7.1: Decode the login cookie; `Object.keys(payload).sort()` equals `["issued_at", "locale"]`; `typeof payload.issued_at === "number"`, `typeof payload.locale === "string"`.
- TS-7.2: With cookie carrying locale `"de"`, `/whoami` returns `{ "locale": "de" }`.
- TS-7.3: With cookie carrying locale `"xyz"` (manually signed), `/whoami` returns `{ "locale": "en" }`.
- TS-7.4: With locale-less cookie, request to `/whoami` gets `res.status === 302`, `location` starts with `/login`.

### Group 8 — Settings re-issue (`tests/unit/web-settings.test.ts`)

| TS | Test function |
|---|---|
| TS-8.1 | `it("re-issues the session cookie when ui_language changes")` |
| TS-8.2 | `it("preserves the original issued_at when re-issuing the cookie")` |
| TS-8.3 | `it("does not re-issue the session cookie when ui_language is unchanged")` |
| TS-8.4 | `it("keeps the user authenticated after re-issuing with a new locale")` |

**Setup (Given):** Existing `web-settings.test.ts` setup. `createSettingsRoutes(sql, broadcaster, SECRET)` (new third arg). Login once via `createAuthRoutes`; record `Cookie` header.

For TS-8.2: decode the login cookie, capture `issuedAt` (T); sleep-mock or set a known `T` via `vi.setSystemTime(T)` before login, then advance clock before the POST.

**Action (When):** `app.request("/settings", { method: "POST", body: buildFormData({ ui_language: "de" }), headers: { cookie } })`.

**Assertion (Then):**

- TS-8.1: `res.status === 302`, Set-Cookie header for `cortex_session` present; decoded locale is `"de"`.
- TS-8.2: Decoded `issued_at` equals T (tolerate no drift); NOT equal to the current mocked `Date.now()`.
- TS-8.3: `getAllSettings` pre-populated with `ui_language: "en"`; submit `ui_language=en`; no Set-Cookie for `cortex_session` in response headers (`expect(res.headers.get("set-cookie") ?? "").not.toContain("cortex_session")`).
- TS-8.4: After POST, extract new cookie; GET `/settings` with it; `res.status === 200`; body contains German string (e.g., `t("settings.page_title")` resolved to the de catalog).

### Group 9 — MCP 401 (`tests/unit/mcp-server.test.ts`)

| TS | Test function |
|---|---|
| TS-9.1 | **Existing assertion preserved** — the current test that verifies `/mcp` returns 401 for unauthenticated POST must continue to pass. No new test function; included in the regression gate. |

If grep shows the existing MCP-401 assertion has moved or is missing after the refactor, add it back to `tests/unit/mcp-server.test.ts` as `it("returns 401 on /mcp without a session cookie")`.

## Fixtures & Test Data

### New helper: `tests/helpers/session.ts`

A small pure-ESM module exposing:

- `signForTest(payload: object, secret?: string): string` — wraps `session.sign(JSON.stringify(payload), secret ?? TEST_SECRET)`.
- `decodeSessionCookie(setCookieHeader: string): { issuedAt: number; locale?: string } | null` — given a `Set-Cookie` header value, pull `cortex_session=…` segment, URL-decode, split at last `.`, base64url-decode the payload, JSON-parse.
- `cookieHeaderFor(token: string): string` — wraps in `cortex_session=<encoded>` form for request headers.
- Exports `TEST_SECRET = "test-session-secret-at-least-32-chars-long!!"` (matches existing tests).

### Instrumented mock SQL (existing pattern)

`tests/helpers/mock-sql.ts` already exists. Tests in Group 1 use `vi.mock("../../src/web/settings-queries.js", …)` rather than instrumenting raw SQL, because the assertion is "middleware did not call `getAllSettings`," which is the observable seam. This matches the existing ui-language test style.

### Authenticated-request helper

Extend the existing `loginAndGetCookie(app, password?)` helper in individual test files. For Group 8, the helper must return the full `Set-Cookie` header (not just `name=value`) so tests can decode and assert on payload fields.

### bcrypt fixture

`const TEST_PASSWORD_HASH = "$2b$…"` — computed once via `bcrypt.hashSync("test-password", 4)` and inlined as a constant. Used by `getUserPasswordHash.mockResolvedValue(TEST_PASSWORD_HASH)` to avoid running bcrypt on every test.

### Setup/teardown

- `beforeEach`: `vi.resetModules()`, `vi.clearAllMocks()`, re-seed default mock return values.
- `afterEach`: `vi.restoreAllMocks()`, `vi.useRealTimers()`.

No shared state between tests. Each test constructs its own app via `createTestApp()`.

## Alignment Check

**Full alignment.** All 38 test scenarios from the test specification are mapped to a test function with setup, action, and assertion defined:

- Group 1: 3 scenarios → 3 functions in `ui-language.test.ts` (updates).
- Group 2: 7 scenarios → 7 functions in `session.test.ts` (new file).
- Group 3: 4 scenarios → 4 functions in `auth-refactor-wiring.test.ts` (new file).
- Group 4: 8 scenarios → 8 functions in `web-auth.test.ts` (rewritten).
- Group 5: 1 scenario → 1 function in `web-auth.test.ts`.
- Group 6: 6 scenarios → 6 functions in `onboarding.test.ts` (updates).
- Group 7: 4 scenarios → 4 functions in `web-auth.test.ts`.
- Group 8: 4 scenarios → 4 functions in `web-settings.test.ts` (updates).
- Group 9: 1 scenario → retained existing assertion in `mcp-server.test.ts`.

**Total new/updated test functions:** 37 (TS-9.1 is a retained existing assertion, not a new function).

**Initial failure guarantee.** Every new test function will fail on the current `main` branch because:

1. `src/web/session.ts` does not yet exist (TS-2.*, TS-3.2, TS-3.3 fail at import).
2. `createAuthRoutes` currently has the signature `(password, secret)` — the new `(sql, secret)` signature is a compile break (TS-4.*, TS-5.1, TS-7.*).
3. `createLocaleMiddleware` currently takes `sql` — the new `(secret)` signature is a compile break (TS-1.*).
4. `createSettingsRoutes` currently takes `(sql, broadcaster)` — the new `(sql, broadcaster, secret)` signature is a compile break (TS-8.*).
5. Wiring assertions (TS-3.1) fail because `index.ts` imports auth-middleware from `setup.ts`, not `auth.ts`.
6. Absence assertions (TS-3.2, TS-3.3) fail because the duplicate helpers currently exist.

**Design concerns:** None. Every scenario asserts observable behavior (HTTP response, Set-Cookie header, route return value, module exports). Scenarios that inspect source files (TS-3.1, TS-3.2, TS-3.3) are guarding structural constraints from US-2 and are justified because file-shape IS the behavior under test for those ACs.
