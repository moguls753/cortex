# Telegram Bot - Behavioral Specification

| Field | Value |
|-------|-------|
| Feature | Telegram Bot |
| Phase | 3 |
| Date | 2026-03-03 |
| Status | Draft |

## Objective

Enable quick thought capture via Telegram. Text and voice messages are automatically classified, embedded, and stored. The bot provides confidence-based feedback and allows inline correction for uncertain classifications.

The Telegram bot is the primary quick-capture interface for Cortex. It uses grammY in long-polling mode (no public URL required), validates senders against an authorized chat ID list, routes messages through the classification and embedding pipeline, and stores results in PostgreSQL. Every interaction provides feedback: confident entries get a confirmation reply, uncertain entries get inline category buttons for one-tap correction, and the `/fix` command allows natural-language correction of the most recent entry.

## User Stories & Acceptance Criteria

### US-1: Text Message Capture

**As a user, I want to send a text message to my Telegram bot and have it classified and stored automatically.**

- **AC-1.1:** When I send a text message, the bot validates my chat ID against the authorized list (from the `telegram_chat_ids` setting in the settings table, falling back to the `TELEGRAM_CHAT_ID` environment variable).
- **AC-1.2:** If my chat ID is not in the authorized list, the bot ignores the message entirely (no reply, no processing, no logging of message content).
- **AC-1.3:** The message text is sent through the context-aware classification pipeline: the system fetches the last 5 recent entries and the top 3 semantically similar entries as context, then sends the message and context to Claude with the classification prompt. Claude returns structured JSON containing `category`, `name`, `confidence`, `fields`, `tags`, `create_calendar_event`, and `calendar_date`.
- **AC-1.4:** An embedding is generated for the message text using Ollama (qwen3-embedding, 4096 dimensions).
- **AC-1.5:** The entry is stored in PostgreSQL with `source: 'telegram'`, `source_type: 'text'`, the raw message text as `content`, and all fields from the classification response (`category`, `name`, `confidence`, `fields`, `tags`).
- **AC-1.6:** The bot replies with the classification result (format depends on confidence level; see US-2).
- **AC-1.7:** If `create_calendar_event` is `true` in the classification response and Google Calendar is configured, a calendar event is created for the `calendar_date`. These fields are ephemeral and not stored in the database.

### US-2: Confidence-Based Reply Formatting

**As a user, I want different reply formats based on classification confidence so I can see at a glance whether the bot is sure about its classification.**

- **AC-2.1:** If `confidence >= threshold` (default 0.6, configurable via `confidence_threshold` setting): the bot replies with the message `"✅ Filed as {category} → {name} ({confidence}%) — reply /fix to correct"`. The confidence value is displayed as a percentage (e.g., 0.85 becomes 85%).
- **AC-2.2:** If `confidence < threshold`: the bot replies with the message `"❓ Best guess: {category} → {name} ({confidence}%)"`.
- **AC-2.3:** Low-confidence replies (below threshold) include an inline keyboard with 5 category buttons: `People`, `Projects`, `Tasks`, `Ideas`, `Reference`. Each button carries callback data identifying the entry and the selected category.
- **AC-2.4:** High-confidence replies (at or above threshold) do NOT include inline buttons.

### US-3: Inline Category Correction

**As a user, I want to correct a misclassification by tapping a category button on a low-confidence reply.**

- **AC-3.1:** When I tap a category button on a low-confidence reply, the entry's `category` is updated in PostgreSQL to the selected category.
- **AC-3.2:** Claude re-generates the category-specific `fields` for the new category using the entry's original content and the correction context (i.e., that the user explicitly chose this category).
- **AC-3.3:** The embedding is re-generated for the updated entry (since the category change may affect semantic meaning when combined with the updated fields).
- **AC-3.4:** The bot edits the original reply message to show: `"✅ Fixed → {new category} → {name}"`. The message is edited in-place (not sent as a new message).
- **AC-3.5:** The inline keyboard is removed from the message after correction.
- **AC-3.6:** The entry's `confidence` is set to `null` after manual correction (since it was human-determined, not AI-determined).

### US-4: Voice Message Capture

**As a user, I want to send a voice message and have it transcribed, classified, and stored.**

