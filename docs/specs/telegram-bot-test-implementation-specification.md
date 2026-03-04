# Telegram Bot - Test Implementation Specification

| Field | Value |
|-------|-------|
| Feature | Telegram Bot |
| Phase | 3 — Test Implementation Specification |
| Date | 2026-03-04 |
| Status | Draft |
| Derives from | `docs/specs/telegram-bot-test-specification.md` |

## Test Framework & Conventions

| Aspect | Choice |
|--------|--------|
| Language | TypeScript |
| Test framework | Vitest |
| Assertion style | `expect()` from Vitest |
| Mocking | `vi.mock()` for module mocking, `vi.fn()` for function mocks, `vi.spyOn()` for spy/stub |
| Integration DB | `@testcontainers/postgresql` with `pgvector/pgvector:pg16` image |
| Telegram mocking | Fake grammY `Context` objects with stubbed methods (see `mock-telegram.ts` helper) |
| LLM mocking | Mock `src/classify.ts` exported functions via `vi.mock()` |
| Embedding mocking | Mock `src/embed.ts` exported functions via `vi.mock()` |
| Whisper mocking | Mock `globalThis.fetch` for faster-whisper HTTP calls |

**Conventions** (same as foundation, embedding, and classification):
- `describe` blocks group by user story / functional area
- `it` blocks describe the behavior, not the implementation
- One assertion theme per `it` block (one test scenario → one test function)
- Test names read as sentences: `it("ignores messages from unauthorized chat IDs")`
- Explicit imports: `import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"`

## Test Structure

```
tests/
├── unit/
│   └── telegram-bot.test.ts              # 47 scenarios — handler logic, formatting,
│                                          # authorization, error handling, input validation
├── integration/
│   └── telegram-bot-integration.test.ts  # 23 scenarios — full message flow with DB,
│                                          # entry storage, /fix DB lookups, corrections
└── helpers/
    ├── env.ts                            # (existing) Env var manipulation
    ├── test-db.ts                        # (existing) Testcontainers setup/teardown
    ├── mock-ollama.ts                    # (existing) Ollama HTTP mock helpers
    ├── mock-llm.ts                      # (existing) LLM classification mock helpers
    └── mock-telegram.ts                 # (new) grammY Context mocks + Telegram Update builders
```

**Unit vs integration split:**
- **Unit tests** (`telegram-bot.test.ts`): Test handler logic with all external dependencies mocked — no DB, no network. grammY context methods are stubs. Classification, embedding, and DB operations are mocked modules. **47 scenarios.**
- **Integration tests** (`telegram-bot-integration.test.ts`): Test full message-to-storage flows with real PostgreSQL via testcontainers. LLM, Ollama, and whisper remain mocked (no real API calls). Bot handlers interact with the real DB. **23 scenarios.**

## New Helper: Mock Telegram (`tests/helpers/mock-telegram.ts`)

```typescript
import { vi } from "vitest";

/**
 * Options for creating a mock grammY Context.
 */
interface MockContextOptions {
  chatId?: number;
  chatType?: "private" | "group" | "supergroup" | "channel";
  messageId?: number;
  text?: string;
  voice?: { file_id: string; duration: number };
  photo?: boolean;       // true = message has photo
  sticker?: boolean;     // true = message has sticker
  document?: boolean;    // true = message has document
  callbackData?: string;
  callbackMessageId?: number;
}

/**
 * Result of creating a mock context — the context object plus
 * references to individual mock functions for easy assertion.
 */
interface MockContextResult {
  ctx: Record<string, unknown>;  // grammY-compatible Context shape
  mocks: {
    reply: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    getFile: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create a mock grammY Context for unit testing bot handlers.
 *
 * Returns an object with ctx (the fake context) and mocks (references
 * to stubbed methods for assertion). Defaults to a private-chat text
 * message from chat ID 123456.
 */
export function createMockContext(options?: MockContextOptions): MockContextResult;

/**
 * Create a Telegram Update object suitable for bot.handleUpdate().
 * Used in integration tests to simulate incoming messages.
 */
export function createTextUpdate(chatId: number, text: string, messageId?: number): object;
export function createVoiceUpdate(chatId: number, fileId: string, duration: number, messageId?: number): object;
export function createCallbackUpdate(chatId: number, data: string, messageId: number): object;
export function createCommandUpdate(chatId: number, command: string, args?: string): object;
export function createPhotoUpdate(chatId: number): object;
export function createStickerUpdate(chatId: number): object;
export function createDocumentUpdate(chatId: number): object;
export function createGroupTextUpdate(chatId: number, text: string): object;
```

**Default mock context:**
```typescript
{
  chatId: 123456,
  chatType: "private",
  messageId: 1,
  text: "Test message",
}
```

The `reply` mock resolves to `{ message_id: 100 }` by default (needed for tracking the reply message ID when editing later). The `getFile` mock resolves to `{ file_path: "voice/file_0.oga" }`.

## Mocking Strategy

### grammY Context (Unit Tests)

Unit tests call handler functions directly with a fake context. The mock context has:
- `ctx.message.chat.id` — chat ID for authorization
- `ctx.message.chat.type` — "private" or "group"
- `ctx.message.text` — message text (text messages)
- `ctx.message.voice` — voice object with `file_id` (voice messages)
- `ctx.callbackQuery.data` — callback data string (inline button taps)
- `ctx.reply(text, options?)` — `vi.fn()` stub
- `ctx.editMessageText(text, options?)` — `vi.fn()` stub
- `ctx.answerCallbackQuery(text?)` — `vi.fn()` stub
- `ctx.getFile()` — `vi.fn()` stub returning `{ file_path: "..." }`

### grammY Bot (Integration Tests)

Integration tests create a real `Bot` instance (with a fake token), register the actual handlers, then call `bot.handleUpdate(update)` with constructed Update objects. The bot's outgoing API calls (sendMessage, editMessageText, etc.) are intercepted by mocking `bot.api`:

```typescript
const bot = createBot("fake-token:abc123");
// Override API methods to capture outgoing calls
bot.api.config.use((prev, method, payload) => {
  apiCalls.push({ method, payload });
  return { ok: true, result: buildFakeResult(method) };
});
```

This captures all outgoing Telegram API calls for assertion without making real HTTP requests.

### Classification (`src/classify.ts`)

The bot calls classification functions. In unit tests, the entire module is mocked:

```typescript
vi.mock("../../src/classify.js", () => ({
  classifyText: vi.fn(),
  reclassifyEntry: vi.fn(),
  assembleContext: vi.fn(),
  isConfident: vi.fn(),
}));
```

Each test configures what `classifyText` returns (success or error). Integration tests also mock the LLM provider within classify but let the DB operations run for real.

### Embedding (`src/embed.ts`)

```typescript
vi.mock("../../src/embed.js", () => ({
  generateEmbedding: vi.fn(),
  embedEntry: vi.fn(),
}));
```

Unit tests control whether embedding succeeds or fails. Integration tests use the mock `generateEmbedding` from `mock-ollama.ts` (returns deterministic fake embeddings).

### Database Operations

Unit tests mock the DB layer entirely — the handler functions receive a mock `sql` object or the DB module is mocked. Integration tests use a real testcontainers PostgreSQL instance.

### faster-whisper (Whisper Transcription)

Voice message transcription calls faster-whisper via HTTP. Mocked using `vi.spyOn(globalThis, "fetch")`:

```typescript
// Successful transcription
fetchSpy.mockResolvedValueOnce(
  new Response(JSON.stringify({ text: "Buy groceries for the weekend" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
);

// Whisper down
fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

// Empty transcript
fetchSpy.mockResolvedValueOnce(
  new Response(JSON.stringify({ text: "" }), { status: 200 })
);
```

