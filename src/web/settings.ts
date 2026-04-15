import { Hono } from "hono";
import type postgres from "postgres";
import { CronExpressionParser } from "cron-parser";
import { renderLayout } from "./layout.js";
import { getAllSettings, saveAllSettings } from "./settings-queries.js";
import { escapeHtml } from "./shared.js";
import { getLLMConfig, saveLLMConfig } from "../llm/config.js";
import type { LLMConfig } from "../llm/config.js";
import { restartBot } from "../telegram.js";
import { createLogger } from "../logger.js";

const log = createLogger("settings");
import {
  iconBrain,
  iconClock,
  iconShield,
  iconCheck,
  iconX,
  iconAlertTriangle,
  iconPlay,
  iconDownload,
  iconSearch,
  iconMonitor,
  iconCalendar,
} from "./icons.js";
import { generateDailyDigest, generateWeeklyReview } from "../digests.js";
import type { SSEBroadcaster } from "./sse.js";
import { exchangeAuthCode } from "../google-calendar.js";

type Sql = postgres.Sql;

const DEFAULTS: Record<string, string> = {
  daily_digest_cron: "30 7 * * *",
  weekly_digest_cron: "0 16 * * 0",
  timezone: "Europe/Berlin",
  confidence_threshold: "0.6",
  ollama_url: "http://ollama:11434",
  digest_email_to: "",
  output_language: "English",
};

const LANGUAGE_OPTIONS = [
  "English", "German", "French", "Spanish", "Italian",
  "Portuguese", "Dutch", "Polish", "Turkish", "Japanese", "Chinese", "Korean",
];


