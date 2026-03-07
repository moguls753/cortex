# Web Settings - Test Specification

| Field | Value |
|-------|-------|
| Feature | Web Settings |
| Phase | 2 |
| Date | 2026-03-07 |
| Status | Draft |
| Derived From | `web-settings-specification.md` |

## Resolved Questions

Before deriving scenarios, four open questions from the behavioral spec were resolved:

1. **Single "Save All" button** — one form, one POST `/settings`, redirect back with success/error message.
2. **No env var override indicator** — just show the effective value.
3. **No cron human-readable preview** — raw cron expression only.
4. **Ollama URL connectivity check on save** — attempt fetch, warn if unreachable, still save.

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: Display current Telegram chat IDs | TS-1.1 |
| AC-1.2: Add a new chat ID | TS-1.2 |
| AC-1.3: Remove a chat ID | TS-1.3 |
| AC-1.4: Changes take effect immediately | TS-5.2 (resolution mechanism covers this) |
| AC-1.5: Cannot remove last chat ID | TS-1.5 |
| AC-2.1: Display current model name | TS-2.1 |
| AC-2.2: Change model name | TS-2.2 |
| AC-2.3: Model change takes effect on next request | TS-5.2 (resolution mechanism covers this) |
| AC-3.1: Display digest cron expressions | TS-3.1 |
| AC-3.2: Cron reschedule on save | TS-3.2 (save only; rescheduling tested in digests feature) |
| AC-3.3: Default cron values shown | TS-3.3 |
| AC-3.4: Invalid cron rejected | TS-3.4 |
| AC-4.1: Timezone setting | TS-4.1 |
| AC-4.2: Confidence threshold setting | TS-4.2 |
| AC-4.3: Digest email setting | TS-4.3 |
| AC-4.4: Ollama URL setting | TS-4.4 |
| AC-5.1: Settings stored in DB | TS-5.1 |
| AC-5.2: Settings override env vars on startup | TS-5.2 |
| AC-5.3: Env vars never modified, fallback on delete | TS-5.3 |
| C-1: Authentication required | TS-6.1, TS-6.1b |
| C-2: Server-rendered HTML via Hono | TS-6.2 |
| EC-1: Invalid cron expression | TS-3.4 (same as AC-3.4) |
| EC-2: Confidence threshold out of range | TS-7.1, TS-7.1b, TS-7.1c, TS-7.1d |
| EC-3: Unreachable Ollama URL | TS-7.2 |
| EC-4: Empty email disables email digests | TS-7.3 |
| EC-5: Cannot remove all Telegram chat IDs | TS-1.5 (same as AC-1.5) |
| EC-6: Invalid Telegram chat ID format | TS-7.4 |
| EC-7: Timezone change reschedules cron | TS-7.5 (save only; rescheduling tested in digests feature) |
| EC-8: Empty settings table on first startup | TS-7.6, TS-7.8 |
| EC-9: Concurrent settings changes (last write wins) | TS-7.7 |
| NG-1: No import/export | (non-goal, no route exists) |
| NG-2: No settings history | (non-goal, no route exists) |
| NG-3: No per-category settings | (non-goal, single threshold) |
| NG-4: No API key management in UI | TS-8.1 |
| NG-5: No external validation of model names | (non-goal, accepts free text) |
| NG-6: No reset-to-default button | (non-goal, no UI element) |

## Test Scenarios

### Group 1: Telegram Chat IDs (US-1)

**TS-1.1: Display current Telegram chat IDs**

```
Given the settings table contains telegram_chat_ids "123456,789012"
When the user visits the settings page
Then the page displays chat IDs "123456" and "789012" in the Telegram section
And each chat ID has a "Remove" button
And a text input and "Add" button are shown for adding new IDs
```

**TS-1.2: Add a new Telegram chat ID**

```
Given the settings table contains telegram_chat_ids "123456"
When the user saves settings with a new chat ID "789012" added
Then the settings table contains telegram_chat_ids "123456,789012"
And the settings page redisplays with both chat IDs shown
And a success message is shown
```

**TS-1.3: Remove a Telegram chat ID**

```
Given the settings table contains telegram_chat_ids "123456,789012"
When the user saves settings with chat ID "789012" removed
Then the settings table contains telegram_chat_ids "123456"
And the settings page redisplays with only "123456" shown
And a success message is shown
```

**TS-1.5: Cannot remove the last Telegram chat ID**

```
Given the settings table contains telegram_chat_ids "123456"
When the user saves settings with chat ID "123456" removed
Then the save is rejected with error "At least one authorized chat ID is required."
And the settings table still contains telegram_chat_ids "123456"
```

### Group 2: Classification Model (US-2)

**TS-2.1: Display current model name**

```
Given the settings table contains anthropic_model "claude-haiku-4-5-20251001"
When the user visits the settings page
Then the model input shows "claude-haiku-4-5-20251001"
```

