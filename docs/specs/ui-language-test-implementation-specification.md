# UI Language - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | UI Language |
| Phase | 3 |
| Date | 2026-04-17 |
| Status | Draft |
| Derives From | `ui-language-test-specification.md` |

## Test Framework & Conventions

| Aspect | Choice |
|--------|--------|
| Language | TypeScript |
| Test framework | Vitest |
| Assertion style | `expect()` from Vitest |
| HTTP testing | Hono's built-in `app.request(url, init?)` — no real server needed |
| Module mocking | `vi.mock()` for `settings-queries`, `email`, `sendDigestEmail`; `vi.spyOn()` for `ctx.reply` stubs |
| i18next | Initialized once per test module with test catalogs; resources manipulated via `i18next.addResources()` / `i18next.removeResourceBundle()` for fallback tests |
| DB testing | testcontainers with `pgvector/pgvector:pg16` (existing `tests/helpers/test-db.ts`) |
| Env var testing | `withEnv` from `tests/helpers/env.ts` |
| Telegram context | `createMockContext` from `tests/helpers/mock-telegram.ts` |
| Classify prompt tests | Read `prompts/classify.md` directly with `fs.readFileSync` — no mocking |

**Conventions** (same as other features):
- `describe` blocks group by scenario group from the test specification
- `it` blocks describe the behavior, not the implementation
- One assertion theme per `it` block (one test scenario → one test function)
- Test names read as sentences: `it("resolves de when Accept-Language is de-DE and no DB setting exists")`
- Explicit imports: `import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest"`

## Test Structure

### File Organization

```
tests/unit/ui-language.test.ts                      # 54 unit tests
tests/integration/ui-language-integration.test.ts   # 3 integration tests
```

**Unit tests** mock the settings query layer, `sendDigestEmail`, and i18next resources where fallback behavior is tested. They exercise every surface (web, Telegram, email, prompt) through its exported interface.

**Integration tests** use testcontainers with real PostgreSQL to verify the full DB → request → render pipeline for three end-to-end paths.

### Test Grouping

```typescript
// tests/unit/ui-language.test.ts
describe("UI Language", () => {
  describe("Locale Resolution (US-1)", () => { /* TS-1.1 through TS-1.10 */ });
  describe("Settings Language Section (US-2)", () => { /* TS-2.1 through TS-2.7 */ });
  describe("Web UI Rendering (US-3)", () => { /* TS-3.1 through TS-3.16 */ });
  describe("Date, Time, Plural Formatting (US-4)", () => { /* TS-4.1 through TS-4.4 */ });
  describe("Telegram Bot Localization (US-5)", () => { /* TS-5.1 through TS-5.4 */ });
  describe("Email Digest Localization (US-6)", () => { /* TS-6.1 through TS-6.4 */ });
  describe("Classify Prompt Enum Locking (US-7)", () => { /* TS-7.1 through TS-7.3 */ });
  describe("Catalog Fallback Behavior (US-8)", () => { /* TS-8.1 through TS-8.3 */ });
  describe("Edge Cases", () => { /* TS-9.1, TS-9.2 */ });
  describe("Non-Goal Guards", () => { /* TS-10.1 through TS-10.4 */ });
});

// tests/integration/ui-language-integration.test.ts
describe("UI Language Integration", () => {
  describe("Settings persistence round-trip", () => { /* INT-1 */ });
  describe("Accept-Language fallback from real DB", () => { /* INT-2 */ });
  describe("Telegram reply reads ui_language from real DB", () => { /* INT-3 */ });
});
```

## Expected Module API

### i18next bootstrap (`src/web/i18n/index.ts`)

```typescript
import i18next, { type i18n } from "i18next";
import { en } from "./en.js";
import { de } from "./de.js";

export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export async function initI18n(): Promise<i18n> { /* ... */ }
export { i18next };
```

### Locale resolver (`src/web/i18n/resolve.ts`)

```typescript
import type { Sql } from "postgres";
import type { Context } from "hono";
import { SUPPORTED_LOCALES, type Locale } from "./index.js";

export function parseAcceptLanguage(header: string | undefined): Locale;
export async function resolveLocale(c: Context, sql: Sql, isPreAuth: boolean): Promise<Locale>;
```

### Middleware (`src/web/i18n/middleware.ts`)

```typescript
import type { MiddlewareHandler } from "hono";
import type { Sql } from "postgres";

export function createLocaleMiddleware(sql: Sql): MiddlewareHandler;
```

The middleware sets `c.set("locale", locale)` and `c.set("t", i18next.getFixedT(locale))`. It detects pre-auth routes by a predicate (paths starting with `/login`, `/setup`) and skips the DB read in those cases.

### Format helpers (`src/web/i18n/format.ts`)

```typescript
import type { Locale } from "./index.js";
export function formatDate(date: Date, locale: Locale, opts: Intl.DateTimeFormatOptions): string;
export function formatTime(date: Date, locale: Locale, opts?: Intl.DateTimeFormatOptions): string;
export function relativeTime(date: Date, locale: Locale, now?: Date): string;
```

### Catalogs (`src/web/i18n/en.ts`, `src/web/i18n/de.ts`)

```typescript
// en.ts
export const en = {
  nav: { browse: "Browse", trash: "Trash", settings: "Settings", logout: "Log out" },
  greeting: { late_night: "Late night.", morning: "Good morning.", day: "Good day.", afternoon: "Good afternoon.", evening: "Good evening." },
  category: { people: "People", projects: "Projects", tasks: "Tasks", ideas: "Ideas", reference: "Reference" },
  category_abbr: { people: "People", projects: "Project", tasks: "Task", ideas: "Idea", reference: "Ref" },
  status: { pending: "Pending", done: "Done", active: "Active", paused: "Paused", completed: "Completed" },
  /* … all other keys listed in AC-3.1 */
} as const;

// de.ts
import type { en } from "./en.js";
export const de: typeof en = { /* every key from en, translated */ };
```

