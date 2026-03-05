import type postgres from "postgres";
import { Bot } from "grammy";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLLMProvider } from "./llm/index.js";
import {
  classifyText,
  assembleContext,
  isConfident,
  resolveConfidenceThreshold,
  reclassifyEntry,
  formatContextEntries,
  assemblePrompt,
  validateClassificationResponse,
} from "./classify.js";
import { generateEmbedding, embedEntry } from "./embed.js";
import { config, resolveConfigValue } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("telegram");

const CATEGORIES = ["People", "Projects", "Tasks", "Ideas", "Reference"];
const CATEGORY_VALUES = ["people", "projects", "tasks", "ideas", "reference"];

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

async function getAuthorizedChatIds(
  sql: postgres.Sql,
): Promise<string[]> {
  const settingValue = await resolveConfigValue("telegram_chat_ids", sql);
  if (settingValue) {
    try {
      const parsed = JSON.parse(settingValue);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // fall through to env var
    }
  }

  const envVar = process.env.TELEGRAM_CHAT_ID;
  if (envVar) {
    return envVar.split(",").map((id) => id.trim());
  }

  return [];
}

async function isAuthorized(
  chatId: number,
  sql: postgres.Sql,
): Promise<boolean> {
  const authorized = await getAuthorizedChatIds(sql);
  return authorized.includes(String(chatId));
}