const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; needsKey: boolean }> = {
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  openai:    { label: "OpenAI (ChatGPT)", baseUrl: "https://api.openai.com/v1", needsKey: true },
  groq:      { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  gemini:    { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true },
  local:     { label: "LM Studio", baseUrl: "http://localhost:1234/v1", needsKey: false },
  ollama:    { label: "Ollama (Local)", baseUrl: "http://ollama:11434/v1", needsKey: false },
};

async function fetchProviderModels(provider: string, apiKey: string, baseUrl: string): Promise<string[]> {
  if (!apiKey) return [];
  try {
    if (provider === "anthropic") {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: { id: string }[] };
      return (data.data ?? []).map((m) => m.id);
    }
    // OpenAI-compatible: openai, groq, gemini
    const url = `${baseUrl}/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).sort();
  } catch {
    return [];
  }
}

function resolveEffective(
  dbSettings: Record<string, string>,
  key: string,
  defaultValue: string,
): string {
  if (dbSettings[key] !== undefined) return dbSettings[key];
  return defaultValue;
}

function resolveChatIds(dbSettings: Record<string, string>): string[] {
  if (dbSettings.telegram_chat_ids) {
    let raw = dbSettings.telegram_chat_ids;
    // Handle legacy JSON array format (e.g. '["123","456"]')
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

function isValidCron(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr.trim());
    return true;
  } catch {
    return false;
  }
}

function parseDisplayCalendars(raw: string): string {
  // Comma-separated → trimmed JSON array. Empty input → empty string (absent setting).
  if (!raw.trim()) return "";
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.length === 0 ? "" : JSON.stringify(names);
}

function validateSettings(form: Record<string, string>): string | null {
  // Chat IDs
  const chatIds = (form.chat_ids || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (chatIds.length === 0) {
    return "At least one authorized chat ID is required.";
  }
  for (const id of chatIds) {
    if (!/^-?\d+$/.test(id)) {
      return "Chat ID must be numeric.";
    }
  }

  // Confidence threshold
  const threshold = parseFloat(form.confidence_threshold);
  if (isNaN(threshold) || threshold < 0.0 || threshold > 1.0) {
    return "Confidence threshold must be between 0.0 and 1.0.";
  }

  // Cron expressions
  if (!isValidCron(form.daily_digest_cron)) {
    return "Invalid cron expression for daily digest.";
  }
  if (!isValidCron(form.weekly_digest_cron)) {
    return "Invalid cron expression for weekly digest.";
  }

  // Google Calendar duration
  const gcalDuration = form.google_calendar_default_duration;
  if (gcalDuration) {
    const dur = parseInt(gcalDuration, 10);
    if (isNaN(dur) || dur < 15) {
      return "Calendar event duration must be at least 15 minutes.";
    }
    if (dur > 480) {
      return "Calendar event duration must be at most 480 minutes.";
    }
  }

  // Kitchen display — max today events
  if (form.display_max_today_events) {
    const n = parseInt(form.display_max_today_events, 10);
    if (isNaN(n) || n < 1 || n > 30) {
      return "Max Today Events must be an integer between 1 and 30.";
    }
  }

  // Kitchen display — base URL override
  if (form.display_base_url) {
    try {
      const u = new URL(form.display_base_url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return "Display Base URL must use http:// or https://.";
      }
    } catch {
      return "Display Base URL is not a valid URL.";
    }
  }

  return null;
}

export function createSettingsRoutes(sql: Sql, broadcaster?: SSEBroadcaster): Hono {
  const app = new Hono();

  app.get("/settings", async (c) => {
    const dbSettings = (await getAllSettings(sql)) ?? {};

    const llmConfig = await getLLMConfig(sql);
    const llmProvider = llmConfig.provider;
    const llmModel = llmConfig.model;
    const llmBaseUrl = llmConfig.baseUrl;
    const dailyCron = resolveEffective(dbSettings, "daily_digest_cron", DEFAULTS.daily_digest_cron);
    const weeklyCron = resolveEffective(dbSettings, "weekly_digest_cron", DEFAULTS.weekly_digest_cron);
    const timezone = resolveEffective(dbSettings, "timezone", process.env.TZ || DEFAULTS.timezone);
    const threshold = resolveEffective(dbSettings, "confidence_threshold", DEFAULTS.confidence_threshold);
    const ollamaUrl = resolveEffective(dbSettings, "ollama_url", DEFAULTS.ollama_url);
    const email = resolveEffective(dbSettings, "digest_email_to", DEFAULTS.digest_email_to);
    const chatIds = resolveChatIds(dbSettings);
    const outputLanguage = resolveEffective(dbSettings, "output_language", DEFAULTS.output_language);

    // Telegram bot token
    const telegramBotToken = dbSettings.telegram_bot_token || "";

    // Google Calendar config
    const gcalId = dbSettings.google_calendar_id || "";
    const gcalDuration = dbSettings.google_calendar_default_duration || "60";

    // Multi-calendar
    let gcalCalendars: Record<string, string> = {};
    let gcalDefault = dbSettings.google_calendar_default || "";
    const gcalCalendarsJson = dbSettings.google_calendars;
    if (gcalCalendarsJson) {
      try {
        gcalCalendars = JSON.parse(gcalCalendarsJson);
      } catch { /* ignore invalid JSON */ }
    }
    const isMultiCalendar = Object.keys(gcalCalendars).length >= 2;
    const gcalRefreshToken = dbSettings.google_refresh_token || "";
    const gcalClientId = dbSettings.google_client_id || "";
    const gcalClientSecret = dbSettings.google_client_secret || "";

    // Kitchen Display config
    const displayEnabled = dbSettings.display_enabled || "";
    const displayToken = dbSettings.display_token || "";
    const displayWeatherLat = dbSettings.display_weather_lat || "";
    const displayWeatherLng = dbSettings.display_weather_lng || "";
    const displayMaxTasks = dbSettings.display_max_tasks || "7";
    const displayMaxTodayEvents = dbSettings.display_max_today_events || "8";
    const displayWidth = dbSettings.display_width || "";
    const displayHeight = dbSettings.display_height || "";
    const displayBaseUrl = dbSettings.display_base_url || "";
    // display_calendars is stored as JSON array of calendar display names.
    // The form uses a comma-separated text input for simplicity; empty means "all".
    let displayCalendarsDisplay = "";
    if (dbSettings.display_calendars) {
      try {
        const parsed = JSON.parse(dbSettings.display_calendars) as unknown;
        if (Array.isArray(parsed)) {
          displayCalendarsDisplay = parsed.filter((v) => typeof v === "string").join(", ");
        }
      } catch { /* invalid JSON — show as empty, save will normalize */ }
    }
    const gcalConnected = !!gcalRefreshToken;

    // If tokens exist, try to validate them
    let gcalValidated = gcalConnected;
    if (gcalConnected && gcalClientId) {
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: gcalRefreshToken,
            client_id: gcalClientId,
            client_secret: gcalClientSecret,
          }),
          signal: AbortSignal.timeout(3000),
        });
        if (!tokenRes.ok) gcalValidated = false;
      } catch {
        gcalValidated = false;
      }
    }

    // Fetch models for the currently selected provider
    let providerModels: string[] = [];
    const activePreset = PROVIDER_PRESETS[llmProvider];
    if (activePreset?.needsKey) {
      const key = llmConfig.apiKeys[llmProvider] ?? "";
      const effectiveBaseUrl = llmBaseUrl || activePreset.baseUrl || "";
      providerModels = await fetchProviderModels(llmProvider, key, effectiveBaseUrl);
    }

    // Fetch available Ollama models
    let ollamaModels: string[] = [];
    try {
      const tagsRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (tagsRes.ok) {
        const tagsData = await tagsRes.json() as { models?: { name: string }[] };
        ollamaModels = (tagsData.models ?? []).map((m) => m.name);
      }
    } catch { /* Ollama unreachable — show empty list */ }

    const success = c.req.query("success") || "";
    const error = c.req.query("error") || "";
    const warning = c.req.query("warning") || "";

    const flashHtml = [
      success
        ? `<div class="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            ${iconCheck("size-3 text-primary")}
            <span>${escapeHtml(success)}</span>
          </div>`
        : "",
      error
        ? `<div class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            ${iconX("size-3 text-destructive")}
            <span>${escapeHtml(error)}</span>
          </div>`
        : "",
      warning
        ? `<div class="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
            ${iconAlertTriangle("size-3")}
            <span>${escapeHtml(warning)}</span>
          </div>`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const chatIdChips = chatIds
      .map(
        (id) =>
          `<span class="inline-flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-sm font-mono text-foreground" data-chip>
            <span>${escapeHtml(id)}</span>
            <button type="button" class="chat-id-remove text-muted-foreground hover:text-destructive transition-colors" data-id="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(id)}">
              ${iconX("size-3")}
            </button>
          </span>`,
      )
      .join("\n");

    const thresholdPercent = Math.round(parseFloat(threshold) * 100);

    const content = `
    <main class="flex-1 overflow-y-auto scrollbar-thin pr-2">
      <form method="POST" action="/settings" class="space-y-3 pb-4">

        <div class="flex items-center justify-between">
          <h1 class="text-lg font-medium tracking-tight">Settings</h1>
        </div>

        ${flashHtml}

        <!-- ═══ Telegram ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconShield("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Telegram</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>
          <div class="space-y-3">
            <div class="flex flex-col gap-1.5">
              <label for="telegram_bot_token" class="text-xs text-muted-foreground">Bot Token</label>
              <input type="password" id="telegram_bot_token" name="telegram_bot_token" value="${escapeHtml(telegramBotToken)}"
                autocomplete="new-password"
                placeholder="${telegramBotToken ? "••••••••  (leave blank to keep)" : "Bot token from @BotFather"}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              <span class="text-[10px] text-muted-foreground">Requires app restart to take effect.</span>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-muted-foreground">Authorized Chat IDs</label>
              <div id="chat-id-list" class="flex flex-wrap gap-1.5 min-h-[28px]">
                ${chatIdChips}
              </div>
              <div class="flex items-center gap-2 mt-1">
                <div class="flex items-center gap-0 flex-1 max-w-xs">
                  <input type="text" id="new-chat-id" placeholder="Enter chat ID..."
                    class="h-8 flex-1 rounded-l-md border border-r-0 border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
                  <button type="button" id="add-chat-id-btn"
                    class="h-8 rounded-r-md border border-border bg-secondary px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors">Add</button>
                </div>
              </div>
              <input type="hidden" name="chat_ids" id="chat-ids-input" value="${escapeHtml(chatIds.join(","))}" />
            </div>
          </div>
        </div>

        <!-- ═══ Classification ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconBrain("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Language Model</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>

          <!-- Row 1: Provider + Model -->
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label for="llm_provider" class="text-xs text-muted-foreground">Provider</label>
              <select id="llm_provider" name="llm_provider"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary">
                ${Object.entries(PROVIDER_PRESETS).map(([value, p]) =>
                  `<option value="${escapeHtml(value)}"${llmProvider === value ? " selected" : ""}>${escapeHtml(p.label)}</option>`
                ).join("")}
              </select>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-muted-foreground">Model</label>
              ${(() => {
                const isTextProvider = llmProvider === "local" || llmProvider === "ollama";
                if (isTextProvider) {
                  return `<input type="text" id="llm_model_text"
                    value="${escapeHtml(llmModel)}"
                    placeholder="e.g. qwen2.5:7b"
                    class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
                  <input type="hidden" id="llm_model" name="llm_model" value="${escapeHtml(llmModel)}" />`;
                }
                if (providerModels.length > 0) {
                  const otherSel = !providerModels.includes(llmModel) ? " selected" : "";
                  const opts = providerModels.map(m =>
                    `<option value="${escapeHtml(m)}"${llmModel === m ? " selected" : ""}>${escapeHtml(m)}</option>`
                  ).join("") + `<option value="__other__"${otherSel}>Other...</option>`;
                  return `<select id="llm_model_select"
                    class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary">
                    ${opts}
                  </select>
                  <input type="text" id="llm_model_text"
                    value="${escapeHtml(llmModel)}"
                    placeholder="Model name..."
                    class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary hidden" />
                  <input type="hidden" id="llm_model" name="llm_model" value="${escapeHtml(llmModel)}" />`;
                }
                return `<input type="text" id="llm_model_text"
                    value="${escapeHtml(llmModel)}"
                    placeholder="Type model name..."
                    class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
                  <span id="model-key-hint" class="text-[10px] text-muted-foreground italic">Enter an API key to see available models</span>
                  <input type="hidden" id="llm_model" name="llm_model" value="${escapeHtml(llmModel)}" />`;
              })()}
            </div>
          </div>

          <!-- Row 2: API Key (scoped to active provider) -->
          ${(() => {
            const activeNeedsKey = PROVIDER_PRESETS[llmProvider]?.needsKey ?? false;
            const activeLabel = PROVIDER_PRESETS[llmProvider]?.label ?? llmProvider;
            const activeVal = escapeHtml(llmConfig.apiKeys[llmProvider as keyof typeof llmConfig.apiKeys] ?? "");

            return `<div id="apikey-row" class="mt-3 flex flex-col gap-1.5${!activeNeedsKey ? " hidden" : ""}">
              <label id="apikey-label" class="text-xs text-muted-foreground">
                <span id="apikey-provider-name">${escapeHtml(activeLabel)}</span> API Key
              </label>
              <input type="password" id="apikey_active" value="${activeVal}"
                autocomplete="new-password"
                placeholder="Paste key..."
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
            </div>`;
          })()}
          <!-- Hidden inputs carry all API keys for form submission -->
          ${(["anthropic", "openai", "groq", "gemini"] as const).map(p => {
            const val = escapeHtml(llmConfig.apiKeys[p] ?? "");
            return `<input type="hidden" id="apikey_${p}" name="apikey_${p}" value="${val}" />`;
          }).join("\n          ")}

          <!-- Row 3: Base URL (hidden for anthropic) -->
          <div id="base-url-row" class="mt-3 flex flex-col gap-1.5${llmProvider === "ollama" ? " hidden" : ""}">
            <label for="llm_base_url" class="text-xs text-muted-foreground">Base URL</label>
            <input type="text" id="llm_base_url" name="llm_base_url" value="${escapeHtml(llmBaseUrl)}"
              class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
          </div>

          <input type="hidden" name="ollama_url" value="${escapeHtml(ollamaUrl)}" />

          <!-- Ollama model picker + RAM table -->
          <div id="ollama-section" class="mt-3 space-y-3${llmProvider !== "ollama" ? " hidden" : ""}">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <div class="text-[10px] uppercase tracking-widest text-muted-foreground">Available in Ollama</div>
                <button type="button" id="ollama-pull-btn"
                  class="flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary transition-colors">
                  ${iconDownload("size-3")} Pull Model
                </button>
              </div>
              ${ollamaModels.length > 0
                ? `<div id="ollama-model-chips" class="flex flex-wrap gap-1.5">
                    ${ollamaModels.map(m =>
                      `<button type="button" data-ollama-model="${escapeHtml(m)}"
                        class="ollama-model-chip rounded border border-border bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:border-primary hover:text-primary transition-colors${llmModel === m ? " border-primary text-primary" : ""}">
                        ${escapeHtml(m)}
                      </button>`
                    ).join("")}
                  </div>`
                : `<div id="ollama-model-chips" class="flex flex-wrap gap-1.5">
                    <span id="no-models-hint" class="text-[10px] text-muted-foreground">No models pulled yet — click Pull Model or type a name below.</span>
                  </div>`
              }
              ${llmProvider === "ollama" && llmModel && !ollamaModels.includes(llmModel)
                ? `<div class="mt-1.5 text-[10px] text-yellow-600 dark:text-yellow-400">${iconAlertTriangle("size-3 inline")} Model <span class="font-mono">${escapeHtml(llmModel)}</span> not available yet — a download may still be in progress. Click Pull Model to start or resume.</div>`
                : ""
              }
              <!-- Pull progress -->
              <div id="ollama-pull-progress" class="hidden mt-2">
                <div class="flex items-center justify-between mb-1">
                  <span id="pull-status-text" class="text-[10px] font-mono text-muted-foreground">Preparing...</span>
                  <span id="pull-percent-text" class="text-[10px] font-mono text-primary"></span>
                </div>
                <div class="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div id="pull-progress-bar" class="h-full rounded-full bg-primary transition-all duration-300 w-0"></div>
                </div>
                <div id="pull-layer-detail" class="text-[10px] font-mono text-muted-foreground mt-1 truncate"></div>
              </div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Recommended Models</div>
              <table class="w-full text-[10px]">
                <thead>
                  <tr class="text-muted-foreground">
                    <th class="text-left pb-1 font-medium">Model</th>
                    <th class="text-left pb-1 font-medium">RAM</th>
                    <th class="text-left pb-1 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  <tr><td class="py-1 font-mono pr-4">qwen2.5:3b</td><td class="py-1 pr-4 text-muted-foreground">~2.5 GB</td><td class="py-1 text-muted-foreground">Fast, basic quality</td></tr>
                  <tr><td class="py-1 font-mono pr-4">qwen2.5:7b</td><td class="py-1 pr-4 text-muted-foreground">~4.7 GB</td><td class="py-1 text-primary font-medium">Recommended</td></tr>
                  <tr><td class="py-1 font-mono pr-4">qwen2.5:14b</td><td class="py-1 pr-4 text-muted-foreground">~9 GB</td><td class="py-1 text-muted-foreground">Best quality</td></tr>
                  <tr><td class="py-1 font-mono pr-4">mistral-nemo:12b</td><td class="py-1 pr-4 text-muted-foreground">~7.5 GB</td><td class="py-1 text-muted-foreground">Alternative</td></tr>
                  <tr><td class="py-1 font-mono pr-4">llama3.2:3b</td><td class="py-1 pr-4 text-muted-foreground">~2.5 GB</td><td class="py-1 text-muted-foreground">Fast, EN only</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Row 4: Confidence -->
          <div class="mt-3 flex flex-col gap-1.5 max-w-sm">
            <label for="confidence_threshold" class="text-xs text-muted-foreground">Confidence Threshold</label>
            <div class="flex items-center gap-3">
              <input type="range" id="confidence_range" min="0" max="100" value="${thresholdPercent}"
                class="flex-1" />
              <input type="text" id="confidence_threshold" name="confidence_threshold" value="${escapeHtml(threshold)}"
                class="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm text-center font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
            <span class="text-[10px] text-muted-foreground">Below this threshold, Telegram replies include correction buttons to fix the category.</span>
          </div>
        </div>

        <!-- ═══ Embeddings ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconSearch("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Embeddings</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-muted-foreground">Model</label>
            <input type="text" value="qwen3-embedding" readonly
              class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none cursor-default" />
            <span class="text-[10px] text-muted-foreground">Generates vector embeddings for all entries via the Ollama container.</span>
          </div>
        </div>

        <!-- ═══ Digests ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconClock("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Digests</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label for="daily_digest_cron" class="text-xs text-muted-foreground">Daily Schedule</label>
              <div class="flex items-center gap-2">
                <span class="text-primary text-xs select-none shrink-0">cron</span>
                <input type="text" id="daily_digest_cron" name="daily_digest_cron" value="${escapeHtml(dailyCron)}"
                  class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="weekly_digest_cron" class="text-xs text-muted-foreground">Weekly Schedule</label>
              <div class="flex items-center gap-2">
                <span class="text-primary text-xs select-none shrink-0">cron</span>
                <input type="text" id="weekly_digest_cron" name="weekly_digest_cron" value="${escapeHtml(weeklyCron)}"
                  class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4 mt-3">
            <div class="flex flex-col gap-1.5">
              <label for="digest_email_to" class="text-xs text-muted-foreground">Email Delivery</label>
              <input type="text" id="digest_email_to" name="digest_email_to" value="${escapeHtml(email)}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="Leave empty to disable" />
              ${email === "" ? `<span class="text-[10px] text-muted-foreground">Disabled — digests available on dashboard only</span>` : ""}
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="timezone" class="text-xs text-muted-foreground">Timezone</label>
              <input type="text" id="timezone" name="timezone" value="${escapeHtml(timezone)}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4 mt-3">
            <div class="flex flex-col gap-1.5">
              <label for="output_language" class="text-xs text-muted-foreground">Output Language</label>
              <select id="output_language" name="output_language"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary">
                ${LANGUAGE_OPTIONS.map(lang =>
                  `<option value="${lang}"${outputLanguage === lang ? " selected" : ""}>${lang}</option>`
                ).join("")}
                ${!LANGUAGE_OPTIONS.includes(outputLanguage)
                  ? `<option value="${escapeHtml(outputLanguage)}" selected>${escapeHtml(outputLanguage)}</option>`
                  : ""}
              </select>
              <span class="text-[10px] text-muted-foreground">Digests, classification names, and tags</span>
            </div>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <span class="text-xs text-muted-foreground">Generate now</span>
            <button type="button" id="trigger-daily"
              class="flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors">
              ${iconPlay("size-3")} Daily
            </button>
            <button type="button" id="trigger-weekly"
              class="flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors">
              ${iconPlay("size-3")} Weekly
            </button>
            <span id="digest-status" class="text-[10px] text-muted-foreground hidden"></span>
          </div>
        </div>

        <!-- ═══ Google Calendar ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconCalendar("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Google Calendar</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>
          <div class="space-y-3">
            <!-- OAuth Credentials -->
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label class="text-xs text-muted-foreground">Client ID</label>
                <input type="text" name="google_client_id" value="${escapeHtml(gcalClientId)}"
                  placeholder="From Google Cloud Console"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-xs text-muted-foreground">Client Secret</label>
                <input type="password" name="google_client_secret" value=""
                  autocomplete="new-password"
                  placeholder="${gcalClientSecret ? "••••••••  (leave blank to keep)" : "From Google Cloud Console"}"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              </div>
            </div>

            <!-- Connection status + actions -->
            <div class="flex items-center gap-3">
              ${gcalValidated
                ? `<span class="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">${iconCheck("size-3")} Connected</span>
                   <button type="button"
                     class="flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20 hover:border-destructive/50 transition-colors"
                     onclick="if(confirm('Disconnect Google Calendar?')){var f=document.createElement('form');f.method='POST';f.action='/settings/google-calendar/disconnect';document.body.appendChild(f);f.submit();}">
                     ${iconX("size-3")} Disconnect
                   </button>`
                : `<span class="text-xs text-muted-foreground">Not connected</span>
                   ${gcalClientId
                     ? `<a href="https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(gcalClientId)}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=https://www.googleapis.com/auth/calendar&access_type=offline&prompt=consent"
                         target="_blank" rel="noopener"
                         class="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors">Connect</a>`
                     : `<span class="text-xs text-muted-foreground">Save credentials to enable connection</span>`
                   }`
              }
            </div>
            ${!gcalValidated && gcalClientId
              ? `<div class="flex items-center gap-2">
                   <input type="text" id="gcal-auth-code" placeholder="Paste authorization code..."
                     class="h-8 flex-1 rounded-l-md border border-r-0 border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
                   <button type="button" id="gcal-connect-btn"
                     class="h-8 rounded-r-md border border-border bg-secondary px-2.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
                     onclick="(function(){var code=document.getElementById('gcal-auth-code').value;if(code){var f=document.createElement('form');f.method='POST';f.action='/settings/google-calendar/connect';var i=document.createElement('input');i.type='hidden';i.name='code';i.value=code;f.appendChild(i);document.body.appendChild(f);f.submit();}})()">Connect</button>
                 </div>`
              : ""
            }

            <!-- Calendar config (only when connected) -->
            ${gcalValidated ? `
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <label class="text-xs text-muted-foreground">Calendars</label>
                <button type="button" id="gcal-add-btn"
                  class="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">+ Add</button>
              </div>
              <div class="space-y-2" id="gcal-calendar-list">
                ${(() => {
                  // Merge legacy single calendar + multi-calendar entries into one list
                  const entries: [string, string][] = Object.entries(gcalCalendars);
                  if (entries.length === 0 && gcalId) {
                    entries.push(["Default", gcalId]);
                  }
                  if (entries.length === 0) {
                    return `<span id="gcal-empty-hint" class="text-[10px] text-muted-foreground">No calendars added yet.</span>`;
                  }
                  return entries.map(([name, id], i) => `
                  <div class="flex gap-2 items-center" data-gcal-row>
                    <input type="text" name="calendar_name_${i}" value="${escapeHtml(name)}" placeholder="Name"
                      class="h-8 w-32 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
                    <input type="text" name="calendar_id_${i}" value="${escapeHtml(id)}" placeholder="calendar-id@group.calendar.google.com"
                      class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
                    <button type="button" class="gcal-remove-btn text-muted-foreground hover:text-destructive transition-colors" aria-label="Remove calendar">
                      ${iconX("size-3")}
                    </button>
                  </div>`).join("");
                })()}
              </div>
              ${(() => {
                const entries = Object.entries(gcalCalendars);
                const hasMultiple = entries.length >= 2;
                return hasMultiple ? `
              <div class="flex flex-col gap-1.5 mt-1" id="gcal-default-row">
                <label class="text-xs text-muted-foreground">Default calendar</label>
                <select name="google_calendar_default" id="gcal-default-select"
                  class="h-8 w-48 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary">
                  ${entries.map(([name]) => `<option value="${escapeHtml(name)}" ${name === gcalDefault ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
                </select>
              </div>` : `<div class="hidden" id="gcal-default-row">
                <label class="text-xs text-muted-foreground">Default calendar</label>
                <select name="google_calendar_default" id="gcal-default-select"
                  class="h-8 w-48 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"></select>
              </div>`;
              })()}
            </div>
            <input type="hidden" name="google_calendar_id" value="${escapeHtml(gcalId)}" id="gcal-legacy-id" />
            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-muted-foreground">Default event duration (minutes)</label>
              <input type="number" name="google_calendar_default_duration" value="${escapeHtml(gcalDuration)}" min="15" max="480" placeholder="60"
                class="h-8 w-32 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
            </div>
            ` : `
            <input type="hidden" name="google_calendar_id" value="${escapeHtml(gcalId)}" />
            <input type="hidden" name="google_calendar_default_duration" value="${escapeHtml(gcalDuration)}" />
            `}
          </div>
        </div>

        <!-- ═══ Display ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconMonitor("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Display</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <input type="checkbox" id="display_enabled" name="display_enabled" value="true"${displayEnabled === "true" ? " checked" : ""}
                class="rounded border-border" />
              <label for="display_enabled" class="text-xs text-muted-foreground">Enable display</label>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="display_token" class="text-xs text-muted-foreground">Security Token</label>
              <input type="text" id="display_token" name="display_token" value="${escapeHtml(displayToken)}"
                placeholder="Optional — leave blank to disable token auth"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label for="display_weather_lat" class="text-xs text-muted-foreground">Latitude</label>
                <input type="text" id="display_weather_lat" name="display_weather_lat" value="${escapeHtml(displayWeatherLat)}"
                  placeholder="e.g. 52.52"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="display_weather_lng" class="text-xs text-muted-foreground">Longitude</label>
                <input type="text" id="display_weather_lng" name="display_weather_lng" value="${escapeHtml(displayWeatherLng)}"
                  placeholder="e.g. 13.405"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              </div>
            </div>
            <span class="text-[10px] text-muted-foreground">Find coordinates at open-meteo.com</span>
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label for="display_max_tasks" class="text-xs text-muted-foreground">Max Tasks</label>
                <input type="number" id="display_max_tasks" name="display_max_tasks" value="${escapeHtml(displayMaxTasks)}" min="1" max="20"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="display_max_today_events" class="text-xs text-muted-foreground">Max Today Events</label>
                <input type="number" id="display_max_today_events" name="display_max_today_events" value="${escapeHtml(displayMaxTodayEvents)}" min="1" max="30"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="display_calendars" class="text-xs text-muted-foreground">Calendar Filter</label>
              <input type="text" id="display_calendars" name="display_calendars" value="${escapeHtml(displayCalendarsDisplay)}"
                placeholder="Leave blank for all; comma-separated names e.g. FAMILY, WORK"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              <span class="text-[10px] text-muted-foreground">Restrict which Google Calendars appear on the display. Empty = all configured calendars.</span>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <label for="display_width" class="text-xs text-muted-foreground">Width (px)</label>
                <input type="number" id="display_width" name="display_width" value="${escapeHtml(displayWidth)}"
                  placeholder="e.g. 800"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="display_height" class="text-xs text-muted-foreground">Height (px)</label>
                <input type="number" id="display_height" name="display_height" value="${escapeHtml(displayHeight)}"
                  placeholder="e.g. 480"
                  class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              </div>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="display_base_url" class="text-xs text-muted-foreground">Base URL Override</label>
              <input type="text" id="display_base_url" name="display_base_url" value="${escapeHtml(displayBaseUrl)}"
                placeholder="Optional — e.g. https://cortex.example.com"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
              <span class="text-[10px] text-muted-foreground">Override the URL returned by /api/display. Useful behind a reverse proxy with TLS termination. Leave blank to derive from request headers.</span>
            </div>
            ${displayEnabled === "true" ? `
            <div class="flex items-center gap-2">
              <a href="/api/kitchen.png" target="_blank" rel="noopener"
                class="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 hover:border-primary/50 transition-colors">Preview display →</a>
            </div>` : ""}
          </div>
        </div>

        <!-- ═══ Save ═══ -->
        <div class="flex items-center justify-between pt-1">
          <span class="text-[10px] text-muted-foreground">Changes take effect immediately after save</span>
          <button type="submit"
            class="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            ${iconCheck("size-3")}
            Save All
          </button>
        </div>
      </form>
      <template id="icon-x-tpl">${iconX("size-3")}</template>
    </main>

    <script>
    (function() {
      var list = document.getElementById('chat-id-list');
      var hidden = document.getElementById('chat-ids-input');
      var addBtn = document.getElementById('add-chat-id-btn');
      var newInput = document.getElementById('new-chat-id');
      var range = document.getElementById('confidence_range');
      var thresholdInput = document.getElementById('confidence_threshold');

      /* ── Chat ID management ── */
      function syncHidden() {
        var ids = [];
        list.querySelectorAll('[data-id]').forEach(function(btn) {
          ids.push(btn.getAttribute('data-id'));
        });
        hidden.value = ids.join(',');
      }

      function createChip(val) {
        var span = document.createElement('span');
        span.className = 'inline-flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-sm font-mono text-foreground';
        span.setAttribute('data-chip', '');
        var text = document.createElement('span');
        text.textContent = val;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-id-remove text-muted-foreground hover:text-destructive transition-colors';
        btn.setAttribute('data-id', val);
        btn.setAttribute('aria-label', 'Remove ' + val);
        var tpl = document.getElementById('icon-x-tpl');
        if (tpl) btn.appendChild(tpl.content.cloneNode(true));
        span.appendChild(text);
        span.appendChild(btn);
        return span;
      }

      if (addBtn) {
        addBtn.addEventListener('click', function() {
          var val = newInput.value.trim();
          if (!val) return;
          list.appendChild(createChip(val));
          newInput.value = '';
          syncHidden();
        });
        newInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
        });
      }

      if (list) {
        list.addEventListener('click', function(e) {
          var removeBtn = e.target.closest('.chat-id-remove');
          if (removeBtn) {
            removeBtn.closest('[data-chip]').remove();
            syncHidden();
          }
        });
      }

      /* ── Provider preset + model picker ── */
      var PRESETS = ${JSON.stringify(
        Object.fromEntries(Object.entries(PROVIDER_PRESETS).map(([k, v]) => [k, { baseUrl: v.baseUrl, needsKey: v.needsKey, label: v.label }]))
      )};
      var OLLAMA_MODELS = ${JSON.stringify(ollamaModels)};
      var KEY_PROVIDERS = ['anthropic', 'openai', 'groq', 'gemini'];

      var providerSelect = document.getElementById('llm_provider');
      var modelSelect = document.getElementById('llm_model_select');
      var modelText = document.getElementById('llm_model_text');
      var modelHidden = document.getElementById('llm_model');
      var modelKeyHint = document.getElementById('model-key-hint');
      var baseUrlRow = document.getElementById('base-url-row');
      var baseUrlInput = document.getElementById('llm_base_url');
      var ollamaSection = document.getElementById('ollama-section');
      var apikeyRow = document.getElementById('apikey-row');
      var apikeyActive = document.getElementById('apikey_active');
      var apikeyLabel = document.getElementById('apikey-provider-name');
      var currentKeyProvider = '${escapeHtml(llmProvider)}';

      /* ── API Key scoping ── */
      function saveActiveKeyToHidden() {
        var hidden = document.getElementById('apikey_' + currentKeyProvider);
        if (hidden && apikeyActive) {
          hidden.value = apikeyActive.value;
        }
      }

      function loadKeyForProvider(provider) {
        saveActiveKeyToHidden();
        currentKeyProvider = provider;
        var preset = PRESETS[provider] || {};

        // Show/hide the key row
        if (apikeyRow) {
          if (preset.needsKey) {
            apikeyRow.classList.remove('hidden');
            var hidden = document.getElementById('apikey_' + provider);
            if (apikeyActive) apikeyActive.value = hidden ? hidden.value : '';
            if (apikeyLabel) apikeyLabel.textContent = preset.label || provider;
          } else {
            apikeyRow.classList.add('hidden');
          }
        }

        // Update model key hint visibility
        if (modelKeyHint) {
          var activeHidden = document.getElementById('apikey_' + provider);
          var hasKey = activeHidden && activeHidden.value;
          if (!preset.needsKey || hasKey) {
            modelKeyHint.classList.add('hidden');
          } else {
            modelKeyHint.classList.remove('hidden');
          }
        }
      }

      // Sync active key input → hidden on every keystroke
      if (apikeyActive) {
        apikeyActive.addEventListener('input', function() {
          saveActiveKeyToHidden();
          // Update hint when key is entered/cleared
          if (modelKeyHint) {
            modelKeyHint.classList.toggle('hidden', !!apikeyActive.value);
          }
        });
      }

      function applyProvider(provider, currentModel, skipBaseUrl) {
        var preset = PRESETS[provider] || { baseUrl: '' };
        var isLocal = provider === 'local';
        var isOllama = provider === 'ollama';

        // Base URL
        if (baseUrlRow) {
          if (isOllama) {
            baseUrlRow.classList.add('hidden');
          } else {
            baseUrlRow.classList.remove('hidden');
          }
          if (!skipBaseUrl && baseUrlInput) {
            baseUrlInput.value = preset.baseUrl;
          }
        }

        // Ollama section + URL note
        if (ollamaSection) {
          isOllama ? ollamaSection.classList.remove('hidden') : ollamaSection.classList.add('hidden');
        }

        // Swap API key field
        loadKeyForProvider(provider);

        // When switching providers, show text input (models reload on save)
        if (modelSelect) modelSelect.classList.add('hidden');
        if (modelText) {
          modelText.classList.remove('hidden');
          if (isOllama && OLLAMA_MODELS.length > 0 && !currentModel) {
            modelText.value = OLLAMA_MODELS[0];
          }
          modelHidden.value = modelText.value;
        }
      }

      if (providerSelect) {
        // Sync model hidden on select change
        if (modelSelect) {
          modelSelect.addEventListener('change', function() {
            if (modelSelect.value === '__other__') {
              modelText.classList.remove('hidden');
              modelSelect.classList.add('hidden');
              modelText.focus();
              modelHidden.value = modelText.value;
            } else {
              modelHidden.value = modelSelect.value;
            }
          });
        }

        if (modelText) {
          modelText.addEventListener('input', function() {
            modelHidden.value = modelText.value;
          });
        }

        // Ollama chip click
        document.addEventListener('click', function(e) {
          var chip = e.target.closest('[data-ollama-model]');
          if (!chip) return;
          var m = chip.getAttribute('data-ollama-model');
          modelText.value = m;
          modelHidden.value = m;
          document.querySelectorAll('.ollama-model-chip').forEach(function(c) {
            c.classList.remove('border-primary', 'text-primary');
          });
          chip.classList.add('border-primary', 'text-primary');
        });

        providerSelect.addEventListener('change', function() {
          var currentModel = modelHidden.value;
          applyProvider(providerSelect.value, currentModel, false);
        });
      }

      /* ── Confidence threshold slider sync ── */
      if (range && thresholdInput) {
        range.addEventListener('input', function() {
          thresholdInput.value = (parseInt(range.value, 10) / 100).toFixed(2);
        });
        thresholdInput.addEventListener('input', function() {
          var v = parseFloat(thresholdInput.value);
          if (!isNaN(v) && v >= 0 && v <= 1) {
            range.value = Math.round(v * 100);
          }
        });
      }

      /* ── Digest trigger buttons ── */
      function triggerDigest(type) {
        var btn = document.getElementById('trigger-' + type);
        var status = document.getElementById('digest-status');
        if (!btn || !status) return;
        btn.disabled = true;
        btn.classList.add('opacity-50');
        status.textContent = 'Generating ' + type + '...';
        status.classList.remove('hidden');
        status.classList.add('animate-pulse');
        fetch('/api/digest/' + type, { method: 'POST' })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            if (data.ok) {
              status.textContent = type.charAt(0).toUpperCase() + type.slice(1) + ' digest generated';
              status.classList.remove('animate-pulse');
            } else {
              status.textContent = 'Failed: ' + (data.error || 'unknown error');
              status.classList.remove('animate-pulse');
            }
          })
          .catch(function() {
            status.textContent = 'Request failed';
            status.classList.remove('animate-pulse');
          })
          .finally(function() {
            btn.disabled = false;
            btn.classList.remove('opacity-50');
            setTimeout(function() { status.classList.add('hidden'); }, 5000);
          });
      }
      var dailyBtn = document.getElementById('trigger-daily');
      var weeklyBtn = document.getElementById('trigger-weekly');
      if (dailyBtn) dailyBtn.addEventListener('click', function() { triggerDigest('daily'); });
      if (weeklyBtn) weeklyBtn.addEventListener('click', function() { triggerDigest('weekly'); });

      /* ── Ollama model pull ── */
      var pullBtn = document.getElementById('ollama-pull-btn');
      var pullProgress = document.getElementById('ollama-pull-progress');
      var pullStatusText = document.getElementById('pull-status-text');
      var pullPercentText = document.getElementById('pull-percent-text');
      var pullProgressBar = document.getElementById('pull-progress-bar');
      var pullLayerDetail = document.getElementById('pull-layer-detail');

      function formatBytes(bytes) {
        if (!bytes) return '';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
      }

      function addModelChip(name) {
        var chips = document.getElementById('ollama-model-chips');
        if (!chips) return;
        var hint = document.getElementById('no-models-hint');
        if (hint) hint.remove();
        // Don't add if already exists (safe attribute check without selector injection)
        var found = false;
        chips.querySelectorAll('[data-ollama-model]').forEach(function(el) {
          if (el.getAttribute('data-ollama-model') === name) found = true;
        });
        if (found) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-ollama-model', name);
        btn.className = 'ollama-model-chip rounded border border-primary bg-secondary px-2 py-0.5 text-[10px] font-mono text-primary transition-colors';
        btn.textContent = name;
        chips.appendChild(btn);
        if (OLLAMA_MODELS.indexOf(name) === -1) OLLAMA_MODELS.push(name);
      }

      if (pullBtn) {
        pullBtn.addEventListener('click', function() {
          var model = modelHidden ? modelHidden.value.trim() : '';
          if (!model) {
            alert('Enter a model name first');
            return;
          }

          // Check if already pulled
          if (OLLAMA_MODELS.indexOf(model) !== -1) {
            alert('Model "' + model + '" is already available');
            return;
          }

          pullBtn.disabled = true;
          pullBtn.classList.add('opacity-50');
          pullProgress.classList.remove('hidden');
          pullStatusText.textContent = 'Connecting...';
          pullPercentText.textContent = '';
          pullProgressBar.style.width = '0%';
          pullLayerDetail.textContent = '';

          var pullDone = false;
          fetch('/api/ollama/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model })
          }).then(function(res) {
            if (!res.ok) {
              return res.json().then(function(d) { throw new Error(d.error || 'Pull failed'); });
            }

            var reader = res.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            function readStream() {
              reader.read().then(function(result) {
                if (result.done) {
                  if (!pullDone) { pullDone = true; onPullDone(model); }
                  return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split('\\n');
                buffer = lines.pop() || '';
                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].trim();
                  if (!line.startsWith('data: ')) continue;
                  var payload = line.slice(6);
                  if (payload === '[DONE]') {
                    if (!pullDone) { pullDone = true; onPullDone(model); }
                    return;
                  }
                  try {
                    var msg = JSON.parse(payload);
                    updatePullProgress(msg);
                  } catch(e) {}
                }
                readStream();
              }).catch(function(err) {
                pullStatusText.textContent = 'Stream error: ' + err.message;
                resetPullBtn();
              });
            }
            readStream();
          }).catch(function(err) {
            pullStatusText.textContent = 'Error: ' + err.message;
            pullPercentText.textContent = '';
            pullProgressBar.style.width = '0%';
            resetPullBtn();
          });
        });
      }

      function updatePullProgress(msg) {
        var status = msg.status || '';
        pullStatusText.textContent = status;

        if (msg.total && msg.completed !== undefined) {
          var pct = Math.round((msg.completed / msg.total) * 100);
          pullPercentText.textContent = pct + '%';
          pullProgressBar.style.width = pct + '%';
          pullLayerDetail.textContent = formatBytes(msg.completed) + ' / ' + formatBytes(msg.total);
        } else {
          // Indeterminate states (e.g. "verifying sha256 digest")
          pullPercentText.textContent = '';
          pullLayerDetail.textContent = '';
        }

        if (msg.error) {
          pullStatusText.textContent = 'Error: ' + msg.error;
          pullPercentText.textContent = '';
          pullProgressBar.style.width = '0%';
          resetPullBtn();
        }
      }

      function onPullDone(model) {
        pullStatusText.textContent = 'Done — ' + model + ' is ready';
        pullPercentText.textContent = '100%';
        pullProgressBar.style.width = '100%';
        pullLayerDetail.textContent = '';
        addModelChip(model);
        // Select the newly pulled model
        if (modelText) modelText.value = model;
        if (modelHidden) modelHidden.value = model;
        document.querySelectorAll('.ollama-model-chip').forEach(function(c) {
          if (c.getAttribute('data-ollama-model') === model) {
            c.classList.add('border-primary', 'text-primary');
          } else {
            c.classList.remove('border-primary', 'text-primary');
          }
        });
        resetPullBtn();
        setTimeout(function() { pullProgress.classList.add('hidden'); }, 5000);
      }

      function resetPullBtn() {
        if (pullBtn) {
          pullBtn.disabled = false;
          pullBtn.classList.remove('opacity-50');
        }
      }

      /* ── Google Calendar list management ── */
      var gcalList = document.getElementById('gcal-calendar-list');
      var gcalAddBtn = document.getElementById('gcal-add-btn');
      var gcalDefaultRow = document.getElementById('gcal-default-row');
      var gcalDefaultSelect = document.getElementById('gcal-default-select');
      var gcalLegacyId = document.getElementById('gcal-legacy-id');
      var iconXTpl = document.getElementById('icon-x-tpl');

      function reindexCalendarRows() {
        if (!gcalList) return;
        var rows = gcalList.querySelectorAll('[data-gcal-row]');
        rows.forEach(function(row, i) {
          var inputs = row.querySelectorAll('input');
          if (inputs[0]) inputs[0].name = 'calendar_name_' + i;
          if (inputs[1]) inputs[1].name = 'calendar_id_' + i;
        });
        // Update default dropdown
        updateDefaultDropdown();
        // Clear legacy single calendar ID when using multi-calendar
        if (gcalLegacyId && rows.length > 0) gcalLegacyId.value = '';
      }

      function updateDefaultDropdown() {
        if (!gcalDefaultRow || !gcalDefaultSelect || !gcalList) return;
        var rows = gcalList.querySelectorAll('[data-gcal-row]');
        var currentDefault = gcalDefaultSelect.value;
        if (rows.length >= 2) {
          gcalDefaultRow.classList.remove('hidden');
          gcalDefaultRow.classList.add('flex', 'flex-col', 'gap-1.5', 'mt-1');
          gcalDefaultSelect.innerHTML = '';
          rows.forEach(function(row) {
            var nameInput = row.querySelector('input');
            var name = nameInput ? nameInput.value : '';
            if (name) {
              var opt = document.createElement('option');
              opt.value = name;
              opt.textContent = name;
              if (name === currentDefault) opt.selected = true;
              gcalDefaultSelect.appendChild(opt);
            }
          });
        } else {
          gcalDefaultRow.classList.add('hidden');
        }
      }

      function createCalendarRow(name, id) {
        var hint = document.getElementById('gcal-empty-hint');
        if (hint) hint.remove();
        var div = document.createElement('div');
        div.className = 'flex gap-2 items-center';
        div.setAttribute('data-gcal-row', '');
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = name || '';
        nameInput.placeholder = 'Name';
        nameInput.className = 'h-8 w-32 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground';
        nameInput.addEventListener('input', updateDefaultDropdown);
        var idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.value = id || '';
        idInput.placeholder = 'calendar-id@group.calendar.google.com';
        idInput.className = 'h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'gcal-remove-btn text-muted-foreground hover:text-destructive transition-colors';
        removeBtn.setAttribute('aria-label', 'Remove calendar');
        if (iconXTpl) removeBtn.appendChild(iconXTpl.content.cloneNode(true));
        div.appendChild(nameInput);
        div.appendChild(idInput);
        div.appendChild(removeBtn);
        return div;
      }

      if (gcalAddBtn && gcalList) {
        gcalAddBtn.addEventListener('click', function() {
          gcalList.appendChild(createCalendarRow('', ''));
          reindexCalendarRows();
        });
      }

      if (gcalList) {
        gcalList.addEventListener('click', function(e) {
          var btn = e.target.closest('.gcal-remove-btn');
          if (!btn) return;
          var row = btn.closest('[data-gcal-row]');
          if (row) row.remove();
          reindexCalendarRows();
          if (gcalList.querySelectorAll('[data-gcal-row]').length === 0) {
            var hint = document.createElement('span');
            hint.id = 'gcal-empty-hint';
            hint.className = 'text-[10px] text-muted-foreground';
            hint.textContent = 'No calendars added yet.';
            gcalList.appendChild(hint);
          }
        });
        // Update default dropdown when names change
        gcalList.addEventListener('input', function(e) {
          if (e.target.matches('input[name^="calendar_name_"]')) {
            updateDefaultDropdown();
          }
        });
      }
    })();
    </script>`;

    return c.html(renderLayout("Settings", content, "/settings"));
  });

  app.post("/settings", async (c) => {
    const body = await c.req.parseBody();

    // Parse multi-calendar form data
    const calendars: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      const name = ((body[`calendar_name_${i}`] as string) || "").trim();
      const id = ((body[`calendar_id_${i}`] as string) || "").trim();
      if (name && id) {
        calendars[name] = id;
      }
    }

    const form: Record<string, string> = {
      telegram_bot_token: (body.telegram_bot_token as string) || "",
      chat_ids: (body.chat_ids as string) || "",
      daily_digest_cron: (body.daily_digest_cron as string) || "",
      weekly_digest_cron: (body.weekly_digest_cron as string) || "",
      timezone: (body.timezone as string) || "",
      confidence_threshold: (body.confidence_threshold as string) || "",
      digest_email_to: (body.digest_email_to as string) || "",
      ollama_url: (body.ollama_url as string) || "",
      google_client_id: (body.google_client_id as string) || "",
      google_client_secret: (body.google_client_secret as string) || "",
      google_calendar_id: (body.google_calendar_id as string) || "",
      google_calendar_default_duration: (body.google_calendar_default_duration as string) || "",
      output_language: (body.output_language as string) || DEFAULTS.output_language,
      google_calendars: Object.keys(calendars).length > 0 ? JSON.stringify(calendars) : "",
      google_calendar_default: (body.google_calendar_default as string) || "",
      display_enabled: (body.display_enabled as string) || "",
      display_token: (body.display_token as string) || "",
      display_weather_lat: (body.display_weather_lat as string) || "",
      display_weather_lng: (body.display_weather_lng as string) || "",
      display_max_tasks: (body.display_max_tasks as string) || "",
      display_max_today_events: (body.display_max_today_events as string) || "",
      display_width: (body.display_width as string) || "",
      display_height: (body.display_height as string) || "",
      display_base_url: ((body.display_base_url as string) || "").trim(),
      display_calendars_raw: ((body.display_calendars as string) || "").trim(),
    };

    const llmConfig: LLMConfig = {
      provider: (body.llm_provider as string) || "anthropic",
      model: (body.llm_model as string) || "",
      baseUrl: (body.llm_base_url as string) || "",
      apiKeys: {
        anthropic: (body.apikey_anthropic as string) || "",
        openai:    (body.apikey_openai as string) || "",
        groq:      (body.apikey_groq as string) || "",
        gemini:    (body.apikey_gemini as string) || "",
      },
    };

    // Validate
    if (!llmConfig.model.trim()) {
      return c.redirect(`/settings?error=${encodeURIComponent("Model name is required.")}`, 302);
    }
    const validationError = validateSettings(form);
    if (validationError) {
      return c.redirect(
        `/settings?error=${encodeURIComponent(validationError)}`,
        302,
      );
    }

    // Prepare settings to save
    const chatIds = form.chat_ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const toSave: Record<string, string> = {
      ...(form.telegram_bot_token ? { telegram_bot_token: form.telegram_bot_token } : {}),
      telegram_chat_ids: chatIds.join(","),
      daily_digest_cron: form.daily_digest_cron,
      weekly_digest_cron: form.weekly_digest_cron,
      timezone: form.timezone,
      confidence_threshold: form.confidence_threshold,
      digest_email_to: form.digest_email_to,
      ollama_url: form.ollama_url,
      ...(form.google_client_id ? { google_client_id: form.google_client_id } : {}),
      ...(form.google_client_secret ? { google_client_secret: form.google_client_secret } : {}),
      google_calendar_id: form.google_calendar_id,
      google_calendar_default_duration: form.google_calendar_default_duration,
      output_language: form.output_language,
      google_calendars: form.google_calendars,
      google_calendar_default: form.google_calendar_default,
      display_enabled: form.display_enabled,
      display_token: form.display_token,
      display_weather_lat: form.display_weather_lat,
      display_weather_lng: form.display_weather_lng,
      display_max_tasks: form.display_max_tasks,
      display_max_today_events: form.display_max_today_events,
      display_width: form.display_width,
      display_height: form.display_height,
      display_base_url: form.display_base_url,
      display_calendars: parseDisplayCalendars(form.display_calendars_raw),
    };

    await saveAllSettings(sql, toSave);
    await saveLLMConfig(sql, llmConfig);

    // Restart Telegram bot if token was saved (stops old instance if running, starts new)
    if (form.telegram_bot_token) {
      restartBot(sql).catch((err) => {
        log.warn("Failed to start Telegram bot after settings save", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Ollama connectivity check
    let warning = "";
    try {
      const ollamaCheckUrl = resolveEffective((await getAllSettings(sql)) ?? {}, "ollama_url", DEFAULTS.ollama_url);
      await fetch(ollamaCheckUrl, { signal: AbortSignal.timeout(3000) });
    } catch {
      warning = "Could not connect to the configured Ollama endpoint. Embedding generation may fail.";
    }

    const params = new URLSearchParams({ success: "Settings saved" });
    if (warning) params.set("warning", warning);

    return c.redirect(`/settings?${params.toString()}`, 302);
  });

  // Google Calendar connect/disconnect
  app.post("/settings/google-calendar/connect", async (c) => {
    const body = await c.req.parseBody();
    const code = (body.code as string) || "";
    if (!code.trim()) {
      return c.redirect("/settings?error=Authorization+code+is+required", 302);
    }
    const settings = await getAllSettings(sql);
    const clientId = settings.google_client_id || "";
    const clientSecret = settings.google_client_secret || "";
    try {
      const tokens = await exchangeAuthCode(code, clientId, clientSecret);
      await saveAllSettings(sql, {
        google_access_token: tokens.accessToken,
        google_refresh_token: tokens.refreshToken,
      });
      return c.redirect("/settings?success=Google+Calendar+connected", 302);
    } catch (e) {
      return c.redirect(`/settings?error=${encodeURIComponent("Failed to connect: " + (e as Error).message)}`, 302);
    }
  });

  app.post("/settings/google-calendar/disconnect", async (c) => {
    await sql`DELETE FROM settings WHERE key IN ('google_refresh_token', 'google_access_token')`;
    return c.redirect("/settings?success=Google+Calendar+disconnected", 302);
  });

  // Digest trigger endpoints
  app.post("/api/digest/daily", async (c) => {
    try {
      await generateDailyDigest(sql, broadcaster);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "Generation failed" }, 500);
    }
  });

  app.post("/api/digest/weekly", async (c) => {
    try {
      await generateWeeklyReview(sql, broadcaster);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : "Generation failed" }, 500);
    }
  });

  // Ollama model pull — streams progress as SSE
  // Active pulls tracked so the download continues even if the browser disconnects
  const activePulls = new Map<string, { messages: Array<{ data: string; time: number }>; done: boolean }>();

  app.post("/api/ollama/pull", async (c) => {
    const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
    const model = body.model?.trim();
    if (!model) {
      return c.json({ error: "Model name required" }, 400);
    }

    const dbSettings = (await getAllSettings(sql)) ?? {};
    const ollamaUrl = resolveEffective(dbSettings, "ollama_url", DEFAULTS.ollama_url);

    // If there's already an active pull for this model, reconnect to it
    const existing = activePulls.get(model);
    if (existing && !existing.done) {
      return streamPullProgress(model);
    }

    // Start a new pull — fire and forget, tracked in activePulls
    const pullState: { messages: Array<{ data: string; time: number }>; done: boolean } = { messages: [], done: false };
    activePulls.set(model, pullState);

    function pushMessage(data: string) {
      pullState.messages.push({ data, time: Date.now() });
    }

    (async () => {
      try {
        const ollamaRes = await fetch(`${ollamaUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model, stream: true }),
          signal: AbortSignal.timeout(1_800_000), // 30 min for large models
        });

        if (!ollamaRes.ok || !ollamaRes.body) {
          const text = await ollamaRes.text().catch(() => "");
          pushMessage(JSON.stringify({ error: text || `Ollama returned ${ollamaRes.status}` }));
          pullState.done = true;
          return;
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) pushMessage(trimmed);
          }
        }
      } catch (err) {
        pushMessage(JSON.stringify({ error: err instanceof Error ? err.message : "Pull failed" }));
      } finally {
        pullState.done = true;
        // Clean up after 60s
        setTimeout(() => activePulls.delete(model), 60_000);
      }
    })();

    return streamPullProgress(model);
  });

  function streamPullProgress(model: string): Response {
    const encoder = new TextEncoder();
    let lastIndex = 0;
    let closed = false;

    const stream = new ReadableStream({
      async pull(controller) {
        // Poll for new messages from the background pull
        while (!closed) {
          const pullState = activePulls.get(model);
          if (!pullState) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            closed = true;
            return;
          }

          // Send any new messages
          while (lastIndex < pullState.messages.length) {
            const msg = pullState.messages[lastIndex++];
            controller.enqueue(encoder.encode(`data: ${msg.data}\n\n`));
          }

          if (pullState.done) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            closed = true;
            return;
          }

          // Wait a bit before checking for more messages
          await new Promise((r) => setTimeout(r, 200));
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return app;
}
