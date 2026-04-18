# UI Language - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | UI Language |
| Phase | 1 |
| Date | 2026-04-17 |
| Status | Draft |

## Objective

Make the Cortex interface — web UI, Telegram bot replies, and email digest subject line — render in a user-selectable language, independent of the existing LLM output language. A user whose browser sends `Accept-Language: de` sees the web UI in German on first visit without any configuration; they can override via a new setting in `/settings`. The LLM's output language (used for classification output, digest prose, Telegram content responses) remains a separate, preexisting setting, so a user can have an English interface while digests are generated in Korean — or vice versa.

For v1, two interface locales are supported: `en` and `de`. Additional locales are added by contributing new catalog files; no code changes are required.

## User Stories & Acceptance Criteria

### US-1: As a user, I want the web UI to render in my preferred language on first visit, so that I do not have to hunt for a language setting before I can read anything.

**AC-1.1:** When no `ui_language` value is present in the `settings` table (row absent or empty string), the server resolves the request locale from the HTTP `Accept-Language` header. The header is parsed per RFC 9110 §12.5.4 quality-value ordering; the first entry whose primary language subtag (portion before the first hyphen, lowercased) appears in `SUPPORTED_LOCALES` is selected.

**AC-1.2:** If `Accept-Language` is missing, malformed, or contains no entry whose primary subtag matches `SUPPORTED_LOCALES`, the fallback locale is `en`.

**AC-1.3:** Locale resolution runs on every request, including pre-authentication routes (`/login`, `/setup`, `/setup/*`). Pre-authentication pages render in the resolved locale.

**AC-1.4:** The set `SUPPORTED_LOCALES` for v1 is exactly `["en", "de"]`.

### US-2: As a user, I want to change the interface language from `/settings`, so that I can override the browser default.

**AC-2.1:** The `/settings` page contains a "Language" section with two dropdowns:
  - **Interface Language** — options: `Auto (browser)`, `English`, `Deutsch`. The `Auto (browser)` option corresponds to an empty `ui_language` value and is selected when the setting is unset.
  - **LLM Output Language** — the existing 12-option dropdown, unchanged in behavior, backed by the existing `output_language` setting.

**AC-2.2:** A one-line description is shown under the section header: "Interface language controls the web UI, Telegram bot replies, and email subject line. LLM output language controls how digests, classifications, and Telegram content responses are written. They can differ." This copy is itself localized via `t("settings.language.description")`.

**AC-2.3:** Selecting `Auto (browser)` sets `ui_language` to an empty string in the `settings` table. On subsequent requests, empty `ui_language` falls through to the `Accept-Language` resolution path per AC-1.1.

**AC-2.4:** After POST `/settings` succeeds, the browser is redirected to `/settings`. The subsequent GET renders every user-facing string — including the flash success message and the page chrome — in the newly saved locale.

**AC-2.5:** The existing `output_language` setting retains its current behavior: free-form string selected from a dropdown of 12 options, stored as-is in the `settings` table, passed as `{output_language}` template variable to LLM prompts. Its dropdown options and label are localized to the current UI locale; its values remain the English language names the LLM expects.

### US-3: As a user, I want every user-facing string on the web UI to render in my selected interface locale.

**AC-3.1:** The following surfaces render every user-facing string via `t(key)`:
  - **Page layout (`layout.ts`):** page title, nav links (Browse, Trash, Settings, Log out), footer service-status labels ("SSE connected"), "warming up" banner heading and its service-not-ready phrasing.
  - **Dashboard:** the five time-of-day greetings (late night / morning / day / afternoon / evening), the hero tagline ("Here is what needs your attention."), relative-time labels (just now, N minutes ago, N hours ago, N days ago), the date line, the four stat labels (entries this week, total entries, open tasks, stalled projects), the entries empty state, the capture input placeholder, and every capture-feedback message (classifying, captured as …, saved but classification failed, capture failed — try again, task-completion confirmation).
  - **Browse:** search input placeholder, mode toggle labels (semantic / text), filter tag section label, empty states (no matches, text-fallback notice), result-count label.
  - **Entry view / edit:** every form field label for keys in `CATEGORY_FIELDS`, all buttons (Save, Delete, Restore, Cancel), confirmation dialog copy.
  - **New Note:** heading, form labels, the "AI Suggest" button, the unsaved-changes `beforeunload` confirmation message.
  - **Trash:** heading, "Empty trash" button, per-row "Restore" button, empty state.
  - **Settings:** every section heading, field label, help text, and flash message — including the new Language section itself.
  - **Setup wizard (`setup.ts`):** every step heading, field label, help text, call-to-action button, and the final completion screen copy.
  - **Login page:** heading, field labels, submit button, error messages.

