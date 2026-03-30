import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Sql } from "postgres";
import type { SSEBroadcaster } from "./web/sse.js";
import { createLLMProvider } from "./llm/index.js";
import { config, resolveConfigValue } from "./config.js";
import { getLLMConfig } from "./llm/config.js";
import { createLogger } from "./logger.js";
import {
  getDailyDigestData,
  getWeeklyReviewData,
  cacheDigest,
  getEntriesNeedingRetry,
  type DailyDigestData,
  type WeeklyReviewData,
} from "./digests-queries.js";
import { sendDigestEmail, isSmtpConfigured } from "./email.js";
import { embedEntry } from "./embed.js";
import { classifyEntry } from "./classify.js";
import cron from "node-cron";

const log = createLogger("digests");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "..", "prompts");

async function resolveOutputLanguage(sql: Sql): Promise<string> {
  const val = await resolveConfigValue("output_language", sql);
  if (val) return val;
  return "English";
}

function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), "utf-8");
}

function formatDailyPrompt(data: DailyDigestData, outputLanguage: string): string {
  const template = loadPrompt("daily-digest");

  const activeProjects = data.activeProjects.length > 0
    ? data.activeProjects.map((p) => `- ${p.name}: ${(p.fields as any).next_action}`).join("\n")
    : "None";

  const pendingFollowUps = data.pendingFollowUps.length > 0
    ? data.pendingFollowUps.map((p) => `- ${p.name}: ${(p.fields as any).follow_ups}`).join("\n")
    : "None";

  const upcomingTasks = data.upcomingTasks.length > 0
    ? data.upcomingTasks.map((t) => `- ${t.name} (due: ${(t.fields as any).due_date})`).join("\n")
    : "None";

  const yesterdayEntries = data.yesterdayEntries.length > 0
    ? data.yesterdayEntries.map((e) => `- [${e.category}] ${e.name}${e.content ? ": " + e.content.slice(0, 100) : ""}`).join("\n")
    : "None";

  return template
    .replace("{output_language}", outputLanguage)
    .replace("{active_projects}", activeProjects)
    .replace("{pending_follow_ups}", pendingFollowUps)
    .replace("{upcoming_tasks}", upcomingTasks)
    .replace("{yesterday_entries}", yesterdayEntries);
}

function formatWeeklyPrompt(data: WeeklyReviewData, outputLanguage: string): string {
  const template = loadPrompt("weekly-review");

  const weekEntries = data.weekEntries.length > 0
    ? data.weekEntries.map((e) => `- [${e.category}] ${e.name}${e.content ? ": " + e.content.slice(0, 100) : ""}`).join("\n")
    : "None";

  const dailyCounts = data.dailyCounts.length > 0
    ? data.dailyCounts.map((d) => `- ${d.date}: ${d.count} entries`).join("\n")
    : "No activity";

  const categoryCounts = data.categoryCounts.length > 0
    ? data.categoryCounts.map((c) => `- ${c.category}: ${c.count}`).join("\n")
    : "No entries";

  const stalledProjects = data.stalledProjects.length > 0
    ? data.stalledProjects.map((p) => `- ${p.name} (last updated: ${p.updated_at instanceof Date ? p.updated_at.toISOString().slice(0, 10) : p.updated_at})`).join("\n")
    : "None";

  return template
    .replace("{output_language}", outputLanguage)
    .replace("{entry_count}", String(data.weekEntries.length))
    .replace("{week_entries}", weekEntries)
    .replace("{daily_counts}", dailyCounts)
    .replace("{category_counts}", categoryCounts)
    .replace("{stalled_projects}", stalledProjects);
}

function formatDateInTz(tz: string): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: tz });
}

function getMondayInTz(tz: string): string {
  const now = new Date();
  const localDate = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const day = localDate.getDay();
  const diff = day === 0 ? 6 : day - 1;
  localDate.setDate(localDate.getDate() - diff);
  return localDate.toISOString().slice(0, 10);
}

async function resolveEmailConfig(sql: Sql): Promise<{
  to: string | undefined;
  from: string;
  smtp: { host: string; port: number; user: string; pass: string };
}> {
  const to = (await resolveConfigValue("digest_email_to", sql)) || undefined;
  const from = process.env.DIGEST_EMAIL_FROM || process.env.SMTP_USER || "";
  return {
    to,
    from,
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
  };
}

