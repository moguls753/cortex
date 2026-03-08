# LLM Config Per-Provider API Keys Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store per-provider API keys + LLM config as a single JSON blob in the `settings` table, fetch live model lists from provider APIs, and remove all hardcoded model arrays.

**Architecture:** A new `src/llm/config.ts` module owns the `LLMConfig` interface and two helpers — `getLLMConfig(sql)` and `saveLLMConfig(sql, config)`. Classification reads the active provider's key from this config. The settings page shows one password field per cloud provider and fetches available models from the provider API server-side using the stored key.

**Tech Stack:** TypeScript, Hono, postgres.js, existing `settings` table (key TEXT PK, value TEXT)

---

### Task 1: Create `src/llm/config.ts` — LLMConfig interface + DB helpers

**Files:**
- Create: `src/llm/config.ts`

**Context:**

The `settings` table has `key TEXT PRIMARY KEY, value TEXT`. We store LLM config as one row with `key = 'llm_config'` and `value` = JSON string.

The interface:
```typescript
interface LLMConfig {
  provider: string          // 'anthropic' | 'openai' | 'groq' | 'gemini' | 'local' | 'ollama'
  model: string
  baseUrl: string           // empty string for anthropic
  apiKeys: Record<string, string>  // { anthropic: 'sk-ant-...', openai: 'sk-...', ... }
}
```

**Step 1: Write `src/llm/config.ts`**

