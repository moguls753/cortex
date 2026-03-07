# Web Settings - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Web Settings |
| Phase | 3 |
| Date | 2026-03-07 |
| Derives From | `web-settings-test-specification.md` |

## Spec Discrepancy: Setting Key Names

The behavioral spec (written earlier) uses `anthropic_model` and `ANTHROPIC_MODEL`, but the project is LLM-agnostic per CLAUDE.md. The actual config (`src/config.ts`) uses:

| Behavioral Spec Key | Actual Settings Key | Env Var | Config Property |
|---------------------|---------------------|---------|-----------------|
| `anthropic_model` | `llm_model` | `LLM_MODEL` | `config.llmModel` |

Additionally, `telegram_chat_ids` is not currently in `SETTINGS_TO_ENV`. The implementation will need to add it (or handle it separately). Tests use the actual keys from `config.ts` (`llm_model`, not `anthropic_model`), and the UI label will say "LLM Model" or "Classification Model".

The behavioral spec should be updated to reflect this, but tests are written against the correct keys.

## Test Framework & Conventions

- **Framework:** Vitest (project standard)
- **Style:** `describe`/`it` blocks with explicit imports
- **HTTP testing:** Hono's built-in `app.request(url, init?)` — no real server needed
- **Module mocking:** `vi.mock()` for settings query module
- **DB testing:** testcontainers with `pgvector/pgvector:pg16` (existing `tests/helpers/test-db.ts`)
- **Auth reuse:** Login helper pattern from web-entry/web-new-note tests
- **Fetch mocking:** `vi.spyOn(globalThis, 'fetch')` default mock in `beforeEach` (Ollama check runs on every save)

## Test Structure

### File Organization

```
tests/unit/web-settings.test.ts                    # 31 unit tests (mocked queries)
tests/integration/web-settings-integration.test.ts  # 7 integration tests (testcontainers)
```

**Unit tests** mock the settings query layer (`getAllSettings`, `saveAllSettings`) and `globalThis.fetch` (Ollama check). They test HTTP handler behavior: form rendering, validation, save logic, auth enforcement, edge cases.

**Integration tests** use testcontainers with real PostgreSQL to verify actual persistence, `updated_at` trigger, settings resolution via the page, and concurrent writes.

### Test Grouping

```typescript
// Unit tests
describe("Web Settings", () => {
  describe("Telegram Chat IDs (US-1)", () => { /* TS-1.1, TS-1.2, TS-1.3, TS-1.5 */ });
  describe("Classification Model (US-2)", () => { /* TS-2.1, TS-2.2 */ });
  describe("Digest Schedules (US-3)", () => { /* TS-3.1, TS-3.2, TS-3.2b, TS-3.3, TS-3.4 */ });
  describe("Other Preferences (US-4)", () => { /* TS-4.1, TS-4.2, TS-4.3, TS-4.4, TS-4.5 */ });
  describe("Constraints", () => { /* TS-6.1, TS-6.1b, TS-6.2 */ });
  describe("Edge Cases", () => { /* TS-7.1, TS-7.1b, TS-7.1c, TS-7.1d-a, TS-7.1d-b, TS-7.2, TS-7.3, TS-7.4, TS-7.5, TS-7.6, TS-7.8 */ });
  describe("Non-Goal Guards", () => { /* TS-8.1 */ });
});

// Integration tests
describe("Web Settings Integration", () => {
  describe("Persistence (US-5)", () => { /* TS-5.1, TS-5.2, TS-5.3 */ });
  describe("Save and Read Back", () => { /* INT-1, INT-2 */ });
  describe("Concurrent Writes", () => { /* TS-7.7 */ });
  describe("Telegram Chat IDs Persistence", () => { /* INT-3 */ });
});
```

### Naming Convention

