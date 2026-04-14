# Telegram Bot - Test Specification

| Field | Value |
|-------|-------|
| Feature | Telegram Bot |
| Phase | 2 — Test Specification |
| Date | 2026-03-04 |
| Status | Draft |
| Derives from | `docs/specs/telegram-bot-specification.md` |

## Coverage Matrix

| Spec Requirement | Test Scenario(s) |
|------------------|------------------|
| AC-1.1: Chat ID validated against authorized list | TS-1.1, TS-1.2, TS-1.3, TS-1.12 |
| AC-1.2: Unauthorized chat ID → ignored silently | TS-1.4, TS-1.5 |
| AC-1.3: Context-aware classification pipeline | TS-1.6, TS-1.7 |
| AC-1.4: Embedding generated for message text | TS-1.8 |
| AC-1.5: Entry stored with correct fields | TS-1.9 |
| AC-1.6: Bot replies with classification result | (covered by TS-2.1, TS-2.2) |
| AC-1.7: Calendar event created when applicable | TS-1.10, TS-1.11 |
| AC-2.1: High-confidence reply format | TS-2.1, TS-2.3, TS-2.7, TS-2.8 |
| AC-2.2: Low-confidence reply format | TS-2.2 |
| AC-2.3: Low-confidence inline keyboard with 5 buttons | TS-2.4, TS-2.5 |
| AC-2.4: High-confidence no inline buttons | TS-2.6 |
| AC-3.1: Category updated on button tap | TS-3.1 |
| AC-3.2: Fields re-generated for new category | TS-3.2 |
| AC-3.3: Embedding re-generated after correction | TS-3.3 |
| AC-3.4: Original reply edited in-place | TS-3.4 |
| AC-3.5: Inline keyboard removed after correction | TS-3.5 |
| AC-3.6: Confidence set to null after manual correction | TS-3.6 |
| AC-4.1: Voice audio downloaded from Telegram | TS-4.1 |
| AC-4.2: Audio sent to faster-whisper for transcription | TS-4.2 |
| AC-4.3: Transcribed text classified same as text | TS-4.3 |
| AC-4.4: Entry stored with source_type 'voice' | TS-4.4 |
| AC-4.5: Voice reply includes transcript | TS-4.5, TS-4.6 |
| AC-4.6: Low-confidence voice entries get inline buttons | TS-4.7 |
| AC-5.1: /fix finds most recent entry by sender | TS-5.1, TS-5.2 |
| AC-5.2: Entry re-classified with correction context | TS-5.3 |
| AC-5.3: All fields updated from re-classification | TS-5.4 |
| AC-5.4: /fix reply format | TS-5.5 |
| AC-5.5: No recent entry → error reply | TS-5.6 |
| AC-5.6: /fix without correction text → usage reply | TS-5.7 |
| AC-6.1: Long-polling mode (no webhooks) | TS-6.1 |
| AC-6.2: Automatic reconnection | TS-6.2 |
| AC-6.3: Bot starts in correct sequence | TS-6.3 |
| AC-6.4: Missing bot token → bot skipped, app continues | TS-6.4 |
| C: Chat ID from settings table with env var fallback | TS-1.1, TS-1.2, TS-1.3 |
| C: Reliability — errors don't crash process | TS-EC-1, TS-EC-2 |
| C: Security — unauthorized silently ignored | TS-1.4, TS-1.5 |
| EC: DB unreachable | TS-EC-1, TS-EC-2 |
| EC: Claude API failure | TS-EC-3, TS-EC-4 |
| EC: Ollama failure (embedding) | TS-EC-6 |
| EC: Ollama failure (context fetch) | TS-EC-7 |
| EC: faster-whisper down | TS-EC-8 |
| EC: Empty transcript | TS-EC-9 |
| EC: Whitespace-only transcript | TS-EC-10 |
| EC: Empty/whitespace text message | TS-EC-11 |
| EC: Very long message (> 4000 chars) | TS-EC-12 |
| EC: Special characters/emoji only | TS-EC-13 |
| EC: /fix on already-corrected entry (button) | TS-EC-14 |
| EC: /fix on unclassified entry | TS-EC-15 |
| EC: Double-tap inline button | TS-EC-16 |
| EC: Inline button on soft-deleted entry | TS-EC-17 |
| EC: Inline button with non-existent entry ID | TS-EC-18 |
| EC: Unsupported message types | TS-EC-19 |
| EC: Calendar not configured | TS-EC-20 |
| EC: Calendar API failure | TS-EC-21 |
| EC: Concurrent messages from multiple users | TS-EC-22 |
| EC: Same user rapid messages (sequential processing) | TS-EC-23 |
| NG: Group chat messages ignored | TS-NG-1 |
| NG: No /start or /help commands | TS-NG-2 |

