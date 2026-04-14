# Onboarding Wizard & Setup Flow - Behavioral Specification

## Objective

Enable a zero-configuration first-run experience for Cortex. A new user runs `docker-compose up`, visits the web UI, and configures everything through an onboarding wizard — no environment variables required beyond `DATABASE_URL`. The app detects whether setup has been completed and routes users to either the wizard (first run) or the login page (subsequent runs). This replaces the current model where `WEBAPP_PASSWORD`, `LLM_API_KEY`, and `TELEGRAM_BOT_TOKEN` are required env vars that prevent startup if missing.

## User Stories & Acceptance Criteria

### US-1: As a new user, I want to set up Cortex entirely through the browser, so that I don't have to configure environment variables before I can use the app.

**AC-1.1:** When no user account exists in the database, all HTTP requests (except `/health` and static assets) redirect to `/setup`.

**AC-1.2:** The `/setup` route serves a multi-step onboarding wizard.

**AC-1.3:** The wizard consists of 4 steps in this order: Account, Language Model, Telegram, Done.

**AC-1.4:** Only the Account step (step 1) is mandatory. Steps 2 and 3 each have a visible "Skip" action that advances to the next step without saving anything for that step.

**AC-1.5:** The final step (Done) shows a summary screen. The user has an active session (logged in) and can navigate to the dashboard via a button.

**AC-1.6:** Once a user account exists, the `/setup` route redirects to `/login` (or `/` if already authenticated).

### US-2: As a new user, I want to create my account in the first setup step, so that my instance is secured with a password.

**AC-2.1:** Step 1 ("Account") presents two fields: Display Name (optional, 1-50 characters) and Password (required, minimum 8 characters).

**AC-2.2:** A "Confirm Password" field is shown and must match the Password field. If they do not match, an inline error message is displayed and the form does not submit.

**AC-2.3:** On submission, the password is hashed using bcrypt (cost factor 12) and stored in a `user` table row along with the display name and creation timestamp.

**AC-2.4:** Only one user row can exist in the `user` table. Attempting to create a second user returns an error.

**AC-2.5:** After account creation, the user is automatically logged in (session cookie set) and advanced to step 2.

### US-3: As a new user, I want to configure my LLM provider in the wizard, so that classification and digests work immediately.

**AC-3.1:** Step 2 ("Language Model") presents: Provider dropdown (Anthropic, OpenAI, Groq, Gemini, Local LLM, Ollama), API Key field (shown when provider requires a key), Model name field, and Base URL field (shown when relevant).

**AC-3.2:** When provider is Ollama, the Ollama-specific UI is shown (available models from the Ollama container, recommended models table, pull button) instead of an API key field.

**AC-3.3:** On submission, the LLM configuration is saved to the `settings` table using the same `llm_config` JSON format as the settings page.

**AC-3.4:** Clicking "Skip" advances to step 3 without saving any LLM configuration. Classification and digests will not function until configured later via `/settings`.

### US-4: As a new user, I want to configure Telegram in the wizard, so that I can start capturing thoughts immediately.

**AC-4.1:** Step 3 ("Telegram") presents: Bot Token field (required for this step) and Chat ID field (required for this step).

**AC-4.2:** A brief help text explains how to obtain a bot token from BotFather and how to find a chat ID.

**AC-4.3:** On submission, the bot token is saved to the `settings` table (key: `telegram_bot_token`) and the chat ID is saved (key: `telegram_chat_ids`). The Telegram bot will connect on next app restart. A note on the Done page indicates this.

**AC-4.4:** Clicking "Skip" advances to step 4 without saving any Telegram configuration. The Telegram bot will not start until configured later via `/settings`.

### US-5: As a new user, I want to see a completion screen after setup, so that I know what's configured and what I can do next.

**AC-5.1:** Step 4 ("Done") displays a summary of what was configured: Account (always), LLM (configured or skipped), Telegram (configured or skipped).

**AC-5.2:** For skipped steps, a note says the feature can be configured later in Settings.

**AC-5.3:** A "Go to Dashboard" button links to `/`.

### US-6: As a returning user, I want to log in with my password, so that my instance remains secure.

**AC-6.1:** When a user account exists in the database and the visitor is not authenticated, all protected routes redirect to `/login`.

**AC-6.2:** The login page presents a Password field and a "Log in" button.

**AC-6.3:** The login page reads the password hash from the `user` table and compares using bcrypt. On match, a session cookie is set and the user is redirected to the originally requested URL (or `/`). On mismatch, an error "Invalid password" is shown.

**AC-6.4:** The login page follows the Terminal / Command Center design system (JetBrains Mono, oklch color tokens, dark/light theme support).

### US-7: As a user, I want the app to start with minimal environment variables, so that deployment is simple.

**AC-7.1:** The only required environment variable is `DATABASE_URL`. If missing, the app exits with an error message: "Missing required environment variable: DATABASE_URL".

**AC-7.2:** `SESSION_SECRET` is optional. If not set, the app auto-generates a cryptographically random 64-character hex string on first boot and stores it in the `settings` table (key: `session_secret`). On subsequent boots, the stored value is used.

**AC-7.3:** `PORT` is optional, defaults to `3000`.

**AC-7.4:** `OLLAMA_URL` is optional, defaults to `http://ollama:11434`. Not shown in the settings UI.

**AC-7.5:** `WHISPER_URL` is optional, defaults to `http://whisper:8000`. Not shown in the settings UI.

**AC-7.6:** The following env vars are removed and their configuration moves to the settings UI only: `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WEBAPP_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_ID`, `GOOGLE_REFRESH_TOKEN`, `DAILY_DIGEST_CRON`, `WEEKLY_DIGEST_CRON`, `CONFIDENCE_THRESHOLD`, `DIGEST_EMAIL_TO`, `OUTPUT_LANGUAGE`.