```typescript
// Unit tests
it("displays current Telegram chat IDs with remove buttons")          // TS-1.1
it("adds a new chat ID to existing list")                              // TS-1.2
it("removes a chat ID from list")                                      // TS-1.3
it("rejects removing the last chat ID")                                // TS-1.5
it("displays current LLM model name")                                  // TS-2.1
it("saves changed model name")                                         // TS-2.2
it("displays current digest cron expressions")                         // TS-3.1
it("saves valid daily cron expression")                                // TS-3.2
it("saves valid weekly cron expression")                               // TS-3.2b
it("shows default cron values when no settings exist")                 // TS-3.3
it("rejects invalid cron expression")                                  // TS-3.4
it("displays current timezone")                                        // TS-4.1
it("displays current confidence threshold")                            // TS-4.2
it("displays current digest email")                                    // TS-4.3
it("displays current Ollama URL")                                      // TS-4.4
it("saves all preferences in one submission")                          // TS-4.5
it("redirects unauthenticated GET to login")                           // TS-6.1
it("redirects unauthenticated POST to login")                          // TS-6.1b
it("returns server-rendered HTML with form")                           // TS-6.2
it("rejects confidence threshold above 1.0")                          // TS-7.1
it("rejects negative confidence threshold")                            // TS-7.1b
it("rejects non-numeric confidence threshold")                         // TS-7.1c
it("accepts confidence threshold 0.0")                                 // TS-7.1d-a
it("accepts confidence threshold 1.0")                                 // TS-7.1d-b
it("saves unreachable Ollama URL with warning")                        // TS-7.2
it("saves empty email and shows disabled note")                        // TS-7.3
it("rejects non-numeric Telegram chat ID")                             // TS-7.4
it("saves timezone change")                                            // TS-7.5
it("shows hardcoded defaults when settings table is empty")            // TS-7.6
it("shows Telegram chat ID from env var fallback")                     // TS-7.8
it("does not expose API keys or secrets")                              // TS-8.1

// Integration tests
it("persists setting as key-value pair with updated_at")               // TS-5.1
it("settings page shows DB value over env var")                        // TS-5.2
it("settings page shows env var when no DB setting exists")            // TS-5.3
it("saves and reads back all settings through the page")               // INT-1
it("validation errors do not change existing settings")                // INT-2
it("last write wins on concurrent saves")                              // TS-7.7
it("adds and removes Telegram chat IDs through the page")              // INT-3
```

## Expected Module API

### Settings Routes (`src/web/settings.ts`)

```typescript
export function createSettingsRoutes(sql: Sql): Hono;
```

The factory returns a Hono sub-app with:
- `GET /settings` — reads all settings, merges with env var fallbacks and hardcoded defaults, renders form
- `POST /settings` — validates all fields, saves valid settings, redirects back to `GET /settings` with success/error flash message

### Settings Queries (`src/web/settings-queries.ts`)

```typescript
// Read all settings from the DB as a flat key-value map
export async function getAllSettings(sql: Sql): Promise<Record<string, string>>;

// Upsert multiple settings at once (INSERT ... ON CONFLICT UPDATE)
export async function saveAllSettings(sql: Sql, settings: Record<string, string>): Promise<void>;
```

### Resolution Logic (in route handler, not query module)

The GET handler resolves effective values for each field:

```typescript
function resolveEffective(
  dbSettings: Record<string, string>,
  key: string,
  envVar: string | undefined,
  defaultValue: string
): string {
  return dbSettings[key] ?? envVar ?? defaultValue;
}
```

This mirrors the existing `resolveConfigValue` from `src/config.ts` but is synchronous since all DB settings are loaded upfront via `getAllSettings`.

### Validation (in route handler)

The POST handler validates before saving:

1. **Cron expressions** — validated via `cron-parser` library or simple regex. Invalid → error, no save.
2. **Confidence threshold** — `parseFloat()`, check `>= 0.0 && <= 1.0` and `!isNaN()`. Invalid → error.
3. **Telegram chat IDs** — each ID checked with `/^-?\d+$/`. Empty list → error. Non-numeric → error.
4. **Ollama URL** — saved regardless, but connectivity checked via `fetch()` with 3s timeout. Unreachable → warning (not error).
5. **Other fields** (model, timezone, email) — no validation beyond presence. Saved as-is.

### Flash Messages

The POST handler communicates success/error/warning via query params on redirect:

```
/settings?success=Settings+saved
/settings?error=Invalid+cron+expression
/settings?success=Settings+saved&warning=Could+not+connect+to+Ollama...
```

The GET handler reads these and renders them in the page. This is consistent with other features in the project (no session-based flash).

### Telegram Chat IDs Form Mechanics

Since we chose "Save All", Telegram chat IDs are managed as follows:

- The GET handler renders current chat IDs as a list with hidden inputs + remove buttons
- Client-side JS: "Add" button appends to the list, "Remove" button removes from the list (DOM manipulation)
- The POST handler receives `chat_ids` as a comma-separated string (or multiple form values)
- Server validates each ID is numeric, ensures at least one remains

For unit tests, we submit the full `chat_ids` value directly — no need to test client-side DOM manipulation.

## Test App Factory

### Unit Test Factory

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestSettings(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createSettingsRoutes } = await import("../../src/web/settings.js");

  const mockSql = {} as any; // Query functions are mocked via vi.mock()

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createSettingsRoutes(mockSql));

  return { app };
}
```

### Login Helper (reused pattern)

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
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
```

### Integration Test Factory

```typescript
import { startTestDb, runMigrations } from "../helpers/test-db.js";

let sql: Sql;
let container: StartedTestContainer;

beforeAll(async () => {
  const db = await startTestDb();
  container = db.container;
  sql = db.sql;
  await runMigrations(db.url);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

async function createIntegrationSettings(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createSettingsRoutes } = await import("../../src/web/settings.js");

  const app = new Hono();
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET));
  app.route("/", createSettingsRoutes(sql));

  return { app };
}
```

## Test Scenario Mapping

| Test Scenario ID | Scenario Title | Test File | Test Function |
|------------------|----------------|-----------|---------------|
| TS-1.1 | Display current Telegram chat IDs | unit | `it("displays current Telegram chat IDs with remove buttons")` |
| TS-1.2 | Add a new Telegram chat ID | unit | `it("adds a new chat ID to existing list")` |
| TS-1.3 | Remove a Telegram chat ID | unit | `it("removes a chat ID from list")` |
| TS-1.5 | Cannot remove the last Telegram chat ID | unit | `it("rejects removing the last chat ID")` |
| TS-2.1 | Display current model name | unit | `it("displays current LLM model name")` |
| TS-2.2 | Change model name | unit | `it("saves changed model name")` |
| TS-3.1 | Display digest cron expressions | unit | `it("displays current digest cron expressions")` |
| TS-3.2 | Save valid cron expressions | unit | `it("saves valid daily cron expression")` |
| TS-3.2b | Save valid weekly cron expression | unit | `it("saves valid weekly cron expression")` |
| TS-3.3 | Default cron values shown | unit | `it("shows default cron values when no settings exist")` |
| TS-3.4 | Invalid cron expression rejected | unit | `it("rejects invalid cron expression")` |
| TS-4.1 | Display timezone | unit | `it("displays current timezone")` |
| TS-4.2 | Display confidence threshold | unit | `it("displays current confidence threshold")` |
| TS-4.3 | Display digest email | unit | `it("displays current digest email")` |
| TS-4.4 | Display Ollama URL | unit | `it("displays current Ollama URL")` |
| TS-4.5 | Save all preferences | unit | `it("saves all preferences in one submission")` |
| TS-5.1 | Settings stored in DB | integration | `it("persists setting as key-value pair with updated_at")` |
| TS-5.2 | Settings override env vars | integration | `it("settings page shows DB value over env var")` |
| TS-5.3 | Fallback to env var | integration | `it("settings page shows env var when no DB setting exists")` |
| TS-6.1 | Auth required GET | unit | `it("redirects unauthenticated GET to login")` |
| TS-6.1b | Auth required POST | unit | `it("redirects unauthenticated POST to login")` |
| TS-6.2 | Server-rendered HTML | unit | `it("returns server-rendered HTML with form")` |
| TS-7.1 | Threshold out of range (high) | unit | `it("rejects confidence threshold above 1.0")` |
| TS-7.1b | Threshold negative | unit | `it("rejects negative confidence threshold")` |
| TS-7.1c | Threshold non-numeric | unit | `it("rejects non-numeric confidence threshold")` |
| TS-7.1d | Threshold boundary 0.0 | unit | `it("accepts confidence threshold 0.0")` |
| TS-7.1d | Threshold boundary 1.0 | unit | `it("accepts confidence threshold 1.0")` |
| TS-7.2 | Unreachable Ollama URL | unit | `it("saves unreachable Ollama URL with warning")` |
| TS-7.3 | Empty email disables digests | unit | `it("saves empty email and shows disabled note")` |
| TS-7.4 | Invalid chat ID format | unit | `it("rejects non-numeric Telegram chat ID")` |
| TS-7.5 | Timezone change | unit | `it("saves timezone change")` |
| TS-7.6 | Empty table defaults | unit | `it("shows hardcoded defaults when settings table is empty")` |
| TS-7.7 | Last write wins | integration | `it("last write wins on concurrent saves")` |
| TS-7.8 | Chat ID env fallback | unit | `it("shows Telegram chat ID from env var fallback")` |
| TS-8.1 | No secrets exposed | unit | `it("does not expose API keys or secrets")` |

