/**
 * Test helpers for session-cookie operations.
 *
 * These helpers wrap the production `src/web/session.ts` module (which is created
 * as part of the auth-refactor feature) so individual test files do not
 * duplicate cookie-decoding logic. They also export the fixed TEST_SECRET used
 * across auth tests.
 */

export const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

/**
 * Extract the `cortex_session=<token>` segment from a Set-Cookie header value
 * and return the URL-decoded token string. Returns null when the cookie is
 * absent or the header is empty.
 */
export function extractSessionToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // A Set-Cookie header may combine multiple cookies on a single line separated by
  // commas (standard HTTP), but Hono only ever writes cortex_session itself, so
  // we split on "; " / "," and pick the cortex_session= segment conservatively.
  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z][A-Za-z0-9_-]*=)/);
  for (const part of parts) {
    const match = part.match(/(?:^|;\s*)cortex_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

/**
 * Decode the payload portion of a signed session token. Returns the parsed
 * object or null if the structure is not as expected.
 */
export function decodePayload(token: string): Record<string, unknown> | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const payload = token.substring(0, dotIndex);
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Convenience: pull the cortex_session token out of a Set-Cookie header and
 * return the decoded payload. Returns null on any failure.
 */
export function decodeSetCookiePayload(
  setCookieHeader: string | null,
): Record<string, unknown> | null {
  const token = extractSessionToken(setCookieHeader);
  if (!token) return null;
  return decodePayload(token);
}

/**
 * Sign a custom payload with the test secret, producing a token suitable for a
 * `Cookie: cortex_session=<token>` header in tests that need to craft a
 * specific payload (e.g., one that is missing a `locale` field to exercise
 * rejection behavior).
 *
 * Imports the production module lazily so the helper is usable before
 * src/web/session.ts is compiled.
 */
export async function signForTest(
  payload: Record<string, unknown>,
  secret: string = TEST_SECRET,
): Promise<string> {
  const mod = await import("../../src/web/session.js");
  return mod.sign(JSON.stringify(payload), secret);
}

/**
 * Build a Cookie request header value from a raw (unencoded) signed token.
 */
export function cookieHeaderFor(token: string): string {
  return `cortex_session=${encodeURIComponent(token)}`;
}

/**
 * bcrypt hash of "test-password" (cost 10) — matches TEST_PASSWORD used across
 * auth tests so route handlers that verify password with bcrypt.compare pass.
 * Inlined so we don't pay bcrypt's hashing cost on every test file load.
 */
export const TEST_PASSWORD = "test-password";
export const TEST_PASSWORD_HASH =
  "$2b$10$fT48FucaYsd.UewWh8yHfeSSuDImEjthP.X2wLVChUyMOGwVtm6..";
