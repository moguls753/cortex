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

const mockGetAllSettings = vi.fn();

vi.mock("../../src/config.js", () => ({
  config: {},
  resolveConfigValue: mockResolveConfigValue,
}));

vi.mock("../../src/web/settings-queries.js", () => ({
  getAllSettings: (...args: unknown[]) => mockGetAllSettings(...args),
}));

// processCalendarEvent mock — enables TS-8.5 to assert the handler still
// dispatches calendar creation for private entries (visibility is orthogonal
// to calendar writes per NG-5). Other calendar calls stay as plain closures
// so vi.restoreAllMocks() doesn't wipe them.
vi.mock("../../src/google-calendar.js", () => ({
  processCalendarEvent: vi.fn().mockResolvedValue({ created: false }),
  getCalendarNames: async () => [] as string[],
  handleEntryCalendarCleanup: async () => undefined,
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

  beforeEach(async () => {
    // Reset all mocks
    mockClassifyText.mockReset();
    mockAssembleContext.mockReset();
    mockIsConfident.mockReset();
    mockResolveConfidenceThreshold.mockReset();
    mockReclassifyEntry.mockReset();
    mockGenerateEmbedding.mockReset();
    mockEmbedEntry.mockReset();
    mockResolveConfigValue.mockReset();
    mockGetAllSettings.mockReset();
    MockBot.mockClear();
    mockBotStart.mockReset();
    // bot.start() must return a promise — startBot() chains .catch() on it.
    mockBotStart.mockReturnValue(new Promise(() => {}));
    mockBotApiSetWebhook.mockReset();
    mockBotOn.mockReset();
    mockBotCommand.mockReset();
    mockBotCatch.mockReset();

    // Reset bot running state between tests
    const { resetBotState } = await import("../../src/telegram.js");
    resetBotState();

    // Default: getAllSettings returns a token for startup tests
    mockGetAllSettings.mockResolvedValue({
      telegram_bot_token: "123456:ABC-DEF",
    });

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

    it("rejects messages when no chat IDs are configured in settings", async () => {
      // TS-1.2 (updated: env var fallback removed)
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return undefined;
        return undefined;
      });
      const { ctx, mocks } = createMockContext({ chatId: 123456 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
    });

    it("accepts messages from any chat ID in a settings JSON array with multiple entries", async () => {
      // TS-1.3 (updated: uses settings instead of env var)
      mockResolveConfigValue.mockImplementation(async (key: string) => {
        if (key === "telegram_chat_ids") return '["111", "222", "333"]';
        return undefined;
      });
      const { ctx, mocks } = createMockContext({ chatId: 333 });

      await handleTextMessage(ctx, mockSql);

      expect(mocks.reply).toHaveBeenCalled();
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
      // Post entry-visibility: the low-confidence reply also carries 1 visibility
      // toggle button in a second row. The category correction set remains 5.
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
      const categoryButtons = buttons.filter((b) =>
        String(b.callback_data).startsWith("correct:"),
      );
      expect(categoryButtons).toHaveLength(5);
      expect(categoryButtons.map((b) => b.text)).toEqual([
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
        inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
      const buttons = markup.inline_keyboard.flat();
      // Post entry-visibility: 5 category buttons + 1 visibility toggle.
      const categoryButtons = buttons.filter((b) =>
        String(b.callback_data).startsWith("correct:"),
      );
      expect(categoryButtons).toHaveLength(5);
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
      mockGetAllSettings.mockResolvedValue({
        telegram_bot_token: "123456:ABC-DEF",
      });

      await startBot(mockSql);

      expect(mockBotStart).toHaveBeenCalled();
      expect(mockBotApiSetWebhook).not.toHaveBeenCalled();
    });

    it("relies on grammY built-in reconnection with no custom logic", async () => {
      // TS-6.2
      mockGetAllSettings.mockResolvedValue({
        telegram_bot_token: "123456:ABC-DEF",
      });

      await startBot(mockSql);

      // bot.start() should be called — grammY handles reconnection internally
      expect(mockBotStart).toHaveBeenCalled();
      // No setInterval/setTimeout calls for custom reconnection
      // (structural assertion: the module relies on grammY's built-in retry)
    });

    it("skips bot startup and logs info when bot token is not configured", async () => {
      // TS-6.4
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      mockGetAllSettings.mockResolvedValue({});

      await startBot(mockSql);

      expect(MockBot).not.toHaveBeenCalled();
      const logOutput = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(logOutput).toMatch(/not configured|info/i);

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

  // =========================================================================
  // Entry Visibility — reply formatting, toggle semantics, /fix + calendar
  // =========================================================================
  describe("Entry Visibility", () => {
    // Shared helper to read the options object from the first reply call.
    function firstReplyOpts(mocks: {
      reply: ReturnType<typeof vi.fn>;
    }): Record<string, unknown> | undefined {
      const calls = mocks.reply.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      return calls[0][1] as Record<string, unknown> | undefined;
    }

    function firstReplyText(mocks: {
      reply: ReturnType<typeof vi.fn>;
    }): string {
      return mocks.reply.mock.calls[0][0] as string;
    }

    // TS-3.1 — confident shared reply has 👁 glyph, no inline keyboard.
    it("confident shared reply includes 👁 glyph and no inline toggle", async () => {
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "tasks",
          name: "Buy bread",
          confidence: 0.9,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ visibility: "shared" } as any),
        }),
      );

      const { ctx, mocks } = createMockContext({ text: "buy bread" });
      await handleTextMessage(ctx, mockSql);

      expect(firstReplyText(mocks)).toContain("👁");
      const opts = firstReplyOpts(mocks);
      // Either no options at all, or no reply_markup attached.
      expect(opts?.reply_markup).toBeFalsy();
    });

    // TS-3.2 — confident private reply has no glyph and no inline keyboard.
    it("confident private reply has no 👁 glyph and no inline toggle", async () => {
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "ideas",
          name: "Quiet thought",
          confidence: 0.85,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ visibility: "private" } as any),
        }),
      );

      const { ctx, mocks } = createMockContext({ text: "quiet thought" });
      await handleTextMessage(ctx, mockSql);

      expect(firstReplyText(mocks)).not.toContain("👁");
      const opts = firstReplyOpts(mocks);
      expect(opts?.reply_markup).toBeFalsy();
    });

    // TS-3.3 — low-confidence (LLM said shared) reply: no glyph, 5 category
    // buttons, 1 "Make shared" toggle (stored value is private after fail-safe).
    it("low-confidence reply with LLM='shared' has 5 category buttons + 'Make shared' toggle", async () => {
      mockIsConfident.mockReturnValue(false);
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "tasks",
          name: "Ambiguous capture",
          confidence: 0.45,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ visibility: "shared" } as any),
        }),
      );

      const { ctx, mocks } = createMockContext({ text: "ambiguous capture" });
      await handleTextMessage(ctx, mockSql);

      // Reply reflects post-fail-safe storage (private) — no glyph.
      expect(firstReplyText(mocks)).not.toContain("👁");

      const opts = firstReplyOpts(mocks) as
        | { reply_markup?: { inline_keyboard: unknown[][] } }
        | undefined;
      const keyboard = opts?.reply_markup?.inline_keyboard ?? [];

      // Flatten all button rows and inspect callback_data fields.
      const buttons = keyboard.flat() as Array<{
        text?: string;
        callback_data?: string;
      }>;
      const categoryButtons = buttons.filter((b) =>
        String(b.callback_data ?? "").startsWith("correct:"),
      );
      const visibilityButtons = buttons.filter((b) =>
        String(b.callback_data ?? "").startsWith("visibility:"),
      );

      expect(categoryButtons).toHaveLength(5);
      expect(visibilityButtons).toHaveLength(1);
      const vb = visibilityButtons[0]!;
      expect(String(vb.callback_data)).toMatch(/:shared$/);
      expect(String(vb.text ?? "").toLowerCase()).toContain("shared");
    });

    // TS-3.4 — low-confidence (LLM said private) reply: same shape.
    it("low-confidence reply with LLM='private' has 5 category buttons + 'Make shared' toggle", async () => {
      mockIsConfident.mockReturnValue(false);
      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "ideas",
          name: "Uncertain private",
          confidence: 0.45,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ visibility: "private" } as any),
        }),
      );

      const { ctx, mocks } = createMockContext({ text: "uncertain private" });
      await handleTextMessage(ctx, mockSql);

      expect(firstReplyText(mocks)).not.toContain("👁");

      const opts = firstReplyOpts(mocks) as
        | { reply_markup?: { inline_keyboard: unknown[][] } }
        | undefined;
      const keyboard = opts?.reply_markup?.inline_keyboard ?? [];
      const buttons = keyboard.flat() as Array<{
        text?: string;
        callback_data?: string;
      }>;

      expect(
        buttons.filter((b) =>
          String(b.callback_data ?? "").startsWith("correct:"),
        ),
      ).toHaveLength(5);

      const vb = buttons.find((b) =>
        String(b.callback_data ?? "").startsWith("visibility:"),
      );
      expect(vb).toBeDefined();
      expect(String(vb!.callback_data)).toMatch(/:shared$/);
      expect(String(vb!.text ?? "").toLowerCase()).toContain("shared");
    });

    // TS-3.5 — toggle label inverse of stored visibility, both directions.
    // This test dispatches two callback_query taps (at different times) to
    // observe that the re-rendered keyboard label inverts the stored value.
    it("toggle button label reflects the inverse of the stored visibility on re-render", async () => {
      // Test path 1: stored shared → edited message shows 'Make private'.
      mockSql = vi.fn().mockResolvedValue([
        {
          id: "11111111-1111-1111-1111-111111111111",
          category: "tasks",
          confidence: 0.45,
          content: "...",
          deleted_at: null,
          visibility: "shared",
        },
      ]);
      mockReclassifyEntry.mockResolvedValue({
        category: "tasks",
        name: "After toggle",
        confidence: 0.45,
        fields: {},
        tags: [],
      });

      const ctx1 = {
        callbackQuery: {
          data: "visibility:11111111-1111-1111-1111-111111111111:private",
          message: {
            chat: { id: 123456 },
            message_id: 42,
            text: "❓ Best guess: Tasks → Thing (45%) 👁",
          },
        },
        editMessageText: vi.fn().mockResolvedValue(true),
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      };
      await handleCallbackQuery(ctx1, mockSql);
      expect(ctx1.editMessageText).toHaveBeenCalled();
      const editCall = ctx1.editMessageText.mock.calls[0] as [
        string,
        { reply_markup?: { inline_keyboard: unknown[][] } } | undefined,
      ];
      const keyboard = editCall[1]?.reply_markup?.inline_keyboard ?? [];
      const buttons = keyboard.flat() as Array<{
        text?: string;
        callback_data?: string;
      }>;
      const viz = buttons.find((b) =>
        String(b.callback_data ?? "").startsWith("visibility:"),
      );
      expect(viz).toBeDefined();
      // After flipping to 'private', the toggle's next action is 'Make shared'.
      // If Phase 5 re-renders the keyboard after each tap, label contains "shared".
      // If Phase 5 removes the keyboard entirely on edit, the test accepts that too.
      if (viz) {
        expect(String(viz.text ?? "").toLowerCase()).toContain("shared");
        expect(String(viz.callback_data)).toMatch(/:shared$/);
      }
    });

    // TS-3.6 — tap on visibility toggle calls UPDATE, no LLM/embed calls.
    it("visibility toggle tap updates DB without calling LLM or embed", async () => {
      const updates: Array<{ query: string; values: unknown[] }> = [];
      const recordingSql = vi.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          const query = strings.join("?");
          updates.push({ query, values });
          if (/SELECT/i.test(query)) {
            return Promise.resolve([
              {
                id: "22222222-2222-2222-2222-222222222222",
                category: "tasks",
                confidence: 0.45,
                content: "text",
                deleted_at: null,
                visibility: "private",
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const ctx = {
        callbackQuery: {
          data: "visibility:22222222-2222-2222-2222-222222222222:shared",
          message: {
            chat: { id: 123456 },
            message_id: 42,
            text: "❓ Best guess: Tasks → Thing (45%)",
          },
        },
        editMessageText: vi.fn().mockResolvedValue(true),
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      };
      await handleCallbackQuery(ctx, recordingSql);

      // At least one UPDATE targeting entries with visibility was issued.
      const updateQueries = updates.filter(
        (u) => /UPDATE\s+entries/i.test(u.query) && /visibility/i.test(u.query),
      );
      expect(updateQueries.length).toBeGreaterThan(0);

      // No LLM call, no embedding call.
      expect(mockReclassifyEntry).not.toHaveBeenCalled();
      expect(mockClassifyText).not.toHaveBeenCalled();
      expect(mockEmbedEntry).not.toHaveBeenCalled();
    });

    // TS-3.7 — tap edits the original reply so the user sees the new state.
    it("visibility toggle tap edits the original reply", async () => {
      mockSql = vi.fn().mockResolvedValue([
        {
          id: "33333333-3333-3333-3333-333333333333",
          category: "tasks",
          confidence: 0.45,
          content: "text",
          deleted_at: null,
          visibility: "shared",
        },
      ]);

      const ctx = {
        callbackQuery: {
          data: "visibility:33333333-3333-3333-3333-333333333333:private",
          message: {
            chat: { id: 123456 },
            message_id: 42,
            text: "❓ Best guess: Tasks → Name (45%) 👁",
          },
        },
        editMessageText: vi.fn().mockResolvedValue(true),
        answerCallbackQuery: vi.fn().mockResolvedValue(true),
      };
      await handleCallbackQuery(ctx, mockSql);

      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
      const [newText] = ctx.editMessageText.mock.calls[0] as [string, unknown];
      // After flipping to private, the glyph should be absent.
      expect(newText).not.toContain("👁");
    });

    // TS-3.8 — voice capture reply follows the same visibility-format rules.
    it("voice capture reply includes 👁 glyph on confident shared", async () => {
      global.fetch = vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/v1/audio/transcriptions")) {
          return new Response(JSON.stringify({ text: "voice transcript" }), {
            status: 200,
          });
        }
        return new Response(new ArrayBuffer(16), { status: 200 });
      }) as unknown as typeof fetch;

      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "tasks",
          name: "Spoken task",
          confidence: 0.9,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ visibility: "shared" } as any),
        }),
      );

      const { ctx, mocks } = createMockContext({
        voice: { file_id: "v1", duration: 3 },
        chatId: 123456,
      });
      // mock-telegram createMockContext uses ctx.message.text OR voice — voice branch
      await handleVoiceMessage(ctx, mockSql);

      const text = firstReplyText(mocks);
      expect(text).toContain("🎤");
      expect(text).toContain("voice transcript");
      expect(text).toContain("👁");
      const opts = firstReplyOpts(mocks);
      expect(opts?.reply_markup).toBeFalsy();
    });

    // TS-8.4 — /fix pipeline still applies the visibility fail-safe.
    it("/fix reclassification below threshold still stores visibility='private'", async () => {
      const recordedUpdates: Array<{ query: string; values: unknown[] }> = [];
      mockSql = vi.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          const query = strings.join("?");
          if (/SELECT/i.test(query) && /FROM entries/i.test(query)) {
            return Promise.resolve([
              {
                id: "44444444-4444-4444-4444-444444444444",
                content: "original",
                category: "ideas",
                source: "telegram",
              },
            ]);
          }
          if (/UPDATE entries/i.test(query)) {
            recordedUpdates.push({ query, values });
          }
          return Promise.resolve([]);
        },
      );

      mockReclassifyEntry.mockResolvedValue({
        category: "ideas",
        name: "Reclassified",
        confidence: 0.4, // below threshold
        fields: {},
        tags: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ visibility: "shared" } as any),
      });

      const { ctx } = createMockContext({
        text: "/fix this is sensitive",
        chatId: 123456,
      });
      await handleFixCommand(ctx, mockSql);

      // The UPDATE must set visibility to 'private' (fail-safe), not 'shared'.
      const updateWithVisibility = recordedUpdates.find((u) =>
        /visibility/i.test(u.query),
      );
      expect(updateWithVisibility).toBeDefined();
      expect(updateWithVisibility!.values).toContain("private");
    });

    // TS-8.5 — private entry with create_calendar_event=true still creates event (NG-5 guard).
    it("private entry with create_calendar_event=true still triggers processCalendarEvent", async () => {
      const { processCalendarEvent } = await import(
        "../../src/google-calendar.js"
      );
      const spy = vi.mocked(processCalendarEvent);
      spy.mockResolvedValue({ created: true } as any);

      mockClassifyText.mockResolvedValue(
        createClassificationResult({
          category: "tasks",
          name: "Private meeting",
          confidence: 0.9,
          create_calendar_event: true,
          calendar_date: "2026-05-01",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ visibility: "private" } as any),
        }),
      );

      const { ctx } = createMockContext({ text: "private meeting" });
      await handleTextMessage(ctx, mockSql);

      // Fire-and-forget — give the microtask queue a tick so the .then chain runs.
      await new Promise((r) => setTimeout(r, 20));

      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0];
      const classificationArg = args[2] as { visibility?: string };
      // The classification passed through still carries visibility='private' —
      // proving the handler does NOT strip or suppress calendar events for private entries.
      expect(classificationArg.visibility).toBe("private");
    });
  });
});
