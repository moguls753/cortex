# Web Auth - Test Specification

| Field | Value |
|-------|-------|
| Feature | Web Auth |
| Phase | 4 |
| Date | 2026-03-05 |
| Derives From | `web-auth-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|-------------------|
| AC-1.1: GET /login renders login form | TS-1.1 |
| AC-1.2: POST /login validates password | TS-1.2, TS-1.3 |
| AC-1.3: Correct password → session cookie + redirect | TS-1.2, TS-1.4 |
| AC-1.4: Incorrect password → re-render with error | TS-1.3 |
| AC-1.5: Cookie attributes (HttpOnly, Secure, SameSite) | TS-1.5 |
| AC-2.1: Unauthenticated → redirect to /login | TS-2.1, TS-2.8 |
| AC-2.2: Original URL preserved via ?redirect= | TS-1.4, TS-2.2, TS-2.3 |
| AC-2.3: API routes return 401 | TS-2.4, TS-2.9 |
| AC-3.1: POST /logout clears cookie + redirect | TS-3.1 |
| C-1: Required env vars | TS-4.1, TS-4.2 |
| C-2: SESSION_SECRET used for HMAC signing | TS-1.5, TS-5.2 |
| C-3: Cookie must not contain password | TS-1.6 |
| C-4: /health always public | TS-2.5 |
| C-5: /login accessible without auth | TS-2.6 |
| AC-1.6: Authenticated user at /login redirects to / | TS-2.7 |
| C-6: Auth middleware runs as Hono middleware | TS-2.1, TS-2.4 |
| EC-1: Expired session | TS-5.1 |
| EC-2: Invalid/tampered cookie | TS-5.2 |
| EC-3: Multiple tabs / logout invalidates all | TS-5.3 |
| EC-4: SESSION_SECRET rotation | TS-5.4 |
| EC-5: WEBAPP_PASSWORD change, sessions survive | TS-5.5 |
| RQ-1: 30-day session expiration | TS-1.7 |
| RQ-2: Failed login logging | TS-1.8 |

## Test Scenarios

### Group 1: Login (US-1)

#### TS-1.1: Login page renders a password form

```
Scenario: Login page renders a password form
  Given the application is running
  When the user requests the login page
  Then a page is returned with a password input field
  And the page contains a submit button
```

**Traces to:** AC-1.1

---

#### TS-1.2: Successful login with correct password

```
Scenario: Successful login with correct password
  Given the application is configured with a password
  When the user submits the correct password on the login page
  Then a session cookie is set in the response
  And the user is redirected to the home page
```

**Traces to:** AC-1.2, AC-1.3

---

#### TS-1.3: Failed login with incorrect password

```
Scenario: Failed login with incorrect password
  Given the application is configured with a password
  When the user submits an incorrect password on the login page
  Then the login page is re-rendered
  And an error message "Invalid password" is displayed
  And no session cookie is set
```

**Traces to:** AC-1.2, AC-1.4

---

#### TS-1.4: Successful login redirects to original URL

```
Scenario: Successful login redirects to original URL
  Given the application is configured with a password
  And the login page was loaded with a redirect parameter pointing to a protected page
  When the user submits the correct password
  Then the user is redirected to the originally requested page (not the home page)
```

**Traces to:** AC-1.3, AC-2.2

---

#### TS-1.5: Session cookie has correct attributes

```
Scenario: Session cookie has correct security attributes
  Given the application is configured with a password
  When the user submits the correct password on the login page
  Then the session cookie is HttpOnly
  And the session cookie is SameSite=Lax
  And the session cookie is Secure when served over HTTPS
  And the session cookie is signed (the value is not plaintext)
```

**Traces to:** AC-1.5, C-2

---

#### TS-1.6: Session cookie does not contain the password

```
Scenario: Session cookie does not expose the password
  Given the application is configured with a known password
  When the user logs in successfully
  Then the session cookie value does not contain the configured password
```

**Traces to:** C-3

---

#### TS-1.7: Session cookie has 30-day expiration

```
Scenario: Session cookie expires after 30 days
  Given the application is configured with a password
  When the user logs in successfully
  Then the session cookie has a max-age of 30 days
```

**Traces to:** RQ-1

---

#### TS-1.8: Failed login attempt is logged

```
Scenario: Failed login attempt is logged
  Given the application is configured with a password
  When the user submits an incorrect password on the login page
  Then a log entry is recorded indicating a failed login attempt
  And the log entry includes a timestamp
```

**Traces to:** RQ-2

---

### Group 2: Route Protection (US-2)

#### TS-2.1: Unauthenticated request to protected route redirects to login

```
Scenario: Unauthenticated request to protected route redirects to login
  Given the user is not authenticated (no session cookie)
  When the user requests a protected page
  Then the user is redirected to the login page
```

**Traces to:** AC-2.1, C-6

---

#### TS-2.2: Redirect preserves original URL

```
Scenario: Redirect to login preserves the original URL
  Given the user is not authenticated
  When the user requests a specific protected page
  Then the user is redirected to the login page
  And the redirect includes the original URL as a query parameter
```

**Traces to:** AC-2.2

---

#### TS-2.3: After login, user returns to originally requested page

```
Scenario: Post-login redirect returns user to their original destination
  Given the user was redirected to login from a specific protected page
  When the user logs in successfully
  Then the user is redirected back to the originally requested page
```

**Traces to:** AC-2.2 (end-to-end flow)

---

#### TS-2.4: Unauthenticated API request returns 401

```
Scenario: Unauthenticated API request returns 401
  Given the user is not authenticated
  When the user makes a request to an API route
  Then the response status is 401 Unauthorized
  And the response is not a redirect