Additional integration tests (not from test spec, but needed for end-to-end verification):

| ID | Title | Test Function |
|----|-------|---------------|
| INT-1 | Save and read back | `it("saves and reads back all settings through the page")` |
| INT-2 | Validation preserves existing | `it("validation errors do not change existing settings")` |
| INT-3 | Chat IDs CRUD | `it("adds and removes Telegram chat IDs through the page")` |

## Detailed Scenario Implementation

### Group 1: Telegram Chat IDs (US-1)

#### TS-1.1: Display current Telegram chat IDs (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ telegram_chat_ids: "123456,789012" }`. Create test app. Login.
- **Action (When):** `app.request("/settings", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response status 200. Body contains "123456" and "789012". Body contains remove button elements (one per chat ID). Body contains an input for adding new IDs and an "Add" control.

#### TS-1.2: Add a new Telegram chat ID (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ telegram_chat_ids: "123456" }`. Mock `saveAllSettings` to resolve. Create test app. Login.
- **Action (When):** `app.request("/settings", { method: "POST", body: new URLSearchParams({ chat_ids: "123456,789012", llm_model: "claude-sonnet-4-20250514", daily_digest_cron: "30 7 * * *", weekly_digest_cron: "0 16 * * 0", timezone: "Europe/Berlin", confidence_threshold: "0.6", digest_email_to: "", ollama_url: "http://ollama:11434" }), headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response is redirect (302/303) to `/settings` with success param. Verify `saveAllSettings` was called with an object containing `telegram_chat_ids: "123456,789012"`.

Note: Since it's "Save All", every POST submits all fields. Tests must include all required fields to avoid validation errors on unrelated fields. A helper `buildFormData(overrides)` constructs the full form with defaults.

#### TS-1.3: Remove a Telegram chat ID (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ telegram_chat_ids: "123456,789012" }`. Mock `saveAllSettings` to resolve. Create test app. Login.
- **Action (When):** POST `/settings` with `chat_ids: "123456"` (789012 removed) and all other fields at defaults.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` was called with `telegram_chat_ids: "123456"`.

#### TS-1.5: Cannot remove the last Telegram chat ID (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ telegram_chat_ids: "123456" }`. Create test app. Login.
- **Action (When):** POST `/settings` with `chat_ids: ""` (empty — all removed).
- **Assertion (Then):** Response is redirect to `/settings` with error param containing "At least one authorized chat ID is required." Verify `saveAllSettings` was NOT called.

---

### Group 2: Classification Model (US-2)

#### TS-2.1: Display current LLM model name (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ llm_model: "claude-haiku-4-5-20251001" }`. Create test app. Login.
- **Action (When):** `app.request("/settings", { headers: { Cookie: cookie } })`.
- **Assertion (Then):** Response body contains an input with value "claude-haiku-4-5-20251001".