- **AC-4.1:** When I send a voice message, the bot downloads the audio file from Telegram. Telegram voice messages are in OGG/Opus format.
- **AC-4.2:** The downloaded audio is sent to the faster-whisper container for transcription. The faster-whisper medium model is used, which supports English and German.
- **AC-4.3:** The transcribed text goes through the same classification pipeline as text messages (context fetch, Claude classification, Ollama embedding).
- **AC-4.4:** The entry is stored in PostgreSQL with `source: 'telegram'`, `source_type: 'voice'`, and the transcribed text as `content`.
- **AC-4.5:** The bot reply includes the transcript and classification result. For high-confidence entries: `"🎤 '{transcript}'\n✅ Filed as {category} → {name} ({confidence}%)"`. For low-confidence entries: `"🎤 '{transcript}'\n❓ Best guess: {category} → {name} ({confidence}%)"`.
- **AC-4.6:** Low-confidence voice entries also receive inline category buttons, identical to text message low-confidence replies (see US-2).

### US-5: Fix Command

**As a user, I want to correct the most recent entry using the `/fix` command with a natural-language description of the correction.**

- **AC-5.1:** When I send `/fix this should be a person not a project`, the bot finds the most recent entry created by the sender (identified by chat ID, source `telegram`). The correction text is everything after `/fix `.
- **AC-5.2:** The entry is re-classified using Claude. The original content and the correction text are both provided to Claude so it can make an informed re-classification. The classification prompt includes the correction as additional context.
- **AC-5.3:** The entry's `category`, `name`, `fields`, `tags`, and `embedding` are all updated based on the re-classification result. The `confidence` is set to the new classification's confidence value.
- **AC-5.4:** The bot replies: `"✅ Fixed → {new category} → {name}"`.
- **AC-5.5:** If there is no recent entry by this sender, the bot replies: `"No recent entry to fix"`.
- **AC-5.6:** If the user sends `/fix` without any correction text (just `/fix` with nothing after it), the bot replies: `"Usage: /fix <correction description>"`.

### US-6: Long-Polling Mode

**As a user, I want the bot to run in long-polling mode so that no public URL or webhook configuration is needed.**

- **AC-6.1:** The bot uses grammY's built-in long-polling mode (not webhooks). No public URL, domain, or TLS certificate is required.
- **AC-6.2:** grammY handles automatic reconnection on network interruptions. No custom reconnection logic is needed.
- **AC-6.3:** The bot starts as part of the application startup sequence (step d: after Drizzle migrations, Ollama connectivity check, and Hono server start). The bot starting does not block the web server from serving requests.
- **AC-6.4:** The bot requires the `TELEGRAM_BOT_TOKEN` environment variable to be set. If it is not set, the bot does not start, but the rest of the application (web server, cron jobs) continues to function. A warning is logged.

## Constraints

### Infrastructure Dependencies

- **Chat ID validation** uses the authorized list from the `telegram_chat_ids` key in the settings table. If no setting exists, it falls back to the `TELEGRAM_CHAT_ID` environment variable. The env var value is a single chat ID or comma-separated list. The settings table value is a JSON array of chat ID strings.
- **Voice transcription** requires the faster-whisper container to be running and accessible at the URL configured by `WHISPER_URL` (default `http://whisper:8000`).
- **Classification** requires the Claude API to be reachable and the `ANTHROPIC_API_KEY` environment variable to be set.
- **Embedding** requires Ollama to be running and accessible at the URL configured by `OLLAMA_URL` (default `http://ollama:11434`) with the `qwen3-embedding` model loaded.
- **Storage** requires PostgreSQL to be running and accessible.

### Reliability

- The bot must never crash the application process. All errors within bot message handlers are caught and logged. If an individual message handler throws an unhandled error, grammY's error handler catches it, logs it, and continues polling.
- grammY's long-polling mode handles Telegram API connectivity issues (timeouts, network errors) with automatic retry.

### Performance

- Message processing is sequential per chat (Telegram guarantees message ordering per chat). Multiple authorized users sending simultaneously are handled independently.
- No explicit rate limiting is applied to incoming messages. Telegram's own rate limits on bot replies (approximately 30 messages per second globally, 1 message per second per chat) are respected by grammY automatically.

### Security

- Unauthorized chat IDs are silently ignored. No error message, no acknowledgment, no logging of message content from unauthorized senders.
- The bot token is sensitive and must not be logged.

## Edge Cases

### Database Failures

- **PostgreSQL is unreachable when a message arrives:** The bot replies `"System temporarily unavailable"`. The entry is NOT stored (no partial writes). The message is effectively lost -- the user must resend it when the system recovers.

### Claude API Failures