## Test Scenarios

### US-1: Text Message Capture

**TS-1.1: Chat ID authorized via settings table**
```
Scenario: Message from chat ID listed in the settings table is accepted
  Given the settings table contains telegram_chat_ids ["123456"]
  And TELEGRAM_CHAT_ID env var is not set
  When a text message arrives from chat ID 123456
  Then the message is accepted for processing
```

**TS-1.2: Chat ID authorized via env var fallback**
```
Scenario: Message from chat ID in env var is accepted when no setting exists
  Given the settings table has no telegram_chat_ids entry
  And TELEGRAM_CHAT_ID env var is "123456"
  When a text message arrives from chat ID 123456
  Then the message is accepted for processing
```

**TS-1.3: Chat ID authorized via comma-separated env var**
```
Scenario: Multiple chat IDs in env var, second one sends a message
  Given the settings table has no telegram_chat_ids entry
  And TELEGRAM_CHAT_ID env var is "111,222,333"
  When a text message arrives from chat ID 222
  Then the message is accepted for processing
```

**TS-1.12: Multiple chat IDs in settings table JSON array**
```
Scenario: Settings table with multiple authorized chat IDs
  Given the settings table contains telegram_chat_ids ["111", "222", "333"]
  When a text message arrives from chat ID 222
  Then the message is accepted for processing
```

**TS-1.4: Unauthorized chat ID ignored silently**
```
Scenario: Message from unauthorized chat ID is ignored
  Given the authorized chat IDs are ["123456"]
  When a text message arrives from chat ID 999999
  Then no reply is sent
  And no entry is stored
  And the message content is not logged
```

**TS-1.5: Unauthorized with settings table and env var both present**
```
Scenario: Settings table overrides env var for chat ID authorization
  Given the settings table contains telegram_chat_ids ["111"]
  And TELEGRAM_CHAT_ID env var is "222"
  When a text message arrives from chat ID 222
  Then no reply is sent
  And no entry is stored
```

**TS-1.6: Classification uses context-aware pipeline**
```
Scenario: Text message is classified with recent and similar context
  Given an authorized user
  And 7 existing entries in the database
  And Ollama is running
  When the user sends "Met with Sarah about the marketing project"
  Then the last 5 recent entries (excluding soft-deleted) are fetched as context
  And the top 3 semantically similar entries are fetched via embedding cosine similarity
  And both context sets are sent to the LLM along with the message text
```

**TS-1.7: Classification context deduplication**
```
Scenario: Entries appearing in both recent and similar sets are deduplicated
  Given an authorized user
  And an entry that is both among the 5 most recent and semantically similar
  When the user sends a text message
  Then the deduplicated context is sent to the LLM (no duplicates)
```

**TS-1.8: Embedding generated for message text**
```
Scenario: An embedding is generated via Ollama for the message text
  Given an authorized user
  And Ollama is running with qwen3-embedding
  When the user sends "New project idea: build a recipe tracker"
  Then a 4096-dimension embedding is generated for the message text
  And the embedding is stored with the entry
```

