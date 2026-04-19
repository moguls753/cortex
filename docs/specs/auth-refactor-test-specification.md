# Auth Refactor — Test Specification

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|---|---|
| AC-1.1 Zero SQL statements for locale on authenticated requests | TS-1.1 |
| AC-1.2 Locale correctly identified from session cookie alone | TS-1.1, TS-7.2 |
| AC-1.3 Pre-auth paths resolve locale from Accept-Language | TS-1.2, TS-1.3 |
| AC-2.1 `session.ts` exports the named public API | TS-2.1 |
| AC-2.2 `auth.ts` does not duplicate session helpers | TS-3.2 |
| AC-2.3 `setup.ts` does not duplicate session helpers | TS-3.3 |
| AC-2.4 `index.ts` uses auth middleware/routes from `auth.ts` | TS-3.1 |
| AC-2.5 `setup.ts` does not register `/login` or `/logout` routes | TS-3.4 |
| AC-3.1 Full existing test suite continues to pass | Implicit quality gate — verified at Phase 5/6 |
| AC-3.2 Valid login issues session cookie and redirects | TS-4.1, TS-4.6 |
| AC-3.3 Logout clears cookie and redirects to `/login` | TS-5.1 |
| AC-3.4 Setup wizard end-to-end still works | TS-6.1, TS-6.2, TS-6.3, TS-6.4, TS-6.5, TS-6.6 |
| AC-4.1 Cookie payload is exactly `{ issued_at, locale }` | TS-7.1 |
| AC-4.2 Login seeds cookie locale from `ui_language` → `Accept-Language` → `"en"` | TS-4.2, TS-4.3, TS-4.3b, TS-4.4 |
| AC-4.3 Setup wizard auto-login uses Accept-Language for locale | TS-6.1 |
| AC-4.4 Settings POST re-issues cookie when `ui_language` changes, preserves `issued_at` | TS-8.1, TS-8.2 |
| AC-4.5 Settings POST does not re-issue cookie when `ui_language` unchanged | TS-8.3 |
| AC-4.6 `c.get("locale")` returns cookie locale or `"en"` fallback | TS-7.2, TS-7.3 |
| EC-1 Old cookie missing `locale` is treated as invalid | TS-7.4 |
| EC-2 Cookie with unsupported locale value falls back to `"en"` | TS-7.3 |
| EC-3 DB `ui_language` unsupported value falls through resolution order | TS-4.3b |
| EC-4 Concurrent tabs — one changes `ui_language` | Not testable at application layer — browser cookie-jar semantics. Documented only. |
| EC-5 Session expires mid-use, re-login picks up current `ui_language` | TS-4.2 (implicit — same path as any login) |
| EC-6 Settings POST without `ui_language` change | TS-8.3 |
| EC-7 Settings POST with valid `ui_language` change | TS-8.1, TS-8.4 |
| EC-8 Setup step 1 concurrent double-submit race | TS-6.2, TS-6.3 |
| EC-9 `/mcp` without a session returns 401 | TS-9.1 |
| NG-1 Session has no `user_id` | TS-7.1 (asserts exact field set) |
| T-1 HMAC-SHA256 + `cortex_session` cookie name | TS-2.2, TS-2.3, TS-2.6 |
| T-2 Session expiry is 30 days | TS-2.6 |
| T-3 Cookie attributes `HttpOnly; SameSite=Lax; Path=/` | TS-2.6 |

## Test Scenarios

### Group 1 — Locale middleware does not query the database

**TS-1.1: Authenticated request resolves locale from cookie with zero settings queries**

```
Given a user exists in the database
  And a valid session cookie with payload { issued_at: <recent>, locale: "de" }
  And the SQL client is instrumented to record every query
When a GET request is made to /browse with that cookie
Then no query against the settings table is recorded during locale resolution
  And the route handler observes c.get("locale") equal to "de"
```

**TS-1.2: Pre-auth `/login` resolves locale from Accept-Language**

```
Given no session cookie is present
  And the Accept-Language header is "de-DE, de;q=0.9, en;q=0.5"
  And the SQL client is instrumented to record every query
When a GET request is made to /login
Then no query against the settings table is recorded during locale resolution
  And the route handler observes c.get("locale") equal to "de"
```

