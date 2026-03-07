import { Hono } from "hono";
import type postgres from "postgres";
import { CronExpressionParser } from "cron-parser";
import { renderLayout } from "./layout.js";
import { getAllSettings, saveAllSettings } from "./settings-queries.js";
import { escapeHtml } from "./shared.js";
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
  llm_model: "claude-sonnet-4-20250514",
  daily_digest_cron: "30 7 * * *",
  weekly_digest_cron: "0 16 * * 0",
  timezone: "Europe/Berlin",
  confidence_threshold: "0.6",
  ollama_url: "http://ollama:11434",
  digest_email_to: "",
};

const SETTINGS_TO_ENV: Record<string, string> = {
  llm_model: "LLM_MODEL",
  daily_digest_cron: "DAILY_DIGEST_CRON",
  weekly_digest_cron: "WEEKLY_DIGEST_CRON",
  timezone: "TZ",
  confidence_threshold: "CONFIDENCE_THRESHOLD",
  ollama_url: "OLLAMA_URL",
  digest_email_to: "DIGEST_EMAIL_TO",
};

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

    const llmModel = resolveEffective(dbSettings, "llm_model", DEFAULTS.llm_model);
    const dailyCron = resolveEffective(dbSettings, "daily_digest_cron", DEFAULTS.daily_digest_cron);
    const weeklyCron = resolveEffective(dbSettings, "weekly_digest_cron", DEFAULTS.weekly_digest_cron);
    const timezone = resolveEffective(dbSettings, "timezone", DEFAULTS.timezone);
    const threshold = resolveEffective(dbSettings, "confidence_threshold", DEFAULTS.confidence_threshold);
    const ollamaUrl = resolveEffective(dbSettings, "ollama_url", DEFAULTS.ollama_url);
    const email = resolveEffective(dbSettings, "digest_email_to", DEFAULTS.digest_email_to);
    const chatIds = resolveChatIds(dbSettings);

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
                    class="h-8 flex-1 rounded-l-md border border-r-0 border-border bg-transparent px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
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
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label for="llm_model" class="text-xs text-muted-foreground">Model</label>
              <input type="text" id="llm_model" name="llm_model" value="${escapeHtml(llmModel)}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="confidence_threshold" class="text-xs text-muted-foreground">Confidence Threshold</label>
              <div class="flex items-center gap-3">
                <input type="range" id="confidence_range" min="0" max="100" value="${thresholdPercent}"
                  class="flex-1" />
                <input type="text" id="confidence_threshold" name="confidence_threshold" value="${escapeHtml(threshold)}"
                  class="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-xs text-center font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
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
                  class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="weekly_digest_cron" class="text-xs text-muted-foreground">Weekly Schedule</label>
              <div class="flex items-center gap-2">
                <span class="text-primary text-xs select-none shrink-0">cron</span>
                <input type="text" id="weekly_digest_cron" name="weekly_digest_cron" value="${escapeHtml(weeklyCron)}"
                  class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4 mt-3">
            <div class="flex flex-col gap-1.5">
              <label for="digest_email_to" class="text-xs text-muted-foreground">Email Delivery</label>
              <input type="text" id="digest_email_to" name="digest_email_to" value="${escapeHtml(email)}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                placeholder="Leave empty to disable" />
              ${email === "" ? `<span class="text-[10px] text-muted-foreground">Disabled — digests available on dashboard only</span>` : ""}
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="timezone" class="text-xs text-muted-foreground">Timezone</label>
              <input type="text" id="timezone" name="timezone" value="${escapeHtml(timezone)}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
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
                  class="h-8 flex-1 rounded-md border border-border bg-transparent px-2.5 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
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
            class="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            ${iconCheck("size-3")}
            Save All
          </button>
        </div>
      </form>
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
        btn.innerHTML = '${iconX("size-3").replace(/'/g, "\\'")}';
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
      llm_model: (body.llm_model as string) || "",
      daily_digest_cron: (body.daily_digest_cron as string) || "",
      weekly_digest_cron: (body.weekly_digest_cron as string) || "",
      timezone: (body.timezone as string) || "",
      confidence_threshold: (body.confidence_threshold as string) || "",
      digest_email_to: (body.digest_email_to as string) || "",
      ollama_url: (body.ollama_url as string) || "",
    };

    // Validate
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
      .filter((id) => id.length > 0)
      .join(",");

    const toSave: Record<string, string> = {
      telegram_chat_ids: chatIds,
      llm_model: form.llm_model,
      daily_digest_cron: form.daily_digest_cron,
      weekly_digest_cron: form.weekly_digest_cron,
      timezone: form.timezone,
      confidence_threshold: form.confidence_threshold,
      digest_email_to: form.digest_email_to,
      ollama_url: form.ollama_url,
    };

    await saveAllSettings(sql, toSave);

    // Ollama connectivity check
    let warning = "";
    try {
      await fetch(form.ollama_url, { signal: AbortSignal.timeout(3000) });
    } catch {
      warning = `Could not connect to Ollama at ${form.ollama_url}. Embedding generation may fail.`;
    }

    const params = new URLSearchParams({ success: "Settings saved" });
    if (warning) params.set("warning", warning);

    return c.redirect(`/settings?${params.toString()}`, 302);
  });

  return app;
}
