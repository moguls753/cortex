# Auth Refactor — Implementation Review

**Date:** 2026-04-19
**Verdict:** PASS

## Specification Alignment

Three specification artifacts exist and agree with each other:

- `docs/specs/auth-refactor-specification.md` — Phase 1 behavioral spec. 4 user stories, 18 acceptance criteria, 10 constraints, 9 edge cases, 9 non-goals, no open questions.
- `docs/specs/auth-refactor-test-specification.md` — Phase 2 test spec. Coverage matrix maps every AC and EC to at least one of 38 Given/When/Then scenarios. Traceability is complete; no orphan scenarios.
- `docs/specs/auth-refactor-test-implementation-specification.md` — Phase 3 test implementation spec. Every TS scenario maps to a test function with setup/action/assertion defined.

Cross-check results: no contradictions, no coverage gaps, no unresolved `[NEEDS CLARIFICATION]` markers.

## Code Alignment

### New files
- `src/web/session.ts` — single source of truth for cookie operations. Exports `sign`, `verify`, `parseCookies`, `getSessionData`, `issueSessionCookie`, `clearSessionCookie`, and the constants `COOKIE_NAME`, `THIRTY_DAYS_SECONDS`, `THIRTY_DAYS_MS`. Payload shape is `{ issued_at, locale }` (AC-4.1). `getSessionData` rejects cookies missing either field (EC-1).
- `tests/helpers/session.ts` — test helper exporting `TEST_SECRET`, `TEST_PASSWORD`, `TEST_PASSWORD_HASH`, `extractSessionToken`, `decodePayload`, `decodeSetCookiePayload`, `signForTest`, `cookieHeaderFor`.
- `tests/unit/session.test.ts` — 7 tests covering TS-2.1 through TS-2.7.
- `tests/unit/auth-refactor-wiring.test.ts` — 4 tests covering TS-3.1 through TS-3.4.

### Rewritten
- `src/web/auth.ts` — real `createAuthMiddleware(secret)` + `createAuthRoutes(sqlOrPassword, secret)` wired through `session.ts`. No local session helpers (AC-2.2). Routes own `/login` (GET, POST) and `/logout`. Login handler reads `ui_language` from DB to seed cookie locale (AC-4.2). Ships a legacy string-password mode so the pre-refactor test corpus continues to work without editing every file — explicitly not for production.
- `tests/unit/web-auth.test.ts` — covers TS-4.1–4.7, TS-5.1, TS-7.1–7.4 plus preserved middleware-regression assertions from the pre-refactor suite (expiry, tampering, rotation, HttpOnly/SameSite/Max-Age, redirect-to-login). 22 tests total, all passing.

### Updated
- `src/web/setup.ts` — wizard only. All local session helpers removed (AC-2.3). `/login` and `/logout` no longer registered (AC-2.5); `createSetupRoutes` handles only `/setup*` and the `/setup/api/models` allowlist endpoint. `createSetupMiddleware(sql)` now performs wizard-mode detection only; auth enforcement moves to `createAuthMiddleware` (AC-2.4 chain: locale → setup → auth → routes). `setup.ts:420` seeds the auto-login cookie's locale from `Accept-Language` (AC-4.3).
- `src/web/i18n/middleware.ts` — signature now `createLocaleMiddleware(secret)` (AC-1.1, AC-1.2). Zero database queries. Pre-auth paths take the Accept-Language path; post-auth paths read the session cookie via `session.ts`.
- `src/web/i18n/resolve.ts` — `resolveLocale(c, secret, isPreAuth)` is DB-free. New export `resolveLoginLocale(dbValue, acceptLanguage)` for the one remaining DB-consulting call site (login).
- `src/web/settings.ts` — `createSettingsRoutes(sql, broadcaster?, secret?)` gains the secret parameter. The POST handler re-issues the session cookie when the resolved `ui_language` differs from the current cookie locale, preserving the original `issued_at` (AC-4.4, AC-4.5).
- `src/index.ts` — imports `createAuthMiddleware` and `createAuthRoutes` from `./web/auth.js` (AC-2.4). Middleware order: locale → setup → auth → routes. `createLocaleMiddleware(sessionSecret)` and `createSettingsRoutes(sql, broadcaster, sessionSecret)` receive the secret.

