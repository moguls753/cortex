/**
 * Locale resolution.
 *
 * `parseAcceptLanguage` parses per RFC 9110 §12.5.4 quality-value ordering
 * and returns the first supported primary subtag, or "en" fallback.
 * `resolveLocale` layers the DB setting on top for authenticated requests.
 */

import type { Sql } from "postgres";
import type { Context } from "hono";
import { SUPPORTED_LOCALES, type Locale } from "./index.js";
import { getAllSettings } from "../settings-queries.js";

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
 * Resolve the locale for a request.
 *
 * - Pre-auth (login, setup wizard): Accept-Language only.
 * - Authenticated: DB `ui_language` setting first, then Accept-Language,
 *   then "en". Unrecognized DB values (e.g. "fr") fall through to
 *   Accept-Language as if unset.
 */
export async function resolveLocale(
  c: Context,
  sql: Sql,
  isPreAuth: boolean,
): Promise<Locale> {
  const header = c.req.header("Accept-Language");

  if (isPreAuth) {
    return parseAcceptLanguage(header);
  }

  let dbValue: string | undefined;
  try {
    const settings = await getAllSettings(sql);
    const raw = settings?.ui_language;
    dbValue = typeof raw === "string" ? raw : undefined;
  } catch {
    dbValue = undefined;
  }
  if (dbValue && SUPPORTED_SET.has(dbValue)) {
    return dbValue as Locale;
  }
  return parseAcceptLanguage(header);
}