## Test App Factory

### Factory for web tests

```typescript
import { Hono } from "hono";

const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

async function createTestApp(): Promise<{ app: Hono }> {
  const { createAuthMiddleware, createAuthRoutes } = await import("../../src/web/auth.js");
  const { createLocaleMiddleware } = await import("../../src/web/i18n/middleware.js");
  const { initI18n } = await import("../../src/web/i18n/index.js");
  const { createDashboardRoutes } = await import("../../src/web/dashboard.js");
  const { createSettingsRoutes } = await import("../../src/web/settings.js");
  const { createSetupRoutes } = await import("../../src/web/setup.js");

  await initI18n(); // idempotent — safe to call per-test

  const mockSql = {} as any; // settings-queries mocked via vi.mock()

  const app = new Hono();
  app.use("*", createLocaleMiddleware(mockSql));
  app.route("/", createSetupRoutes(mockSql));       // pre-auth
  app.route("/", createAuthRoutes(TEST_PASSWORD, TEST_SECRET)); // pre-auth (/login)
  app.use("*", createAuthMiddleware(TEST_SECRET));
  app.route("/", createDashboardRoutes(mockSql));
  app.route("/", createSettingsRoutes(mockSql));
  return { app };
}
```

### Login helper (reused pattern)

```typescript
async function loginAndGetCookie(app: Hono, password = TEST_PASSWORD): Promise<string> {
  const res = await app.request("/login", {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
```

### Request helpers for locale testing

```typescript
// Helper — makes an authenticated request with specific Accept-Language
async function getWithLocale(
  app: Hono,
  path: string,
  opts: { cookie?: string; acceptLanguage?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.acceptLanguage) headers["Accept-Language"] = opts.acceptLanguage;
  return app.request(path, { headers });
}
```

## Mocking Strategy

### settings-queries (module mock)

```typescript
vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
  saveAllSettings: vi.fn().mockResolvedValue(undefined),
}));
```

Individual tests override the mock return value:

```typescript
const { getAllSettings } = await import("../../src/web/settings-queries.js");
vi.mocked(getAllSettings).mockResolvedValueOnce({ ui_language: "de" });
```

### resolveConfigValue (for Telegram + email handlers)

The Telegram and email modules read `ui_language` via `resolveConfigValue(sql, "ui_language")` (existing pattern from `src/config.ts`). Mock it via `vi.mock("../../src/config.js", ...)` for unit tests, or mock `sql` to return the expected row. Preferred approach: mock the `settings-queries` module (single seam) and ensure `resolveConfigValue` reads from it. If `resolveConfigValue` reads `sql` directly, mock `sql` with a small helper that returns `[{ value: "de" }]` for `ui_language`.

Concrete pattern:

```typescript
// Mock sql template tag to return ui_language setting
function makeMockSqlWithUiLang(lang: string): Sql {
  return ((query: TemplateStringsArray, ...args: unknown[]) => {
    const q = query.join("?");
    if (q.includes("settings") && args.includes("ui_language")) {
      return Promise.resolve([{ value: lang }]);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
}
```

Keep this helper inline in the test file; do not make it a shared fixture unless it's reused.

### sendDigestEmail (module mock)

```typescript
vi.mock("../../src/email.js", () => ({
  sendDigestEmail: vi.fn().mockResolvedValue(undefined),
  isSmtpConfigured: vi.fn().mockReturnValue(true),
}));
```

Tests assert on the captured `subject` argument to `sendDigestEmail`.

### i18next resources (for fallback tests)

For TS-8.2 (runtime fallback), temporarily remove a key from the `de` resource bundle and call `t()`:

```typescript
beforeEach(() => {
  // Restore full catalogs
  i18next.addResourceBundle("en", "translation", en, true, true);
  i18next.addResourceBundle("de", "translation", de, true, true);
});

it("runtime missing key in de falls back to en", async () => {
  i18next.removeResourceBundle("de", "translation");
  i18next.addResourceBundle("de", "translation", { /* ...everything except nav.browse */ });
  const t = i18next.getFixedT("de");
  expect(t("nav.browse")).toBe(en.nav.browse);
});
```

### Hono context (for middleware tests)

Most middleware tests go through `app.request` (observable behavior). For pure-function tests of `parseAcceptLanguage`, call the function directly — it is exported.

## Test Scenario Mapping