**TS-1.9: Entry stored with correct fields**
```
Scenario: Classified message is stored with all required fields
  Given an authorized user
  And classification returns category "Projects", name "Recipe Tracker", confidence 0.92, fields {status: "idea"}, tags ["cooking", "side-project"]
  When the user sends a text message
  Then an entry is created with source "telegram"
  And source_type "text"
  And content equal to the raw message text
  And category "Projects"
  And name "Recipe Tracker"
  And confidence 0.92
  And fields {status: "idea"}
  And tags ["cooking", "side-project"]
```

**TS-1.10: Calendar event created when applicable**
```
Scenario: Calendar event created when classification indicates it
  Given an authorized user
  And classification returns create_calendar_event true and calendar_date "2026-03-10"
  And Google Calendar is configured
  When the user sends "Meeting with Anna next Tuesday"
  Then a calendar event is created for 2026-03-10
  And create_calendar_event and calendar_date are NOT stored in the database entry
```

**TS-1.11: Calendar fields are ephemeral**
```
Scenario: Calendar fields from classification are not persisted
  Given an authorized user
  And classification returns create_calendar_event true and calendar_date "2026-03-10"
  When the entry is stored
  Then the entry in the database does not contain create_calendar_event
  And the entry does not contain calendar_date
```

### US-2: Confidence-Based Reply Formatting

**TS-2.1: High-confidence reply format**
```
Scenario: Confident classification produces confirmation reply
  Given an authorized user
  And the confidence threshold is 0.6
  When the user sends a message that is classified with category "People", name "Sarah", confidence 0.85
  Then the bot replies "✅ Filed as People → Sarah (85%) — reply /fix to correct"
```

**TS-2.2: Low-confidence reply format**
```
Scenario: Uncertain classification produces best-guess reply
  Given an authorized user
  And the confidence threshold is 0.6
  When the user sends a message that is classified with category "Ideas", name "Unnamed", confidence 0.45
  Then the bot replies "❓ Best guess: Ideas → Unnamed (45%)"
```

**TS-2.3: Confidence displayed as percentage**
```
Scenario: Confidence value is converted to percentage in reply
  Given an authorized user
  When a message is classified with confidence 0.73
  Then the reply displays "73%"
```

**TS-2.4: Low-confidence reply includes inline keyboard**
```
Scenario: Uncertain reply includes 5 category buttons
  Given an authorized user
  And the confidence threshold is 0.6
  When a message is classified with confidence 0.40
  Then the reply includes an inline keyboard
  And the keyboard has 5 buttons: "People", "Projects", "Tasks", "Ideas", "Reference"
  And each button carries callback data identifying the entry and the selected category
```

**TS-2.5: Inline button callback data format**
```
Scenario: Category button callback data identifies entry and category
  Given a low-confidence classification with entry ID 42
  When the inline keyboard is attached to the reply
  Then each button's callback data includes the entry ID and the category name
```

**TS-2.6: High-confidence reply has no inline buttons**
```
Scenario: Confident reply does not include inline keyboard
  Given an authorized user
  And the confidence threshold is 0.6
  When a message is classified with confidence 0.80
  Then the reply does not include an inline keyboard
```

**TS-2.7: Custom confidence threshold from settings**
```
Scenario: Confidence threshold is configurable via settings table
  Given an authorized user
  And the confidence_threshold setting is 0.8
  When a message is classified with confidence 0.75
  Then the bot replies with the low-confidence format "❓ Best guess:"
  And the reply includes inline keyboard with 5 category buttons
```

**TS-2.8: Confidence exactly at threshold boundary**
```
Scenario: Confidence exactly at threshold is treated as high-confidence
  Given an authorized user
  And the confidence threshold is 0.6
  When a message is classified with confidence 0.60
  Then the bot replies with the high-confidence format "✅ Filed as"
  And the reply does not include an inline keyboard
```

### US-3: Inline Category Correction

**TS-3.1: Category updated on button tap**
```
Scenario: Tapping a category button updates the entry's category
  Given a low-confidence entry with ID 42 and category "Ideas"
  When the user taps the "Projects" button
  Then the entry's category is updated to "Projects" in the database
```

