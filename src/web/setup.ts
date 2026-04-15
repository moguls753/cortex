import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type postgres from "postgres";
import bcrypt from "bcryptjs";
import { escapeHtml } from "./shared.js";
import { getUserCount, getUserPasswordHash, createUser, getSetupSummary } from "./setup-queries.js";
import { saveAllSettings } from "./settings-queries.js";
import { getLLMConfig, saveLLMConfig } from "../llm/config.js";
import type { LLMConfig } from "../llm/config.js";
import { startBot } from "../telegram.js";
import { createLogger } from "../logger.js";

const log = createLogger("setup");
import {
  iconBrain,
  iconShield,
  iconCheck,
  iconMessageSquare,
  iconChevronRight,
} from "./icons.js";

type Sql = postgres.Sql;

const COOKIE_NAME = "cortex_session";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const THIRTY_DAYS_MS = THIRTY_DAYS_SECONDS * 1000;

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
    const res = await fetch(`${baseUrl}/models`, {
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

// ─── Session Helpers ───────────────────────────────────────────────

function sign(payload: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verify(token: string, secret: string): string | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payload = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  try {
    const sigBuf = Buffer.from(signature, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
  } catch {
    return null;
  }

  return payload;
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const key = pair.substring(0, eqIndex).trim();
    const value = pair.substring(eqIndex + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

function getSessionPayload(
  cookieHeader: string | null,
  secret: string,
): { issuedAt: number } | null {
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const decoded = decodeURIComponent(token);
  const payload = verify(decoded, secret);
  if (!payload) return null;

  try {
    const data = JSON.parse(payload);
    if (typeof data.issued_at !== "number") return null;
    return { issuedAt: data.issued_at };
  } catch {
    return null;
  }
}

function isAuthenticated(cookieHeader: string | null, secret: string): boolean {
  const session = getSessionPayload(cookieHeader, secret);
  if (!session) return false;
  const elapsed = Date.now() - session.issuedAt;
  return elapsed < THIRTY_DAYS_MS;
}

function setSessionCookie(c: any, secret: string): void {
  const payload = JSON.stringify({ issued_at: Date.now() });
  const token = sign(payload, secret);
  const cookieValue = encodeURIComponent(token);
  const setCookie =
    `${COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${THIRTY_DAYS_SECONDS}`;
  c.header("Set-Cookie", setCookie);
}

// ─── Setup Layout ──────────────────────────────────────────────────

function renderSetupLayout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="/public/favicon.svg">
  <link rel="stylesheet" href="/public/style.css">
  <script>
    (function(){
      try {
        var t = localStorage.getItem("cortex-theme");
        var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (t === "dark" || (!t && prefersDark)) {
          document.documentElement.classList.add("dark");
        }
      } catch(e) {}
    })();
  </script>
</head>
<body class="font-sans antialiased">
  <div class="h-dvh flex flex-col px-6 py-4 gap-4 max-w-lg mx-auto w-full justify-center">
    ${content}
  </div>
</body>
</html>`;
}

function stepIndicator(current: number): string {
  const steps = [
    { num: 1, label: "Account" },
    { num: 2, label: "LLM" },
    { num: 3, label: "Telegram" },
    { num: 4, label: "Done" },
  ];
  return `<div class="flex items-center justify-center gap-2 mb-6">
    ${steps.map((s) => {
      const isActive = s.num === current;
      const isDone = s.num < current;
      const cls = isActive
        ? "text-primary font-medium"
        : isDone
          ? "text-primary/60"
          : "text-muted-foreground";
      return `<span class="text-[10px] uppercase tracking-widest ${cls}">${s.label}</span>${s.num < 4 ? `<span class="text-muted-foreground">${iconChevronRight("size-3")}</span>` : ""}`;
    }).join("")}
  </div>`;
}

// ─── Setup Middleware ──────────────────────────────────────────────

export function createSetupMiddleware(sql: Sql, secret: string): MiddlewareHandler {
  if (!secret) {
    throw new Error("createSetupMiddleware requires a non-empty session secret");
  }
  const sessionSecret = secret;

  return async (c, next) => {
    const path = c.req.path;

    // Always allow health, public assets, display endpoints
    if (
      path === "/health" ||
      path.startsWith("/public/") ||
      path === "/api/kitchen.png" ||
      path === "/api/display"
    ) {
      await next();
      return;
    }

    const count = await getUserCount(sql);

    if (count === 0) {
      // Setup mode: allow /setup* routes, redirect everything else to /setup
      if (path.startsWith("/setup")) {
        await next();
        return;
      }
      return c.redirect("/setup", 302);
    }

    // Normal mode (user exists)

    // /setup* routes: let through to route handlers (they handle redirect logic)
    // The route handlers will redirect /setup to /login or / as appropriate
    if (path.startsWith("/setup")) {
      await next();
      return;
    }

    // Allow /login and /logout through
    if (path === "/login" || path === "/logout") {
      await next();
      return;
    }

    // For all other routes: check authentication
    const cookieHeader = c.req.header("cookie") ?? null;
    if (isAuthenticated(cookieHeader, sessionSecret)) {
      await next();
      return;
    }

    // Not authenticated — redirect to /login
    if (path.startsWith("/api/") || path.startsWith("/mcp")) {
      return c.text("Unauthorized", 401);
    }

    const redirect = encodeURIComponent(path);
    return c.redirect(`/login?redirect=${redirect}`, 302);
  };
}

// ─── Setup Routes ─────────────────────────────────────────────────

export function createSetupRoutes(sql: Sql, secret: string): Hono {
  if (!secret) {
    throw new Error("createSetupRoutes requires a non-empty session secret");
  }
  const app = new Hono();
  const sessionSecret = secret;

  // ── Login Routes ──────────────────────────────────────────────

  // GET /login
  app.get("/login", async (c) => {
    // If no user exists, redirect to /setup
    const count = await getUserCount(sql);
    if (count === 0) {
      return c.redirect("/setup", 302);
    }

    // If already authenticated, redirect to /
    const cookieHeader = c.req.header("cookie") ?? null;
    if (isAuthenticated(cookieHeader, sessionSecret)) {
      return c.redirect("/", 302);
    }

    return c.html(renderLoginPage());
  });

  // POST /login
  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const submittedPassword = (body["password"] as string) || "";

    const passwordHash = await getUserPasswordHash(sql);
    if (!passwordHash) {
      return c.redirect("/setup", 302);
    }

    const isValid = await bcrypt.compare(submittedPassword, passwordHash);
    if (!isValid) {
      return c.html(renderLoginPage("Invalid password"), 200);
    }

    // Create session
    setSessionCookie(c, sessionSecret);

    // Redirect to original URL or /
    const url = new URL(c.req.url);
    const redirectTo = url.searchParams.get("redirect") || "/";
    return c.redirect(redirectTo, 302);
  });

  // POST /logout
  app.post("/logout", (c) => {
    const setCookie =
      `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
    c.header("Set-Cookie", setCookie);
    return c.redirect("/login", 302);
  });

  // ── Setup Wizard Routes ──────────────────────────────────────

  // GET /setup → redirect to step 1, or to /login if user exists
  app.get("/setup", async (c) => {
    const count = await getUserCount(sql);
    if (count > 0) {
      const cookieHeader = c.req.header("cookie") ?? null;
      if (isAuthenticated(cookieHeader, sessionSecret)) {
        return c.redirect("/", 302);
      }
      return c.redirect("/login", 302);
    }
    return c.html(renderStep1());
  });

  // GET /setup/step/1
  app.get("/setup/step/1", async (c) => {
    const count = await getUserCount(sql);
    if (count > 0) {
      const cookieHeader = c.req.header("cookie") ?? null;
      if (isAuthenticated(cookieHeader, sessionSecret)) {
        return c.redirect("/", 302);
      }
      return c.redirect("/login", 302);
    }
    return c.html(renderStep1());
  });

  // POST /setup/step/1
  app.post("/setup/step/1", async (c) => {
    // Guard: if a user already exists, reject unless the caller is the same
    // authenticated session (idempotent same-session double-submit). This
    // closes an auth-bypass where a `createUser` PK conflict silently issued
    // a session cookie for the real user.
    const preCount = await getUserCount(sql);
    if (preCount > 0) {
      const cookieHeader = c.req.header("cookie") ?? null;
      if (isAuthenticated(cookieHeader, sessionSecret)) {
        // Same-session double-submit — silently advance.
        return c.redirect("/setup/step/2", 302);
      }
      return c.redirect("/login", 302);
    }

    const body = await c.req.parseBody();
    const displayName = ((body.display_name as string) || "").trim();
    const password = (body.password as string) || "";
    const confirmPassword = (body.confirm_password as string) || "";

    // Validation
    if (password.length < 8) {
      return c.html(renderStep1("Password must be at least 8 characters.", displayName));
    }
    if (password !== confirmPassword) {
      return c.html(renderStep1("Passwords do not match.", displayName));
    }
    if (displayName.length > 50) {
      return c.html(renderStep1("Display name must be 50 characters or fewer.", ""));
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    try {
      await createUser(sql, {
        passwordHash,
        displayName: displayName || null,
      });
    } catch (err) {
      // Concurrent double-submit race: the other request won the PK insert.
      // Verify the user now exists (guard against spurious DB errors), then
      // either advance or re-render with an error. Never issue a session
      // cookie in a failure path.
      const postCount = await getUserCount(sql);
      if (postCount > 0) {
        return c.redirect("/login", 302);
      }
      log.error("Failed to create user account", {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.html(renderStep1("Could not create account. Please try again.", displayName));
    }

    // Auto-login — first successful creation only.
    setSessionCookie(c, sessionSecret);

    return c.redirect("/setup/step/2", 302);
  });

  // Helper: require authentication for steps 2-4
  function requireSetupAuth(c: any): Response | null {
    const cookieHeader = c.req.header("cookie") ?? null;
    if (!isAuthenticated(cookieHeader, sessionSecret)) {
      return c.redirect("/setup", 302);
    }
    return null;
  }

  // GET /setup/step/2
  app.get("/setup/step/2", async (c) => {
    const authRedirect = requireSetupAuth(c);
    if (authRedirect) return authRedirect;

    const llmConfig = await getLLMConfig(sql);
    return c.html(renderStep2(llmConfig));
  });

  // POST /setup/step/2
  app.post("/setup/step/2", async (c) => {
    const authRedirect = requireSetupAuth(c);
    if (authRedirect) return authRedirect;

    const body = await c.req.parseBody();
    const action = (body.action as string) || "";

    if (action === "skip") {
      return c.redirect("/setup/step/3", 302);
    }

    const provider = (body.llm_provider as string) || "anthropic";
    const model = (body.llm_model as string) || "";
    const baseUrl = (body.llm_base_url as string) || PROVIDER_PRESETS[provider]?.baseUrl || "";

    const llmConfig: LLMConfig = {
      provider,
      model,
      baseUrl,
      apiKeys: {
        anthropic: (body.apikey_anthropic as string) || "",
        openai: (body.apikey_openai as string) || "",
        groq: (body.apikey_groq as string) || "",
        gemini: (body.apikey_gemini as string) || "",
      },
    };

    await saveLLMConfig(sql, llmConfig);

    return c.redirect("/setup/step/3", 302);
  });

  // API: fetch models for a provider (used by step 2 JS).
  // Reachable only in setup mode (no user yet) OR when the caller holds a
  // valid setup session. Otherwise the endpoint is a server-side request
  // forgery surface: it fetches an attacker-controlled baseUrl on the
  // server's behalf.
  app.post("/setup/api/models", async (c) => {
    const count = await getUserCount(sql);
    if (count > 0) {
      const authRedirect = requireSetupAuth(c);
      if (authRedirect) return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => ({})) as Record<string, string>;
    const provider = body.provider || "";
    // Only allow providers from the preset allowlist — rejects arbitrary
    // baseUrls. Ollama uses an internal Docker hostname, others use their
    // canonical public endpoint.
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) {
      return c.json({ models: [] });
    }
    const apiKey = body.apiKey || "";
    const models = await fetchProviderModels(provider, apiKey, preset.baseUrl);
    return c.json({ models });
  });

  // GET /setup/step/3
  app.get("/setup/step/3", async (c) => {
    const authRedirect = requireSetupAuth(c);
    if (authRedirect) return authRedirect;

    return c.html(renderStep3());
  });

  // POST /setup/step/3
  app.post("/setup/step/3", async (c) => {
    const authRedirect = requireSetupAuth(c);
    if (authRedirect) return authRedirect;

    const body = await c.req.parseBody();
    const action = (body.action as string) || "";

    if (action === "skip") {
      return c.redirect("/setup/step/4", 302);
    }

    const botToken = ((body.telegram_bot_token as string) || "").trim();
    const chatId = ((body.telegram_chat_id as string) || "").trim();

    if (botToken || chatId) {
      const settings: Record<string, string> = {};
      if (botToken) settings.telegram_bot_token = botToken;
      if (chatId) settings.telegram_chat_ids = chatId;
      await saveAllSettings(sql, settings);

      // Start the Telegram bot immediately (no restart needed)
      if (botToken) {
        startBot(sql).catch((err) => {
          log.warn("Failed to start Telegram bot after setup", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    return c.redirect("/setup/step/4", 302);
  });

  // GET /setup/step/4
  app.get("/setup/step/4", async (c) => {
    const authRedirect = requireSetupAuth(c);
    if (authRedirect) return authRedirect;

    const summary = await getSetupSummary(sql);
    return c.html(renderStep4(summary));
  });

  return app;
}

// ─── Render Functions ─────────────────────────────────────────────

function renderStep1(error?: string, displayName?: string): string {
  const errorHtml = error
    ? `<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">${escapeHtml(error)}</div>`
    : "";

  return renderSetupLayout("Setup", `
    ${stepIndicator(1)}
    <div class="rounded-md border border-border bg-card p-4">
      <div class="flex items-center gap-2 mb-3">
        ${iconShield("size-3 text-primary")}
        <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Account</span>
        <span class="flex-1 h-px bg-border"></span>
      </div>
      <form method="POST" action="/setup/step/1" class="space-y-3">
        ${errorHtml}
        <div class="flex flex-col gap-1.5">
          <label for="display_name" class="text-xs text-muted-foreground">Display Name</label>
          <input type="text" id="display_name" name="display_name" value="${escapeHtml(displayName || "")}"
            placeholder="Optional"
            maxlength="50"
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-xs text-muted-foreground">Password</label>
          <input type="password" id="password" name="password" required minlength="8"
            placeholder="Minimum 8 characters"
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="confirm_password" class="text-xs text-muted-foreground">Confirm Password</label>
          <input type="password" id="confirm_password" name="confirm_password" required
            placeholder="Re-enter password"
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
        </div>
        <div class="flex justify-end pt-1">
          <button type="submit"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Create Account
          </button>
        </div>
      </form>
    </div>
  `);
}

const OLLAMA_RECOMMENDED = [
  { name: "qwen2.5:3b", ram: "~2.5 GB", note: "Fast, basic quality" },
  { name: "qwen2.5:7b", ram: "~4.7 GB", note: "Recommended", primary: true },
  { name: "qwen2.5:14b", ram: "~9 GB", note: "Best quality" },
  { name: "mistral-nemo:12b", ram: "~7.5 GB", note: "Alternative" },
  { name: "llama3.2:3b", ram: "~2.5 GB", note: "Fast, EN only" },
];

function renderStep2(llmConfig: LLMConfig): string {
  const provider = llmConfig.provider || "ollama";
  const model = llmConfig.model || "";
  const activePreset = PROVIDER_PRESETS[provider];
  const activeNeedsKey = activePreset?.needsKey ?? false;
  const isOllama = provider === "ollama";
  const activeLabel = activePreset?.label ?? provider;
  const activeKeyVal = escapeHtml(llmConfig.apiKeys[provider as keyof typeof llmConfig.apiKeys] ?? "");

  return renderSetupLayout("Setup — Language Model", `
    ${stepIndicator(2)}
    <div class="rounded-md border border-border bg-card p-4">
      <div class="flex items-center gap-2 mb-3">
        ${iconBrain("size-3 text-primary")}
        <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Language Model</span>
        <span class="flex-1 h-px bg-border"></span>
      </div>
      <form method="POST" action="/setup/step/2" class="space-y-3">
        <!-- Provider + Model -->
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="llm_provider" class="text-xs text-muted-foreground">Provider</label>
            <select id="llm_provider" name="llm_provider"
              class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary">
              ${!provider ? `<option value="" selected disabled>Select a provider...</option>` : ""}
              ${Object.entries(PROVIDER_PRESETS).map(([value, p]) =>
                `<option value="${escapeHtml(value)}"${provider === value ? " selected" : ""}>${escapeHtml(p.label)}</option>`
              ).join("")}
            </select>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="llm_model" class="text-xs text-muted-foreground">Model</label>
            <select id="llm_model_select"
              class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary hidden">
            </select>
            <input type="text" id="llm_model_text" value="${escapeHtml(model)}"
              placeholder="${isOllama ? "e.g. qwen2.5:7b" : "Select a provider first"}"
              class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
            <input type="hidden" id="llm_model" name="llm_model" value="${escapeHtml(model)}" />
            <span id="model-loading" class="text-[10px] text-muted-foreground hidden">Loading models...</span>
          </div>
        </div>

        <!-- API Key (single field, label switches per provider) -->
        <div id="apikey-row" class="flex flex-col gap-1.5${!activeNeedsKey ? " hidden" : ""}">
          <label id="apikey-label" for="apikey_active" class="text-xs text-muted-foreground">
            <span id="apikey-provider-name">${escapeHtml(activeLabel)}</span> API Key
          </label>
          <input type="password" id="apikey_active" value="${activeKeyVal}"
            autocomplete="new-password"
            placeholder="Paste key..."
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
        </div>
        <!-- Hidden inputs carry all API keys -->
        ${(["anthropic", "openai", "groq", "gemini"] as const).map(p => {
          const val = escapeHtml(llmConfig.apiKeys[p] ?? "");
          return `<input type="hidden" id="apikey_${p}" name="apikey_${p}" value="${val}" />`;
        }).join("\n        ")}

        <!-- Base URL (read-only for Ollama, hidden when no provider, editable for others) -->
        <div id="base-url-row" class="flex flex-col gap-1.5${!provider ? " hidden" : ""}">
          <label for="llm_base_url" class="text-xs text-muted-foreground">Base URL</label>
          ${isOllama
            ? `<input type="text" value="http://ollama:11434/v1" readonly
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none cursor-default text-muted-foreground" />
              <span class="text-[10px] text-muted-foreground">Internal Docker endpoint — managed automatically.</span>
              <input type="hidden" id="llm_base_url" name="llm_base_url" value="http://ollama:11434/v1" />`
            : `<input type="text" id="llm_base_url" name="llm_base_url"
                value="${escapeHtml(llmConfig.baseUrl || activePreset?.baseUrl || "")}"
                class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />`
          }
        </div>

        <!-- Ollama section (only when Ollama selected) -->
        <div id="ollama-section" class="space-y-3${!isOllama ? " hidden" : ""}">
          <div>
            <div class="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Select a Model</div>
            <div class="flex flex-wrap gap-1.5">
              ${OLLAMA_RECOMMENDED.map(m =>
                `<button type="button" data-ollama-model="${escapeHtml(m.name)}"
                  class="ollama-model-chip rounded border px-2 py-0.5 text-[10px] font-mono transition-colors
                    ${model === m.name
                      ? "border-primary text-primary"
                      : "border-border bg-secondary text-muted-foreground hover:border-primary hover:text-primary"}">
                  ${escapeHtml(m.name)}
                  <span class="text-muted-foreground ml-1">${escapeHtml(m.ram)}</span>
                </button>`
              ).join("")}
            </div>
          </div>
          <span class="text-[10px] text-muted-foreground">The selected model will be downloaded automatically after setup.</span>
        </div>

        <div class="flex items-center justify-between pt-1">
          <button type="submit" name="action" value="skip"
            class="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Skip
          </button>
          <button type="submit"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Save & Continue
          </button>
        </div>
      </form>
    </div>

    <script>
    (function() {
      var PRESETS = ${JSON.stringify(
        Object.fromEntries(Object.entries(PROVIDER_PRESETS).map(([k, v]) => [k, { baseUrl: v.baseUrl, needsKey: v.needsKey, label: v.label }]))
      )};
      var providerSelect = document.getElementById('llm_provider');
      var modelSelect = document.getElementById('llm_model_select');
      var modelText = document.getElementById('llm_model_text');
      var modelHidden = document.getElementById('llm_model');
      var modelLoading = document.getElementById('model-loading');
      var apikeyRow = document.getElementById('apikey-row');
      var apikeyActive = document.getElementById('apikey_active');
      var apikeyLabel = document.getElementById('apikey-provider-name');
      var baseUrlRow = document.getElementById('base-url-row');
      var ollamaSection = document.getElementById('ollama-section');
      var currentKeyProvider = '${escapeHtml(provider)}';
      var fetchTimeout = null;

      function saveActiveKey() {
        var h = document.getElementById('apikey_' + currentKeyProvider);
        if (h && apikeyActive) h.value = apikeyActive.value;
      }

      function setModel(val) {
        if (modelHidden) modelHidden.value = val;
      }

      function showModelSelect(models) {
        if (!modelSelect || !modelText) return;
        if (models.length === 0) {
          modelSelect.classList.add('hidden');
          modelText.classList.remove('hidden');
          modelText.placeholder = 'Type model name...';
          return;
        }
        var current = modelHidden ? modelHidden.value : '';
        modelSelect.innerHTML = '<option value="" disabled>Select a model...</option>';
        models.forEach(function(m) {
          var opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          if (m === current) opt.selected = true;
          modelSelect.appendChild(opt);
        });
        var otherOpt = document.createElement('option');
        otherOpt.value = '__other__';
        otherOpt.textContent = 'Other...';
        modelSelect.appendChild(otherOpt);
        modelSelect.classList.remove('hidden');
        modelText.classList.add('hidden');
        if (!current) setModel('');
      }

      function showModelText(placeholder) {
        if (!modelSelect || !modelText) return;
        modelSelect.classList.add('hidden');
        modelText.classList.remove('hidden');
        modelText.placeholder = placeholder || 'Type model name...';
      }

      function fetchModels(provider, apiKey) {
        if (!apiKey || !provider) return;
        var preset = PRESETS[provider] || {};
        if (!preset.needsKey) return;
        var baseUrlInput = document.getElementById('llm_base_url');
        var baseUrl = baseUrlInput ? baseUrlInput.value : (preset.baseUrl || '');
        if (modelLoading) modelLoading.classList.remove('hidden');
        fetch('/setup/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: provider, apiKey: apiKey, baseUrl: baseUrl })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (modelLoading) modelLoading.classList.add('hidden');
          showModelSelect(data.models || []);
        })
        .catch(function() {
          if (modelLoading) modelLoading.classList.add('hidden');
          showModelText('Type model name...');
        });
      }

      function applyProvider(p) {
        var preset = PRESETS[p] || {};
        saveActiveKey();
        currentKeyProvider = p;

        // API Key
        if (apikeyRow) {
          if (preset.needsKey) {
            apikeyRow.classList.remove('hidden');
            var h = document.getElementById('apikey_' + p);
            if (apikeyActive) apikeyActive.value = h ? h.value : '';
            if (apikeyLabel) apikeyLabel.textContent = preset.label || p;
          } else {
            apikeyRow.classList.add('hidden');
          }
        }

        // Base URL
        if (baseUrlRow) {
          baseUrlRow.classList.remove('hidden');
          if (p === 'ollama') {
            baseUrlRow.innerHTML = '<label class="text-xs text-muted-foreground">Base URL</label>'
              + '<input type="text" value="http://ollama:11434/v1" readonly class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none cursor-default text-muted-foreground" />'
              + '<span class="text-[10px] text-muted-foreground">Internal Docker endpoint — managed automatically.</span>'
              + '<input type="hidden" id="llm_base_url" name="llm_base_url" value="http://ollama:11434/v1" />';
          } else {
            baseUrlRow.innerHTML = '<label for="llm_base_url" class="text-xs text-muted-foreground">Base URL</label>'
              + '<input type="text" id="llm_base_url" name="llm_base_url" value="' + (preset.baseUrl || '') + '" class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary" />';
          }
        }

        // Ollama section
        if (ollamaSection) {
          p === 'ollama' ? ollamaSection.classList.remove('hidden') : ollamaSection.classList.add('hidden');
        }

        // Model: reset and update based on provider
        setModel('');
        if (p === 'ollama') {
          showModelText('e.g. qwen2.5:7b');
        } else if (preset.needsKey) {
          var existingKey = document.getElementById('apikey_' + p);
          if (existingKey && existingKey.value) {
            fetchModels(p, existingKey.value);
          } else {
            showModelText('Add key to load');
          }
        } else {
          showModelText('e.g. local-model-name');
        }
      }

      // Prevent Enter from submitting the form — user must click Save & Continue
      var form = document.querySelector('form[action="/setup/step/2"]');
      if (form) {
        form.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') {
            e.preventDefault();
          }
        });
      }

      if (providerSelect) {
        providerSelect.addEventListener('change', function() { applyProvider(this.value); });
      }

      if (apikeyActive) {
        apikeyActive.addEventListener('input', function() {
          saveActiveKey();
          // Debounce model fetch — wait 500ms after typing stops
          clearTimeout(fetchTimeout);
          fetchTimeout = setTimeout(function() {
            var key = apikeyActive.value.trim();
            if (key.length > 10) {
              fetchModels(currentKeyProvider, key);
            }
          }, 500);
        });
      }

      // Model select → hidden input sync
      if (modelSelect) {
        modelSelect.addEventListener('change', function() {
          if (modelSelect.value === '__other__') {
            showModelText('Type model name...');
            modelText.focus();
          } else {
            setModel(modelSelect.value);
          }
        });
      }
      if (modelText) {
        modelText.addEventListener('input', function() {
          setModel(modelText.value);
        });
      }

      // Ollama model chip clicks
      document.addEventListener('click', function(e) {
        var chip = e.target.closest('[data-ollama-model]');
        if (!chip) return;
        var m = chip.getAttribute('data-ollama-model');
        if (modelText) modelText.value = m;
        setModel(m);
        document.querySelectorAll('.ollama-model-chip').forEach(function(c) {
          c.classList.remove('border-primary', 'text-primary');
        });
        chip.classList.add('border-primary', 'text-primary');
      });
    })();
    </script>
  `);
}

function renderStep3(): string {
  return renderSetupLayout("Setup — Telegram", `
    ${stepIndicator(3)}
    <div class="rounded-md border border-border bg-card p-4">
      <div class="flex items-center gap-2 mb-3">
        ${iconMessageSquare("size-3 text-primary")}
        <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Telegram</span>
        <span class="flex-1 h-px bg-border"></span>
      </div>
      <form method="POST" action="/setup/step/3" class="space-y-3">
        <div class="rounded border border-border/60 bg-secondary/50 px-3 py-2.5 space-y-1.5">
          <div class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">How to create a bot</div>
          <ol class="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside">
            <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="text-primary hover:underline">@BotFather</a> in Telegram</li>
            <li>Send <code class="text-primary font-mono">/newbot</code>, pick a name and username</li>
            <li>Copy the token and paste it below</li>
          </ol>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="telegram_bot_token" class="text-xs text-muted-foreground">Bot Token</label>
          <input type="text" id="telegram_bot_token" name="telegram_bot_token"
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="telegram_chat_id" class="text-xs text-muted-foreground">Chat ID <span class="text-muted-foreground/60">(optional)</span></label>
          <input type="text" id="telegram_chat_id" name="telegram_chat_id"
            placeholder="123456789"
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground" />
          <span class="text-[10px] text-muted-foreground">
            Send any message to your bot, then find your chat ID in
            <a href="/settings" class="text-primary hover:underline">Settings</a>
            or by messaging <a href="https://t.me/userinfobot" target="_blank" rel="noopener" class="text-primary hover:underline">@userinfobot</a> on Telegram.
            You can also add it later.
          </span>
        </div>
        <div class="flex items-center justify-between pt-1">
          <button type="submit" name="action" value="skip"
            class="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Skip
          </button>
          <button type="submit"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Save & Continue
          </button>
        </div>
      </form>
    </div>
  `);
}

function renderStep4(summary: { hasUser: boolean; hasLLM: boolean; hasTelegram: boolean }): string {
  function statusBadge(configured: boolean, label: string): string {
    if (configured) {
      return `<div class="flex items-center gap-2">
        ${iconCheck("size-3 text-primary")}
        <span class="text-sm text-foreground">${escapeHtml(label)}</span>
        <span class="text-[10px] text-primary">Configured</span>
      </div>`;
    }
    return `<div class="flex items-center gap-2">
      <span class="size-3 text-muted-foreground">-</span>
      <span class="text-sm text-muted-foreground">${escapeHtml(label)}</span>
      <span class="text-[10px] text-muted-foreground">Skipped — configure later in <a href="/settings" class="text-primary hover:underline">Settings</a></span>
    </div>`;
  }

  return renderSetupLayout("Setup Complete", `
    ${stepIndicator(4)}
    <div class="rounded-md border border-border bg-card p-4">
      <div class="flex items-center gap-2 mb-3">
        ${iconCheck("size-3 text-primary")}
        <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Setup Complete</span>
        <span class="flex-1 h-px bg-border"></span>
      </div>
      <div class="space-y-3">
        ${statusBadge(true, "Account")}
        ${statusBadge(summary.hasLLM, "Language Model")}
        ${statusBadge(summary.hasTelegram, "Telegram")}
      </div>
      <div class="flex justify-end pt-4">
        <a href="/"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          Go to Dashboard
        </a>
      </div>
    </div>
  `);
}

function renderLoginPage(error?: string): string {
  const errorHtml = error
    ? `<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">${escapeHtml(error)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — Cortex</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="/public/favicon.svg">
  <link rel="stylesheet" href="/public/style.css">
  <script>
    (function(){
      try {
        var t = localStorage.getItem("cortex-theme");
        var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (t === "dark" || (!t && prefersDark)) {
          document.documentElement.classList.add("dark");
        }
      } catch(e) {}
    })();
  </script>
</head>
<body class="font-sans antialiased">
  <div class="h-dvh flex flex-col px-6 py-4 gap-4 max-w-lg mx-auto w-full justify-center">
    <div class="flex items-center justify-center gap-2 mb-4">
      ${iconBrain("size-4 text-primary")}
      <span class="text-sm font-medium text-foreground tracking-tight">cortex</span>
    </div>
    <div class="rounded-md border border-border bg-card p-4">
      <div class="flex items-center gap-2 mb-3">
        ${iconShield("size-3 text-primary")}
        <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Log In</span>
        <span class="flex-1 h-px bg-border"></span>
      </div>
      <form method="POST" class="space-y-3">
        ${errorHtml}
        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-xs text-muted-foreground">Password</label>
          <input type="password" id="password" name="password" required
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </div>
        <div class="flex justify-end pt-1">
          <button type="submit"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Log in
          </button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}