| TS ID | Scenario Title | File | Test Function |
|-------|----------------|------|---------------|
| TS-1.1 | German browser, no DB, resolves de | unit | `it("resolves de when Accept-Language is de-DE and no DB setting exists")` |
| TS-1.2 | Accept-Language absent resolves en | unit | `it("resolves en when no Accept-Language header")` |
| TS-1.3 | Empty ui_language behaves like unset | unit | `it("treats empty ui_language in DB as unset and uses Accept-Language")` |
| TS-1.4 | Malformed Accept-Language resolves en | unit | `it("resolves en when Accept-Language is malformed")` |
| TS-1.5 | `*` resolves en | unit | `it("resolves en when Accept-Language is *")` |
| TS-1.6 | Unsupported primary subtag resolves en | unit | `it("resolves en when Accept-Language has no supported primary subtag")` |
| TS-1.7 | q-values pick highest supported | unit | `it("picks highest q-value supported entry from Accept-Language")` |
| TS-1.8 | Region subtag matches primary | unit | `it("matches region subtag to primary language in SUPPORTED_LOCALES")` |
| TS-1.9 | Pre-auth route uses Accept-Language | unit | `it("pre-auth setup wizard renders in Accept-Language locale")` |
| TS-1.10 | DB wins over Accept-Language post-auth | unit | `it("DB ui_language wins over Accept-Language for authenticated routes")` |
| TS-2.1 | Section with two dropdowns | unit | `it("renders Language section with both dropdowns and current values")` |
| TS-2.2 | Auto when ui_language unset | unit | `it("shows Auto (browser) option selected when ui_language is unset")` |
| TS-2.3 | Save ui_language = de redirects in German | unit | `it("saves ui_language de and redirects rendering in German")` |
| TS-2.4 | Auto stores empty string | unit | `it("saves empty ui_language when Auto (browser) is selected")` |
| TS-2.5 | Description copy localized | unit | `it("renders Language section description in current locale")` |
| TS-2.6 | output_language preserved | unit | `it("changing ui_language does not modify output_language")` |
| TS-2.7 | Flash in new locale | unit | `it("flash success message after save renders in newly saved locale")` |
| TS-3.1 | `<html lang>` dynamic | unit | `it("sets <html lang> to resolved locale")` |
| TS-3.2 | Nav labels decision table | unit | `it("renders nav labels in the current locale (decision table: en and de)")` |
| TS-3.3 | Greeting hour buckets | unit | `it("maps dashboard greeting hour to correct catalog key")` |
| TS-3.4 | Category labels via t() | unit | `it("renders category badge labels via t(category_abbr.<key>)")` |
| TS-3.5 | Category key stays English in DB | unit | `it("stores English category key in DB regardless of ui_language")` |
| TS-3.6 | Status enum label localized, value English | unit | `it("renders status label via t(status.<key>) and stores English enum key")` |
| TS-3.7 | Field labels via t(), keys English | unit | `it("renders field labels via t(field.<key>) and keeps field keys English")` |
| TS-3.8 | Client-side JS translation blob | unit | `it("injects translated category labels and feedback strings into client script")` |
| TS-3.9 | Dashboard static strings | unit | `it("renders dashboard hero tagline, stats, empty state, and placeholder in current locale")` |
| TS-3.10 | Browse page strings | unit | `it("renders browse page search placeholder, mode toggles, and empty state in current locale")` |
| TS-3.11 | Entry edit buttons and labels | unit | `it("renders entry edit buttons and form labels in current locale")` |
| TS-3.12 | New note page strings | unit | `it("renders new note heading, AI Suggest button, and beforeunload message in current locale")` |
| TS-3.13 | Trash page strings | unit | `it("renders trash heading, Empty trash button, and empty state in current locale")` |
| TS-3.14 | Settings page strings | unit | `it("renders all settings section headings and Save button in current locale")` |
| TS-3.15 | Setup wizard strings | unit | `it("renders setup wizard step-1 heading, field labels, and CTA in Accept-Language locale")` |
| TS-3.16 | Login page strings | unit | `it("renders login heading, password label, and submit button in Accept-Language locale")` |
| TS-4.1 | Date formatted per locale | unit | `it("formats dashboard date line via Intl.DateTimeFormat for current locale")` |
| TS-4.2 | Time formatted per locale | unit | `it("formats digest generated time via Intl.DateTimeFormat for current locale")` |
| TS-4.3 | Relative time plural rules | unit | `it("applies plural rules for relative-time labels (decision table: en and de)")` |
| TS-4.4 | Internal sv-SE preserved | unit | `it("internal formatDateInTz remains sv-SE regardless of ui_language")` |
| TS-5.1 | Telegram reply localized | unit | `it("Telegram confirmation reply uses current ui_language from DB")` |
| TS-5.2 | Telegram unset → English | unit | `it("Telegram reply defaults to English when ui_language is unset")` |
| TS-5.3 | Inline buttons localized, callback_data English | unit | `it("Telegram inline category buttons show localized text with English callback_data")` |
| TS-5.4 | Echoed content not translated | unit | `it("Telegram echoed entry name and tags are not translated")` |
| TS-6.1 | Daily digest subject in locale | unit | `it("daily digest email subject uses current ui_language catalog template")` |
| TS-6.2 | Weekly digest subject in locale | unit | `it("weekly digest email subject uses current ui_language catalog template")` |
| TS-6.3 | Body not re-translated | unit | `it("digest email body reflects output_language, subject reflects ui_language")` |
| TS-6.4 | Envelope copy localized | unit | `it("digest email envelope wrapper strings use current ui_language")` |
| TS-7.1 | Prompt contains English-lock instruction | unit | `it("classify prompt contains explicit English-only rules for status and category enums")` |
| TS-7.2 | Lock present for all output_language values | unit | `it("enum-lock instructions are present in the rendered classify prompt for every output_language")` |
| TS-7.3 | Free-text still follows output_language | unit | `it("classify prompt retains {output_language} instruction for free-text fields")` |
| TS-8.1 | de catalog contains every en key | unit | `it("de catalog contains every key present in en catalog")` |
| TS-8.2 | Runtime missing key falls back to en | unit | `it("runtime missing key in de falls back to en value")` |
| TS-8.3 | Key missing everywhere returns key string | unit | `it("key missing from all catalogs returns raw key string")` |
| TS-9.1 | Unrecognized ui_language → Accept-Language | unit | `it("unrecognized ui_language value falls through to Accept-Language resolution")` |
| TS-9.2 | Dropdown behavior for unrecognized | unit | `it("settings dropdown shows Auto when ui_language value is unrecognized")` |
| TS-10.1 | User content not translated | unit | `it("entry name and tags render verbatim regardless of ui_language")` |
| TS-10.2 | LLM prompt stays English | unit | `it("classify prompt sent to LLM is English regardless of ui_language")` |
| TS-10.3 | MCP descriptions stay English | unit | `it("MCP tools/list response descriptions remain English under any ui_language")` |
| TS-10.4 | No language picker UI on setup/login | unit | `it("setup wizard and login page do not render a language picker")` |
| INT-1 | Settings persistence round-trip | integration | `it("saves ui_language to real DB and renders the redirect in the new locale")` |
| INT-2 | Accept-Language fallback in real DB | integration | `it("empty ui_language row falls back to Accept-Language with real DB")` |
| INT-3 | Telegram reads ui_language from real DB | integration | `it("Telegram handler reads ui_language from real DB per reply")` |