async function sendEmail(
  sql: Sql,
  subject: string,
  body: string,
): Promise<void> {
  if (!isSmtpConfigured()) return;

  const emailConfig = await resolveEmailConfig(sql);

  if (!emailConfig.to) {
    console.warn(JSON.stringify({ module: "email", message: "No recipient configured for digest email" }));
    return;
  }

  try {
    await sendDigestEmail({
      subject,
      body,
      to: emailConfig.to,
      from: emailConfig.from,
      smtp: emailConfig.smtp,
    });
  } catch (err) {
    console.error(JSON.stringify({
      module: "email",
      message: "Failed to send digest email",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

export async function generateDailyDigest(sql: Sql, broadcaster?: SSEBroadcaster): Promise<void> {
  try {
    // Check if LLM is configured before generating digest
    const llmConfig = await getLLMConfig(sql);
    const apiKey = llmConfig.apiKeys[llmConfig.provider] ?? "";
    const needsKey = llmConfig.provider !== "ollama" && llmConfig.provider !== "local";
    if (!llmConfig.provider || (needsKey && !apiKey)) {
      log.info("LLM not configured — skipping digest");
      return;
    }

    const data = await getDailyDigestData(sql);
    const outputLanguage = await resolveOutputLanguage(sql);
    const prompt = formatDailyPrompt(data, outputLanguage);

    const provider = createLLMProvider({
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKeys[llmConfig.provider] ?? "",
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl || undefined,
    });

    const response = await provider.chat(prompt);
    const content = response.trim();

    if (!content) {
      throw new Error("LLM returned empty response");
    }

    await cacheDigest(sql, "daily", content);

    if (broadcaster) {
      broadcaster.broadcast({
        type: "digest:updated",
        data: { digestType: "daily", content },
      });
    }

    const tz = (await resolveConfigValue("timezone", sql)) || config.timezone;
    const today = formatDateInTz(tz);
    await sendEmail(sql, `Cortex Daily — ${today}`, content);
  } catch (err) {
    console.error(JSON.stringify({
      module: "digests",
      type: "daily",
      message: "Digest generation failed",
      error: err instanceof Error ? err.message : String(err),
    }));

    try {
      await cacheDigest(sql, "daily", "Digest generation failed — will retry at next scheduled time");
    } catch {
      // ignore cache failure
    }
  }
}

export async function generateWeeklyReview(sql: Sql, broadcaster?: SSEBroadcaster): Promise<void> {
  try {
    // Check if LLM is configured before generating digest
    const llmConfig = await getLLMConfig(sql);
    const apiKey = llmConfig.apiKeys[llmConfig.provider] ?? "";
    const needsKey = llmConfig.provider !== "ollama" && llmConfig.provider !== "local";
    if (!llmConfig.provider || (needsKey && !apiKey)) {
      log.info("LLM not configured — skipping digest");
      return;
    }

    const data = await getWeeklyReviewData(sql);
    const outputLanguage = await resolveOutputLanguage(sql);
    const prompt = formatWeeklyPrompt(data, outputLanguage);

    const provider = createLLMProvider({
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKeys[llmConfig.provider] ?? "",
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl || undefined,
    });

    const response = await provider.chat(prompt);
    const content = response.trim();

    if (!content) {
      throw new Error("LLM returned empty response");
    }

    await cacheDigest(sql, "weekly", content);

    if (broadcaster) {
      broadcaster.broadcast({
        type: "digest:updated",
        data: { digestType: "weekly", content },
      });
    }

    const tz = (await resolveConfigValue("timezone", sql)) || config.timezone;
    const monday = getMondayInTz(tz);
    await sendEmail(sql, `Cortex Weekly — w/c ${monday}`, content);
  } catch (err) {
    console.error(JSON.stringify({
      module: "digests",
      type: "weekly",
      message: "Digest generation failed",
      error: err instanceof Error ? err.message : String(err),
    }));

    try {
      await cacheDigest(sql, "weekly", "Digest generation failed — will retry at next scheduled time");
    } catch {
      // ignore cache failure
    }
  }
}

export async function runBackgroundRetry(sql: Sql): Promise<void> {
  const entries = await getEntriesNeedingRetry(sql, 50);
  if (entries.length === 0) return;

  for (const entry of entries) {
    if (entry.embedding === null) {
      try {
        await embedEntry(sql, entry.id);
      } catch (err) {
        console.error(JSON.stringify({
          module: "digests",
          action: "embed_retry",
          entryId: entry.id,
          entryName: entry.name,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    if (entry.category === null) {
      try {
        await classifyEntry(sql, entry.id);
      } catch (err) {
        console.error(JSON.stringify({
          module: "digests",
          action: "classify_retry",
          entryId: entry.id,
          entryName: entry.name,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
  }
}

export async function startScheduler(
  sql: Sql,
  broadcaster: SSEBroadcaster,
): Promise<{ stop: () => void; reschedule: () => Promise<void> }> {
  let jobs: Array<{ stop: () => void }> = [];

  async function scheduleAll(): Promise<void> {
    // Stop existing jobs
    for (const job of jobs) {
      if (job && typeof job.stop === "function") {
        job.stop();
      }
    }
    jobs = [];

    const dailyCron = (await resolveConfigValue("daily_digest_cron", sql)) || "0 7 * * *";
    const weeklyCron = (await resolveConfigValue("weekly_digest_cron", sql)) || "0 8 * * 1";
    const timezone = (await resolveConfigValue("timezone", sql)) || config.timezone;

    const dailyJob = cron.schedule(dailyCron, () => {
      generateDailyDigest(sql, broadcaster);
    }, { timezone });

    const weeklyJob = cron.schedule(weeklyCron, () => {
      generateWeeklyReview(sql, broadcaster);
    }, { timezone });

    const retryJob = cron.schedule("*/15 * * * *", () => {
      runBackgroundRetry(sql);
    }, { timezone });

    jobs = [dailyJob, weeklyJob, retryJob];
  }

  await scheduleAll();

  return {
    stop() {
      for (const job of jobs) {
        job.stop();
      }
      jobs = [];
    },
    async reschedule() {
      await scheduleAll();
    },
  };
}
