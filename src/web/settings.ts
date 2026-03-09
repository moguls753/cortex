import { Hono } from "hono";
import type postgres from "postgres";
import { CronExpressionParser } from "cron-parser";
import { renderLayout } from "./layout.js";
import { getAllSettings, saveAllSettings } from "./settings-queries.js";
import { SETTINGS_TO_ENV } from "../config.js";
import { escapeHtml } from "./shared.js";
import { getLLMConfig, saveLLMConfig } from "../llm/config.js";
import type { LLMConfig } from "../llm/config.js";
import {
  iconBrain,
  iconClock,
  iconShield,
  iconCheck,
  iconX,
  iconAlertTriangle,
  iconPlay,
  iconDownload,
} from "./icons.js";
import { generateDailyDigest, generateWeeklyReview } from "../digests.js";
import type { SSEBroadcaster } from "./sse.js";

type Sql = postgres.Sql;

const DEFAULTS: Record<string, string> = {
  daily_digest_cron: "30 7 * * *",
  weekly_digest_cron: "0 16 * * 0",
  timezone: "Europe/Berlin",
  confidence_threshold: "0.6",
  ollama_url: "http://ollama:11434",
  digest_email_to: "",
};


const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; needsKey: boolean }> = {
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true },
  openai:    { label: "OpenAI (ChatGPT)", baseUrl: "https://api.openai.com/v1", needsKey: true },
  groq:      { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  gemini:    { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true },
  local:     { label: "Local LLM", baseUrl: "http://localhost:1234/v1", needsKey: false },
  ollama:    { label: "Ollama", baseUrl: "http://ollama:11434/v1", needsKey: false },
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
  const envVar = SETTINGS_TO_ENV[key];
  if (envVar && process.env[envVar] !== undefined) return process.env[envVar]!;
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
  const envVal = process.env.TELEGRAM_CHAT_ID;
  if (envVal) return [envVal.trim()];
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
    const timezone = resolveEffective(dbSettings, "timezone", DEFAULTS.timezone);
    const threshold = resolveEffective(dbSettings, "confidence_threshold", DEFAULTS.confidence_threshold);
    const ollamaUrl = resolveEffective(dbSettings, "ollama_url", DEFAULTS.ollama_url);
    const email = resolveEffective(dbSettings, "digest_email_to", DEFAULTS.digest_email_to);
    const chatIds = resolveChatIds(dbSettings);

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
    <main class="flex-1 overflow-y-auto scrollbar-thin">
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

          <!-- Row 3: Ollama model picker + RAM table -->
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
    })();
    </script>`;

    return c.html(renderLayout("Settings", content, "/settings"));
  });

  app.post("/settings", async (c) => {
    const body = await c.req.parseBody();

    const form: Record<string, string> = {
      chat_ids: (body.chat_ids as string) || "",
      daily_digest_cron: (body.daily_digest_cron as string) || "",
      weekly_digest_cron: (body.weekly_digest_cron as string) || "",
      timezone: (body.timezone as string) || "",
      confidence_threshold: (body.confidence_threshold as string) || "",
      digest_email_to: (body.digest_email_to as string) || "",
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
      telegram_chat_ids: chatIds.join(","),
      daily_digest_cron: form.daily_digest_cron,
      weekly_digest_cron: form.weekly_digest_cron,
      timezone: form.timezone,
      confidence_threshold: form.confidence_threshold,
      digest_email_to: form.digest_email_to,
    };

    await saveAllSettings(sql, toSave);
    await saveLLMConfig(sql, llmConfig);

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
  app.post("/api/ollama/pull", async (c) => {
    const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
    const model = body.model?.trim();
    if (!model) {
      return c.json({ error: "Model name required" }, 400);
    }

    const dbSettings = (await getAllSettings(sql)) ?? {};
    const ollamaUrl = resolveEffective(dbSettings, "ollama_url", DEFAULTS.ollama_url);

    let ollamaRes: Response;
    try {
      ollamaRes = await fetch(`${ollamaUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model, stream: true }),
        signal: AbortSignal.timeout(600_000), // 10 min for large models
      });
    } catch {
      return c.json({ error: "Could not connect to Ollama" }, 502);
    }

    if (!ollamaRes.ok || !ollamaRes.body) {
      const text = await ollamaRes.text().catch(() => "");
      return c.json({ error: text || `Ollama returned ${ollamaRes.status}` }, 502);
    }

    // Stream Ollama's NDJSON as SSE
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.trim());
          for (const line of lines) {
            controller.enqueue(new TextEncoder().encode(`data: ${line}\n\n`));
          }
        } catch {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