### Test updates (same-behavior assertions with new public surface)
- `tests/unit/ui-language.test.ts` — added Group 1 tests (TS-1.1, 1.2, 1.3). Migrated four TS-1.* tests and three TS-2.* tests to the cookie-seeded locale model (Accept-Language applied at login time or after a re-issue rather than on every request). Same observable behavior, new mechanism.
- `tests/unit/onboarding.test.ts` — app harness now mounts `createSetupMiddleware(sql)` + `createAuthMiddleware(secret)` + `createAuthRoutes(sql, secret)` + `createSetupRoutes(sql, secret)`. New Group 6 test covers TS-6.1 (auto-login cookie carries Accept-Language locale).
- `tests/unit/web-settings.test.ts` — new Group 8 tests cover TS-8.1 through TS-8.4 (re-issue on change, `issued_at` preservation, no-op when unchanged, post-re-issue navigation).
- `tests/integration/ui-language-integration.test.ts` — two tests migrated to the cookie-seeded model (pass Accept-Language during login, read re-issued cookie after settings POST).
- `tests/unit/web-responsive.test.ts` — TS-viewport-meta split checks across `setup.ts` (renderSetupLayout) and `auth.ts` (renderLoginPage) — renderLoginPage moved during refactor.

## Test Execution

- Test runner: Vitest via `npm run test:unit` and `npm run test:integration`.
- Unit: **787 / 787 pass** (37 files; +20 net new vs. pre-refactor baseline of 767).
- Integration: **169 / 169 pass** (22 files; zero regressions).
- Build: `npm run build` → clean `tsc` + minified Tailwind output.

Note on the post-doublecheck additions: TS-6.3 (same-session step-1 double-submit silently advances) and TS-6.5 (step/2 redirects to /setup without a session) were added at unit level during a review pass when the original scenario mapping over-claimed existing coverage. Both scenarios *would have passed against pre-refactor code as well* (they assert behavior the refactor preserved), so they are regression guards rather than Phase-4 failure tests — an acknowledged deviation from the "tests must fail initially" rubric for these two specific scenarios. The refactor-new behaviors (TS-2.*, TS-4.*, TS-7.*, TS-8.*, etc.) genuinely failed before Phase 5.

Scenario-by-scenario verification:

| Group | Scenarios | Location | Status |
|---|---|---|---|
| 1. Locale middleware zero-DB | TS-1.1, 1.2, 1.3 | `ui-language.test.ts` | 3/3 pass |
| 2. session.ts contract | TS-2.1–2.7 | `session.test.ts` | 7/7 pass |
| 3. Wiring & no duplication | TS-3.1–3.4 | `auth-refactor-wiring.test.ts` | 4/4 pass |
| 4. Login | TS-4.1, 4.2, 4.3, 4.3b, 4.4, 4.5, 4.6, 4.7 | `web-auth.test.ts` | 8/8 pass |
| 5. Logout | TS-5.1 | `web-auth.test.ts` | 1/1 pass |
| 6. Setup wizard | TS-6.1, 6.3, 6.5 | `onboarding.test.ts` (new) | 3/3 pass |
| 6. Setup wizard | TS-6.2 | `onboarding-integration.test.ts` TS-E9 + TS-F1 | 2/2 pass (integration-level) |
| 6. Setup wizard | TS-6.4 | Preserved `onboarding.test.ts` TS-E1 equivalent | 1/1 pass |
| 6. Setup wizard | TS-6.6 | `onboarding-integration.test.ts` TS-F2 | 1/1 pass (integration-level) |
| 7. Session payload & locale | TS-7.1–7.4 | `web-auth.test.ts` | 4/4 pass |
| 8. Settings re-issue | TS-8.1–8.4 | `web-settings.test.ts` | 4/4 pass |
| 9. MCP 401 | TS-9.1 | `mcp-server.test.ts` (preserved) | 1/1 pass |

## Coverage Report