#### TS-2.2: Save changed model name (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Create test app. Login.
- **Action (When):** POST `/settings` with `llm_model: "claude-haiku-4-5-20251001"` and all other fields at defaults.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with object containing `llm_model: "claude-haiku-4-5-20251001"`.

---

### Group 3: Digest Schedules (US-3)

#### TS-3.1: Display digest cron expressions (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ daily_digest_cron: "0 8 * * *", weekly_digest_cron: "0 18 * * 5" }`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "0 8 * * *" and input with value "0 18 * * 5".

#### TS-3.2: Save valid daily cron expression (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Create test app. Login.
- **Action (When):** POST `/settings` with `daily_digest_cron: "0 9 * * *"` and all other fields at defaults.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with `daily_digest_cron: "0 9 * * *"`.

#### TS-3.2b: Save valid weekly cron expression (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Create test app. Login.
- **Action (When):** POST `/settings` with `weekly_digest_cron: "0 18 * * 5"` and all other fields at defaults.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with `weekly_digest_cron: "0 18 * * 5"`.

#### TS-3.3: Default cron values shown when no settings exist (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{}` (empty). Set no env vars for cron. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "30 7 * * *" (daily default) and "0 16 * * 0" (weekly default).

#### TS-3.4: Invalid cron expression rejected (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ daily_digest_cron: "30 7 * * *" }`. Create test app. Login.
- **Action (When):** POST `/settings` with `daily_digest_cron: "not a cron"` and all other fields valid.
- **Assertion (Then):** Redirect to `/settings` with error param containing "Invalid cron expression". Verify `saveAllSettings` was NOT called.

---

### Group 4: Other Preferences (US-4)

#### TS-4.1: Display timezone (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ timezone: "America/New_York" }`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "America/New_York".

#### TS-4.2: Display confidence threshold (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ confidence_threshold: "0.8" }`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "0.8".

#### TS-4.3: Display digest email (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ digest_email_to: "user@example.com" }`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "user@example.com".

#### TS-4.4: Display Ollama URL (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ ollama_url: "http://localhost:11434" }`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "http://localhost:11434".

#### TS-4.5: Save all preferences in one submission (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Create test app. Login. (Default fetch mock returns 200 — Ollama reachable.)
- **Action (When):** POST `/settings` with `timezone: "UTC"`, `confidence_threshold: "0.7"`, `digest_email_to: "new@example.com"`, `ollama_url: "http://ollama:11434"`, and all other fields at defaults.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with object containing all four updated values plus defaults for other fields.

---

### Group 5: Persistence & Resolution (US-5)

#### TS-5.1: Settings stored as key-value pairs with updated_at (integration)

- **Setup (Given):** Create integration app. Login. Clear settings table.
- **Action (When):** POST `/settings` with `llm_model: "claude-haiku-4-5-20251001"` and all other fields at defaults.
- **Assertion (Then):** Query the DB: `SELECT * FROM settings WHERE key = 'llm_model'`. Row exists with `value = 'claude-haiku-4-5-20251001'` and `updated_at` is a recent timestamp (within last 10 seconds).

#### TS-5.2: Settings page shows DB value over env var (integration)

- **Setup (Given):** Insert `llm_model = "db-model"` into settings table. Set env var `LLM_MODEL = "env-model"`. Create integration app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "db-model" (not "env-model").

Note: Uses `withEnv` helper from `tests/helpers/env.ts` for env var management.

#### TS-5.3: Settings page shows env var when no DB setting (integration)

- **Setup (Given):** Ensure no `llm_model` row in settings table. Set env var `LLM_MODEL = "env-model"`. Create integration app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains input with value "env-model".

---

### Group 6: Constraints

#### TS-6.1: Auth required GET (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/settings")`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`.

#### TS-6.1b: Auth required POST (unit)

- **Setup (Given):** Create test app. No cookie.
- **Action (When):** `app.request("/settings", { method: "POST", body: new URLSearchParams({ llm_model: "test" }), headers: { "Content-Type": "application/x-www-form-urlencoded" } })`.
- **Assertion (Then):** Response status 302. `Location` header contains `/login`. Verify `saveAllSettings` was NOT called.

