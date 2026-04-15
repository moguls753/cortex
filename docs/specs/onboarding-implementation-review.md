# Onboarding (Registration Wizard) — Implementation Review

| Field | Value |
|-------|-------|
| Feature | onboarding |
| Date | 2026-04-14 |
| Status | PASS (post-fix) |

## Scope

- Feature: zero-configuration first-run experience — visiting the web UI with an empty `user` table routes through a 4-step wizard (Account → LLM → Telegram → Done). Only `DATABASE_URL` is required at process start; all other configuration lives in the database.
- Implementation files: `src/web/setup.ts` (routes + middleware + page renderers, 1010 lines), `src/web/setup-queries.ts` (DB layer, 50 lines). Wired in `src/index.ts` via `createSetupMiddleware(sql, sessionSecret)` + `createSetupRoutes(sql, sessionSecret)`.
- Spec artifacts: `onboarding-specification.md` (167 lines), `onboarding-test-specification.md` (470 lines), `onboarding-test-implementation-specification.md` (328 lines).
- Tests: 44 total — 31 unit (`tests/unit/onboarding.test.ts`) + 10 unit (`tests/unit/config-onboarding.test.ts`, the `config.ts` reduction half of the feature) + 3 integration (`tests/integration/onboarding-integration.test.ts`). All passing.

## Specification Alignment

| Check | Status | Details |
|-------|--------|---------|
| Spec → Test Spec coverage | PASS (with minor gap) | All 34 behavioral ACs (AC-1.1 through AC-8.4) and all 11 edge cases (E-1 through E-11) map to at least one TS scenario. AC-7.4, AC-7.5, AC-7.7, AC-7.8 (optional env vars for OLLAMA_URL, WHISPER_URL, TZ, SMTP_*) have no TS scenarios — these are no-code configuration constants and the gap is acceptable. |
| Test Spec → Spec traceability | PASS | All 43 TS scenarios trace to a specific AC / US / edge case / non-goal. No orphan tests. The test spec explicitly asserts completeness at lines 456–470. |
| Test Spec → Test Impl Spec coverage | PASS | Every TS-x.x has a dedicated subsection in the test impl spec with Setup (Given) / Action (When) / Assertion (Then). |
| Test Impl Spec → Test Spec (no orphans) | PASS | All test impl entries use exact TS IDs as section headers. No extraneous entries. |
| Spec constraints respected | PARTIAL | C-4 (bcrypt cost 12): PASS (`src/web/setup.ts:363`). C-5 (user table single-row CHECK): PASS (`src/db/index.ts` `CHECK (id = 1)`). C-6 (setup state via user row count): PASS. C-7 (telegram token in settings table): PASS. C-8 (LLM keys in `llm_config` JSONB): PASS. C-10 (`config.ts` reduced to DATABASE_URL + 5 optional): PASS. **C-9 partial**: `settings.ts` no longer has a `SETTINGS_TO_ENV` fallback pattern, but the Telegram token/chat ID read path in `telegram.ts:784-791` reads only from the settings table as required. **AC-1.1 deviation**: `/api/kitchen.png` and `/api/display` bypass the setup redirect in addition to `/health` and static assets. This is an intentional kitchen-display design decision but is not documented in the onboarding spec. |
| Non-goals respected | PASS | NG-1 (single user) enforced by `CHECK (id = 1)`. NG-2 (no password reset) — no reset routes implemented. NG-3 (no OAuth) — password-only. NG-5 (SMTP not in wizard), NG-6 (Google Calendar not in wizard), NG-7 (embedding model auto-detected) all respected. |

## Code Alignment

| Check | Status | Details |
|-------|--------|---------|
| Test code vs Test Spec | PASS | 43 test functions match 43 test scenarios by ID. Integration tests (TS-2.3, TS-2.5, TS-E9) use the real DB via testcontainers. |
| Test code vs Test Impl Spec | PASS | Test functions follow setup/action/assertion patterns. Factory pattern (`createSetupApp(deps)` unit-level, `createSetupApp(sql)` integration-level) matches the test impl spec decisions. |
| Feature code vs Behavioral Spec | PASS (post-fix) | All ACs implemented. CRITICAL-1 (auth bypass via POST /setup/step/1 when user exists) was discovered and fixed during this review — see Findings. |
| Undocumented behavior | PASS | Page renderers use Terminal / Command Center design system (C-2) as required. No behavior outside the spec except the kitchen-display middleware bypass (documented as F-3 below). |

