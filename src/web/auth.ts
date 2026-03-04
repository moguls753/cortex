import type { Context, Next } from "hono";

export const authMiddleware = async (c: Context, next: Next) => {
  if (c.req.path === "/health") {
    await next();
    return;
  }

  return c.text("Unauthorized", 401);
};