**TS-3.2: Fields re-generated for new category**
```
Scenario: Category-specific fields are re-generated after correction
  Given a low-confidence entry with category "Ideas" and fields for Ideas
  When the user taps the "People" button
  Then Claude re-generates the fields for category "People"
  And the entry's fields are updated with the new category-specific fields
```

**TS-3.3: Embedding re-generated after correction**
```
Scenario: Embedding is re-generated after category correction
  Given a low-confidence entry with an existing embedding
  When the user taps a category button to correct it
  Then a new embedding is generated for the updated entry
  And the entry's embedding is replaced with the new one
```

**TS-3.4: Original reply edited in-place**
```
Scenario: Bot edits the original message instead of sending a new one
  Given a low-confidence reply message
  When the user taps the "Tasks" button
  Then the original reply message is edited to show "✅ Fixed → Tasks → {name}"
  And no new message is sent
```

**TS-3.5: Inline keyboard removed after correction**
```
Scenario: Category buttons are removed after correction
  Given a low-confidence reply with inline keyboard
  When the user taps any category button
  Then the inline keyboard is removed from the message
```

**TS-3.6: Confidence set to null after manual correction**
```
Scenario: Manual correction clears the confidence value
  Given a low-confidence entry with confidence 0.35
  When the user taps a category button
  Then the entry's confidence is set to null
```

### US-4: Voice Message Capture

**TS-4.1: Voice audio downloaded from Telegram**
```
Scenario: Bot downloads voice message audio file
  Given an authorized user
  When the user sends a voice message
  Then the bot downloads the OGG/Opus audio file from Telegram
```

**TS-4.2: Audio transcribed via faster-whisper**
```
Scenario: Downloaded audio is sent to faster-whisper for transcription
  Given an authorized user
  And faster-whisper is running
  When the user sends a voice message
  Then the audio is sent to the faster-whisper container
  And a text transcript is returned
```

**TS-4.3: Transcribed text classified same as text messages**
```
Scenario: Voice transcript goes through the same classification pipeline
  Given an authorized user
  And faster-whisper returns "I need to call Maria about the budget"
  When the user sends a voice message
  Then the transcript is classified using the context-aware pipeline
  And an embedding is generated for the transcript
```

**TS-4.4: Entry stored with source_type 'voice'**
```
Scenario: Voice entry stored with correct source_type
  Given an authorized user
  And faster-whisper returns a transcript
  When a voice message is classified and stored
  Then the entry has source "telegram"
  And source_type "voice"
  And content equal to the transcribed text
```

**TS-4.5: High-confidence voice reply includes transcript**
```
Scenario: Confident voice reply shows transcript and classification
  Given an authorized user
  And the confidence threshold is 0.6
  When a voice message is transcribed as "Buy groceries" and classified as category "Tasks", name "Buy Groceries", confidence 0.90
  Then the bot replies "🎤 'Buy groceries'\n✅ Filed as Tasks → Buy Groceries (90%)"
```

**TS-4.6: Low-confidence voice reply includes transcript**
```
Scenario: Uncertain voice reply shows transcript and best-guess
  Given an authorized user
  And the confidence threshold is 0.6
  When a voice message is transcribed as "Something about the thing" and classified with confidence 0.30
  Then the bot replies starting with "🎤 'Something about the thing'\n❓ Best guess:"
```

**TS-4.7: Low-confidence voice entry gets inline buttons**
```
Scenario: Uncertain voice classification includes category buttons
  Given an authorized user
  When a voice message is classified with confidence below the threshold
  Then the reply includes inline keyboard with 5 category buttons
```

### US-5: Fix Command

**TS-5.1: /fix finds most recent entry by sender**
```
Scenario: /fix operates on the most recent Telegram entry from the sender
  Given an authorized user with chat ID 123456
  And 3 entries exist from this chat ID with source "telegram"
  When the user sends "/fix this should be a person"
  Then the most recently created entry from chat ID 123456 is selected
```