- **Claude API is down or returns an error when classifying a message:** The entry is stored with `category: null`, `confidence: null`, and `fields: {}`. The bot replies `"Stored but could not classify — will retry"`. The entry will be retried by the classification retry cron job. The entry appears as "unclassified" on the dashboard.
- **Claude API returns malformed JSON:** Treated the same as Claude API being down. The entry is stored unclassified.

### Ollama Failures

- **Ollama is down or returns an error when generating an embedding:** The entry is stored with `embedding: null`. Classification proceeds normally (classification does not depend on embedding for the current message, only for fetching similar context). The bot replies with the classification result as normal (the user does not need to know the embedding failed). The embedding will be retried by the embedding retry cron job (every 15 minutes).
- **Ollama is down when fetching semantic context for classification:** Classification proceeds with only the last 5 recent entries as context (no semantically similar entries). This is a degraded but functional mode.

### faster-whisper Failures

- **faster-whisper is down when a voice message arrives:** The bot replies `"Could not transcribe voice message. Please send as text."` The entry is NOT stored.
- **faster-whisper returns an empty transcript:** Treated the same as a transcription failure. The bot replies with the transcription error message.
- **Voice message is very short (< 1 second):** faster-whisper may return an empty or nonsensical transcript. If the transcript is empty or only whitespace, it is treated as a transcription failure.

### Input Validation

- **Empty message (only whitespace, no text content):** The bot ignores the message silently (no reply, no processing).
- **Very long message (> 4000 characters):** Classified normally. Claude handles long input. The full text is stored as `content`.
- **Message contains only special characters or emoji:** Classified normally. Claude handles arbitrary text.

### Fix Command Edge Cases

- **`/fix` with no correction text:** The bot replies `"Usage: /fix <correction description>"`.
- **`/fix` when the user has no previous entries:** The bot replies `"No recent entry to fix"`.
- **`/fix` when the most recent entry was already corrected via inline button:** The `/fix` command still works. It re-classifies the entry again using the new correction text.
- **`/fix` when the most recent entry has `category: null` (unclassified due to earlier failure):** The `/fix` command re-classifies the entry normally. This effectively serves as a manual retry.

### Inline Correction Edge Cases

- **User taps a category button on a message where the entry has already been corrected (via a previous button tap or `/fix`):** The bot ignores the callback or responds with a brief acknowledgment but does not re-process. The inline keyboard should already have been removed after the first correction.
- **User taps a category button but the entry has been deleted (soft-deleted from webapp):** The bot replies with an error or ignores the callback gracefully.
- **Callback data references an entry ID that does not exist:** The bot ignores the callback gracefully (no crash, log a warning).

### Unsupported Message Types

- **User sends a photo, sticker, document, location, contact, or any non-text/voice message type:** The bot ignores the message silently. No reply, no processing.

### Concurrency

- **Multiple authorized chat IDs sending messages simultaneously:** Each message is processed independently. Each user receives their own replies. There is no cross-user interference.
- **Same user sends multiple messages rapidly:** Messages are processed sequentially in the order received (Telegram guarantees ordering per chat). Each message gets its own classification, embedding, and reply.

### Calendar Integration

- **`create_calendar_event` is true but Google Calendar is not configured:** The calendar event is silently skipped. The entry is stored normally. No error is surfaced to the user.
- **Google Calendar API call fails:** The entry is stored normally. The calendar failure is logged but does not affect the Telegram reply.

## Non-Goals

- **Handling photos, stickers, documents, or other non-text/voice message types.** Only plain text messages and voice messages are processed.
- **Group chat support.** The bot only works in private chats with authorized users. Messages in group chats are ignored.
- **Inline mode.** The bot does not support Telegram's inline mode (being invoked from other chats via `@botname`).
- **Bot commands menu beyond `/fix`.** No `/start`, `/help`, or other command registration. The bot's interface is intentionally minimal.
- **Rate limiting on incoming messages.** No application-level rate limiting. Telegram's built-in rate limits are sufficient.
- **Message history or conversation context beyond `/fix`.** The bot does not maintain conversational state. Each message is processed independently. The `/fix` command only operates on the single most recent entry.
- **Correcting entries other than the most recent one via Telegram.** To correct older entries, the user must use the web application.
- **Editing the transcription of a voice message.** If the transcription is wrong, the user should resend the thought as a text message or use `/fix` to correct the classification. Transcription text itself cannot be edited via Telegram.
- **Webhook mode.** The bot uses long-polling only. Webhook support is out of scope.
- **Multi-language bot UI.** Bot replies are in English only. The *content* of messages can be in any language supported by Claude and the embedding model (English and German at minimum).

## Open Questions

None.