**TS-1.3: Pre-auth `/setup/step/1` resolves locale from Accept-Language**

```
Given no users exist in the database
  And the Accept-Language header is "de"
When a GET request is made to /setup/step/1
Then the route handler observes c.get("locale") equal to "de"
```

### Group 2 — `session.ts` module contract

**TS-2.1: `session.ts` exports the expected public API**

```
Given the project is compiled
When the module src/web/session.ts is imported
Then the module exports the functions sign, verify, parseCookies, getSessionData, and issueSessionCookie
  And the module exports the constants COOKIE_NAME, THIRTY_DAYS_SECONDS, and THIRTY_DAYS_MS
  And COOKIE_NAME equals "cortex_session"
  And THIRTY_DAYS_SECONDS equals 2592000
```

**TS-2.2: `sign` and `verify` round-trip a valid payload**

```
Given a session payload JSON string '{"issued_at":1700000000000,"locale":"en"}'
  And a secret "test-secret-32-chars-minimum-length"
When the payload is signed and the resulting token is verified with the same secret
Then verify returns the original payload JSON string
```

**TS-2.3: `verify` rejects tokens signed with a different secret**

```
Given a token signed with secret "secret-A"
When verify is called on that token with secret "secret-B"
Then verify returns null
```

**TS-2.4: `getSessionData` returns session data from a valid cookie header**

```
Given a cookie header containing "cortex_session=<valid URL-encoded signed token>"
  And the token's decoded payload is { issued_at: T, locale: "de" }
When getSessionData(cookieHeader, secret) is called
Then it returns an object with issuedAt equal to T and locale equal to "de"
```

**TS-2.5: `getSessionData` returns null when the session cookie is absent**

```
Given a cookie header "other_cookie=value; another=thing"
When getSessionData(cookieHeader, secret) is called
Then it returns null
```

**TS-2.6: `issueSessionCookie` sets a Set-Cookie header with the required attributes**

```
Given a Hono context
When issueSessionCookie(c, secret, { locale: "en" }) is called
Then the response Set-Cookie header contains "cortex_session=" with a URL-encoded signed token
  And the Set-Cookie header contains "HttpOnly"
  And the Set-Cookie header contains "SameSite=Lax"
  And the Set-Cookie header contains "Path=/"
  And the Set-Cookie header contains "Max-Age=2592000"
```

**TS-2.7: `issueSessionCookie` preserves `issued_at` when provided**

```
Given an original issued_at timestamp T (at least 10 seconds in the past)
When issueSessionCookie(c, secret, { locale: "de", issuedAt: T }) is called
Then the signed payload inside the Set-Cookie token decodes to { issued_at: T, locale: "de" }
  And the issued_at in the token is exactly T (not Date.now())
```

### Group 3 — Wiring and absence of duplication

**TS-3.1: `src/index.ts` imports auth from `auth.ts`**

```
Given a static read of src/index.ts
Then the file contains an import of createAuthMiddleware from "./web/auth.js"
  And the file contains an import of createAuthRoutes from "./web/auth.js"
  And app.route is called with the result of createAuthRoutes(...)
```

**TS-3.2: `auth.ts` contains no local duplicate session helpers**

```
Given a static read of src/web/auth.ts
Then the file contains no local function declarations named sign, verify, parseCookies, or getSessionPayload
  And the file imports at least one name from "./session.js"
```

**TS-3.3: `setup.ts` contains no local duplicate session helpers**

```
Given a static read of src/web/setup.ts
Then the file contains no local function declarations named sign, verify, parseCookies, getSessionPayload, isAuthenticated, or setSessionCookie
  And the file imports at least one name from "./session.js"
```

**TS-3.4: `setup.ts` does not register `/login` or `/logout` handlers**

```
Given a Hono app that mounts only the routes returned by createSetupRoutes
When a POST request is made to /login
Then the response status is 404
When a POST request is made to /logout
Then the response status is 404
```

### Group 4 — Login behavior

**TS-4.1: Correct credentials issue a cookie and redirect**

```
Given a user exists with password hash matching "correct-password"
  And the Accept-Language header is "en"
When a POST /login is made with form field password="correct-password"
Then the response status is 302
  And the Location header is "/"
  And the response sets a Set-Cookie for cortex_session with valid signed payload
  And the decoded payload's locale is "en"
```

