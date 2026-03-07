import { Hono } from "hono";
import type postgres from "postgres";
import { CronExpressionParser } from "cron-parser";
import { renderLayout } from "./layout.js";
import { getAllSettings, saveAllSettings } from "./settings-queries.js";
import { escapeHtml } from "./shared.js";

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
      success ? `<div class="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">${escapeHtml(success)}</div>` : "",
      error ? `<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${escapeHtml(error)}</div>` : "",
      warning ? `<div class="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-600 dark:text-yellow-400">${escapeHtml(warning)}</div>` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const chatIdListHtml = chatIds
      .map(
        (id) =>
          `<div class="flex items-center gap-2">
            <span class="text-sm font-mono">${escapeHtml(id)}</span>
            <button type="button" class="chat-id-remove text-xs text-destructive hover:underline" data-id="${escapeHtml(id)}">remove</button>
          </div>`,
      )
      .join("\n");

    const emailNote =
      email === ""
        ? `<p class="text-xs text-muted-foreground">Email digests are disabled.</p>`
        : "";

    const content = `
    <main class="flex-1 overflow-y-auto space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-medium">Settings</h1>
      </div>

      ${flashHtml}

      <form method="POST" action="/settings" class="space-y-8">

        <!-- Telegram Chat IDs -->
        <fieldset class="flex flex-col gap-3">
          <legend class="text-sm font-medium">Telegram Chat IDs</legend>
          <div id="chat-id-list" class="flex flex-col gap-1.5">
            ${chatIdListHtml}
          </div>
          <div class="flex items-center gap-2">
            <input type="text" id="new-chat-id" placeholder="Add chat ID" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
            <button type="button" id="add-chat-id-btn" class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors">Add</button>
          </div>
          <input type="hidden" name="chat_ids" id="chat-ids-input" value="${escapeHtml(chatIds.join(","))}" />
        </fieldset>

        <!-- Classification Model -->
        <div class="flex flex-col gap-1.5">
          <label for="llm_model" class="text-sm font-medium">Classification Model</label>
          <input type="text" id="llm_model" name="llm_model" value="${escapeHtml(llmModel)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </div>

        <!-- Digest Schedules -->
        <fieldset class="flex flex-col gap-4">
          <legend class="text-sm font-medium">Digest Schedules</legend>
          <div class="flex flex-col gap-1.5">
            <label for="daily_digest_cron" class="text-xs text-muted-foreground">Daily Digest Cron</label>
            <input type="text" id="daily_digest_cron" name="daily_digest_cron" value="${escapeHtml(dailyCron)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="weekly_digest_cron" class="text-xs text-muted-foreground">Weekly Digest Cron</label>
            <input type="text" id="weekly_digest_cron" name="weekly_digest_cron" value="${escapeHtml(weeklyCron)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
          </div>
        </fieldset>

        <!-- Timezone -->
        <div class="flex flex-col gap-1.5">
          <label for="timezone" class="text-sm font-medium">Timezone</label>
          <input type="text" id="timezone" name="timezone" value="${escapeHtml(timezone)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </div>

        <!-- Confidence Threshold -->
        <div class="flex flex-col gap-1.5">
          <label for="confidence_threshold" class="text-sm font-medium">Confidence Threshold</label>
          <input type="text" id="confidence_threshold" name="confidence_threshold" value="${escapeHtml(threshold)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
          <p class="text-xs text-muted-foreground">Value between 0.0 and 1.0</p>
        </div>

        <!-- Digest Email -->
        <div class="flex flex-col gap-1.5">
          <label for="digest_email_to" class="text-sm font-medium">Digest Email</label>
          <input type="text" id="digest_email_to" name="digest_email_to" value="${escapeHtml(email)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" placeholder="Leave empty to disable" />
          ${emailNote}
        </div>

        <!-- Ollama URL -->
        <div class="flex flex-col gap-1.5">
          <label for="ollama_url" class="text-sm font-medium">Ollama URL</label>
          <input type="text" id="ollama_url" name="ollama_url" value="${escapeHtml(ollamaUrl)}" class="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </div>

        <!-- Save -->
        <div>
          <button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">Save All</button>
        </div>
      </form>
    </main>

    <script>
    (function() {
      var list = document.getElementById('chat-id-list');
      var hidden = document.getElementById('chat-ids-input');
      var addBtn = document.getElementById('add-chat-id-btn');
      var newInput = document.getElementById('new-chat-id');

      function syncHidden() {
        var ids = [];
        list.querySelectorAll('[data-id]').forEach(function(btn) {
          ids.push(btn.getAttribute('data-id'));
        });
        hidden.value = ids.join(',');
      }

      if (addBtn) {
        addBtn.addEventListener('click', function() {
          var val = newInput.value.trim();
          if (!val) return;
          var div = document.createElement('div');
          div.className = 'flex items-center gap-2';
          var span = document.createElement('span');
          span.className = 'text-sm font-mono';
          span.textContent = val;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chat-id-remove text-xs text-destructive hover:underline';
          btn.setAttribute('data-id', val);
          btn.textContent = 'remove';
          div.appendChild(span);
          div.appendChild(btn);
          list.appendChild(div);
          newInput.value = '';
          syncHidden();
        });
      }

      if (list) {
        list.addEventListener('click', function(e) {
          if (e.target.classList.contains('chat-id-remove')) {
            e.target.closest('div').remove();
            syncHidden();
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
