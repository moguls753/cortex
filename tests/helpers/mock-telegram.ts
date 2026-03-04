/**
 * Test helpers for mocking grammY Telegram bot Context and Update objects.
 * Used by telegram bot tests to simulate incoming messages, voice notes,
 * callback queries, and commands without a real Telegram connection.
 */

import { vi } from "vitest";

/**
 * Options for creating a mock grammY Context.
 */
export interface MockContextOptions {
  chatId?: number;
  chatType?: "private" | "group" | "supergroup" | "channel";
  messageId?: number;
  text?: string;
  voice?: { file_id: string; duration: number };
  photo?: boolean;
  sticker?: boolean;
  document?: boolean;
  callbackData?: string;
  callbackMessageId?: number;
}

/**
 * Result of creating a mock context — the context object plus
 * references to individual mock functions for easy assertion.
 */
export interface MockContextResult {
  ctx: Record<string, unknown>;
  mocks: {
    reply: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    getFile: ReturnType<typeof vi.fn>;
  };
}

const DEFAULT_CHAT_ID = 123456;
const DEFAULT_MESSAGE_ID = 1;

/**
 * Create a mock grammY Context for unit testing bot handlers.
 *
 * Returns an object with ctx (the fake context) and mocks (references
 * to stubbed methods for assertion). Defaults to a private-chat text
 * message from chat ID 123456.
 */
export function createMockContext(
  options?: MockContextOptions,
): MockContextResult {
  const chatId = options?.chatId ?? DEFAULT_CHAT_ID;
  const chatType = options?.chatType ?? "private";
  const messageId = options?.messageId ?? DEFAULT_MESSAGE_ID;

  const reply = vi.fn().mockResolvedValue({ message_id: 100 });
  const editMessageText = vi.fn().mockResolvedValue(true);
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  const getFile = vi
    .fn()
    .mockResolvedValue({ file_path: "voice/file_0.oga" });

  const ctx: Record<string, unknown> = {
    message: {
      chat: { id: chatId, type: chatType },
      message_id: messageId,
      text: options?.text ?? (options?.voice || options?.photo || options?.sticker || options?.document ? undefined : "Test message"),
      voice: options?.voice,
      photo: options?.photo ? [{ file_id: "photo_1" }] : undefined,
      sticker: options?.sticker
        ? { file_id: "sticker_1", type: "regular" }
        : undefined,
      document: options?.document
        ? { file_id: "doc_1", file_name: "test.pdf" }
        : undefined,
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

// ---------------------------------------------------------------------------
// Update builders for integration tests (bot.handleUpdate)
// ---------------------------------------------------------------------------

/**
 * Create a Telegram Update object for a text message.
 */
export function createTextUpdate(
  chatId: number,
  text: string,
  messageId = 1,
): Record<string, unknown> {
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

/**
 * Create a Telegram Update object for a voice message.
 */
export function createVoiceUpdate(
  chatId: number,
  fileId: string,
  duration: number,
  messageId = 1,
): Record<string, unknown> {
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

/**
 * Create a Telegram Update object for a callback query (inline button tap).
 */
export function createCallbackUpdate(
  chatId: number,
  data: string,
  messageId: number,
): Record<string, unknown> {
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
      chat_instance: String(chatId),
      data,
    },
  };
}

/**
 * Create a Telegram Update object for a bot command.
 */
export function createCommandUpdate(
  chatId: number,
  command: string,
  args = "",
): Record<string, unknown> {
  const text = args ? `${command} ${args}` : command;
  return createTextUpdate(chatId, text);
}

/**
 * Create a Telegram Update object for a photo message.
 */
export function createPhotoUpdate(chatId: number): Record<string, unknown> {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: { id: chatId, is_bot: false, first_name: "Test" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      photo: [
        { file_id: "photo_small", file_unique_id: "ps", width: 90, height: 90 },
        { file_id: "photo_large", file_unique_id: "pl", width: 800, height: 600 },
      ],
    },
  };
}

/**
 * Create a Telegram Update object for a sticker message.
 */
export function createStickerUpdate(chatId: number): Record<string, unknown> {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: { id: chatId, is_bot: false, first_name: "Test" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      sticker: {
        file_id: "sticker_1",
        file_unique_id: "s1",
        type: "regular",
        width: 512,
        height: 512,
        is_animated: false,
        is_video: false,
      },
    },
  };
}

/**
 * Create a Telegram Update object for a document message.
 */
export function createDocumentUpdate(chatId: number): Record<string, unknown> {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: { id: chatId, is_bot: false, first_name: "Test" },
      chat: { id: chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      document: {
        file_id: "doc_1",
        file_unique_id: "d1",
        file_name: "test.pdf",
      },
    },
  };
}

/**
 * Create a Telegram Update object for a message in a group chat.
 */
export function createGroupTextUpdate(
  chatId: number,
  text: string,
): Record<string, unknown> {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: { id: chatId, is_bot: false, first_name: "Test" },
      chat: { id: chatId, type: "group", title: "Test Group" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}