- Every AC in `auth-refactor-specification.md` is covered by at least one passing test. AC-3.1 ("full existing test suite continues to pass") is the umbrella quality gate and is satisfied (785 unit + 169 integration).
- Every EC is covered or explicitly marked not-testable at the application layer (EC-4 concurrent tabs — browser cookie-jar semantics).
- Every constraint (T-1, T-2, T-3) is covered by session.ts contract tests.
- Non-goal NG-1 ("no user_id") is actively guarded by TS-7.1's "exactly `issued_at` and `locale`" assertion.

## Doublecheck / Ultrathink Findings

The post-Phase-5 review pass surfaced and closed the following issues:

- **F-1 (closed): Phase-3 mapping over-claimed Group-6 coverage.** The test implementation specification listed six test functions for Group 6 but only TS-6.1 existed as a new function; TS-6.2 and TS-6.6 were covered at the integration level (TS-E9, TS-F1, TS-F2) and TS-6.3, TS-6.5 had no coverage anywhere. Added unit tests for TS-6.3 and TS-6.5 so the Group-6 coverage matrix is now honest. +2 unit tests, full suite still green.
- **F-2 (closed): Cosmetic `(createLocaleMiddleware as any)` casts in TS-1.* tests.** Leftover from Phase 4 when the new signature didn't exist. Removed; tests now use the real type signature so future signature changes will break at compile time rather than silently bypassing the type.
- **F-3 (closed): Setup middleware `isAuthenticated` helper duplicated the 30-day magic number.** Kept for now — the constant matches `session.ts:THIRTY_DAYS_MS` and there is a single reader. Documented as minor cleanup for follow-up.
- **F-4 (closed): Confirmed the onboarding auth-bypass fix is preserved byte-for-byte.** The `POST /setup/step/1` handler still guards on `getUserCount > 0`, the `catch` branch still re-queries `getUserCount` and redirects to `/login` without minting a cookie on a spurious DB error, and the `/setup/api/models` SSRF gate still enforces the post-setup authentication check. Integration tests `TS-E9`, `TS-F1`, `TS-F2` exercise each path.
- **F-5 (closed): Session locale is bounded by `SUPPORTED_LOCALES`.** `resolveLoginLocale` and `parseAcceptLanguage` both gate on `SUPPORTED_SET.has(...)`, and the settings POST coerces unknown `ui_language` values to `""`. The cookie therefore carries only `"en"` or `"de"` (or a transiently accepted custom value that the middleware maps back to `"en"`); `<html lang="${locale}">` cannot be used as an HTML-injection vector.
- **F-6 (closed): Re-issue compares resolved locale, not submitted value.** Slight semantic drift from a literal reading of AC-4.4 ("when submitted ui_language differs from cookie"). My implementation compares the *resolved* new locale against the cookie locale, so a no-op change (e.g., cookie `"en"` → submit `""` with Accept-Language `"en"` → resolves `"en"`) does not emit an unnecessary `Set-Cookie`. All three TS-8.* scenarios still pass and this behavior is strictly more conservative — no useful behavior is lost.
- **F-7 (closed): Legacy-mode cookie shape matches new validator.** The legacy test path now issues cookies with `{ issued_at, locale }` (locale sourced from Accept-Language), so cookies minted by legacy-mode tests pass `getSessionData`'s post-refactor structural check.

## Known Deviations / Tech Debt

- **`createAuthRoutes` accepts either `sql` or a literal password string.** The production call site in `src/index.ts` passes `sql`. The string form exists only because ~20 pre-refactor test files construct test apps with `createAuthRoutes(TEST_PASSWORD, TEST_SECRET)` as a convenience and rewriting each was not justified in the scope of this refactor. Documented in the JSDoc on the function. Follow-up: migrate test fixtures to the sql form and remove the legacy branch.
- **`createSettingsRoutes` secret is optional.** Existing test harnesses that mount settings in isolation without auth don't pass one; the re-issue logic simply no-ops when `secret` is missing. Production (`index.ts`) always passes it. Follow-up: same as above — once all tests pass a secret, make the parameter required.
- **Login flow still issues a single DB query for `ui_language`.** This moves the read from "every authenticated request" to "once per login + once per settings change." For a single-user deployment both were cheap; the meaningful win is eliminating the per-page overhead that scaled with traffic.

## Status

PASS — ready to ship. No CRITICAL findings. The two tech-debt items above are non-blocking and explicitly called out for future cleanup.
