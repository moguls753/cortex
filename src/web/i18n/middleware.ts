/**
 * Locale Hono middleware.
 *
 * Runs on every request. Sets `c.set("locale", locale)` and
 * `c.set("t", i18next.getFixedT(locale))`. Zero database queries — the
 * authenticated-path locale comes from the signed session cookie; the
 * pre-auth paths (`/login`, `/logout`, `/setup`, `/setup/*`) use the
 * `Accept-Language` header.
 */

import type { MiddlewareHandler } from "hono";
import { i18next } from "./index.js";
import { resolveLocale } from "./resolve.js";

function isPreAuthPath(path: string): boolean {
  if (path === "/login") return true;
  if (path === "/logout") return true;
  if (path === "/setup") return true;
  if (path.startsWith("/setup/")) return true;
  return false;
}

export function createLocaleMiddleware(secret: string): MiddlewareHandler {
  if (!secret) {
    throw new Error(
      "createLocaleMiddleware requires a non-empty session secret",
    );
  }

  return async (c, next) => {
    const isPreAuth = isPreAuthPath(c.req.path);
    const locale = resolveLocale(c, secret, isPreAuth);
    c.set("locale", locale);
    c.set("t", i18next.getFixedT(locale));
    await next();
  };
}