**TS-5.2: /fix correction text extracted after command**
```
Scenario: Correction text is everything after "/fix "
  Given an authorized user
  When the user sends "/fix this should be a person not a project"
  Then the correction text is "this should be a person not a project"
```

**TS-5.3: Entry re-classified with correction context**
```
Scenario: Re-classification uses original content and correction text
  Given the most recent entry has content "Discussed roadmap with the design team"
  When the user sends "/fix this should be a project not a person"
  Then Claude receives the original content and the correction text
  And the classification prompt includes the correction as additional context
```

**TS-5.4: All fields updated from re-classification**
```
Scenario: /fix updates category, name, fields, tags, and embedding
  Given the most recent entry has category "People" and name "Design Team"
  When the user sends "/fix this is a project" and Claude returns category "Projects", name "Roadmap Planning", confidence 0.88
  Then the entry's category is updated to "Projects"
  And the entry's name is updated to "Roadmap Planning"
  And the entry's fields are updated
  And the entry's tags are updated
  And the entry's embedding is re-generated
  And the entry's confidence is set to 0.88
```

**TS-5.5: /fix reply format**
```
Scenario: Successful /fix produces confirmation reply
  Given a successful re-classification to category "Projects", name "Roadmap Planning"
  When the /fix command completes
  Then the bot replies "✅ Fixed → Projects → Roadmap Planning"
```

**TS-5.6: No recent entry for sender**
```
Scenario: /fix with no previous entries from sender
  Given an authorized user with no entries from their chat ID
  When the user sends "/fix this should be a task"
  Then the bot replies "No recent entry to fix"
```

**TS-5.7: /fix without correction text**
```
Scenario: /fix with no text after the command
  Given an authorized user
  When the user sends "/fix"
  Then the bot replies "Usage: /fix <correction description>"
```

### US-6: Long-Polling Mode

**TS-6.1: Bot uses long-polling mode**
```
Scenario: Bot starts in long-polling mode
  Given TELEGRAM_BOT_TOKEN is configured
  When the bot starts
  Then grammY is started in long-polling mode
  And no webhook URL is registered
```

**TS-6.2: Automatic reconnection on network issues**
```
Scenario: grammY handles reconnection automatically
  Given the bot is running in long-polling mode
  When a network interruption occurs
  Then grammY's built-in retry mechanism handles reconnection
  And no custom reconnection logic is invoked
```

**TS-6.3: Bot starts in correct application sequence**
```
Scenario: Bot starts after migrations and server but does not block
  Given TELEGRAM_BOT_TOKEN is configured
  When the application starts
  Then the bot starts after DB migrations and server start
  And the web server is serving requests before or concurrently with bot startup
```

**TS-6.4: Missing bot token skips bot startup**
```
Scenario: Application continues without bot when token is missing
  Given TELEGRAM_BOT_TOKEN is not set
  When the application starts
  Then the bot does not start
  And a warning is logged
  And the web server starts normally
  And cron jobs start normally
```

## Edge Case Scenarios

### Database Failures

**TS-EC-1: DB unreachable during message processing**
```
Scenario: Database failure produces a user-friendly error reply
  Given an authorized user
  And PostgreSQL is unreachable
  When the user sends a text message
  Then the bot replies "System temporarily unavailable"
  And no entry is stored (no partial writes)
```

**TS-EC-2: DB failure does not crash the process**
```
Scenario: Database error is caught and does not crash the bot
  Given an authorized user
  And PostgreSQL throws a connection error during entry storage
  When the user sends a text message
  Then the bot replies with an error message
  And the bot continues polling for new messages
```

### Claude API Failures

**TS-EC-3: Claude API down during classification**
```
Scenario: API failure stores entry unclassified
  Given an authorized user
  And the Claude API returns an error
  When the user sends a text message
  Then the entry is stored with category null, confidence null, and fields {}
  And the bot replies "Stored but could not classify — will retry"
  And the entry is eligible for retry by the classification retry cron job
```