**AC-3.2:** Category labels and category abbreviations are rendered via `t("category.<key>")` and `t("category_abbr.<key>")`. The underlying category keys (`people`, `projects`, `tasks`, `ideas`, `reference`) remain English identifiers in the database and are never translated.

**AC-3.3:** Category field labels are rendered via `t("field.<key>")` for every key in `CATEGORY_FIELDS`. Field keys (`due_date`, `status`, `next_action`, `follow_ups`, etc.) remain English identifiers in the database and in the JSONB column.

**AC-3.4:** Status enum values (`pending`, `done`, `active`, `paused`, `completed`) render their displayed label via `t("status.<key>")`. The underlying value stored in the JSONB `fields.status` column is always the English enum key.

**AC-3.5:** The HTML document root uses `<html lang="{locale}">` matching the resolved locale (e.g. `<html lang="de">` when the locale is `de`).

**AC-3.6:** Client-side JavaScript that renders dynamic content (the SSE `entry:created` / `entry:updated` handlers in `dashboard.ts`, the capture feedback text, any rich error messages) uses translated strings injected by the server into the rendered script as a JSON constant. The client does not import or call `i18next` directly, and the served bytes contain only the strings needed for that page's locale.

### US-4: As a user, I want dates, times, and pluralized labels to follow my locale's conventions.

**AC-4.1:** Every call to `Date.toLocaleDateString(...)` and `Date.toLocaleTimeString(...)` in the web surface uses a helper `formatDate(date, locale, opts)` / `formatTime(date, locale)` defined in `src/web/i18n/format.ts`. The helper maps the two-letter locale to a full BCP-47 tag (`en` → `en-US`, `de` → `de-DE`) and calls `Intl.DateTimeFormat(tag, opts).format(date)`.

**AC-4.2:** Pluralized strings (e.g. "N minute(s) ago", "N entry/entries") use the i18next `_one` / `_other` suffix convention driven by `Intl.PluralRules` for the resolved locale. Templates call `t("relative.minutes_ago", { count })` and i18next selects the suffix.

**AC-4.3:** Date formatting for internal non-user-facing purposes (for example `sv-SE` date formatting in `digests.ts:95` used for SQL filtering) remains unchanged and is unaffected by locale.

### US-5: As a user, I want Telegram bot replies to match my interface language.

**AC-5.1:** Every user-facing `ctx.reply(...)` call in `src/telegram.ts` — confirmations, error messages, inline-button labels, low-confidence category-correction prompts — renders its text via `t(key)` with the current value of `ui_language` resolved from the `settings` table at send time. `Accept-Language` does not apply to Telegram.

**AC-5.2:** If `ui_language` is unset or empty in the database, Telegram bot replies render in English.