## Test Execution

| Metric | Value |
|--------|-------|
| Total tests (feature) | 44 |
| Passed | 44 |
| Failed | 0 |
| Skipped | 0 |
| Runner | `npx vitest run tests/unit/onboarding.test.ts tests/unit/config-onboarding.test.ts tests/integration/onboarding-integration.test.ts` |
| Full-suite regression | 650/650 passing, stable across 3 consecutive runs |

## Coverage Report

### Gaps

- **AC-7.4, AC-7.5, AC-7.7, AC-7.8** (optional env var defaults for `OLLAMA_URL`, `WHISPER_URL`, `TZ`, `SMTP_*`) have no test scenarios. These are one-liner defaults in `src/config.ts` and not exercised by any behavior. Acceptable gap.

### Misalignments

- **AC-2.4 contradicts E-9.** AC-2.4 says "Attempting to create a second user **returns an error**". E-9 says "double-click → only one user row is created" (no mention of error). The implementation implements E-9 (silently succeed on double-submit by the same session) but originally did so in a way that broke AC-1.6 (CRITICAL-1 below). Post-fix: the second POST is now rejected with a redirect to `/login` when the submitter is not already authenticated. A same-session double-submit still succeeds idempotently.

### Unresolved Items

None. No `[NEEDS CLARIFICATION]` markers in any spec artifact.

## Findings

| # | Severity | Layer | Description | Status |
|---|----------|-------|-------------|--------|
| F-1 | **CRITICAL** | Feature code | **Authentication bypass via POST /setup/step/1 after setup completes.** `POST /setup/step/1` wrapped `createUser` in a try/catch that, on any error (including the PK violation thrown when a user already exists), silently called `setSessionCookie` and redirected to `/setup/step/2`. The setup middleware allows `/setup/*` through unconditionally in both setup mode and normal mode. Result: an unauthenticated attacker could POST `password=Anything8&confirm_password=Anything8` to `/setup/step/1` after setup was complete and receive a valid session cookie for the real user. The existing TS-E9 double-submit test passed because it used the same valid password for both concurrent requests, hiding the vulnerability. | **FIXED** (see fix below) |
| F-2 | WARNING | Feature code | **SSRF via `POST /setup/api/models`.** The endpoint accepts attacker-controlled `provider`, `apiKey`, and `baseUrl` fields, then calls `fetchProviderModels(provider, apiKey, baseUrl)` which does `fetch(\`${baseUrl}/models\`, ...)`. The URL is not validated against an allowlist. The endpoint was reachable without authentication (via the unconditional `/setup/*` pass-through in the middleware). An attacker could probe internal services or exfiltrate attacker-supplied API keys to an attacker-controlled host. | **FIXED** — endpoint now requires either (a) being in setup mode, or (b) a valid setup session. |
| F-3 | WARNING | Spec + Feature code | **`/api/kitchen.png` and `/api/display` bypass the setup redirect** without being documented in AC-1.1 (which exempts only `/health` and static assets). These are e-ink display endpoints consumed by a headless TRMNL device, so the exemption is deliberate, but the onboarding spec doesn't mention it. | **CROSS-REFERENCED** (2026-04-15) — the kitchen-display spec now explicitly documents the bypass in its own C-9. The onboarding spec still doesn't enumerate the exemption; accepted as-is because the exemption is owned by the kitchen-display feature and duplicating it in the onboarding spec would create drift. |
| F-4 | WARNING | Feature code | **No server-side validation of display name length.** AC-2.1 requires Display Name to be 1–50 characters if provided, but `src/web/setup.ts:350` only trims the value and relies on HTML `maxlength="50"` for enforcement. A malicious client bypassing the form can POST an arbitrarily long string. Add a server-side length check. | **FIXED** — `src/web/setup.ts:375` rejects `displayName.length > 50` with an inline error. Added during the F-1 auth-bypass fix batch. |
| F-5 | INFO | Feature code | **Empty `try {} catch {}` block at `src/web/setup.ts:400-402`** inside `GET /setup/step/2`. Looks like vestigial code from a removed Ollama-models prefetch. Dead code — should be deleted for clarity. | **FIXED** |
| F-6 | INFO | Feature code | **Hardcoded session secret fallback** `"cortex-default-setup-secret-for-dev-only"` at `src/web/setup.ts:203,266`. Acts as a safety net when the caller passes a falsy secret. Not reachable from production (`src/index.ts:36,95,98` always passes `resolveSessionSecret(sql)`), but a foot-gun. | **FIXED** (2026-04-15) — the hardcoded default is removed. `createSetupMiddleware` and `createSetupRoutes` now require a non-empty `secret` argument and throw `"requires a non-empty session secret"` when given `undefined`, `null`, or `""`. Test helpers updated to pass an explicit `TEST_SECRET`. |
| F-7 | INFO | Test code | **TS-E9 test is insensitive to the auth bypass** because both concurrent requests submit the same valid password. A proper regression test for F-1 must simulate an attacker (different password, no prior session). A regression test `TS-E9b` was added to `tests/integration/onboarding-integration.test.ts` as part of the F-1 fix. | **FIXED** |
| F-8 | INFO | Spec artifacts | **AC-7.4 / AC-7.5 / AC-7.7 / AC-7.8 have no test scenarios.** These are optional env-var defaults that the test spec deliberately omits. | **DOCUMENTED** (2026-04-15) — `onboarding-test-specification.md` Coverage Matrix now has an explicit "Intentionally uncovered" note listing AC-7.4/7.5/7.7/7.8 as static env-var defaults that do not require behavioral tests. |

