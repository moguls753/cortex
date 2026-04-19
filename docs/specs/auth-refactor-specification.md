# Auth Refactor — Behavioral Specification

## Objective

Eliminate duplicated session-cookie logic across `src/web/auth.ts` and `src/web/setup.ts`, wire `auth.ts` into the server as the real auth path, and move the user's UI locale into the session cookie so the locale middleware no longer issues one database query per authenticated request. This is a structural cleanup plus one performance improvement. Cortex end users observe no behavior change.

The motivation is twofold:

1. **Correctness risk:** `src/web/auth.ts` exports `createAuthMiddleware` and `createAuthRoutes` but is never imported by `src/index.ts`; the real auth path lives in `src/web/setup.ts`. The two files contain near-identical cookie-signing, cookie-parsing, and session-validation helpers. Future changes to session behavior can diverge between the two copies and are easy to get wrong.
2. **Unnecessary DB traffic:** `src/web/i18n/middleware.ts` calls `getAllSettings(sql)` on every authenticated request to read `ui_language`. For a single-user deployment this is an avoidable round-trip on every page load, and it is documented as a known follow-up in `docs/specs/progress.md` (UI Language Phase 5 trade-offs).

## User Stories & Acceptance Criteria

### US-1: Operator — reduce per-request database traffic

**As the operator of Cortex, I want authenticated page loads to not issue a database query for locale resolution, so that request latency is lower and database load is reduced.**

- **AC-1.1:** When an authenticated request enters the `createLocaleMiddleware` handler, zero SQL statements are executed against the `settings` table during locale resolution. (Verifiable by asserting zero calls to `getAllSettings(sql)` in middleware unit tests.)
- **AC-1.2:** After the refactor, the locale middleware correctly identifies the active locale for each authenticated request from the session cookie alone, without consulting the database.
- **AC-1.3:** Pre-auth paths (`/login`, `/logout`, `/setup`, `/setup/*`) continue to resolve locale from the `Accept-Language` header as they do today.

### US-2: Developer — single source of truth for session cookie operations

**As a developer, I want every component that reads or writes the session cookie to go through one module, so that session behavior cannot diverge between files.**

- **AC-2.1:** A new file `src/web/session.ts` exists and exports the following named functions: `sign`, `verify`, `parseCookies`, `getSessionData`, `issueSessionCookie`. The constants `COOKIE_NAME`, `THIRTY_DAYS_SECONDS`, and `THIRTY_DAYS_MS` are defined and exported from this module.
- **AC-2.2:** `src/web/auth.ts` contains no duplicate implementations of `sign`, `verify`, `parseCookies`, or `getSessionPayload`. It imports these behaviors from `session.ts`.
- **AC-2.3:** `src/web/setup.ts` contains no duplicate implementations of `sign`, `verify`, `parseCookies`, `getSessionPayload`, `isAuthenticated`, or `setSessionCookie`. It imports `issueSessionCookie` and `getSessionData` from `session.ts` for the wizard-completion auto-login.
- **AC-2.4:** `src/index.ts` imports its auth middleware and auth routes from `src/web/auth.ts`, not from `src/web/setup.ts`. The middleware chain is: locale middleware (from `i18n/middleware.ts`) → setup middleware (from `setup.ts`, detects wizard mode only) → auth middleware (from `auth.ts`) → routes.
- **AC-2.5:** `src/web/setup.ts` no longer exports or defines the routes `GET /login`, `POST /login`, or `POST /logout`. These routes live only in `auth.ts`.

### US-3: End user — no user-visible regression

**As a Cortex user, I want login, logout, setup, and locale behavior to work exactly as before, so that the refactor is invisible to me.**

- **AC-3.1:** The full existing unit-test suite (767 tests per `docs/specs/progress.md`) and the full existing integration-test suite (169 tests) continue to pass. Any tests that targeted removed or relocated module-internal helpers are updated to target the new public surface with the same observable assertions.
- **AC-3.2:** A user who enters correct credentials at `POST /login` receives a `Set-Cookie` header for `cortex_session`, is redirected to the originally requested path (or `/` when none), and is treated as authenticated on subsequent requests for 30 days.
- **AC-3.3:** A user who submits `POST /logout` receives a `Set-Cookie` header that clears `cortex_session` (`Max-Age=0`) and is redirected to `/login`.
- **AC-3.4:** The four-step setup wizard continues to work end-to-end: step 1 creates the user and auto-issues a session cookie, steps 2–4 require that cookie, step-1 race-condition handling (PK conflict, same-session double-submit) still applies, and `/setup/api/models` still enforces the post-setup authentication gate.

### US-4: End user — locale persists across requests without DB reads

**As a Cortex user with a `ui_language` preference, I want the UI to render in my chosen language on every page, without the application querying the database to discover that preference on each request.**

- **AC-4.1:** The session cookie payload is a JSON object with exactly the fields `issued_at: number` (milliseconds since epoch) and `locale: string` (two-letter lowercase locale code). No other fields.
- **AC-4.2:** At `POST /login`, once authentication succeeds, the locale encoded into the newly issued cookie is resolved in this order: (1) the `ui_language` setting in the database if it is present and in `SUPPORTED_LOCALES`; (2) the `Accept-Language` header parsed per RFC 9110 §12.5.4 and mapped to a supported locale; (3) `"en"`. This is the only database read of `ui_language` in the login path.
- **AC-4.3:** At `POST /setup/step/1`, once the first user is created, the locale encoded into the auto-issued cookie is resolved from the `Accept-Language` header (since `ui_language` cannot yet be set). Fallback is `"en"`.
- **AC-4.4:** At `POST /settings`, when the submitted `ui_language` value differs from the value currently in the session cookie, the response includes a `Set-Cookie` header that re-issues `cortex_session` with the new locale. The re-issued cookie preserves the original `issued_at` value so the 30-day expiry is not reset.
- **AC-4.5:** At `POST /settings`, when the submitted `ui_language` value matches the value in the session cookie, no re-issue occurs (no `Set-Cookie` for `cortex_session` in the response).
- **AC-4.6:** For any authenticated request, `c.get("locale")` returns the `locale` field from the session cookie when it is present and in `SUPPORTED_LOCALES`, or `"en"` when it is absent or unsupported.