**TS-2.2: Change model name**

```
Given the settings table contains anthropic_model "claude-sonnet-4-20250514"
When the user saves settings with model changed to "claude-haiku-4-5-20251001"
Then the settings table contains anthropic_model "claude-haiku-4-5-20251001"
And the settings page redisplays with "claude-haiku-4-5-20251001" in the model input
And a success message is shown
```

### Group 3: Digest Schedules (US-3)

**TS-3.1: Display digest cron expressions**

```
Given the settings table contains daily_digest_cron "0 8 * * *"
And the settings table contains weekly_digest_cron "0 18 * * 5"
When the user visits the settings page
Then the daily digest input shows "0 8 * * *"
And the weekly digest input shows "0 18 * * 5"
```

**TS-3.2: Save valid cron expressions**

```
Given the settings table contains daily_digest_cron "30 7 * * *"
When the user saves settings with daily_digest_cron changed to "0 9 * * *"
Then the settings table contains daily_digest_cron "0 9 * * *"
And a success message is shown
```

**TS-3.2b: Save valid weekly cron expression**

```
Given the settings table contains weekly_digest_cron "0 16 * * 0"
When the user saves settings with weekly_digest_cron changed to "0 18 * * 5"
Then the settings table contains weekly_digest_cron "0 18 * * 5"
And a success message is shown
```

**TS-3.3: Default cron values shown when no setting exists**

```
Given the settings table has no daily_digest_cron or weekly_digest_cron entries
And no env vars override the defaults
When the user visits the settings page
Then the daily digest input shows "30 7 * * *"
And the weekly digest input shows "0 16 * * 0"
```

**TS-3.4: Invalid cron expression rejected**

```
Given the settings table contains daily_digest_cron "30 7 * * *"
When the user saves settings with daily_digest_cron changed to "not a cron"
Then the save is rejected with error containing "Invalid cron expression"
And the settings table still contains daily_digest_cron "30 7 * * *"
```

### Group 4: Other Preferences (US-4)

**TS-4.1: Display timezone**

```
Given the settings table contains timezone "America/New_York"
When the user visits the settings page
Then the timezone input shows "America/New_York"
```

**TS-4.2: Display confidence threshold**

```
Given the settings table contains confidence_threshold "0.8"
When the user visits the settings page
Then the confidence threshold input shows "0.8"
```

**TS-4.3: Display digest email**

```
Given the settings table contains digest_email_to "user@example.com"
When the user visits the settings page
Then the email input shows "user@example.com"
```

**TS-4.4: Display Ollama URL**

```
Given the settings table contains ollama_url "http://localhost:11434"
When the user visits the settings page
Then the Ollama URL input shows "http://localhost:11434"
```

**TS-4.5: Save all preferences in one submission**

```
Given the settings page is loaded with current values
When the user changes timezone to "UTC", confidence threshold to "0.7", email to "new@example.com", and Ollama URL to "http://ollama:11434" and saves
Then the settings table contains all four updated values
And the settings page redisplays with the new values
And a success message is shown
```

### Group 5: Persistence & Resolution (US-5)

**TS-5.1: Settings stored as key-value pairs in DB**

```
Given the user saves settings with anthropic_model "claude-haiku-4-5-20251001"
When the settings table is queried
Then a row exists with key "anthropic_model" and value "claude-haiku-4-5-20251001"
And the row has an updated_at timestamp
```

**TS-5.2: Settings override env vars**

```
Given the env var ANTHROPIC_MODEL is "claude-sonnet-4-20250514"
And the settings table contains anthropic_model "claude-haiku-4-5-20251001"
When the app resolves the anthropic_model setting
Then the resolved value is "claude-haiku-4-5-20251001"
```

**TS-5.3: Fallback to env var when setting deleted**

```
Given the env var ANTHROPIC_MODEL is "claude-sonnet-4-20250514"
And the settings table has no anthropic_model entry
When the app resolves the anthropic_model setting
Then the resolved value is "claude-sonnet-4-20250514"
```

### Group 6: Constraints

**TS-6.1: Authentication required for GET**

```
Given an unauthenticated user
When the user requests the settings page
Then the user is redirected to the login page
```

**TS-6.1b: Authentication required for POST**

```
Given an unauthenticated user
When the user submits the settings form
Then the user is redirected to the login page
And no settings are changed
```

**TS-6.2: Settings page is server-rendered HTML**

```
Given an authenticated user
When the user visits the settings page
Then the response is HTML containing a form with inputs for all settings
And the page uses the standard layout template
```

### Group 7: Edge Cases

**TS-7.1: Confidence threshold out of range**

```
Given the settings table contains confidence_threshold "0.6"
When the user saves settings with confidence_threshold changed to "1.5"
Then the save is rejected with error "Confidence threshold must be between 0.0 and 1.0."
And the settings table still contains confidence_threshold "0.6"
```

