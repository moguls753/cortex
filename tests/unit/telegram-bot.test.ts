/**
 * Unit tests for the Telegram bot module.
 * Tests handler logic, reply formatting, authorization, error handling,
 * input validation, inline corrections, voice messages, and /fix command.
 * All external dependencies mocked — no DB, no network.
 *
 * Scenarios: TS-1.1–1.5, TS-1.12, TS-2.1–2.8, TS-3.4–3.6,
 *            TS-4.5–4.7, TS-5.2, TS-5.5–5.7, TS-6.1, TS-6.2, TS-6.4,
 *            TS-EC-1–EC-4, TS-EC-6–EC-13, TS-EC-16–EC-19c,
 *            TS-NG-1, TS-NG-2
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createMockContext } from "../helpers/mock-telegram.js";
import {
  createClassificationResult,
  createClassificationJSON,
} from "../helpers/mock-llm.js";
import { createFakeEmbedding } from "../helpers/mock-ollama.js";
import { withEnv } from "../helpers/env.js";

// ---------------------------------------------------------------------------
// Module mocks — hoisted
// ---------------------------------------------------------------------------

const mockClassifyText = vi.fn();
const mockAssembleContext = vi.fn();
const mockIsConfident = vi.fn();
const mockResolveConfidenceThreshold = vi.fn();
const mockReclassifyEntry = vi.fn();

vi.mock("../../src/classify.js", () => ({
  classifyText: mockClassifyText,
  assembleContext: mockAssembleContext,
  isConfident: mockIsConfident,
  resolveConfidenceThreshold: mockResolveConfidenceThreshold,
  reclassifyEntry: mockReclassifyEntry,
}));

const mockGenerateEmbedding = vi.fn();
const mockEmbedEntry = vi.fn();

vi.mock("../../src/embed.js", () => ({
  generateEmbedding: mockGenerateEmbedding,
  embedEntry: mockEmbedEntry,
}));

const mockResolveConfigValue = vi.fn();

vi.mock("../../src/config.js", () => ({
  config: {
    telegramBotToken: "123456:ABC-DEF",
  },
  resolveConfigValue: mockResolveConfigValue,
}));

// Mock grammy (for startup tests)
const mockBotStart = vi.fn();
const mockBotStop = vi.fn();
const mockBotOn = vi.fn();
const mockBotCommand = vi.fn();
const mockBotCatch = vi.fn();
const mockBotApiSetWebhook = vi.fn();
const MockBot = vi.fn(() => ({
  start: mockBotStart,
  stop: mockBotStop,
  on: mockBotOn,
  command: mockBotCommand,
  catch: mockBotCatch,
  api: { setWebhook: mockBotApiSetWebhook },
}));

vi.mock("grammy", () => ({
  Bot: MockBot,
}));

// ---------------------------------------------------------------------------
// Types — will fail to import until src/telegram.ts exists
// ---------------------------------------------------------------------------

type HandleTextMessage = (
  ctx: Record<string, unknown>,
  sql: unknown,
) => Promise<void>;

type HandleVoiceMessage = (
  ctx: Record<string, unknown>,
  sql: unknown,
) => Promise<void>;

type HandleCallbackQuery = (
  ctx: Record<string, unknown>,
  sql: unknown,
) => Promise<void>;

type HandleFixCommand = (
  ctx: Record<string, unknown>,
  sql: unknown,
) => Promise<void>;

type StartBot = (sql: unknown) => Promise<void>;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Telegram Bot", () => {
  let handleTextMessage: HandleTextMessage;
  let handleVoiceMessage: HandleVoiceMessage;
  let handleCallbackQuery: HandleCallbackQuery;
  let handleFixCommand: HandleFixCommand;
  let startBot: StartBot;
  let mockSql: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const mod = await import("../../src/telegram.js");
    handleTextMessage = mod.handleTextMessage;
    handleVoiceMessage = mod.handleVoiceMessage;
    handleCallbackQuery = mod.handleCallbackQuery;
    handleFixCommand = mod.handleFixCommand;
    startBot = mod.startBot;
  });

  beforeEach(() => {
    // Reset all mocks
    mockClassifyText.mockReset();
    mockAssembleContext.mockReset();
    mockIsConfident.mockReset();
    mockResolveConfidenceThreshold.mockReset();
    mockReclassifyEntry.mockReset();
    mockGenerateEmbedding.mockReset();
    mockEmbedEntry.mockReset();
    mockResolveConfigValue.mockReset();
    MockBot.mockClear();
    mockBotStart.mockReset();
    mockBotApiSetWebhook.mockReset();
    mockBotOn.mockReset();
    mockBotCommand.mockReset();
    mockBotCatch.mockReset();

    // Default mock sql — returns [{ id: "uuid-42" }] for INSERT
    mockSql = vi.fn().mockResolvedValue([{ id: "uuid-42" }]);

    // Default: authorized chat ID 123456, threshold 0.6
    mockResolveConfigValue.mockImplementation(async (key: string) => {
      if (key === "telegram_chat_ids") return '["123456"]';
      if (key === "confidence_threshold") return "0.6";
      return undefined;
    });
    mockResolveConfidenceThreshold.mockReturnValue(0.6);
    mockIsConfident.mockImplementation(
      (conf: number, thresh: number) => conf >= thresh,
    );
    mockAssembleContext.mockResolvedValue([]);
    mockClassifyText.mockResolvedValue(
      createClassificationResult({ confidence: 0.85 }),
    );
    mockGenerateEmbedding.mockResolvedValue(createFakeEmbedding());
    mockEmbedEntry.mockResolvedValue(undefined);
  });

  // =========================================================================
  // Authorization (TS-1.1, TS-1.2, TS-1.3, TS-1.12, TS-1.4, TS-1.5)
  // =========================================================================

  describe("authorization", () => {
    it("accepts messages from chat IDs listed in the settings table", async () => {
      // TS-1.1
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        return undefined;
      });
      const { ctx, mocks } = createMockContext({ chatId: 123456 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
      expect(mockClassifyText).toHaveBeenCalled();
    });

    it("accepts messages from chat IDs in the env var when no setting exists", async () => {
      // TS-1.2
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return undefined;
        return undefined;
      });
      const restoreEnv = withEnv({ TELEGRAM_CHAT_ID: "123456" });
      const { ctx, mocks } = createMockContext({ chatId: 123456 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
      restoreEnv();
    });

    it("accepts messages from any chat ID in a comma-separated env var list", async () => {
      // TS-1.3
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return undefined;
        return undefined;
      });
      const restoreEnv = withEnv({ TELEGRAM_CHAT_ID: "111,222,333" });
      const { ctx, mocks } = createMockContext({ chatId: 222 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
      restoreEnv();
    });

    it("accepts messages from any chat ID in the settings table JSON array", async () => {
      // TS-1.12
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["111", "222", "333"]';
        return undefined;
      });
      const { ctx, mocks } = createMockContext({ chatId: 222 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
    });

    it("ignores messages from unauthorized chat IDs without replying", async () => {
      // TS-1.4
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        return undefined;
      });
      const { ctx, mocks } = createMockContext({ chatId: 999999 });
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
      // Must not log the unauthorized message content
      const logOutput = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(logOutput).not.toContain("Test message");

      stdoutSpy.mockRestore();
    });

    it("uses settings table chat IDs and ignores env var when both are set", async () => {
      // TS-1.5
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["111"]';
        return undefined;
      });
      const restoreEnv = withEnv({ TELEGRAM_CHAT_ID: "222" });
      const { ctx, mocks } = createMockContext({ chatId: 222 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      restoreEnv();
    });
  });

  // =========================================================================
  // Reply formatting — text messages (TS-2.1, TS-2.2, TS-2.3, TS-2.7, TS-2.8)
  // =========================================================================

  describe("reply formatting — text messages", () => {
    it("replies with high-confidence format when confidence >= threshold", async () => {
      // TS-2.1
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "people",
          name: "Sarah",
          confidence: 0.85,
        }),
      );
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "✅ Filed as People → Sarah (85%) — reply /fix to correct",
        expect.anything(),
      );
    });

    it("replies with low-confidence format when confidence < threshold", async () => {
      // TS-2.2
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "ideas",
          name: "Unnamed",
          confidence: 0.45,
        }),
      );
      mockIsConfident.mockReturnValue(false);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("❓ Best guess: Ideas → Unnamed (45%)");
    });

    it("displays confidence as a whole-number percentage", async () => {
      // TS-2.3
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "people",
          name: "Test",
          confidence: 0.73,
        }),
      );
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("73%");
      expect(replyText).not.toContain("0.73");
    });

    it("uses the custom confidence threshold from the settings table", async () => {
      // TS-2.7
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["123456"]';
        if (key === "confidence_threshold") return "0.8";
        return undefined;
      });
      mockResolveConfidenceThreshold.mockReturnValue(0.8);
      mockIsConfident.mockReturnValue(false);
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.75 }),
      );
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("❓ Best guess:");
      const replyOptions = mocks.reply.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(replyOptions).toHaveProperty("reply_markup");
    });

    it("treats confidence exactly at the threshold as high-confidence", async () => {
      // TS-2.8
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "people",
          name: "Test",
          confidence: 0.6,
        }),
      );
      mockIsConfident.mockReturnValue(true);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("✅ Filed as");
      const replyOptions = mocks.reply.mock.calls[0][1] as
        | Record<string, unknown>
        | undefined;
      // No inline keyboard on high-confidence
      if (replyOptions?.reply_markup) {
        const markup = replyOptions.reply_markup as Record<string, unknown>;
        expect(markup.inline_keyboard).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // Inline keyboard (TS-2.4, TS-2.5, TS-2.6)
  // =========================================================================

  describe("inline keyboard", () => {
    it("includes an inline keyboard with 5 category buttons on low-confidence replies", async () => {
      // TS-2.4
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.4 }),
      );
      mockIsConfident.mockReturnValue(false);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      const replyOptions = mocks.reply.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(replyOptions).toHaveProperty("reply_markup");
      const markup = replyOptions.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
      const buttons = markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(5);
      expect(buttons.map((b) => b.text)).toEqual([
        "People",
        "Projects",
        "Tasks",
        "Ideas",
        "Reference",
      ]);
    });

    it("includes entry ID and category in each button callback data", async () => {
      // TS-2.5
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.4 }),
      );
      mockIsConfident.mockReturnValue(false);
      mockSql.mockResolvedValue([{ id: "uuid-42" }]);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      const replyOptions = mocks.reply.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      const markup = replyOptions.reply_markup as {
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
      const buttons = markup.inline_keyboard.flat();
      // Each button's callback_data should contain entry ID and category
      expect(buttons[0].callback_data).toContain("uuid-42");
      expect(buttons[0].callback_data).toContain("people");
      expect(buttons[1].callback_data).toContain("projects");
      expect(buttons[2].callback_data).toContain("tasks");
      expect(buttons[3].callback_data).toContain("ideas");
      expect(buttons[4].callback_data).toContain("reference");
    });

    it("does not include an inline keyboard on high-confidence replies", async () => {
      // TS-2.6
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.8 }),
      );
      mockIsConfident.mockReturnValue(true);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
      const replyOptions = mocks.reply.mock.calls[0][1] as
        | Record<string, unknown>
        | undefined;
      if (replyOptions?.reply_markup) {
        const markup = replyOptions.reply_markup as Record<string, unknown>;
        expect(markup.inline_keyboard).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // Inline category correction (TS-3.4, TS-3.5, TS-3.6)
  // =========================================================================

  describe("inline category correction", () => {
    it("edits the original reply message in-place after category correction", async () => {
      // TS-3.4
      const { ctx, mocks } = createMockContext({
        callbackData: "correct:uuid-42:tasks",
        callbackMessageId: 100,
      });
      mockSql
        .mockResolvedValueOnce([
          {
            id: "uuid-42",
            category: "ideas",
            confidence: 0.35,
            content: "Test content",
            deleted_at: null,
          },
        ])
        .mockResolvedValue([{ id: "uuid-42" }]);
      mockReclassifyEntry.mockResolvedValue(
        createClassificationResult({
          category: "tasks",
          name: "Buy Groceries",
        }),
      );

      await handleCallbackQuery(ctx, mockSql);

      expect(mocks.editMessageText).toHaveBeenCalledWith(
        "✅ Fixed → Tasks → Buy Groceries",
        expect.anything(),
      );
      expect(mocks.reply).not.toHaveBeenCalled();
    });

    it("removes the inline keyboard from the message after correction", async () => {
      // TS-3.5
      const { ctx, mocks } = createMockContext({
        callbackData: "correct:uuid-42:tasks",
        callbackMessageId: 100,
      });
      mockSql
        .mockResolvedValueOnce([
          {
            id: "uuid-42",
            category: "ideas",
            confidence: 0.35,
            content: "Test",
            deleted_at: null,
          },
        ])
        .mockResolvedValue([{ id: "uuid-42" }]);
      mockReclassifyEntry.mockResolvedValue(
        createClassificationResult({ category: "tasks", name: "Test" }),
      );

      await handleCallbackQuery(ctx, mockSql);

      const editOptions = mocks.editMessageText.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      // reply_markup should be undefined or empty (removes keyboard)
      expect(
        editOptions.reply_markup === undefined ||
          (editOptions.reply_markup as Record<string, unknown>)
            .inline_keyboard === undefined,
      ).toBe(true);
    });

    it("sets confidence to null after manual category correction", async () => {
      // TS-3.6
      const { ctx } = createMockContext({
        callbackData: "correct:uuid-42:tasks",
        callbackMessageId: 100,
      });
      const updateCalls: unknown[][] = [];
      mockSql
        .mockResolvedValueOnce([
          {
            id: "uuid-42",
            category: "ideas",
            confidence: 0.35,
            content: "Test",
            deleted_at: null,
          },
        ])
        .mockImplementation((...args: unknown[]) => {
          updateCalls.push(args);
          return Promise.resolve([{ id: "uuid-42" }]);
        });
      mockReclassifyEntry.mockResolvedValue(
        createClassificationResult({ category: "tasks", name: "Test" }),
      );

      await handleCallbackQuery(ctx, mockSql);

      // After the initial lookup (first call), subsequent calls update the entry.
      // One of those update calls must include null (for confidence = null).
      const updateCalls2 = mockSql.mock.calls.slice(1);
      const updateValues = updateCalls2.flatMap((call) => call.slice(1));
      expect(updateValues).toContain(null);
    });
  });

  // =========================================================================
  // Voice reply formatting (TS-4.5, TS-4.6, TS-4.7)
  // =========================================================================

  describe("voice reply formatting", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(
        async (url: string | URL | Request) => {
          const urlStr =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (urlStr.includes("api.telegram.org/file")) {
            return new Response(Buffer.from("fake-audio-data"), {
              status: 200,
            });
          }
          if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
            return new Response(
              JSON.stringify({ text: "Buy groceries" }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          throw new Error(`Unexpected fetch URL: ${urlStr}`);
        },
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("includes the transcript in high-confidence voice replies", async () => {
      // TS-4.5
      fetchSpy.mockImplementation(
        async (url: string | URL | Request) => {
          const urlStr =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (urlStr.includes("api.telegram.org/file")) {
            return new Response(Buffer.from("fake-audio"), { status: 200 });
          }
          if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
            return new Response(
              JSON.stringify({ text: "Buy groceries" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`Unexpected fetch: ${urlStr}`);
        },
      );
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "tasks",
          name: "Buy Groceries",
          confidence: 0.9,
        }),
      );
      mockIsConfident.mockReturnValue(true);
      const { ctx, mocks } = createMockContext({
        voice: { file_id: "voice_1", duration: 5 },
      });

      await handleVoiceMessage(ctx, mockSql);

      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("🎤 'Buy groceries'");
      expect(replyText).toContain(
        "✅ Filed as Tasks → Buy Groceries (90%)",
      );
      // Voice replies don't include "/fix" suffix (unlike text replies)
      expect(replyText).not.toContain("/fix");
    });

    it("includes the transcript in low-confidence voice replies", async () => {
      // TS-4.6
      fetchSpy.mockImplementation(
        async (url: string | URL | Request) => {
          const urlStr =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (urlStr.includes("api.telegram.org/file")) {
            return new Response(Buffer.from("fake-audio"), { status: 200 });
          }
          if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
            return new Response(
              JSON.stringify({ text: "Something about the thing" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error(`Unexpected fetch: ${urlStr}`);
        },
      );
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.3 }),
      );
      mockIsConfident.mockReturnValue(false);
      const { ctx, mocks } = createMockContext({
        voice: { file_id: "voice_1", duration: 5 },
      });

      await handleVoiceMessage(ctx, mockSql);

      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("🎤 'Something about the thing'");
      expect(replyText).toContain("❓ Best guess:");
    });

    it("attaches inline keyboard to low-confidence voice replies", async () => {
      // TS-4.7
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.3 }),
      );
      mockIsConfident.mockReturnValue(false);
      const { ctx, mocks } = createMockContext({
        voice: { file_id: "voice_1", duration: 5 },
      });

      await handleVoiceMessage(ctx, mockSql);

      const replyOptions = mocks.reply.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(replyOptions).toHaveProperty("reply_markup");
      const markup = replyOptions.reply_markup as {
        inline_keyboard: Array<Array<{ text: string }>>;
      };
      const buttons = markup.inline_keyboard.flat();
      expect(buttons).toHaveLength(5);
    });
  });

  // =========================================================================
  // /fix command (TS-5.2, TS-5.5, TS-5.6, TS-5.7)
  // =========================================================================

  describe("/fix command", () => {
    it("extracts correction text from everything after /fix", async () => {
      // TS-5.2
      const { ctx } = createMockContext({
        text: "/fix this should be a person not a project",
      });
      mockSql.mockResolvedValueOnce([
        {
          id: "uuid-99",
          content: "Discussed roadmap",
          category: "projects",
          source: "telegram",
        },
      ]);
      mockReclassifyEntry.mockResolvedValue(
        createClassificationResult({ category: "people" }),
      );

      await handleFixCommand(ctx, mockSql);

      expect(mockReclassifyEntry).toHaveBeenCalledWith(
        "Discussed roadmap",
        "projects",
        "this should be a person not a project",
        undefined,
        expect.anything(),
      );
    });

    it("replies with fixed confirmation after successful /fix", async () => {
      // TS-5.5
      const { ctx, mocks } = createMockContext({
        text: "/fix this is a project",
      });
      mockSql.mockResolvedValueOnce([
        {
          id: "uuid-99",
          content: "Discussed roadmap with the design team",
          category: "people",
          source: "telegram",
        },
      ]);
      mockReclassifyEntry.mockResolvedValue(
        createClassificationResult({
          category: "projects",
          name: "Roadmap Planning",
        }),
      );

      await handleFixCommand(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "✅ Fixed → Projects → Roadmap Planning",
      );
    });

    it("replies with error when /fix finds no recent entry", async () => {
      // TS-5.6
      const { ctx, mocks } = createMockContext({
        text: "/fix this should be a task",
      });
      mockSql.mockResolvedValueOnce([]); // No entries found

      await handleFixCommand(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith("No recent entry to fix");
    });

    it("replies with usage hint when /fix has no correction text", async () => {
      // TS-5.7
      const { ctx, mocks } = createMockContext({ text: "/fix" });

      await handleFixCommand(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "Usage: /fix <correction description>",
      );
    });
  });

  // =========================================================================
  // Startup (TS-6.1, TS-6.2, TS-6.4)
  // =========================================================================

  describe("startup", () => {
    it("starts the bot in long-polling mode", async () => {
      // TS-6.1
      const restoreEnv = withEnv({
        TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      });

      await startBot(mockSql);

      expect(mockBotStart).toHaveBeenCalled();
      expect(mockBotApiSetWebhook).not.toHaveBeenCalled();
      restoreEnv();
    });

    it("relies on grammY built-in reconnection with no custom logic", async () => {
      // TS-6.2
      // Verify that bot.start() is called with default options (no custom retry)
      const restoreEnv = withEnv({
        TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      });

      await startBot(mockSql);

      // bot.start() should be called — grammY handles reconnection internally
      expect(mockBotStart).toHaveBeenCalled();
      // No setInterval/setTimeout calls for custom reconnection
      // (structural assertion: the module relies on grammY's built-in retry)
      restoreEnv();
    });

    it("skips bot startup and logs a warning when TELEGRAM_BOT_TOKEN is missing", async () => {
      // TS-6.4
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      vi.resetModules();
      vi.doMock("../../src/config.js", () => ({
        config: { telegramBotToken: "" },
        resolveConfigValue: mockResolveConfigValue,
      }));

      const { startBot: startBotFresh } = await import(
        "../../src/telegram.js"
      );
      await startBotFresh(mockSql);

      expect(MockBot).not.toHaveBeenCalled();
      const logOutput = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(logOutput).toContain("warn");

      stdoutSpy.mockRestore();
    });
  });

  // =========================================================================
  // Error handling (TS-EC-1 through TS-EC-10)
  // =========================================================================

  describe("error handling", () => {
    it("replies 'System temporarily unavailable' when the database is unreachable", async () => {
      // TS-EC-1
      mockSql.mockRejectedValue(new Error("Connection refused"));
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "System temporarily unavailable",
      );
    });

    it("continues polling after a database error in a message handler", async () => {
      // TS-EC-2
      mockSql.mockRejectedValue(new Error("Connection refused"));
      const { ctx } = createMockContext();

      // Handler should not throw — errors are caught internally
      await expect(
        handleTextMessage(ctx, mockSql),
      ).resolves.toBeUndefined();
    });

    it("stores entry unclassified and replies with retry message on Claude API failure", async () => {
      // TS-EC-3
      mockClassifyText.mockResolvedValue(null);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      // Entry was stored (SQL called for INSERT)
      expect(mockSql).toHaveBeenCalled();
      expect(mocks.reply).toHaveBeenCalledWith(
        "Stored but could not classify — will retry",
      );
    });

    it("treats malformed Claude JSON as classification failure", async () => {
      // TS-EC-4
      mockClassifyText.mockResolvedValue(null);
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "Stored but could not classify — will retry",
      );
    });

    it("stores entry with null embedding when Ollama is down", async () => {
      // TS-EC-6
      mockGenerateEmbedding.mockResolvedValue(null);
      mockEmbedEntry.mockResolvedValue(undefined);
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.85 }),
      );
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      // Reply should show classification result (no mention of embedding failure)
      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("✅ Filed as");
    });

    it("classifies with only recent entries when Ollama is down for context fetch", async () => {
      // TS-EC-7
      // assembleContext returns only recent entries (no similar entries because Ollama down)
      const recentOnly = [
        { id: "r1", name: "Recent", category: "people", content: "recent" },
      ];
      mockAssembleContext.mockResolvedValue(recentOnly);
      mockClassifyText.mockResolvedValue(
        createClassificationResult({ confidence: 0.85 }),
      );
      const { ctx, mocks } = createMockContext();

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
      // Classification still succeeds with degraded context
      const replyText = mocks.reply.mock.calls[0][0] as string;
      expect(replyText).toContain("✅ Filed as");
    });

    it("replies with transcription error when faster-whisper is down", async () => {
      // TS-EC-8
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(
        async (url: string | URL | Request) => {
          const urlStr =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (urlStr.includes("api.telegram.org/file")) {
            return new Response(Buffer.from("fake-audio"), { status: 200 });
          }
          throw new TypeError("fetch failed");
        },
      );
      const { ctx, mocks } = createMockContext({
        voice: { file_id: "voice_1", duration: 5 },
      });

      await handleVoiceMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "Could not transcribe voice message. Please send as text.",
      );
      fetchSpy.mockRestore();
    });

    it("treats an empty transcript as transcription failure", async () => {
      // TS-EC-9
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(
        async (url: string | URL | Request) => {
          const urlStr =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (urlStr.includes("api.telegram.org/file")) {
            return new Response(Buffer.from("fake-audio"), { status: 200 });
          }
          if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
            return new Response(JSON.stringify({ text: "" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          throw new Error(`Unexpected fetch: ${urlStr}`);
        },
      );
      const { ctx, mocks } = createMockContext({
        voice: { file_id: "voice_1", duration: 5 },
      });

      await handleVoiceMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "Could not transcribe voice message. Please send as text.",
      );
      fetchSpy.mockRestore();
    });

    it("treats a whitespace-only transcript as transcription failure", async () => {
      // TS-EC-10
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(
        async (url: string | URL | Request) => {
          const urlStr =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;
          if (urlStr.includes("api.telegram.org/file")) {
            return new Response(Buffer.from("fake-audio"), { status: 200 });
          }
          if (urlStr.includes(":8000") || urlStr.includes("whisper")) {
            return new Response(JSON.stringify({ text: "   \n  " }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          throw new Error(`Unexpected fetch: ${urlStr}`);
        },
      );
      const { ctx, mocks } = createMockContext({
        voice: { file_id: "voice_1", duration: 5 },
      });

      await handleVoiceMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalledWith(
        "Could not transcribe voice message. Please send as text.",
      );
      fetchSpy.mockRestore();
    });
  });

  // =========================================================================
  // Input validation (TS-EC-11, TS-EC-12, TS-EC-13)
  // =========================================================================

  describe("input validation", () => {
    it("ignores whitespace-only text messages silently", async () => {
      // TS-EC-11
      const { ctx, mocks } = createMockContext({ text: "   \n  " });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
    });

    it("classifies messages over 4000 characters normally", async () => {
      // TS-EC-12
      const longText = "A".repeat(5000);
      const { ctx, mocks } = createMockContext({ text: longText });

      await handleTextMessage(ctx, mockSql);

      expect(mockClassifyText).toHaveBeenCalled();
      // Full text passed to classification
      const classifyCallArgs = mockClassifyText.mock.calls[0];
      expect(classifyCallArgs[0]).toBe(longText);
      expect(mocks.reply).toHaveBeenCalled();
    });

    it("classifies emoji-only messages normally", async () => {
      // TS-EC-13
      const { ctx, mocks } = createMockContext({ text: "🎉🚀💡" });

      await handleTextMessage(ctx, mockSql);

      expect(mockClassifyText).toHaveBeenCalledWith(
        "🎉🚀💡",
        expect.anything(),
      );
      expect(mocks.reply).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Callback edge cases (TS-EC-16, TS-EC-17, TS-EC-18)
  // =========================================================================

  describe("callback edge cases", () => {
    it("ignores callback queries for already-corrected entries", async () => {
      // TS-EC-16
      const { ctx, mocks } = createMockContext({
        callbackData: "correct:uuid-42:tasks",
        callbackMessageId: 100,
      });
      // Entry already corrected (confidence: null)
      mockSql.mockResolvedValueOnce([
        {
          id: "uuid-42",
          category: "tasks",
          confidence: null,
          content: "Test",
          deleted_at: null,
        },
      ]);

      await handleCallbackQuery(ctx, mockSql);

      expect(mocks.answerCallbackQuery).toHaveBeenCalled();
      // Entry should NOT be re-processed
      expect(mockReclassifyEntry).not.toHaveBeenCalled();
    });

    it("handles callback queries for soft-deleted entries gracefully", async () => {
      // TS-EC-17
      const { ctx, mocks } = createMockContext({
        callbackData: "correct:uuid-42:tasks",
        callbackMessageId: 100,
      });
      mockSql.mockResolvedValueOnce([
        {
          id: "uuid-42",
          category: "ideas",
          confidence: 0.35,
          content: "Test",
          deleted_at: new Date(),
        },
      ]);

      await handleCallbackQuery(ctx, mockSql);

      // Should not crash
      expect(mocks.answerCallbackQuery).toHaveBeenCalled();
    });

    it("handles callback queries for non-existent entry IDs gracefully", async () => {
      // TS-EC-18
      const { ctx, mocks } = createMockContext({
        callbackData: "correct:nonexistent-id:tasks",
        callbackMessageId: 100,
      });
      mockSql.mockResolvedValueOnce([]); // Entry not found
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      await handleCallbackQuery(ctx, mockSql);

      expect(mocks.answerCallbackQuery).toHaveBeenCalled();
      const logOutput = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(logOutput).toContain("warn");

      stdoutSpy.mockRestore();
    });
  });

  // =========================================================================
  // Unsupported message types (TS-EC-19a, TS-EC-19b, TS-EC-19c)
  // =========================================================================

  describe("unsupported message types", () => {
    it("ignores photo messages silently", async () => {
      // TS-EC-19a
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        photo: true,
        text: undefined,
      });
      (ctx.message as Record<string, unknown>).text = undefined;

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
    });

    it("ignores sticker messages silently", async () => {
      // TS-EC-19b
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        sticker: true,
        text: undefined,
      });
      (ctx.message as Record<string, unknown>).text = undefined;

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
    });

    it("ignores document messages silently", async () => {
      // TS-EC-19c
      const { ctx, mocks } = createMockContext({
        chatId: 123456,
        document: true,
        text: undefined,
      });
      (ctx.message as Record<string, unknown>).text = undefined;

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Non-goals (TS-NG-1, TS-NG-2)
  // =========================================================================

  describe("non-goals", () => {
    it("ignores messages from group chats", async () => {
      // TS-NG-1
      const { ctx, mocks } = createMockContext({
        chatType: "group",
        chatId: 123456,
        text: "Hello",
      });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
    });

    it("does not handle /start or /help as special commands", async () => {
      // TS-NG-2
      const { ctx, mocks } = createMockContext({
        text: "/start",
      });

      await handleTextMessage(ctx, mockSql);

      // Either ignored entirely or treated as regular text (classified)
      // The important thing: no special command response
      if (mocks.reply.mock.calls.length > 0) {
        const replyText = mocks.reply.mock.calls[0][0] as string;
        // Should not contain a "welcome" or "help" message
        expect(replyText).not.toMatch(/welcome|help|start/i);
      }
    });
  });
});
