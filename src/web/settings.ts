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
  iconServer,
  iconShield,
  iconCheck,
  iconX,
  iconAlertTriangle,
} from "./icons.js";

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
  anthropic: { label: "Anthropic", baseUrl: "", needsKey: true },
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
      const res = await fetch("https://api.anthropic.com/v1/models", {
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
    return dbSettings.telegram_chat_ids
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

export function createSettingsRoutes(sql: Sql): Hono {
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
      providerModels = await fetchProviderModels(llmProvider, key, llmBaseUrl);
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
          `<span class="inline-flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-xs font-mono text-foreground" data-chip>
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
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Classification</span>
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
            const otherSavedCount = (["anthropic", "openai", "groq", "gemini"] as const)
              .filter(p => p !== llmProvider && (llmConfig.apiKeys[p] ?? "").length > 0)
              .length;
            const activeLabel = PROVIDER_PRESETS[llmProvider]?.label ?? llmProvider;
            const activeVal = escapeHtml(llmConfig.apiKeys[llmProvider as keyof typeof llmConfig.apiKeys] ?? "");

            return `<div id="apikey-row" class="mt-3 flex flex-col gap-1.5${!activeNeedsKey ? " hidden" : ""}">
              <div class="flex items-center justify-between">
                <label id="apikey-label" class="text-xs text-muted-foreground">
                  <span id="apikey-provider-name">${escapeHtml(activeLabel)}</span> API Key
                </label>
                <span id="other-keys-indicator" class="text-[10px] text-muted-foreground">${
                  otherSavedCount > 0
                    ? `${otherSavedCount} other key${otherSavedCount > 1 ? "s" : ""} saved`
                    : ""
                }</span>
              </div>
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
          <div id="base-url-row" class="mt-3 flex flex-col gap-1.5${llmProvider === "anthropic" ? " hidden" : ""}">
            <label for="llm_base_url" class="text-xs text-muted-foreground">Base URL</label>
            <div class="flex items-center gap-2">
              <span class="text-primary text-xs select-none shrink-0">url</span>
              <input type="text" id="llm_base_url" name="llm_base_url" value="${escapeHtml(llmBaseUrl)}"
                class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
            <span id="ollama-url-note" class="text-[10px] text-muted-foreground${llmProvider !== "ollama" ? " hidden" : ""}">The <code class="font-mono">/v1</code> suffix is required for chat and is separate from the Ollama embeddings URL above. No API key needed for Ollama.</span>
          </div>

          <!-- Row 3: Ollama model picker + RAM table -->
          <div id="ollama-section" class="mt-3 space-y-3${llmProvider !== "ollama" ? " hidden" : ""}">
            <div>
              <div class="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Available in Ollama</div>
              ${ollamaModels.length > 0
                ? `<div class="flex flex-wrap gap-1.5">
                    ${ollamaModels.map(m =>
                      `<button type="button" data-ollama-model="${escapeHtml(m)}"
                        class="ollama-model-chip rounded border border-border bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:border-primary hover:text-primary transition-colors${llmModel === m ? " border-primary text-primary" : ""}">
                        ${escapeHtml(m)}
                      </button>`
                    ).join("")}
                  </div>`
                : `<span class="text-[10px] text-muted-foreground">No models pulled yet — run <code class="font-mono">ollama pull qwen2.5:7b</code> in your Ollama container.</span>`
              }
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
          <div class="mt-3 grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label for="confidence_threshold" class="text-xs text-muted-foreground">Confidence Threshold</label>
              <div class="flex items-center gap-3">
                <input type="range" id="confidence_range" min="0" max="100" value="${thresholdPercent}"
                  class="flex-1" />
                <input type="text" id="confidence_threshold" name="confidence_threshold" value="${escapeHtml(threshold)}"
                  class="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm text-center font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
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
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
          </div>
        </div>

        <!-- ═══ Infrastructure ═══ -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="flex items-center gap-2 mb-3">
            ${iconServer("size-3 text-primary")}
            <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Infrastructure</span>
            <span class="flex-1 h-px bg-border"></span>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label for="ollama_url" class="text-xs text-muted-foreground">Ollama Endpoint</label>
              <div class="flex items-center gap-2">
                <span class="text-primary text-xs select-none shrink-0">url</span>
                <input type="text" id="ollama_url" name="ollama_url" value="${escapeHtml(ollamaUrl)}"
                  class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div class="flex items-end pb-0.5">
              <span class="text-[10px] text-muted-foreground">Embeddings via snowflake-arctic-embed2 — connectivity checked on save</span>
            </div>
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
        span.className = 'inline-flex items-center gap-1.5 rounded bg-secondary px-2 py-1 text-xs font-mono text-foreground';
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
      var ollamaUrlNote = document.getElementById('ollama-url-note');
      var apikeyRow = document.getElementById('apikey-row');
      var apikeyActive = document.getElementById('apikey_active');
      var apikeyLabel = document.getElementById('apikey-provider-name');
      var otherKeysIndicator = document.getElementById('other-keys-indicator');
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

        // Update "N other keys saved" indicator
        if (otherKeysIndicator) {
          var count = 0;
          KEY_PROVIDERS.forEach(function(p) {
            if (p !== provider) {
              var h = document.getElementById('apikey_' + p);
              if (h && h.value) count++;
            }
          });
          if (count > 0) {
            otherKeysIndicator.textContent = count + ' other key' + (count > 1 ? 's' : '') + ' saved';
          } else {
            otherKeysIndicator.textContent = '';
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
          if (provider === 'anthropic') {
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
        if (ollamaUrlNote) {
          isOllama ? ollamaUrlNote.classList.remove('hidden') : ollamaUrlNote.classList.add('hidden');
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
      ollama_url: (body.ollama_url as string) || "",
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
      telegram_chat_ids: JSON.stringify(chatIds),
      daily_digest_cron: form.daily_digest_cron,
      weekly_digest_cron: form.weekly_digest_cron,
      timezone: form.timezone,
      confidence_threshold: form.confidence_threshold,
      digest_email_to: form.digest_email_to,
      ollama_url: form.ollama_url,
    };

    await saveAllSettings(sql, toSave);
    await saveLLMConfig(sql, llmConfig);

    // Ollama connectivity check
    let warning = "";
    try {
      await fetch(form.ollama_url, { signal: AbortSignal.timeout(3000) });
    } catch {
      warning = "Could not connect to the configured Ollama endpoint. Embedding generation may fail.";
    }

    const params = new URLSearchParams({ success: "Settings saved" });
    if (warning) params.set("warning", warning);

    return c.redirect(`/settings?${params.toString()}`, 302);
  });

  return app;
}