**Note:** When mocking `globalThis.fetch`, care must be taken to route the right mock to the right call. The bot may call fetch for both Telegram file download and whisper transcription. Use `mockImplementation` with URL-based routing (similar to `createOllamaRouter` in `mock-ollama.ts`):

```typescript
fetchSpy.mockImplementation(async (url: string | URL | Request) => {
  const urlStr = url.toString();
  if (urlStr.includes("api.telegram.org/file")) {
    return new Response(Buffer.from("fake-audio-data"), { status: 200 });
  }
  if (urlStr.includes("whisper") || urlStr.includes(":8000")) {
    return new Response(JSON.stringify({ text: transcriptText }), { status: 200 });
  }
  throw new Error(`Unexpected fetch URL: ${urlStr}`);
});
```

### Chat ID Authorization

The bot resolves authorized chat IDs from the settings table (key `telegram_chat_ids`, JSON array) with fallback to `TELEGRAM_CHAT_ID` env var. In unit tests:
- Mock the settings resolution function or the DB query
- Use `withEnv()` from `tests/helpers/env.ts` for env var scenarios

In integration tests:
- Insert rows into the real settings table
- Set env vars with `withEnv()`

### Log Capture

Same as previous features: `vi.spyOn(process.stdout, "write")` to capture structured JSON log output for assertions on warnings and errors.

## Test Scenario Mapping

### Unit Tests — Bot Handlers (`tests/unit/telegram-bot.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-1.1 | `it("accepts messages from chat IDs listed in the settings table")` | `telegram-bot.test.ts` |
| TS-1.2 | `it("accepts messages from chat IDs in the env var when no setting exists")` | `telegram-bot.test.ts` |
| TS-1.3 | `it("accepts messages from any chat ID in a comma-separated env var list")` | `telegram-bot.test.ts` |
| TS-1.12 | `it("accepts messages from any chat ID in the settings table JSON array")` | `telegram-bot.test.ts` |
| TS-1.4 | `it("ignores messages from unauthorized chat IDs without replying")` | `telegram-bot.test.ts` |
| TS-1.5 | `it("uses settings table chat IDs and ignores env var when both are set")` | `telegram-bot.test.ts` |
| TS-2.1 | `it("replies with high-confidence format when confidence >= threshold")` | `telegram-bot.test.ts` |
| TS-2.2 | `it("replies with low-confidence format when confidence < threshold")` | `telegram-bot.test.ts` |
| TS-2.3 | `it("displays confidence as a whole-number percentage")` | `telegram-bot.test.ts` |
| TS-2.4 | `it("includes an inline keyboard with 5 category buttons on low-confidence replies")` | `telegram-bot.test.ts` |
| TS-2.5 | `it("includes entry ID and category in each button callback data")` | `telegram-bot.test.ts` |
| TS-2.6 | `it("does not include an inline keyboard on high-confidence replies")` | `telegram-bot.test.ts` |
| TS-2.7 | `it("uses the custom confidence threshold from the settings table")` | `telegram-bot.test.ts` |
| TS-2.8 | `it("treats confidence exactly at the threshold as high-confidence")` | `telegram-bot.test.ts` |
| TS-3.4 | `it("edits the original reply message in-place after category correction")` | `telegram-bot.test.ts` |
| TS-3.5 | `it("removes the inline keyboard from the message after correction")` | `telegram-bot.test.ts` |
| TS-3.6 | `it("sets confidence to null after manual category correction")` | `telegram-bot.test.ts` |
| TS-4.5 | `it("includes the transcript in high-confidence voice replies")` | `telegram-bot.test.ts` |
| TS-4.6 | `it("includes the transcript in low-confidence voice replies")` | `telegram-bot.test.ts` |
| TS-4.7 | `it("attaches inline keyboard to low-confidence voice replies")` | `telegram-bot.test.ts` |
| TS-5.2 | `it("extracts correction text from everything after /fix")` | `telegram-bot.test.ts` |
| TS-5.5 | `it("replies with fixed confirmation after successful /fix")` | `telegram-bot.test.ts` |
| TS-5.6 | `it("replies with error when /fix finds no recent entry")` | `telegram-bot.test.ts` |
| TS-5.7 | `it("replies with usage hint when /fix has no correction text")` | `telegram-bot.test.ts` |
| TS-6.1 | `it("starts the bot in long-polling mode")` | `telegram-bot.test.ts` |
| TS-6.2 | `it("relies on grammY built-in reconnection with no custom logic")` | `telegram-bot.test.ts` |
| TS-6.4 | `it("skips bot startup and logs a warning when TELEGRAM_BOT_TOKEN is missing")` | `telegram-bot.test.ts` |
| TS-EC-1 | `it("replies 'System temporarily unavailable' when the database is unreachable")` | `telegram-bot.test.ts` |
| TS-EC-2 | `it("continues polling after a database error in a message handler")` | `telegram-bot.test.ts` |
| TS-EC-3 | `it("stores entry unclassified and replies with retry message on Claude API failure")` | `telegram-bot.test.ts` |
| TS-EC-4 | `it("treats malformed Claude JSON as classification failure")` | `telegram-bot.test.ts` |
| TS-EC-6 | `it("stores entry with null embedding when Ollama is down")` | `telegram-bot.test.ts` |
| TS-EC-7 | `it("classifies with only recent entries when Ollama is down for context fetch")` | `telegram-bot.test.ts` |
| TS-EC-8 | `it("replies with transcription error when faster-whisper is down")` | `telegram-bot.test.ts` |
| TS-EC-9 | `it("treats an empty transcript as transcription failure")` | `telegram-bot.test.ts` |
| TS-EC-10 | `it("treats a whitespace-only transcript as transcription failure")` | `telegram-bot.test.ts` |
| TS-EC-11 | `it("ignores whitespace-only text messages silently")` | `telegram-bot.test.ts` |
| TS-EC-12 | `it("classifies messages over 4000 characters normally")` | `telegram-bot.test.ts` |
| TS-EC-13 | `it("classifies emoji-only messages normally")` | `telegram-bot.test.ts` |
| TS-EC-16 | `it("ignores callback queries for already-corrected entries")` | `telegram-bot.test.ts` |
| TS-EC-17 | `it("handles callback queries for soft-deleted entries gracefully")` | `telegram-bot.test.ts` |
| TS-EC-18 | `it("handles callback queries for non-existent entry IDs gracefully")` | `telegram-bot.test.ts` |
| TS-EC-19a | `it("ignores photo messages silently")` | `telegram-bot.test.ts` |
| TS-EC-19b | `it("ignores sticker messages silently")` | `telegram-bot.test.ts` |
| TS-EC-19c | `it("ignores document messages silently")` | `telegram-bot.test.ts` |
| TS-NG-1 | `it("ignores messages from group chats")` | `telegram-bot.test.ts` |
| TS-NG-2 | `it("does not handle /start or /help as special commands")` | `telegram-bot.test.ts` |

---

#### describe("authorization")

**TS-1.1: Accepts messages from chat IDs in settings table**

- **Setup (Given):** Mock the authorized chat ID resolver to return `["123456"]` (from settings). Create a mock context with `chatId: 123456`. Mock `classifyText` to return a valid result.
- **Action (When):** Call the text message handler with the mock context.
- **Assertion (Then):** `ctx.reply` was called (message was processed). The classification pipeline was invoked.
- **Teardown:** Restore mocks.

**TS-1.2: Accepts messages from chat IDs in env var fallback**

- **Setup (Given):** Mock the authorized chat ID resolver to return `["123456"]` (from env var). Use `withEnv({ TELEGRAM_CHAT_ID: "123456" })`. Create mock context with `chatId: 123456`.
- **Action (When):** Call the text message handler with the mock context.
- **Assertion (Then):** `ctx.reply` was called.
- **Teardown:** Restore mocks and env.

**TS-1.3: Accepts any chat ID from comma-separated env var**