#### TS-6.2: Settings page is server-rendered HTML (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{}`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Response status 200. `Content-Type` contains `text/html`. Body contains `<form` and `<input` elements. Body contains the standard layout (e.g., `<!DOCTYPE html>` or the layout wrapper).

---

### Group 7: Edge Cases

#### TS-7.1: Confidence threshold above 1.0 (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ confidence_threshold: "0.6" }`. Create test app. Login.
- **Action (When):** POST `/settings` with `confidence_threshold: "1.5"` and all other fields valid.
- **Assertion (Then):** Redirect with error containing "Confidence threshold must be between 0.0 and 1.0." Verify `saveAllSettings` was NOT called.

#### TS-7.1b: Confidence threshold negative (unit)

- **Setup (Given):** Same as TS-7.1.
- **Action (When):** POST with `confidence_threshold: "-0.1"`.
- **Assertion (Then):** Same error, `saveAllSettings` not called.

#### TS-7.1c: Confidence threshold non-numeric (unit)

- **Setup (Given):** Same as TS-7.1.
- **Action (When):** POST with `confidence_threshold: "abc"`.
- **Assertion (Then):** Same error, `saveAllSettings` not called.

#### TS-7.1d: Confidence threshold boundary 0.0 accepted (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Create test app. Login.
- **Action (When):** POST with `confidence_threshold: "0.0"` and all other fields valid.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with `confidence_threshold: "0.0"`.

#### TS-7.1d: Confidence threshold boundary 1.0 accepted (unit)

- **Setup (Given):** Same as above.
- **Action (When):** POST with `confidence_threshold: "1.0"`.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with `confidence_threshold: "1.0"`.

#### TS-7.2: Unreachable Ollama URL saved with warning (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Override default fetch mock: `vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"))`. Create test app. Login.
- **Action (When):** POST with `ollama_url: "http://unreachable:11434"` and all other fields valid.
- **Assertion (Then):** Redirect to `/settings` with success AND warning param. Warning contains "Could not connect to Ollama". Verify `saveAllSettings` was called (setting saved despite unreachable).

#### TS-7.3: Empty email disables email digests (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{ digest_email_to: "user@example.com" }`. Mock `saveAllSettings`. Create test app. Login.
- **Action (When):** POST with `digest_email_to: ""` and all other fields valid.
- **Assertion (Then):** Redirect with success. Follow redirect (GET `/settings` with mock returning the updated value): body contains "Email digests are disabled" note.

Note: The "disabled" note is shown on the GET handler when `digest_email_to` is empty. The unit test can verify this by mocking `getAllSettings` to return `{ digest_email_to: "" }` and checking the rendered page.

Simplified approach: Two assertions — (1) POST saves empty email successfully, (2) separate GET with empty email shows the note.

#### TS-7.4: Invalid Telegram chat ID format (unit)

- **Setup (Given):** Mock `getAllSettings`. Create test app. Login.
- **Action (When):** POST with `chat_ids: "123456,not-a-number"` and all other fields valid.
- **Assertion (Then):** Redirect with error containing "Chat ID must be numeric". Verify `saveAllSettings` was NOT called.

#### TS-7.5: Timezone change saved (unit)

- **Setup (Given):** Mock `getAllSettings`. Mock `saveAllSettings`. Create test app. Login.
- **Action (When):** POST with `timezone: "America/New_York"` and all other fields at defaults.
- **Assertion (Then):** Redirect with success. Verify `saveAllSettings` called with `timezone: "America/New_York"`.

#### TS-7.6: Empty settings table shows hardcoded defaults (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{}`. Ensure relevant env vars are not set (or mock them away). Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains:
  - LLM model input with value matching `config.llmModel` default (`"claude-sonnet-4-20250514"`)
  - Daily cron input with `"30 7 * * *"`
  - Weekly cron input with `"0 16 * * 0"`
  - Timezone input with `"Europe/Berlin"`
  - Confidence threshold input with `"0.6"`
  - Ollama URL input with `"http://ollama:11434"`
  - Email input empty
  - Telegram chat IDs section empty or showing env var value