```

**Traces to:** AC-2.3, C-6

---

#### TS-2.5: Health endpoint is always accessible

```
Scenario: Health endpoint is accessible without authentication
  Given the user is not authenticated
  When the user requests the health endpoint
  Then the response is successful (not a redirect or 401)
```

**Traces to:** C-4

---

#### TS-2.6: Login page is accessible without authentication

```
Scenario: Login page is accessible without authentication
  Given the user is not authenticated
  When the user requests the login page
  Then the login page is rendered (not a redirect loop)
```

**Traces to:** C-5

---

#### TS-2.7: Authenticated user visiting /login is redirected to home

```
Scenario: Authenticated user visiting /login is redirected to home
  Given the user has a valid session cookie
  When the user requests the login page
  Then the user is redirected to the home page
```

**Traces to:** AC-1.6

---

#### TS-2.8: Authenticated request to protected route succeeds

```
Scenario: Authenticated user can access protected routes
  Given the user has a valid session cookie
  When the user requests a protected page
  Then the page is returned successfully (no redirect)
```

**Traces to:** AC-2.1 (inverse / happy path)

---

#### TS-2.9: Authenticated API request succeeds

```
Scenario: Authenticated user can access API routes
  Given the user has a valid session cookie
  When the user makes a request to an API route
  Then the API responds successfully (no 401)
```

**Traces to:** AC-2.3 (inverse / happy path)

---

### Group 3: Logout (US-3)

#### TS-3.1: Logout clears session and redirects to login

```
Scenario: Logout clears session and redirects to login
  Given the user is authenticated with a valid session
  When the user requests to log out
  Then the session cookie is cleared (expired or removed)
  And the user is redirected to the login page
```

**Traces to:** AC-3.1

---

### Group 4: Startup Validation (Constraints)

#### TS-4.1: App refuses to start without WEBAPP_PASSWORD

```
Scenario: App refuses to start without WEBAPP_PASSWORD
  Given SESSION_SECRET is configured
  And WEBAPP_PASSWORD is not configured
  When the application attempts to start
  Then the application fails to start
  And an error message indicates the missing WEBAPP_PASSWORD
```

**Traces to:** C-1

---

#### TS-4.2: App refuses to start without SESSION_SECRET

```
Scenario: App refuses to start without SESSION_SECRET
  Given WEBAPP_PASSWORD is configured
  And SESSION_SECRET is not configured
  When the application attempts to start
  Then the application fails to start
  And an error message indicates the missing SESSION_SECRET
```

**Traces to:** C-1

---

### Group 5: Edge Cases

#### TS-5.1: Expired session redirects to login with redirect preserved

```
Scenario: Expired session redirects to login with URL preserved
  Given the user has a session cookie that has expired (older than 30 days)
  When the user requests a protected page
  Then the user is redirected to the login page
  And the redirect includes the original URL as a query parameter
```

**Traces to:** EC-1, RQ-1

---

#### TS-5.2: Tampered cookie is treated as absent

```
Scenario: Tampered or invalid cookie is treated as absent
  Given the user has a cookie with an invalid or tampered signature
  When the user requests a protected page
  Then the user is redirected to the login page (cookie treated as absent)
```

**Traces to:** EC-2, C-2

---

#### TS-5.3: Logout invalidates session for subsequent requests

```
Scenario: After logout, the same session cookie is no longer valid
  Given the user was previously authenticated and has since logged out
  When a request is made with the previously valid session cookie
  Then the user is redirected to the login page
```

**Traces to:** EC-3

---

#### TS-5.4: SESSION_SECRET rotation invalidates existing sessions

```
Scenario: Changing SESSION_SECRET invalidates all existing sessions
  Given the user has a session cookie signed with the original SESSION_SECRET
  And the SESSION_SECRET has been changed
  When the user requests a protected page with the old session cookie
  Then the cookie signature is invalid
  And the user is redirected to the login page
```

**Traces to:** EC-4

---

#### TS-5.5: Password change does not invalidate existing sessions

```
Scenario: Changing WEBAPP_PASSWORD does not invalidate existing sessions
  Given the user has a valid session cookie
  And the WEBAPP_PASSWORD has been changed
  When the user requests a protected page with their existing session cookie
  Then the page is returned successfully (session is still valid)
```

**Traces to:** EC-5

---

## Edge Case Scenarios — Decision Table

For login authentication, the following decision table enumerates the combinations:

| Valid Cookie Present? | Route Type | Expected Outcome |
|-----------------------|------------|------------------|
| Yes | Protected page | Page returned (TS-2.8) |
| Yes | API route | API response returned (TS-2.9) |
| Yes | /login | Redirect to / (TS-2.7) |
| Yes | /health | Health response (TS-2.5) |
| No | Protected page | Redirect to /login (TS-2.1) |
| No | API route | 401 Unauthorized (TS-2.4) |
| No | /login | Login page rendered (TS-2.6) |
| No | /health | Health response (TS-2.5) |

**Note:** Authenticated users visiting `/login` are redirected to `/` (TS-2.7).

## Traceability Summary

All acceptance criteria (AC-1.1 through AC-3.1), all constraints (C-1 through C-6), all edge cases (EC-1 through EC-5), and both resolved questions (RQ-1, RQ-2) have at least one corresponding test scenario.

**Total scenarios:** 22

## Orphan Check

No orphan scenarios. Every scenario traces to at least one spec requirement.