- **Setup (Given):** Mock the authorized chat ID resolver to return `["111", "222", "333"]`. Create mock context with `chatId: 222`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called.
- **Teardown:** Restore mocks.

**TS-1.12: Accepts any chat ID from settings table JSON array**

- **Setup (Given):** Mock the authorized chat ID resolver to return `["111", "222", "333"]` (from settings table JSON array). Create mock context with `chatId: 222`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called.
- **Teardown:** Restore mocks.

**TS-1.4: Ignores messages from unauthorized chat IDs**

- **Setup (Given):** Mock the authorized chat ID resolver to return `["123456"]`. Create mock context with `chatId: 999999`. Spy on `process.stdout.write`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was NOT called. No classification pipeline function was called. Stdout does NOT contain the message content from the unauthorized user.
- **Teardown:** Restore mocks and spy.

**TS-1.5: Settings table overrides env var for authorization**

- **Setup (Given):** Mock the authorized chat ID resolver to return `["111"]` (settings table result). Use `withEnv({ TELEGRAM_CHAT_ID: "222" })`. Create mock context with `chatId: 222`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was NOT called (222 not in settings table list, even though it's in env var).
- **Teardown:** Restore mocks and env.

#### describe("reply formatting — text messages")

**TS-2.1: High-confidence reply format**

- **Setup (Given):** Mock `classifyText` to return `{ category: "People", name: "Sarah", confidence: 0.85 }`. Mock confidence threshold as `0.6`. Create mock context with a text message.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called with first argument `"✅ Filed as People → Sarah (85%) — reply /fix to correct"`.
- **Teardown:** Restore mocks.

**TS-2.2: Low-confidence reply format**

- **Setup (Given):** Mock `classifyText` to return `{ category: "Ideas", name: "Unnamed", confidence: 0.45 }`. Threshold `0.6`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called with first argument containing `"❓ Best guess: Ideas → Unnamed (45%)"`.
- **Teardown:** Restore mocks.

**TS-2.3: Confidence displayed as percentage**

- **Setup (Given):** Mock `classifyText` to return `{ confidence: 0.73 }`. Threshold `0.6`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** The reply text contains `"73%"` (not `"0.73"`).
- **Teardown:** Restore mocks.

**TS-2.7: Custom threshold from settings**

- **Setup (Given):** Mock confidence threshold resolution to return `0.8`. Mock `classifyText` to return `{ confidence: 0.75 }`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called with the low-confidence format (`"❓ Best guess:"`). An inline keyboard is attached.
- **Teardown:** Restore mocks.

**TS-2.8: Confidence exactly at threshold**

- **Setup (Given):** Mock confidence threshold as `0.6`. Mock `classifyText` to return `{ confidence: 0.60 }`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called with the high-confidence format (`"✅ Filed as"`). No inline keyboard.
- **Teardown:** Restore mocks.

#### describe("inline keyboard")

**TS-2.4: Low-confidence reply includes 5 category buttons**

- **Setup (Given):** Mock `classifyText` to return `{ confidence: 0.40 }`. Threshold `0.6`. Mock entry storage to return `{ id: "uuid-42" }`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called with a second argument containing `reply_markup` with an inline keyboard. The keyboard has exactly 5 buttons with labels `"People"`, `"Projects"`, `"Tasks"`, `"Ideas"`, `"Reference"`.
- **Teardown:** Restore mocks.

**TS-2.5: Button callback data includes entry ID and category**

- **Setup (Given):** Same as TS-2.4. Entry ID is `"uuid-42"`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Each button's `callback_data` contains the entry ID and the category. For example, the "People" button has callback data like `"correct:uuid-42:people"`.
- **Teardown:** Restore mocks.

**TS-2.6: High-confidence reply has no inline keyboard**

- **Setup (Given):** Mock `classifyText` to return `{ confidence: 0.80 }`. Threshold `0.6`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called. The second argument does not contain `reply_markup` with an inline keyboard (or `reply_markup` is absent).
- **Teardown:** Restore mocks.

#### describe("inline category correction")

**TS-3.4: Edits original reply in-place**

- **Setup (Given):** Create mock context with `callbackData: "correct:uuid-42:tasks"` and `callbackMessageId: 100`. Mock DB lookup to return the entry. Mock re-classification to return `{ category: "Tasks", name: "Buy Groceries" }`. Mock re-embedding to succeed.
- **Action (When):** Call the callback query handler.
- **Assertion (Then):** `ctx.editMessageText` was called with `"✅ Fixed → Tasks → Buy Groceries"`. `ctx.reply` was NOT called (no new message).
- **Teardown:** Restore mocks.

**TS-3.5: Inline keyboard removed after correction**

- **Setup (Given):** Same as TS-3.4.
- **Action (When):** Call the callback query handler.
- **Assertion (Then):** `ctx.editMessageText` was called with options that set `reply_markup` to `undefined` or an empty inline keyboard (removing the buttons).
- **Teardown:** Restore mocks.

**TS-3.6: Confidence set to null after manual correction**

- **Setup (Given):** Same as TS-3.4. Capture the DB update call arguments.
- **Action (When):** Call the callback query handler.
- **Assertion (Then):** The DB update function was called with `confidence: null` for the corrected entry.
- **Teardown:** Restore mocks.

#### describe("voice reply formatting")

**TS-4.5: High-confidence voice reply includes transcript**

- **Setup (Given):** Mock whisper fetch to return `{ text: "Buy groceries" }`. Mock classification to return `{ category: "Tasks", name: "Buy Groceries", confidence: 0.90 }`. Threshold `0.6`. Create mock context with a voice message.
- **Action (When):** Call the voice message handler.
- **Assertion (Then):** `ctx.reply` was called with `"🎤 'Buy groceries'\n✅ Filed as Tasks → Buy Groceries (90%)"`. Note: no "— reply /fix to correct" suffix (per spec AC-4.5).
- **Teardown:** Restore mocks.

**TS-4.6: Low-confidence voice reply includes transcript**

- **Setup (Given):** Mock whisper to return `{ text: "Something about the thing" }`. Mock classification to return `{ confidence: 0.30 }`. Threshold `0.6`.
- **Action (When):** Call the voice message handler.
- **Assertion (Then):** `ctx.reply` first argument starts with `"🎤 'Something about the thing'\n❓ Best guess:"`.
- **Teardown:** Restore mocks.

**TS-4.7: Low-confidence voice gets inline buttons**

- **Setup (Given):** Same as TS-4.6.
- **Action (When):** Call the voice message handler.
- **Assertion (Then):** `ctx.reply` was called with `reply_markup` containing an inline keyboard with 5 category buttons.
- **Teardown:** Restore mocks.

#### describe("/fix command")

**TS-5.2: Correction text extracted after /fix**

- **Setup (Given):** Create mock context with `text: "/fix this should be a person not a project"`. Mock DB to return a recent entry. Mock re-classification.
- **Action (When):** Call the /fix handler.
- **Assertion (Then):** The re-classification function was called with correction text `"this should be a person not a project"`.
- **Teardown:** Restore mocks.

**TS-5.5: Successful /fix reply format**

- **Setup (Given):** Mock DB to return a recent entry. Mock re-classification to return `{ category: "Projects", name: "Roadmap Planning" }`.
- **Action (When):** Call the /fix handler with `/fix this is a project`.
- **Assertion (Then):** `ctx.reply` was called with `"✅ Fixed → Projects → Roadmap Planning"`.
- **Teardown:** Restore mocks.

**TS-5.6: No recent entry for sender**

- **Setup (Given):** Mock DB to return `null` (no entries from this chat ID).
- **Action (When):** Call the /fix handler with `/fix this should be a task`.
- **Assertion (Then):** `ctx.reply` was called with `"No recent entry to fix"`.
- **Teardown:** Restore mocks.

**TS-5.7: /fix without correction text**

- **Setup (Given):** Create mock context with `text: "/fix"` (no text after the command).
- **Action (When):** Call the /fix handler.
- **Assertion (Then):** `ctx.reply` was called with `"Usage: /fix <correction description>"`.
- **Teardown:** Restore mocks.

#### describe("startup")

**TS-6.1: Bot starts in long-polling mode**

- **Setup (Given):** Set `TELEGRAM_BOT_TOKEN` via `withEnv()`. Mock grammY `Bot` constructor and `bot.start()`.
- **Action (When):** Call the bot startup function.
- **Assertion (Then):** `bot.start()` was called (long-polling mode). No `bot.api.setWebhook()` call was made.
- **Teardown:** Restore mocks and env.

**TS-6.2: Relies on grammY built-in reconnection**

- **Setup (Given):** Inspect the bot module source code or startup function.
- **Action (When):** Check the bot configuration.
- **Assertion (Then):** No custom reconnection logic exists (no setInterval/setTimeout for reconnection). The bot uses `bot.start()` which includes grammY's built-in retry.
- **Teardown:** None.

**TS-6.4: Missing bot token skips startup**

- **Setup (Given):** Use `withEnv({ TELEGRAM_BOT_TOKEN: "" })` or unset the token. Spy on `process.stdout.write`.
- **Action (When):** Call the bot startup function.
- **Assertion (Then):** No `Bot` instance is created. Stdout contains a JSON log entry with `level: "warn"` mentioning the missing token. The function returns without throwing.
- **Teardown:** Restore env and spy.

#### describe("error handling")

**TS-EC-1: DB unreachable → "System temporarily unavailable"**

- **Setup (Given):** Mock the DB/storage operation to throw a connection error. Create mock context with a text message.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was called with `"System temporarily unavailable"`. No entry was stored (storage mock was not reached or failed before commit).
- **Teardown:** Restore mocks.

**TS-EC-2: DB error does not crash the bot**

- **Setup (Given):** Mock storage to throw. Create mock context.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** The handler function resolves (does not throw). If testing via the Bot's error handler: the bot's `catch` handler was invoked, and the bot remains in a state where it can process the next message.
- **Teardown:** Restore mocks.

**TS-EC-3: Claude API failure → stored unclassified**

- **Setup (Given):** Mock `classifyText` to return `null` (classification failure). Mock entry storage to succeed.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Entry was stored with `category: null`, `confidence: null`, `fields: {}`. `ctx.reply` was called with `"Stored but could not classify — will retry"`.
- **Teardown:** Restore mocks.

**TS-EC-4: Malformed Claude JSON → stored unclassified**

- **Setup (Given):** Same as TS-EC-3 (classification returns null when JSON is malformed).
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Same assertions as TS-EC-3.
- **Teardown:** Restore mocks.

**TS-EC-6: Ollama down → entry stored with null embedding**

- **Setup (Given):** Mock `classifyText` to return a valid result. Mock `generateEmbedding` / `embedEntry` to return `null` (Ollama failure).
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Entry was stored with `embedding: null`. The reply contains the classification result (normal reply, no mention of embedding failure).
- **Teardown:** Restore mocks.

**TS-EC-7: Ollama down for context fetch → degraded classification**

- **Setup (Given):** Mock the context assembly function to indicate that semantic search failed (returns only recent entries, no similar entries).
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Classification proceeds. The context sent to the LLM contains only recent entries (no semantically similar entries). A valid classification result is produced.
- **Teardown:** Restore mocks.

**TS-EC-8: faster-whisper down → error reply, no storage**

- **Setup (Given):** Mock fetch to throw `TypeError("fetch failed")` for the whisper URL. Create mock context with a voice message.
- **Action (When):** Call the voice message handler.
- **Assertion (Then):** `ctx.reply` was called with `"Could not transcribe voice message. Please send as text."`. No entry was stored (storage mock not called).
- **Teardown:** Restore mocks.

**TS-EC-9: Empty transcript → treated as failure**

- **Setup (Given):** Mock fetch to return `{ text: "" }` from whisper. Create voice context.
- **Action (When):** Call the voice message handler.
- **Assertion (Then):** `ctx.reply` was called with `"Could not transcribe voice message. Please send as text."`. No entry stored.
- **Teardown:** Restore mocks.

**TS-EC-10: Whitespace-only transcript → treated as failure**

- **Setup (Given):** Mock fetch to return `{ text: "   \n  " }` from whisper. Create voice context.
- **Action (When):** Call the voice message handler.
- **Assertion (Then):** Same as TS-EC-9.
- **Teardown:** Restore mocks.

#### describe("input validation")

**TS-EC-11: Whitespace-only text message ignored**

- **Setup (Given):** Create mock context with `text: "   \n  "`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was NOT called. No entry stored. No classification invoked.
- **Teardown:** Restore mocks.

**TS-EC-12: Very long message classified normally**

- **Setup (Given):** Create mock context with `text` of 5000 characters. Mock classification to succeed.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Classification was called with the full text. Entry storage was called with the full text as content.
- **Teardown:** Restore mocks.

**TS-EC-13: Emoji-only message classified normally**

- **Setup (Given):** Create mock context with `text: "🎉🚀💡"`. Mock classification to succeed.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** Classification was called with `"🎉🚀💡"`. Entry was stored normally.
- **Teardown:** Restore mocks.

#### describe("callback edge cases")

**TS-EC-16: Double-tap on already-corrected entry**

- **Setup (Given):** Create callback context with `data: "correct:uuid-42:tasks"`. Mock DB to return entry that already has `confidence: null` (previously corrected — inline keyboard already removed).
- **Action (When):** Call the callback query handler.
- **Assertion (Then):** `ctx.answerCallbackQuery` is called (acknowledge the tap). Entry is NOT re-processed (no re-classification, no DB update). Or the handler detects the entry was already corrected and responds with a brief acknowledgment.
- **Teardown:** Restore mocks.

**TS-EC-17: Button tap on soft-deleted entry**

- **Setup (Given):** Create callback context. Mock DB to return entry with `deleted_at` set (soft-deleted).
- **Action (When):** Call the callback query handler.
- **Assertion (Then):** The handler does not crash. `ctx.answerCallbackQuery` is called. No DB update. No unhandled exception.
- **Teardown:** Restore mocks.

**TS-EC-18: Callback with non-existent entry ID**

- **Setup (Given):** Create callback context with `data: "correct:nonexistent-id:tasks"`. Mock DB to return `null`.
- **Action (When):** Call the callback query handler.
- **Assertion (Then):** No crash. Stdout contains a log entry with `level: "warn"`. `ctx.answerCallbackQuery` is called. The bot continues operating.
- **Teardown:** Restore mocks.

#### describe("unsupported message types")

**TS-EC-19a: Photo message ignored**

- **Setup (Given):** Create mock context with `photo: true`, no `text`. Authorized chat ID.
- **Action (When):** Call the message handler (or bot processes the update).
- **Assertion (Then):** `ctx.reply` was NOT called. No entry stored.
- **Teardown:** Restore mocks.

**TS-EC-19b: Sticker message ignored**

- **Setup (Given):** Create mock context with `sticker: true`, no `text`. Authorized chat ID.
- **Action (When):** Call the message handler.
- **Assertion (Then):** `ctx.reply` was NOT called. No entry stored.
- **Teardown:** Restore mocks.

**TS-EC-19c: Document message ignored**

- **Setup (Given):** Create mock context with `document: true`, no `text`. Authorized chat ID.
- **Action (When):** Call the message handler.
- **Assertion (Then):** `ctx.reply` was NOT called. No entry stored.
- **Teardown:** Restore mocks.

#### describe("non-goals")

**TS-NG-1: Group chat messages ignored**

- **Setup (Given):** Create mock context with `chatType: "group"`, `chatId: 123456` (an authorized ID). Text: `"Hello"`.
- **Action (When):** Call the text message handler.
- **Assertion (Then):** `ctx.reply` was NOT called. No entry stored. The message is ignored even though the chat ID is authorized.
- **Teardown:** Restore mocks.

**TS-NG-2: No /start or /help handling**

- **Setup (Given):** Create mock context with `text: "/start"`. Authorized chat ID.
- **Action (When):** Call the message handler.
- **Assertion (Then):** No specific command response is sent. Either `ctx.reply` is not called, or the message is treated as regular text (classified as normal text).
- **Teardown:** Restore mocks.

---

### Integration Tests — Full Flow with DB (`tests/integration/telegram-bot-integration.test.ts`)

| Test Scenario | Test Function | File |
|---------------|---------------|------|
| TS-1.6 | `it("classifies text messages with recent and similar context from the database")` | `telegram-bot-integration.test.ts` |
| TS-1.7 | `it("deduplicates context entries appearing in both recent and similar results")` | `telegram-bot-integration.test.ts` |
| TS-1.8 | `it("generates and stores an embedding for the message text")` | `telegram-bot-integration.test.ts` |
| TS-1.9 | `it("stores the entry with correct source, source_type, content, and classification fields")` | `telegram-bot-integration.test.ts` |
| TS-1.10 | `it("triggers calendar event creation when classification indicates it")` | `telegram-bot-integration.test.ts` |
| TS-1.11 | `it("does not persist calendar fields in the database entry")` | `telegram-bot-integration.test.ts` |
| TS-3.1 | `it("updates the entry category in the database on button tap")` | `telegram-bot-integration.test.ts` |
| TS-3.2 | `it("re-generates category-specific fields via Claude after correction")` | `telegram-bot-integration.test.ts` |
| TS-3.3 | `it("re-generates the embedding after category correction")` | `telegram-bot-integration.test.ts` |
| TS-4.1 | `it("downloads the voice audio file from Telegram")` | `telegram-bot-integration.test.ts` |
| TS-4.2 | `it("sends the downloaded audio to faster-whisper for transcription")` | `telegram-bot-integration.test.ts` |
| TS-4.3 | `it("classifies the transcribed voice text through the full pipeline")` | `telegram-bot-integration.test.ts` |
| TS-4.4 | `it("stores voice entries with source_type voice and transcribed content")` | `telegram-bot-integration.test.ts` |
| TS-5.1 | `it("finds the most recent telegram entry from the sender by chat ID")` | `telegram-bot-integration.test.ts` |
| TS-5.3 | `it("re-classifies the entry using original content plus correction text")` | `telegram-bot-integration.test.ts` |
| TS-5.4 | `it("updates category, name, fields, tags, embedding, and confidence after /fix")` | `telegram-bot-integration.test.ts` |
| TS-6.3 | `it("starts the bot after DB migrations and server start without blocking")` | `telegram-bot-integration.test.ts` |
| TS-EC-14 | `it("allows /fix on an entry already corrected via inline button")` | `telegram-bot-integration.test.ts` |
| TS-EC-15 | `it("allows /fix to classify a previously unclassified entry")` | `telegram-bot-integration.test.ts` |
| TS-EC-20 | `it("silently skips calendar event when Google Calendar is not configured")` | `telegram-bot-integration.test.ts` |
| TS-EC-21 | `it("stores the entry normally even when the calendar API fails")` | `telegram-bot-integration.test.ts` |
| TS-EC-22 | `it("processes messages from different users independently")` | `telegram-bot-integration.test.ts` |
| TS-EC-23 | `it("processes rapid messages from the same user sequentially")` | `telegram-bot-integration.test.ts` |

All integration tests share a single testcontainers PostgreSQL instance (started in `beforeAll`, stopped in `afterAll`). Migrations run once. LLM provider, Ollama, and faster-whisper are mocked. Entry rows are cleaned in `afterEach`.

---

#### describe("text message flow")

**TS-1.6: Classifies with context from DB**

- **Setup (Given):** Insert 7 entries into the DB with varied `created_at` timestamps and embeddings. Mock `generateEmbedding` to return a fake embedding for the input text. Mock LLM `chat` to return valid classification JSON. Insert a settings row with `telegram_chat_ids: ["123456"]`.
- **Action (When):** Process a text update from chat ID 123456 with text `"Met with Sarah about the marketing project"`.
- **Assertion (Then):** The LLM `chat` function was called with a prompt that includes context entries. The 5 most recent entries and up to 3 semantically similar entries appear in the prompt. A new entry is created in the DB.
- **Teardown:** Delete test entries and settings.

**TS-1.7: Deduplicates context entries**

- **Setup (Given):** Insert 5 entries. Ensure one entry is both among the 5 most recent and semantically similar (give it a recent `created_at` and an embedding close to the input). Mock `generateEmbedding`. Mock LLM `chat`, capturing the prompt.
- **Action (When):** Process a text update.
- **Assertion (Then):** The prompt sent to the LLM contains the overlapping entry exactly once.
- **Teardown:** Delete test entries.

**TS-1.8: Embedding generated and stored**

- **Setup (Given):** Mock `generateEmbedding` to return `createFakeEmbedding(1024)`. Mock LLM to return valid classification JSON.
- **Action (When):** Process a text update with `"New project idea"`.
- **Assertion (Then):** Query the new entry from DB. It has a non-null `embedding` column with 1024 dimensions.
- **Teardown:** Delete test entries.

**TS-1.9: Entry stored with correct fields**

- **Setup (Given):** Mock LLM to return `createClassificationJSON({ category: "projects", name: "Recipe Tracker", confidence: 0.92, fields: { status: "idea" }, tags: ["cooking", "side-project"] })`. Mock `generateEmbedding`.
- **Action (When):** Process a text update with `"Build a recipe tracker app"`.
- **Assertion (Then):** Query the new entry from DB:
  - `source` = `"telegram"`
  - `source_type` = `"text"`
  - `content` = `"Build a recipe tracker app"`
  - `category` = `"projects"`
  - `name` = `"Recipe Tracker"`
  - `confidence` = `0.92`
  - `fields` contains `{ status: "idea" }`
  - `tags` contains `["cooking", "side-project"]`
- **Teardown:** Delete test entries.

**TS-1.10: Calendar event triggered**

- **Setup (Given):** Mock LLM to return classification with `create_calendar_event: true, calendar_date: "2026-03-10"`. Mock a calendar service function. Mock `generateEmbedding`.
- **Action (When):** Process a text update.
- **Assertion (Then):** The calendar service function was called with date `"2026-03-10"`. The entry was stored in the DB.
- **Teardown:** Delete test entries. Restore mocks.

**TS-1.11: Calendar fields not persisted**

- **Setup (Given):** Same as TS-1.10.
- **Action (When):** Process a text update. Query the new entry from DB.
- **Assertion (Then):** The entry row does not have `create_calendar_event` or `calendar_date` columns/fields. These values exist only in the classification result, not in the database.
- **Teardown:** Delete test entries.

#### describe("inline category correction — DB")

**TS-3.1: Category updated in DB**

- **Setup (Given):** Insert an entry with `category: "ideas"`, `confidence: 0.35`, `name: "Vague Thought"`. Mock LLM to return re-classification with `category: "projects"`, `name: "New Initiative"`. Mock `generateEmbedding`.
- **Action (When):** Process a callback update with `data: "correct:{entryId}:projects"`.
- **Assertion (Then):** Query the entry from DB. `category` = `"projects"`.
- **Teardown:** Delete test entries.

**TS-3.2: Fields re-generated for new category**

- **Setup (Given):** Insert an entry with `category: "ideas"`, `fields: { description: "vague" }`. Mock LLM to return `fields: { status: "planning", owner: "me" }` for the "projects" category.
- **Action (When):** Process a callback update selecting "projects".
- **Assertion (Then):** Query the entry. `fields` now contains `{ status: "planning", owner: "me" }` (the new category-specific fields). The old "ideas" fields are replaced.
- **Teardown:** Delete test entries.

**TS-3.3: Embedding re-generated after correction**

- **Setup (Given):** Insert an entry with an existing embedding. Mock `generateEmbedding` to return a NEW fake embedding (different from the original).
- **Action (When):** Process a callback update correcting the category.
- **Assertion (Then):** Query the entry. The `embedding` column differs from the original value. `generateEmbedding` was called.
- **Teardown:** Delete test entries.

#### describe("voice message flow")

**TS-4.1: Voice audio downloaded from Telegram**

- **Setup (Given):** Mock fetch: Telegram file download returns fake audio bytes. Whisper returns transcript. LLM returns classification. Mock `generateEmbedding`.
- **Action (When):** Process a voice update with `file_id: "abc123"`.
- **Assertion (Then):** Fetch was called with a URL containing `api.telegram.org/file` and the file path. The audio bytes were sent to whisper.
- **Teardown:** Restore fetch mock.

**TS-4.2: Audio sent to faster-whisper**

- **Setup (Given):** Mock fetch with URL-based router. Whisper URL responds at the configured `WHISPER_URL`.
- **Action (When):** Process a voice update.
- **Assertion (Then):** Fetch was called with the whisper URL. The request body contains the audio data.
- **Teardown:** Restore fetch mock.

**TS-4.3: Transcribed text classified through full pipeline**

- **Setup (Given):** Whisper returns `"I need to call Maria about the budget"`. LLM mock captures the classification prompt. Insert context entries in DB. Mock `generateEmbedding`.
- **Action (When):** Process a voice update.
- **Assertion (Then):** The LLM was called with a prompt containing the transcript `"I need to call Maria about the budget"`. Context entries from the DB appear in the prompt. An embedding was generated.
- **Teardown:** Delete test entries. Restore mocks.

**TS-4.4: Voice entry stored with correct source_type**

- **Setup (Given):** Whisper returns `"Buy groceries"`. LLM returns valid classification.
- **Action (When):** Process a voice update. Query the new entry from DB.
- **Assertion (Then):** Entry has `source: "telegram"`, `source_type: "voice"`, `content: "Buy groceries"`.
- **Teardown:** Delete test entries.

#### describe("/fix command — DB")

**TS-5.1: Finds most recent telegram entry from sender**

- **Setup (Given):** Insert 3 entries from chat ID 123456, source "telegram", with different `created_at` timestamps. Insert 1 entry from chat ID 999 (different user). Mock LLM for re-classification.
- **Action (When):** Process a command update: `/fix this should be a person` from chat ID 123456.
- **Assertion (Then):** The re-classification was called for the entry with the most recent `created_at` from chat ID 123456. The other entries are unchanged.
- **Teardown:** Delete test entries.

**TS-5.3: Re-classification uses original content and correction text**

- **Setup (Given):** Insert an entry with `content: "Discussed roadmap with the design team"`. Mock LLM `chat`, capturing the prompt.
- **Action (When):** Process `/fix this should be a project not a person`.
- **Assertion (Then):** The LLM prompt contains both the original content (`"Discussed roadmap with the design team"`) and the correction text (`"this should be a project not a person"`).
- **Teardown:** Delete test entries. Restore mocks.

**TS-5.4: All fields updated after /fix**

- **Setup (Given):** Insert an entry with `category: "people"`, `name: "Design Team"`, `confidence: 0.55`. Mock LLM to return `{ category: "projects", name: "Roadmap Planning", confidence: 0.88, fields: { status: "active" }, tags: ["work"] }`. Mock `generateEmbedding` to return a new embedding.
- **Action (When):** Process `/fix this is a project`.
- **Assertion (Then):** Query the entry from DB:
  - `category` = `"projects"`
  - `name` = `"Roadmap Planning"`
  - `confidence` = `0.88`
  - `fields` contains `{ status: "active" }`
  - `tags` contains `["work"]`
  - `embedding` is non-null (re-generated)
- **Teardown:** Delete test entries.

#### describe("startup sequence")

**TS-6.3: Bot starts after migrations and server without blocking**

- **Setup (Given):** Set up the full application startup sequence with testcontainers DB. `TELEGRAM_BOT_TOKEN` is set. Mock the grammY `Bot` class so `bot.start()` does not actually connect to Telegram.
- **Action (When):** Call the application startup function.
- **Assertion (Then):** DB migrations run first. The Hono server starts (or is ready). Bot `start()` is called after both. The web server is accessible (not blocked by bot startup).
- **Teardown:** Stop testcontainers. Restore mocks.

#### describe("/fix edge cases — DB")

**TS-EC-14: /fix on entry already corrected via button**

- **Setup (Given):** Insert an entry with `category: "tasks"`, `confidence: null` (previously corrected via inline button).
- **Action (When):** Process `/fix actually this is a reference note`.
- **Assertion (Then):** The entry is re-classified again. `category`, `name`, `fields`, `tags`, `embedding` are all updated with the new result. `/fix` works regardless of prior corrections.
- **Teardown:** Delete test entries.

**TS-EC-15: /fix on unclassified entry**

- **Setup (Given):** Insert an entry with `category: null`, `confidence: null` (failed classification earlier).
- **Action (When):** Process `/fix this is a reference note`.
- **Assertion (Then):** The entry is classified with the correction context. All fields are updated (category, name, fields, tags, embedding, confidence).
- **Teardown:** Delete test entries.

#### describe("calendar edge cases")

**TS-EC-20: Calendar not configured → silently skipped**

- **Setup (Given):** Mock LLM to return `create_calendar_event: true`. Google Calendar is NOT configured (no API key/credentials).
- **Action (When):** Process a text update.
- **Assertion (Then):** No calendar function was called. Entry stored normally. Bot reply is the normal classification reply (no error).
- **Teardown:** Delete test entries.

**TS-EC-21: Calendar API failure → entry stored normally**

- **Setup (Given):** Mock LLM to return `create_calendar_event: true`. Mock calendar service to throw an error.
- **Action (When):** Process a text update.
- **Assertion (Then):** Entry stored normally in DB. Bot reply is the normal classification reply. Stdout contains a log entry about the calendar failure.
- **Teardown:** Delete test entries. Restore mocks.

#### describe("concurrency")

**TS-EC-22: Messages from different users processed independently**

- **Setup (Given):** Insert settings with `telegram_chat_ids: ["111", "222"]`. Mock LLM to return different classifications based on input text. Mock `generateEmbedding`.
- **Action (When):** Process two text updates concurrently: one from chat ID 111 with "Message from user A", one from chat ID 222 with "Message from user B".
- **Assertion (Then):** Two separate entries exist in the DB. One has content "Message from user A", the other "Message from user B". Each has its own classification. Bot API calls show two separate replies (one per chat).
- **Teardown:** Delete test entries.

**TS-EC-23: Same user rapid messages processed sequentially**

- **Setup (Given):** Settings with `telegram_chat_ids: ["123456"]`. Mock LLM, mock `generateEmbedding`.
- **Action (When):** Process two text updates from chat ID 123456: "Message A" then "Message B".
- **Assertion (Then):** Two entries exist in DB. "Message A" has an earlier `created_at` than "Message B". Both have their own classification. The processing order matches the message order.
- **Teardown:** Delete test entries.

## Fixtures & Test Data

### New Helper: Mock Telegram (`tests/helpers/mock-telegram.ts`)

```typescript
const DEFAULT_CHAT_ID = 123456;
const DEFAULT_MESSAGE_ID = 1;

export function createMockContext(options?: MockContextOptions): MockContextResult {
  const chatId = options?.chatId ?? DEFAULT_CHAT_ID;
  const chatType = options?.chatType ?? "private";
  const messageId = options?.messageId ?? DEFAULT_MESSAGE_ID;

  const reply = vi.fn().mockResolvedValue({ message_id: 100 });
  const editMessageText = vi.fn().mockResolvedValue(true);
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  const getFile = vi.fn().mockResolvedValue({ file_path: "voice/file_0.oga" });

  const ctx: Record<string, unknown> = {
    message: {
      chat: { id: chatId, type: chatType },
      message_id: messageId,
      text: options?.text ?? (options?.voice ? undefined : "Test message"),
      voice: options?.voice,
      photo: options?.photo ? [{ file_id: "photo_1" }] : undefined,
      sticker: options?.sticker ? { file_id: "sticker_1" } : undefined,
      document: options?.document ? { file_id: "doc_1" } : undefined,
    },
    callbackQuery: options?.callbackData
      ? {
          data: options.callbackData,
          message: {
            chat: { id: chatId },
            message_id: options.callbackMessageId ?? 100,
          },
        }
      : undefined,
    reply,
    editMessageText,
    answerCallbackQuery,
    getFile,
  };

  return { ctx, mocks: { reply, editMessageText, answerCallbackQuery, getFile } };
}

// Update builders for integration tests (bot.handleUpdate)
export function createTextUpdate(chatId: number, text: string, messageId = 1) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: messageId,
      from: { id: chatId, is_bot: false, first_name: "Test" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

export function createVoiceUpdate(chatId: number, fileId: string, duration: number, messageId = 1) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: messageId,
      from: { id: chatId, is_bot: false, first_name: "Test" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      voice: { file_id: fileId, duration, mime_type: "audio/ogg" },
    },
  };
}

export function createCallbackUpdate(chatId: number, data: string, messageId: number) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: String(Math.floor(Math.random() * 1_000_000)),
      from: { id: chatId, is_bot: false, first_name: "Test" },
      message: {
        message_id: messageId,
        chat: { id: chatId, type: "private" },
        date: Math.floor(Date.now() / 1000),
      },
      data,
    },
  };
}

export function createCommandUpdate(chatId: number, command: string, args = "") {
  const text = args ? `${command} ${args}` : command;
  return createTextUpdate(chatId, text);
}
```

### Existing Helpers (reused)

- **`tests/helpers/env.ts`** — `withEnv()`, `setRequiredEnvVars()` for env var manipulation.
- **`tests/helpers/test-db.ts`** — `startTestDb()`, `runMigrations()` for testcontainers PostgreSQL.
- **`tests/helpers/mock-ollama.ts`** — `createFakeEmbedding()` reused for generating test embeddings.
- **`tests/helpers/mock-llm.ts`** — `createClassificationResult()`, `createClassificationJSON()`, `createMockChat()` for LLM response mocking.

### Test Data Factories

**Entry factory (inline in integration tests):**

```typescript
async function insertEntry(sql: postgres.Sql, overrides?: {
  chatId?: number;      // for tracking which Telegram user created it
  name?: string;
  content?: string;
  category?: string | null;
  confidence?: number | null;
  fields?: Record<string, unknown>;
  tags?: string[];
  source?: string;
  sourceType?: string;
  embedding?: number[] | null;
  deletedAt?: Date | null;
  createdAt?: Date;
}): Promise<{ id: string; [key: string]: unknown }>;
```

Extends the existing entry factory from previous features. Adds `chatId` (stored as metadata or used for filtering) and defaults `source` to `"telegram"`.

**Settings row helper:**

```typescript
async function insertSetting(sql: postgres.Sql, key: string, value: string): Promise<void>;
async function deleteSetting(sql: postgres.Sql, key: string): Promise<void>;
```

Reused from classification integration tests.

### Fixture Lifecycle

| Scope | Fixture | Lifecycle |
|-------|---------|-----------|
| Per suite | Testcontainers PostgreSQL | `beforeAll` / `afterAll` in integration test file |
| Per suite | Drizzle migration run | Once in `beforeAll`, after container starts |
| Per test | Classify module mock | `vi.mock()` at top of file, `vi.mocked(fn).mockReset()` in `beforeEach` |
| Per test | Embed module mock | `vi.mock()` at top of file, reset in `beforeEach` |
| Per test | `globalThis.fetch` spy | `vi.spyOn()` where needed, restored in `afterEach` |
| Per test | grammY Context mocks | Created per test via `createMockContext()` |
| Per test | `process.stdout.write` spy | `vi.spyOn()` where needed, restored in `afterEach` |
| Per test | Environment variables | `withEnv()` save/restore in tests that modify env |
| Per test | DB rows (entries, settings) | Each test inserts its own data; `afterEach` deletes by test-specific markers |

### Test Isolation

- **Unit tests:** Each test gets fresh mock resets. No shared state. Mock context created per test. No test depends on another test's mocks.
- **Integration tests:** Shared DB container, but each test manages its own rows. Tests insert entries with unique content and clean up in `afterEach`. No test depends on another test's data.
- **Fetch mocking:** `fetchSpy.mockReset()` in `beforeEach` ensures no mock leaks between tests.
- **Env vars:** Tests using `withEnv()` restore original values automatically.

## Alignment Check

### Coverage Verification

| Test Scenario ID | Title | Test Function | Status |
|------------------|-------|---------------|--------|
| TS-1.1 | Chat ID from settings table | `it("accepts messages from chat IDs listed in the settings table")` | ✅ Mapped |
| TS-1.2 | Chat ID from env var fallback | `it("accepts messages from chat IDs in the env var when no setting exists")` | ✅ Mapped |
| TS-1.3 | Comma-separated env var | `it("accepts messages from any chat ID in a comma-separated env var list")` | ✅ Mapped |
| TS-1.12 | Multiple IDs in settings array | `it("accepts messages from any chat ID in the settings table JSON array")` | ✅ Mapped |
| TS-1.4 | Unauthorized ignored | `it("ignores messages from unauthorized chat IDs without replying")` | ✅ Mapped |
| TS-1.5 | Settings overrides env var | `it("uses settings table chat IDs and ignores env var when both are set")` | ✅ Mapped |
| TS-1.6 | Context-aware classification | `it("classifies text messages with recent and similar context from the database")` | ✅ Mapped |
| TS-1.7 | Context deduplication | `it("deduplicates context entries appearing in both recent and similar results")` | ✅ Mapped |
| TS-1.8 | Embedding generated | `it("generates and stores an embedding for the message text")` | ✅ Mapped |
| TS-1.9 | Entry stored correctly | `it("stores the entry with correct source, source_type, content, and classification fields")` | ✅ Mapped |
| TS-1.10 | Calendar event created | `it("triggers calendar event creation when classification indicates it")` | ✅ Mapped |
| TS-1.11 | Calendar fields ephemeral | `it("does not persist calendar fields in the database entry")` | ✅ Mapped |
| TS-2.1 | High-confidence reply | `it("replies with high-confidence format when confidence >= threshold")` | ✅ Mapped |
| TS-2.2 | Low-confidence reply | `it("replies with low-confidence format when confidence < threshold")` | ✅ Mapped |
| TS-2.3 | Percentage display | `it("displays confidence as a whole-number percentage")` | ✅ Mapped |
| TS-2.4 | Inline keyboard buttons | `it("includes an inline keyboard with 5 category buttons on low-confidence replies")` | ✅ Mapped |
| TS-2.5 | Button callback data | `it("includes entry ID and category in each button callback data")` | ✅ Mapped |
| TS-2.6 | No keyboard on high-conf | `it("does not include an inline keyboard on high-confidence replies")` | ✅ Mapped |
| TS-2.7 | Custom threshold | `it("uses the custom confidence threshold from the settings table")` | ✅ Mapped |
| TS-2.8 | Boundary at threshold | `it("treats confidence exactly at the threshold as high-confidence")` | ✅ Mapped |
| TS-3.1 | Category updated in DB | `it("updates the entry category in the database on button tap")` | ✅ Mapped |
| TS-3.2 | Fields re-generated | `it("re-generates category-specific fields via Claude after correction")` | ✅ Mapped |
| TS-3.3 | Embedding re-generated | `it("re-generates the embedding after category correction")` | ✅ Mapped |
| TS-3.4 | Edit in-place | `it("edits the original reply message in-place after category correction")` | ✅ Mapped |
| TS-3.5 | Keyboard removed | `it("removes the inline keyboard from the message after correction")` | ✅ Mapped |
| TS-3.6 | Confidence → null | `it("sets confidence to null after manual category correction")` | ✅ Mapped |
| TS-4.1 | Voice audio downloaded | `it("downloads the voice audio file from Telegram")` | ✅ Mapped |
| TS-4.2 | Audio sent to whisper | `it("sends the downloaded audio to faster-whisper for transcription")` | ✅ Mapped |
| TS-4.3 | Transcript classified | `it("classifies the transcribed voice text through the full pipeline")` | ✅ Mapped |
| TS-4.4 | Voice entry stored | `it("stores voice entries with source_type voice and transcribed content")` | ✅ Mapped |
| TS-4.5 | High-conf voice reply | `it("includes the transcript in high-confidence voice replies")` | ✅ Mapped |
| TS-4.6 | Low-conf voice reply | `it("includes the transcript in low-confidence voice replies")` | ✅ Mapped |
| TS-4.7 | Voice inline buttons | `it("attaches inline keyboard to low-confidence voice replies")` | ✅ Mapped |
| TS-5.1 | /fix finds recent entry | `it("finds the most recent telegram entry from the sender by chat ID")` | ✅ Mapped |
| TS-5.2 | /fix text extraction | `it("extracts correction text from everything after /fix")` | ✅ Mapped |
| TS-5.3 | /fix re-classification | `it("re-classifies the entry using original content plus correction text")` | ✅ Mapped |
| TS-5.4 | /fix updates all fields | `it("updates category, name, fields, tags, embedding, and confidence after /fix")` | ✅ Mapped |
| TS-5.5 | /fix reply format | `it("replies with fixed confirmation after successful /fix")` | ✅ Mapped |
| TS-5.6 | /fix no entry | `it("replies with error when /fix finds no recent entry")` | ✅ Mapped |
| TS-5.7 | /fix no text | `it("replies with usage hint when /fix has no correction text")` | ✅ Mapped |
| TS-6.1 | Long-polling mode | `it("starts the bot in long-polling mode")` | ✅ Mapped |
| TS-6.2 | Built-in reconnection | `it("relies on grammY built-in reconnection with no custom logic")` | ✅ Mapped |
| TS-6.3 | Startup sequence | `it("starts the bot after DB migrations and server start without blocking")` | ✅ Mapped |
| TS-6.4 | Missing token | `it("skips bot startup and logs a warning when TELEGRAM_BOT_TOKEN is missing")` | ✅ Mapped |
| TS-EC-1 | DB down → error reply | `it("replies 'System temporarily unavailable' when the database is unreachable")` | ✅ Mapped |
| TS-EC-2 | DB error → continue | `it("continues polling after a database error in a message handler")` | ✅ Mapped |
| TS-EC-3 | Claude down → unclassified | `it("stores entry unclassified and replies with retry message on Claude API failure")` | ✅ Mapped |
| TS-EC-4 | Malformed JSON → unclassified | `it("treats malformed Claude JSON as classification failure")` | ✅ Mapped |
| TS-EC-6 | Ollama down → null embedding | `it("stores entry with null embedding when Ollama is down")` | ✅ Mapped |
| TS-EC-7 | Ollama down → degraded context | `it("classifies with only recent entries when Ollama is down for context fetch")` | ✅ Mapped |
| TS-EC-8 | Whisper down → error reply | `it("replies with transcription error when faster-whisper is down")` | ✅ Mapped |
| TS-EC-9 | Empty transcript | `it("treats an empty transcript as transcription failure")` | ✅ Mapped |
| TS-EC-10 | Whitespace transcript | `it("treats a whitespace-only transcript as transcription failure")` | ✅ Mapped |
| TS-EC-11 | Whitespace message ignored | `it("ignores whitespace-only text messages silently")` | ✅ Mapped |
| TS-EC-12 | Long message OK | `it("classifies messages over 4000 characters normally")` | ✅ Mapped |
| TS-EC-13 | Emoji message OK | `it("classifies emoji-only messages normally")` | ✅ Mapped |
| TS-EC-14 | /fix on corrected entry | `it("allows /fix on an entry already corrected via inline button")` | ✅ Mapped |
| TS-EC-15 | /fix on unclassified entry | `it("allows /fix to classify a previously unclassified entry")` | ✅ Mapped |
| TS-EC-16 | Double-tap button | `it("ignores callback queries for already-corrected entries")` | ✅ Mapped |
| TS-EC-17 | Button on deleted entry | `it("handles callback queries for soft-deleted entries gracefully")` | ✅ Mapped |
| TS-EC-18 | Button on missing entry | `it("handles callback queries for non-existent entry IDs gracefully")` | ✅ Mapped |
| TS-EC-19a | Photo ignored | `it("ignores photo messages silently")` | ✅ Mapped |
| TS-EC-19b | Sticker ignored | `it("ignores sticker messages silently")` | ✅ Mapped |
| TS-EC-19c | Document ignored | `it("ignores document messages silently")` | ✅ Mapped |
| TS-EC-20 | Calendar not configured | `it("silently skips calendar event when Google Calendar is not configured")` | ✅ Mapped |
| TS-EC-21 | Calendar API failure | `it("stores the entry normally even when the calendar API fails")` | ✅ Mapped |
| TS-EC-22 | Multi-user concurrency | `it("processes messages from different users independently")` | ✅ Mapped |
| TS-EC-23 | Same-user sequential | `it("processes rapid messages from the same user sequentially")` | ✅ Mapped |
| TS-NG-1 | Group chat ignored | `it("ignores messages from group chats")` | ✅ Mapped |
| TS-NG-2 | No /start /help | `it("does not handle /start or /help as special commands")` | ✅ Mapped |

### Result

**Full alignment.** All 70 test scenarios are mapped to concrete test functions with setup, action, and assertion strategies defined. Every test can run in isolation. Every test will fail before the feature code exists.

### Design Concerns

1. **TS-6.2 (built-in reconnection):** This scenario verifies the absence of custom reconnection logic. It can be tested by inspecting the module source (no setInterval/setTimeout for reconnection) or by verifying that `bot.start()` is called with default options. This is a structural assertion rather than a behavioral one, but it guards against unnecessary complexity.

2. **TS-EC-22/TS-EC-23 (concurrency):** These scenarios test concurrent behavior. TS-EC-22 can be tested by processing two updates in parallel via `Promise.all([bot.handleUpdate(update1), bot.handleUpdate(update2)])` and verifying DB state. TS-EC-23 verifies sequential processing by checking `created_at` ordering. Both are feasible with testcontainers.

3. **Voice message download chain:** TS-4.1 and TS-4.2 test a multi-step fetch flow (Telegram file download → whisper API call). The `globalThis.fetch` mock must use URL-based routing to return different responses for different URLs. The `createOllamaRouter` pattern from `mock-ollama.ts` provides a proven model for this.

No test requires knowledge of private methods or internal data structures.

### Initial Failure Verification

All tests will fail before implementation because:

- **Unit tests (`telegram-bot.test.ts`):** The bot module (e.g., `src/telegram.ts`) does not exist → imports will fail with module-not-found errors.
- **Integration tests (`telegram-bot-integration.test.ts`):** Same — no bot module, no handler functions, no startup function.
- **Mock helper (`mock-telegram.ts`):** This is test infrastructure only. It doesn't depend on feature code and can be created first.
- **grammY dependency:** The `grammy` package is not yet in `package.json`. It must be installed before tests can import grammY types.