Note: Defaults come from `config.ts` static object and hardcoded fallbacks in the handler. The handler knows the defaults — they're not from the DB.

#### TS-7.7: Last write wins on concurrent saves (integration)

- **Setup (Given):** Create integration app. Login (get cookie). Clear settings table.
- **Action (When):** POST `/settings` with `confidence_threshold: "0.7"`. Then POST `/settings` with `confidence_threshold: "0.8"`.
- **Assertion (Then):** Query DB: `SELECT value FROM settings WHERE key = 'confidence_threshold'`. Value is `"0.8"`.

#### TS-7.8: Telegram chat IDs fall back to env var (unit)

- **Setup (Given):** Mock `getAllSettings` to return `{}` (no telegram_chat_ids in DB). Set env var `TELEGRAM_CHAT_ID = "999888"`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains "999888" in the Telegram section.

Note: The handler must check env var `TELEGRAM_CHAT_ID` when no `telegram_chat_ids` setting exists in DB. This is a special case since `telegram_chat_ids` may not be in `SETTINGS_TO_ENV` — the handler resolves it directly.

---

### Group 8: Non-Goal Guards

#### TS-8.1: No secrets exposed (unit)

- **Setup (Given):** Set env vars `LLM_API_KEY=sk-test-key-123`, `TELEGRAM_BOT_TOKEN=bot-token-456`, `SESSION_SECRET=secret-789`. Mock `getAllSettings` to return `{}`. Create test app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body does NOT contain "sk-test-key-123", "bot-token-456", or "secret-789". Body does NOT contain input fields with names like "api_key", "bot_token", or "session_secret".

---

### Integration-Only Scenarios

#### INT-1: Save and read back all settings through the page (integration)

- **Setup (Given):** Create integration app. Login. Clear settings table.
- **Action (When):** POST `/settings` with all fields set to non-default values. Then GET `/settings`.
- **Assertion (Then):** The GET response body contains all the values that were just saved. Verifies full round-trip through the page.

#### INT-2: Validation errors do not change existing settings (integration)

- **Setup (Given):** Create integration app. Login. Save valid settings (POST with valid values). Then POST with an invalid confidence_threshold.
- **Action (When):** GET `/settings` after the failed save.
- **Assertion (Then):** Page shows the original valid values (not the invalid ones from the failed save).

#### INT-3: Add and remove Telegram chat IDs through the page (integration)

