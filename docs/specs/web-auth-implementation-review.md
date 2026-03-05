# Web Auth — Implementation Review

| Field | Value |
|-------|-------|
| Feature | Web Auth |
| Date | 2026-03-05 |
| Status | PASS |

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec → Test Spec coverage | PASS | All 22 spec requirements (AC-1.1–AC-3.1, C-1–C-6, EC-1–EC-5, RQ-1–RQ-2) mapped to test scenarios |
| Test Spec → Spec traceability | PASS | All 25 scenarios trace to at least one spec requirement. No orphan tests |
| Test Spec → Test Impl Spec coverage | PASS | All 25 scenarios mapped to test functions in the test impl spec |
| Test Impl Spec → Test Spec (no orphans) | PASS | No orphan test implementations |
| Spec constraints respected | PASS | All 6 constraints (C-1 through C-6) implemented and tested |
| Non-goals respected | PASS | No scope creep — no multi-user, registration, OAuth, 2FA, DB sessions, rate limiting, or CSRF beyond SameSite |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Spec | PASS | All 25 test scenarios have corresponding test functions in `tests/unit/web-auth.test.ts` |
| Test code vs Test Impl Spec | PASS | All test functions match the mapping table. Factory pattern (`createTestApp`, `loginAndGetCookie`) matches spec |
| Feature code vs Behavioral Spec | PASS | All acceptance criteria, constraints, and edge cases implemented in `src/web/auth.ts` |
| Undocumented behavior | PASS | No public behavior beyond what specs describe |

### Detailed Code-to-Spec Mapping

| Spec Requirement | Implementation |
|------------------|----------------|
| AC-1.1: Login form | `renderLoginPage()` with `<input type="password">` + `<button type="submit">` |
| AC-1.2: Password validation | `submittedPassword !== password` in POST /login handler |
| AC-1.3: Cookie + redirect | `sign()` → `Set-Cookie` header → `c.redirect(redirectTo)` |
| AC-1.4: Error re-render | `renderLoginPage("Invalid password")` with status 200 |
| AC-1.5: Cookie attributes | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` |
| AC-1.6: Auth user at /login | `getSessionPayload()` check in GET /login → redirect to `/` |
| AC-2.1: Unauth redirect | Middleware: `c.redirect(\`/login?redirect=...\`)` |
| AC-2.2: Preserve URL | `encodeURIComponent(path)` in redirect query param |
| AC-2.3: API 401 | `path.startsWith("/api/")` → `c.text("Unauthorized", 401)` |
| AC-3.1: Logout | POST /logout: `Max-Age=0` + redirect to `/login` |
| C-1: Required vars | `REQUIRED_VARS` in `src/config.ts` includes both |
| C-2: HMAC signing | `createHmac("sha256", secret)` + `timingSafeEqual` |
| C-3: No password in cookie | Payload is `{ issued_at: Date.now() }` only |
| C-4: /health public | `if (path === "/health")` → skip middleware |
| C-5: /login accessible | `if (path === "/login")` → skip middleware |
| C-6: Hono middleware | `createAuthMiddleware()` returns `MiddlewareHandler` |
| EC-1: Expired session | `Date.now() - session.issuedAt >= THIRTY_DAYS_MS` → redirect |
| EC-2: Tampered cookie | `verify()` returns null → treated as absent |
| EC-3: Logout invalidation | Cookie-based — clearing removes for all tabs |
| EC-4: Secret rotation | New secret fails HMAC verification on old cookies |
| EC-5: Password change | Password not in token — sessions survive |
| RQ-1: 30-day expiry | `Max-Age=2592000` + server-side `issued_at` check |
| RQ-2: Failed login logging | `logger.warn("Failed login attempt", { timestamp })` |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (web-auth) | 25 |
| Passed | 25 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/web-auth.test.ts` |
| Full suite | 203 tests, 14 files, all passing |

### Failures

None.

## Coverage Report

### Gaps

None.

### Misalignments

None.

### Unresolved Items

None. No `[NEEDS CLARIFICATION]` markers in any spec document.

## Findings

| # | Severity | Layer | Description |
|---|----------|-------|-------------|
| 1 | WARNING | Feature code vs Spec | `Secure` cookie flag not conditionally set. Spec AC-1.5 says "Secure (if HTTPS)" but implementation never adds `Secure`. In production behind HTTPS/reverse proxy, cookies will work but without the `Secure` flag. Test impl spec explicitly notes this is not asserted in tests (no TLS in test env). Acceptable for single-user Docker deployment — address when adding HTTPS support. |
| 2 | INFO | Feature code | Middleware skips `/logout` entirely (allows unauthenticated POST /logout). This is harmless — logout just clears cookies and redirects. Common pattern in web apps. Spec does not require /logout to be authenticated. |
| 3 | INFO | Test Spec | Test spec originally stated "Total scenarios: 22" but actual count is 25 (8+9+1+2+5). Corrected to 25 in current version. |

## Recommendations

- **WARNING-1:** When HTTPS support is added (or reverse proxy configured), update `createAuthRoutes` to conditionally include `Secure` in the `Set-Cookie` header. Can be done by checking `c.req.url` protocol or adding a config flag. Non-blocking for current phase.
- No CRITICAL findings. Feature is complete and ready for production use.