// ---------------------------------------------------------------------------
// Reply formatting helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function buildInlineKeyboard(entryId: string) {
  return {
    inline_keyboard: [
      CATEGORIES.map((label, i) => ({
        text: label,
        callback_data: `correct:${entryId}:${CATEGORY_VALUES[i]}`,
      })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Whisper transcription
// ---------------------------------------------------------------------------

async function transcribeVoice(
  fileUrl: string,
): Promise<string | null> {
  const whisperUrl = process.env.WHISPER_URL || "http://whisper:8000";

  // Download audio from Telegram
  const audioResponse = await fetch(fileUrl);
  const audioBuffer = await audioResponse.arrayBuffer();

  // Send to faster-whisper
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer]), "voice.ogg");

  const response = await fetch(`${whisperUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: formData,
  });

  const data = (await response.json()) as { text?: string };
  const text = data.text?.trim();

  if (!text) return null;
  return text;
}

// ---------------------------------------------------------------------------
// handleTextMessage
// ---------------------------------------------------------------------------

export async function handleTextMessage(
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
): Promise<void> {
  try {
    const message = ctx.message as {
      chat: { id: number; type: string };
      text?: string;
    } | undefined;

    if (!message) return;

    // Only handle private chats
    if (message.chat.type !== "private") return;

    const text = message.text;

    // Ignore messages without text content
    if (!text || !text.trim()) return;

    // Authorization check
    const chatId = message.chat.id;
    if (!(await isAuthorized(chatId, sql))) return;

    // Gather context for classification
    const contextEntries = await assembleContext(sql, text);

    // Classify
    const classResult = await classifyText(text, { contextEntries });

    if (!classResult || classResult.category === null) {
      // Store unclassified
      await (sql as any)`
        INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type)
        VALUES (${"Untitled"}, ${text}, ${null}, ${null}, ${{}}, ${[]}, ${"telegram"}, ${"text"})
        RETURNING id
      `;
      const reply = ctx.reply as (text: string, options?: unknown) => Promise<unknown>;
      await reply("Stored but could not classify — will retry");
      return;
    }

    // Get confidence threshold
    const thresholdSetting = await resolveConfigValue("confidence_threshold", sql);
    const threshold = resolveConfidenceThreshold(thresholdSetting);
    const confident = isConfident(classResult.confidence!, threshold);

    // Store entry
    const rows = await (sql as any)`
      INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type)
      VALUES (${classResult.name}, ${text}, ${classResult.category}, ${classResult.confidence}, ${classResult.fields}, ${classResult.tags}, ${"telegram"}, ${"text"})
      RETURNING id
    `;
    const entryId = rows[0]?.id as string;

    // Generate embedding (non-blocking — don't fail on error)
    try {
      await embedEntry(sql, entryId);
    } catch {
      // Embedding will be retried by cron
    }

    // Reply
    const reply = ctx.reply as (text: string, options?: unknown) => Promise<unknown>;
    const category = capitalize(classResult.category!);
    const name = classResult.name;
    const pct = formatConfidence(classResult.confidence!);

    if (confident) {
      await reply(
        `✅ Filed as ${category} → ${name} (${pct}) — reply /fix to correct`,
        { parse_mode: undefined },
      );
    } else {
      await reply(
        `❓ Best guess: ${category} → ${name} (${pct})`,
        { reply_markup: buildInlineKeyboard(entryId) },
      );
    }
  } catch (error) {
    const reply = ctx.reply as (text: string) => Promise<unknown>;
    try {
      await reply("System temporarily unavailable");
    } catch {
      // Can't even reply
    }
  }
}

// ---------------------------------------------------------------------------
// handleVoiceMessage
// ---------------------------------------------------------------------------

export async function handleVoiceMessage(
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
): Promise<void> {
  try {
    const message = ctx.message as {
      chat: { id: number; type: string };
      voice?: { file_id: string; duration: number };
    } | undefined;

    if (!message?.voice) return;

    // Only handle private chats
    if (message.chat.type !== "private") return;

    // Authorization check
    const chatId = message.chat.id;
    if (!(await isAuthorized(chatId, sql))) return;

    // Get file info from Telegram
    const getFile = ctx.getFile as () => Promise<{ file_path: string }>;
    const file = await getFile();
    const botToken = config.telegramBotToken;
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

    // Transcribe
    let transcript: string | null;
    try {
      transcript = await transcribeVoice(fileUrl);
    } catch {
      const reply = ctx.reply as (text: string) => Promise<unknown>;
      await reply("Could not transcribe voice message. Please send as text.");
      return;
    }

    if (!transcript) {
      const reply = ctx.reply as (text: string) => Promise<unknown>;
      await reply("Could not transcribe voice message. Please send as text.");
      return;
    }

    // Gather context for classification
    const contextEntries = await assembleContext(sql, transcript);

    // Classify
    const classResult = await classifyText(transcript, { contextEntries });
    const reply = ctx.reply as (text: string, options?: unknown) => Promise<unknown>;

    if (!classResult || classResult.category === null) {
      // Store unclassified
      await (sql as any)`
        INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type)
        VALUES (${"Untitled"}, ${transcript}, ${null}, ${null}, ${{}}, ${[]}, ${"telegram"}, ${"voice"})
        RETURNING id
      `;
      await reply("Stored but could not classify — will retry");
      return;
    }

    // Get confidence threshold
    const thresholdSetting = await resolveConfigValue("confidence_threshold", sql);
    const threshold = resolveConfidenceThreshold(thresholdSetting);
    const confident = isConfident(classResult.confidence!, threshold);

    // Store entry
    const rows = await (sql as any)`
      INSERT INTO entries (name, content, category, confidence, fields, tags, source, source_type)
      VALUES (${classResult.name}, ${transcript}, ${classResult.category}, ${classResult.confidence}, ${classResult.fields}, ${classResult.tags}, ${"telegram"}, ${"voice"})
      RETURNING id
    `;
    const entryId = rows[0]?.id as string;

    // Generate embedding
    try {
      await embedEntry(sql, entryId);
    } catch {
      // Will retry
    }

    // Reply with transcript + classification
    const category = capitalize(classResult.category!);
    const name = classResult.name;
    const pct = formatConfidence(classResult.confidence!);

    if (confident) {
      await reply(
        `🎤 '${transcript}'\n✅ Filed as ${category} → ${name} (${pct})`,
        { parse_mode: undefined },
      );
    } else {
      await reply(
        `🎤 '${transcript}'\n❓ Best guess: ${category} → ${name} (${pct})`,
        { reply_markup: buildInlineKeyboard(entryId) },
      );
    }
  } catch (error) {
    const reply = ctx.reply as (text: string) => Promise<unknown>;
    try {
      await reply("System temporarily unavailable");
    } catch {
      // Can't even reply
    }
  }
}

// ---------------------------------------------------------------------------
// handleCallbackQuery
// ---------------------------------------------------------------------------

export async function handleCallbackQuery(
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
): Promise<void> {
  try {
    const callbackQuery = ctx.callbackQuery as {
      data: string;
      message?: { chat: { id: number }; message_id: number };
    } | undefined;

    if (!callbackQuery?.data) {
      const answer = ctx.answerCallbackQuery as () => Promise<unknown>;
      await answer();
      return;
    }

    const parts = callbackQuery.data.split(":");
    if (parts.length !== 3 || parts[0] !== "correct") {
      const answer = ctx.answerCallbackQuery as () => Promise<unknown>;
      await answer();
      return;
    }

    const [, entryId, newCategory] = parts;

    // Look up the entry
    const rows = await (sql as any)`
      SELECT id, category, confidence, content, deleted_at FROM entries WHERE id = ${entryId}
    `;

    if (rows.length === 0) {
      log.warn("Callback query references non-existent entry", { entryId });
      const answer = ctx.answerCallbackQuery as () => Promise<unknown>;
      await answer();
      return;
    }

    const entry = rows[0] as {
      id: string;
      category: string | null;
      confidence: number | null;
      content: string | null;
      deleted_at: Date | null;
    };

    // Already corrected (confidence is null) or deleted — acknowledge but don't reprocess
    if (entry.confidence === null || entry.deleted_at !== null) {
      const answer = ctx.answerCallbackQuery as () => Promise<unknown>;
      await answer();
      return;
    }

    // Re-classify with the correction
    const result = await reclassifyEntry(
      entry.content || "",
      newCategory,
      `User selected category: ${newCategory}`,
    );

    const finalCategory = result?.category || newCategory;
    const finalName = result?.name || entry.category || "Unknown";
    const finalFields = result?.fields || {};
    const finalTags = result?.tags || [];

    // Update entry — set confidence to null (human-corrected)
    await (sql as any)`
      UPDATE entries SET
        category = ${finalCategory},
        name = ${finalName},
        confidence = ${null},
        fields = ${finalFields},
        tags = ${finalTags}
      WHERE id = ${entryId}
    `;

    // Re-generate embedding
    try {
      await embedEntry(sql, entryId);
    } catch {
      // Will retry
    }

    // Edit original message
    const editMessageText = ctx.editMessageText as (
      text: string,
      options?: unknown,
    ) => Promise<unknown>;
    await editMessageText(`✅ Fixed → ${capitalize(finalCategory)} → ${finalName}`, {
      reply_markup: undefined,
    });

    const answer = ctx.answerCallbackQuery as () => Promise<unknown>;
    await answer();
  } catch (error) {
    try {
      const answer = ctx.answerCallbackQuery as () => Promise<unknown>;
      await answer();
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// handleFixCommand
// ---------------------------------------------------------------------------

export async function handleFixCommand(
  ctx: Record<string, unknown>,
  sql: postgres.Sql,
): Promise<void> {
  try {
    const message = ctx.message as {
      chat: { id: number; type: string };
      text?: string;
    } | undefined;

    if (!message?.text) return;

    const text = message.text;

    // Authorization check first
    const chatId = message.chat.id;
    if (!(await isAuthorized(chatId, sql))) return;

    const reply = ctx.reply as (text: string) => Promise<unknown>;

    // Extract correction text after "/fix "
    const correctionText = text.startsWith("/fix ")
      ? text.slice(5).trim()
      : text === "/fix"
        ? ""
        : text.slice(4).trim();

    if (!correctionText) {
      await reply("Usage: /fix <correction description>");
      return;
    }

    // Find most recent telegram entry
    const rows = await (sql as any)`
      SELECT id, content, category, source FROM entries
      WHERE source = 'telegram' AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      await reply("No recent entry to fix");
      return;
    }

    const entry = rows[0] as {
      id: string;
      content: string | null;
      category: string | null;
      source: string;
    };

    // Re-classify with correction
    const result = await reclassifyEntry(
      entry.content || "",
      entry.category || "",
      correctionText,
    );

    if (result) {
      // Update entry
      await (sql as any)`
        UPDATE entries SET
          category = ${result.category},
          name = ${result.name},
          confidence = ${result.confidence},
          fields = ${result.fields},
          tags = ${result.tags}
        WHERE id = ${entry.id}
      `;

      // Re-generate embedding
      try {
        await embedEntry(sql, entry.id);
      } catch {
        // Will retry
      }

      await reply(`✅ Fixed → ${capitalize(result.category)} → ${result.name}`);
    } else {
      await reply("Could not re-classify entry");
    }
  } catch (error) {
    const reply = ctx.reply as (text: string) => Promise<unknown>;
    try {
      await reply("System temporarily unavailable");
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// createBotWithHandlers
// ---------------------------------------------------------------------------

export function createBotWithHandlers(
  token: string,
  sql: postgres.Sql,
) {
  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/fix")) {
      await handleFixCommand(ctx as unknown as Record<string, unknown>, sql);
    } else {
      await handleTextMessage(ctx as unknown as Record<string, unknown>, sql);
    }
  });

  bot.on("message:voice", async (ctx) => {
    await handleVoiceMessage(ctx as unknown as Record<string, unknown>, sql);
  });

  bot.on("callback_query:data", async (ctx) => {
    await handleCallbackQuery(ctx as unknown as Record<string, unknown>, sql);
  });

  bot.catch((err) => {
    log.error("Bot error", { error: (err.error as Error)?.message || String(err) });
  });

  return bot;
}

// ---------------------------------------------------------------------------
// startBot
// ---------------------------------------------------------------------------

export async function startBot(sql: postgres.Sql): Promise<void> {
  const token = config.telegramBotToken;

  if (!token) {
    log.warn("TELEGRAM_BOT_TOKEN not set — skipping bot startup");
    return;
  }

  const bot = createBotWithHandlers(token, sql);

  // Start in long-polling mode (no webhook)
  bot.start();

  log.info("Telegram bot started in long-polling mode");
}