## Fix — F-1: Authentication Bypass

**Before** (`src/web/setup.ts:347-382`):
```ts
app.post("/setup/step/1", async (c) => {
  const body = await c.req.parseBody();
  const displayName = ((body.display_name as string) || "").trim();
  const password = (body.password as string) || "";
  const confirmPassword = (body.confirm_password as string) || "";

  if (password.length < 8) { return c.html(renderStep1("...", displayName)); }
  if (password !== confirmPassword) { return c.html(renderStep1("...", displayName)); }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await createUser(sql, { passwordHash, displayName: displayName || null });
  } catch (err) {
    // Likely a duplicate — the CHECK (id = 1) constraint
    // Just set session and redirect
    setSessionCookie(c, sessionSecret);                       // ❌ issues a valid cookie for the real user
    return c.redirect("/setup/step/2", 302);
  }

  setSessionCookie(c, sessionSecret);
  return c.redirect("/setup/step/2", 302);
});
```

**After:** See the `Fix — F-1 + F-2` section of the commit. In summary:
1. `POST /setup/step/1` guards at the top: if `getUserCount(sql) > 0`, reject via redirect to `/login`. Idempotent same-session double-submits are still supported because the authenticated session check bypasses the guard before reaching `getUserCount`.
2. The `createUser` try/catch no longer issues a session cookie on failure. A failure path re-renders step 1 with a generic error.
3. `POST /setup/api/models` requires the caller to be either (a) in setup mode (no user yet) or (b) authenticated. This closes F-2.
4. A new regression test `TS-F1` ("attacker cannot gain a session by POSTing to /setup/step/1 after setup completes") was added to `tests/integration/onboarding-integration.test.ts`.

## Recommendations

1. **(DONE)** Apply the F-1 / F-2 / F-5 / F-7 fixes before this feature is marked Phase 6 complete.
2. **(DONE, 2026-04-15)** F-3 cross-referenced — kitchen-display C-9 documents the middleware exemption.
3. **(DONE, 2026-04-15)** F-4 — server-side display-name length check added at `src/web/setup.ts:375`.
4. **(DONE, 2026-04-15)** F-6 — `createSetupMiddleware` / `createSetupRoutes` now throw on falsy `secret`. Hardcoded dev default removed.
5. **(DONE, 2026-04-15)** F-8 — Coverage Matrix note added to `onboarding-test-specification.md` for the intentionally-uncovered AC-7.x env-var defaults.

**All onboarding review findings are now closed.**

## Notes for Future Work

- The **kitchen-display feature was never taken through the spec-dd workflow** (no behavioral spec, no test spec, no Phase 6 review). It is implemented in `src/display/` with 50 passing unit tests and is wired into `src/index.ts`. The bypass list in `createSetupMiddleware` (F-3) is one consequence of that omission. See `progress.md` Outstanding Work.
- The **embedding model migration sweep** on 2026-04-14 bundled the discovery that `bcryptjs` was declared in `package.json` but not installed in `node_modules` — so the onboarding tests were failing with a missing-dependency error before that sweep. This review assumes a clean install (`npm install`) has been run.
