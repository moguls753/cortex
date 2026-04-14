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
import { resolveConfigValue } from "./config.js";
import { createLogger } from "./logger.js";
import { processCalendarEvent, getCalendarNames } from "./google-calendar.js";
import { getAllSettings } from "./web/settings-queries.js";
import { detectTaskCompletion, formatCompletionReply } from "./task-completion.js";

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
    let raw = settingValue;
    // Handle JSON array format (e.g. '["123","456"]')
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) raw = parsed.join(",");
      } catch { /* fall through to comma split */ }
    }
    return raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
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
    const [contextEntries, outputLanguage, calendarNames] = await Promise.all([
      assembleContext(sql, text),
      resolveConfigValue("output_language", sql).then((v) => v || undefined),
      getCalendarNames(sql),
    ]);

    // Classify
    const classResult = await classifyText(text, { contextEntries, outputLanguage, calendarNames, sql });

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

    // Calendar event creation (non-blocking)
    let calendarResult: { created: boolean; date?: string } | null = null;
    if (classResult.create_calendar_event) {
      try {
        calendarResult = await processCalendarEvent(sql, entryId, classResult);
      } catch {
        // Calendar errors never block entry storage
      }
    }

    // Task completion detection
    let completionResult: { autoCompleted: Array<{ entry_id: string; name: string; confidence: number }>; needsConfirmation: Array<{ entry_id: string; name: string; confidence: number }>; reclassifiedCategory: string | null } | null = null;
    if (classResult.is_task_completion) {
      try {
        completionResult = await detectTaskCompletion(
          text,
          {
            category: classResult.category,
            name: classResult.name,
            confidence: classResult.confidence,
            is_task_completion: true,
            fields: classResult.fields,
            tags: classResult.tags,
          },
          sql,
          entryId,
        );
      } catch {
        // Completion detection failure never blocks entry storage
      }
    }

    // Reply
    const reply = ctx.reply as (text: string, options?: unknown) => Promise<unknown>;
    const actualCategory = completionResult?.reclassifiedCategory
      ? capitalize(completionResult.reclassifiedCategory)
      : capitalize(classResult.category!);
    const nameStr = classResult.name;
    const pct = formatConfidence(classResult.confidence!);

    const hasCompletions = completionResult &&
      (completionResult.autoCompleted.length > 0 || completionResult.needsConfirmation.length > 0);

    if (hasCompletions) {
      const classText = confident
        ? `✅ Filed as ${actualCategory} → ${nameStr} (${pct})`
        : `❓ Best guess: ${actualCategory} → ${nameStr} (${pct})`;
      const formatted = formatCompletionReply({
        classificationText: classText,
        autoCompleted: completionResult!.autoCompleted,
        needsConfirmation: completionResult!.needsConfirmation,
      });
      const replyOptions: Record<string, unknown> = { parse_mode: undefined };
      // Merge completion buttons with category correction buttons if both exist
      const categoryButtons = !confident
        ? (buildInlineKeyboard(entryId) as { inline_keyboard: unknown[][] }).inline_keyboard
        : [];
      const completionButtons = formatted.inlineKeyboard ?? [];
      if (categoryButtons.length > 0 || completionButtons.length > 0) {
        replyOptions.reply_markup = {
          inline_keyboard: [...categoryButtons, ...completionButtons],
        };
      }
      await reply(formatted.text, replyOptions);
    } else if (confident) {
      await reply(
        `✅ Filed as ${actualCategory} → ${nameStr} (${pct}) — reply /fix to correct`,
        { parse_mode: undefined },
      );
    } else {
      await reply(
        `❓ Best guess: ${actualCategory} → ${nameStr} (${pct})`,
        { reply_markup: buildInlineKeyboard(entryId) },
      );
    }

    // Calendar confirmation
    if (calendarResult?.created && classResult.calendar_date) {
      await reply(`📅 Calendar event created for ${classResult.calendar_date}`);
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

    // Get file info from Telegram via bot API
    const api = (ctx as any).api;
    const file = await api.getFile(message.voice.file_id);
    const settings = await getAllSettings(sql);
    const botToken = settings.telegram_bot_token || "";
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
    const [contextEntries, outputLanguage, calendarNames] = await Promise.all([
      assembleContext(sql, transcript),
      resolveConfigValue("output_language", sql).then((v) => v || undefined),
      getCalendarNames(sql),
    ]);

    // Classify
    const classResult = await classifyText(transcript, { contextEntries, outputLanguage, calendarNames, sql });
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

    // Calendar event creation (non-blocking)
    let calendarResult: { created: boolean; date?: string } | null = null;
    if (classResult.create_calendar_event) {
      try {
        calendarResult = await processCalendarEvent(sql, entryId, classResult);
      } catch {
        // Calendar errors never block entry storage
      }
    }

    // Task completion detection
    let completionResult: { autoCompleted: Array<{ entry_id: string; name: string; confidence: number }>; needsConfirmation: Array<{ entry_id: string; name: string; confidence: number }>; reclassifiedCategory: string | null } | null = null;
    if (classResult.is_task_completion) {
      try {
        completionResult = await detectTaskCompletion(
          transcript,
          {
            category: classResult.category,
            name: classResult.name,
            confidence: classResult.confidence,
            is_task_completion: true,
            fields: classResult.fields,
            tags: classResult.tags,
          },
          sql,
          entryId,
        );
      } catch {
        // Completion detection failure never blocks entry storage
      }
    }

    // Reply with transcript + classification
    const actualCategory = completionResult?.reclassifiedCategory
      ? capitalize(completionResult.reclassifiedCategory)
      : capitalize(classResult.category!);
    const nameStr = classResult.name;
    const pct = formatConfidence(classResult.confidence!);

    const hasCompletions = completionResult &&
      (completionResult.autoCompleted.length > 0 || completionResult.needsConfirmation.length > 0);

    if (hasCompletions) {
      const classText = confident
        ? `🎤 '${transcript}'\n✅ Filed as ${actualCategory} → ${nameStr} (${pct})`
        : `🎤 '${transcript}'\n❓ Best guess: ${actualCategory} → ${nameStr} (${pct})`;
      const formatted = formatCompletionReply({
        classificationText: classText,
        autoCompleted: completionResult!.autoCompleted,
        needsConfirmation: completionResult!.needsConfirmation,
      });
      const replyOptions: Record<string, unknown> = { parse_mode: undefined };
      if (formatted.inlineKeyboard) {
        const existingButtons = !confident
          ? (buildInlineKeyboard(entryId) as { inline_keyboard: unknown[][] }).inline_keyboard
          : [];
        replyOptions.reply_markup = {
          inline_keyboard: [...existingButtons, ...formatted.inlineKeyboard],
        };
      } else if (!confident) {
        replyOptions.reply_markup = buildInlineKeyboard(entryId);
      }
      await reply(formatted.text, replyOptions);
    } else if (confident) {
      await reply(
        `🎤 '${transcript}'\n✅ Filed as ${actualCategory} → ${nameStr} (${pct})`,
        { parse_mode: undefined },
      );
    } else {
      await reply(
        `🎤 '${transcript}'\n❓ Best guess: ${actualCategory} → ${nameStr} (${pct})`,
        { reply_markup: buildInlineKeyboard(entryId) },
      );
    }

    // Calendar confirmation
    if (calendarResult?.created && classResult.calendar_date) {
      await reply(`📅 Calendar event created for ${classResult.calendar_date}`);
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

    // Handle task completion confirmation buttons
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (parts.length === 2 && (parts[0] === "task_complete_yes" || parts[0] === "task_complete_no")) {
      const [action, taskEntryId] = parts;
      const answer = ctx.answerCallbackQuery as () => Promise<unknown>;

      if (!UUID_RE.test(taskEntryId)) {
        await answer();
        return;
      }

      if (action === "task_complete_yes") {
        try {
          const { confirmTaskCompletion } = await import("./task-completion.js");
          await confirmTaskCompletion(taskEntryId, sql);

          const taskRows = await (sql as any)`SELECT name FROM entries WHERE id = ${taskEntryId}`;
          const taskName = taskRows.length > 0 ? (taskRows[0] as { name: string }).name : "task";

          // Append completion to existing message text instead of replacing it
          const originalText = (callbackQuery.message as any)?.text ?? "";
          const editMessageText = ctx.editMessageText as (text: string, options?: unknown) => Promise<unknown>;
          try {
            await editMessageText(`${originalText}\n✅ Marked '${taskName}' as done.`, { reply_markup: undefined });
          } catch {
            // Message may already be edited
          }
        } catch {
          // Confirmation failed — ignore
        }
      } else {
        // User tapped No — remove the inline keyboard but keep the message
        const originalText = (callbackQuery.message as any)?.text ?? "";
        const editMessageText = ctx.editMessageText as (text: string, options?: unknown) => Promise<unknown>;
        try {
          await editMessageText(originalText, { reply_markup: undefined });
        } catch {
          // Message may already be edited
        }
      }
      await answer();
      return;
    }

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
    const outputLanguage = (await resolveConfigValue("output_language", sql)) || undefined;
    const result = await reclassifyEntry(
      entry.content || "",
      newCategory,
      `User selected category: ${newCategory}`,
      outputLanguage,
      sql,
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
    const outputLanguage = (await resolveConfigValue("output_language", sql)) || undefined;
    const result = await reclassifyEntry(
      entry.content || "",
      entry.category || "",
      correctionText,
      outputLanguage,
      sql,
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

let botRunning = false;
let currentBot: InstanceType<typeof Bot> | null = null;

/** @internal Test-only — resets module state for test isolation */
export function resetBotState(): void {
  botRunning = false;
  currentBot = null;
}

export function isBotRunning(): boolean {
  return botRunning;
}

export async function stopBot(): Promise<void> {
  if (currentBot) {
    try {
      await currentBot.stop();
    } catch {
      // Ignore stop errors
    }
    currentBot = null;
  }
  botRunning = false;
}

export async function restartBot(sql: postgres.Sql): Promise<void> {
  await stopBot();
  await startBot(sql);
}

export async function startBot(sql: postgres.Sql): Promise<void> {
  if (botRunning) {
    log.info("Telegram bot already running — skipping");
    return;
  }
  // Claim the slot immediately before any async work to prevent races
  botRunning = true;

  const settings = await getAllSettings(sql);
  const token = settings.telegram_bot_token;

  if (!token) {
    botRunning = false;
    log.info("Telegram bot token not configured — skipping");
    return;
  }

  try {
    const bot = createBotWithHandlers(token, sql);
    bot.start({
      onStart: () => log.info("Telegram bot started in long-polling mode"),
    }).catch((err) => {
      const msg = (err as Error)?.message || String(err);
      log.error("Telegram bot polling stopped", { error: msg });
      botRunning = false;
      currentBot = null;
      // Auto-restart after transient errors (e.g. 409 conflict)
      setTimeout(() => {
        log.info("Attempting to restart Telegram bot...");
        startBot(sql).catch((restartErr) => {
          log.error("Telegram bot restart failed", {
            error: (restartErr as Error)?.message || String(restartErr),
          });
        });
      }, 5000);
    });
    currentBot = bot;
  } catch (err) {
    botRunning = false;
    throw err;
  }
}
