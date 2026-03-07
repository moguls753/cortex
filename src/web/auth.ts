import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { createLogger } from "../logger.js";

const logger = createLogger("web-auth");

const COOKIE_NAME = "cortex_session";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const THIRTY_DAYS_MS = THIRTY_DAYS_SECONDS * 1000;

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

export function createAuthMiddleware(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;

    // Always allow /health
    if (path === "/health") {
      await next();
      return;
    }

    // Allow all requests to /login and /logout (handled by auth routes)
    if (path === "/login" || path === "/logout") {
      await next();
      return;
    }

    // Check session cookie
    const cookieHeader = c.req.header("cookie") ?? null;
    const session = getSessionPayload(cookieHeader, secret);

    if (session) {
      // Check expiry
      const elapsed = Date.now() - session.issuedAt;
      if (elapsed < THIRTY_DAYS_MS) {
        // Valid session
        await next();
        return;
      }
    }

    // Unauthenticated
    if (path.startsWith("/api/") || path.startsWith("/mcp")) {
      return c.text("Unauthorized", 401);
    }

    const redirect = encodeURIComponent(path);
    return c.redirect(`/login?redirect=${redirect}`, 302);
  };
}

export function createAuthRoutes(password: string, secret: string): Hono {
  const app = new Hono();

  // GET /login
  app.get("/login", (c) => {
    // If already authenticated, redirect to /
    const cookieHeader = c.req.header("cookie") ?? null;
    const session = getSessionPayload(cookieHeader, secret);
    if (session) {
      const elapsed = Date.now() - session.issuedAt;
      if (elapsed < THIRTY_DAYS_MS) {
        return c.redirect("/", 302);
      }
    }

    return c.html(renderLoginPage());
  });

  // POST /login
  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const submittedPassword = body["password"] as string | undefined;

    if (submittedPassword !== password) {
      logger.warn("Failed login attempt", {
        timestamp: new Date().toISOString(),
      });
      return c.html(renderLoginPage("Invalid password"), 200);
    }

    // Create session token
    const payload = JSON.stringify({ issued_at: Date.now() });
    const token = sign(payload, secret);

    const cookieValue = encodeURIComponent(token);
    const setCookie =
      `${COOKIE_NAME}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${THIRTY_DAYS_SECONDS}`;

    c.header("Set-Cookie", setCookie);

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

  return app;
}

function renderLoginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Cortex</title>
</head>
<body>
  <form method="POST">
    ${error ? `<p>${error}</p>` : ""}
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Login</button>
  </form>
</body>
</html>`;
}