- **Setup (Given):** Create integration app. Login. Clear settings table.
- **Action (When):** POST with `chat_ids: "111,222"`. Then POST with `chat_ids: "111"` (removed 222). Then GET `/settings`.
- **Assertion (Then):** Page shows only "111". DB has `telegram_chat_ids = "111"`.

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
```

### Form Data Helper

Since every POST submits the full form, a helper builds defaults:

```typescript
function buildFormData(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    chat_ids: "123456",
    llm_model: "claude-sonnet-4-20250514",
    daily_digest_cron: "30 7 * * *",
    weekly_digest_cron: "0 16 * * 0",
    timezone: "Europe/Berlin",
    confidence_threshold: "0.6",
    digest_email_to: "",
    ollama_url: "http://ollama:11434",
    ...overrides,
  });
}
```

This allows each test to override only the field under test:

```typescript
// Only change the field being tested
const body = buildFormData({ confidence_threshold: "1.5" });
```

### Shared Helpers

| Helper | Purpose | Scope |
|--------|---------|-------|
| `createTestSettings()` | Unit: Hono app with mocked query layer + auth | Per-test |
| `createIntegrationSettings()` | Integration: Hono app with real DB + auth | Per-test |
| `loginAndGetCookie(app, password?)` | Authenticates and returns session cookie string | Per-test |
| `buildFormData(overrides?)` | Builds full form URLSearchParams with defaults | Per-test |
| `clearSettings(sql)` | Integration: truncates settings table between tests | Per-test |
| `withEnv(vars)` | Sets env vars temporarily, returns restore function | Per-test |

### Mocking Strategy

**Unit tests mock two layers:**

1. **Settings queries** — Via `vi.mock()` on settings-queries:
   ```typescript
   vi.mock("../../src/web/settings-queries.js", () => ({
     getAllSettings: vi.fn().mockResolvedValue({}),
     saveAllSettings: vi.fn().mockResolvedValue(undefined),
   }));
   ```

2. **Fetch** (Ollama connectivity check) — Via `vi.spyOn(globalThis, 'fetch')`:
   ```typescript
   // For TS-7.2 (unreachable)
   vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

   // For TS-4.5 (reachable)
   vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
   ```

**Integration tests mock only `globalThis.fetch`** for the Ollama connectivity check (Ollama is not available in CI/test). All DB queries hit real PostgreSQL via testcontainers — no query mocks.

### Setup / Teardown

```typescript
// Unit tests
beforeEach(async () => {
  vi.clearAllMocks();
  // Default fetch mock — Ollama check runs on every POST save
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Integration tests
beforeEach(async () => {
  await sql`TRUNCATE settings`;
  vi.clearAllMocks();
  // Mock fetch for Ollama check (Ollama not available in test)
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

The default fetch mock returns 200 (Ollama reachable). Tests like TS-7.2 override this per-test with `mockRejectedValue`.

## Env Var Handling in Tests

Several tests need to control env vars (TS-5.2, TS-5.3, TS-7.6, TS-7.8, TS-8.1). The existing `withEnv` helper from `tests/helpers/env.ts` handles this:

```typescript
const restore = withEnv({ TELEGRAM_CHAT_ID: "999888" });
// ... test ...
restore(); // in afterEach
```

For TS-7.6 (no env vars set), tests must ensure the relevant env vars are unset. The `withEnv` helper can set them to `undefined` or the test can save and restore them manually.

Important: `config.ts` reads env vars at import time into `config` object. For tests that need different env var values, use `vi.resetModules()` + dynamic `import()` to re-read env vars. However, the settings route handler should use `resolveConfigValue` or the `resolveEffective` logic at request time, not at import time — so env var changes via `withEnv` should be visible without module resets for the route handler.

## Alignment Check

**Status: Full alignment.**

All 35 test scenarios from the test specification are mapped to test functions with setup, action, and assertion strategies defined. Plus 3 integration-only scenarios for end-to-end verification.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (35/35 from test spec + 3 integration-only = 38 functions) |
| One behavior per test | Yes |
| All tests will initially fail | Yes — `src/web/settings.ts` and `src/web/settings-queries.ts` do not exist |
| Test isolation verified | Yes (per-test factory, `TRUNCATE settings` between integration tests, `vi.clearAllMocks()`) |
| No implementation coupling | Yes (tests verify observable HTTP behavior + mock call args) |

Split: **31 unit tests + 7 integration tests = 38 test functions** (35 from test spec + 3 integration-only).

### Notes

1. **TS-6.1 / TS-6.1b** (auth enforcement) may pass early if auth middleware is already wired — the test checks for 302 redirect to `/login`, which works as long as the route pattern `/settings` doesn't match anything without the route being mounted.

2. **Key name discrepancy** — Tests use `llm_model` (from `config.ts` SETTINGS_TO_ENV), not `anthropic_model` (from behavioral spec). The behavioral spec should be updated, but tests are correct.

3. **Ollama fetch mock** — Default `globalThis.fetch` mock in `beforeEach` returns 200 (Ollama reachable). The handler checks Ollama on every POST save. TS-7.2 overrides the mock to throw. Validation-failure tests (TS-3.4, TS-7.1, etc.) never reach the Ollama check since the handler rejects early, but the default mock prevents unexpected network calls.

4. **`buildFormData` helper** is critical — since every POST submits all fields, each test must send valid values for all fields except the one under test. Without this helper, tests would be verbose and fragile.

5. **Null guard pattern** — consistent with other features: `(await getAllSettings(sql)) ?? {}` to handle `vi.clearAllMocks()` resetting mock implementations.

6. **telegram_chat_ids** needs to be added to `SETTINGS_TO_ENV` in `config.ts` (mapping to `TELEGRAM_CHAT_ID` env var), or the settings route handler must resolve it specially. Tests verify the behavior regardless of implementation approach.
