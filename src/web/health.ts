import { Hono } from "hono";

export type ServiceCheckers = {
  checkPostgres: () => Promise<"connected" | "disconnected">;
  checkOllama: () => Promise<"connected" | "disconnected">;
  checkWhisper: () => Promise<"connected" | "disconnected">;
  checkTelegram: () => Promise<"polling" | "stopped">;
  getUptime: () => number;
};

export function createHealthRoute(checkers: ServiceCheckers): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const [pg, ollama, whisper, telegram] = await Promise.all([
      checkers.checkPostgres(),
      checkers.checkOllama(),
      checkers.checkWhisper(),
      checkers.checkTelegram(),
    ]);

    const status = pg === "disconnected" ? "degraded" : "ok";

    return c.json({
      status,
      postgres: pg,
      ollama,
      whisper,
      telegram,
      uptime: checkers.getUptime(),
    });
  });

  return app;
}
