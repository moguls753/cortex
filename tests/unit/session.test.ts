/**
 * Unit tests for src/web/session.ts (auth-refactor Group 2).
 *
 * Scenarios: TS-2.1, TS-2.2, TS-2.3, TS-2.4, TS-2.5, TS-2.6, TS-2.7
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

const TEST_SECRET = "test-session-secret-at-least-32-chars-long!!";

describe("src/web/session.ts", () => {
  // TS-2.1
  it("exports the documented public API", async () => {
    const session = await import("../../src/web/session.js");

    expect(typeof session.sign).toBe("function");
    expect(typeof session.verify).toBe("function");
    expect(typeof session.parseCookies).toBe("function");
    expect(typeof session.getSessionData).toBe("function");
    expect(typeof session.issueSessionCookie).toBe("function");

    expect(session.COOKIE_NAME).toBe("cortex_session");
    expect(session.THIRTY_DAYS_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(session.THIRTY_DAYS_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  // TS-2.2
  it("sign and verify round-trip a payload with the same secret", async () => {
    const { sign, verify } = await import("../../src/web/session.js");

    const payload = JSON.stringify({
      issued_at: 1_700_000_000_000,
      locale: "en",
    });
    const token = sign(payload, TEST_SECRET);
    const decoded = verify(token, TEST_SECRET);

    expect(decoded).toBe(payload);
  });

  // TS-2.3
  it("verify returns null when the signing secret differs", async () => {
    const { sign, verify } = await import("../../src/web/session.js");

    const payload = JSON.stringify({
      issued_at: 1_700_000_000_000,
      locale: "en",
    });
    const token = sign(payload, "secret-A-at-least-32-chars-long!!!!!!!");
    const decoded = verify(token, "secret-B-at-least-32-chars-long!!!!!!!");

    expect(decoded).toBeNull();
  });

  // TS-2.4
  it("getSessionData returns issuedAt and locale from a valid cookie header", async () => {
    const { sign, getSessionData } = await import("../../src/web/session.js");

    const payload = JSON.stringify({
      issued_at: 1_700_000_000_000,
      locale: "de",
    });
    const token = sign(payload, TEST_SECRET);
    const cookieHeader = `cortex_session=${encodeURIComponent(token)}`;

    const result = getSessionData(cookieHeader, TEST_SECRET);

    expect(result).not.toBeNull();
    expect(result!.issuedAt).toBe(1_700_000_000_000);
    expect(result!.locale).toBe("de");
  });

  // TS-2.5
  it("getSessionData returns null when the session cookie is absent", async () => {
    const { getSessionData } = await import("../../src/web/session.js");

    const result = getSessionData("other=value; another=thing", TEST_SECRET);
    expect(result).toBeNull();
  });

  // TS-2.6
  it("issueSessionCookie writes a Set-Cookie header with HttpOnly, SameSite=Lax, Path=/, and 30-day Max-Age", async () => {
    const { issueSessionCookie, THIRTY_DAYS_SECONDS } = await import(
      "../../src/web/session.js"
    );

    const app = new Hono();
    app.get("/", (c) => {
      issueSessionCookie(c, TEST_SECRET, { locale: "en" });
      return c.text("ok");
    });

    const res = await app.request("/");
    const setCookie = res.headers.get("set-cookie");

    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/cortex_session=[^;]+/);
    expect(setCookie!).toContain("HttpOnly");
    expect(setCookie!).toContain("SameSite=Lax");
    expect(setCookie!).toContain("Path=/");
    expect(setCookie!).toContain(`Max-Age=${THIRTY_DAYS_SECONDS}`);
  });

  // TS-2.7
  it("issueSessionCookie preserves an existing issued_at when provided", async () => {
    const { issueSessionCookie } = await import("../../src/web/session.js");

    const fixedT = 1_700_000_000_000;
    const app = new Hono();
    app.get("/", (c) => {
      issueSessionCookie(c, TEST_SECRET, { locale: "de", issuedAt: fixedT });
      return c.text("ok");
    });

    const res = await app.request("/");
    const setCookie = res.headers.get("set-cookie")!;
    const match = setCookie.match(/cortex_session=([^;]+)/);
    expect(match).not.toBeNull();

    const decoded = decodeURIComponent(match![1]!);
    const dotIdx = decoded.lastIndexOf(".");
    const payloadRaw = decoded.substring(0, dotIdx);
    const payload = JSON.parse(payloadRaw) as {
      issued_at: number;
      locale: string;
    };

    expect(payload.issued_at).toBe(fixedT);
    expect(payload.locale).toBe("de");
  });
});