**TS-EC-4: Claude API returns malformed JSON**
```
Scenario: Malformed classification response treated as API failure
  Given an authorized user
  And the Claude API returns invalid JSON
  When the user sends a text message
  Then the entry is stored with category null, confidence null, and fields {}
  And the bot replies "Stored but could not classify — will retry"
```

### Ollama Failures

**TS-EC-6: Ollama down during embedding generation**
```
Scenario: Embedding failure stores entry with null embedding
  Given an authorized user
  And Ollama is unreachable
  And the Claude API is working (classification succeeds)
  When the user sends a text message
  Then the entry is stored with embedding null
  And classification proceeds normally
  And the bot replies with the classification result (no mention of embedding failure)
```

**TS-EC-7: Ollama down during context fetch**
```
Scenario: Semantic context unavailable degrades gracefully
  Given an authorized user
  And Ollama is unreachable for embedding generation (cannot compute similarity)
  When the user sends a text message
  Then classification proceeds with only the last 5 recent entries as context
  And no semantically similar entries are included
```

### faster-whisper Failures

**TS-EC-8: faster-whisper down during voice message**
```
Scenario: Transcription service unavailable produces error reply
  Given an authorized user
  And faster-whisper is unreachable
  When the user sends a voice message
  Then the bot replies "Could not transcribe voice message. Please send as text."
  And no entry is stored
```

**TS-EC-9: faster-whisper returns empty transcript**
```
Scenario: Empty transcript treated as transcription failure
  Given an authorized user
  And faster-whisper returns an empty string
  When the user sends a voice message
  Then the bot replies "Could not transcribe voice message. Please send as text."
  And no entry is stored
```

**TS-EC-10: Whitespace-only transcript**
```
Scenario: Whitespace-only transcript treated as failure
  Given an authorized user
  And faster-whisper returns "   \n  "
  When the user sends a voice message
  Then the bot replies "Could not transcribe voice message. Please send as text."
  And no entry is stored
```

### Input Validation

**TS-EC-11: Empty/whitespace text message**
```
Scenario: Whitespace-only message is ignored silently
  Given an authorized user
  When the user sends a message containing only whitespace
  Then no reply is sent
  And no entry is stored
```

**TS-EC-12: Very long text message**
```
Scenario: Messages over 4000 characters are classified normally
  Given an authorized user
  When the user sends a message with 5000 characters of text
  Then the full text is sent to the classification pipeline
  And the full text is stored as the entry's content
```

**TS-EC-13: Special characters and emoji only**
```
Scenario: Message of only emoji/special characters is classified normally
  Given an authorized user
  When the user sends "🎉🚀💡"
  Then the message is classified through the normal pipeline
  And the message is stored as the entry's content
```

### Fix Command Edge Cases

**TS-EC-14: /fix on entry already corrected via inline button**
```
Scenario: /fix works on previously button-corrected entry
  Given the most recent entry was already corrected via an inline category button
  When the user sends "/fix actually this is a task"
  Then the entry is re-classified again using the new correction text
  And the entry is updated with the new classification
```

**TS-EC-15: /fix on unclassified entry**
```
Scenario: /fix on null-category entry classifies it
  Given the most recent entry has category null (failed earlier classification)
  When the user sends "/fix this is a reference note"
  Then the entry is re-classified with the correction context
  And the entry's category, name, fields, tags, and embedding are updated
```

### Inline Correction Edge Cases

**TS-EC-16: Double-tap inline category button**
```
Scenario: Second button tap after correction is ignored
  Given a low-confidence entry that has already been corrected via button tap
  And the inline keyboard has been removed
  When a callback query arrives for the same entry
  Then the bot ignores the callback or responds with a brief acknowledgment
  And the entry is not re-processed
```

**TS-EC-17: Inline button on soft-deleted entry**
```
Scenario: Button tap on deleted entry is handled gracefully
  Given a low-confidence entry that has since been soft-deleted from the webapp
  When the user taps a category button for that entry
  Then the bot handles the callback gracefully (no crash)
  And an error or acknowledgment is shown to the user
```