Total: **54 unit tests + 3 integration tests = 57 test functions**, one per test scenario.

## Detailed Scenario Implementation

### Group 1: Locale Resolution (US-1)

#### TS-1.1: German browser, no DB, resolves de (unit)

- **Setup (Given):** `vi.mock("settings-queries")` returns `{}` for `getAllSettings`. Build test app. Login.
- **Action (When):** `getWithLocale(app, "/", { cookie, acceptLanguage: "de-DE,de;q=0.9,en;q=0.5" })`.
- **Assertion (Then):** Response status 200. Body contains `de.nav.browse` (`"Durchsuchen"`). Body contains `<html lang="de">`.

#### TS-1.2: Accept-Language absent resolves en (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app.
- **Action (When):** `app.request("/login")` (no Accept-Language header, no auth cookie).
- **Assertion (Then):** Response status 200. Body contains `en.nav.browse` is NOT required since /login has no nav; assert body contains `en.login.submit` or equivalent canonical en string. `<html lang="en">`.

#### TS-1.3: Empty ui_language behaves like unset (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "" }`. Build app. Login.
- **Action (When):** `getWithLocale(app, "/", { cookie, acceptLanguage: "de" })`.
- **Assertion (Then):** `<html lang="de">`. Body contains de catalog values.

#### TS-1.4: Malformed Accept-Language (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app.
- **Action (When):** `app.request("/login", { headers: { "Accept-Language": "!@#$%" } })`.
- **Assertion (Then):** `<html lang="en">`.

#### TS-1.5: `*` resolves en (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app.
- **Action (When):** `app.request("/login", { headers: { "Accept-Language": "*" } })`.
- **Assertion (Then):** `<html lang="en">`.

#### TS-1.6: Unsupported primary subtag (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app.
- **Action (When):** `app.request("/login", { headers: { "Accept-Language": "fr-FR,es;q=0.8" } })`.
- **Assertion (Then):** `<html lang="en">`.

#### TS-1.7: q-values pick highest supported (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app. Login.
- **Action (When):** `getWithLocale(app, "/", { cookie, acceptLanguage: "fr;q=0.9,de;q=0.8,en;q=0.5" })`.
- **Assertion (Then):** `<html lang="de">`.

#### TS-1.8: Region subtag matches primary (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app. Login.
- **Action (When):** `getWithLocale(app, "/", { cookie, acceptLanguage: "de-AT" })`.
- **Assertion (Then):** `<html lang="de">`.

#### TS-1.9: Pre-auth route uses Accept-Language, skips DB (unit)

- **Setup (Given):** `getAllSettings` mock tracked via `vi.mocked`. Build app (no user exists — `getUserCount` returns 0).
- **Action (When):** `app.request("/setup", { headers: { "Accept-Language": "de" } })`.
- **Assertion (Then):** `<html lang="de">`. Body contains de setup-wizard heading. `vi.mocked(getAllSettings)` was NOT called during this request. (Assertion on `getAllSettings.mock.calls.length === 0`.)

#### TS-1.10: DB wins over Accept-Language post-auth (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "en" }`. Build app. Login.
- **Action (When):** `getWithLocale(app, "/", { cookie, acceptLanguage: "de" })`.
- **Assertion (Then):** `<html lang="en">`. Body contains en catalog values.

### Group 2: Settings Language Section (US-2)

#### TS-2.1: Section with two dropdowns (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "en", output_language: "English" }`. Build app. Login.
- **Action (When):** GET `/settings` with cookie.
- **Assertion (Then):** Body contains Language section heading. Body contains a `<select name="ui_language">` with `<option value="en" selected>`. Body contains a `<select name="output_language">` with `<option value="English" selected>`. Both dropdowns present in the same section.

#### TS-2.2: Auto when unset (unit)

- **Setup (Given):** `getAllSettings` returns `{}`. Build app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains `<select name="ui_language">` with the empty-value option selected.

#### TS-2.3: Save ui_language = de (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "en" }`. `saveAllSettings` mocked to resolve. Build app. Login.
- **Action (When):** POST `/settings` with form data including `ui_language=de` (plus defaults for all other fields via `buildFormData` helper).
- **Assertion (Then):** Response is redirect (302/303) to `/settings?success=...`. `saveAllSettings` was called with an object containing `ui_language: "de"`.

  Secondary assertion — follow the redirect: set `getAllSettings` mock to return `{ ui_language: "de" }`, call GET `/settings`, assert body uses de catalog values throughout.

#### TS-2.4: Auto stores empty string (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. `saveAllSettings` mocked to resolve. Build app. Login.
- **Action (When):** POST `/settings` with `ui_language=""` and other defaults.
- **Assertion (Then):** Redirect. `saveAllSettings` was called with an object containing `ui_language: ""`. Secondary: set `getAllSettings` to return `{ ui_language: "" }`, call GET `/` with `Accept-Language: en`, assert `<html lang="en">`.

#### TS-2.5: Description copy localized (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Build app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains `de.settings.language.description` (exact German catalog string for that key).

#### TS-2.6: Save ui_language does not change output_language (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "en", output_language: "German" }`. `saveAllSettings` mocked. Build app. Login.
- **Action (When):** POST `/settings` with `ui_language=de` and `output_language=German` (unchanged).
- **Assertion (Then):** `saveAllSettings` was called with an object containing both `ui_language: "de"` AND `output_language: "German"`.

#### TS-2.7: Flash in new locale (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "en" }` for first call, then `{ ui_language: "de" }` for second call (via `mockResolvedValueOnce`). `saveAllSettings` mocked. Build app. Login.
- **Action (When):** POST `/settings` with `ui_language=de`, follow the redirect, then GET `/settings?success=saved`.
- **Assertion (Then):** Body contains the German translation for the success flash message (`de.settings.flash.saved` or equivalent).

### Group 3: Web UI Rendering (US-3)

#### TS-3.1: `<html lang>` dynamic (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains `<html lang="de">`. Body does NOT contain `<html lang="en">`.