**AC-7.7:** `TZ` remains as an optional env var (defaults to `Europe/Berlin`). It is a system-level env var that Node.js and date libraries read directly. The settings page timezone field overrides it at the application level for digest scheduling and display, but `TZ` may still be set in `docker-compose.yml` for correct system-level time behavior.

**AC-7.8:** SMTP configuration (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `DIGEST_EMAIL_FROM`) remains as env vars until SMTP fields are added to the settings page (out of scope for this feature).

**AC-7.9:** The app must not crash on startup when optional env vars are missing. The `REQUIRED_VARS` check in `config.ts` is reduced to `DATABASE_URL` only. All other configuration is loaded from the database at runtime.

### US-8: As a user, I want features to degrade gracefully when not configured, so that missing configuration doesn't crash the app.

**AC-8.1:** If no Telegram bot token is configured, the Telegram bot does not start. No error is thrown. The health endpoint reports Telegram status as "not configured".

**AC-8.2:** If no LLM provider/API key is configured, classification returns a default category "uncategorized" with confidence 0. Digest generation is skipped with a log message "LLM not configured — skipping digest".

**AC-8.3:** If no SMTP configuration exists, email digest delivery is skipped with a log message. The digest is still generated and stored.

**AC-8.4:** If no Google Calendar credentials are configured, calendar event creation is skipped silently for classified entries.

## Constraints

**C-1:** Single-user only. The `user` table holds at most one row. Multi-user support is a future concern and must not be precluded architecturally (the table has an `id` primary key) but is not implemented.

**C-2:** The wizard UI follows the Terminal / Command Center design system defined in `docs/plans/2026-03-06-web-design-system.md`: JetBrains Mono, oklch color tokens, dark/light theme, Tailwind utility classes, server-rendered HTML via Hono, Lucide inline SVGs, no client-side framework.

**C-3:** The wizard is server-rendered. Each step is a separate form POST that saves and redirects to the next step. No client-side routing or SPA behavior.

**C-4:** Password hashing uses bcrypt with cost factor 12. The `bcrypt` or `bcryptjs` npm package is used.

**C-5:** The `user` table schema: `id` (integer primary key, CHECK (id = 1) to enforce single row), `password_hash` (text, not null), `display_name` (text, nullable), `created_at` (timestamptz, default now()).

**C-6:** The setup state is determined by querying the `user` table: zero rows = setup mode, one row = normal mode. No separate flag or settings key.

**C-7:** The Telegram bot token moves from an env var to the `settings` table (key: `telegram_bot_token`). The bot startup code reads from the settings table instead of `config.telegramBotToken`.

**C-8:** All LLM API keys are stored in the `llm_config` JSON in the settings table, as they already are today. The `LLM_API_KEY` env var is removed.

**C-9:** The settings page (`/settings`) is updated as part of this feature: the `SETTINGS_TO_ENV` mapping is removed, Telegram bot token and chat ID fields read/write from the settings table only, Google Calendar Client ID and Client Secret fields read/write from the settings table only (no env var fallback), and all `|| process.env.X` fallback patterns are removed from settings-related code.

**C-10:** `config.ts` is reduced to export only `DATABASE_URL`, `PORT`, `SESSION_SECRET` (optional), `OLLAMA_URL` (with default), `WHISPER_URL` (with default), and `TZ` (with default). The `REQUIRED_VARS` array contains only `DATABASE_URL`. All other config values previously exported are removed.

## Edge Cases

**E-1:** User visits `/setup` when a user account already exists → redirect to `/login`.

**E-2:** User visits `/login` when no user account exists → redirect to `/setup`.

**E-3:** User submits step 1 with a password shorter than 8 characters → inline error, form does not advance.

**E-4:** User submits step 1 with non-matching password and confirm password → inline error, form does not advance.

**E-5:** User navigates directly to `/setup/step/3` without completing step 1 → redirect to `/setup` (step 1).

**E-6:** User refreshes the Done page → shows the same summary, no duplicate account creation.

**E-7:** App starts with `DATABASE_URL` pointing to an empty database (no tables) → migrations run, tables are created, setup mode is entered.

**E-8:** App starts with no `SESSION_SECRET` env var and no `session_secret` in settings → generates one, saves to settings, uses it for the current session.

**E-9:** User submits the Account step twice rapidly (double-click) → only one user row is created (enforced by the single-row constraint on the `user` table).

**E-10:** The Ollama container is unreachable during step 2 with Ollama selected → the model list shows "No models available" but the form still submits with a manually typed model name.

**E-11:** Display name field is left empty → stored as NULL. Digests and greetings use a generic fallback (e.g., "Good morning" instead of "Good morning, Eike").

## Non-Goals

**NG-1:** Multi-user support. Only one user account is supported. No user management, no roles, no permissions beyond "is there a valid session."

**NG-2:** Password reset / recovery. If the user forgets their password, they must reset the `user` table manually (e.g., via `psql`). This is acceptable for a single-user self-hosted app.

**NG-3:** OAuth / SSO login. Password-only authentication.

**NG-4:** Migration from env-var-based configuration. Existing installs that relied on env vars must re-enter their configuration through the setup wizard or settings page. This is a clean break, not a migration.

**NG-5:** SMTP configuration in the wizard. SMTP setup is a niche feature and belongs in the settings page, not the onboarding flow.

**NG-6:** Google Calendar configuration in the wizard. It requires an OAuth flow and is too complex for onboarding. It belongs in the settings page.

**NG-7:** Embedding model configuration in the wizard. The embedding model (qwen3-embedding) is auto-detected from the Ollama container and requires no user input.

## Open Questions

None.