**TS-EC-18: Inline button with non-existent entry ID**
```
Scenario: Callback data referencing missing entry does not crash
  Given callback data referencing an entry ID that does not exist in the database
  When the callback query is processed
  Then the bot ignores the callback gracefully
  And a warning is logged
  And the bot continues operating normally
```

### Unsupported Message Types

**TS-EC-19a: Photo message ignored**
```
Scenario: Photo message is ignored silently
  Given an authorized user
  When the user sends a photo
  Then no reply is sent
  And no entry is stored
```

**TS-EC-19b: Sticker message ignored**
```
Scenario: Sticker message is ignored silently
  Given an authorized user
  When the user sends a sticker
  Then no reply is sent
  And no entry is stored
```

**TS-EC-19c: Document message ignored**
```
Scenario: Document message is ignored silently
  Given an authorized user
  When the user sends a document
  Then no reply is sent
  And no entry is stored
```

### Calendar Edge Cases

**TS-EC-20: Calendar not configured**
```
Scenario: Calendar event silently skipped when not configured
  Given an authorized user
  And Google Calendar is not configured
  And classification returns create_calendar_event true
  When the user sends a text message
  Then no calendar event is created
  And the entry is stored normally
  And no error is surfaced to the user
```

**TS-EC-21: Calendar API failure**
```
Scenario: Calendar failure does not affect entry storage or reply
  Given an authorized user
  And Google Calendar is configured but the API call fails
  And classification returns create_calendar_event true
  When the user sends a text message
  Then the entry is stored normally
  And the bot replies with the classification result
  And the calendar failure is logged
```

### Concurrency

**TS-EC-22: Multiple authorized users sending simultaneously**
```
Scenario: Messages from different users are processed independently
  Given two authorized users with chat IDs 111 and 222
  When both users send a text message simultaneously
  Then each message is classified independently
  And each user receives their own reply
  And there is no cross-user interference in entries or replies
```

**TS-EC-23: Same user sends multiple messages rapidly**
```
Scenario: Rapid messages from same user are processed sequentially
  Given an authorized user
  When the user sends "Message A" followed immediately by "Message B"
  Then "Message A" is fully processed (classified, stored, replied) before "Message B"
  And each message gets its own classification, embedding, and reply
```

## Non-Goal Guard Scenarios

**TS-NG-1: Group chat messages ignored**
```
Scenario: Messages in group chats are not processed
  Given an authorized user
  When the user sends a message in a group chat (not a private chat)
  Then the message is ignored
  And no reply is sent
```

**TS-NG-2: No /start or /help command registration**
```
Scenario: Unrecognized commands are not handled
  Given an authorized user
  When the user sends "/start" or "/help"
  Then no specific command response is sent
  And the message is either ignored or treated as regular text
```

## Traceability

All 31 acceptance criteria from the behavioral specification are covered:

- **US-1 (AC-1.1 – AC-1.7):** 12 scenarios (TS-1.1 through TS-1.12)
- **US-2 (AC-2.1 – AC-2.4):** 8 scenarios (TS-2.1 through TS-2.8)
- **US-3 (AC-3.1 – AC-3.6):** 6 scenarios (TS-3.1 through TS-3.6)
- **US-4 (AC-4.1 – AC-4.6):** 7 scenarios (TS-4.1 through TS-4.7)
- **US-5 (AC-5.1 – AC-5.6):** 7 scenarios (TS-5.1 through TS-5.7)
- **US-6 (AC-6.1 – AC-6.4):** 4 scenarios (TS-6.1 through TS-6.4)
- **Edge cases:** 24 scenarios (TS-EC-1 through TS-EC-23; TS-EC-5 merged into TS-EC-3; TS-EC-19 split into 19a/19b/19c)
- **Non-goal guards:** 2 scenarios (TS-NG-1 through TS-NG-2)

**Total: 70 test scenarios** covering all acceptance criteria, constraints, edge cases, and non-goals.