**TS-4.2: Login reads `ui_language` from the database to seed the cookie locale**

```
Given a user exists with correct credentials
  And the settings table row ('ui_language', 'de') is present
  And the Accept-Language header is "en" (to prove the setting wins)
  And the SQL client is instrumented to record every query
When a POST /login is made with correct credentials
Then the response cookie's decoded locale is "de"
  And exactly one SELECT against the settings table occurred during the login handler
```

**TS-4.3: Login falls back to Accept-Language when `ui_language` is unset**

```
Given a user exists with correct credentials
  And no row for 'ui_language' exists in settings
  And the Accept-Language header is "de"
When a POST /login is made with correct credentials
Then the response cookie's decoded locale is "de"
```

**TS-4.3b: Login falls through when `ui_language` holds an unsupported value (EC-3)**

```
Given a user exists with correct credentials
  And the settings table holds ui_language = "xyz" (not in SUPPORTED_LOCALES)
  And the Accept-Language header is "de"
When a POST /login is made with correct credentials
Then the response cookie's decoded locale is "de"
```

**TS-4.4: Login falls back to `"en"` when neither setting nor Accept-Language is present**

```
Given a user exists with correct credentials
  And no row for 'ui_language' in settings
  And no Accept-Language header
When a POST /login is made with correct credentials
Then the response cookie's decoded locale is "en"
```

**TS-4.5: Incorrect credentials do not issue a session cookie**

```
Given a user exists with password hash matching "correct-password"
When a POST /login is made with password="wrong-password"
Then the response does not include a Set-Cookie header for cortex_session
  And the response body re-renders the login form with an error
```

**TS-4.6: Login honours the `redirect` query parameter**

```
Given a user exists with correct credentials
When a POST /login?redirect=/browse is made with correct credentials
Then the response redirects to /browse
```

**TS-4.7: Login when no user exists redirects to `/setup`**

```
Given no users in the user table
When any POST /login is made
Then the response redirects to /setup
  And no Set-Cookie is issued
```

### Group 5 — Logout

**TS-5.1: Logout clears the session cookie and redirects to `/login`**

```
Given an authenticated user (valid session cookie)
When a POST /logout is made with that cookie
Then the response redirects to /login
  And the response Set-Cookie for cortex_session has Max-Age=0
```

### Group 6 — Setup wizard

**TS-6.1: Step 1 auto-login issues a cookie with Accept-Language locale**

```
Given no users exist
  And the Accept-Language header is "de"
When a POST /setup/step/1 is made with valid form data
  (display_name="Tester", password="a-password", confirm_password="a-password")
Then a user row is created
  And the response redirects to /setup/step/2
  And the response sets cortex_session with decoded locale "de"
```

**TS-6.2: Step 1 PK-conflict race does not mint a cookie for the losing request**

```
Given no users exist initially
  And a concurrent request has won the createUser insert so the second getUserCount returns 1
  And the current request has no session cookie
When a POST /setup/step/1 is made with valid form data
Then the response redirects to /login
  And no Set-Cookie for cortex_session is issued
```

**TS-6.3: Step 1 same-session double-submit silently advances**

```
Given a user has been created and the request holds a valid session cookie
When a POST /setup/step/1 is made with that cookie
Then the response redirects to /setup/step/2
  And no new Set-Cookie is issued
```

**TS-6.4: Step 1 when a user exists and no session redirects to `/login`**

```
Given a user row exists
  And the request has no session cookie
When a POST /setup/step/1 is made
Then the response redirects to /login
  And no Set-Cookie is issued
```

**TS-6.5: Steps 2–4 require a valid session**

```
Given a user exists
  And the request has no session cookie
When a GET /setup/step/2 is made
Then the response redirects to /setup
```

**TS-6.6: `/setup/api/models` enforces auth once a user exists**

```
Given a user exists
  And the request has no session cookie
When a POST /setup/api/models is made with { "provider": "openai", "apiKey": "..." }
Then the response status is 401
```

### Group 7 — Session payload and locale exposure

**TS-7.1: Session payload contains exactly `issued_at` and `locale`**

