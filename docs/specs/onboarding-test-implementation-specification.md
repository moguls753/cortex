# Onboarding Wizard & Setup Flow - Test Implementation Specification

## Test Framework & Conventions

- **Stack:** TypeScript, Hono web framework, PostgreSQL + Drizzle ORM
- **Test framework:** Vitest (describe/it blocks, expect assertions)
- **Mocking:** `vi.mock()` for module mocks, `vi.fn()` for stubs
- **Integration DB:** `@testcontainers/postgresql` with pgvector image via `tests/helpers/test-db.ts`
- **Env helpers:** `withEnv()` from `tests/helpers/env.ts` for temporary env var overrides
- **HTTP testing:** `app.request()` (Hono's built-in test interface, no supertest)
- **Patterns:** `vi.resetModules()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`

## Test Structure

### File Organization

| File | Scope | Tests |
|------|-------|-------|
| `tests/unit/onboarding.test.ts` | Wizard routes, setup detection, account creation, step flow, login rewrite | TS-1.1 through TS-6.4, TS-E1 through TS-E11 |
| `tests/unit/config-onboarding.test.ts` | Env var removal, config.ts reduction, graceful degradation | TS-7.1 through TS-7.9, TS-8.1 through TS-8.4 |
| `tests/integration/onboarding-integration.test.ts` | Full flow with real DB: setup → login → session, bcrypt hashing, single-row constraint | TS-2.3, TS-2.5, TS-E9 (integration variants) |

### Naming Convention

Test names follow: `scenario ID — behavior description`

```typescript
it("TS-1.1 — redirects to /setup when no user exists", ...)
it("TS-E4 — rejects mismatched passwords", ...)
```

## Test Scenario Mapping

### Setup Mode Detection

**TS-1.1: Redirects to /setup when no user exists**

- **Setup (Given):** Mock `getUserCount()` (or equivalent query) to return 0. Create test Hono app with setup middleware.
- **Action (When):** `app.request("/")`.
- **Assertion (Then):** Response status is 302. `Location` header is `/setup`.

**TS-1.2: /setup serves wizard step 1**

- **Setup (Given):** Mock `getUserCount()` to return 0.
- **Action (When):** `app.request("/setup")`.
- **Assertion (Then):** Response status is 200. Body contains `Display Name` label, `password` input, `Confirm Password` input.

**TS-1.3: Wizard steps follow defined order**

- **Setup (Given):** Mock `getUserCount()` to return 0. Mock `createUser()` to succeed. Mock settings save functions.
- **Action (When):** POST `/setup/step/1` with valid account data. Follow redirect to step 2. POST `/setup/step/2` with skip action. Follow redirect to step 3. POST `/setup/step/3` with skip action. Follow redirect to step 4.
- **Assertion (Then):** Step 1 redirect → `/setup/step/2`. Step 2 redirect → `/setup/step/3`. Step 3 redirect → `/setup/step/4`. Step 4 response is 200 with summary content.

**TS-1.4a: LLM step can be skipped**

- **Setup (Given):** Authenticated session (user created in step 1). Mock `saveLLMConfig`.
- **Action (When):** POST `/setup/step/2` with `action=skip`.
- **Assertion (Then):** Response redirects to `/setup/step/3`. `saveLLMConfig` was NOT called.

**TS-1.4b: Telegram step can be skipped**

- **Setup (Given):** Authenticated session. Mock `saveAllSettings`.
- **Action (When):** POST `/setup/step/3` with `action=skip`.
- **Assertion (Then):** Response redirects to `/setup/step/4`. `saveAllSettings` was NOT called with `telegram_bot_token`.

### Account Creation (Step 1)

**TS-2.1: Account step presents required fields**

- **Setup (Given):** Mock `getUserCount()` to return 0.
- **Action (When):** `app.request("/setup")` or `app.request("/setup/step/1")`.
- **Assertion (Then):** Response body contains: input with name `display_name`, input with type `password` and name `password`, input with type `password` and name `confirm_password`.

**TS-2.3: Account creation hashes password and stores user**

- **Setup (Given):** Integration test with real DB. Run migrations to create `user` table.
- **Action (When):** POST `/setup/step/1` with `display_name=Eike`, `password=securepass123`, `confirm_password=securepass123`.
- **Assertion (Then):** Query `user` table: one row exists. `password_hash` starts with `$2b$12$`. `display_name` is `"Eike"`. `created_at` is not null.

**TS-2.5: Auto-login after account creation**

- **Setup (Given):** Mock `getUserCount()` to return 0. Mock `createUser()` to succeed.
- **Action (When):** POST `/setup/step/1` with valid credentials.
- **Assertion (Then):** Response has `Set-Cookie` header containing `cortex_session`. Response status is 302 with `Location: /setup/step/2`.

### Language Model Configuration (Step 2)

**TS-3.1: LLM step presents provider and model fields**

- **Setup (Given):** Authenticated session.
- **Action (When):** `app.request("/setup/step/2", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains a `select` with `name="llm_provider"` containing options for anthropic, openai, groq, gemini, local, ollama. Body contains an input with `name="llm_model"`.

**TS-3.2: Ollama provider shows Ollama-specific UI**

- **Setup (Given):** Authenticated session. Mock `fetch` for Ollama `/api/tags` to return `{ models: [{ name: "qwen2.5:7b" }] }`.
- **Action (When):** `app.request("/setup/step/2", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains "Recommended Models" table. Body contains "Pull Model" button. Body does NOT contain an API key input when Ollama is the selected provider. (Note: provider selection is client-side JS; test the server-rendered default or pass a query param.)

**TS-3.3: LLM configuration saved on submit**

- **Setup (Given):** Authenticated session. Mock `saveLLMConfig`.
- **Action (When):** POST `/setup/step/2` with `llm_provider=anthropic`, `llm_model=claude-sonnet-4-20250514`, `apikey_anthropic=sk-test`.
- **Assertion (Then):** `saveLLMConfig` called with `{ provider: "anthropic", model: "claude-sonnet-4-20250514", ... }`. API key included in the config. Response redirects to `/setup/step/3`.

### Telegram Configuration (Step 3)

**TS-4.1: Telegram step presents token and chat ID fields**

- **Setup (Given):** Authenticated session.
- **Action (When):** `app.request("/setup/step/3", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains input with `name="telegram_bot_token"`. Body contains input with `name="telegram_chat_id"`.

**TS-4.2: Help text for BotFather**

- **Setup (Given):** Authenticated session.
- **Action (When):** `app.request("/setup/step/3", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains text matching `/BotFather/i`. Body contains text about chat ID.

**TS-4.3: Telegram config saved on submit**

- **Setup (Given):** Authenticated session. Mock `saveAllSettings`.
- **Action (When):** POST `/setup/step/3` with `telegram_bot_token=123:ABC`, `telegram_chat_id=456789`.
- **Assertion (Then):** `saveAllSettings` called with object containing `telegram_bot_token: "123:ABC"` and `telegram_chat_ids: "456789"`. Response redirects to `/setup/step/4`.

### Done Step (Step 4)

**TS-5.1: Done summary shows configured features**

- **Setup (Given):** Authenticated session. Mock settings to return LLM config and Telegram config.
- **Action (When):** `app.request("/setup/step/4", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains text indicating Account, LLM, and Telegram are configured (e.g., checkmarks or "configured" labels).

**TS-5.2: Done summary shows skipped features with Settings note**

- **Setup (Given):** Authenticated session. Mock settings to return no LLM config and no Telegram config.
- **Action (When):** `app.request("/setup/step/4", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains "Settings" mention for LLM and Telegram sections. Body contains indication these were skipped.

**TS-5.3: Done step has Go to Dashboard button**

- **Setup (Given):** Authenticated session.
- **Action (When):** `app.request("/setup/step/4", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response body contains a link with `href="/"`. Response has a valid session cookie (already set from step 1).

### Login (Returning User)

**TS-6.1: Protected routes redirect to /login when user exists**

- **Setup (Given):** Mock `getUserCount()` to return 1. No session cookie.
- **Action (When):** `app.request("/")`.
- **Assertion (Then):** Response status is 302. `Location` header contains `/login`.

**TS-6.2: Login page presents password field and button**

- **Setup (Given):** Mock `getUserCount()` to return 1.
- **Action (When):** `app.request("/login")`.
- **Assertion (Then):** Response status is 200. Body contains input with `type="password"`. Body contains a submit button with text matching `/Log in/i`.

**TS-6.3a: Successful login with correct password**

- **Setup (Given):** Mock `getUserCount()` to return 1. Mock `getUserPasswordHash()` to return a bcrypt hash of "correct-password".
- **Action (When):** POST `/login` with `password=correct-password`.
- **Assertion (Then):** Response has `Set-Cookie` header containing `cortex_session`. Response status is 302. `Location` is `/`.

**TS-6.3b: Failed login with wrong password**

- **Setup (Given):** Mock `getUserCount()` to return 1. Mock `getUserPasswordHash()` to return a bcrypt hash of "correct-password".
- **Action (When):** POST `/login` with `password=wrong-password`.
- **Assertion (Then):** Response does NOT have `Set-Cookie` header. Response body contains "Invalid password".

**TS-6.4: Login page uses design system**

- **Setup (Given):** Mock `getUserCount()` to return 1.
- **Action (When):** `app.request("/login")`.
- **Assertion (Then):** Response body contains `JetBrains Mono` (font reference). Body contains `/public/style.css` or equivalent Tailwind stylesheet link.

### Environment Variable Behavior

**TS-7.1: DATABASE_URL required**

- **Setup (Given):** Remove `DATABASE_URL` from env.
- **Action (When):** Import `config.ts` (dynamic import within `withEnv`).
- **Assertion (Then):** Import throws an error with message containing "DATABASE_URL".

**TS-7.2a: SESSION_SECRET auto-generated when not set**

- **Setup (Given):** No `SESSION_SECRET` in env. Mock DB query for `session_secret` settings key to return no rows. Mock DB insert.
- **Action (When):** Call the session secret resolver function.
- **Assertion (Then):** A 64-character hex string is generated. DB insert is called with key `session_secret` and a 64-char hex value.

**TS-7.2b: SESSION_SECRET env var takes precedence**

- **Setup (Given):** Set `SESSION_SECRET=my-secret` in env.
- **Action (When):** Call the session secret resolver function.
- **Assertion (Then):** Return value is `"my-secret"`. DB is not queried or written.

**TS-7.3: PORT defaults to 3000**

- **Setup (Given):** No `PORT` in env.
- **Action (When):** Import config and read port.
- **Assertion (Then):** Port value is `3000`.

**TS-7.6: Removed env vars are not read**

- **Setup (Given):** Set `LLM_API_KEY=old-key`, `TELEGRAM_BOT_TOKEN=old-token`, `WEBAPP_PASSWORD=old-pass` in env. Mock DB to return empty settings.
- **Action (When):** Import config. Resolve LLM config, Telegram token, and login password.
- **Assertion (Then):** LLM API key is empty (not "old-key"). Telegram bot token is empty (not "old-token"). Login checks against user table, not env var.

**TS-7.9: App starts without optional env vars**

- **Setup (Given):** Only `DATABASE_URL` is set. All other env vars are unset.
- **Action (When):** Import config.
- **Assertion (Then):** No error is thrown. Config object is valid with defaults.

### Graceful Degradation

**TS-8.1: Telegram bot does not start without token**

- **Setup (Given):** Mock settings query to return no `telegram_bot_token`.
- **Action (When):** Call `startBot(sql)`.
- **Assertion (Then):** No error is thrown. Function returns without starting a bot. (Or resolves immediately.)

**TS-8.2: Classification defaults when LLM not configured**

- **Setup (Given):** Mock settings query to return no `llm_config`.
- **Action (When):** Call `classifyEntry(...)` with an entry.
- **Assertion (Then):** Result has `category: "uncategorized"` and `confidence: 0`.

**TS-8.3: Email digest skipped when SMTP not configured**

- **Setup (Given):** No SMTP env vars set. Generate a digest result.
- **Action (When):** Call the email delivery function.
- **Assertion (Then):** No email is sent (mock fetch/nodemailer not called). No error is thrown.

**TS-8.4: Calendar event skipped when not configured**

- **Setup (Given):** Mock settings query to return no Google Calendar credentials.
- **Action (When):** Call the calendar event creation function with a classified entry.
- **Assertion (Then):** No fetch call to Google Calendar API. No error is thrown. Entry is saved normally.

### Edge Cases

**TS-E1: /setup redirects to /login when user exists**

- **Setup (Given):** Mock `getUserCount()` to return 1.
- **Action (When):** `app.request("/setup")`.
- **Assertion (Then):** Response status is 302. `Location` is `/login`.

**TS-E2: /login redirects to /setup when no user exists**

- **Setup (Given):** Mock `getUserCount()` to return 0.
- **Action (When):** `app.request("/login")`.
- **Assertion (Then):** Response status is 302. `Location` is `/setup`.

**TS-E3: Password shorter than 8 characters rejected**

- **Setup (Given):** Mock `getUserCount()` to return 0.
- **Action (When):** POST `/setup/step/1` with `password=short`, `confirm_password=short`.
- **Assertion (Then):** Response status is 200 (re-renders form). Body contains error message about minimum length. Mock `createUser` was NOT called.

**TS-E4: Mismatched passwords rejected**

- **Setup (Given):** Mock `getUserCount()` to return 0.
- **Action (When):** POST `/setup/step/1` with `password=password123`, `confirm_password=different456`.
- **Assertion (Then):** Response status is 200. Body contains error message about passwords not matching. Mock `createUser` was NOT called.

**TS-E5: Direct navigation to later step redirects to step 1**

- **Setup (Given):** Mock `getUserCount()` to return 0. No session cookie.
- **Action (When):** `app.request("/setup/step/3")`.
- **Assertion (Then):** Response status is 302. `Location` is `/setup`.

**TS-E6: Refreshing Done page shows summary without side effects**

- **Setup (Given):** Authenticated session. User exists in DB.
- **Action (When):** GET `/setup/step/4` twice with same session cookie.
- **Assertion (Then):** Both responses are 200. Both contain the summary. User table still has exactly one row.

**TS-E9: Double-submit creates only one user**

- **Setup (Given):** Integration test with real DB. User table is empty.
- **Action (When):** POST `/setup/step/1` twice concurrently with identical valid credentials.
- **Assertion (Then):** Query `SELECT COUNT(*) FROM "user"` returns 1. At least one POST receives a redirect (success), the other receives either a redirect or an error (not a crash/500).

**TS-E10: Ollama unreachable in step 2**

- **Setup (Given):** Authenticated session. Mock `fetch` for Ollama `/api/tags` to reject/timeout.
- **Action (When):** `app.request("/setup/step/2", { headers: { Cookie: sessionCookie } })`.
- **Assertion (Then):** Response status is 200. Body contains "No models" indication. Form is still submittable (contains submit button).

**TS-E11: Empty display name stored as NULL**

- **Setup (Given):** Mock `getUserCount()` to return 0. Mock `createUser` to capture arguments.
- **Action (When):** POST `/setup/step/1` with `display_name=` (empty), `password=securepass123`, `confirm_password=securepass123`.
- **Assertion (Then):** `createUser` called with `displayName` as `null` (or undefined). User row created successfully.

## Fixtures & Test Data

### Shared Helpers

**`createSetupApp(overrides?)`** — Creates a Hono app with setup/auth middleware and mock dependencies. Accepts optional overrides for `getUserCount`, `getUserPasswordHash`, `createUser`, `saveLLMConfig`, `saveAllSettings`.

**`completeStep1(app)`** — Posts valid account data to step 1 and returns the session cookie. Used as setup for step 2/3/4 tests.

**`loginAndGetCookie(app, password)`** — Reused from existing `tests/unit/web-auth.test.ts` pattern. Posts to `/login` and extracts the `Set-Cookie` header.

### Module Mocks

The following modules will be mocked in unit tests:

- `src/web/setup-queries.ts` (new) — `getUserCount()`, `getUserPasswordHash()`, `createUser()`, `getSetupSummary()`
- `src/web/settings-queries.ts` — `getAllSettings()`, `saveAllSettings()` (existing)
- `src/llm/config.ts` — `getLLMConfig()`, `saveLLMConfig()` (existing)
- `bcryptjs` — Mock for unit tests; real bcrypt used in integration tests

### Integration Test DB

Integration tests use `startTestDb()` from `tests/helpers/test-db.ts` to spin up a pgvector container. Migrations run in `beforeAll`. Each test truncates the `user` and `settings` tables in `beforeEach`.

## Alignment Check

**Full alignment.** Every test scenario (TS-1.1 through TS-8.4, TS-E1 through TS-E11) is mapped to a test function with setup, action, and assertion defined. No gaps. No orphan tests.

**Design notes:**
- TS-3.2 (Ollama UI) tests the server-rendered HTML, not client-side JS behavior. Provider switching is client-side and outside unit test scope.
- TS-7.6 (removed env vars) will need to be adapted as `config.ts` is refactored — the test verifies the NEW behavior where env vars are ignored.
- TS-8.1 through TS-8.4 (degradation) test behavior of existing modules (`telegram.ts`, `classify.ts`, `digests.ts`, `google-calendar.ts`) with missing config — these test the new code paths added for graceful degradation.