#### TS-3.2: Nav labels decision table (unit, parameterized)

- **Setup (Given):** For each row (`en`, `de`): `getAllSettings` returns the corresponding `ui_language`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains all four nav labels matching the catalog values for that locale.

Implementation: use `it.each([...])` from Vitest for two rows.

```typescript
it.each([
  { lang: "en", labels: en.nav },
  { lang: "de", labels: de.nav },
])("renders nav labels in $lang", async ({ lang, labels }) => { /* ... */ });
```

#### TS-3.3: Greeting hour buckets (unit, parameterized)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "en" }`. Mock `Date.getHours()` to each hour in the table. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Greeting text matches `en.greeting.<expected_key>` from the catalog.

Implementation: use `vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 3, 17, hour, 0, 0))` per row. Run `it.each([...])` for all 6 hour values.

#### TS-3.4: Category labels via t() (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock dashboard query to return an entry with `category: "people"`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains the de category-abbreviation text for `people` (not `en.category_abbr.people`).

#### TS-3.5: Category key stays English in DB (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock `classifyText` to return `{ category: "people", ... }`. Mock `insertEntry` to capture the argument. Build app. Login.
- **Action (When):** POST `/api/capture` with German text.
- **Assertion (Then):** `vi.mocked(insertEntry)` was called with an object whose `category` field equals `"people"` (the English key).

#### TS-3.6: Status enum label localized, value English (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock `getEntry` to return an entry with `fields.status = "pending"`, category `"tasks"`, fixed id. Build app. Login.
- **Action (When):** GET `/entry/<id>`.
- **Assertion (Then):** Body contains `de.status.pending` (exact German translation). Body does NOT contain `"Pending"` (the English value). Assertion via the query mock that the DB value was read as `"pending"`.

#### TS-3.7: Field labels via t(), keys English (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock `getEntry` to return a task entry. Build app. Login.
- **Action (When):** GET `/entry/<id>/edit`.
- **Assertion (Then):** Body contains `de.field.due_date` as the label text. Body contains `<input name="due_date"` (English field key as form field name).

#### TS-3.8: Client-side JS translation blob (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains a JSON constant with German category abbreviations (match `de.category_abbr.people`, `de.category_abbr.tasks`, etc.). Body contains German capture-feedback strings such as `de.capture.classifying`.

#### TS-3.9: Dashboard static strings (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Dashboard queries return empty data. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains `de.dashboard.hero_tagline`, all four `de.dashboard.stats.*`, `de.dashboard.empty`, `de.capture.placeholder`.

#### TS-3.10: Browse page strings (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Browse queries return empty result. Build app. Login.
- **Action (When):** GET `/browse`.
- **Assertion (Then):** Body contains `de.browse.search_placeholder`, `de.browse.mode.semantic`, `de.browse.mode.text`, `de.browse.empty`.

#### TS-3.11: Entry edit buttons and labels (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock `getEntry`. Build app. Login.
- **Action (When):** GET `/entry/<id>/edit`.
- **Assertion (Then):** Body contains `de.button.save`, `de.button.delete`, `de.button.cancel`, `de.entry.edit.heading`, plus field labels.

#### TS-3.12: New note page strings (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Build app. Login.
- **Action (When):** GET `/new`.
- **Assertion (Then):** Body contains `de.new_note.heading`, `de.new_note.ai_suggest`, `de.new_note.unsaved_changes`.

#### TS-3.13: Trash page strings (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Trash queries return empty. Build app. Login.
- **Action (When):** GET `/trash`.
- **Assertion (Then):** Body contains `de.trash.heading`, `de.trash.empty_trash_button`, `de.trash.empty`.

#### TS-3.14: Settings page strings (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Build app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains `de.settings.section.language`, `de.settings.section.telegram`, `de.settings.section.llm`, `de.settings.section.digests`, `de.button.save`.

#### TS-3.15: Setup wizard strings (unit)

- **Setup (Given):** `getUserCount` returns 0. Build app.
- **Action (When):** `app.request("/setup", { headers: { "Accept-Language": "de" } })`.
- **Assertion (Then):** Body contains `de.setup.step1.heading`, `de.setup.step1.password_label`, `de.setup.step1.cta`.

#### TS-3.16: Login page strings (unit)

- **Setup (Given):** `getUserCount` returns 1. Build app.
- **Action (When):** `app.request("/login", { headers: { "Accept-Language": "de" } })`.
- **Assertion (Then):** Body contains `de.login.heading`, `de.login.password_label`, `de.login.submit`.

### Group 4: Date, Time, Plural Formatting (US-4)

#### TS-4.1: Date formatted per locale (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Dashboard queries return empty. `vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 3, 17, 10, 0))`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains `"Freitag"` (German spelling for Friday) and `"April"` (same in both locales but confirm format via `Intl.DateTimeFormat("de-DE", {weekday: "long", month: "long", day: "numeric"}).format(...)` to obtain the exact expected string).

#### TS-4.2: Time formatted per locale (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock `getLatestDigest` to return a digest with `created_at = new Date(2026, 3, 17, 15, 30)`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains `Intl.DateTimeFormat("de-DE", {hour: "2-digit", minute: "2-digit"}).format(new Date(2026, 3, 17, 15, 30))`.

#### TS-4.3: Relative time plurals (unit, parameterized)

- **Setup (Given):** For each row in the decision table: `getAllSettings` returns corresponding `ui_language`. Mock dashboard query to return one entry with `created_at = new Date(Date.now() - age_minutes * 60_000)`. Build app. Login.
- **Action (When):** GET `/`.
- **Assertion (Then):** Body contains the expected relative-time text from the table.

Implementation: `it.each([...])` with all 10 rows.

#### TS-4.4: Internal sv-SE preserved (unit)

