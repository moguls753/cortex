/**
 * Session cookie module — single source of truth for Cortex web session
 * cookies.
 *
 * The session cookie `cortex_session` carries a signed JSON payload:
 *
 *   { issued_at: number, locale: string }
 *
 * - `issued_at` is milliseconds since epoch; used for server-side 30-day expiry.
 * - `locale` is a two-letter lowercase BCP-47 primary subtag (e.g. "en", "de").
 *
 * Signing: HMAC-SHA256 of the JSON-encoded payload, base64url-encoded,
 * appended to the payload separated by a single dot: `<payload>.<sig>`.
 *
 * Verification is constant-time via `timingSafeEqual`.
 *
 * The cookie itself is URL-encoded when set and URL-decoded on parse.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

export const COOKIE_NAME = "cortex_session";
export const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
export const THIRTY_DAYS_MS = THIRTY_DAYS_SECONDS * 1000;

export interface SessionData {
  issuedAt: number;
  locale: string;
}

export function sign(payload: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verify(token: string, secret: string): string | null {
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

export function parseCookies(header: string): Record<string, string> {
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

/**
 * Parse the session cookie from a `Cookie` request header and return the
 * validated, signed session data. Returns `null` when the cookie is absent,
 * malformed, mis-signed, structurally invalid, or lacks the required
 * `locale` field.
 *
 * Callers that need the raw JSON payload instead of the typed object should
 * use `verify` directly.
 */
export function getSessionData(
  cookieHeader: string | null,
  secret: string,
): SessionData | null {
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const decoded = decodeURIComponent(token);
  const payload = verify(decoded, secret);
  if (!payload) return null;

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.issued_at !== "number") return null;
  // AC-4.1 / EC-1: cookies that lack a `locale` field are structurally invalid
  // after the auth refactor — old pre-refactor cookies should force a re-login
  // rather than silently fall through.
  if (typeof obj.locale !== "string") return null;

  return { issuedAt: obj.issued_at, locale: obj.locale };
}

export interface IssueCookieOptions {
  locale: string;
  /**
   * When supplied, the signed payload uses this value instead of `Date.now()`.
   * Used by `/settings` to re-issue the cookie on `ui_language` change without
   * resetting the 30-day expiry.
   */
  issuedAt?: number;
}

/**
 * Sign a fresh session cookie and attach it to the Hono response via
 * `Set-Cookie`. Attributes: HttpOnly, SameSite=Lax, Path=/, Max-Age=30d.
 */
export function issueSessionCookie(
  c: Context,
  secret: string,
  options: IssueCookieOptions,
): void {
  const issuedAt = options.issuedAt ?? Date.now();
  const payload = JSON.stringify({
    issued_at: issuedAt,
    locale: options.locale,
  });
  const token = sign(payload, secret);
  const cookieValue = encodeURIComponent(token);
  const setCookie =
    `${COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${THIRTY_DAYS_SECONDS}`;
  c.header("Set-Cookie", setCookie);
}

/**
 * Convenience for the logout handler: emit a `Set-Cookie` that clears the
 * session immediately (`Max-Age=0`). Kept here so `COOKIE_NAME` stays private
 * to this module.
 */
export function clearSessionCookie(c: Context): void {
  const setCookie =
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  c.header("Set-Cookie", setCookie);
}
