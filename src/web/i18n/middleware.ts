/**
 * Locale Hono middleware.
 *
 * Runs on every request. Sets `c.set("locale", locale)` and
 * `c.set("t", i18next.getFixedT(locale))`. Paths matching `isPreAuthPath`
 * skip the DB lookup — `/login`, `/setup`, `/setup/*` — so setup-wizard
 * and login render in the Accept-Language locale without a session.
 */

import type { MiddlewareHandler } from "hono";
import type { Sql } from "postgres";
import { i18next } from "./index.js";
import { resolveLocale } from "./resolve.js";

function isPreAuthPath(path: string): boolean {
  if (path === "/login") return true;
  if (path === "/logout") return true;
  if (path === "/setup") return true;
  if (path.startsWith("/setup/")) return true;
  return false;
}

export function createLocaleMiddleware(sql: Sql): MiddlewareHandler {
  return async (c, next) => {
    const isPreAuth = isPreAuthPath(c.req.path);
    const locale = await resolveLocale(c, sql, isPreAuth);
    c.set("locale", locale);
    c.set("t", i18next.getFixedT(locale));
    await next();
  };
}