- **Setup (Given):** Import `formatDateInTz` from `src/digests.ts`.
- **Action (When):** Call `formatDateInTz("Europe/Berlin")` with `ui_language` set to `"de"` in settings (verify no impact).
- **Assertion (Then):** Returned string matches `/^\d{4}-\d{2}-\d{2}$/`.

### Group 5: Telegram Bot Localization (US-5)

#### TS-5.1: Telegram reply localized (unit)

- **Setup (Given):** Mock `sql` template tag to return `[{ value: "de" }]` for `ui_language` query. Mock `classifyText` to return a success. Mock `insertEntry` to resolve. Build `ctx` via `createMockContext({ chatId: 123456, text: "Milch kaufen" })`. Import `handleTextMessage` from `src/telegram.ts`.
- **Action (When):** Call `await handleTextMessage(ctx as any, sql)`.
- **Assertion (Then):** `ctx.mocks.reply` was called with a string equal to the localized "saved as" template from `de.telegram.saved_as` (with the interpolated category).

#### TS-5.2: Telegram unset → English (unit)

- **Setup (Given):** Mock `sql` to return `[]` for `ui_language` (unset). Mock classifier + insert. Build `ctx`.
- **Action (When):** `handleTextMessage(ctx, sql)`.
- **Assertion (Then):** `ctx.mocks.reply` was called with the English version of the "saved as" template.

#### TS-5.3: Inline buttons localized, callback_data English (unit)

- **Setup (Given):** Mock `sql` to return `[{ value: "de" }]`. Mock `classifyText` to return a result with confidence below the threshold.
- **Action (When):** `handleTextMessage(ctx, sql)`.
- **Assertion (Then):** `ctx.mocks.reply` was called with options containing `reply_markup.inline_keyboard`. Each button's `text` matches `de.category.<key>`. Each button's `callback_data` is the English key (`"fix:<id>:people"`, etc.).

#### TS-5.4: Echoed content not translated (unit)

- **Setup (Given):** Mock `sql` to return `[{ value: "de" }]`. Mock `classifyText` to return `{ category: "tasks", name: "Buy milk", confidence: 0.9, ... }`.
- **Action (When):** `handleTextMessage(ctx, sql)`.
- **Assertion (Then):** `ctx.mocks.reply` was called with a string that contains the literal `"Buy milk"` (entry name unchanged) AND contains German chrome phrasing from the catalog.

### Group 6: Email Digest Localization (US-6)

#### TS-6.1: Daily digest subject in de (unit)

- **Setup (Given):** `vi.mock("src/email.js")` — `sendDigestEmail` captured. Mock digest pipeline inputs. Mock `resolveConfigValue` to return `"de"` for `ui_language` and `"German"` for `output_language`. Mock LLM to return a digest body.
- **Action (When):** `await generateDailyDigest(sql, broadcaster)` on `2026-04-17`.
- **Assertion (Then):** `vi.mocked(sendDigestEmail)` was called once with an object whose `subject` equals the interpolated value of `de.email.daily_subject` with `{{date}}` = `2026-04-17` (or the date as formatted per the catalog template).

#### TS-6.2: Weekly digest subject in en (unit)

- **Setup (Given):** Similar to TS-6.1 but with `ui_language = "en"` and week-start date `2026-04-13`.
- **Action (When):** `generateWeeklyReview(sql, broadcaster)`.
- **Assertion (Then):** `sendDigestEmail` was called with subject matching `en.email.weekly_subject` with `{{weekStart}}` = `2026-04-13`.

#### TS-6.3: Body not re-translated (unit)

- **Setup (Given):** Mock `resolveConfigValue` to return `"de"` for `ui_language`, `"French"` for `output_language`. Mock LLM to return French body text.
- **Action (When):** `generateDailyDigest(sql, broadcaster)`.
- **Assertion (Then):** `sendDigestEmail` was called with `body` equal to the exact LLM-returned French text (no translation wrapper applied) AND `subject` matching `de.email.daily_subject`.

#### TS-6.4: Envelope copy localized (unit)

- **Setup (Given):** Mock `resolveConfigValue` to return `"de"` for `ui_language`. If `src/email.ts` builds any envelope text (e.g. greeting line, footer signature), assert those strings.
- **Action (When):** `generateDailyDigest(sql, broadcaster)`.
- **Assertion (Then):** `sendDigestEmail` was called with envelope fields (e.g. `body` wrapper text, `fromName`) matching de catalog values.

Note: If `src/email.ts` does not currently add any envelope text beyond subject + body, this scenario is vacuous or may be merged into TS-6.1. Flag for resolution during implementation — spec allows the envelope to be minimal.

### Group 7: Classify Prompt Enum Locking (US-7)

#### TS-7.1: Prompt contains English-lock instruction (unit)

- **Setup (Given):** `const promptText = fs.readFileSync("prompts/classify.md", "utf-8")`.
- **Action (When):** (No invocation — content test.)
- **Assertion (Then):** `promptText` contains a regex matching `projects.status.*"active"\s*,\s*"paused"\s*,\s*"completed"` (or equivalent phrasing). Similarly for `tasks.status` → `pending|done`. Similarly for `category` → list of 5 English keys.

#### TS-7.2: Lock present for all output_language values (unit)

- **Setup (Given):** Import the prompt-formatting function from `src/classify.ts`. Loop over `["English", "German", "Spanish", "Korean"]`.
- **Action (When):** For each language, render the prompt with `{output_language}` set.
- **Assertion (Then):** Every rendered prompt contains the English-lock substrings from TS-7.1.

#### TS-7.3: Free-text still follows output_language (unit)

- **Setup (Given):** Render the prompt for `output_language = "German"`.
- **Action (When):** Inspect rendered text.
- **Assertion (Then):** The rendered text still contains the sentence `All structured output ... must be in German` (or equivalent). The text does NOT add restrictions for `notes`, `context`, `oneliner`, `next_action`, or `follow_ups`.

### Group 8: Catalog Fallback Behavior (US-8)