```typescript
import type postgres from "postgres";

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeys: Record<string, string>;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: process.env.LLM_PROVIDER || "anthropic",
  model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
  baseUrl: process.env.LLM_BASE_URL || "",
  apiKeys: {
    anthropic: process.env.LLM_API_KEY || "",
  },
};

export async function getLLMConfig(sql: postgres.Sql): Promise<LLMConfig> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'llm_config'`;
  if (rows.length === 0) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(rows[0].value) as Partial<LLMConfig>;
    return {
      provider: parsed.provider ?? DEFAULT_CONFIG.provider,
      model: parsed.model ?? DEFAULT_CONFIG.model,
      baseUrl: parsed.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      apiKeys: { ...DEFAULT_CONFIG.apiKeys, ...(parsed.apiKeys ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveLLMConfig(sql: postgres.Sql, config: LLMConfig): Promise<void> {
  const json = JSON.stringify(config);
  await sql`
    INSERT INTO settings (key, value) VALUES ('llm_config', ${json})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}
```

**Step 2: Commit**

```bash
git add src/llm/config.ts
git commit -m "feat: add LLMConfig interface and DB helpers"
```

---

### Task 2: Update `src/classify.ts` to use `getLLMConfig`

**Files:**
- Modify: `src/classify.ts` (lines 1–27)

**Context:**

`resolveLLMConfig` in classify.ts currently hardcodes `apiKey: process.env.LLM_API_KEY || ""`. We replace it with `getLLMConfig` and pick the key for the active provider.

**Step 1: Replace `resolveLLMConfig` in `src/classify.ts`**

Remove the old `resolveLLMConfig` function (lines 13–27) and replace the import + usage:

At the top, change:
```typescript
import { resolveConfigValue } from "./config.js";
```
to:
```typescript
import { getLLMConfig } from "./llm/config.js";
```

Replace the `resolveLLMConfig` function with:
```typescript
async function resolveLLMConfig(sql?: postgres.Sql): Promise<{ provider: string; apiKey: string; model: string; baseUrl?: string }> {
  if (!sql) {
    return {
      provider: process.env.LLM_PROVIDER || "anthropic",
      apiKey: process.env.LLM_API_KEY || "",
      model: process.env.LLM_MODEL || "claude-sonnet-4-20250514",
      baseUrl: process.env.LLM_BASE_URL || undefined,
    };
  }
  const config = await getLLMConfig(sql);
  return {
    provider: config.provider,
    apiKey: config.apiKeys[config.provider] ?? "",
    model: config.model,
    baseUrl: config.baseUrl || undefined,
  };
}
```

**Step 2: Verify the app still starts**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

**Step 3: Commit**

```bash
git add src/classify.ts
git commit -m "feat: classify reads per-provider API key from LLMConfig"
```

---

### Task 3: Make `LLM_API_KEY` optional in `src/config.ts`

**Files:**
- Modify: `src/config.ts`

**Context:**

Currently `LLM_API_KEY` is in `REQUIRED_VARS` and throws on startup if missing. Since users can now set it via the settings page, it becomes optional. The app starts without it; LLM features fail gracefully until a key is configured.

**Step 1: Remove `LLM_API_KEY` from `REQUIRED_VARS`**

In `src/config.ts`, change:
```typescript
const REQUIRED_VARS = [
  "DATABASE_URL",
  "LLM_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "WEBAPP_PASSWORD",
  "SESSION_SECRET",
] as const;
```
to:
```typescript
const REQUIRED_VARS = [
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "WEBAPP_PASSWORD",
  "SESSION_SECRET",
] as const;
```

Also update the `config` export — change:
```typescript
llmApiKey: process.env.LLM_API_KEY!,
```
to:
```typescript
llmApiKey: process.env.LLM_API_KEY ?? "",
```

**Step 2: Build to confirm no errors**

```bash
npm run build 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: LLM_API_KEY is now optional (configurable via settings UI)"
```

---

### Task 4: Update settings page — API key fields + live model fetch

**Files:**
- Modify: `src/web/settings.ts`

**Context:**

Key changes:
1. Remove hardcoded `models` arrays from `PROVIDER_PRESETS` for cloud providers.
2. Import `getLLMConfig` / `saveLLMConfig` from `src/llm/config.ts`.
3. On GET: read `llmConfig` via `getLLMConfig(sql)`. If the active provider has a key, fetch models from provider API. Pass fetched models to the template.
4. Add 4 password inputs (one per cloud provider) in the Classification section.
5. On POST: build `LLMConfig` from form, call `saveLLMConfig`, remove old per-key `toSave` entries for `llm_provider`, `llm_model`, `llm_base_url`.

**Step 1: Update imports and `PROVIDER_PRESETS` in `src/web/settings.ts`**

Add import at top:
```typescript
import { getLLMConfig, saveLLMConfig } from "../llm/config.js";
import type { LLMConfig } from "../llm/config.js";
```

Update `PROVIDER_PRESETS` — remove model arrays from cloud providers, keep metadata only:
```typescript
const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; needsKey: boolean }> = {
  anthropic: { label: "Anthropic", baseUrl: "", needsKey: true },
  openai:    { label: "OpenAI (ChatGPT)", baseUrl: "https://api.openai.com/v1", needsKey: true },
  groq:      { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  gemini:    { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true },
  local:     { label: "Local LLM", baseUrl: "http://localhost:1234/v1", needsKey: false },
  ollama:    { label: "Ollama", baseUrl: "http://ollama:11434/v1", needsKey: false },
};
```

**Step 2: Add model fetch helper in `src/web/settings.ts`**

Add this function after `PROVIDER_PRESETS`:

```typescript
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
```

**Step 3: Update the GET handler to use `getLLMConfig` and fetch models**

Replace the block that resolves `llmProvider`, `llmModel`, `llmBaseUrl` and the Ollama fetch with:

```typescript
const llmConfig = await getLLMConfig(sql);
const llmProvider = llmConfig.provider;
const llmModel = llmConfig.model;
const llmBaseUrl = llmConfig.baseUrl;

// Fetch models for currently selected provider
let providerModels: string[] = [];
const preset = PROVIDER_PRESETS[llmProvider];
if (preset?.needsKey) {
  const key = llmConfig.apiKeys[llmProvider] ?? "";
  providerModels = await fetchProviderModels(llmProvider, key, llmBaseUrl);
}

// Fetch available Ollama models
let ollamaModels: string[] = [];
try {
  const ollamaUrl = resolveEffective(dbSettings, "ollama_url", DEFAULTS.ollama_url);
  const tagsRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
  if (tagsRes.ok) {
    const tagsData = await tagsRes.json() as { models?: { name: string }[] };
    ollamaModels = (tagsData.models ?? []).map((m) => m.name);
  }
} catch { /* unreachable */ }
```

**Step 4: Add API key fields to the Classification section HTML**

In the Classification card, after the Provider/Model row, add a new row for API keys. Insert after the closing `</div>` of the provider/model grid and before the base URL row:

```html
<!-- Row: API Keys (cloud providers only) -->
<div class="mt-3 space-y-2">
  <div class="text-[10px] uppercase tracking-widest text-muted-foreground">API Keys</div>
  <div class="grid grid-cols-2 gap-3">
    ${["anthropic", "openai", "groq", "gemini"].map(p => {
      const label = PROVIDER_PRESETS[p]?.label ?? p;
      const val = escapeHtml(llmConfig.apiKeys[p] ?? "");
      return `
        <div class="flex flex-col gap-1">
          <label for="apikey_${p}" class="text-[10px] text-muted-foreground">${escapeHtml(label)}</label>
          <input type="password" id="apikey_${p}" name="apikey_${p}" value="${val}"
            autocomplete="off"
            placeholder="Paste key..."
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
        </div>`;
    }).join("")}
  </div>
</div>
```

**Step 5: Update model dropdown to use fetched `providerModels`**

Replace the model select rendering logic. For cloud providers with `providerModels.length > 0`, render a select. If empty (no key or fetch failed), render an informational message + text input:

```typescript
// In the model field section:
const hasModels = providerModels.length > 0;
const isTextProvider = llmProvider === "local" || llmProvider === "ollama";

// Model select (cloud, has models):
const modelSelectHtml = hasModels
  ? `<select id="llm_model_select" name="_llm_model_select"
      class="h-8 rounded-md border border-border bg-transparent px-2.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary${isTextProvider ? " hidden" : ""}">
      ${providerModels.map(m =>
        `<option value="${escapeHtml(m)}"${llmModel === m ? " selected" : ""}>${escapeHtml(m)}</option>`
      ).join("")}
      <option value="__other__"${!providerModels.includes(llmModel) ? " selected" : ""}>Other...</option>
    </select>`
  : `<span class="text-[10px] text-muted-foreground italic${isTextProvider ? " hidden" : ""}">
      Enter an API key above to see available models
    </span>`;
```

Keep the free text input visible always for local/ollama or as fallback.

**Step 6: Update PRESETS JS variable passed to client script**

The client script uses `PRESETS` for base URLs. Update the JS variable — models are no longer needed client-side (they come from server):

```typescript
var PRESETS = ${JSON.stringify(
  Object.fromEntries(Object.entries(PROVIDER_PRESETS).map(([k, v]) => [k, { baseUrl: v.baseUrl }]))
)};
```

**Step 7: Commit**

```bash
git add src/web/settings.ts
git commit -m "feat: settings page — per-provider API keys and live model fetch"
```

---

### Task 5: Update settings POST handler

**Files:**
- Modify: `src/web/settings.ts` (POST handler)

**Context:**

The POST handler currently builds a `toSave` map with `llm_provider`, `llm_model`, `llm_base_url` as flat keys. Now we build an `LLMConfig` and call `saveLLMConfig`. The non-LLM settings still go through `saveAllSettings`.

**Step 1: Update the POST form parsing**

In the POST handler, add parsing for API key fields:

```typescript
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
```

**Step 2: Update the save block**

Replace:
```typescript
const toSave: Record<string, string> = {
  ...
  llm_provider: form.llm_provider,
  llm_model: form.llm_model,
  llm_base_url: form.llm_base_url,
  ...
};
await saveAllSettings(sql, toSave);
```

With:
```typescript
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
```

**Step 3: Update validation**

The `validateSettings` function checks `form.llm_model`. Since `llm_model` is now in `llmConfig`, update the check:

```typescript
if (!llmConfig.model || !llmConfig.model.trim()) {
  return c.redirect(`/settings?error=${encodeURIComponent("Model name is required.")}`, 302);
}
```

(Pass `llmConfig` to a revised `validateSettings` or just inline the model check in the handler.)

**Step 4: Build and verify**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build.

**Step 5: Commit**

```bash
git add src/web/settings.ts
git commit -m "feat: settings POST saves LLMConfig blob, removes flat LLM keys"
```

---

### Task 6: Smoke test

**Manual verification steps:**

1. Start the app: `docker compose up` (or `npm run dev`)
2. Open `/settings`
3. Verify the Classification section shows 4 API key password inputs (Anthropic, OpenAI, Groq, Gemini)
4. Enter your Anthropic key in the Anthropic field → save → reload → verify key is prefilled (masked)
5. Verify model dropdown shows live models fetched from Anthropic API
6. Switch provider to Groq, enter Groq key → save → reload → verify Groq models appear
7. Switch to Ollama → verify text input appears, key fields are still visible but unused
8. Switch to Local → same as Ollama
9. Send a test Telegram message → verify classification still works (picks up key from `llm_config` row)
10. Check DB directly: `SELECT key, left(value, 80) FROM settings WHERE key = 'llm_config';`

**Step 1: Commit if all good**

```bash
git add -p  # stage any fixups
git commit -m "fix: smoke test fixups for llm-config per-provider keys"
```
