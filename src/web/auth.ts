import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

/**
 * Stub: Creates auth middleware that checks for a valid signed session cookie.
 * Skips /health and GET /login. Returns 401 for /api/* routes when unauthenticated.
 * Redirects all other unauthenticated requests to /login?redirect=<originalUrl>.
 */
export function createAuthMiddleware(_secret: string): MiddlewareHandler {
  return async (_c, next) => {
    await next();
  };
}

/**
 * Stub: Creates auth routes sub-app with GET /login, POST /login, POST /logout.
 */
export function createAuthRoutes(
  _password: string,
  _secret: string,
): Hono {
  return new Hono();
}