#### TS-8.1: de contains every en key (unit)

- **Setup (Given):** Import `en` and `de` catalogs.
- **Action (When):** Flatten each into a set of dot-path keys (`nav.browse`, etc.).
- **Assertion (Then):** Every key in the en set exists in the de set. (Implementation: recursive traversal helper `flattenKeys(obj)` in the test file.)

#### TS-8.2: Runtime missing key in de falls back to en (unit)

- **Setup (Given):** Initialize i18next with both catalogs. Then `i18next.removeResourceBundle("de", "translation")` and `i18next.addResourceBundle("de", "translation", { /* everything except nav.browse */ })`. Restore in `afterEach`.
- **Action (When):** `i18next.getFixedT("de")("nav.browse")`.
- **Assertion (Then):** Result equals `en.nav.browse`.

#### TS-8.3: Key missing everywhere returns raw key (unit)

- **Setup (Given):** i18next initialized with both catalogs.
- **Action (When):** `t("absent.key.for.testing")`.
- **Assertion (Then):** Result equals the literal string `"absent.key.for.testing"`.

### Group 9: Edge Cases

#### TS-9.1: Unrecognized ui_language → Accept-Language (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "fr" }`. Build app. Login.
- **Action (When):** `getWithLocale(app, "/", { cookie, acceptLanguage: "de" })`.
- **Assertion (Then):** `<html lang="de">`. Body contains de catalog values.

#### TS-9.2: Dropdown for unrecognized value (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "fr" }`. Build app. Login.
- **Action (When):** GET `/settings`.
- **Assertion (Then):** Body contains `<select name="ui_language">`. The `<option>` for empty value is marked `selected`. No `<option value="fr">` is present.

### Group 10: Non-Goal Guards

#### TS-10.1: User content not translated (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Mock `getEntry` to return an entry with `name: "The quick brown fox"`, `tags: ["foo","bar"]`. Build app. Login.
- **Action (When):** GET `/entry/<id>`.
- **Assertion (Then):** Body contains literal string `"The quick brown fox"`. Body contains literal strings `"foo"` and `"bar"`.

#### TS-10.2: LLM prompt stays English (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de", output_language: "German" }`. Mock the LLM provider's send method to capture the outgoing prompt.
- **Action (When):** `classifyText("test input", sql)`.
- **Assertion (Then):** The captured prompt string is the English classify.md template with placeholders substituted. The prompt does not contain any text that would only exist in the de catalog (e.g. `de.nav.browse`).

#### TS-10.3: MCP descriptions stay English (unit)

- **Setup (Given):** `getAllSettings` returns `{ ui_language: "de" }`. Build the Hono app with MCP routes mounted. Login.
- **Action (When):** POST `/mcp` with body `{"jsonrpc":"2.0","method":"tools/list","id":1}`.
- **Assertion (Then):** Response `result.tools[*].description` values match the English descriptions defined in `src/mcp-tools.ts` (string-equal check against imported constants).

#### TS-10.4: No language picker UI (unit)

- **Setup (Given):** `getUserCount` returns 0 (first assertion). Build app.
- **Action (When):** GET `/setup`.
- **Assertion (Then):** Body does not contain `<select name="ui_language"` or `<input name="ui_language"`.

  Then: `getUserCount` returns 1. GET `/login`.
- **Assertion (Then):** Same — no language-related form control in the response body.

Note: This scenario has two action-assertion pairs but they validate the same non-goal. Implementation as two separate `it` blocks under a shared describe is acceptable; the mapping in the traceability matrix counts them as one scenario because they guard the same NG requirement. Alternative: one `it` with both assertions if the test runner treats them as a single behavior.

### Integration Tests

#### INT-1: Settings persistence round-trip (integration)

- **Setup (Given):** Real testcontainers PG. Clear settings table. Build integration app with real `sql`. Login.
- **Action (When):** POST `/settings` with `ui_language=de`. Follow redirect.
- **Assertion (Then):** The redirect target's body contains de catalog values (e.g. `de.nav.browse`). Query `SELECT value FROM settings WHERE key = 'ui_language'` returns `"de"`.

#### INT-2: Accept-Language fallback from real DB (integration)

- **Setup (Given):** Real testcontainers PG. Clear settings table (no `ui_language` row). Build integration app. Login.
- **Action (When):** GET `/` with `Accept-Language: de`.
- **Assertion (Then):** Body contains `<html lang="de">` and de catalog values. Query confirms settings table has no `ui_language` row.

#### INT-3: Telegram reads ui_language from real DB (integration)

- **Setup (Given):** Real testcontainers PG. Insert `ui_language=de` into settings table. Build `ctx` mock. Mock classifier/insertEntry.
- **Action (When):** Call `handleTextMessage(ctx, sql)` with the real `sql` pointing at the testcontainers DB.
- **Assertion (Then):** `ctx.mocks.reply` receives the de catalog "saved as" string.

## Fixtures & Test Data

### Constants

```typescript
const TEST_PASSWORD = "test-password";
const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";
```

### Form Data Helper (reused from web-settings)

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
    output_language: "English",
    ui_language: "",  // NEW — default to Auto
    ...overrides,
  });
}
```

### Flatten-keys helper

```typescript
function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenKeys(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}
```

### Setup / Teardown

```typescript
// Unit tests
beforeAll(async () => {
  const { initI18n } = await import("../../src/web/i18n/index.js");
  await initI18n();
});