```
Given a cookie issued by a POST /login with locale "de"
When the cookie value is URL-decoded, split at the last dot, and the payload is JSON-parsed
Then the parsed object has property issued_at of type number
  And the parsed object has property locale of type string equal to "de"
  And the parsed object has no other enumerable properties (no user_id, no admin, no role)
```

**TS-7.2: `c.get("locale")` returns the cookie's locale on authenticated requests**

```
Given a user exists
  And a valid session cookie with decoded locale "de"
When any GET request is made to an authenticated route with that cookie
Then the route handler observes c.get("locale") equal to "de"
```

**TS-7.3: `c.get("locale")` falls back to `"en"` when the cookie locale is unsupported**

```
Given a user exists
  And a session cookie whose signed payload is { issued_at: <recent>, locale: "xyz" }
  And "xyz" is not in SUPPORTED_LOCALES
When any GET request is made to an authenticated route
Then the route handler observes c.get("locale") equal to "en"
```

**TS-7.4: A cookie without a `locale` field is rejected as invalid**

```
Given a user exists
  And a session cookie manually signed with payload { issued_at: <recent> } (no locale field)
When a GET request is made to /browse with that cookie
Then the response redirects to /login
  And no new Set-Cookie is issued
```

### Group 8 — Settings re-issue on `ui_language` change

**TS-8.1: Settings POST with a new `ui_language` re-issues the cookie with the new locale**

```
Given an authenticated user whose session cookie encodes locale "en"
  And the current ui_language setting is "en"
When a POST /settings is made with ui_language="de" and all other settings unchanged
Then the response redirects to /settings
  And the response sets cortex_session
  And the new cookie's decoded locale is "de"
```

**TS-8.2: Settings POST re-issue preserves the original `issued_at`**

```
Given an authenticated user whose session cookie's issued_at is T
  (T is at least 10 seconds in the past)
When a POST /settings changes ui_language from "en" to "de"
Then the re-issued cookie's decoded issued_at is exactly T
  And not updated to Date.now()
```

**TS-8.3: Settings POST does not re-issue the cookie when `ui_language` is unchanged**

```
Given an authenticated user whose session cookie encodes locale "en"
  And the current ui_language setting is "en"
When a POST /settings is made with ui_language="en" and other settings unchanged
Then the response does not include a Set-Cookie header for cortex_session
```

**TS-8.4: Settings POST re-issue keeps the user authenticated**

```
Given an authenticated user whose session cookie encodes locale "en"
When a POST /settings changes ui_language to "de"
  And the user follows the redirect to GET /settings with the new cookie
Then the subsequent GET /settings responds with status 200
  And the page renders in locale "de"
```

### Group 9 — MCP endpoint preserves 401 behavior

**TS-9.1: `POST /mcp` without a session returns 401**

```
Given no session cookie
When a POST /mcp is made with body {"jsonrpc":"2.0","method":"tools/list","id":1}
Then the response status is 401
  And the response is not a redirect (status in the 300 range)
```

## Edge Case Scenarios

All edge cases from the behavioral spec are mapped above in the coverage matrix. The scenarios live inline with their groups — notably TS-7.3 (EC-2), TS-7.4 (EC-1), TS-4.3b (EC-3), TS-6.2/TS-6.3 (EC-8), TS-9.1 (EC-9), TS-8.3 (EC-6), and TS-8.1/TS-8.4 (EC-7). EC-4 (concurrent tabs) is documented in the behavioral spec as standard browser cookie-jar behavior and is not testable at the application layer. EC-5 (session expiry) reduces to re-login under TS-4.2.

## Traceability

Every AC in the behavioral spec has at least one test scenario (AC-3.1 is satisfied as an implicit quality gate — the existing 767 unit + 169 integration tests continue to run in Phase 5 CI). Every edge case EC-1 through EC-9 is covered or explicitly documented as not-testable. Constraints T-1, T-2, T-3 are covered by `session.ts` contract tests in Group 2. Non-goal NG-1 (no `user_id`) is actively guarded by TS-7.1's "no other enumerable properties" assertion.

Scenario count: 38 (TS-1.1 through TS-9.1, including TS-4.3b). No orphan scenarios.