## Constraints

### Technical

- **T-1:** The HMAC-SHA256 signing algorithm and the `cortex_session` cookie name remain unchanged.
- **T-2:** Session expiry remains 30 days from `issued_at`, enforced server-side in `session.ts`.
- **T-3:** Cookie attributes remain `HttpOnly; SameSite=Lax; Path=/`.
- **T-4:** The secret used for signing is obtained via `resolveSessionSecret(sql)` in `src/index.ts` (unchanged from today) and passed into `createAuthMiddleware`, `createAuthRoutes`, `createSetupMiddleware`, `createSetupRoutes`, and `createLocaleMiddleware` as a parameter. No module reaches into `config` at call time.
- **T-5:** `createLocaleMiddleware` changes signature from `(sql: Sql)` to `(secret: string)`. It no longer imports or uses the database.
- **T-6:** `src/web/i18n/resolve.ts` is simplified: the `resolveLocale` function no longer takes `sql`. Pre-auth callers pass `Accept-Language` only; authenticated callers read the session via `session.ts`.
- **T-7:** `settings.ts:createSettingsRoutes` accepts the session secret as a new parameter so it can re-issue the cookie on `ui_language` changes.

### Business

- **B-1:** No user-facing UI changes. Login page, logout behavior, setup wizard, and the `/settings` page render identically.
- **B-2:** No change to the public HTTP surface (URLs, status codes, response bodies).

### Operational

- **O-1:** No database migrations. The `user` table keeps its current schema, including the `id INTEGER PRIMARY KEY CHECK (id = 1)` constraint that pins the system to single-user.
- **O-2:** No new environment variables. No changes to `.env.example`.
- **O-3:** No dependency additions or removals.

## Edge Cases

- **EC-1:** **Session cookie missing the `locale` field.** Old cookies issued before this refactor lack `locale`. The `getSessionData` function treats such cookies as structurally invalid and returns `null`, causing auth middleware to redirect to `/login`. Users re-authenticate once and receive a new cookie.
- **EC-2:** **Session cookie with `locale` set to an unsupported value** (e.g., `"xyz"`). The cookie itself is treated as valid for authentication (auth is not gated on locale), but `c.get("locale")` returns `"en"`. No redirect and no re-issue.
- **EC-3:** **`ui_language` setting stored in the database as an unsupported value** via a direct DB write. At login, the resolution order falls through to `Accept-Language`, then `"en"`. Subsequent `POST /settings` submissions validate `ui_language` against `SUPPORTED_LOCALES` and reject unsupported values as they do today.
- **EC-4:** **Concurrent browser tabs, one changes `ui_language`.** The tab that submitted the change receives a re-issued cookie and renders in the new locale on its next navigation. Other tabs continue to render in the locale encoded in their cookies until they make a request that receives the updated cookie via browser cookie-jar behavior — this is standard browser semantics and is accepted.
- **EC-5:** **Session expires mid-use, user navigates, is redirected to `/login`, re-authenticates.** The new cookie's locale is resolved per AC-4.2, so the current `ui_language` setting is honored on re-login.
- **EC-6:** **User submits `/settings` without changing `ui_language`.** No cookie re-issue per AC-4.5; other settings save normally.
- **EC-7:** **User submits `/settings` changing `ui_language` to a valid supported value.** Cookie is re-issued per AC-4.4; flash messages on the redirect render in the new locale (the redirect response sets the cookie, and the subsequent GET renders with the new locale).
- **EC-8:** **Setup wizard step 1, two concurrent POSTs.** The PK-conflict race path in `setup.ts` is preserved (existing behavior): one request wins the `CREATE USER` insert and auto-logs in via `issueSessionCookie`; the other detects a post-conflict `getUserCount > 0` and redirects to `/login` without minting a cookie.
- **EC-9:** **MCP HTTP endpoint (`POST /mcp`) without a session cookie.** Auth middleware returns 401 (not 302). This preserves the existing rule that `/mcp` and `/api/` paths never redirect to the login page.

## Non-Goals

- **NG-1:** Not adding a `user_id` field to the session payload. The system is single-user and the constraint `CHECK (id = 1)` in the `user` table remains. Adding `user_id` would be dead weight.
- **NG-2:** Not changing the `user` table schema. No UUID migration, no email column, no password-reset flow.
- **NG-3:** Not supporting registration of additional users. There is no `/register` route.
- **NG-4:** Not supporting backward compatibility for old session cookies. Users with active sessions at deploy time will be redirected to `/login` once and re-authenticate.
- **NG-5:** Not changing the session expiry duration (remains 30 days), the signing algorithm (remains HMAC-SHA256), or the cookie name (remains `cortex_session`).
- **NG-6:** Not changing the login page UI, logout behavior, or setup-wizard UI.
- **NG-7:** Not introducing a session store or moving away from stateless signed cookies.
- **NG-8:** Not caching or memoizing `getAllSettings` in any other middleware. The only optimization is moving `ui_language` into the session cookie.
- **NG-9:** Not renaming existing files beyond the new `session.ts`. `auth.ts`, `setup.ts`, `i18n/middleware.ts`, `i18n/resolve.ts`, and `settings.ts` keep their current paths.

## Open Questions

None outstanding. The brainstorming preceding this specification resolved each open design point explicitly; the final scope is reflected above.
