# Web Settings - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Web Settings |
| Phase | 4 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

Allow runtime configuration of preferences without restarting the app. Settings are stored in the PostgreSQL `settings` table and override env var defaults. Changes take effect immediately where possible.

## User Stories & Acceptance Criteria

### US-1: As a user, I want to manage authorized Telegram chat IDs.

- **AC-1.1:** The settings page (`GET /settings`) shows the current list of authorized Telegram chat IDs (stored as `telegram_chat_ids` in the settings table, or falling back to the `TELEGRAM_CHAT_ID` env var).
- **AC-1.2:** I can add a new chat ID via a text input and an "Add" button.
- **AC-1.3:** I can remove a chat ID from the list via a "Remove" button next to each ID.
- **AC-1.4:** Changes take effect immediately -- the Telegram bot's chat ID validation uses the current settings value on each incoming message (no restart needed).
- **AC-1.5:** At least one chat ID must remain. Attempting to remove the last chat ID shows an error message (e.g., "At least one authorized chat ID is required.").

### US-2: As a user, I want to change the classification model.

- **AC-2.1:** A text input shows the current Anthropic model name (from the `anthropic_model` setting or the `ANTHROPIC_MODEL` env var, default: `claude-sonnet-4-20250514`).
- **AC-2.2:** I can change it to any valid model name (e.g., `claude-haiku-4-5-20251001`). The input accepts free text.
- **AC-2.3:** Changes take effect on the next classification request. No restart or reconnection is needed.

### US-3: As a user, I want to configure digest schedules.

- **AC-3.1:** Two text inputs are shown for the daily and weekly digest cron expressions.
- **AC-3.2:** Changes take effect by rescheduling the cron jobs immediately. The app cancels the existing cron jobs and registers new ones with the updated expressions.
- **AC-3.3:** Default values are shown: `30 7 * * *` (daily at 07:30) and `0 16 * * 0` (weekly on Sunday at 16:00).
- **AC-3.4:** Invalid cron expressions are rejected with an error message (e.g., "Invalid cron expression: {value}"). The previous valid value is preserved.

### US-4: As a user, I want to configure other preferences.

- **AC-4.1:** A timezone dropdown or text input shows the current timezone (from the `timezone` setting or `TZ` env var, default: `Europe/Berlin`). Changing it affects digest scheduling and time display.
- **AC-4.2:** A confidence threshold input accepts a numeric value in the 0.0 to 1.0 range (from the `confidence_threshold` setting, default: `0.6`). This threshold determines whether a classification is considered confident or uncertain.
- **AC-4.3:** A digest email recipient input shows the current email address (from the `digest_email_to` setting or `DIGEST_EMAIL_TO` env var). An empty value disables email digests.
- **AC-4.4:** An Ollama server URL input shows the current URL (from the `ollama_url` setting or `OLLAMA_URL` env var, default: `http://ollama:11434`).

### US-5: As a user, I want changes to persist across app restarts.

- **AC-5.1:** All settings are stored in the `settings` table in PostgreSQL as key-value pairs.
- **AC-5.2:** On startup, the app reads the settings table and uses those values to override env var defaults. The resolution order is: settings table value > env var value > hardcoded default.
- **AC-5.3:** Env vars are never modified by the app. The settings table is the override layer. If a setting is deleted from the table, the app falls back to the env var value.

## Constraints

- The settings page is server-rendered HTML via Hono templates. Form submission is a standard POST request or AJAX calls for individual setting changes.
- The settings page requires authentication (session cookie).
- Settings are stored as `TEXT` values in the `settings` table. Numeric values (e.g., confidence threshold) are stored as text and parsed by the application.
- The `settings` table has an `updated_at` trigger that automatically updates the timestamp on changes.
- Cron job rescheduling must be handled carefully: cancel the old job, validate the new expression, then schedule the new job. If validation fails, the old job remains active.
- The settings page should show the current effective value for each setting (whether it comes from the database or the env var fallback).

## Edge Cases

- **Invalid cron expression:** Rejected with a validation error. The previous valid expression remains active. The cron job is not rescheduled.
- **Confidence threshold outside 0.0-1.0 range:** Rejected with a validation error (e.g., "Confidence threshold must be between 0.0 and 1.0."). The previous value is preserved.
- **Ollama URL that is unreachable:** The setting is saved (warn but allow saving). A warning message is shown (e.g., "Warning: Could not connect to Ollama at this URL. Embedding generation may fail."). The user may intentionally set a URL for a server that is not yet running.
- **Empty email address:** Saving an empty email address disables email digest delivery. The digest is still generated and shown on the dashboard, just not emailed. A note is shown (e.g., "Email digests are disabled.").
- **Removing all Telegram chat IDs:** Prevented. The UI does not allow removing the last chat ID. The "Remove" button is disabled when only one ID remains, and server-side validation enforces this.
- **Invalid Telegram chat ID format:** Chat IDs must be numeric (positive or negative integers). Non-numeric input is rejected with a validation error.
- **Timezone change:** Affects the scheduling of cron jobs. When the timezone changes, cron jobs are rescheduled to use the new timezone. The change takes effect on the next scheduled run.
- **Settings table empty on first startup:** All values fall back to env vars or hardcoded defaults. The settings page shows these fallback values.
- **Concurrent settings changes:** If the user opens the settings page in two tabs and saves different values, the last save wins. No conflict resolution is needed for a single-user system.

## Non-Goals

- Importing or exporting settings (backup/restore).
- Settings change history or audit log.
- Per-category settings (e.g., different confidence thresholds per category).
- API key management through the settings page. Secrets (`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET`, `WEBAPP_PASSWORD`, SMTP credentials) remain in env vars only and are not configurable via the UI.
- Settings validation against external services (e.g., verifying the Anthropic model name is valid by calling the API).
- Resetting individual settings to their default values (the user can manually enter the default).

## Open Questions

- Should the settings page have a single "Save All" button or should each setting save independently?
- Should there be a visual indicator showing which settings are overriding env var defaults vs. using the env var value?
- Should cron expression inputs include a human-readable preview (e.g., "Every day at 07:30")?
- Should the Ollama URL setting trigger a connectivity check on save to provide immediate feedback?
