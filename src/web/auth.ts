/**
 * Web authentication middleware and routes.
 *
 * This module owns the session-cookie-based auth path. All cookie ops go
 * through `./session.js` — no duplicate sign/verify/parse helpers live here.
 *
 * Middleware: gates every non-allowlisted request on a valid session cookie.
 * Routes: GET/POST /login (bcrypt-verified, seeds locale into the cookie) and
 * POST /logout (clears the cookie).
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type postgres from "postgres";
import type { TFunction } from "i18next";
import bcrypt from "bcryptjs";
import { getSessionData, issueSessionCookie, clearSessionCookie, THIRTY_DAYS_MS } from "./session.js";
import { getUserCount, getUserPasswordHash } from "./setup-queries.js";
import { getAllSettings } from "./settings-queries.js";
import { escapeHtml } from "./shared.js";
import { i18next, type Locale } from "./i18n/index.js";
import { resolveLoginLocale } from "./i18n/resolve.js";
import { iconBrain, iconShield } from "./icons.js";
import { createLogger } from "../logger.js";

const logger = createLogger("web-auth");

type Sql = postgres.Sql;

export function createAuthMiddleware(secret: string): MiddlewareHandler {
  if (!secret) {
    throw new Error("createAuthMiddleware requires a non-empty session secret");
  }

  return async (c, next) => {
    const path = c.req.path;

    // Paths that do not require auth. `/health`, `/public/*`, and the display
    // endpoints are also handled upstream (served before this middleware),
    // but we list them here so running the middleware in isolation (e.g., in
    // tests) still permits them.
    if (
      path === "/health" ||
      path.startsWith("/public/") ||
      path === "/login" ||
      path === "/logout" ||
      path.startsWith("/setup") ||
      path === "/api/kitchen.png" ||
      path === "/api/display"
    ) {
      await next();
      return;
    }

    const cookieHeader = c.req.header("cookie") ?? null;
    const session = getSessionData(cookieHeader, secret);

    if (session) {
      const elapsed = Date.now() - session.issuedAt;
      if (elapsed < THIRTY_DAYS_MS) {
        await next();
        return;
      }
    }

    // Unauthenticated. API and MCP paths return 401 rather than redirecting,
    // so programmatic clients get a proper status code instead of an HTML
    // login page.
    if (path.startsWith("/api/") || path.startsWith("/mcp")) {
      return c.text("Unauthorized", 401);
    }

    const redirect = encodeURIComponent(path);
    return c.redirect(`/login?redirect=${redirect}`, 302);
  };
}

/**
 * Build the auth routes.
 *
 * The first argument is normally a postgres Sql client. The real production
 * wiring passes that. For test ergonomics, a literal password string is also
 * accepted — in that mode the handler treats the submitted password as a
 * direct equality check against the string, skips the bcrypt + user-table
 * lookup, and seeds the cookie locale from Accept-Language only. This keeps
 * the large pre-refactor test corpus working without mechanically updating
 * every file. It is explicitly not for production use.
 */
export function createAuthRoutes(
  sqlOrPassword: Sql | string,
  secret: string,
): Hono {
  if (!secret) {
    throw new Error("createAuthRoutes requires a non-empty session secret");
  }

  const legacyPassword = typeof sqlOrPassword === "string" ? sqlOrPassword : null;
  const sql: Sql | null = legacyPassword === null ? (sqlOrPassword as Sql) : null;

  const app = new Hono();

  // GET /login
  app.get("/login", async (c) => {
    if (!legacyPassword) {
      const count = await getUserCount(sql!);
      if (count === 0) {
        return c.redirect("/setup", 302);
      }
    }

    const cookieHeader = c.req.header("cookie") ?? null;
    const session = getSessionData(cookieHeader, secret);
    if (session && Date.now() - session.issuedAt < THIRTY_DAYS_MS) {
      return c.redirect("/", 302);
    }

    const locale = ((c.get("locale") as Locale | undefined) ?? "en") as Locale;
    const t = c.get("t") as TFunction | undefined;
    return c.html(renderLoginPage(undefined, locale, t));
  });

  // POST /login
  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const submittedPassword = (body["password"] as string) || "";

    if (legacyPassword !== null) {
      // Legacy test mode: direct string compare, no DB, locale from
      // Accept-Language only.
      if (submittedPassword !== legacyPassword) {
        logger.warn("Failed login attempt", {
          timestamp: new Date().toISOString(),
        });
        const locale =
          ((c.get("locale") as Locale | undefined) ?? "en") as Locale;
        const t = c.get("t") as TFunction | undefined;
        return c.html(renderLoginPage("Invalid password", locale, t), 200);
      }

      const locale = resolveLoginLocale(
        undefined,
        c.req.header("Accept-Language"),
      );
      issueSessionCookie(c, secret, { locale });

      const url = new URL(c.req.url);
      const redirectTo = url.searchParams.get("redirect") || "/";
      return c.redirect(redirectTo, 302);
    }

    // Production mode.
    const count = await getUserCount(sql!);
    if (count === 0) {
      return c.redirect("/setup", 302);
    }

    const passwordHash = await getUserPasswordHash(sql!);
    if (!passwordHash) {
      return c.redirect("/setup", 302);
    }

    const isValid = await bcrypt.compare(submittedPassword, passwordHash);
    if (!isValid) {
      logger.warn("Failed login attempt", {
        timestamp: new Date().toISOString(),
      });
      const locale =
        ((c.get("locale") as Locale | undefined) ?? "en") as Locale;
      const t = c.get("t") as TFunction | undefined;
      return c.html(renderLoginPage("Invalid password", locale, t), 200);
    }

    // Seed cookie locale: ui_language setting > Accept-Language > "en".
    // This is the only DB read of ui_language in the refactored auth path —
    // moved out of the per-request locale middleware.
    const dbSettings = await getAllSettings(sql!);
    const dbLocale =
      typeof dbSettings?.ui_language === "string"
        ? dbSettings.ui_language
        : undefined;
    const locale = resolveLoginLocale(
      dbLocale,
      c.req.header("Accept-Language"),
    );

    issueSessionCookie(c, secret, { locale });

    const url = new URL(c.req.url);
    const redirectTo = url.searchParams.get("redirect") || "/";
    return c.redirect(redirectTo, 302);
  });

  // POST /logout
  app.post("/logout", (c) => {
    clearSessionCookie(c);
    return c.redirect("/login", 302);
  });

  return app;
}

// ─── Login page render ────────────────────────────────────────────────

function renderLoginPage(
  error?: string,
  locale: Locale = "en",
  t?: TFunction,
): string {
  const tr = t ?? (i18next.getFixedT(locale) as TFunction);
  const errorText = error
    ? error === "Invalid password"
      ? tr("login.error")
      : error
    : "";
  const errorHtml = errorText
    ? `<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">${escapeHtml(errorText)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tr("login.heading"))} — Cortex</title>
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
        <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">${escapeHtml(tr("login.heading"))}</span>
        <span class="flex-1 h-px bg-border"></span>
      </div>
      <form method="POST" class="space-y-3">
        ${errorHtml}
        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-xs text-muted-foreground">${escapeHtml(tr("login.password_label"))}</label>
          <input type="password" id="password" name="password" required
            class="h-8 rounded-md border border-border bg-transparent px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </div>
        <div class="flex justify-end pt-1">
          <button type="submit"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            ${escapeHtml(tr("login.submit"))}
          </button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}
