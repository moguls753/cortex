# UI Language - Test Specification

| Field | Value |
|-------|-------|
| Feature | UI Language |
| Phase | 2 |
| Date | 2026-04-17 |
| Status | Draft |
| Derived From | `ui-language-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: DB → Accept-Language → en precedence | TS-1.1, TS-1.7, TS-1.8 |
| AC-1.2: Missing/malformed/unmatched Accept-Language → en | TS-1.2, TS-1.4, TS-1.5, TS-1.6 |
| AC-1.3: Pre-auth routes render in resolved locale | TS-1.9 |
| AC-1.4: SUPPORTED_LOCALES = ["en", "de"] | TS-1.6 (French rejected) |
| AC-2.1: Language section with two dropdowns | TS-2.1, TS-2.2 |
| AC-2.2: Description copy is itself localized | TS-2.5 |
| AC-2.3: Auto (browser) sets empty string | TS-2.4 |
| AC-2.4: Redirect-GET renders in new locale | TS-2.3, TS-2.7 |
| AC-2.5: output_language retains existing behavior | TS-2.6 |
| AC-3.1: Every listed web surface uses t() | TS-3.9 (dashboard), TS-3.10 (browse), TS-3.11 (entry), TS-3.12 (new note), TS-3.13 (trash), TS-3.14 (settings), TS-3.15 (setup), TS-3.16 (login) |
| AC-3.2: Category labels via t() | TS-3.4 |
| AC-3.3: Field labels via t(), keys remain English | TS-3.7 |
| AC-3.4: Status enum labels via t(), DB value English | TS-3.6 |
| AC-3.5: `<html lang>` dynamic | TS-3.1 |
| AC-3.6: Client-side JS gets injected translation blob | TS-3.8 |
| AC-4.1: Date formatting via Intl per locale | TS-4.1 |
| AC-4.2: Plurals via i18next `_one`/`_other` | TS-4.3 |
| AC-4.3: Internal sv-SE formatting preserved | TS-4.4 |
| AC-5.1: Telegram uses t() with ui_language from DB | TS-5.1 |
| AC-5.2: Telegram unset → English | TS-5.2 |
| AC-5.3: Entry content echoed by bot not translated | TS-5.4 |
| AC-5.4: Inline buttons localized, callback_data English | TS-5.3 |
| AC-6.1: Daily/weekly subject lines localized | TS-6.1, TS-6.2 |
| AC-6.2: Email body not re-translated | TS-6.3 |
| AC-6.3: Envelope copy localized | TS-6.4 |
| AC-7.1: Classify prompt locks enum values to English | TS-7.1, TS-7.2 |
| AC-7.2: Free-text fields follow output_language | TS-7.3 |
| AC-7.3: Field keys remain English in JSONB | TS-3.7 (shared) |
| AC-8.1: en catalog exported `as const` | TS-8.1 (key parity implies typing) |
| AC-8.2: de catalog typed `typeof en` | TS-8.1 |
| AC-8.3: Runtime fallback chain de → en → key | TS-8.2, TS-8.3 |
| EC-1: Unrecognized ui_language treated as unset | TS-9.1 |
| EC-2: Settings dropdown for unrecognized value | TS-9.2 |
| EC-3: User changes language, existing entries not retranslated | TS-10.1 |
| NG-1: LLM prompt bodies not translated | TS-10.2 |
| NG-2: MCP descriptions stay English | TS-10.3 |
| NG-3: No setup-wizard picker | TS-10.4 |
| NG-4: No login-page picker | TS-10.4 |
| NG-5: Entry content never translated | TS-10.1 |

All acceptance criteria and enumerated edge cases have at least one covering scenario. No orphan scenarios.

## Test Scenarios

### Group 1: Locale Resolution (US-1)

**TS-1.1: German browser, no DB setting, resolves to de**

```
Given the settings table contains no ui_language row
And the request Accept-Language header is "de-DE,de;q=0.9,en;q=0.5"
When an authenticated user requests GET /
Then the resolved locale is "de"
And the response body contains German nav labels
And the response body contains <html lang="de">
```

**TS-1.2: Accept-Language absent resolves to en**

```
Given the settings table contains no ui_language row
And the request has no Accept-Language header
When an unauthenticated user requests GET /login
Then the resolved locale is "en"
And the response body contains English labels
```

**TS-1.3: Empty ui_language in DB behaves like unset**

```
Given the settings table contains ui_language ""
And the request Accept-Language header is "de"
When an authenticated user requests GET /
Then the resolved locale is "de"
```

**TS-1.4: Malformed Accept-Language resolves to en**

```
Given the settings table contains no ui_language row
And the request Accept-Language header is "!@#$% not a header"
When an unauthenticated user requests GET /login
Then the resolved locale is "en"
```

**TS-1.5: Accept-Language "*" resolves to en**

```
Given the settings table contains no ui_language row
And the request Accept-Language header is "*"
When an unauthenticated user requests GET /login
Then the resolved locale is "en"
```

**TS-1.6: Accept-Language with no supported primary subtag resolves to en**

```
Given the settings table contains no ui_language row
And the request Accept-Language header is "fr-FR,es;q=0.8"
When an unauthenticated user requests GET /login
Then the resolved locale is "en"
```

**TS-1.7: Accept-Language with quality factors picks highest-priority supported**

```
Given the settings table contains no ui_language row
And the request Accept-Language header is "fr;q=0.9,de;q=0.8,en;q=0.5"
When an authenticated user requests GET /
Then the resolved locale is "de"
```

**TS-1.8: Accept-Language with region subtag matches primary**

```
Given the settings table contains no ui_language row
And the request Accept-Language header is "de-AT"
When an authenticated user requests GET /
Then the resolved locale is "de"
```

**TS-1.9: Pre-auth route renders in Accept-Language locale**

```
Given no user exists in the database
And the request Accept-Language header is "de"
When an unauthenticated user requests GET /setup
Then the setup wizard page renders in German
And no settings-table lookup occurred for ui_language during the request
```

**TS-1.10: DB ui_language wins over Accept-Language for post-auth routes**

```
Given the settings table contains ui_language "en"
And the request Accept-Language header is "de"
When an authenticated user requests GET /
Then the resolved locale is "en"
And the response body contains English labels
```

### Group 2: Settings Language Section (US-2)

**TS-2.1: Language section displays two dropdowns**

```
Given the settings table contains ui_language "en" and output_language "English"
When an authenticated user requests GET /settings
Then the page contains a "Language" section heading
And the section contains a dropdown labelled Interface Language with selected option "English"
And the section contains a dropdown labelled LLM Output Language with selected option "English"
And the description text under the section is visible
```

**TS-2.2: Interface Language shows Auto when ui_language is unset**

```
Given the settings table contains no ui_language row
When an authenticated user requests GET /settings
Then the Interface Language dropdown has the "Auto (browser)" option selected
```

**TS-2.3: Save ui_language = "de" persists and redirects rendered in German**

```
Given the settings table contains ui_language "en"
When an authenticated user submits POST /settings with ui_language "de" and other settings unchanged
Then the settings table contains ui_language "de"
And the response is a redirect to /settings
And the redirect target's GET response renders nav labels in German
```

**TS-2.4: Selecting Auto (browser) stores empty string**

```
Given the settings table contains ui_language "de"
When an authenticated user submits POST /settings with ui_language "" and other settings unchanged
Then the settings table contains ui_language ""
And a subsequent request with Accept-Language "en" resolves locale to "en"
```

**TS-2.5: Description copy is localized**

```
Given the settings table contains ui_language "de"
When an authenticated user requests GET /settings
Then the Language-section description text is the German catalog value for settings.language.description
```

**TS-2.6: Changing ui_language does not change output_language**

```
Given the settings table contains ui_language "en" and output_language "German"
When an authenticated user submits POST /settings with ui_language "de" and output_language unchanged
Then the settings table contains ui_language "de"
And the settings table contains output_language "German"
```

**TS-2.7: Flash success message renders in newly saved locale**

```
Given the settings table contains ui_language "en"
When an authenticated user submits POST /settings with ui_language "de"
Then the redirect target's GET response contains the German flash success message
And the message is not in English
```

### Group 3: Web UI Rendering (US-3)

**TS-3.1: `<html lang>` reflects resolved locale**

```
Given the settings table contains ui_language "de"
When an authenticated user requests GET /
Then the response body contains <html lang="de">
```

**TS-3.2: Layout nav labels use current locale — decision table**

```
Given ui_language is set as per the table below
When an authenticated user requests GET /
Then the nav links render the labels from the corresponding row
```

| ui_language | Browse         | Trash     | Settings       | Log out   |
|-------------|----------------|-----------|----------------|-----------|
| en          | Browse         | Trash     | Settings       | Log out   |
| de          | Durchsuchen    | Papierkorb| Einstellungen  | Abmelden  |

**TS-3.3: Dashboard greeting maps hour to correct bucket — decision table**

```
Given ui_language is "en"
And the current hour is as per the table below
When an authenticated user requests GET /
Then the greeting text matches the corresponding row
```

| Hour | Greeting           |
|------|--------------------|
| 2    | Late night.        |
| 8    | Good morning.      |
| 13   | Good day.          |
| 15   | Good afternoon.    |
| 20   | Good evening.      |
| 23   | Late night.        |

**TS-3.4: Category labels render via t()**

```
Given ui_language is "de"
And an entry with category "people" exists
When an authenticated user requests GET /
Then the entry's category badge label is the German catalog value for category_abbr.people
```

**TS-3.5: Category key remains English in database regardless of ui_language**

```
Given ui_language is "de"
When an entry is captured via POST /api/capture with text classified as a person
Then the new row's category column contains "people"
```

**TS-3.6: Status enum label renders via t(), DB value stays English**

```
Given ui_language is "de"
And an entry exists in category "tasks" with fields.status = "pending"
When an authenticated user requests GET /entry/{id}
Then the rendered status label is the German catalog value for status.pending
And the JSONB fields.status value is "pending"
```

**TS-3.7: Field labels render via t(), field keys remain English**

```
Given ui_language is "de"
And an entry exists in category "tasks"
When an authenticated user requests GET /entry/{id}/edit
Then the form label for due_date is the German catalog value for field.due_date
And the form field's name attribute is "due_date"
```

**TS-3.8: Client-side script receives server-injected translation blob**

```
Given ui_language is "de"
When an authenticated user requests GET /
Then the response HTML contains a JSON constant with German category abbreviations
And the response HTML contains the German catalog value for the capture feedback "classifying" message
```

**TS-3.9: Dashboard static strings render in selected locale**

```
Given ui_language is "de"
And no entries exist
When an authenticated user requests GET /
Then the hero tagline is the German catalog value
And the four stat labels are the German catalog values
And the entries empty-state text is the German catalog value
And the capture input placeholder is the German catalog value
```

**TS-3.10: Browse page static strings render in selected locale**

```
Given ui_language is "de"
When an authenticated user requests GET /browse
Then the search input placeholder is the German catalog value
And the mode-toggle labels are the German catalog values
And the empty-state text is the German catalog value
```

**TS-3.11: Entry view/edit buttons and labels render in selected locale**

```
Given ui_language is "de"
And an entry exists
When an authenticated user requests GET /entry/{id}/edit
Then the Save, Delete, and Cancel buttons use German catalog values
And the form field labels use German catalog values
```

**TS-3.12: New Note page strings render in selected locale**

```
Given ui_language is "de"
When an authenticated user requests GET /new
Then the page heading is the German catalog value
And the "AI Suggest" button text is the German catalog value
And the unsaved-changes confirmation text embedded in client-side JS is the German catalog value
```

**TS-3.13: Trash page strings render in selected locale**

```
Given ui_language is "de"
When an authenticated user requests GET /trash
Then the page heading is the German catalog value
And the "Empty trash" button text is the German catalog value
And the empty-state text is the German catalog value
```

**TS-3.14: Settings page strings render in selected locale**

```
Given ui_language is "de"
When an authenticated user requests GET /settings
Then every section heading is the German catalog value
And the Language section description is the German catalog value
And the Save button is the German catalog value
```

**TS-3.15: Setup wizard strings render in Accept-Language locale**

```
Given no user exists in the database
And the request Accept-Language header is "de"
When an unauthenticated user requests GET /setup
Then the step-1 heading is the German catalog value
And the field labels are the German catalog values
And the CTA button is the German catalog value
```

**TS-3.16: Login page strings render in Accept-Language locale**

```
Given a user exists in the database
And the request Accept-Language header is "de"
When an unauthenticated user requests GET /login
Then the page heading is the German catalog value
And the password field label is the German catalog value
And the submit button is the German catalog value
```

### Group 4: Date, Time, and Plural Formatting (US-4)

**TS-4.1: Date formatted per locale**

```
Given ui_language is "de"
And the current date is 2026-04-17 (a Friday)
When an authenticated user requests GET /
Then the date line contains the German long-form spelling for Friday and for April
```

**TS-4.2: Time formatted per locale**

```
Given ui_language is "de"
And a digest exists with created_at 15:30 local
When an authenticated user requests GET /
Then the digest "Generated at" time label is formatted per Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" })
```

**TS-4.3: Relative time plural rules — decision table**

```
Given ui_language is set as per the table below
When an entry created `age_minutes` minutes ago is rendered on the dashboard
Then the relative-time label matches the corresponding row
```

| ui_language | age_minutes | Relative Text       |
|-------------|-------------|---------------------|
| en          | 0           | just now            |
| en          | 1           | 1 minute ago        |
| en          | 5           | 5 minutes ago       |
| en          | 60          | 1 hour ago          |
| en          | 180         | 3 hours ago         |
| en          | 1440        | 1 day ago           |
| de          | 1           | vor 1 Minute        |
| de          | 5           | vor 5 Minuten       |
| de          | 60          | vor 1 Stunde        |
| de          | 180         | vor 3 Stunden       |

(German text is illustrative of the expected catalog values; exact strings locked in the test implementation.)

**TS-4.4: Internal sv-SE formatting for SQL filters unaffected by ui_language**

```
Given ui_language is "de"
When formatDateInTz("Europe/Berlin") runs during digest scheduling
Then the returned string matches the pattern YYYY-MM-DD
And the pattern is independent of ui_language
```

### Group 5: Telegram Bot Localization (US-5)

**TS-5.1: Telegram reply uses current ui_language**

```
Given the settings table contains ui_language "de"
When a text message arrives on the Telegram bot from an authorized chat
And the message is captured and classified successfully
Then the bot's confirmation reply text matches the German catalog value
```

**TS-5.2: Telegram reply defaults to English when ui_language is unset**

```
Given the settings table contains no ui_language row
When a text message arrives on the Telegram bot from an authorized chat
And the message is captured and classified successfully
Then the bot's confirmation reply text matches the English catalog value
```

**TS-5.3: Inline category-correction buttons are localized; callback_data remains English**

```
Given the settings table contains ui_language "de"
When a message is captured and its classification confidence is below the configured threshold
Then the bot sends a correction prompt with inline buttons
And each button's text is the German catalog value for the category
And each button's callback_data carries the English category key
```

**TS-5.4: Echoed entry content is not translated**

```
Given the settings table contains ui_language "de" and output_language "English"
When a message arrives on the Telegram bot
And the LLM classifies it and returns name "The quick brown fox"
Then the bot's reply chrome (e.g. "saved as" phrasing) is in German
And the echoed entry name "The quick brown fox" is unchanged (English, as the LLM produced it)
```

### Group 6: Email Digest Localization (US-6)

**TS-6.1: Daily digest subject line uses ui_language**

```
Given the settings table contains ui_language "de" and output_language "German"
When the daily digest is generated on 2026-04-17 and emailed
Then the email Subject header matches the German catalog template with the German-formatted date
```

**TS-6.2: Weekly digest subject line uses ui_language**

```
Given the settings table contains ui_language "en"
When the weekly digest is generated for the week starting 2026-04-13 and emailed
Then the email Subject header matches the English catalog template with the English-formatted week-start date
```

**TS-6.3: Email body is not re-translated**

```
Given the settings table contains ui_language "de" and output_language "French"
When the daily digest is generated and emailed
Then the email body text is in French (as produced by the LLM)
And the email Subject is in German
```

**TS-6.4: Email envelope copy localized**

```
Given the settings table contains ui_language "de"
When a digest email is constructed by src/email.ts
Then any plain-text envelope wrapper (e.g. greeting line, footer) is in German
```

### Group 7: Classify Prompt Enum Locking (US-7)

**TS-7.1: Classify prompt contains explicit English-key lock for enum values**

```
Given the classify prompt template at prompts/classify.md is loaded
When it is rendered for output_language "German"
Then the rendered prompt text contains an instruction that projects.status must be one of "active", "paused", "completed", or null
And contains an instruction that tasks.status must be one of "pending", "done", or null
And contains an instruction that category must be one of "people", "projects", "tasks", "ideas", "reference"
```

**TS-7.2: Enum-lock instruction is present for any output_language**

```
Given the classify prompt template is loaded
When it is rendered for each output_language value ["English", "German", "Spanish", "Korean"]
Then every rendered prompt contains the English-only enum-lock instructions for status and category
```

**TS-7.3: Free-text field values continue to follow output_language in the prompt**

```
Given the classify prompt template is loaded
When it is rendered for output_language "German"
Then the rendered prompt retains the "All structured output in {output_language}" instruction
And the rendered prompt does not restrict the language of notes, context, oneliner, next_action, or follow_ups
```

### Group 8: Catalog Fallback Behavior (US-8)

**TS-8.1: de catalog contains every key from en catalog**

```
Given the en and de catalogs are imported at test time
When the set of keys in the de catalog is compared with the set of keys in the en catalog
Then every key present in en is also present in de
And no key in de is missing a corresponding en key
```

**TS-8.2: Runtime missing key in de falls back to en**

```
Given a key exists in en with value "English value"
And the same key is simulated as missing in de via i18next resource manipulation
When t("key") is called with locale "de"
Then the returned value is "English value"
```

**TS-8.3: Key missing from all catalogs returns raw key string**

```
Given no catalog contains the key "absent.key.for.testing"
When t("absent.key.for.testing") is called with any locale
Then the returned value is the literal string "absent.key.for.testing"
```

### Group 9: Edge Cases

**TS-9.1: ui_language with unrecognized value is treated as unset**

```
Given the settings table contains ui_language "fr"
And no French catalog exists
And the request Accept-Language header is "de"
When an authenticated user requests GET /
Then the resolved locale is "de"
And the response body contains German nav labels
```

**TS-9.2: Settings dropdown for unrecognized ui_language**

```
Given the settings table contains ui_language "fr"
When an authenticated user requests GET /settings
Then the Interface Language dropdown has the "Auto (browser)" option selected
And no "fr" option is present in the dropdown
```

### Group 10: Non-Goal Guards

**TS-10.1: User-generated entry content is not translated**

```
Given the settings table contains ui_language "de"
And an entry exists with name "The quick brown fox" and tags ["foo","bar"] in the database
When an authenticated user requests GET /entry/{id}
Then the response body contains the literal entry name "The quick brown fox"
And the response body contains the literal tags "foo" and "bar"
```

**TS-10.2: LLM prompt bodies are sent to the LLM in English regardless of ui_language**

```
Given the settings table contains ui_language "de" and output_language "German"
When classifyText is invoked with a test input
Then the prompt string sent to the LLM is the English prompts/classify.md template with placeholders substituted
And the rendered prompt contains no German phrasing beyond what the {output_language} variable inserts
```

**TS-10.3: MCP tool descriptions remain in English**

```
Given the settings table contains ui_language "de"
When a JSON-RPC `tools/list` request is posted to POST /mcp with valid credentials
Then each tool's description field is the English string defined in src/mcp-tools.ts
```

**TS-10.4: Setup wizard and login page contain no language picker UI**

```
Given no user exists in the database
When an unauthenticated user requests GET /setup
Then the response body does not contain a form control whose name is "ui_language"

And Given a user exists in the database
When an unauthenticated user requests GET /login
Then the response body does not contain a form control whose name is "ui_language"
And no dropdown, switcher, or flag-icon element for language switching is present
```

## Traceability

Every acceptance criterion in `ui-language-specification.md` is covered by at least one scenario per the Coverage Matrix above. Edge cases EC-1 through EC-3 map to TS-9.1, TS-9.2, and TS-10.1. Non-goals NG-1 through NG-5 are guarded by TS-10.1 through TS-10.4. Constraints (i18next runtime, Hono middleware, no schema change, auth posture) are validated indirectly via scenarios in Groups 1-2 and 5.

**Scenario count:** 57 (Group 1: 10, Group 2: 7, Group 3: 16, Group 4: 4, Group 5: 4, Group 6: 4, Group 7: 3, Group 8: 3, Group 9: 2, Group 10: 4). Three scenarios use decision tables (TS-3.2, TS-3.3, TS-4.3) that expand to additional parameterized test cases at implementation — full row counts for those scenarios are 2, 6, and 10 respectively.