**TS-7.1b: Confidence threshold negative value**

```
Given the settings table contains confidence_threshold "0.6"
When the user saves settings with confidence_threshold changed to "-0.1"
Then the save is rejected with error "Confidence threshold must be between 0.0 and 1.0."
And the settings table still contains confidence_threshold "0.6"
```

**TS-7.1c: Confidence threshold non-numeric**

```
Given the settings table contains confidence_threshold "0.6"
When the user saves settings with confidence_threshold changed to "abc"
Then the save is rejected with error "Confidence threshold must be between 0.0 and 1.0."
And the settings table still contains confidence_threshold "0.6"
```

**TS-7.1d: Confidence threshold boundary values accepted**

```
Given the settings table contains confidence_threshold "0.6"
When the user saves settings with confidence_threshold changed to "0.0"
Then the settings table contains confidence_threshold "0.0"
And a success message is shown
```

```
Given the settings table contains confidence_threshold "0.6"
When the user saves settings with confidence_threshold changed to "1.0"
Then the settings table contains confidence_threshold "1.0"
And a success message is shown
```

**TS-7.2: Unreachable Ollama URL saved with warning**

```
Given the Ollama server at "http://unreachable:11434" is not responding
When the user saves settings with ollama_url changed to "http://unreachable:11434"
Then the setting is saved in the settings table
And the settings page redisplays with a warning "Could not connect to Ollama at this URL. Embedding generation may fail."
```

**TS-7.3: Empty email disables email digests**

```
Given the settings table contains digest_email_to "user@example.com"
When the user saves settings with digest_email_to changed to ""
Then the settings table contains digest_email_to ""
And the settings page shows a note "Email digests are disabled."
```

**TS-7.4: Invalid Telegram chat ID format**

```
Given the settings table contains telegram_chat_ids "123456"
When the user saves settings with a new chat ID "not-a-number" added
Then the save is rejected with error containing "Chat ID must be numeric"
And the settings table still contains telegram_chat_ids "123456"
```

**TS-7.5: Timezone change saved successfully**

```
Given the settings table contains timezone "Europe/Berlin"
When the user saves settings with timezone changed to "America/New_York"
Then the settings table contains timezone "America/New_York"
And a success message is shown
```

Note: Actual cron rescheduling with the new timezone is tested in the digests feature spec.

**TS-7.6: Empty settings table shows hardcoded defaults**

```
Given the settings table has no entries
And env vars are not set for any settings
When the user visits the settings page
Then the model input shows "claude-sonnet-4-20250514"
And the daily digest input shows "30 7 * * *"
And the weekly digest input shows "0 16 * * 0"
And the timezone input shows "Europe/Berlin"
And the confidence threshold input shows "0.6"
And the Ollama URL input shows "http://ollama:11434"
And the email input is empty
And the Telegram chat IDs section is empty
```

**TS-7.7: Last write wins on concurrent changes**

```
Given session A has already saved confidence_threshold as "0.7"
When session B saves confidence_threshold as "0.8"
Then the settings table contains confidence_threshold "0.8"
```

**TS-7.8: Telegram chat IDs fall back to env var**

```
Given the settings table has no telegram_chat_ids entry
And the env var TELEGRAM_CHAT_ID is "999888"
When the user visits the settings page
Then the Telegram section shows chat ID "999888"
```

### Group 8: Non-Goal Guards

**TS-8.1: API keys not exposed on settings page**

```
Given the env var ANTHROPIC_API_KEY is set
And the env var TELEGRAM_BOT_TOKEN is set
And the env var SESSION_SECRET is set
When the user visits the settings page
Then the page does not contain any of these secret values
And there are no input fields for API keys, bot tokens, or session secrets
```

## Traceability Summary

- **20 acceptance criteria** covered: 17 directly by test scenarios (TS-1.1 through TS-5.3), 3 via cross-references (AC-1.4 and AC-2.3 covered by TS-5.2 resolution mechanism, AC-3.2 rescheduling deferred to digests feature)
- **6 constraints** covered: authentication GET+POST (TS-6.1, TS-6.1b), server-rendered HTML (TS-6.2), text storage (TS-5.1), updated_at trigger (TS-5.1), cron validation (TS-3.4), effective value display (TS-7.6)
- **9 edge cases** covered by TS-7.1 through TS-7.8 (with sub-scenarios for threshold variants including boundary values)
- **4 non-goals** verified: no secret exposure (TS-8.1), remaining 3 verified by absence of routes/UI
- **4 open questions** resolved and incorporated into scenarios
- **Cross-feature dependencies:** Cron rescheduling (AC-3.2, EC-7) saved here, rescheduling behavior tested in digests feature spec

Total: **35 test scenarios** (TS-7.1d counts as 2: boundary 0.0 and boundary 1.0)
