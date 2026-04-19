/**
 * Locale resolution.
 *
 * `parseAcceptLanguage` parses per RFC 9110 §12.5.4 quality-value ordering
 * and returns the first supported primary subtag, or "en" fallback.
 *
 * After the auth refactor, the authenticated request path no longer reads
 * `ui_language` from the database on every request — the locale lives in
 * the session cookie and is seeded at login time. `resolveLocale` therefore
 * takes no `sql` argument; the login handler uses `resolveLoginLocale` once
 * per login to decide what to encode into the new cookie.
 */

import type { Context } from "hono";
import type { SessionData } from "../session.js";
import { getSessionData } from "../session.js";
import { SUPPORTED_LOCALES, type Locale } from "./index.js";

const SUPPORTED_SET = new Set<string>(SUPPORTED_LOCALES);

interface AcceptLanguageEntry {
  tag: string;
  q: number;
}

function parseEntries(header: string): AcceptLanguageEntry[] {
  const out: AcceptLanguageEntry[] = [];
  for (const raw of header.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const [tagPart, ...params] = trimmed.split(";");
    const tag = (tagPart ?? "").trim();
    if (!tag) continue;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=").map((s) => s.trim());
      if (key === "q" && value) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    out.push({ tag, q });
  }
  return out;
}

export function parseAcceptLanguage(
  header: string | undefined | null,
): Locale {
  if (!header || typeof header !== "string") return "en";
  const entries = parseEntries(header);
  if (entries.length === 0) return "en";

  // Stable sort by q descending
  const sorted = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => b.q - a.q || a.i - b.i);

  for (const entry of sorted) {
    if (entry.q <= 0) continue;
    const primary = (entry.tag.split("-")[0] ?? "").toLowerCase();
    if (!primary || primary === "*") continue;
    if (SUPPORTED_SET.has(primary)) return primary as Locale;
  }
  return "en";
}

/**
 * Resolve the locale for a request at middleware time.
 *
 * - Pre-auth (login, setup wizard): Accept-Language only.
 * - Authenticated: cookie locale if valid and supported, otherwise Accept-
 *   Language fallback, otherwise "en".
 *
 * Zero database queries.
 */
export function resolveLocale(
  c: Context,
  secret: string,
  isPreAuth: boolean,
): Locale {
  const acceptLanguage = c.req.header("Accept-Language");

  if (isPreAuth) {
    return parseAcceptLanguage(acceptLanguage);
  }

  // Authenticated path — read the cookie.
  const cookieHeader = c.req.header("cookie") ?? null;
  const session: SessionData | null = getSessionData(cookieHeader, secret);
  if (session && SUPPORTED_SET.has(session.locale)) {
    return session.locale as Locale;
  }
  // Unsupported or missing locale in a structurally-valid cookie: "en" fallback.
  if (session) return "en";
  // Cookie absent / invalid — auth middleware will redirect; meanwhile we
  // supply a sensible default so the context's `t()` never blows up.
  return parseAcceptLanguage(acceptLanguage);
}

/**
 * Resolve the locale to encode into a freshly issued session cookie at login
 * time. Order: DB `ui_language` setting (when supported) > Accept-Language
 * header > "en".
 *
 * This is the only path that still honours the `ui_language` setting; the
 * per-request middleware no longer touches the database.
 */
export function resolveLoginLocale(
  dbValue: string | undefined,
  acceptLanguage: string | undefined | null,
): Locale {
  if (dbValue && SUPPORTED_SET.has(dbValue)) {
    return dbValue as Locale;
  }
  return parseAcceptLanguage(acceptLanguage ?? null);
}