**AC-5.3:** Entry content echoed back by the bot (the entry's `name`, tags, category field values written by the LLM) is not translated — it is shown exactly as the LLM produced it, which is governed by `output_language`.

**AC-5.4:** Inline category-correction buttons use `t("category.<key>")` for the button text; the callback data still carries the English category key.

### US-6: As a user, I want the email digest subject line to match my interface language.

**AC-6.1:** The email subject line passed to `sendDigestEmail(...)` is localized via `t("email.daily_subject", { date })` and `t("email.weekly_subject", { weekStart })` with the resolved UI locale (read from `ui_language`; `Accept-Language` does not apply to emails).

**AC-6.2:** The email body, which is generated by the LLM from the digest prompt, remains governed by `output_language`. Email body content is not re-translated.

**AC-6.3:** The "From" display name and any plain-text body wrapper added by `src/email.ts` (if present) are localized via `t(...)`.

### US-7: As a developer, I want the LLM to reliably emit English enum values for structured fields regardless of `output_language`, so that the UI can translate them cleanly for display.

**AC-7.1:** The classification prompt `prompts/classify.md` is updated so that enum-valued fields are explicitly locked to English keys, overriding the general "structured output in {output_language}" instruction for these specific fields:
  - `projects.status` must be emitted as exactly one of `active`, `paused`, `completed`, or `null`.
  - `tasks.status` must be emitted as exactly one of `pending`, `done`, or `null`.
  - The top-level `category` value must be emitted as exactly one of `people`, `projects`, `tasks`, `ideas`, or `reference`.

**AC-7.2:** Free-text field values (`notes`, `context`, `oneliner`, `next_action`, `follow_ups`) continue to be emitted in `{output_language}` and are stored and displayed as-is without translation.

**AC-7.3:** Field *keys* (`due_date`, `status`, `notes`, etc.) are never translated — they are JSONB object keys and remain English in the DB, in MCP responses, and on the wire.

### US-8: As a developer, I want missing translations in a supported locale to be a compile-time error, so that catalogs cannot drift silently.

**AC-8.1:** The canonical catalog `src/web/i18n/en.ts` is exported `as const`, giving every key a precise string-literal type.

**AC-8.2:** Each other locale's catalog file (for v1, `src/web/i18n/de.ts`) is declared with the type `typeof en`. Omitting any key produces a TypeScript compile error during `npm run build`.

**AC-8.3:** At runtime, if a key is unexpectedly missing from the resolved locale's catalog (e.g. hand-edit, hot-reload during dev), i18next falls back to the `en` catalog. If the key is missing there too, i18next returns the raw key string (making the miss visible in the rendered page).

## Constraints

- **Runtime library:** `i18next`, loaded once at server bootstrap. No client-side i18n bundle. No additional `i18next-http-middleware` or `i18next-fs-backend` packages — the catalogs are imported as TypeScript modules.
- **Request plumbing:** A single Hono middleware mounted at `app.use("*", localeMiddleware)` before auth. It resolves the locale (DB `ui_language` → `Accept-Language` → `"en"`), calls `i18next.getFixedT(locale)`, and sets `c.set("locale", locale)` and `c.set("t", t)`.
- **Pre-auth routes:** For `/login`, `/setup`, and `/setup/*`, the middleware skips the DB lookup and uses `Accept-Language` directly (no session yet). A helper `resolveLocale(c, sql)` encapsulates this branching.
- **Authentication and CSRF posture:** The new Language section in `/settings` follows the same posture as the rest of `/settings` — session cookie required; submitted via the existing Save All form POST; no new CSRF mechanics.
- **No schema change:** `ui_language` is a new row in the existing `settings` table. Key: `ui_language`. Value: `"en"` / `"de"` / `""`.
- **File layout:** `src/web/i18n/` contains `index.ts` (init + i18next instance export), `middleware.ts` (Hono middleware), `resolve.ts` (pure locale-resolution function), `format.ts` (date/time/number helpers), `en.ts` (canonical catalog), `de.ts` (German catalog, typed `typeof en`).
- **Key format:** Nested TypeScript objects in the catalog (`{ nav: { browse: "Browse" } }`), not dot-separated strings. Access path `"nav.browse"` at the call site is i18next-native.
- **Interpolation syntax:** i18next native `{{named}}` placeholders. `escapeValue: false` in the i18next config because the template render layer already calls `escapeHtml()` on untrusted values.
- **Supported locales declaration:** A single const `SUPPORTED_LOCALES = ["en", "de"] as const` and a derived `type Locale = (typeof SUPPORTED_LOCALES)[number]` are the single source of truth for which locales the resolver accepts and which options the settings dropdown shows.
- **No new runtime dependency besides `i18next`.** Everything else uses native `Intl.*` APIs and the existing stack.

## Edge Cases

- **`Accept-Language` absent or empty:** Resolved locale is `en`.
- **`Accept-Language` with quality factors** (e.g. `de-DE,fr;q=0.5,en;q=0.3`): The header is parsed highest-quality-first; the first entry whose primary subtag is in `SUPPORTED_LOCALES` wins. In this example, `de`.
- **`Accept-Language: *`:** No supported-match found; falls back to `en`.
- **`Accept-Language` with a region subtag** (e.g. `de-AT`): The primary subtag (`de`) is matched against `SUPPORTED_LOCALES`; the region is ignored.
- **`ui_language` in DB holds an unrecognized value** (for example `"fr"` from a hand-edit when no French catalog exists): Treated as unset for resolution purposes; the resolver falls through to `Accept-Language`. The settings dropdown renders the `Auto (browser)` option as the currently-effective fallback but does not show the unknown value as a selectable option.
- **Missing translation key in the selected locale at runtime** (e.g. dev hot-reload, manual edit): i18next falls back to the `en` catalog. If the key is missing there too, the raw key string is returned — visible as `"nav.browse"` in the rendered page, making the miss obvious in dev.
- **User switches `ui_language` from `en` to `de` while existing entries already exist:** Existing entry content (names, tags, free-text field values written in the prior `output_language`) is not retranslated. Only UI chrome (labels, buttons, category names, status enum values) renders in the new language.
- **First-run / setup wizard before any user exists:** No `ui_language` setting exists yet; the wizard renders in the `Accept-Language` locale. The wizard does not expose a language picker — users can change it in Settings after first login.
- **Telegram bot reply when `ui_language` is unset or empty in the settings table:** Bot replies render in English per AC-5.2.
- **Template passes `undefined` to a key that expects an interpolation parameter:** i18next renders the placeholder literally (e.g. `"{{count}}"`). Callers must always supply declared parameters; this is enforced by code review and integration tests, not by the type system for v1.
- **Two browser tabs open, user changes language in tab A, tab B reloads:** Tab B reflects the new language on its next request, because every request re-resolves the locale.
- **Sharing a URL that includes a flash-message query param across locales:** Flash messages are internationalized by looking up the query-param value as a `t()` key (not by interpolating the raw query-param text); a URL crafted in one locale renders the flash text in the viewer's locale.

## Non-Goals

- **Localizing LLM prompt bodies** (`prompts/classify.md`, `prompts/daily-digest.md`, `prompts/weekly-review.md`). They remain in English and use `{output_language}` templating internally to direct the LLM.
- **Localizing MCP tool descriptions or MCP tool responses.** MCP is consumed by AI clients and its interface stays English for interoperability.
- **Localizing server log messages, exception messages, or database-migration error output.** These are operator-facing, not user-facing.
- **Translating user-generated content** (entry names, tags, notes, category field free-text values). These are stored as written and displayed as-is.
- **Retroactively re-classifying or re-writing existing entries** when `ui_language` or `output_language` changes. Old entries keep their previous field contents.
- **Localizing the kitchen display (TRMNL) surface.** It targets a dedicated hardware screen with its own rendering path and is out of scope for v1.
- **A pre-auth language switcher UI element** on the login page. `Accept-Language` covers the pre-auth case; no dropdown is added to the login or setup screens.
- **A language picker in the first-run setup wizard.** `Accept-Language` + `/settings` cover the need.
- **Per-Telegram-chat-id language preferences.** The `ui_language` setting is global.
- **Per-user locale preferences** beyond the single `ui_language`. The system remains single-user in its locale model.
- **Locale-aware number formatting beyond what `Intl.NumberFormat` provides out of the box.** Currency, unit formatting, and right-to-left (RTL) layout are not in scope for v1.
- **Client-side i18n for interactivity** beyond what the server injects at render time. No client-side `i18next` bundle is shipped.
- **Dynamic catalog loading / lazy locale downloads.** Catalogs are statically imported at startup.
- **Automatic translation of new locale catalogs via LLM.** Adding a locale is a manual contribution of a new catalog file; there is no runtime translation path.

## Open Questions

_None at this time — all decisions resolved during design discussion on 2026-04-17._