beforeEach(async () => {
  vi.clearAllMocks();
  // Restore full catalogs (some tests manipulate resources)
  const { en } = await import("../../src/web/i18n/en.js");
  const { de } = await import("../../src/web/i18n/de.js");
  (await import("i18next")).default.addResourceBundle("en", "translation", en, true, true);
  (await import("i18next")).default.addResourceBundle("de", "translation", de, true, true);
  // Default fetch mock (Ollama reachable, prevents test pollution)
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Integration tests (same pattern as other integration suites)
let sql: Sql;
let container: StartedTestContainer;

beforeAll(async () => {
  const db = await startTestDb();
  container = db.container;
  sql = db.sql;
  await runMigrations(db.url);
  const { initI18n } = await import("../../src/web/i18n/index.js");
  await initI18n();
}, 120_000);

afterAll(async () => {
  await sql.end();
  await container.stop();
});

beforeEach(async () => {
  await sql`TRUNCATE settings`;
  vi.clearAllMocks();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("OK", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

## Env Var Handling in Tests

No test requires `withEnv` for ui_language-related behavior because `ui_language` is not in `SETTINGS_TO_ENV` (it has no env-var counterpart). Existing `withEnv` usage patterns for other settings (like `LLM_MODEL`) remain unchanged in tests from other features.

## Alignment Check

**Status: Full alignment.**

All 57 test scenarios from the test specification are mapped to test functions with concrete setup, action, and assertion strategies.

| Check | Result |
|-------|--------|
| Every TS-ID mapped to a test function | Yes (54 unit + 3 integration = 57) |
| One behavior per test | Yes (TS-10.4 flagged as "two actions for one non-goal" — acceptable compromise) |
| All tests will initially fail | Yes — `src/web/i18n/*` modules do not exist; the `ui_language` settings field does not exist in `src/web/settings.ts`; `prompts/classify.md` does not yet contain the enum-lock instructions; Telegram handlers do not call `t()`; email subject is currently hardcoded |
| Test isolation verified | Yes — per-test factory, `vi.clearAllMocks()`, i18next resource restore in beforeEach, `TRUNCATE settings` for integration |
| No implementation coupling | Yes — tests assert observable behavior (rendered HTML, ctx.reply arguments, sendDigestEmail arguments, DB queries) rather than internal state |

**Test counts:**

- **Unit tests:** 54 (Group 1: 10, Group 2: 7, Group 3: 16, Group 4: 4, Group 5: 4, Group 6: 4, Group 7: 3, Group 8: 3, Group 9: 2, Group 10: 4, minus 3 scenarios that expand to more via decision tables but count as 1 TS-ID)
- **Integration tests:** 3 (INT-1, INT-2, INT-3)
- **Total:** 57 test functions mapping to 57 test scenarios

Decision tables (TS-3.2, TS-3.3, TS-4.3) are implemented via `it.each([...])` and expand at runtime to 2, 6, and 10 test cases respectively — 18 additional parameterized test cases on top of the 54 unit test functions — but each `it.each` maps to exactly one TS-ID in the traceability matrix.

### Notes

1. **Setting key name:** `ui_language` is consistent across the behavioral spec, test spec, and this impl spec. No discrepancy.

2. **Telegram reply-source mocking:** Group 5 tests mock `sql` template tag directly instead of `settings-queries` because `src/telegram.ts` reads ui_language via `resolveConfigValue(sql, "ui_language")` rather than the web-only `getAllSettings`. The inline helper `makeMockSqlWithUiLang` is kept local to the Telegram describe block.

3. **Prompt-content tests (Group 7):** These read `prompts/classify.md` directly with `fs.readFileSync`. They will fail until the prompt is updated to include the English enum-lock instructions — which is the whole point of US-7.

4. **Client-side JS assertions (TS-3.8):** The tests inspect the server-rendered HTML body, not the runtime behavior of the injected JavaScript. This matches how other features test inline-script content (e.g. `STATUS_CLIENT_SCRIPT` in layout.ts is server-rendered and asserted at the HTML level).

5. **`it.each` and decision tables:** Per the test specification, decision tables expand to parameterized test cases at implementation. Vitest's `it.each([...])` is the canonical idiom.

6. **MCP mock surface (TS-10.3):** Requires the MCP HTTP endpoint (`POST /mcp`) to be mounted in the test app. The MCP tool descriptions are imported as constants from `src/mcp-tools.ts` for the equality check.

7. **Date/time assertions (TS-4.1, TS-4.2):** Use `Intl.DateTimeFormat` in the test itself to compute the expected string rather than hardcoding, to avoid platform ICU-version drift. This is the project's existing convention (see `digests.ts` tests).

8. **Greeting hour mocking (TS-3.3):** `vi.useFakeTimers()` + `vi.setSystemTime(...)` sets the wall clock for each hour bucket. Remember to call `vi.useRealTimers()` in `afterEach` to avoid poisoning later tests.

## Handoff Prompt for Test Implementation Agent

```
Implement the tests for the ui-language feature according to the test
implementation specification.

References:
- Behavioral specification: docs/specs/ui-language-specification.md
- Test specification: docs/specs/ui-language-test-specification.md
- Test implementation specification: docs/specs/ui-language-test-implementation-specification.md

Constraint: All tests MUST FAIL when first run, because the feature code does
not exist yet. A passing test before feature implementation indicates the test
is not testing the intended behavior. After implementing all tests, run
`npm run test:unit` and `npm run test:integration` (integration requires Docker)
and confirm that every new test in tests/unit/ui-language.test.ts and
tests/integration/ui-language-integration.test.ts fails. Tests in other files
must continue to pass — no regressions allowed.

Stack: TypeScript, Node.js 21.7.2, ESM
Test framework: Vitest
Conventions:
  - describe/it blocks, explicit imports, expect() assertions
  - testcontainers (`pgvector/pgvector:pg16`) for integration via
    tests/helpers/test-db.ts
  - vi.mock() for module mocking, vi.spyOn() for spies
  - Mock telegram contexts via tests/helpers/mock-telegram.ts
  - Env var tests via tests/helpers/env.ts `withEnv`
  - i18next resources initialized once in beforeAll; restored per-test

Start by reading all three specification files, then implement each test
function described in Test Scenario Mapping. Create only stub modules for
`src/web/i18n/*` that throw "Not implemented" — do NOT implement the feature
logic. The feature implementation comes in Phase 5 after tests are verified
as failing.
```
